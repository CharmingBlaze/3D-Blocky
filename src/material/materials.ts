import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { MeshComponentSelection } from '../mesh/meshSelection'
import type { SelectionMode } from '../store/appStore'
import { expandFacesToPlanarRegions } from '../mesh/faceGroups'
import {
  collectAllCornerRefs,
  collectCornerRefsForEdges,
  collectCornerRefsForFaces,
  collectCornerRefsForVertices,
  ensureObjectColors,
  setCornerColors,
  syncFaceColorsFromCorners,
  type SceneObjectWithColors,
} from './colorObject'
import type {
  ColorCornerRef,
  GradientHandle2D,
  Material,
  Rgba4,
} from './materialTypes'
import { cloneMaterial, defaultMaterial, rgba4ToNumber } from './materialTypes'
import {
  dominantBboxPlane,
  editorHandleToMeshPoint,
  lineGradientT,
  lerpGradientStops,
  radialGradientT,
  type GradientBbox,
} from './gradientLine'

export function ensureObjectMaterial(obj: SceneObject): SceneObject {
  if (obj.material) return obj
  return { ...obj, material: defaultMaterial(obj.color) }
}

export function resolveEffectiveMaterial(obj: SceneObject, faceIndex?: number): Material {
  const base = ensureObjectMaterial(obj).material!
  if (faceIndex !== undefined && obj.faceMaterials?.[faceIndex]) {
    return obj.faceMaterials[faceIndex]!
  }
  return base
}

export function resolveColorCornersForSelection(
  obj: SceneObject,
  selectionMode: SelectionMode,
  meshSelection: MeshComponentSelection | null,
  wholeObject: boolean
): ColorCornerRef[] {
  if (wholeObject || selectionMode === 'object') {
    return collectAllCornerRefs(obj)
  }
  if (!meshSelection || meshSelection.objectId !== obj.id) {
    return collectAllCornerRefs(obj)
  }
  if (selectionMode === 'face' && meshSelection.faces.length > 0) {
    const faces = expandFacesToPlanarRegions(obj, meshSelection.faces)
    return collectCornerRefsForFaces(obj, faces)
  }
  if (selectionMode === 'vertex' && meshSelection.vertices.length > 0) {
    return collectCornerRefsForVertices(obj, meshSelection.vertices)
  }
  if (selectionMode === 'edge' && meshSelection.edges.length > 0) {
    return collectCornerRefsForEdges(obj, meshSelection.edges)
  }
  return collectAllCornerRefs(obj)
}

function bboxForCorners(obj: SceneObject, refs: ColorCornerRef[]): GradientBbox {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const ref of refs) {
    const vi = obj.faces[ref.faceIndex]?.[ref.cornerIndex]
    const p = vi !== undefined ? obj.positions[vi] : undefined
    if (!p) continue
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    minZ = Math.min(minZ, p.z)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
    maxZ = Math.max(maxZ, p.z)
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1, cx: 0.5, cy: 0.5, cz: 0.5 }
  }
  return {
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    cz: (minZ + maxZ) / 2,
  }
}

export interface GradientLineSpec {
  start: GradientHandle2D
  end: GradientHandle2D
  radial: boolean
}

function gradientTForSpec(
  p: { x: number; y: number; z: number },
  box: GradientBbox,
  spec: GradientLineSpec
): number {
  const plane = dominantBboxPlane(box)
  const start3 = editorHandleToMeshPoint(spec.start, box, plane)
  const end3 = editorHandleToMeshPoint(spec.end, box, plane)
  if (spec.radial) return radialGradientT(p, start3, end3)
  return lineGradientT(p, start3, end3)
}

/** Apply solid RGBA to specific face corners (decoupled indexing). */
export function applySolidColor(
  obj: SceneObject,
  cornerRefs: ColorCornerRef[],
  rgba: Rgba4
): SceneObject {
  if (cornerRefs.length === 0) return obj
  let next = ensureObjectMaterial(obj)
  const updates = cornerRefs.map((ref) => ({ ...ref, rgba }))
  next = setCornerColors(next, updates)

  const faceSet = new Set(cornerRefs.map((r) => r.faceIndex))
  const faceMaterials = [...(next.faceMaterials ?? Array(next.faces.length).fill(null))]
  while (faceMaterials.length < next.faces.length) faceMaterials.push(null)
  for (const fi of faceSet) {
    faceMaterials[fi] = {
      mode: 'solid',
      solidColor: [...rgba] as Rgba4,
      opacity: rgba[3],
      doubleSided: next.material?.doubleSided ?? false,
    }
  }

  return {
    ...next,
    material: { ...next.material!, mode: 'solid', solidColor: [...rgba] as Rgba4 },
    faceMaterials,
  }
}

