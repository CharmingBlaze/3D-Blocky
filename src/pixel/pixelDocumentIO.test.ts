import { describe, expect, it } from 'vitest'
import { createPixelDocument } from './pixelDocument'
import {
  deserializePixelDocument,
  MAX_PIXEL_DOCUMENT_DIMENSION,
  serializePixelDocument,
} from './pixelDocumentIO'

describe('pixel document I/O validation', () => {
  it('round-trips a valid document', () => {
    const document = createPixelDocument(4, 3, 'round-trip')
    document.layers[0]!.pixels[0] = 255

    const restored = deserializePixelDocument(serializePixelDocument(document))

    expect(restored.id).toBe(document.id)
    expect(restored.layers[0]!.pixels).toEqual(document.layers[0]!.pixels)
  })

  it('rejects non-integer and oversized dimensions before allocating buffers', () => {
    const valid = serializePixelDocument(createPixelDocument(1, 1, 'limits'))
    expect(() => deserializePixelDocument({ ...valid, width: 1.5 })).toThrow(
      'must be integers'
    )
    expect(() =>
      deserializePixelDocument({ ...valid, width: MAX_PIXEL_DOCUMENT_DIMENSION + 1 })
    ).toThrow('must be integers')
  })

  it('rejects duplicate layer ids and a missing active layer', () => {
    const valid = serializePixelDocument(createPixelDocument(1, 1, 'layers'))
    const duplicate = {
      ...valid,
      layers: [valid.layers[0]!, { ...valid.layers[0]!, name: 'Duplicate' }],
    }
    expect(() => deserializePixelDocument(duplicate)).toThrow('duplicate layer id')
    expect(() =>
      deserializePixelDocument({ ...valid, activeLayerId: 'missing' })
    ).toThrow('active layer does not exist')
  })
})
