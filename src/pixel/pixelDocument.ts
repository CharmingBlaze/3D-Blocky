import { generateId } from '../utils/math'
import type { PixelDocument, PixelLayer } from './pixelTypes'

export function createEmptyLayer(width: number, height: number, name = 'Layer'): PixelLayer {
  return {
    id: generateId(),
    name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    pixels: new Uint8ClampedArray(width * height * 4),
  }
}

export function createPixelDocument(
  width: number,
  height: number,
  id?: string,
  name = 'Layer 1'
): PixelDocument {
  const layer = createEmptyLayer(width, height, name)
  return {
    id: id ?? generateId(),
    width,
    height,
    layers: [layer],
    activeLayerId: layer.id,
  }
}

export function clonePixelLayer(layer: PixelLayer): PixelLayer {
  return {
    ...layer,
    pixels: new Uint8ClampedArray(layer.pixels),
  }
}

export function clonePixelDocument(doc: PixelDocument): PixelDocument {
  return {
    ...doc,
    layers: doc.layers.map(clonePixelLayer),
  }
}

export function clonePixelDocuments(
  docs: Record<string, PixelDocument>
): Record<string, PixelDocument> {
  const out: Record<string, PixelDocument> = {}
  for (const [id, doc] of Object.entries(docs)) {
    out[id] = clonePixelDocument(doc)
  }
  return out
}

export function getActiveLayer(doc: PixelDocument): PixelLayer | null {
  return doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0] ?? null
}

export function documentFromImageData(
  id: string,
  imageData: ImageData,
  name = 'Imported'
): PixelDocument {
  const layer = createEmptyLayer(imageData.width, imageData.height, name)
  layer.pixels.set(imageData.data)
  return {
    id,
    width: imageData.width,
    height: imageData.height,
    layers: [layer],
    activeLayerId: layer.id,
  }
}

export async function loadImageFileToImageData(file: File): Promise<ImageData> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Failed to load image'))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(img, 0, 0)
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function resizePixelDocument(doc: PixelDocument, width: number, height: number): PixelDocument {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const layers = doc.layers.map((layer) => {
    const layerCanvas = document.createElement('canvas')
    layerCanvas.width = doc.width
    layerCanvas.height = doc.height
    const lctx = layerCanvas.getContext('2d')!
    const imageData = new ImageData(new Uint8ClampedArray(layer.pixels), doc.width, doc.height)
    lctx.putImageData(imageData, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(layerCanvas, 0, 0, width, height)
    const resized = ctx.getImageData(0, 0, width, height)
    return { ...layer, pixels: new Uint8ClampedArray(resized.data) }
  })
  return { ...doc, width, height, layers }
}
