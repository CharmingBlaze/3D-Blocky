import { clonePixelDocument } from './pixelDocument'
import type { PixelBlendMode, PixelDocument, PixelLayer } from './pixelTypes'

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
  if (data.version !== 1) throw new Error('Unsupported pixel document version.')
  const layers: PixelLayer[] = data.layers.map((layer) => ({
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    pixels: new Uint8ClampedArray(base64ToBytes(layer.pixelsBase64)),
  }))
  return clonePixelDocument({
    id: data.id,
    width: data.width,
    height: data.height,
    layers,
    activeLayerId: data.activeLayerId,
  })
}

export function parsePixelDocumentFile(text: string): PixelDocument {
  const parsed = JSON.parse(text) as SerializedPixelDocument
  return deserializePixelDocument(parsed)
}
