import { describe, expect, it } from 'vitest'
import { HalfEdgeMesh } from '../mesh/HalfEdgeMesh'
import { countNakedEdges } from '../mesh/meshWinding'
import { strokeToMesh } from './strokeToMesh'
import { regenerateSketchObjectFromSource } from './sketchSource'

const base = {
  points: Array.from({ length: 12 }, (_, index) => ({ x: index * 8, y: Math.sin(index * 0.3) * 4 })),
  view: 'front' as const,
  polyBudget: 128,
  brushDensity: 12,
  rdpTolerance: 1,
  closeThreshold: 6,
  defaultDepth: 0,
  color: 0x66ccff,
}

describe('Path generator settings', () => {
  it('creates a small perfectly straight two-point sketch path', () => {
    const object = strokeToMesh({ ...base, points: [{x:10,y:10},{x:10,y:14}], strokeMode:'centerline' })
    expect(object).not.toBeNull()
    expect(object!.sketchSource?.relative).toHaveLength(2)
    expect(object!.positions.length).toBeGreaterThan(0)
  })
  it('supports independent open and flat ends', () => {
    const object = strokeToMesh({
      ...base,
      strokeMode: 'centerline',
      pathStartCap: 'flat',
      pathEndCap: 'open',
      pathRadialSegments: 12,
      pathRadiusScale: 1.5,
    })!
    const mesh = HalfEdgeMesh.fromObject(object)
    expect(mesh.faces.filter((face) => face.length === 12)).toHaveLength(1)
    expect(countNakedEdges(mesh)).toBe(12)
    expect(object.sketchSource?.pathStartCap).toBe('flat')
    expect(object.sketchSource?.pathEndCap).toBe('open')
    expect(object.sketchSource?.pathRadiusScale).toBe(1.5)
  })

  it('round caps use more geometry than pointed caps and regenerate', () => {
    const pointed = strokeToMesh({ ...base, strokeMode: 'centerline', pathStartCap: 'pointed', pathEndCap: 'pointed' })!
    const rounded = strokeToMesh({ ...base, strokeMode: 'centerline', pathStartCap: 'round', pathEndCap: 'round' })!
    expect(rounded.positions.length).toBeGreaterThan(pointed.positions.length)
    const regenerated = regenerateSketchObjectFromSource(pointed, { pathStartCap: 'open', pathEndCap: 'round' })!
    expect(regenerated.sketchSource?.pathStartCap).toBe('open')
    expect(regenerated.sketchSource?.pathEndCap).toBe('round')
  })
})

describe('Ribbon generator settings', () => {
  it('supports asymmetric ends, taper, width, and flat image-card output', () => {
    const flat = strokeToMesh({
      ...base,
      strokeMode: 'ribbon',
      extrudeAmount: 18,
      ribbonStartTip: 'pointed',
      ribbonEndTip: 'square',
      ribbonTaper: 0.2,
      ribbonWidthScale: 1.75,
      ribbonFlat: true,
    })!
    const solid = strokeToMesh({ ...base, strokeMode: 'ribbon', ribbonFlat: false })!
    expect(flat.sketchSource?.ribbonStartTip).toBe('pointed')
    expect(flat.sketchSource?.ribbonEndTip).toBe('square')
    expect(flat.sketchSource?.ribbonTaper).toBe(0.2)
    expect(flat.sketchSource?.ribbonWidthScale).toBe(1.75)
    expect(flat.sketchSource?.ribbonFlat).toBe(true)
    expect(flat.positions.every((point) => Math.abs(point.z) < 1e-6)).toBe(true)
    expect(solid.positions.some((point) => Math.abs(point.z) > 0.1)).toBe(true)
  })

  it('regenerates ribbon settings without losing its procedural kind', () => {
    const ribbon = strokeToMesh({ ...base, strokeMode: 'ribbon' })!
    const regenerated = regenerateSketchObjectFromSource(ribbon, {
      ribbonStartTip: 'pointed',
      ribbonWidthScale: 2,
      ribbonFlat: true,
    })!
    expect(regenerated.sketchSource?.kind).toBe('ribbon')
    expect(regenerated.sketchSource?.ribbonStartTip).toBe('pointed')
    expect(regenerated.sketchSource?.ribbonWidthScale).toBe(2)
    expect(regenerated.sketchSource?.ribbonFlat).toBe(true)
  })
})

describe('updated Sketch Capsule',()=>{
  it('creates a precise straight open capsule instead of treating it as a hole',()=>{
    const capsule=strokeToMesh({...base,points:[{x:0,y:0},{x:0,y:18}],strokeMode:'capsule',extrudeAmount:4,pathRadialSegments:10})
    expect(capsule).not.toBeNull()
    expect(capsule!.name).toBe('Capsule')
    expect(capsule!.sketchSource?.kind).toBe('capsule-path')
    expect(capsule!.sketchSource?.relative).toHaveLength(2)
    expect(capsule!.uvs?.length).toBeGreaterThan(0)
  })
  it('keeps Capsule semantics even when the shared Extrude toggle is on',()=>{
    const capsule=strokeToMesh({
      ...base,
      points:[{x:0,y:0},{x:0,y:18}],
      strokeMode:'capsule',
      extrudeMode:true,
      extrudeAmount:4,
      pathRadialSegments:10,
    })
    expect(capsule).not.toBeNull()
    expect(capsule!.name).toBe('Capsule')
    expect(capsule!.sketchSource?.kind).toBe('capsule-path')
  })
  it('retains and regenerates closed capsule volumes',()=>{
    const capsule=strokeToMesh({...base,points:[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20},{x:0,y:0}],strokeMode:'capsule',extrudeAmount:6})!
    expect(capsule.sketchSource?.kind).toBe('capsule-shape')
    expect(capsule.positions.length).toBeGreaterThan(24)
    expect(capsule.positions.length).toBeLessThan(200)
    const regenerated=regenerateSketchObjectFromSource(capsule,{extrudeDepth:10,pathRadialSegments:12})!
    expect(regenerated.id).toBe(capsule.id)
    expect(regenerated.sketchSource?.kind).toBe('capsule-shape')
    expect(regenerated.sketchSource?.extrudeDepth).toBe(10)
  })
})
