import type { Uv2 } from './uvTypes'

export interface UvBounds {
  minU: number
  minV: number
  maxU: number
  maxV: number
}

export function uvBoundsFromIndices(uvs: Uv2[], indices: number[]): UvBounds {
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  for (const i of indices) {
    const uv = uvs[i]
    if (!uv) continue
    minU = Math.min(minU, uv.u)
    minV = Math.min(minV, uv.v)
    maxU = Math.max(maxU, uv.u)
    maxV = Math.max(maxV, uv.v)
  }
  if (!Number.isFinite(minU)) return { minU: 0, minV: 0, maxU: 1, maxV: 1 }
  return { minU, minV, maxU, maxV }
}

export function uvBoundsCenter(b: UvBounds): Uv2 {
  return { u: (b.minU + b.maxU) / 2, v: (b.minV + b.maxV) / 2 }
}

export function translateUVs(uvs: Uv2[], indices: number[], du: number, dv: number): void {
  for (const i of indices) {
    const uv = uvs[i]
    if (!uv) continue
    uv.u += du
    uv.v += dv
  }
}

export function flipUVsHorizontal(uvs: Uv2[], indices: number[]): void {
  const b = uvBoundsFromIndices(uvs, indices)
  const cx = (b.minU + b.maxU) / 2
  for (const i of indices) {
    const uv = uvs[i]
    if (!uv) continue
    uv.u = cx - (uv.u - cx)
  }
}

export function flipUVsVertical(uvs: Uv2[], indices: number[]): void {
  const b = uvBoundsFromIndices(uvs, indices)
  const cy = (b.minV + b.maxV) / 2
  for (const i of indices) {
    const uv = uvs[i]
    if (!uv) continue
    uv.v = cy - (uv.v - cy)
  }
}

export function rotateUVs90(uvs: Uv2[], indices: number[], clockwise: boolean): void {
  const b = uvBoundsFromIndices(uvs, indices)
  const pivot = uvBoundsCenter(b)
  const angle = clockwise ? -Math.PI / 2 : Math.PI / 2
  rotateUVsBy(uvs, indices, angle, pivot)
}

export function rotateUVsBy(uvs: Uv2[], indices: number[], angleRad: number, pivot: Uv2): void {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  for (const i of indices) {
    const uv = uvs[i]
    if (!uv) continue
    const du = uv.u - pivot.u
    const dv = uv.v - pivot.v
    uv.u = pivot.u + du * cos - dv * sin
    uv.v = pivot.v + du * sin + dv * cos
  }
}

/** Scale copied UV coords (for live edge-resize previews from a fixed snapshot). */
export function scaleUvSnapshot(
  startUvs: Uv2[],
  scaleU: number,
  scaleV: number,
  pivot: Uv2
): Uv2[] {
  return startUvs.map(({ u, v }) => ({
    u: pivot.u + (u - pivot.u) * scaleU,
    v: pivot.v + (v - pivot.v) * scaleV,
  }))
}

/** Rotate copied UV coords (for live drag previews from a fixed snapshot). */
export function rotateUvSnapshot(
  startUvs: Uv2[],
  angleRad: number,
  pivot: Uv2
): Uv2[] {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  return startUvs.map(({ u, v }) => {
    const du = u - pivot.u
    const dv = v - pivot.v
    return {
      u: pivot.u + du * cos - dv * sin,
      v: pivot.v + du * sin + dv * cos,
    }
  })
}

export function scaleUVsFromCenter(
  uvs: Uv2[],
  indices: number[],
  scaleU: number,
  scaleV: number,
  pivot?: Uv2
): void {
  const b = uvBoundsFromIndices(uvs, indices)
  const p = pivot ?? uvBoundsCenter(b)
  for (const i of indices) {
    const uv = uvs[i]
    if (!uv) continue
    uv.u = p.u + (uv.u - p.u) * scaleU
    uv.v = p.v + (uv.v - p.v) * scaleV
  }
}

