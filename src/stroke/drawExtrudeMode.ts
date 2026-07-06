import type { DrawInputMode } from '../store/appStore'

export interface DrawExtrudeState {
  drawInputMode: DrawInputMode
  sketchExtrudeMode: boolean
  penExtrudeMode: boolean
}

/** Extrude toggle for whichever draw input mode is active (Sketch vs Vector Pen). */
export function activeExtrudeMode(state: DrawExtrudeState): boolean {
  return state.drawInputMode === 'vector-pen' ? state.penExtrudeMode : state.sketchExtrudeMode
}

export interface DrawLatheState extends DrawExtrudeState {
  sketchLatheMode: boolean
  penLatheMode: boolean
  sketchLatheCaps: boolean
  penLatheCaps: boolean
}

/** Lathe toggle for whichever draw input mode is active (Sketch vs Vector Pen). */
export function activeLatheMode(state: DrawLatheState): boolean {
  return state.drawInputMode === 'vector-pen' ? state.penLatheMode : state.sketchLatheMode
}

/** Top/bottom cap toggle for lathe (Sketch vs Vector Pen). */
export function activeLatheCaps(state: DrawLatheState): boolean {
  return state.drawInputMode === 'vector-pen' ? state.penLatheCaps : state.sketchLatheCaps
}

export function isSketchExtrudeActive(state: DrawExtrudeState): boolean {
  return state.sketchExtrudeMode
}

export function isPenExtrudeActive(state: DrawExtrudeState): boolean {
  return state.penExtrudeMode
}
