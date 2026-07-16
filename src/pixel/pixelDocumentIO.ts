import { clonePixelDocument } from './pixelDocument'
import type { PixelBlendMode, PixelDocument, PixelLayer } from './pixelTypes'

export const MAX_PIXEL_DOCUMENT_DIMENSION = 4096
export const MAX_PIXEL_DOCUMENT_LAYERS = 64
export const MAX_PIXEL_DOCUMENT_BYTES = 512 * 1024 * 1024

export interface SerializedPixelDocument {
  version: 1
  id: string
  width: number
  height: number
  activeLayerId: string
  layers: Array<{
    id: string
    name: string
    visible: boolean
    opacity: number
    blendMode: PixelBlendMode
    pixelsBase64: string
  }>
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function serializePixelDocument(doc: PixelDocument): SerializedPixelDocument {
  return {
    version: 1,
    id: doc.id,
    width: doc.width,
    height: doc.height,
    activeLayerId: doc.activeLayerId,
    layers: doc.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      pixelsBase64: bytesToBase64(new Uint8Array(layer.pixels.buffer, layer.pixels.byteOffset, layer.pixels.byteLength)),
    })),
  }
}

export function deserializePixelDocument(data: SerializedPixelDocument): PixelDocument {
  if (!data || typeof data !== 'object') throw new Error('Invalid pixel document.')
  if (data.version !== 1) throw new Error('Unsupported pixel document version.')
  if (
    !Number.isInteger(data.width) ||
    !Number.isInteger(data.height) ||
    data.width <= 0 ||
    data.height <= 0 ||
    data.width > MAX_PIXEL_DOCUMENT_DIMENSION ||
    data.height > MAX_PIXEL_DOCUMENT_DIMENSION
  ) {
    throw new Error(
      `Invalid pixel document: width and height must be integers from 1 to ${MAX_PIXEL_DOCUMENT_DIMENSION}.`
    )
  }
  if (
    !Array.isArray(data.layers) ||
    data.layers.length === 0 ||
    data.layers.length > MAX_PIXEL_DOCUMENT_LAYERS
  ) {
    throw new Error('Invalid pixel document: missing layers.')
  }
  const expectedBytes = data.width * data.height * 4
  if (expectedBytes * data.layers.length > MAX_PIXEL_DOCUMENT_BYTES) {
    throw new Error('Invalid pixel document: decoded layers exceed the memory limit.')
  }
  const layerIds = new Set<string>()
  const layers: PixelLayer[] = data.layers.map((layer, index) => {
    if (
      !layer ||
      typeof layer !== 'object' ||
      typeof layer.id !== 'string' ||
      layer.id.length === 0 ||
      typeof layer.name !== 'string' ||
      typeof layer.visible !== 'boolean' ||
      !Number.isFinite(layer.opacity) ||
      layer.opacity < 0 ||
      layer.opacity > 1 ||
      !['normal', 'multiply', 'add', 'screen'].includes(layer.blendMode) ||
      typeof layer.pixelsBase64 !== 'string'
    ) {
      throw new Error(`Invalid pixel layer ${index + 1}: malformed layer data.`)
    }
    if (layerIds.has(layer.id)) {
      throw new Error(`Invalid pixel layer "${layer.name}": duplicate layer id.`)
    }
    layerIds.add(layer.id)
    const maxEncodedLength = Math.ceil(expectedBytes / 3) * 4 + 4
    if (layer.pixelsBase64.length > maxEncodedLength) {
      throw new Error(`Invalid pixel layer "${layer.name}": encoded image data is too large.`)
    }
    let pixels: Uint8ClampedArray
    try {
      pixels = new Uint8ClampedArray(base64ToBytes(layer.pixelsBase64))
    } catch {
      throw new Error(`Invalid pixel layer "${layer.name || String(index + 1)}": could not decode image data.`)
    }
    if (pixels.length !== expectedBytes) {
      throw new Error(
        `Invalid pixel layer "${layer.name || String(index + 1)}": expected ${expectedBytes} bytes, got ${pixels.length}.`
      )
    }
    return {
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      pixels,
    }
  })
  if (typeof data.id !== 'string' || data.id.length === 0) {
    throw new Error('Invalid pixel document: missing id.')
  }
  if (typeof data.activeLayerId !== 'string' || !layerIds.has(data.activeLayerId)) {
    throw new Error('Invalid pixel document: active layer does not exist.')
  }
  return clonePixelDocument({
    id: data.id,
    width: data.width,
    height: data.height,
    layers,
    activeLayerId: data.activeLayerId,
  })
}

export function parsePixelDocumentFile(text: string): PixelDocument {
  let parsed: SerializedPixelDocument
  try {
    parsed = JSON.parse(text) as SerializedPixelDocument
  } catch {
    throw new Error('Invalid pixel project file: not valid JSON.')
  }
  return deserializePixelDocument(parsed)
}
