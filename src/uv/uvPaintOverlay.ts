import type { SceneObject } from '../mesh/HalfEdgeMesh'
import {
  boundaryEdgesForFacesSpatial,
  getFaceGroupMap,
  type FaceGroupMap,
} from '../mesh/faceGroups'
import { resolveEffectiveMaterial } from '../material/materials'
import { drawRegionBoundary, drawRegionFill } from './uvOverlayDraw'
import type { SceneObjectWithUVs } from './uvObject'
import type { Uv2 } from './uvTypes'

export interface UvPaintOverlayStyles {
  idleFill: string
  idleStroke: string
  dimFill: string
  dimStroke: string
  selectedFill: string
  selectedStroke: string
  /** Full-canvas dim when a face selection is active (outside islands stay muted). */
  outsideDim: string
}

export const DEFAULT_UV_PAINT_OVERLAY_STYLES: UvPaintOverlayStyles = {
  idleFill: 'rgba(110, 203, 245, 0.06)',
  idleStroke: 'rgba(110, 203, 245, 0.45)',
  dimFill: 'rgba(0, 0, 0, 0.04)',
  dimStroke: 'rgba(110, 203, 245, 0.12)',
  selectedFill: 'rgba(110, 203, 245, 0.22)',
  selectedStroke: 'rgba(110, 203, 245, 0.95)',
  outsideDim: 'rgba(0, 0, 0, 0.38)',
}

export interface UvPaintOverlayInput {
  ctx: CanvasRenderingContext2D
  texW: number
  texH: number
  mesh: SceneObjectWithUVs
  uvs: readonly Uv2[]
  /** Face indices to emphasize (mesh / UV selection). Empty = show all islands equally. */
  selectedFaces: number[]
  styles?: Partial<UvPaintOverlayStyles>
  /** Optional precomputed planar face groups (caller may reuse). */
  faceGroupMap?: FaceGroupMap | null
  /** Optional cached group boundary edges keyed by group id. */
  groupBoundaryEdges?: Map<number, [number, number][]>
  /** Optional cached boundary for the selected face set. */
  selectedBoundaryEdges?: [number, number][]
  /**
   * When false (default), skip translucent island fills — outlines only.
   * Selection still dims outside islands (needs a cutout fill).
   */
  drawFills?: boolean
}

interface OverlayEdgeCache {
  topologySig: string
  groupEdges: Map<number, [number, number][]>
  selectedKey: string
  selectedEdges: [number, number][]
}

/** Topology-keyed edge caches — cleared on toggle-off / object change / unmount. */
const edgeCacheByObjectId = new Map<string, OverlayEdgeCache>()

function meshTopologySig(obj: SceneObject): string {
  let sig = `${obj.positions.length}|${obj.faces.length}|${obj.faceUvIndices?.length ?? 0}`
  if (obj.faceGroups?.length) {
    sig += `|fg:${obj.faceGroups.map((g) => g.join('+')).join(';')}`
  }
  for (let fi = 0; fi < Math.min(obj.faces.length, 48); fi++) {
    const f = obj.faces[fi]
    const uv = obj.faceUvIndices?.[fi]
    sig += `|${f.join(',')}:${uv?.join(',') ?? ''}`
  }
  if (obj.faces.length > 48) sig += `|n${obj.faces.length}`
  return sig
}

function selectedFacesKey(faces: number[]): string {
  if (faces.length === 0) return ''
  return faces.slice().sort((a, b) => a - b).join(',')
}

/** Drop edge caches for one object or all (memory-safe teardown). */
export function clearUvPaintOverlayCaches(objectId?: string): void {
  if (objectId) edgeCacheByObjectId.delete(objectId)
  else edgeCacheByObjectId.clear()
}

export function meshHasPaintableUvs(obj: SceneObject | null | undefined): obj is SceneObjectWithUVs {
  return Boolean(obj?.uvs?.length && obj.faceUvIndices?.length === obj.faces.length)
}

/** Read-only Pixel Editor overlay source: exactly the selected object's authored UVs. */
export function resolveSelectedUvOverlayMesh(
  objects: readonly SceneObject[],
  selectedObjectId: string | null
): SceneObjectWithUVs | null {
  if (!selectedObjectId) return null
  const selected = objects.find((obj) => obj.id === selectedObjectId)
  return meshHasPaintableUvs(selected) ? selected : null
}

/** Prefer the selected object when it uses this texture doc; else first textured match. */
export function resolveMeshForTextureDoc(
  objects: SceneObject[],
  docId: string,
  preferredObjectId: string | null
): SceneObjectWithUVs | null {
  const matches: SceneObject[] = []
  for (const obj of objects) {
    const mat = resolveEffectiveMaterial(obj)
    if (mat.mode !== 'texture') continue
    if ((mat.textureId ?? obj.id) !== docId) continue
    matches.push(obj)
  }
  if (matches.length === 0) return null
  const preferred = preferredObjectId
    ? matches.find((o) => o.id === preferredObjectId)
    : undefined
  const pick = preferred ?? matches[0]!
  return meshHasPaintableUvs(pick) ? pick : null
}

