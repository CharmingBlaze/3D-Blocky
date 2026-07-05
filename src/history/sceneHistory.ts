import type { PixelDocument } from '../pixel/pixelTypes'
import { clonePixelDocuments } from '../pixel/pixelDocument'
import { cloneTransform, prepareSceneObject } from '../mesh/objectTransform'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { MeshComponentSelection } from '../mesh/meshSelection'
import { parseEdgeKey } from '../mesh/meshSelection'
import type { BillboardImage, ReferenceImage } from '../images/imageDropTypes'

export interface SnapshotTextureInfo {
  url: string
  name: string
  width: number
  height: number
}

export interface SceneSnapshot {
  objects: SceneObject[]
  objectTextures: Record<string, SnapshotTextureInfo>
  pixelDocuments: Record<string, PixelDocument>
  referenceImages: ReferenceImage[]
  billboardImages: BillboardImage[]
  selectedObjectId: string | null
  selectionObjectIds: string[]
  meshSelection: MeshComponentSelection | null
}

export interface HistoryEntry {
  snapshot: SceneSnapshot
  label?: string
}

const DEFAULT_MAX_DEPTH = 50

export function cloneSceneObjects(objects: SceneObject[]): SceneObject[] {
  return objects.map((o) => ({
    ...o,
    positions: o.positions.map((p) => ({ ...p })),
    faces: o.faces.map((f) => [...f]),
    faceColors: [...o.faceColors],
    faceGroups: o.faceGroups?.map((g) => [...g]),
    uvs: o.uvs?.map((u) => ({ ...u })),
    faceUvIndices: o.faceUvIndices?.map((f) => [...f]),
    cornerColors: o.cornerColors?.map((c) => [c[0], c[1], c[2], c[3]] as [number, number, number, number]),
    faceColorIndices: o.faceColorIndices?.map((f) => [...f]),
    material: o.material
      ? {
          ...o.material,
          solidColor: o.material.solidColor
            ? ([...o.material.solidColor] as [number, number, number, number])
            : undefined,
        }
      : undefined,
    faceMaterials: o.faceMaterials?.map((m) =>
      m
        ? {
            ...m,
            solidColor: m.solidColor
              ? ([...m.solidColor] as [number, number, number, number])
              : undefined,
          }
        : null
    ),
    pivot: o.pivot ? { ...o.pivot } : undefined,
    transform: o.transform ? cloneTransform(o.transform) : undefined,
  }))
}

export function cloneObjectTextures(
  textures: Record<string, SnapshotTextureInfo>
): Record<string, SnapshotTextureInfo> {
  return { ...textures }
}

export function cloneReferenceImages(images: ReferenceImage[]): ReferenceImage[] {
  return images.map((img) => ({ ...img }))
}

export function cloneBillboardImages(images: BillboardImage[]): BillboardImage[] {
  return images.map((img) => ({
    ...img,
    position: { ...img.position },
  }))
}

export function captureSceneSnapshot(input: SceneSnapshot): SceneSnapshot {
  return {
    objects: cloneSceneObjects(input.objects),
    objectTextures: cloneObjectTextures(input.objectTextures),
    pixelDocuments: clonePixelDocuments(input.pixelDocuments ?? {}),
    referenceImages: cloneReferenceImages(input.referenceImages),
    billboardImages: cloneBillboardImages(input.billboardImages),
    selectedObjectId: input.selectedObjectId,
    selectionObjectIds: [...input.selectionObjectIds],
    meshSelection: input.meshSelection
      ? {
          objectId: input.meshSelection.objectId,
          vertices: [...input.meshSelection.vertices],
          edges: [...input.meshSelection.edges],
          faces: [...input.meshSelection.faces],
        }
      : null,
  }
}

function objectDataSignature(obj: SceneObject): string {
  const pos = obj.positions
    .map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`)
    .join(';')
  const face = obj.faces.map((f) => f.join(',')).join('|')
  const uv =
    obj.uvs?.map((u) => `${u.u.toFixed(5)},${u.v.toFixed(5)}`).join(';') ?? ''
  const tr = obj.transform
    ? `${obj.transform.position.x},${obj.transform.position.y},${obj.transform.position.z}|${obj.transform.rotation.x},${obj.transform.rotation.y},${obj.transform.rotation.z}|${obj.transform.scale.x},${obj.transform.scale.y},${obj.transform.scale.z}`
    : ''
  return `${obj.id}:${obj.smoothShading}:${obj.color}:${obj.topologyLocked}:${pos}#${face}#${uv}#${tr}`
}

