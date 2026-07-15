import {
  fitUVsToUnitSquare,
  translateUVs,
  uvBoundsFromIndices,
  uvBoundsCenter,
  scaleUVsFromCenter,
  type UvBounds,
  type UvNormalBucket,
  BLOCKBENCH_SLOTS,
} from './uvEditing'
import type { Uv2 } from './uvTypes'
import { cloneUv2 } from './uvTypes'

export interface UvIslandSlot {
  /** UV point indices belonging exclusively to this island. */
  uvIndices: number[]
  width: number
  height: number
}

/** Give each island its own UV index copies so packing one island never moves another. */
export function splitUvIslandsForPacking(
  uvs: Uv2[],
  faceUvIndices: number[][],
  islands: number[][]
): void {
  for (const islandFaces of islands) {
    const uiMap = new Map<number, number>()
    for (const fi of islandFaces) {
      const uvIdx = faceUvIndices[fi]
      if (!uvIdx) continue
      for (let i = 0; i < uvIdx.length; i++) {
        const oldUi = uvIdx[i]
        if (oldUi === undefined) continue
        let newUi = uiMap.get(oldUi)
        if (newUi === undefined) {
          newUi = uvs.length
          uvs.push(cloneUv2(uvs[oldUi] ?? { u: 0, v: 0 }))
          uiMap.set(oldUi, newUi)
        }
        uvIdx[i] = newUi
      }
    }
  }
}

function islandBounds(uvs: Uv2[], uvIndices: number[]): { width: number; height: number } {
  const b = uvBoundsFromIndices(uvs, uvIndices)
  return {
    width: Math.max(b.maxU - b.minU, 1e-8),
    height: Math.max(b.maxV - b.minV, 1e-8),
  }
}

function collectIndices(faceUvIndices: number[][], faceList: number[]): number[] {
  const set = new Set<number>()
  for (const fi of faceList) {
    for (const ui of faceUvIndices[fi] ?? []) set.add(ui)
  }
  return [...set]
}

/**
 * Shelf / row packing for UV islands within 0–1 atlas space.
 * Sort tallest-first, fill left-to-right, wrap rows when out of horizontal space.
 */
export function packUvIslandsShelf(
  uvs: Uv2[],
  islands: UvIslandSlot[],
  atlasSize = 1,
  margin = 0.02
): void {
  if (islands.length === 0) return

  const slots = islands.map((island) => {
    fitUVsToUnitSquare(uvs, island.uvIndices)
    const { width, height } = islandBounds(uvs, island.uvIndices)
    return { island, width, height }
  })

  slots.sort((a, b) => b.height - a.height)

  const inner = atlasSize - margin * 2
  let x = margin
  let y = margin
  let rowHeight = 0

  for (const slot of slots) {
    const slotW = slot.width * inner
    const slotH = slot.height * inner

    if (x + slotW + margin > atlasSize && x > margin) {
      x = margin
      y += rowHeight + margin
      rowHeight = 0
    }

    const b = uvBoundsFromIndices(uvs, slot.island.uvIndices)
    translateUVs(uvs, slot.island.uvIndices, x - b.minU, y - b.minV)

    const scaleU = slotW / slot.width
    const scaleV = slotH / slot.height
    const scale = Math.min(scaleU, scaleV)
    const pivot = { u: x, v: y }
    for (const ui of slot.island.uvIndices) {
      const uv = uvs[ui]
      if (!uv) continue
      uv.u = pivot.u + (uv.u - pivot.u) * scale
      uv.v = pivot.v + (uv.v - pivot.v) * scale
    }

    x += slotW + margin
    rowHeight = Math.max(rowHeight, slotH)
  }
}

