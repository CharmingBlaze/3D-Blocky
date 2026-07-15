import { describe, expect, it } from 'vitest'
import {
  canDragComponentSelection,
  canPickComponentSelection,
  isBoxSelectInteraction,
  isComponentSelectionMode,
} from './viewportInteractionUtils'

describe('viewportInteractionUtils component tools', () => {
  it('recognizes vertex/edge/face modes', () => {
    expect(isComponentSelectionMode('vertex')).toBe(true)
    expect(isComponentSelectionMode('edge')).toBe(true)
    expect(isComponentSelectionMode('face')).toBe(true)
    expect(isComponentSelectionMode('object')).toBe(false)
  })

  it('allows picking with select and transform gizmo tools', () => {
    expect(canPickComponentSelection('select-vertex')).toBe(true)
    expect(canPickComponentSelection('select-edge')).toBe(true)
    expect(canPickComponentSelection('select-face')).toBe(true)
    expect(canPickComponentSelection('move')).toBe(true)
    expect(canPickComponentSelection('rotate')).toBe(true)
    expect(canPickComponentSelection('scale')).toBe(true)
    expect(canPickComponentSelection('draw')).toBe(false)
  })

  it('allows free-drag only for select tools and move', () => {
    expect(canDragComponentSelection('select-vertex')).toBe(true)
    expect(canDragComponentSelection('move')).toBe(true)
    expect(canDragComponentSelection('rotate')).toBe(false)
    expect(canDragComponentSelection('scale')).toBe(false)
  })

  it('enables box-select for component modes with all transform gizmos', () => {
    for (const mode of ['vertex', 'edge', 'face'] as const) {
      expect(isBoxSelectInteraction(mode, 'move')).toBe(true)
      expect(isBoxSelectInteraction(mode, 'rotate')).toBe(true)
      expect(isBoxSelectInteraction(mode, 'scale')).toBe(true)
      expect(isBoxSelectInteraction(mode, 'select-vertex')).toBe(true)
    }
  })
})
