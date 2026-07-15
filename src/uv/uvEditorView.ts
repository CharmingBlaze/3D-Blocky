/** Pure UV viewport math. The editor keeps one camera value and commits pan,
 * zoom and framing atomically so rendering and hit-testing always agree. */

export type UvEditorView = {
  panX: number
  panY: number
  zoom: number
}

export type UvEditorRect = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function clampUvEditorZoom(zoom: number, min = 0.06, max = 32): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(max, Math.max(min, zoom))
}

export function uvEditorScreenToWorld(
  view: UvEditorView,
  screenX: number,
  screenY: number
): { x: number; y: number } {
  const zoom = Math.max(view.zoom, 1e-6)
  return { x: (screenX - view.panX) / zoom, y: (screenY - view.panY) / zoom }
}

export function uvEditorFitRect(
  rect: UvEditorRect,
  viewportWidth: number,
  viewportHeight: number,
  padding = 32,
  minZoom = 0.06,
  maxZoom = 32
): UvEditorView {
  const width = Math.max(1, rect.maxX - rect.minX)
  const height = Math.max(1, rect.maxY - rect.minY)
  const availableWidth = Math.max(1, viewportWidth - padding * 2)
  const availableHeight = Math.max(1, viewportHeight - padding * 2)
  const zoom = clampUvEditorZoom(
    Math.min(availableWidth / width, availableHeight / height),
    minZoom,
    maxZoom
  )
  return {
    zoom,
    panX: (viewportWidth - (rect.minX + rect.maxX) * zoom) / 2,
    panY: (viewportHeight - (rect.minY + rect.maxY) * zoom) / 2,
  }
}

/** Smooth across mouse wheels and high-resolution trackpads. */
export function uvEditorWheelZoom(
  view: UvEditorView,
  screenX: number,
  screenY: number,
  deltaY: number,
  minZoom = 0.06,
  maxZoom = 32
): UvEditorView {
  const nextZoom = clampUvEditorZoom(view.zoom * Math.exp(-deltaY * 0.0015), minZoom, maxZoom)
  return uvEditorZoomAtScreenPoint(view, screenX, screenY, nextZoom)
}

/** CSS pan delta from the last painted camera to the live camera (same zoom). */
export function uvEditorPanCssFromPainted(
  painted: UvEditorView,
  live: UvEditorView
): string {
  const dx = live.panX - painted.panX
  const dy = live.panY - painted.panY
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return ''
  return `translate3d(${dx}px, ${dy}px, 0)`
}

/** Zoom toward a screen point (container-local), keeping that UV under the cursor. */
export function uvEditorZoomAtScreenPoint(
  view: UvEditorView,
  screenX: number,
  screenY: number,
  nextZoom: number
): UvEditorView {
  const z0 = Math.max(view.zoom, 1e-6)
  const z1 = clampUvEditorZoom(nextZoom)
  const u = (screenX - view.panX) / z0
  const v = (screenY - view.panY) / z0
  return {
    zoom: z1,
    panX: screenX - u * z1,
    panY: screenY - v * z1,
  }
}

/** Padded atlas document used by UV editor scrollbars (−0.5× … 1.5× texture). */
export function uvEditorScrollDocSpan(texSize: number): { doc0: number; span: number } {
  const doc0 = -texSize * 0.5
  return { doc0, span: Math.max(texSize * 2, 1) }
}

/** Thumb size / travel / pan-per-pixel for one scrollbar axis. */
export function uvEditorScrollAxisMetrics(
  viewPx: number,
  zoom: number,
  docSpan: number,
  trackInset = 16,
  minThumb = 24
): { track: number; thumb: number; range: number; panPerPx: number } {
  const z = Math.max(zoom, 1e-6)
  const visible = viewPx / z
  const track = Math.max(1, viewPx - trackInset)
  const thumb = Math.max(minThumb, track * Math.min(1, visible / Math.max(docSpan, 1)))
  const range = Math.max(0, docSpan - visible)
  const travel = Math.max(1, track - thumb)
  const panPerPx = range > 0 ? (range * z) / travel : 0
  return { track, thumb, range, panPerPx }
}

/** Map a 0..1 scrollbar ratio to camera pan (document min edge → pan). */
export function uvEditorPanFromScrollRatio(
  doc0: number,
  range: number,
  ratio: number,
  zoom: number
): number {
  const r = Math.max(0, Math.min(1, ratio))
  return -(doc0 + r * Math.max(range, 0)) * Math.max(zoom, 1e-6)
}

export function isUvEditorScrollbarTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('.uv-scrollbar')
}