export function snapshotsEqual(a: SceneSnapshot, b: SceneSnapshot): boolean {
  if (a.selectedObjectId !== b.selectedObjectId) return false
  if (a.selectionObjectIds.length !== b.selectionObjectIds.length) return false
  if (!a.selectionObjectIds.every((id, i) => id === b.selectionObjectIds[i])) return false

  const meshA = a.meshSelection
  const meshB = b.meshSelection
  if (Boolean(meshA) !== Boolean(meshB)) return false
  if (meshA && meshB) {
    if (meshA.objectId !== meshB.objectId) return false
    if (meshA.vertices.length !== meshB.vertices.length) return false
    if (meshA.edges.length !== meshB.edges.length) return false
    if (meshA.faces.length !== meshB.faces.length) return false
    if (!meshA.vertices.every((v, i) => v === meshB.vertices[i])) return false
    if (!meshA.edges.every((e, i) => e === meshB.edges[i])) return false
    if (!meshA.faces.every((f, i) => f === meshB.faces[i])) return false
  }

  const texA = Object.keys(a.objectTextures).sort()
  const texB = Object.keys(b.objectTextures).sort()
  if (texA.length !== texB.length) return false
  for (let i = 0; i < texA.length; i++) {
    const key = texA[i]
    if (key !== texB[i]) return false
    const ta = a.objectTextures[key]
    const tb = b.objectTextures[key]
    if (ta.url !== tb.url || ta.name !== tb.name) return false
  }

  if (a.objects.length !== b.objects.length) return false
  const sortedA = [...a.objects].sort((x, y) => x.id.localeCompare(y.id))
  const sortedB = [...b.objects].sort((x, y) => x.id.localeCompare(y.id))
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i].id !== sortedB[i].id) return false
    if (objectDataSignature(sortedA[i]) !== objectDataSignature(sortedB[i])) return false
  }

  if (a.referenceImages.length !== b.referenceImages.length) return false
  for (let i = 0; i < a.referenceImages.length; i++) {
    const ra = a.referenceImages[i]
    const rb = b.referenceImages[i]
    if (
      ra.id !== rb.id ||
      ra.url !== rb.url ||
      ra.view !== rb.view ||
      ra.x !== rb.x ||
      ra.y !== rb.y ||
      ra.width !== rb.width
    ) {
      return false
    }
  }

  if (a.billboardImages.length !== b.billboardImages.length) return false
  for (let i = 0; i < a.billboardImages.length; i++) {
    const ba = a.billboardImages[i]
    const bb = b.billboardImages[i]
    if (
      ba.id !== bb.id ||
      ba.url !== bb.url ||
      ba.position.x !== bb.position.x ||
      ba.position.y !== bb.position.y ||
      ba.position.z !== bb.position.z
    ) {
      return false
    }
  }

  return true
}