/** Apply a gradient across corner refs using draggable editor handles. */
export function applyGradient(
  obj: SceneObject,
  cornerRefs: ColorCornerRef[],
  line: GradientLineSpec,
  stops: Rgba4[]
): SceneObject {
  if (cornerRefs.length === 0 || stops.length === 0) return obj
  let next = ensureObjectMaterial(obj)
  const box = bboxForCorners(next, cornerRefs)
  const updates: Array<{ faceIndex: number; cornerIndex: number; rgba: Rgba4 }> = []

  for (const ref of cornerRefs) {
    const vi = next.faces[ref.faceIndex]?.[ref.cornerIndex]
    const p = vi !== undefined ? next.positions[vi] : undefined
    if (!p) continue
    const t = gradientTForSpec(p, box, line)
    updates.push({ ...ref, rgba: lerpGradientStops(stops, t) })
  }

  next = setCornerColors(next, updates)
  const faceSet = new Set(cornerRefs.map((r) => r.faceIndex))
  const faceMaterials = [...(next.faceMaterials ?? Array(next.faces.length).fill(null))]
  while (faceMaterials.length < next.faces.length) faceMaterials.push(null)
  for (const fi of faceSet) {
    faceMaterials[fi] = {
      mode: 'vertexGradient',
      opacity: next.material?.opacity ?? 1,
      doubleSided: next.material?.doubleSided ?? false,
    }
  }

  return {
    ...next,
    material: { ...next.material!, mode: 'vertexGradient' },
    faceMaterials,
  }
}

export function setObjectMaterial(
  obj: SceneObject,
  faceIndices: number[] | 'object',
  material: Material
): SceneObject {
  let next = ensureObjectMaterial(obj)
  const mat = cloneMaterial(material)

  if (faceIndices === 'object') {
    return { ...next, material: mat, faceMaterials: undefined }
  }

  const faceMaterials = [...(next.faceMaterials ?? Array(next.faces.length).fill(null))]
  while (faceMaterials.length < next.faces.length) faceMaterials.push(null)
  for (const fi of faceIndices) {
    if (fi >= 0 && fi < faceMaterials.length) faceMaterials[fi] = cloneMaterial(mat)
  }
  return { ...next, faceMaterials }
}

export function readSelectionDisplayColor(obj: SceneObject): Rgba4 {
  const mat = ensureObjectMaterial(obj).material!
  if (mat.solidColor) return [...mat.solidColor] as Rgba4
  return [
    ((obj.color >> 16) & 255) / 255,
    ((obj.color >> 8) & 255) / 255,
    (obj.color & 255) / 255,
    mat.opacity,
  ]
}

export function materialUsesTexture(obj: SceneObject, faceIndex?: number): boolean {
  return resolveEffectiveMaterial(obj, faceIndex).mode === 'texture'
}

export function materialUsesVertexColors(obj: SceneObject, faceIndex?: number): boolean {
  const mode = resolveEffectiveMaterial(obj, faceIndex).mode
  return mode === 'solid' || mode === 'vertexGradient'
}

/** Split shared corner color indices so adjacent faces can hold different colors. */
export function splitCornerColorsAtFaces(obj: SceneObject, faceIndices: number[]): SceneObject {
  const ensured = ensureObjectColors(obj) as SceneObjectWithColors
  const cornerColors = ensured.cornerColors.map((c) => [...c] as Rgba4)
  const faceColorIndices = ensured.faceColorIndices.map((f) => [...f])

  for (const fi of faceIndices) {
    const indices = faceColorIndices[fi]
    if (!indices) continue
    for (let ci = 0; ci < indices.length; ci++) {
      const oldIdx = indices[ci]!
      const color = cornerColors[oldIdx]!
      indices[ci] = cornerColors.length
      cornerColors.push([...color] as Rgba4)
    }
  }

  const faceColors = syncFaceColorsFromCorners({
    ...ensured,
    cornerColors,
    faceColorIndices,
  })

  return { ...ensured, cornerColors, faceColorIndices, faceColors }
}

export function applySolidColorUniquePerFace(
  obj: SceneObject,
  cornerRefs: ColorCornerRef[],
  rgba: Rgba4
): SceneObject {
  const faceIndices = [...new Set(cornerRefs.map((r) => r.faceIndex))]
  let next = splitCornerColorsAtFaces(obj, faceIndices)
  return applySolidColor(next, cornerRefs, rgba)
}

export function cornerRefsToAverageHex(refs: ColorCornerRef[], obj: SceneObject): number {
  if (refs.length === 0) return obj.color
  const ensured = ensureObjectColors(obj)
  let r = 0
  let g = 0
  let b = 0
  for (const ref of refs) {
    const idx = ensured.faceColorIndices[ref.faceIndex]?.[ref.cornerIndex] ?? 0
    const c = ensured.cornerColors[idx] ?? [1, 1, 1, 1]
    r += c[0]
    g += c[1]
    b += c[2]
  }
  const n = refs.length
  return rgba4ToNumber([r / n, g / n, b / n, 1])
}
