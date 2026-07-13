import { describe, expect, it } from 'vitest'
import {
  uvEditorPanCssFromPainted,
  uvEditorPanFromScrollRatio,
  uvEditorScrollAxisMetrics,
  uvEditorScrollDocSpan,
  uvEditorZoomAtScreenPoint,
} from './uvEditorView'

describe('uvEditorView camera', () => {
  it('builds a CSS pan delta from the painted camera', () => {
    expect(
      uvEditorPanCssFromPainted(
        { panX: 10, panY: 20, zoom: 2 },
        { panX: 40, panY: 10, zoom: 2 }
      )
    ).toBe('translate3d(30px, -10px, 0)')
    expect(
      uvEditorPanCssFromPainted(
        { panX: 1, panY: 2, zoom: 1 },
        { panX: 1, panY: 2, zoom: 1 }
      )
    ).toBe('')
  })

  it('keeps the UV under the mouse fixed while zooming', () => {
    const start = { panX: 40, panY: 20, zoom: 1 }
    const mouse = { x: 200, y: 150 }
    const uvBefore = {
      u: (mouse.x - start.panX) / start.zoom,
      v: (mouse.y - start.panY) / start.zoom,
    }
    const next = uvEditorZoomAtScreenPoint(start, mouse.x, mouse.y, 2.5)
    const uvAfter = {
      u: (mouse.x - next.panX) / next.zoom,
      v: (mouse.y - next.panY) / next.zoom,
    }
    expect(uvAfter.u).toBeCloseTo(uvBefore.u, 8)
    expect(uvAfter.v).toBeCloseTo(uvBefore.v, 8)
  })

  it('maps scrollbar thumb travel to camera pan', () => {
    const { doc0, span } = uvEditorScrollDocSpan(64)
    expect(span).toBe(128)
    const { range, panPerPx, thumb, track } = uvEditorScrollAxisMetrics(400, 4, span)
    expect(range).toBeGreaterThan(0)
    expect(thumb).toBeLessThan(track)
    expect(panPerPx).toBeGreaterThan(0)

    const panAtStart = uvEditorPanFromScrollRatio(doc0, range, 0, 4)
    const panAtEnd = uvEditorPanFromScrollRatio(doc0, range, 1, 4)
    expect(-panAtStart / 4).toBeCloseTo(doc0, 8)
    expect(-panAtEnd / 4).toBeCloseTo(doc0 + range, 8)
  })
})
