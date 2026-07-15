import { describe, expect, it, beforeEach } from 'vitest'
import {
  beginGizmoPointerCapture,
  endGizmoPointerCapture,
  isGizmoHandlingPointer,
} from './gizmoPointerGate'

describe('gizmoPointerGate', () => {
  beforeEach(() => {
    endGizmoPointerCapture()
  })

  it('is inactive by default', () => {
    expect(isGizmoHandlingPointer()).toBe(false)
  })

  it('tracks begin/end capture', () => {
    beginGizmoPointerCapture()
    expect(isGizmoHandlingPointer()).toBe(true)
    endGizmoPointerCapture()
    expect(isGizmoHandlingPointer()).toBe(false)
  })
})
