import { describe, expect, it } from 'vitest'
import type * as THREE from 'three'
import {
  registerWebGLRenderer,
  registeredWebGLRendererCount,
  unregisterWebGLRenderer,
} from './pixelDocTexture'

describe('pixel document WebGL renderer registry', () => {
  it('deduplicates registrations and releases renderer ownership on cleanup', () => {
    // The registry only uses renderer identity; a GPU context is unnecessary for this unit test.
    const renderer = {} as THREE.WebGLRenderer
    const initialCount = registeredWebGLRendererCount()

    registerWebGLRenderer(renderer)
    registerWebGLRenderer(renderer)
    expect(registeredWebGLRendererCount()).toBe(initialCount + 1)

    unregisterWebGLRenderer(renderer)
    expect(registeredWebGLRendererCount()).toBe(initialCount)
  })
})
