import { VIEW_AXIS_TABLE, axisComponent, planePointToWorld, worldToPlanePoint } from '../primitives/viewAxes'
import { isOrthoView, normalizeViewType, type ViewType } from '../scene/viewTypes'
import type { Vec3 } from '../utils/math'

export function polyDrawShapeHasArea(points: readonly Vec3[]): boolean {
  if (points.length < 3) return false
  let nx = 0
  let ny = 0
  let nz = 0
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!
    const b = points[(index + 1) % points.length]!
    nx += (a.y - b.y) * (a.z + b.z)
    ny += (a.z - b.z) * (a.x + b.x)
    nz += (a.x - b.x) * (a.y + b.y)
  }
  return Math.hypot(nx, ny, nz) > 1e-8
}

function perspectivePlaneAxes(center: Vec3, cursor: Vec3): [number, number, number] {
  const delta = [
    Math.abs(cursor.x - center.x),
    Math.abs(cursor.y - center.y),
    Math.abs(cursor.z - center.z),
  ]
  const depth = delta.indexOf(Math.min(...delta))
  const plane = [0, 1, 2].filter((axis) => axis !== depth)
  return [plane[0]!, plane[1]!, depth]
}

function withAxis(point: Vec3, axis: number, value: number): Vec3 {
  const next = { ...point }
  if (axis === 0) next.x = value
  else if (axis === 1) next.y = value
  else next.z = value
  return next
}

export function rectangleWorldPoints(a: Vec3, b: Vec3, view: ViewType): Vec3[] {
  if (isOrthoView(view)) {
    const ortho = normalizeViewType(view)
    if (ortho === 'perspective') return []
    const pa = worldToPlanePoint(ortho, a)
    const pb = worldToPlanePoint(ortho, b)
    const mapping = VIEW_AXIS_TABLE[ortho]
    const depth = axisComponent(a, mapping.d) * mapping.dSign
    return [
      planePointToWorld(ortho, pa.x, pa.y, depth),
      planePointToWorld(ortho, pb.x, pa.y, depth),
      planePointToWorld(ortho, pb.x, pb.y, depth),
      planePointToWorld(ortho, pa.x, pb.y, depth),
    ]
  }

  const [h, v, d] = perspectivePlaneAxes(a, b)
  let cornerH = withAxis(a, h, axisComponent(b, h as 0 | 1 | 2))
  cornerH = withAxis(cornerH, d, axisComponent(a, d as 0 | 1 | 2))
  let opposite = withAxis(cornerH, v, axisComponent(b, v as 0 | 1 | 2))
  let cornerV = withAxis(a, v, axisComponent(b, v as 0 | 1 | 2))
  cornerV = withAxis(cornerV, d, axisComponent(a, d as 0 | 1 | 2))
  opposite = withAxis(opposite, d, axisComponent(a, d as 0 | 1 | 2))
  return [{ ...a }, cornerH, opposite, cornerV]
}

export function regularPolygonWorldPoints(
  center: Vec3,
  radiusPoint: Vec3,
  view: ViewType,
  sides = 6
): Vec3[] {
  const count = Math.max(3, Math.round(sides))
  if (isOrthoView(view)) {
    const ortho = normalizeViewType(view)
    if (ortho === 'perspective') return []
    const c = worldToPlanePoint(ortho, center)
    const r = worldToPlanePoint(ortho, radiusPoint)
    const dx = r.x - c.x
    const dy = r.y - c.y
    const radius = Math.hypot(dx, dy)
    const start = Math.atan2(dy, dx)
    const mapping = VIEW_AXIS_TABLE[ortho]
    const depth = axisComponent(center, mapping.d) * mapping.dSign
    return Array.from({ length: count }, (_, index) => {
      const angle = start + (index * Math.PI * 2) / count
      return planePointToWorld(
        ortho,
        c.x + Math.cos(angle) * radius,
        c.y + Math.sin(angle) * radius,
        depth
      )
    })
  }

  const [h, v, d] = perspectivePlaneAxes(center, radiusPoint)
  const ch = axisComponent(center, h as 0 | 1 | 2)
  const cv = axisComponent(center, v as 0 | 1 | 2)
  const dx = axisComponent(radiusPoint, h as 0 | 1 | 2) - ch
  const dy = axisComponent(radiusPoint, v as 0 | 1 | 2) - cv
  const radius = Math.hypot(dx, dy)
  const start = Math.atan2(dy, dx)
  return Array.from({ length: count }, (_, index) => {
    const angle = start + (index * Math.PI * 2) / count
    let point = withAxis(center, h, ch + Math.cos(angle) * radius)
    point = withAxis(point, v, cv + Math.sin(angle) * radius)
    return withAxis(point, d, axisComponent(center, d as 0 | 1 | 2))
  })
}