function ensureGroupEdges(
  objectId: string,
  mesh: SceneObjectWithUVs,
  faceGroupMap: FaceGroupMap
): Map<number, [number, number][]> {
  const topologySig = meshTopologySig(mesh)
  let entry = edgeCacheByObjectId.get(objectId)
  if (!entry || entry.topologySig !== topologySig) {
    const groupEdges = new Map<number, [number, number][]>()
    for (const group of faceGroupMap.groups) {
      groupEdges.set(group.id, boundaryEdgesForFacesSpatial(mesh, group.faceIndices))
    }
    entry = { topologySig, groupEdges, selectedKey: '', selectedEdges: [] }
    edgeCacheByObjectId.set(objectId, entry)
  }
  return entry.groupEdges
}

function ensureSelectedEdges(
  objectId: string,
  mesh: SceneObjectWithUVs,
  selectedFaces: number[]
): [number, number][] {
  if (selectedFaces.length === 0) return []
  const topologySig = meshTopologySig(mesh)
  let entry = edgeCacheByObjectId.get(objectId)
  if (!entry || entry.topologySig !== topologySig) {
    entry = {
      topologySig,
      groupEdges: new Map(),
      selectedKey: '',
      selectedEdges: [],
    }
    edgeCacheByObjectId.set(objectId, entry)
  }
  const key = selectedFacesKey(selectedFaces)
  if (entry.selectedKey !== key) {
    entry.selectedKey = key
    entry.selectedEdges = boundaryEdgesForFacesSpatial(mesh, selectedFaces)
  }
  return entry.selectedEdges
}

/**
 * Draw UV island outlines / fills onto a pixel-editor overlay canvas.
 * Call only when dirty (UV/selection/doc change) — not every idle frame.
 */
export function paintUvAtlasOverlay(input: UvPaintOverlayInput): void {
  const {
    ctx,
    texW,
    texH,
    mesh,
    uvs,
    selectedFaces,
  } = input
  if (texW <= 0 || texH <= 0 || mesh.faces.length === 0) return

  const styles: UvPaintOverlayStyles = {
    ...DEFAULT_UV_PAINT_OVERLAY_STYLES,
    ...input.styles,
  }
  const drawFills = input.drawFills === true

  const faceGroupMap = input.faceGroupMap ?? getFaceGroupMap(mesh)
  const selectedSet =
    selectedFaces.length > 0 ? new Set(selectedFaces) : null
  const hasSelection = Boolean(selectedSet && selectedSet.size > 0)

  // Dim outside active islands so painters see the drawable region clearly.
  if (hasSelection) {
    ctx.fillStyle = styles.outsideDim
    ctx.fillRect(0, 0, texW, texH)
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    drawRegionFill(ctx, mesh, uvs, selectedFaces, '#fff', texW, texH)
    ctx.restore()
  }

  const groupEdges =
    input.groupBoundaryEdges ??
    (faceGroupMap ? ensureGroupEdges(mesh.id, mesh, faceGroupMap) : undefined)

  if (faceGroupMap) {
    for (const group of faceGroupMap.groups) {
      const isSelected =
        hasSelection && group.faceIndices.some((fi) => selectedSet!.has(fi))
      if (hasSelection && isSelected) continue
      const dimmed = hasSelection
      if (drawFills) {
        drawRegionFill(
          ctx,
          mesh,
          uvs,
          group.faceIndices,
          dimmed ? styles.dimFill : styles.idleFill,
          texW,
          texH
        )
      }
      drawRegionBoundary(
        ctx,
        mesh,
        uvs,
        group.faceIndices,
        dimmed ? styles.dimStroke : styles.idleStroke,
        dimmed ? 1 : 1.25,
        texW,
        texH,
        groupEdges?.get(group.id)
      )
    }
  } else {
    const allFaces = mesh.faces.map((_, i) => i)
    if (drawFills) {
      drawRegionFill(ctx, mesh, uvs, allFaces, styles.idleFill, texW, texH)
    }
    drawRegionBoundary(
      ctx,
      mesh,
      uvs,
      allFaces,
      styles.idleStroke,
      1.25,
      texW,
      texH
    )
  }

  if (hasSelection) {
    const selectedEdges =
      input.selectedBoundaryEdges ??
      ensureSelectedEdges(mesh.id, mesh, selectedFaces)
    if (drawFills) {
      drawRegionFill(ctx, mesh, uvs, selectedFaces, styles.selectedFill, texW, texH)
    }
    drawRegionBoundary(
      ctx,
      mesh,
      uvs,
      selectedFaces,
      styles.selectedStroke,
      2,
      texW,
      texH,
      selectedEdges
    )
  }
}
