import { HalfEdgeMesh, type SceneObject } from './HalfEdgeMesh'
import { dist3, type Vec3 } from '../utils/math'

/** Punch a through-hole along a line segment (auto-hole tool) */
export function punchHoleAlongLine(
  obj: SceneObject,
  lineStart: Vec3,
  lineEnd: Vec3,
  radius = 6
): SceneObject | null {
  if (obj.topologyLocked) return null

  const mesh = HalfEdgeMesh.fromObject(obj)
  const axis = {
    x: lineEnd.x - lineStart.x,
    y: lineEnd.y - lineStart.y,
    z: lineEnd.z - lineStart.z,
  }
  const len = Math.sqrt(axis.x ** 2 + axis.y ** 2 + axis.z ** 2)
  if (len < 1) return null

  const dir = { x: axis.x / len, y: axis.y / len, z: axis.z / len }

  function distToLine(p: Vec3): number {
    const ap = { x: p.x - lineStart.x, y: p.y - lineStart.y, z: p.z - lineStart.z }
    const t = ap.x * dir.x + ap.y * dir.y + ap.z * dir.z
    const proj = {
      x: lineStart.x + dir.x * t,
      y: lineStart.y + dir.y * t,
      z: lineStart.z + dir.z * t,
    }
    const perp = dist3(p, proj)
    const along = t >= -radius && t <= len + radius
    return along ? perp : Infinity
  }

  const keepFaces: number[][] = []
  const keepColors: number[] = []

  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const face = mesh.faces[fi]
    const cx =
      face.reduce((s, vi) => s + mesh.positions[vi].x, 0) / face.length
    const cy =
      face.reduce((s, vi) => s + mesh.positions[vi].y, 0) / face.length
    const cz =
      face.reduce((s, vi) => s + mesh.positions[vi].z, 0) / face.length

    if (distToLine({ x: cx, y: cy, z: cz }) > radius) {
      keepFaces.push(face)
      keepColors.push(mesh.faceColors[fi] ?? obj.color)
    }
  }

  if (keepFaces.length === mesh.faces.length) return null

  mesh.faces = keepFaces
  mesh.faceColors = keepColors
  mesh.buildHalfEdges()

  return mesh.toObject(obj.id, obj.name, obj)
}
