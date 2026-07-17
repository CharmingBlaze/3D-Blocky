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
  span: number
  bendNormal: Vec3
  angle: number
}

function rotateVectorAroundAxis(vector: Vec3, axis: Vec3, theta: number): Vec3 {
  const k = normalize3(axis)
  const parallel = scale3(k, dot3(vector, k))
  const perp = sub3(vector, parallel)
  const rotatedPerp = add3(scale3(perp, Math.cos(theta)), scale3(cross3(k, perp), Math.sin(theta)))
  return add3(parallel, rotatedPerp)
}

export function bendAxisDirection(origin: Vec3, end: Vec3 | null, fallback: Vec3): Vec3 {
  if (!end) return normalize3(fallback)
  const delta = sub3(end, origin)
  const len = Math.hypot(delta.x, delta.y, delta.z)
  if (len < 1e-6) return normalize3(fallback)
  return scale3(delta, 1 / len)
}

function perpendicularBendNormal(spine: Vec3, bendNormal: Vec3): Vec3 {
  const rawNormal = sub3(bendNormal, scale3(spine, dot3(bendNormal, spine)))
  let normal = normalize3(rawNormal)
  if (Math.hypot(normal.x, normal.y, normal.z) < 1e-6) {
    const fallback = Math.abs(spine.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 }
    normal = normalize3(cross3(spine, fallback))
  }
  return normal
}

export function bendArcPoint(
  origin: Vec3,
  spineDirection: Vec3,
  span: number,
  bendNormal: Vec3,
  angle: number,
  normalizedT: number
): Vec3 {
  const spine = normalize3(spineDirection)
  const t = Math.max(0, Math.min(1, normalizedT))
  if (Math.abs(angle) < 1e-8) return add3(origin, scale3(spine, span * t))
  const normal = perpendicularBendNormal(spine, bendNormal)
  const bendDirection = normalize3(cross3(normal, spine))
  const radius = span / angle
  const theta = angle * t
  return add3(
    origin,
    add3(
      scale3(spine, radius * Math.sin(theta)),
      scale3(bendDirection, radius * (1 - Math.cos(theta)))
    )
  )
}

export function applyBendToObject(obj: SceneObject, params: BendParams): Vec3[] {
  const spine = normalize3(params.axisDirection)
  const span = Math.max(Math.abs(params.span), 1e-6)
  if (Math.hypot(spine.x, spine.y, spine.z) < 1e-6) {
    return obj.positions.map((p) => ({ ...p }))
  }

  // The drawn line is the longitudinal spine. Bend around the view-facing
  // normal so the deformation follows a visible circular arc instead of
  // twisting vertices around the spine itself.
  const normal = perpendicularBendNormal(spine, params.bendNormal)
  const worldVerts = obj.positions.map((p) => worldPointFromObject(obj, p))
  const angle = params.angle

  if (Math.abs(angle) < 1e-8) return obj.positions.map((p) => ({ ...p }))

  const endpointTheta = angle
  const endpointCenter = bendArcPoint(
    params.axisOrigin,
    spine,
    span,
    normal,
    angle,
    1
  )
  const endpointTangent = rotateVectorAroundAxis(spine, normal, endpointTheta)

  return worldVerts.map((worldP) => {
    const relative = sub3(worldP, params.axisOrigin)
    const t = dot3(relative, spine)
    const crossSection = sub3(relative, scale3(spine, t))

    if (t <= 0) return localPointFromWorld(obj, worldP)

    if (t >= span) {
      const bent = add3(
        endpointCenter,
        add3(
          scale3(endpointTangent, t - span),
          rotateVectorAroundAxis(crossSection, normal, endpointTheta)
        )
      )
      return localPointFromWorld(obj, bent)
    }

    const theta = angle * (t / span)
    const centerline = bendArcPoint(params.axisOrigin, spine, span, normal, angle, t / span)
    const bent = add3(centerline, rotateVectorAroundAxis(crossSection, normal, theta))
    return localPointFromWorld(obj, bent)
  })
}

export function bendAngleFromScreenDelta(startClientY: number, clientY: number): number {
  return (startClientY - clientY) * 0.012
}
