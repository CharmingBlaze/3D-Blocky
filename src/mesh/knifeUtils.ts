import type { Vec3 } from '../utils/math'

/** Constrain knife end point to 45° steps in screen space (Blender-style). */
export function constrainKnifeEndWorld(
  start: Vec3,
  end: Vec3,
  project: (world: Vec3) => { x: number; y: number },
  unproject: (screenX: number, screenY: number) => Vec3 | null,
  shiftKey: boolean
): Vec3 {
  if (!shiftKey) return end

  const a = project(start)
  const b = project(end)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 4) return end

  const angle = Math.atan2(dy, dx)
  const step = Math.PI / 4
  const snapped = Math.round(angle / step) * step
  const bx = a.x + Math.cos(snapped) * len
  const by = a.y + Math.sin(snapped) * len
  return unproject(bx, by) ?? end
}

export function knifeSegmentLongEnough(start: Vec3, end: Vec3, min = 1e-4): boolean {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const dz = end.z - start.z
  return dx * dx + dy * dy + dz * dz >= min * min
}
