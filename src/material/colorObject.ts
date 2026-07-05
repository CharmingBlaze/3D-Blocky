import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { Rgba4 } from './materialTypes'

export type CornerColor = Rgba4

export type SceneObjectWithColors = SceneObject & {
  cornerColors: CornerColor[]
  faceColorIndices: number[][]
}

export function cloneRgba4(c: Rgba4): Rgba4 {
  return [c[0], c[1], c[2], c[3]]
}

export function rgba4Equal(a: Rgba4, b: Rgba4, eps = 1e-4): boolean {
  return (
    Math.abs(a[0] - b[0]) < eps &&
    Math.abs(a[1] - b[1]) < eps &&
    Math.abs(a[2] - b[2]) < eps &&
    Math.abs(a[3] - b[3]) < eps
  )
}

/** Ensure decoupled corner-color pool exists, migrated from legacy per-face hex colors. */
export function ensureObjectColors(obj: SceneObject): SceneObjectWithColors {
  if (obj.cornerColors?.length && obj.faceColorIndices?.length === obj.faces.length) {
    return obj as SceneObjectWithColors
  }

  const cornerColors: CornerColor[] = []
  const faceColorIndices: number[][] = []

  for (let fi = 0; fi < obj.faces.length; fi++) {
    const hex = obj.faceColors[fi] ?? obj.color
    const rgba: Rgba4 = [
      ((hex >> 16) & 255) / 255,
      ((hex >> 8) & 255) / 255,
      (hex & 255) / 255,
      obj.material?.opacity ?? 1,
    ]
    const indices: number[] = []
    const face = obj.faces[fi] ?? []
    for (let ci = 0; ci < face.length; ci++) {
      indices.push(cornerColors.length)
      cornerColors.push(cloneRgba4(rgba))
    }
    faceColorIndices.push(indices)
  }

  return {
    ...obj,
    cornerColors,
    faceColorIndices,
  }
}

export function cloneObjectColors(obj: SceneObject): {
  cornerColors?: CornerColor[]
  faceColorIndices?: number[][]
} {
  return {
    cornerColors: obj.cornerColors?.map(cloneRgba4),
    faceColorIndices: obj.faceColorIndices?.map((f) => [...f]),
  }
}

export function getCornerColor(obj: SceneObject, faceIndex: number, cornerIndex: number): Rgba4 {
  const ensured = ensureObjectColors(obj)
  const poolIdx = ensured.faceColorIndices[faceIndex]?.[cornerIndex] ?? 0
  return cloneRgba4(ensured.cornerColors[poolIdx] ?? [1, 1, 1, 1])
}

export function setCornerColors(
  obj: SceneObject,
  updates: Array<{ faceIndex: number; cornerIndex: number; rgba: Rgba4 }>
): SceneObject {
  if (updates.length === 0) return obj
  const ensured = ensureObjectColors(obj)
  const cornerColors = ensured.cornerColors.map(cloneRgba4)
  const faceColorIndices = ensured.faceColorIndices.map((f) => [...f])

  for (const { faceIndex, cornerIndex, rgba } of updates) {
    const poolIdx = faceColorIndices[faceIndex]?.[cornerIndex]
    if (poolIdx === undefined) continue
    cornerColors[poolIdx] = cloneRgba4(rgba)
  }

  const faceColors = syncFaceColorsFromCorners({
    ...ensured,
    cornerColors,
    faceColorIndices,
  })

  return { ...ensured, cornerColors, faceColorIndices, faceColors }
}

/** Average corner colors back to per-face hex for legacy paths. */
export function syncFaceColorsFromCorners(obj: SceneObjectWithColors): number[] {
  const faceColors: number[] = []
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const indices = obj.faceColorIndices[fi] ?? []
    if (indices.length === 0) {
      faceColors.push(obj.color)
      continue
    }
    let r = 0
    let g = 0
    let b = 0
    for (const ci of indices) {
      const c = obj.cornerColors[ci] ?? [1, 1, 1, 1]
      r += c[0]
      g += c[1]
      b += c[2]
    }
    const n = indices.length
    const ri = Math.round((r / n) * 255)
    const gi = Math.round((g / n) * 255)
    const bi = Math.round((b / n) * 255)
    faceColors.push((ri << 16) | (gi << 8) | bi)
  }
  return faceColors
}

export function collectCornerRefsForFaces(obj: SceneObject, faceIndices: number[]) {
  const refs: Array<{ faceIndex: number; cornerIndex: number }> = []
  for (const fi of faceIndices) {
    const face = obj.faces[fi]
    if (!face) continue
    for (let ci = 0; ci < face.length; ci++) refs.push({ faceIndex: fi, cornerIndex: ci })
  }
  return refs
}

export function collectCornerRefsForVertices(obj: SceneObject, vertexIndices: number[]) {
  const set = new Set(vertexIndices)
  const refs: Array<{ faceIndex: number; cornerIndex: number }> = []
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const face = obj.faces[fi] ?? []
    for (let ci = 0; ci < face.length; ci++) {
      if (set.has(face[ci]!)) refs.push({ faceIndex: fi, cornerIndex: ci })
    }
  }
  return refs
}

export function collectCornerRefsForEdges(obj: SceneObject, edgeKeys: string[]) {
  const refs: Array<{ faceIndex: number; cornerIndex: number }> = []
  const seen = new Set<string>()
  for (const key of edgeKeys) {
    const [a, b] = key.split('-').map(Number)
    for (let fi = 0; fi < obj.faces.length; fi++) {
      const face = obj.faces[fi] ?? []
      for (let ci = 0; ci < face.length; ci++) {
        const vi = face[ci]!
        const vj = face[(ci + 1) % face.length]!
        if ((vi === a && vj === b) || (vi === b && vj === a)) {
          const k = `${fi}:${ci}`
          if (!seen.has(k)) {
            seen.add(k)
            refs.push({ faceIndex: fi, cornerIndex: ci })
          }
        }
      }
    }
  }
  return refs
}

export function collectAllCornerRefs(obj: SceneObject) {
  return collectCornerRefsForFaces(
    obj,
    obj.faces.map((_, i) => i)
  )
}
