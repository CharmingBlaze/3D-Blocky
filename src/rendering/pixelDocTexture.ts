/**
 * Single source of truth per pixel document: flattened RGBA buffer + THREE.DataTexture.
 * The CPU composite and GPU texture share one ArrayBuffer — no duplicate copy on paint.
 */

import * as THREE from 'three'
import { rgbaBufferHasAlpha, rgbaBufferRegionHasAlpha } from '../images/imageAlpha'
import type { PixelDirtyRect } from '../pixel/pixelDirtyRect'
import { invalidateAllViewports } from './viewportInvalidation'

export type PixelDocTextureEntry = {
  texture: THREE.DataTexture
  /** View on texture.image.data — composite writes here directly. */
  pixels: Uint8ClampedArray
  width: number
  height: number
  version: number
}

const entries = new Map<string, PixelDocTextureEntry>()
const pixelDocHasAlpha = new Map<string, boolean>()
const previewListeners = new Map<string, Set<(dirty: PixelDirtyRect | null) => void>>()
const dataListeners = new Map<string, Set<() => void>>()
const pixelListeners = new Map<string, Set<() => void>>()

type WebGLTextureProps = {
  __webglInit?: unknown
  __webglTexture?: WebGLTexture
  __version?: number
}

const webglRenderers = new Set<THREE.WebGLRenderer>()

export function registerWebGLRenderer(renderer: THREE.WebGLRenderer): void {
  webglRenderers.add(renderer)
}

export function unregisterWebGLRenderer(renderer: THREE.WebGLRenderer): void {
  webglRenderers.delete(renderer)
}

function clampedView(data: Uint8Array): Uint8ClampedArray {
  return new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
}

function createEntry(docId: string, width: number, height: number, seed?: Uint8ClampedArray): PixelDocTextureEntry {
  const len = width * height * 4
  const data = new Uint8Array(len)
  if (seed && seed.length === len) data.set(seed)
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.flipY = true
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.needsUpdate = true
  const entry: PixelDocTextureEntry = {
    texture,
    pixels: clampedView(data),
    width,
    height,
    version: seed ? 1 : 0,
  }
  entries.set(docId, entry)
  return entry
}

/** Ensure a shared CPU/GPU buffer exists for this document. */
export function ensurePixelDocBuffer(
  docId: string,
  width: number,
  height: number,
  seed?: Uint8ClampedArray
): Uint8ClampedArray {
  const prev = entries.get(docId)
  const len = width * height * 4
  if (prev && prev.width === width && prev.height === height && prev.pixels.length === len) {
    return prev.pixels
  }
  prev?.texture.dispose()
  return createEntry(docId, width, height, seed).pixels
}

export function getPixelDocTextureEntry(docId: string): PixelDocTextureEntry | undefined {
  return entries.get(docId)
}

/** Legacy alias — same buffer as the flattened composite. */
export function getPixelCompositeCache(docId: string): PixelDocTextureEntry | undefined {
  return entries.get(docId)
}

export function acquirePixelCompositeBuffer(
  docId: string,
  width: number,
  height: number
): Uint8ClampedArray {
  return ensurePixelDocBuffer(docId, width, height)
}

function notifyPreview(docId: string, dirty: PixelDirtyRect | null): void {
  const entry = entries.get(docId)
  if (entry) entry.version += 1
  previewListeners.get(docId)?.forEach((fn) => fn(dirty))
}

export function setPixelCompositeCache(
  docId: string,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  dirty: PixelDirtyRect | null = null
): PixelDocTextureEntry {
  const entry = entries.get(docId)
  if (!entry || entry.width !== width || entry.height !== height) {
    ensurePixelDocBuffer(docId, width, height, pixels)
    notifyPreview(docId, null)
    return entries.get(docId)!
  }
  if (entry.pixels !== pixels) entry.pixels.set(pixels)
  notifyPreview(docId, dirty)
  return entry
}

export function subscribePixelCompositeCache(
  docId: string,
  fn: (dirty: PixelDirtyRect | null) => void
): () => void {
  let set = previewListeners.get(docId)
  if (!set) {
    set = new Set()
    previewListeners.set(docId, set)
  }
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (set!.size === 0) previewListeners.delete(docId)
  }
}

export function subscribePixelDocumentPreview(
  docId: string,
  fn: (dirty: PixelDirtyRect | null) => void
): () => void {
  return subscribePixelCompositeCache(docId, fn)
}

export function clearPixelCompositeCache(docId: string): void {
  const entry = entries.get(docId)
  entry?.texture.dispose()
  entries.delete(docId)
  pixelDocHasAlpha.delete(docId)
  previewListeners.delete(docId)
  dataListeners.delete(docId)
  pixelListeners.delete(docId)
}

