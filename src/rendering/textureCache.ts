import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { rgbaBufferHasAlpha } from '../images/imageAlpha'
import { clearPixelCompositeCache } from '../pixel/pixelCompositeCache'
import { invalidateAllViewports } from './viewportInvalidation'

const cache = new Map<string, THREE.Texture>()
const pixelDocCache = new Map<string, THREE.DataTexture>()
const pixelDocHasAlpha = new Map<string, boolean>()
const loadListeners = new Map<string, Set<() => void>>()
const pixelListeners = new Map<string, Set<() => void>>()

function notifyLoaded(url: string): void {
  loadListeners.get(url)?.forEach((fn) => fn())
}

function subscribeLoad(url: string, fn: () => void): () => void {
  let set = loadListeners.get(url)
  if (!set) {
    set = new Set()
    loadListeners.set(url, set)
  }
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (set!.size === 0) loadListeners.delete(url)
  }
}

function isTextureReady(tex: THREE.Texture): boolean {
  const img = tex.image as HTMLImageElement | undefined
  return Boolean(img && img.complete && img.naturalWidth > 0)
}

/** Upload flattened pixel-document RGBA to a live GPU texture (nearest filtering). */
export function uploadPixelDocumentTexture(
  docId: string,
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): void {
  let tex = pixelDocCache.get(docId)
  const prevAlpha = pixelDocHasAlpha.get(docId) ?? false
  const nextAlpha = rgbaBufferHasAlpha(pixels)
  pixelDocHasAlpha.set(docId, nextAlpha)
  let identityChanged = false
  if (!tex || tex.image.width !== width || tex.image.height !== height) {
    tex?.dispose()
    // DataTexture requires Uint8Array; copy once on create. Updates reuse image.data.
    const data = new Uint8Array(pixels)
    tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.flipY = true
    tex.minFilter = THREE.NearestFilter
    tex.magFilter = THREE.NearestFilter
    tex.needsUpdate = true
    pixelDocCache.set(docId, tex)
    identityChanged = true
  } else {
    const image = tex.image as { data: Uint8Array; width: number; height: number }
    image.data.set(pixels)
    tex.needsUpdate = true
  }
  // Demand-render viewports immediately so paint shows live without React tree churn.
  invalidateAllViewports('pixel-texture')
  // Wake React only when texture identity or alpha mode changes (material path).
  // Per-texel updates are picked up via needsUpdate + viewport invalidation.
  if (identityChanged || prevAlpha !== nextAlpha) {
    pixelListeners.get(docId)?.forEach((fn) => fn())
  }
  // Always notify data listeners (clones that share image.data need needsUpdate).
  dataListeners.get(docId)?.forEach((fn) => fn())
}

const dataListeners = new Map<string, Set<() => void>>()

/** Subscribe to live pixel-document texel uploads (every GPU update). */
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

export function getPixelDocumentTexture(docId: string): THREE.DataTexture | undefined {
  return pixelDocCache.get(docId)
}

/** Whether the live GPU composite for this pixel doc has any non-opaque texels. */
export function pixelDocumentTextureHasAlpha(docId: string): boolean {
  return pixelDocHasAlpha.get(docId) ?? false
}

export function releasePixelDocumentTexture(docId: string): void {
  const tex = pixelDocCache.get(docId)
  if (tex) {
    tex.dispose()
    pixelDocCache.delete(docId)
  }
  pixelDocHasAlpha.delete(docId)
  pixelListeners.delete(docId)
  dataListeners.delete(docId)
  clearPixelCompositeCache(docId)
}

/** Drop GPU textures for pixel docs no longer in app state or undo history. */
export function reconcilePixelDocumentCache(activeIds: Set<string>): void {
  for (const docId of pixelDocCache.keys()) {
    if (!activeIds.has(docId)) releasePixelDocumentTexture(docId)
  }
}

const textureLoader = new THREE.TextureLoader()
const loadGeneration = new Map<string, number>()

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

/** Re-render when live pixel document composite updates. */
export function usePixelDocumentTexture(docId: string | null): THREE.Texture | null {
  const [version, bump] = useState(0)
  useEffect(() => {
    if (!docId) return
    return subscribePixelDoc(docId, () => bump((n) => n + 1))
  }, [docId])
  return useMemo(() => {
    if (!docId) return null
    return pixelDocCache.get(docId) ?? null
  }, [docId, version])
}

export function getCachedTexture(url: string): THREE.Texture {
  let tex = cache.get(url)
  if (!tex) {
    const generation = (loadGeneration.get(url) ?? 0) + 1
    loadGeneration.set(url, generation)
    tex = new THREE.Texture()
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.flipY = true
    cache.set(url, tex)

    textureLoader.load(
      url,
      (loaded) => {
        if (loadGeneration.get(url) !== generation) return
        const current = cache.get(url)
        if (!current) return
        current.image = loaded.image
        current.needsUpdate = true
        notifyLoaded(url)
      },
      undefined,
      () => {
        if (loadGeneration.get(url) !== generation) return
        const failed = cache.get(url)
        if (failed) {
          failed.dispose()
          cache.delete(url)
        }
        loadListeners.delete(url)
        notifyLoaded(url)
      }
    )
  }
  return tex
}

/** Returns a texture once its image has finished loading (re-renders when ready). */
export function useLoadedTexture(url: string | null): THREE.Texture | null {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!url) {
      setReady(false)
      return
    }
    const tex = getCachedTexture(url)
    if (isTextureReady(tex)) {
      setReady(true)
      return
    }
    setReady(false)
    return subscribeLoad(url, () => setReady(isTextureReady(getCachedTexture(url))))
  }, [url])

  return useMemo(() => {
    if (!url || !ready) return null
    return getCachedTexture(url)
  }, [url, ready])
}

export function releaseCachedTexture(url: string): void {
  loadGeneration.set(url, (loadGeneration.get(url) ?? 0) + 1)
  const tex = cache.get(url)
  if (!tex) return
  tex.dispose()
  cache.delete(url)
  loadListeners.delete(url)
  loadGeneration.delete(url)
}

/** Revoke a blob URL and dispose its cached GPU texture. */
export function releaseTextureUrl(url: string | undefined): void {
  if (!url) return
  if (url.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
  releaseCachedTexture(url)
}
