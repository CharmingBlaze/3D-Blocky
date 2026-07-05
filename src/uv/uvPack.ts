import { fitUVsToUnitSquare, translateUVs, uvBoundsFromIndices } from './uvEditing'
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

function collectIndices(faceUvIndices: number[][], faceList: number[]): number[] {
  const set = new Set<number>()
  for (const fi of faceList) {
    for (const ui of faceUvIndices[fi] ?? []) set.add(ui)
  }
  return [...set]
}

/** Place up to six axis-direction islands into Blockbench cross slots. */
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
