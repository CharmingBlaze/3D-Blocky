import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import {
  getPixelDocumentTexture,
  subscribePixelDoc,
} from './pixelDocTexture'

const cache = new Map<string, THREE.Texture>()
const loadListeners = new Map<string, Set<() => void>>()
const textureLoader = new THREE.TextureLoader()
const loadGeneration = new Map<string, number>()

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

export {
  registerWebGLRenderer,
  getPixelDocumentTexture,
  pixelDocumentTextureHasAlpha,
  subscribePixelDocumentTexture,
  getPixelCompositeCache,
  subscribePixelDocumentPreview,
  releasePixelDocumentTexture,
  uploadPixelDocumentTexture,
  reconcilePixelDocumentCache,
} from './pixelDocTexture'

/** Re-render when live pixel document composite updates. */
export function usePixelDocumentTexture(docId: string | null): THREE.Texture | null {
  const [version, bump] = useState(0)
  useEffect(() => {
    if (!docId) return
    return subscribePixelDoc(docId, () => bump((n) => n + 1))
  }, [docId])
  return useMemo(() => {
    if (!docId) return null
    return getPixelDocumentTexture(docId) ?? null
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

export function releaseTextureUrl(url: string | undefined): void {
  if (!url) return
  if (url.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
  releaseCachedTexture(url)
}