export function sanitizeSceneSnapshot(snapshot: SceneSnapshot): SceneSnapshot {
  const objectIds = new Set(snapshot.objects.map((o) => o.id))
  const objects = snapshot.objects.map(prepareSceneObject)

  const selectionObjectIds = snapshot.selectionObjectIds.filter((id) =>
    objectIds.has(id)
  )
  let selectedObjectId =
    snapshot.selectedObjectId && objectIds.has(snapshot.selectedObjectId)
      ? snapshot.selectedObjectId
      : selectionObjectIds[selectionObjectIds.length - 1] ?? null

  let meshSelection = snapshot.meshSelection
  if (meshSelection && !objectIds.has(meshSelection.objectId)) {
    meshSelection = null
  } else if (meshSelection) {
    const obj = objects.find((o) => o.id === meshSelection!.objectId)
    if (!obj) {
      meshSelection = null
    } else {
      const vertCount = obj.positions.length
      const faceCount = obj.faces.length
      meshSelection = {
        objectId: meshSelection.objectId,
        vertices: meshSelection.vertices.filter((vi) => vi >= 0 && vi < vertCount),
        faces: meshSelection.faces.filter((fi) => fi >= 0 && fi < faceCount),
        edges: meshSelection.edges.filter((key) => {
          const [a, b] = parseEdgeKey(key)
          return a >= 0 && b >= 0 && a < vertCount && b < vertCount
        }),
      }
      if (
        meshSelection.vertices.length === 0 &&
        meshSelection.edges.length === 0 &&
        meshSelection.faces.length === 0
      ) {
        meshSelection = null
      }
    }
  }

  if (selectedObjectId && !objectIds.has(selectedObjectId)) {
    selectedObjectId = selectionObjectIds[selectionObjectIds.length - 1] ?? null
  }

  const objectTextures: Record<string, SnapshotTextureInfo> = {}
  for (const [id, info] of Object.entries(snapshot.objectTextures)) {
    if (objectIds.has(id)) objectTextures[id] = { ...info }
  }

  const textureIds = new Set<string>()
  for (const obj of objects) {
    const tid = obj.material?.textureId
    if (tid) textureIds.add(tid)
    for (const fm of obj.faceMaterials ?? []) {
      if (fm?.textureId) textureIds.add(fm.textureId)
    }
  }
  for (const id of objectIds) textureIds.add(id)

  const pixelDocuments: Record<string, PixelDocument> = {}
  for (const [id, doc] of Object.entries(snapshot.pixelDocuments ?? {})) {
    if (textureIds.has(id) || objectIds.has(id)) {
      pixelDocuments[id] = clonePixelDocuments({ [id]: doc })[id]
    }
  }

  return {
    objects,
    objectTextures,
    pixelDocuments,
    referenceImages: cloneReferenceImages(snapshot.referenceImages ?? []),
    billboardImages: cloneBillboardImages(snapshot.billboardImages ?? []),
    selectedObjectId,
    selectionObjectIds,
    meshSelection,
  }
}

export function applySceneSnapshot(snapshot: SceneSnapshot): SceneSnapshot {
  return sanitizeSceneSnapshot(captureSceneSnapshot(snapshot))
}

export class SceneHistoryStack {
  private entries: HistoryEntry[] = []
  private index = 0

  constructor(
    initialSnapshot: SceneSnapshot,
    private readonly maxDepth = DEFAULT_MAX_DEPTH
  ) {
    this.entries = [{ snapshot: captureSceneSnapshot(initialSnapshot), label: 'Initial' }]
    this.index = 0
  }

  get length(): number {
    return this.entries.length
  }

  get currentIndex(): number {
    return this.index
  }

  get canUndo(): boolean {
    return this.index > 0
  }

  get canRedo(): boolean {
    return this.index < this.entries.length - 1
  }

  get currentLabel(): string | undefined {
    return this.entries[this.index]?.label
  }

  get undoLabel(): string | undefined {
    return this.entries[this.index]?.label
  }

  get redoLabel(): string | undefined {
    return this.entries[this.index + 1]?.label
  }

  stats(): { canUndo: boolean; canRedo: boolean; undoLabel?: string; redoLabel?: string } {
    return {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoLabel: this.undoLabel,
      redoLabel: this.redoLabel,
    }
  }

  /** Push a snapshot; skips if identical to the current head. Returns whether a new entry was added. */
  push(snapshot: SceneSnapshot, label?: string): boolean {
    const captured = captureSceneSnapshot(snapshot)
    const current = this.entries[this.index]?.snapshot
    if (current && snapshotsEqual(current, captured)) return false

    const trimmed = this.entries.slice(0, this.index + 1)
    trimmed.push({ snapshot: captured, label })
    if (trimmed.length > this.maxDepth) trimmed.shift()
    this.entries = trimmed
    this.index = trimmed.length - 1
    return true
  }

  /** Replace the current history entry (e.g. commit a live preview). */
  replaceHead(snapshot: SceneSnapshot, label?: string): void {
    const captured = captureSceneSnapshot(snapshot)
    const next = [...this.entries]
    next[this.index] = { snapshot: captured, label: label ?? next[this.index]?.label }
    this.entries = next
  }

  undo(): SceneSnapshot | null {
    if (!this.canUndo) return null
    this.index -= 1
    return captureSceneSnapshot(this.entries[this.index].snapshot)
  }

  redo(): SceneSnapshot | null {
    if (!this.canRedo) return null
    this.index += 1
    return captureSceneSnapshot(this.entries[this.index].snapshot)
  }

  reset(snapshot: SceneSnapshot): void {
    this.entries = [{ snapshot: captureSceneSnapshot(snapshot), label: 'Initial' }]
    this.index = 0
  }

  allSnapshots(): SceneSnapshot[] {
    return this.entries.map((entry) => entry.snapshot)
  }
}
