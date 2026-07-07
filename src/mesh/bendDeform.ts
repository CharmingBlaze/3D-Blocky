import type { SceneObject } from './HalfEdgeMesh'
import {
  localPointFromWorld,
  worldPointFromObject,
} from './objectTransform'
import {
  add3,
  cross3,
  dot3,
  normalize3,
  scale3,
  sub3,
  type Vec3,
} from '../utils/math'

export interface BendParams {
  axisOrigin: Vec3
  axisDirection: Vec3
  angle: number
}

function rotateAroundAxis(point: Vec3, origin: Vec3, axis: Vec3, theta: number): Vec3 {
  const k = normalize3(axis)
  const v = sub3(point, origin)
  const parallel = scale3(k, dot3(v, k))
  const perp = sub3(v, parallel)
  const rotatedPerp = add3(scale3(perp, Math.cos(theta)), scale3(cross3(k, perp), Math.sin(theta)))
  return add3(origin, add3(parallel, rotatedPerp))
}

export function bendAxisDirection(origin: Vec3, end: Vec3 | null, fallback: Vec3): Vec3 {
  if (!end) return normalize3(fallback)
  const delta = sub3(end, origin)
  const len = Math.hypot(delta.x, delta.y, delta.z)
  if (len < 1e-6) return normalize3(fallback)
  return scale3(delta, 1 / len)
}

export function applyBendToObject(obj: SceneObject, params: BendParams): Vec3[] {
  const axis = normalize3(params.axisDirection)
  if (Math.hypot(axis.x, axis.y, axis.z) < 1e-6) {
    return obj.positions.map((p) => ({ ...p }))
  }

  const worldVerts = obj.positions.map((p) => worldPointFromObject(obj, p))
  const ts = worldVerts.map((p) => dot3(sub3(p, params.axisOrigin), axis))
  const maxAbsT = Math.max(...ts.map((t) => Math.abs(t)), 1e-6)

  return obj.positions.map((_, i) => {
    const worldP = worldVerts[i]!
    const t = ts[i]!
    const vertexAngle = params.angle * (t / maxAbsT)
    const bent = rotateAroundAxis(worldP, params.axisOrigin, axis, vertexAngle)
    return localPointFromWorld(obj, bent)
  })
}

export function bendAngleFromScreenDelta(startClientY: number, clientY: number): number {
  return (startClientY - clientY) * 0.012
}
