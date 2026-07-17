import { describe, expect, it } from 'vitest'
import { activeExtrudeMode, activeLatheCaps, activeLatheMode } from './drawExtrudeMode'

describe('shared draw Extrude / Lathe state', () => {
  it('treats Sketch and Vector Pen Extrude as one shared toggle', () => {
    expect(
      activeExtrudeMode({
        drawInputMode: 'vector-pen',
        sketchExtrudeMode: true,
        penExtrudeMode: true,
      })
    ).toBe(true)
    expect(
      activeExtrudeMode({
        drawInputMode: 'regular',
        sketchExtrudeMode: false,
        penExtrudeMode: false,
      })
    ).toBe(false)
  })

  it('treats Lathe and caps as shared across draw inputs', () => {
    const on = {
      drawInputMode: 'vector-pen' as const,
      sketchExtrudeMode: false,
      penExtrudeMode: false,
      sketchLatheMode: true,
      penLatheMode: true,
      sketchLatheCaps: true,
      penLatheCaps: true,
    }
    expect(activeLatheMode(on)).toBe(true)
    expect(activeLatheCaps(on)).toBe(true)
  })
})
