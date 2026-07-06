import type { PixelDocument } from '../pixel/pixelTypes'
import {
  clonePixelDocument,
  clonePixelDocuments,
  pixelDocumentEqual,
  pixelDocumentsEqual,
} from '../pixel/pixelDocument'
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

export function cloneSceneObject(obj: SceneObject): SceneObject {
  return {
    ...obj,
    positions: obj.positions.map((p) => ({ ...p })),
    faces: obj.faces.map((f) => [...f]),
    faceColors: [...obj.faceColors],
    faceGroups: obj.faceGroups?.map((g) => [...g]),
    uvs: obj.uvs?.map((u) => ({ ...u })),
    faceUvIndices: obj.faceUvIndices?.map((f) => [...f]),
    cornerColors: obj.cornerColors?.map((c) => [c[0], c[1], c[2], c[3]] as [number, number, number, number]),
    faceColorIndices: obj.faceColorIndices?.map((f) => [...f]),
    material: obj.material
      ? {
          ...obj.material,
          solidColor: obj.material.solidColor
            ? ([...obj.material.solidColor] as [number, number, number, number])
            : undefined,
        }
      : undefined,
    faceMaterials: obj.faceMaterials?.map((m) =>
      m
        ? {
            ...m,
            solidColor: m.solidColor
              ? ([...m.solidColor] as [number, number, number, number])
              : undefined,
          }
        : null
    ),
    pivot: obj.pivot ? { ...obj.pivot } : undefined,
    transform: obj.transform ? cloneTransform(obj.transform) : undefined,
  }
}

export function cloneSceneObjects(objects: SceneObject[]): SceneObject[] {
  return objects.map(cloneSceneObject)
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

function meshSelectionEqual(
  a: MeshComponentSelection | null,
  b: MeshComponentSelection | null
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.objectId === b.objectId &&
    a.vertices.length === b.vertices.length &&
    a.edges.length === b.edges.length &&
    a.faces.length === b.faces.length &&
    a.vertices.every((v, i) => v === b.vertices[i]) &&
    a.edges.every((e, i) => e === b.edges[i]) &&
    a.faces.every((f, i) => f === b.faces[i])
  )
}

function objectTexturesEqual(
  a: Record<string, SnapshotTextureInfo>,
  b: Record<string, SnapshotTextureInfo>
): boolean {
  const keysA = Object.keys(a).sort()
  const keysB = Object.keys(b).sort()
  if (keysA.length !== keysB.length) return false
  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i]
    if (key !== keysB[i]) return false
    const ta = a[key]
    const tb = b[key]
    if (ta.url !== tb.url || ta.name !== tb.name || ta.width !== tb.width || ta.height !== tb.height) {
      return false
    }
  }
  return true
}