/** Build island slots from face groups and run shelf packing. */
export function packFaceIslandsShelf(
  uvs: Uv2[],
  faceUvIndices: number[][],
  islands: number[][],
  margin = 0.02,
  atlasSize = 1
): void {
  if (islands.length === 0) return
  if (islands.length === 1) {
    const uvIndices = collectIndices(faceUvIndices, islands[0])
    fitUVsToUnitSquare(uvs, uvIndices)
    const b = uvBoundsFromIndices(uvs, uvIndices)
    const pad = margin
    const avail = atlasSize - pad * 2
    const w = b.maxU - b.minU || 1
    const h = b.maxV - b.minV || 1
    const scale = Math.min(avail / w, avail / h)
    for (const ui of uvIndices) {
      const uv = uvs[ui]
      if (!uv) continue
      uv.u = pad + (uv.u - b.minU) * scale
      uv.v = pad + (uv.v - b.minV) * scale
    }
    return
  }

  splitUvIslandsForPacking(uvs, faceUvIndices, islands)

  const slots: UvIslandSlot[] = islands.map((faceList) => {
    const uvIndices = collectIndices(faceUvIndices, faceList)
    return { uvIndices, width: 1, height: 1 }
  })

  packUvIslandsShelf(uvs, slots, atlasSize, margin)
}

/**
 * Region-strip packing: one horizontal band of islands (equal height, width ∝ aspect).
 * Visibly different from shelf wrap — even a single island sits as a bottom strip, not a full-atlas square.
 */
export function packFaceIslandsRegionStrip(
  uvs: Uv2[],
  faceUvIndices: number[][],
  islands: number[][],
  margin = 0.02,
  atlasSize = 1
): void {
  if (islands.length === 0) return
  if (islands.length > 1) {
    splitUvIslandsForPacking(uvs, faceUvIndices, islands)
  }

  const prepared = islands.map((faceList) => {
    const uvIndices = collectIndices(faceUvIndices, faceList)
    fitUVsToUnitSquare(uvs, uvIndices)
    const { width, height } = islandBounds(uvs, uvIndices)
    const aspect = width / height
    return { uvIndices, aspect }
  })

  const bandH = Math.min(atlasSize * 0.42, atlasSize - margin * 2)
  const innerW = atlasSize - margin * 2
  const gap = margin
  const totalAspect = prepared.reduce((s, p) => s + p.aspect, 0) || 1
  const usableW = innerW - gap * Math.max(0, prepared.length - 1)

  let x = margin
  const y = margin
  for (const part of prepared) {
    const cellW = (usableW * part.aspect) / totalAspect
    const b = uvBoundsFromIndices(uvs, part.uvIndices)
    const w = b.maxU - b.minU || 1
    const h = b.maxV - b.minV || 1
    const scale = Math.min(cellW / w, bandH / h)
    for (const ui of part.uvIndices) {
      const uv = uvs[ui]
      if (!uv) continue
      uv.u = x + (uv.u - b.minU) * scale
      uv.v = y + (uv.v - b.minV) * scale
    }
    x += cellW + gap
  }
}

/**
 * Uniform grid pack.
 * - `columns: 'sqrt'` (default): ceil(sqrt(n)) — used by Planar per Face (aspect-fit).
 * - `columns: 'row'`: single horizontal strip — used by Lightmap (stretch-fill).
 * Stretch fills each cell; aspect-fit letterboxes inside the cell.
 */
export function packFaceIslandsUniformGrid(
  uvs: Uv2[],
  faceUvIndices: number[][],
  islands: number[][],
  margin = 0.02,
  options?: { stretch?: boolean; atlasSize?: number; columns?: 'sqrt' | 'row' }
): void {
  if (islands.length === 0) return
  const atlasSize = options?.atlasSize ?? 1
  const stretch = options?.stretch ?? false
  const columnMode = options?.columns ?? 'sqrt'

  if (islands.length === 1 && !stretch && columnMode === 'sqrt') {
    packFaceIslandsShelf(uvs, faceUvIndices, islands, margin, atlasSize)
    return
  }

  splitUvIslandsForPacking(uvs, faceUvIndices, islands)

  const cols =
    columnMode === 'row'
      ? Math.max(1, islands.length)
      : Math.max(1, Math.ceil(Math.sqrt(islands.length)))
  const rows = Math.max(1, Math.ceil(islands.length / cols))
  const cellW = atlasSize / cols
  const cellH = atlasSize / rows
  // Lightmap uses tighter padding so stretch cells read as packed bake charts.
  const padScale = stretch ? margin * 0.5 : margin
  const padU = cellW * padScale
  const padV = cellH * padScale
  const innerW = Math.max(cellW - padU * 2, 1e-8)
  const innerH = Math.max(cellH - padV * 2, 1e-8)

  for (let i = 0; i < islands.length; i++) {
    const uvIndices = collectIndices(faceUvIndices, islands[i]!)
    if (uvIndices.length === 0) continue
    fitUVsToUnitSquare(uvs, uvIndices)
    const b = uvBoundsFromIndices(uvs, uvIndices)
    const w = b.maxU - b.minU || 1
    const h = b.maxV - b.minV || 1
    const col = i % cols
    const row = Math.floor(i / cols)
    const baseU = col * cellW + padU
    const baseV = atlasSize - (row + 1) * cellH + padV
    const scaleU = innerW / w
    const scaleV = innerH / h
    const scale = stretch ? 1 : Math.min(scaleU, scaleV)
    const usedScaleU = stretch ? scaleU : scale
    const usedScaleV = stretch ? scaleV : scale
    for (const ui of uvIndices) {
      const uv = uvs[ui]
      if (!uv) continue
      uv.u = baseU + (uv.u - b.minU) * usedScaleU
      uv.v = baseV + (uv.v - b.minV) * usedScaleV
    }
  }
}