function uploadDirtyTextureRegion(tex: THREE.DataTexture, dirty: PixelDirtyRect): boolean {
  if (webglRenderers.size === 0 || dirty.w <= 0 || dirty.h <= 0) return false

  let allSuccess = true
  const image = tex.image as { data: Uint8Array; width: number; height: number }
  const { width, height } = image

  for (const renderer of webglRenderers) {
    const properties = renderer.properties as {
      get(texture: THREE.Texture): WebGLTextureProps
    }
    const texProps = properties.get(tex)
    if (texProps.__webglInit === undefined || !texProps.__webglTexture) {
      allSuccess = false
      continue
    }

    const gl = renderer.getContext()
    gl.bindTexture(gl.TEXTURE_2D, texProps.__webglTexture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, tex.flipY ? 1 : 0)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)

    // WebGL2 can upload a strided rectangle directly from the shared document
    // buffer. This replaces one texSubImage2D call per row with one call per frame.
    if (renderer.capabilities.isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext
      gl2.pixelStorei(gl2.UNPACK_ROW_LENGTH, width)
      gl2.pixelStorei(gl2.UNPACK_SKIP_PIXELS, dirty.x)
      gl2.pixelStorei(gl2.UNPACK_SKIP_ROWS, dirty.y)
      gl2.texSubImage2D(
        gl2.TEXTURE_2D,
        0,
        dirty.x,
        tex.flipY ? height - dirty.y - dirty.h : dirty.y,
        dirty.w,
        dirty.h,
        gl2.RGBA,
        gl2.UNSIGNED_BYTE,
        image.data
      )
      gl2.pixelStorei(gl2.UNPACK_ROW_LENGTH, 0)
      gl2.pixelStorei(gl2.UNPACK_SKIP_PIXELS, 0)
      gl2.pixelStorei(gl2.UNPACK_SKIP_ROWS, 0)
      texProps.__version = tex.version
    } else {
      for (let row = 0; row < dirty.h; row++) {
        const srcY = dirty.y + row
        const gpuY = tex.flipY ? height - srcY - 1 : srcY
        const start = (srcY * width + dirty.x) * 4
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          dirty.x,
          gpuY,
          dirty.w,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          image.data.subarray(start, start + dirty.w * 4)
        )
      }
      texProps.__version = tex.version
    }
  }

  return allSuccess
}

/** Push dirty (or full) GPU upload. Skips CPU copy when pixels are the shared buffer. */
export function uploadPixelDocGpu(
  docId: string,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  dirty: PixelDirtyRect | null = null
): void {
  const entry = entries.get(docId)
  const shared = entry?.pixels === pixels
  let tex = entry?.texture
  const hasLiveConsumer =
    (dataListeners.get(docId)?.size ?? 0) > 0 || (pixelListeners.get(docId)?.size ?? 0) > 0

  const prevAlpha = pixelDocHasAlpha.get(docId) ?? false
  const nextAlpha = dirty
    ? prevAlpha || rgbaBufferRegionHasAlpha(pixels, width, dirty)
    : rgbaBufferHasAlpha(pixels)
  pixelDocHasAlpha.set(docId, nextAlpha)

  let identityChanged = false
  if (!tex || tex.image.width !== width || tex.image.height !== height) {
    ensurePixelDocBuffer(docId, width, height, pixels)
    tex = entries.get(docId)!.texture
    identityChanged = true
  } else if (!shared) {
    const image = tex.image as { data: Uint8Array; width: number; height: number }
    image.data.set(pixels)
    tex.needsUpdate = true
  } else if (dirty && dirty.w > 0 && dirty.h > 0) {
    // Keep the shared CPU texture current, but do not wake every viewport for a
    // document that is not displayed by any mounted mesh. A later consumer will
    // receive the complete buffer through the normal needsUpdate path.
    if (!hasLiveConsumer) {
      tex.needsUpdate = true
      return
    }
    if (uploadDirtyTextureRegion(tex, dirty)) {
      invalidateAllViewports('pixel-texture')
      if (prevAlpha !== nextAlpha) pixelListeners.get(docId)?.forEach((fn) => fn())
      dataListeners.get(docId)?.forEach((fn) => fn())
      return
    }
    tex.needsUpdate = true
  } else if (!dirty) {
    tex.needsUpdate = true
  }

  invalidateAllViewports('pixel-texture')
  if (identityChanged || prevAlpha !== nextAlpha) {
    pixelListeners.get(docId)?.forEach((fn) => fn())
  }
  dataListeners.get(docId)?.forEach((fn) => fn())
}

export function getPixelDocumentTexture(docId: string): THREE.DataTexture | undefined {
  return entries.get(docId)?.texture
}

export function pixelDocumentTextureHasAlpha(docId: string): boolean {
  return pixelDocHasAlpha.get(docId) ?? false
}

export function subscribePixelDocumentTexture(docId: string, fn: () => void): () => void {
  let set = dataListeners.get(docId)
  if (!set) {
    set = new Set()
    dataListeners.set(docId, set)
  }
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (set!.size === 0) dataListeners.delete(docId)
  }
}

function subscribePixelDoc(docId: string, fn: () => void): () => void {
  let set = pixelListeners.get(docId)
  if (!set) {
    set = new Set()
    pixelListeners.set(docId, set)
  }
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (set!.size === 0) pixelListeners.delete(docId)
  }
}

export function releasePixelDocTexture(docId: string): void {
  clearPixelCompositeCache(docId)
}

export function releasePixelDocumentTexture(docId: string): void {
  releasePixelDocTexture(docId)
}

/** Legacy name for GPU upload after composite. */
export function uploadPixelDocumentTexture(
  docId: string,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  dirty: PixelDirtyRect | null = null
): void {
  uploadPixelDocGpu(docId, pixels, width, height, dirty)
}

export function getPixelDocTextureIds(): string[] {
  return [...entries.keys()]
}

/** Drop GPU textures for pixel docs no longer in app state or undo history. */
export function reconcilePixelDocumentCache(activeIds: Set<string>): void {
  for (const docId of getPixelDocTextureIds()) {
    if (!activeIds.has(docId)) releasePixelDocTexture(docId)
  }
}

export { subscribePixelDoc }
