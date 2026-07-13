/**
 * Blockbench-inspired UV transform session helpers.
 *
 * Pattern we keep (same tools + 3D view):
 *  1. Freeze the atlas paint (no texture redraw mid-gesture)
 *  2. Show selection on a lightweight overlay (CSS transform or draft repaint)
 *  3. Patch 3D UV buffers live via scheduleUvDraft
 *  4. Commit store UVs once on pointer-up
 */

import { uvToPixel } from './uvEditing'
import type { Uv2 } from './uvTypes'

export type UvLiveOverlayMode = 'css-move' | 'css-rotate' | 'css-scale' | 'repaint'

export type UvLive3dPool = {
  indices: number[]
  starts: Uv2[]
  pool: Uv2[]
}

/** Screen-space transform origin for CSS rotate/scale over a frozen overlay. */
export function uvScreenOriginFromPivot(
  pivot: Uv2,
  panX: number,
  panY: number,
  zoom: number,
  texW: number,
  texH: number
): { originX: number; originY: number } {
  const px = uvToPixel(pivot, texW, texH)
  const z = Math.max(zoom, 1e-6)
  return {
    originX: panX + px.x * z,
    originY: panY + px.y * z,
  }
}

/** Write transformed UVs into the live 3D pool (indices aligned with `starts`). */
export function writeUvLive3dPool(live: UvLive3dPool, values: readonly Uv2[]): void {
  const n = Math.min(live.indices.length, values.length)
  for (let i = 0; i < n; i++) {
    live.pool[live.indices[i]!] = values[i]!
  }
}

/** Apply a uniform UV delta into the live 3D pool from the gesture start snapshot. */
export function applyUvLive3dDelta(live: UvLive3dPool, du: number, dv: number): void {
  for (let i = 0; i < live.indices.length; i++) {
    const start = live.starts[i]!
    live.pool[live.indices[i]!] = { u: start.u + du, v: start.v + dv }
  }
}

export function isCssUvLiveOverlayMode(
  mode: UvLiveOverlayMode | null | undefined
): mode is 'css-move' | 'css-rotate' | 'css-scale' {
  return mode === 'css-move' || mode === 'css-rotate' || mode === 'css-scale'
}