/** Minecraft-inspired cube-net cells in local net units (width=2(x+z), height=z+y). */
export type BoxNetSize = { x: number; y: number; z: number }

export function boxNetCellRect(
  bucket: UvNormalBucket,
  size: BoxNetSize
): { x: number; y: number; w: number; h: number } {
  const { x, y, z } = size
  switch (bucket) {
    case '+y':
      return { x: z, y: 0, w: x, h: z }
    case '-y':
      return { x: z + x, y: 0, w: x, h: z }
    case '+x':
      return { x: 0, y: z, w: z, h: y }
    case '-x':
      return { x: z + x, y: z, w: z, h: y }
    case '-z':
      return { x: z, y: z, w: x, h: y }
    case '+z':
      return { x: z + x + z, y: z, w: x, h: y }
  }
}

/**
 * Place normal-bucket islands into a cube-net layout (AABB-sized).
 * Works for any low-poly mesh — organic faces land in the nearest direction cell.
 */
export function packFaceIslandsBoxNet(
  uvs: Uv2[],
  faceUvIndices: number[][],
  bucketIslands: { bucket: UvNormalBucket; faces: number[] }[],
  size: BoxNetSize,
  margin = 0.03,
  atlasSize = 1
): void {
  if (bucketIslands.length === 0) return
  splitUvIslandsForPacking(
    uvs,
    faceUvIndices,
    bucketIslands.map((b) => b.faces)
  )

  const sx = Math.max(size.x, 1e-6)
  const sy = Math.max(size.y, 1e-6)
  const sz = Math.max(size.z, 1e-6)
  const netW = 2 * (sx + sz)
  const netH = sz + sy
  const pad = margin
  const scaleNet = Math.min((atlasSize - pad * 2) / netW, (atlasSize - pad * 2) / netH)
  const originU = pad + ((atlasSize - pad * 2) - netW * scaleNet) * 0.5
  const originV = pad + ((atlasSize - pad * 2) - netH * scaleNet) * 0.5

  for (const { bucket, faces } of bucketIslands) {
    if (faces.length === 0) continue
    const uvIndices = collectIndices(faceUvIndices, faces)
    if (uvIndices.length === 0) continue
    const cell = boxNetCellRect(bucket, { x: sx, y: sy, z: sz })
    const cellU = originU + cell.x * scaleNet
    const cellV = originV + (netH - cell.y - cell.h) * scaleNet
    const cellW = Math.max(cell.w * scaleNet, 1e-8)
    const cellH = Math.max(cell.h * scaleNet, 1e-8)
    const inset = Math.min(cellW, cellH) * 0.06

    fitUVsToUnitSquare(uvs, uvIndices)
    const b = uvBoundsFromIndices(uvs, uvIndices)
    const w = b.maxU - b.minU || 1
    const h = b.maxV - b.minV || 1
    const innerW = Math.max(cellW - inset * 2, 1e-8)
    const innerH = Math.max(cellH - inset * 2, 1e-8)
    const scale = Math.min(innerW / w, innerH / h)
    for (const ui of uvIndices) {
      const uv = uvs[ui]
      if (!uv) continue
      uv.u = cellU + inset + (uv.u - b.minU) * scale
      uv.v = cellV + inset + (uv.v - b.minV) * scale
    }
  }
}

