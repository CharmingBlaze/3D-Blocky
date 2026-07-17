import type { DrawInputMode } from '../store/appStore'

export interface DrawExtrudeState {
  drawInputMode: DrawInputMode
  /** Shared Extrude toggle for Sketch and Vector Pen. */
  sketchExtrudeMode: boolean
  /** Kept in sync with sketchExtrudeMode for project-file compatibility. */
  penExtrudeMode: boolean
}

/** Extrude toggle shared by Sketch and Vector Pen stroke shapes. */
export function activeExtrudeMode(state: DrawExtrudeState): boolean {
  return state.sketchExtrudeMode || state.penExtrudeMode
}

export interface DrawLatheState extends DrawExtrudeState {
  sketchLatheMode: boolean
  penLatheMode: boolean
  sketchLatheCaps: boolean
  penLatheCaps: boolean
}

/** Lathe toggle shared by Sketch and Vector Pen. */
export function activeLatheMode(state: DrawLatheState): boolean {
  return state.sketchLatheMode || state.penLatheMode
}

/** Top/bottom cap toggle for lathe (shared by Sketch and Vector Pen). */
export function activeLatheCaps(state: DrawLatheState): boolean {
  return state.sketchLatheCaps || state.penLatheCaps
}

export function isSketchExtrudeActive(state: DrawExtrudeState): boolean {
  return activeExtrudeMode(state)
}

export function isPenExtrudeActive(state: DrawExtrudeState): boolean {
  return activeExtrudeMode(state)
}
