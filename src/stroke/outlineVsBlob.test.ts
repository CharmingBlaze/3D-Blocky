import { describe, expect, it } from 'vitest'
import { strokeToMesh } from '../stroke/strokeToMesh'
import { regenerateSketchObjectFromSource } from './sketchSource'

const square = [
  { x: -30, y: -30 },
  { x: 30, y: -30 },
  { x: 30, y: 30 },
  { x: -30, y: 30 },
  { x: -30, y: -30 },
]

const base = {
  points: square,
  view: 'front' as const,
  polyBudget: 128,
  brushDensity: 12,
  rdpTolerance: 2,
  closeThreshold: 12,
  defaultDepth: 0,
  color: 0xff0000,
}

describe('outline vs blob stroke modes', () => {
  it('outline fills a flat silhouette, blob fills soft volume', () => {
    const outline = strokeToMesh({ ...base, strokeMode: 'outline' })
    const blob = strokeToMesh({ ...base, strokeMode: 'blob' })
    expect(outline?.name).toBe('Outline')
    expect(outline?.sketchSource?.kind).toBe('outline')
    expect(blob?.name).toBe('Blob')
    expect(blob?.sketchSource?.kind).toBe('soft')
    expect(outline!.positions.length).not.toBe(blob!.positions.length)
    // Flat extrude: ≤20 boundary × 2 faces → well under a dense freehand resample.
    expect(outline!.positions.length).toBeLessThanOrEqual(48)
  })

  it('extrude stays capsule pillow for both modes', () => {
    const extrude = strokeToMesh({
      ...base,
      strokeMode: 'outline',
      extrudeMode: true,
      extrudeAmount: 10,
    })
    const blobExtrude = strokeToMesh({
      ...base,
      strokeMode: 'blob',
      extrudeMode: true,
      extrudeAmount: 10,
    })
    expect(extrude?.name).toBe('Doodle')
    expect(blobExtrude?.name).toBe('Doodle')
    expect(extrude!.positions.length).toBe(blobExtrude!.positions.length)
  })

  it('regenerates retained sketch parameters without changing object identity', () => {
    const original = strokeToMesh({ ...base, strokeMode: 'blob' })!
    const updated = regenerateSketchObjectFromSource(original, {
      brushDensity: 20,
      polyBudget: 196,
      extrudeDepth: 22,
    })!
    expect(updated.id).toBe(original.id)
    expect(updated.sketchSource?.brushDensity).toBe(20)
    expect(updated.sketchSource?.polyBudget).toBe(196)
    expect(updated.sketchSource?.extrudeDepth).toBe(22)
  })
})