/**
 * Direction atlas: each face alone inside its normal's 4×3 cross slot (subgrid).
 * Paint-friendly — every face gets its own texel island.
 */
export function packFacesDirectionAtlas(
  uvs: Uv2[],
  faceUvIndices: number[][],
  faceBuckets: { fi: number; bucket: UvNormalBucket }[],
  margin = 0.04,
  atlasCols = 4,
  atlasRows = 3
): void {
  if (faceBuckets.length === 0) return
  splitUvIslandsForPacking(
    uvs,
    faceUvIndices,
    faceBuckets.map(({ fi }) => [fi])
  )

  const byBucket = new Map<UvNormalBucket, number[]>()
  for (const { fi, bucket } of faceBuckets) {
    const list = byBucket.get(bucket) ?? []
    list.push(fi)
    byBucket.set(bucket, list)
  }

  const cellW = 1 / atlasCols
  const cellH = 1 / atlasRows

  for (const [bucket, faces] of byBucket) {
    const slot = BLOCKBENCH_SLOTS[bucket]
    const baseU = slot.col * cellW + cellW * margin
    const baseV = 1 - (slot.row + 1) * cellH + cellH * margin
    const innerW = cellW * (1 - margin * 2)
    const innerH = cellH * (1 - margin * 2)
    const subCols = Math.max(1, Math.ceil(Math.sqrt(faces.length)))
    const subRows = Math.ceil(faces.length / subCols)
    const subW = innerW / subCols
    const subH = innerH / subRows

    faces.forEach((fi, idx) => {
      const uvIndices = collectIndices(faceUvIndices, [fi])
      if (uvIndices.length === 0) return
      fitUVsToUnitSquare(uvs, uvIndices)
      const b = uvBoundsFromIndices(uvs, uvIndices)
      const w = b.maxU - b.minU || 1
      const h = b.maxV - b.minV || 1
      const col = idx % subCols
      const row = Math.floor(idx / subCols)
      const padU = subW * 0.08
      const padV = subH * 0.08
      const scale = Math.min((subW - padU * 2) / w, (subH - padV * 2) / h)
      const ox = baseU + col * subW + padU
      const oy = baseV + (subRows - 1 - row) * subH + padV
      for (const ui of uvIndices) {
        const uv = uvs[ui]
        if (!uv) continue
        uv.u = ox + (uv.u - b.minU) * scale
        uv.v = oy + (uv.v - b.minV) * scale
      }
    })
  }
}

export type UvPackStyle =
  | 'shelf'
  | 'regionStrip'
  | 'grid'
  | 'gridStretch'
  | 'boxNet'
  | 'directionAtlas'

function boundsOverlap(a: UvBounds, b: UvBounds, padding: number): boolean {
  return !(
    a.maxU + padding < b.minU ||
    b.maxU + padding < a.minU ||
    a.maxV + padding < b.minV ||
    b.maxV + padding < a.minV
  )
}

/** Pack newly unwrapped islands without moving existing UV layout on other faces. */
export function packPartialUnwrapIslands(
  uvs: Uv2[],
  faceUvIndices: number[][],
  faceCount: number,
  selectedFaces: number[],
  islands: number[][],
  margin = 0.02,
  options?: {
    skipRefit?: boolean
    packStyle?: UvPackStyle
    boxNet?: {
      size: BoxNetSize
      buckets: { bucket: UvNormalBucket; faces: number[] }[]
    }
    directionFaces?: { fi: number; bucket: UvNormalBucket }[]
  }
): void {
  if (islands.length === 0 || selectedFaces.length === 0) return

  const opts = options ?? {}
  const style = opts.packStyle ?? 'shelf'
  if (!opts.skipRefit) {
    if (style === 'boxNet' && opts.boxNet) {
      packFaceIslandsBoxNet(
        uvs,
        faceUvIndices,
        opts.boxNet.buckets,
        opts.boxNet.size,
        margin
      )
    } else if (style === 'directionAtlas' && opts.directionFaces) {
      packFacesDirectionAtlas(uvs, faceUvIndices, opts.directionFaces, margin)
    } else if (style === 'regionStrip') {
      packFaceIslandsRegionStrip(uvs, faceUvIndices, islands, margin)
    } else if (style === 'grid' || style === 'gridStretch') {
      packFaceIslandsUniformGrid(uvs, faceUvIndices, islands, margin, {
        stretch: style === 'gridStretch',
        columns: style === 'gridStretch' ? 'row' : 'sqrt',
      })
    } else {
      packFaceIslandsShelf(uvs, faceUvIndices, islands, margin)
    }
  } else {
    splitUvIslandsForPacking(uvs, faceUvIndices, islands)
  }

  relocatePartialIsland(uvs, faceUvIndices, faceCount, selectedFaces, margin)
}