export function fitUVsToUnitSquare(uvs: Uv2[], indices: number[]): void {
  const b = uvBoundsFromIndices(uvs, indices)
  const w = b.maxU - b.minU || 1
  const h = b.maxV - b.minV || 1
  for (const i of indices) {
    const uv = uvs[i]
    if (!uv) continue
    uv.u = (uv.u - b.minU) / w
    uv.v = (uv.v - b.minV) / h
  }
}

/**
 * Fit UVs into a target square using uniform scale so view/screen proportions are preserved.
 * Degenerate (near-zero) extents fall back to a stable 0-size placement at the origin.
 */
export function fitUVsAspectPreserving(
  uvs: Uv2[],
  indices: number[],
  targetSize = 1,
  padding = 0
): void {
  if (indices.length === 0) return
  const b = uvBoundsFromIndices(uvs, indices)
  const w = b.maxU - b.minU
  const h = b.maxV - b.minV
  const avail = Math.max(targetSize - padding * 2, 1e-8)
  const span = Math.max(w, h, 1e-12)
  const scale = avail / span
  const outW = w * scale
  const outH = h * scale
  const offsetU = padding + (avail - outW) / 2
  const offsetV = padding + (avail - outH) / 2
  for (const i of indices) {
    const uv = uvs[i]
    if (!uv) continue
    uv.u = offsetU + (uv.u - b.minU) * scale
    uv.v = offsetV + (uv.v - b.minV) * scale
  }
}

/** Spread each face island into a grid within 0–1 UV space (non-overlapping atlas layout). */
export function packFaceUvIslands(uvs: Uv2[], faceUvIndices: number[][]): void {
  const faceCount = faceUvIndices.length
  if (faceCount === 0) return

  const cols = Math.ceil(Math.sqrt(faceCount))
  const rows = Math.ceil(faceCount / cols)
  const cellW = 1 / cols
  const cellH = 1 / rows

  for (let fi = 0; fi < faceCount; fi++) {
    const uvIndices = faceUvIndices[fi] ?? []
    if (uvIndices.length === 0) continue
    fitUVsToUnitSquare(uvs, uvIndices)
    scaleUVsFromCenter(uvs, uvIndices, cellW, cellH, { u: 0, v: 0 })
    const col = fi % cols
    const row = Math.floor(fi / cols)
    translateUVs(uvs, uvIndices, col * cellW, row * cellH)
  }
}

/** Blockbench / Piccad-style 4×3 cross atlas slot for a face normal bucket. */
export type UvNormalBucket = '+x' | '-x' | '+y' | '-y' | '+z' | '-z'

export const BLOCKBENCH_ATLAS_COLS = 4
export const BLOCKBENCH_ATLAS_ROWS = 3

export const BLOCKBENCH_SLOTS: Record<UvNormalBucket, { col: number; row: number; label: string }> = {
  '+y': { col: 1, row: 0, label: 'Up' },
  '-y': { col: 1, row: 2, label: 'Down' },
  '-x': { col: 0, row: 1, label: 'Left' },
  '+z': { col: 1, row: 1, label: 'Front' },
  '+x': { col: 2, row: 1, label: 'Right' },
  '-z': { col: 3, row: 1, label: 'Back' },
}

export function classifyFaceNormalBucket(n: { x: number; y: number; z: number }): UvNormalBucket {
  const ax = Math.abs(n.x)
  const ay = Math.abs(n.y)
  const az = Math.abs(n.z)
  if (ay >= ax && ay >= az) return n.y >= 0 ? '+y' : '-y'
  if (az >= ax && az >= ay) return n.z >= 0 ? '+z' : '-z'
  return n.x >= 0 ? '+x' : '-x'
}