function referenceImagesEqual(a: ReferenceImage[], b: ReferenceImage[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ra = a[i]
    const rb = b[i]
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
  return true
}

function billboardImagesEqual(a: BillboardImage[], b: BillboardImage[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ba = a[i]
    const bb = b[i]
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

function captureObjects(input: SceneObject[], previous?: SceneObject[]): SceneObject[] {
  if (!previous) return cloneSceneObjects(input)
  const prevById = new Map(previous.map((obj) => [obj.id, obj]))
  return input.map((obj) => {
    const prevObj = prevById.get(obj.id)
    if (prevObj && objectDataSignature(prevObj) === objectDataSignature(obj)) return prevObj
    return cloneSceneObject(obj)
  })
}

function capturePixelDocuments(
  input: Record<string, PixelDocument>,
  previous?: Record<string, PixelDocument>
): Record<string, PixelDocument> {
  if (!previous) return clonePixelDocuments(input)
  const out: Record<string, PixelDocument> = {}
  for (const [id, doc] of Object.entries(input)) {
    const prevDoc = previous[id]
    out[id] = prevDoc && pixelDocumentEqual(doc, prevDoc) ? prevDoc : clonePixelDocument(doc)
  }
  return out
}

/** Deep snapshot for undo history. Reuses unchanged data from `previous` to save RAM. */
export function captureSceneSnapshot(input: SceneSnapshot, previous?: SceneSnapshot): SceneSnapshot {
  return {
    objects: captureObjects(input.objects, previous?.objects),
    objectTextures:
      previous && objectTexturesEqual(input.objectTextures, previous.objectTextures)
        ? previous.objectTextures
        : cloneObjectTextures(input.objectTextures),
    pixelDocuments: capturePixelDocuments(input.pixelDocuments ?? {}, previous?.pixelDocuments),
    referenceImages:
      previous && referenceImagesEqual(input.referenceImages, previous.referenceImages)
        ? previous.referenceImages
        : cloneReferenceImages(input.referenceImages),
    billboardImages:
      previous && billboardImagesEqual(input.billboardImages, previous.billboardImages)
        ? previous.billboardImages
        : cloneBillboardImages(input.billboardImages),
    selectedObjectId: input.selectedObjectId,
    selectionObjectIds: [...input.selectionObjectIds],
    meshSelection:
      previous && meshSelectionEqual(input.meshSelection, previous.meshSelection)
        ? previous.meshSelection
        : input.meshSelection
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

  if (!meshSelectionEqual(a.meshSelection, b.meshSelection)) return false
  if (!objectTexturesEqual(a.objectTextures, b.objectTextures)) return false
  if (!pixelDocumentsEqual(a.pixelDocuments ?? {}, b.pixelDocuments ?? {})) return false

  if (a.objects.length !== b.objects.length) return false
  const sortedA = [...a.objects].sort((x, y) => x.id.localeCompare(y.id))
  const sortedB = [...b.objects].sort((x, y) => x.id.localeCompare(y.id))
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i].id !== sortedB[i].id) return false
    if (objectDataSignature(sortedA[i]) !== objectDataSignature(sortedB[i])) return false
  }

  if (!referenceImagesEqual(a.referenceImages, b.referenceImages)) return false
  if (!billboardImagesEqual(a.billboardImages, b.billboardImages)) return false

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
      pixelDocuments[id] = clonePixelDocument(doc)
    }
  }

  return {
    objects: cloneSceneObjects(objects),
    objectTextures,
    pixelDocuments,
    referenceImages: cloneReferenceImages(snapshot.referenceImages ?? []),
    billboardImages: cloneBillboardImages(snapshot.billboardImages ?? []),
    selectedObjectId,
    selectionObjectIds,
    meshSelection: meshSelection
      ? {
          objectId: meshSelection.objectId,
          vertices: [...meshSelection.vertices],
          edges: [...meshSelection.edges],
          faces: [...meshSelection.faces],
        }
      : null,
  }
}

export function applySceneSnapshot(snapshot: SceneSnapshot): SceneSnapshot {
  return sanitizeSceneSnapshot(snapshot)
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

  /** Push a snapshot; skips if identical to the current head unless forced. Returns whether a new entry was added. */
  push(
    snapshot: SceneSnapshot,
    label?: string,
    options?: { force?: boolean }
  ): boolean {
    const previous = this.entries[this.index]?.snapshot
    const captured = captureSceneSnapshot(snapshot, previous)
    if (!options?.force && previous && snapshotsEqual(previous, captured)) return false

    const trimmed = this.entries.slice(0, this.index + 1)
    trimmed.push({ snapshot: captured, label })
    if (trimmed.length > this.maxDepth) trimmed.shift()
    this.entries = trimmed
    this.index = trimmed.length - 1
    return true
  }

  /** Replace the current history entry (e.g. commit a live preview). */
  replaceHead(snapshot: SceneSnapshot, label?: string): void {
    const previous = this.entries[this.index]?.snapshot
    const captured = captureSceneSnapshot(snapshot, previous)
    const next = [...this.entries]
    next[this.index] = { snapshot: captured, label: label ?? next[this.index]?.label }
    this.entries = next
  }

  undo(): SceneSnapshot | null {
    if (!this.canUndo) return null
    this.index -= 1
    return this.entries[this.index].snapshot
  }

  redo(): SceneSnapshot | null {
    if (!this.canRedo) return null
    this.index += 1
    return this.entries[this.index].snapshot
  }

  reset(snapshot: SceneSnapshot): void {
    this.entries = [{ snapshot: captureSceneSnapshot(snapshot), label: 'Initial' }]
    this.index = 0
  }

  allSnapshots(): SceneSnapshot[] {
    return this.entries.map((entry) => entry.snapshot)
  }
}
