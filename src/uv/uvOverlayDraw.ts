import {
  boundaryEdgesForFacesSpatial,
  spatialMeshEdgeKey,
} from '../mesh/faceGroups'
import { uvToPixel } from './uvEditing'
import type { SceneObjectWithUVs } from './uvObject'
import type { Uv2 } from './uvTypes'

/** Map a mesh edge (by spatial vertex key) to UV-space pixel endpoints. */
export function uvEdgePixels(
  obj: SceneObjectWithUVs,
  uvs: readonly Uv2[],
  regionFaces: number[],
  va: number,
  vb: number,
  texW: number,
  texH: number
): [{ x: number; y: number }, { x: number; y: number }] | null {
  const target = spatialMeshEdgeKey(obj, va, vb)
  for (const fi of regionFaces) {
    const face = obj.faces[fi]
    const uvIdx = obj.faceUvIndices[fi]
    if (!face || !uvIdx?.length) continue
    for (let i = 0; i < face.length; i++) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      if (spatialMeshEdgeKey(obj, a, b) !== target) continue
      const uia = uvIdx[i]
      const uib = uvIdx[(i + 1) % face.length]
      return [
        uvToPixel(uvs[uia] ?? { u: 0, v: 0 }, texW, texH),
        uvToPixel(uvs[uib] ?? { u: 0, v: 0 }, texW, texH),
      ]
    }
  }
  return null
}

export function drawRegionFill(
  ctx: CanvasRenderingContext2D,
  obj: SceneObjectWithUVs,
  uvs: readonly Uv2[],
  faceIndices: number[],
  fillStyle: string,
  texW: number,
  texH: number
): void {
  ctx.beginPath()
  let hasPath = false
  for (const fi of faceIndices) {
    const uvIdx = obj.faceUvIndices[fi]
    if (!uvIdx?.length) continue
    const p0 = uvToPixel(uvs[uvIdx[0]] ?? { u: 0, v: 0 }, texW, texH)
    ctx.moveTo(p0.x, p0.y)
    for (let i = 1; i < uvIdx.length; i++) {
      const p = uvToPixel(uvs[uvIdx[i]] ?? { u: 0, v: 0 }, texW, texH)
      ctx.lineTo(p.x, p.y)
    }
    ctx.closePath()
    hasPath = true
  }
  if (!hasPath) return
  ctx.fillStyle = fillStyle
  ctx.fill()
}

export function drawRegionBoundary(
  ctx: CanvasRenderingContext2D,
  obj: SceneObjectWithUVs,
  uvs: readonly Uv2[],
  faceIndices: number[],
  strokeStyle: string,
  lineWidth: number,
  texW: number,
  texH: number,
  precomputedEdges?: [number, number][]
): void {
  const edges = precomputedEdges ?? boundaryEdgesForFacesSpatial(obj, faceIndices)
  if (edges.length === 0) return
  ctx.beginPath()
  for (const [va, vb] of edges) {
    const seg = uvEdgePixels(obj, uvs, faceIndices, va, vb, texW, texH)
    if (!seg) continue
    ctx.moveTo(seg[0].x, seg[0].y)
    ctx.lineTo(seg[1].x, seg[1].y)
  }
  ctx.strokeStyle = strokeStyle
  ctx.lineWidth = lineWidth
  ctx.stroke()
}
