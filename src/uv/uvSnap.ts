import type { Uv2 } from './uvTypes'
import { snapUvToGrid } from './uvEditing'
import { pixelToUv, uvToPixel } from './uvEditing'

export type UvSnapMode = 'off' | 'grid' | 'vertex' | 'island'

export interface UvSnapContext {
  texW: number
  texH: number
  gridDivisions: number
  /** Pixel-space snap targets (other UV points). */
  vertexTargets: { x: number; y: number }[]
  /** Pixel-space AABBs of other islands (faces mode). */
  islandTargets: { minX: number; minY: number; maxX: number; maxY: number }[]
  thresholdPx: number
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function snapPixelToTargets(
  px: number,
  py: number,
  targets: { x: number; y: number }[],
  thresholdPx: number
): { x: number; y: number } {
  const thr2 = thresholdPx * thresholdPx
  let best: { x: number; y: number } | null = null
  let bestD = thr2
  for (const t of targets) {
    const d = dist2({ x: px, y: py }, t)
    if (d <= bestD) {
      bestD = d
      best = t
    }
  }
  return best ?? { x: px, y: py }
}

function snapIslandDrag(
  selectionBounds: { minX: number; minY: number; maxX: number; maxY: number },
  targets: UvSnapContext['islandTargets'],
  thresholdPx: number
): { dx: number; dy: number } {
  const corners = [
    { x: selectionBounds.minX, y: selectionBounds.minY },
    { x: selectionBounds.maxX, y: selectionBounds.minY },
    { x: selectionBounds.maxX, y: selectionBounds.maxY },
    { x: selectionBounds.minX, y: selectionBounds.maxY },
  ]
  const cx = (selectionBounds.minX + selectionBounds.maxX) / 2
  const cy = (selectionBounds.minY + selectionBounds.maxY) / 2
  const anchors = [...corners, { x: cx, y: cy }]

  let bestDx = 0
  let bestDy = 0
  let bestD = thresholdPx * thresholdPx

  for (const target of targets) {
    const targetAnchors = [
      { x: target.minX, y: target.minY },
      { x: target.maxX, y: target.minY },
      { x: target.maxX, y: target.maxY },
      { x: target.minX, y: target.maxY },
      {
        x: (target.minX + target.maxX) / 2,
        y: (target.minY + target.maxY) / 2,
      },
    ]
    for (const a of anchors) {
      for (const t of targetAnchors) {
        const dx = t.x - a.x
        const dy = t.y - a.y
        const edgeD = dx * dx + dy * dy
        if (Math.abs(dx) <= thresholdPx && Math.abs(dy) <= thresholdPx && edgeD < bestD) {
          bestD = edgeD
          bestDx = dx
          bestDy = dy
        }
      }
    }
  }

  return { dx: bestDx, dy: bestDy }
}

/** Snap a UV coordinate while dragging in the UV editor. */
export function snapUvDrag(
  u: number,
  v: number,
  mode: UvSnapMode,
  ctx: UvSnapContext,
  dragKind: 'point' | 'island',
  selectionBoundsPx?: { minX: number; minY: number; maxX: number; maxY: number } | null,
  anchorPx?: { x: number; y: number }
): Uv2 {
  if (mode === 'off') return { u, v }

  if (mode === 'grid') {
    return snapUvToGrid({ u, v }, ctx.gridDivisions)
  }

  const px = uvToPixel({ u, v }, ctx.texW, ctx.texH)

  if (mode === 'vertex') {
    const snapped = snapPixelToTargets(px.x, px.y, ctx.vertexTargets, ctx.thresholdPx)
    return pixelToUv(snapped.x, snapped.y, ctx.texW, ctx.texH)
  }

  if (mode === 'island' && dragKind === 'island' && selectionBoundsPx && anchorPx) {
    const { dx, dy } = snapIslandDrag(
      selectionBoundsPx,
      ctx.islandTargets,
      ctx.thresholdPx
    )
    if (dx !== 0 || dy !== 0) {
      return pixelToUv(px.x + dx, px.y + dy, ctx.texW, ctx.texH)
    }
  }

  if (mode === 'island' || mode === 'vertex') {
    const snapped = snapPixelToTargets(px.x, px.y, ctx.vertexTargets, ctx.thresholdPx)
    return pixelToUv(snapped.x, snapped.y, ctx.texW, ctx.texH)
  }

  return { u, v }
}

export function collectVertexSnapTargets(
  uvs: Uv2[],
  excludeIndices: Set<number>,
  texW: number,
  texH: number
): { x: number; y: number }[] {
  const seen = new Set<string>()
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < uvs.length; i++) {
    if (excludeIndices.has(i)) continue
    const uv = uvs[i]
    if (!uv) continue
    const px = uvToPixel(uv, texW, texH)
    const key = `${Math.round(px.x)},${Math.round(px.y)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(px)
  }
  return out
}

export function collectIslandSnapTargets(
  uvs: Uv2[],
  faceUvIndices: number[][],
  excludeFaceIndices: Set<number>,
  texW: number,
  texH: number
): { minX: number; minY: number; maxX: number; maxY: number }[] {
  const out: { minX: number; minY: number; maxX: number; maxY: number }[] = []
  for (let fi = 0; fi < faceUvIndices.length; fi++) {
    if (excludeFaceIndices.has(fi)) continue
    const uvIdx = faceUvIndices[fi] ?? []
    if (uvIdx.length === 0) continue
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const ui of uvIdx) {
      const px = uvToPixel(uvs[ui] ?? { u: 0, v: 0 }, texW, texH)
      minX = Math.min(minX, px.x)
      minY = Math.min(minY, px.y)
      maxX = Math.max(maxX, px.x)
      maxY = Math.max(maxY, px.y)
    }
    if (Number.isFinite(minX)) out.push({ minX, minY, maxX, maxY })
  }
  return out
}
