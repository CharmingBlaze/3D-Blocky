import { describe, expect, it } from 'vitest'
import type { VectorPath } from './types'
import { vectorPathToMesh } from './vectorPathToMesh'

function openPath(): VectorPath {
  return {
    id: 'pen-path',
    view: 'front',
    closed: false,
    color: 0x6ecbf5,
    source: 'pen',
    anchors: [
      { id: 'a0', position: { x: 0, y: 0 }, inHandle: null, outHandle: null },
      { id: 'a1', position: { x: 20, y: 0 }, inHandle: null, outHandle: null },
      { id: 'a2', position: { x: 40, y: 12 }, inHandle: null, outHandle: null },
    ],
  }
}

const baseOpts = {
  view: 'front' as const,
  polyBudget: 128,
  brushDensity: 12,
  rdpTolerance: 2,
  closeThreshold: 12,
  defaultDepth: 0,
  color: 0x6ecbf5,
  extrudeAmount: 16,
}

describe('vectorPathToMesh stroke shape parity', () => {
  it('builds ribbon and tapered-tube through the shared Sketch stroke pipeline', () => {
    const ribbon = vectorPathToMesh(openPath(), { ...baseOpts, strokeMode: 'ribbon' })
    const tapered = vectorPathToMesh(openPath(), { ...baseOpts, strokeMode: 'tapered-tube' })
    expect(ribbon).not.toBeNull()
    expect(tapered).not.toBeNull()
    expect(ribbon!.name).toBe('Ribbon')
    expect(tapered!.name).toBe('Tapered Tube')
    expect(ribbon!.positions.length).toBeGreaterThan(0)
    expect(tapered!.positions.length).toBeGreaterThan(0)
  })

  it('keeps Path stroke shape when Extrude is enabled instead of forcing outline', () => {
    const path = vectorPathToMesh(openPath(), {
      ...baseOpts,
      strokeMode: 'centerline',
      extrudeMode: true,
    })
    expect(path).not.toBeNull()
    expect(path!.name).toBe('Path')
    expect(path!.sketchSource?.kind === 'path' || path!.name === 'Path').toBe(true)
  })

  it('builds capsule via the Sketch capsule doodle path', () => {
    const capsule = vectorPathToMesh(openPath(), { ...baseOpts, strokeMode: 'capsule' })
    expect(capsule).not.toBeNull()
    expect(capsule!.name).toBe('Capsule')
    expect(capsule!.positions.length).toBeGreaterThan(0)
  })
})
