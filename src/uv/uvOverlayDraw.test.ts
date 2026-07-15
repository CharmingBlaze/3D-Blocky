import { describe, expect, it } from 'vitest'
import { drawRegionBoundary, drawRegionFill, uvEdgePixels } from './uvOverlayDraw'
import type { SceneObjectWithUVs } from './uvObject'

function makeQuad(): SceneObjectWithUVs {
  return {
    id: 'q',
    name: 'q',
    positions: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ],
    faces: [[0, 1, 2, 3]],
    uvs: [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ],
    faceUvIndices: [[0, 1, 2, 3]],
  } as unknown as SceneObjectWithUVs
}

describe('uvOverlayDraw', () => {
  it('uvEdgePixels maps mesh edge to UV pixels with V flipped', () => {
    const mesh = makeQuad()
    const seg = uvEdgePixels(mesh, mesh.uvs, [0], 0, 1, 100, 50)
    expect(seg).not.toBeNull()
    // u=0,v=0 → (0, 50); u=1,v=0 → (100, 50)
    expect(seg![0]).toEqual({ x: 0, y: 50 })
    expect(seg![1]).toEqual({ x: 100, y: 50 })
  })

  it('drawRegionFill and drawRegionBoundary issue canvas commands', () => {
    const mesh = makeQuad()
    const ops: string[] = []
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      beginPath: () => ops.push('beginPath'),
      moveTo: () => ops.push('moveTo'),
      lineTo: () => ops.push('lineTo'),
      closePath: () => ops.push('closePath'),
      fill: () => ops.push('fill'),
      stroke: () => ops.push('stroke'),
    } as unknown as CanvasRenderingContext2D

    drawRegionFill(ctx, mesh, mesh.uvs, [0], 'rgba(1,1,1,0.1)', 64, 64)
    drawRegionBoundary(ctx, mesh, mesh.uvs, [0], '#fff', 1, 64, 64)
    expect(ops).toContain('fill')
    expect(ops).toContain('stroke')
  })
})
