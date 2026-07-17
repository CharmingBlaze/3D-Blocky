import { describe, expect, it } from 'vitest'
import type { SceneObject } from './HalfEdgeMesh'
import { applyBendToObject, bendArcPoint } from './bendDeform'

function object(positions: SceneObject['positions'], transform?: SceneObject['transform']): SceneObject {
  return {
    id: 'bend',
    name: 'Bend',
    positions,
    faces: [],
    faceColors: [],
    topologyLocked: false,
    polyBudget: 128,
    polyBudgetMode: 'adaptive',
    smoothShading: false,
    facetExaggeration: 0,
    color: 0xffffff,
    pivot: { x: 0, y: 0, z: 0 },
    transform,
  }
}

describe('view-aware arc bend', () => {
  it('maps the drawn span onto a circular arc', () => {
    const radius = 10 / (Math.PI / 2)
    const midpoint = bendArcPoint(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      10,
      { x: 0, y: 0, z: 1 },
      Math.PI / 2,
      0.5
    )
    expect(midpoint.x).toBeCloseTo(radius * Math.sin(Math.PI / 4), 5)
    expect(midpoint.y).toBeCloseTo(radius * (1 - Math.cos(Math.PI / 4)), 5)
  })

  it('keeps vertices before the span fixed and carries vertices after it along the end tangent', () => {
    const source = object([
      { x: -2, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 15, y: 0, z: 0 },
    ])
    const result = applyBendToObject(source, {
      axisOrigin: { x: 0, y: 0, z: 0 },
      axisDirection: { x: 1, y: 0, z: 0 },
      span: 10,
      bendNormal: { x: 0, y: 0, z: 1 },
      angle: Math.PI / 2,
    })
    const radius = 10 / (Math.PI / 2)

    expect(result[0]).toEqual(source.positions[0])
    expect(result[1]).toEqual(source.positions[1])
    expect(result[2]!.x).toBeCloseTo(radius, 5)
    expect(result[2]!.y).toBeCloseTo(radius, 5)
    expect(result[3]!.x).toBeCloseTo(radius, 5)
    expect(result[3]!.y).toBeCloseTo(radius + 5, 5)
  })

  it('bends correctly when the object has a world transform', () => {
    const source = object(
      [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
      {
        position: { x: 20, y: 5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      }
    )
    const result = applyBendToObject(source, {
      axisOrigin: { x: 20, y: 5, z: 0 },
      axisDirection: { x: 1, y: 0, z: 0 },
      span: 10,
      bendNormal: { x: 0, y: 0, z: 1 },
      angle: Math.PI / 2,
    })
    const radius = 10 / (Math.PI / 2)

    expect(result[0]).toEqual(source.positions[0])
    expect(result[1]!.x).toBeCloseTo(radius, 5)
    expect(result[1]!.y).toBeCloseTo(radius, 5)
  })
})
