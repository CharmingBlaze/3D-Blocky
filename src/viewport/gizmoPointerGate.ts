/**
 * Tracks when TransformControls has claimed a pointer (axis/handle drag).
 * Panel selection handlers skip that gesture so gizmo and picking can share the canvas.
 */
let gizmoHandlingPointer = false

export function beginGizmoPointerCapture(): void {
  gizmoHandlingPointer = true
}

export function endGizmoPointerCapture(): void {
  gizmoHandlingPointer = false
}

export function isGizmoHandlingPointer(): boolean {
  return gizmoHandlingPointer
}
