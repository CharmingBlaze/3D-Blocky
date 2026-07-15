import { describe, expect, it } from 'vitest'
import { strokeToMesh } from './strokeToMesh'

const base = {
  points: [
    { x: 0, y: 0 },
    { x: 12, y: 4 },
    { x: 25, y: 1 },
    { x: 38, y: 10 },
  ],
  view: 'front' as const,
  polyBudget: 128,
  brushDensity: 12,
  rdpTolerance: 1,
  closeThreshold: 6,
  defaultDepth: 0,
  color: 0xffffff,
  stylize: 0,
  extrudeMode: false,
  latheMode: false,
  latheCaps: false,
  extrudeAmount: 12,
  hairTipStyle: 'pointed' as const,
  planeFrame: null,
}

describe('textured sweep stroke tools', () => {
  it.each([
    ['ribbon', 'ribbon'],
    ['tapered-tube', 'tapered-tube'],
  ] as const)('builds editable UV-mapped %s geometry', (strokeMode, sourceKind) => {
    const object = strokeToMesh({ ...base, strokeMode })
    expect(object).not.toBeNull()
    expect(object!.sketchSource?.kind).toBe(sourceKind)
    expect(object!.uvs?.length).toBeGreaterThan(0)
    expect(object!.faceUvIndices?.length).toBe(object!.faces.length)
  })
})
