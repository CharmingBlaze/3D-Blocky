import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearViewportInvalidationForTests,
  getRegisteredViewportSlotsForTests,
  hasPendingViewportInvalidationForTests,
  invalidateAllViewports,
  invalidateViewport,
  registerViewportInvalidator,
  unregisterViewportInvalidator,
} from '../rendering/viewportInvalidation'
import {
  isViewportInteractionActive,
  isViewportLocalInteractionActive,
  clearViewportInteractionForTests,
  popViewportLocalInteraction,
  pushViewportLocalInteraction,
  pushViewportSharedInteraction,
  popViewportSharedInteraction,
} from '../rendering/viewportFrameLoop'

beforeEach(() => {
  let nextId = 1
  const timers = new Map<number, () => void>()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++
    timers.set(id, () => cb(0))
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    timers.delete(id)
  })
})

afterEach(() => {
  clearViewportInvalidationForTests()
  clearViewportInteractionForTests()
  vi.unstubAllGlobals()
})

describe('viewport invalidation routing', () => {
  it('coalesces invalidateViewport to one pending RAF per slot', () => {
    const invalidate = vi.fn()
    registerViewportInvalidator(0, invalidate, true)

    invalidateViewport(0, 'camera')
    invalidateViewport(0, 'camera')
    invalidateViewport(0, 'hover')

    expect(hasPendingViewportInvalidationForTests(0)).toBe(true)
    expect(getRegisteredViewportSlotsForTests()).toEqual([0])
  })

  it('invalidateAllViewports schedules every visible registered slot', () => {
    const a = vi.fn()
    const b = vi.fn()
    const hidden = vi.fn()
    registerViewportInvalidator(0, a, true)
    registerViewportInvalidator(1, b, true)
    registerViewportInvalidator(2, hidden, false)

    invalidateAllViewports('scene')

    expect(hasPendingViewportInvalidationForTests(0)).toBe(true)
    expect(hasPendingViewportInvalidationForTests(1)).toBe(true)
    expect(hasPendingViewportInvalidationForTests(2)).toBe(false)
  })

  it('camera-style invalidateViewport only touches one slot', () => {
    const a = vi.fn()
    const b = vi.fn()
    registerViewportInvalidator(0, a, true)
    registerViewportInvalidator(1, b, true)

    invalidateViewport(0, 'camera')

    expect(hasPendingViewportInvalidationForTests(0)).toBe(true)
    expect(hasPendingViewportInvalidationForTests(1)).toBe(false)
  })

  it('hover-style invalidateViewport only touches one slot', () => {
    const a = vi.fn()
    const b = vi.fn()
    registerViewportInvalidator(0, a, true)
    registerViewportInvalidator(1, b, true)

    invalidateViewport(1, 'hover')

    expect(hasPendingViewportInvalidationForTests(0)).toBe(false)
    expect(hasPendingViewportInvalidationForTests(1)).toBe(true)
  })

  it('unregister cancels pending work for that slot', () => {
    const invalidate = vi.fn()
    registerViewportInvalidator(0, invalidate, true)
    invalidateViewport(0, 'scene')
    unregisterViewportInvalidator(0, invalidate)
    expect(hasPendingViewportInvalidationForTests(0)).toBe(false)
    expect(getRegisteredViewportSlotsForTests()).toEqual([])
  })
})

describe('viewport-scoped interaction', () => {
  it('local camera interaction is per-slot', () => {
    pushViewportLocalInteraction(0)
    expect(isViewportLocalInteractionActive(0)).toBe(true)
    expect(isViewportLocalInteractionActive(1)).toBe(false)
    expect(isViewportInteractionActive(0)).toBe(true)
    expect(isViewportInteractionActive(1)).toBe(false)
    popViewportLocalInteraction(0)
    expect(isViewportInteractionActive(0)).toBe(false)
  })

  it('shared mesh edits are per-slot and do not imply local on peers', () => {
    pushViewportSharedInteraction(0)
    expect(isViewportInteractionActive(0)).toBe(true)
    expect(isViewportLocalInteractionActive(1)).toBe(false)
    popViewportSharedInteraction(0)
  })
})
