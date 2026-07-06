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

export function isSketchExtrudeActive(state: DrawExtrudeState): boolean {
  return state.sketchExtrudeMode
}

export function isPenExtrudeActive(state: DrawExtrudeState): boolean {
  return state.penExtrudeMode
}
