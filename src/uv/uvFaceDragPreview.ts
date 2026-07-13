/**
 * Face transform previews: move/rotate pixels with the mouse, commit UV math on release.
 * Keeps the UV editor canvas out of the pointer-move hot path.
 */

import type { Uv2 } from './uvTypes'

export type FaceDragPreviewState = {
  startClientX: number
  startClientY: number
  /** Screen-space zoom used when the preview was captured. */
  zoom: number
  texW: number
  texH: number
}

export type FaceRotatePreviewState = {
  pivotU: number
  pivotV: number
  startAngle: number
  /** transform-origin in overlay/canvas pixel space */
  originX: number
  originY: number
}

/** Screen-space pivot for CSS scale (UV scale factors map 1:1 — see uvToPixel Y flip). */
export type FaceScalePreviewState = {
  originX: number
  originY: number
}

export function faceDragScreenDelta(
  state: FaceDragPreviewState,
  clientX: number,
  clientY: number
): { sx: number; sy: number } {
  return {
    sx: clientX - state.startClientX,
    sy: clientY - state.startClientY,
  }
}

/** Convert screen drag to UV delta (V increases up; canvas Y increases down). */
export function faceDragScreenToUvDelta(
  state: FaceDragPreviewState,
  clientX: number,
  clientY: number
): { du: number; dv: number } {
  const { sx, sy } = faceDragScreenDelta(state, clientX, clientY)
  const z = Math.max(state.zoom, 1e-6)
  return {
    du: sx / (state.texW * z),
    dv: -sy / (state.texH * z),
  }
}

export function applyFaceDragOverlayTransform(
  overlay: HTMLElement | null,
  sx: number,
  sy: number
): void {
  if (!overlay) return
  overlay.style.willChange = 'transform'
  overlay.style.transformOrigin = '0 0'
  overlay.style.transform = `translate3d(${sx}px, ${sy}px, 0)`
}

/** UV-space angle from pointer relative to the gesture start angle. */
export function faceRotateAngleFromUv(
  state: FaceRotatePreviewState,
  currUv: Uv2
): number {
  return Math.atan2(currUv.v - state.pivotV, currUv.u - state.pivotU) - state.startAngle
}

/**
 * Screen Y is flipped vs UV V, so a positive UV rotation is a negative CSS rotate
 * for the painted overlay to track the cursor correctly.
 */
export function applyFaceRotateOverlayTransform(
  overlay: HTMLElement | null,
  state: FaceRotatePreviewState,
  angleRad: number
): void {
  if (!overlay) return
  overlay.style.willChange = 'transform'
  overlay.style.transformOrigin = `${state.originX}px ${state.originY}px`
  overlay.style.transform = `rotate(${-angleRad}rad)`
}

/**
 * UV scale (su, sv) around a pivot matches CSS scale(su, sv) at the pivot's
 * screen pixel — even with V flipped in uvToPixel.
 */
export function applyFaceScaleOverlayTransform(
  overlay: HTMLElement | null,
  state: FaceScalePreviewState,
  scaleU: number,
  scaleV: number
): void {
  if (!overlay) return
  overlay.style.willChange = 'transform'
  overlay.style.transformOrigin = `${state.originX}px ${state.originY}px`
  overlay.style.transform = `scale(${scaleU}, ${scaleV})`
}

export function clearFaceDragOverlay(overlay: HTMLCanvasElement | null): void {
  if (!overlay) return
  overlay.style.transform = ''
  overlay.style.transformOrigin = ''
  overlay.style.willChange = ''
  const ctx = overlay.getContext('2d')
  if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height)
}