/** Pack face islands into a Blockbench-style directional cross (4×3 atlas). */
export function packFaceUvIslandsBlockbench(
  uvs: Uv2[],
  faceUvIndices: number[][],
  faceNormals: { x: number; y: number; z: number }[],
  margin = 0.04
): void {
  const buckets = new Map<UvNormalBucket, number[]>()
  for (let fi = 0; fi < faceUvIndices.length; fi++) {
    const bucket = classifyFaceNormalBucket(faceNormals[fi] ?? { x: 0, y: 1, z: 0 })
    const list = buckets.get(bucket) ?? []
    list.push(fi)
    buckets.set(bucket, list)
  }

  const cellW = 1 / BLOCKBENCH_ATLAS_COLS
  const cellH = 1 / BLOCKBENCH_ATLAS_ROWS
  const innerW = cellW * (1 - margin * 2)
  const innerH = cellH * (1 - margin * 2)

  for (const [bucket, faceIndices] of buckets) {
    const slot = BLOCKBENCH_SLOTS[bucket]
    const baseU = slot.col * cellW + cellW * margin
    const baseV = 1 - (slot.row + 1) * cellH + cellH * margin

    const count = faceIndices.length
    const subCols = Math.max(1, Math.ceil(Math.sqrt(count)))
    const subRows = Math.ceil(count / subCols)
    const subW = innerW / subCols
    const subH = innerH / subRows

    faceIndices.forEach((fi, idx) => {
      const uvIndices = faceUvIndices[fi] ?? []
      if (uvIndices.length === 0) return
      fitUVsToUnitSquare(uvs, uvIndices)
      scaleUVsFromCenter(uvs, uvIndices, subW, subH, { u: 0, v: 0 })
      const subCol = idx % subCols
      const subRow = Math.floor(idx / subCols)
      translateUVs(uvs, uvIndices, baseU + subCol * subW, baseV + subRow * subH)
    })
  }
}

export function blockbenchSlotLabelCenters(): { label: string; u: number; v: number }[] {
  const cellW = 1 / BLOCKBENCH_ATLAS_COLS
  const cellH = 1 / BLOCKBENCH_ATLAS_ROWS
  return Object.values(BLOCKBENCH_SLOTS).map((slot) => ({
    label: slot.label,
    u: (slot.col + 0.5) * cellW,
    v: 1 - (slot.row + 0.5) * cellH,
  }))
}

/** Planar projection of 3D face corners onto axes most perpendicular to the face normal. */
export function planarProjectFaceUVs(
  faceNormal: { x: number; y: number; z: number },
  faceCorners3D: { x: number; y: number; z: number }[]
): Uv2[] {
  const n = faceNormal
  const ax = Math.abs(n.x)
  const ay = Math.abs(n.y)
  const az = Math.abs(n.z)

  let uAxis: 'x' | 'y' | 'z' = 'x'
  let vAxis: 'x' | 'y' | 'z' = 'y'
  if (ax >= ay && ax >= az) {
    uAxis = 'y'
    vAxis = 'z'
  } else if (ay >= ax && ay >= az) {
    uAxis = 'x'
    vAxis = 'z'
  } else {
    uAxis = 'x'
    vAxis = 'y'
  }

  const raw = faceCorners3D.map((p) => ({
    u: p[uAxis],
    v: p[vAxis],
  }))

  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  for (const p of raw) {
    minU = Math.min(minU, p.u)
    minV = Math.min(minV, p.v)
    maxU = Math.max(maxU, p.u)
    maxV = Math.max(maxV, p.v)
  }
  const w = maxU - minU || 1
  const h = maxV - minV || 1
  return raw.map((p) => ({ u: (p.u - minU) / w, v: (p.v - minV) / h }))
}

export function snapUvToGrid(uv: Uv2, divisions: number): Uv2 {
  const step = 1 / divisions
  return {
    u: Math.round(uv.u / step) * step,
    v: Math.round(uv.v / step) * step,
  }
}

export function uvToPixel(uv: Uv2, texW: number, texH: number): { x: number; y: number } {
  return { x: uv.u * texW, y: (1 - uv.v) * texH }
}

/** Pixel coords with origin top-left (Blockbench-style display). */
export function pixelToUv(px: number, py: number, texW: number, texH: number): Uv2 {
  return { u: px / texW, v: 1 - py / texH }
}
