import { describe, expect, it } from 'vitest'
import {
  pixelDocumentTextureHasAlpha,
  releasePixelDocumentTexture,
  uploadPixelDocumentTexture,
} from './textureCache'

describe('pixelDocumentTextureHasAlpha', () => {
  it('tracks alpha from uploaded composites', () => {
    const id = 'alpha-doc'
    const opaque = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255])
    uploadPixelDocumentTexture(id, opaque, 2, 1)
    expect(pixelDocumentTextureHasAlpha(id)).toBe(false)

    const withHole = new Uint8ClampedArray([1, 2, 3, 255, 0, 0, 0, 0])
    uploadPixelDocumentTexture(id, withHole, 2, 1)
    expect(pixelDocumentTextureHasAlpha(id)).toBe(true)

    releasePixelDocumentTexture(id)
    expect(pixelDocumentTextureHasAlpha(id)).toBe(false)
  })
})