/** Translate (and optionally shrink) a pre-fitted selection into free atlas space. */
export function relocatePartialIsland(
  uvs: Uv2[],
  faceUvIndices: number[][],
  faceCount: number,
  selectedFaces: number[],
  margin = 0.02
): void {
  const selectedUi = collectIndices(faceUvIndices, selectedFaces)
  if (selectedUi.length === 0) return

  const selectedSet = new Set(selectedFaces)
  const untouchedFaces = [...Array(faceCount).keys()].filter((fi) => !selectedSet.has(fi))
  if (untouchedFaces.length === 0) return

  const untouchedUi = collectIndices(faceUvIndices, untouchedFaces)
  const existingBounds = uvBoundsFromIndices(uvs, untouchedUi)
  let selBounds = uvBoundsFromIndices(uvs, selectedUi)
  const selW = selBounds.maxU - selBounds.minU
  const selH = selBounds.maxV - selBounds.minV

  const candidates = [
    { u: margin, v: margin },
    { u: existingBounds.maxU + margin, v: margin },
    { u: margin, v: existingBounds.maxV + margin },
    { u: existingBounds.maxU + margin, v: existingBounds.maxV + margin },
    { u: Math.max(margin, 1 - selW - margin), v: margin },
    { u: margin, v: Math.max(margin, 1 - selH - margin) },
  ]

  for (const anchor of candidates) {
    const trial: UvBounds = {
      minU: anchor.u,
      minV: anchor.v,
      maxU: anchor.u + selW,
      maxV: anchor.v + selH,
    }
    if (trial.minU < -0.01 || trial.minV < -0.01 || trial.maxU > 1.01 || trial.maxV > 1.01) continue
    if (!boundsOverlap(trial, existingBounds, margin)) {
      translateUVs(uvs, selectedUi, anchor.u - selBounds.minU, anchor.v - selBounds.minV)
      return
    }
  }

  const maxDim = Math.max(selW, selH, 1e-8)
  const scale = maxDim > 0.35 ? 0.35 / maxDim : 1
  if (scale < 1) {
    const pivot = uvBoundsCenter(selBounds)
    scaleUVsFromCenter(uvs, selectedUi, scale, scale, pivot)
    selBounds = uvBoundsFromIndices(uvs, selectedUi)
  }
  translateUVs(uvs, selectedUi, margin - selBounds.minU, margin - selBounds.minV)
}

/** @deprecated Prefer packFacesDirectionAtlas — kept for older call sites. */
export function packCubeBucketsBlockbench(
  uvs: Uv2[],
  faceUvIndices: number[][],
  bucketIslands: { bucketCol: number; bucketRow: number; faces: number[] }[],
  margin = 0.04,
  atlasCols = 4,
  atlasRows = 3
): void {
  const cellW = 1 / atlasCols
  const cellH = 1 / atlasRows

  for (const { bucketCol, bucketRow, faces } of bucketIslands) {
    if (faces.length === 0) continue
    const uvIndices = collectIndices(faceUvIndices, faces)
    if (uvIndices.length === 0) continue

    fitUVsToUnitSquare(uvs, uvIndices)
    const innerW = cellW * (1 - margin * 2)
    const innerH = cellH * (1 - margin * 2)
    const baseU = bucketCol * cellW + cellW * margin
    const baseV = 1 - (bucketRow + 1) * cellH + cellH * margin

    const b = uvBoundsFromIndices(uvs, uvIndices)
    const w = b.maxU - b.minU || 1
    const h = b.maxV - b.minV || 1
    const scale = Math.min(innerW / w, innerH / h)
    for (const ui of uvIndices) {
      const uv = uvs[ui]
      if (!uv) continue
      uv.u = baseU + (uv.u - b.minU) * scale
      uv.v = baseV + (uv.v - b.minV) * scale
    }
  }
}
