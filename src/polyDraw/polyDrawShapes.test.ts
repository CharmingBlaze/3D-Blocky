import { describe, expect, it } from 'vitest'
import { VIEW_AXIS_TABLE, axisComponent } from '../primitives/viewAxes'
import type { OrthoViewType } from '../scene/viewTypes'
import { rectangleWorldPoints, regularPolygonWorldPoints } from './polyDrawShapes'

describe('SketchUp-style poly draw shapes', () => {
  it.each(['front', 'back', 'left', 'right', 'top', 'bottom'] as OrthoViewType[])(
    'builds a four-corner rectangle in the %s work plane',
    (view) => {
      const mapping = VIEW_AXIS_TABLE[view]
      const points = rectangleWorldPoints(
        { x: -2, y: 3, z: 4 },
        { x: 5, y: -6, z: -7 },
        view
      )
      expect(points).toHaveLength(4)
      const depth = axisComponent(points[0]!, mapping.d)
      expect(points.every((point) => axisComponent(point, mapping.d) === depth)).toBe(true)
      expect(new Set(points.map((point) => axisComponent(point, mapping.h))).size).toBe(2)
      expect(new Set(points.map((point) => axisComponent(point, mapping.v))).size).toBe(2)
    }
  )

  it('builds a six-sided polygon from centre and radius', () => {
    const points = regularPolygonWorldPoints(
      { x: 0, y: 0, z: 2 },
      { x: 4, y: 0, z: 2 },
      'front'
    )
    expect(points).toHaveLength(6)
    for (const point of points) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(4)
      expect(point.z).toBe(2)
    }
  })

  it('keeps perspective rectangles on the inferred ground plane', () => {
    const points = rectangleWorldPoints(
      { x: -2, y: 3, z: -4 },
      { x: 5, y: 3, z: 7 },
      'perspective'
    )
    expect(points).toHaveLength(4)
    expect(points.every((point) => point.y === 3)).toBe(true)
  })
})
