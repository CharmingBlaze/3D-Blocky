/** Shared flattened pixel composites — GPU upload and 2D canvas both read this. */

export type PixelCompositeEntry = {
  pixels: Uint8ClampedArray
  width: number
  height: number
  version: number
}

const cache = new Map<string, PixelCompositeEntry>()
const listeners = new Map<string, Set<() => void>>()

function notify(docId: string): void {
  listeners.get(docId)?.forEach((fn) => fn())
}

export function setPixelCompositeCache(
  docId: string,
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): PixelCompositeEntry {
  const prev = cache.get(docId)
  // Reuse buffer when size matches to cut alloc churn during strokes.
  let entry: PixelCompositeEntry
  if (prev && prev.width === width && prev.height === height && prev.pixels.length === pixels.length) {
    // Caller may already have written into prev.pixels (composite into cache buffer).
    if (prev.pixels !== pixels) prev.pixels.set(pixels)
    prev.version += 1
    entry = prev
  } else {
    entry = {
      pixels: prev?.pixels === pixels ? pixels : new Uint8ClampedArray(pixels),
      width,
      height,
      version: (prev?.version ?? 0) + 1,
    }
    cache.set(docId, entry)
  }
  notify(docId)
  return entry
}

/** Mutable composite buffer for in-place flattening during live strokes. */
export function acquirePixelCompositeBuffer(
  docId: string,
  width: number,
  height: number
): Uint8ClampedArray {
  const prev = cache.get(docId)
  const len = width * height * 4
  if (prev && prev.width === width && prev.height === height && prev.pixels.length === len) {
    return prev.pixels
  }
  const pixels = new Uint8ClampedArray(len)
  cache.set(docId, { pixels, width, height, version: prev?.version ?? 0 })
  return pixels
}

export function getPixelCompositeCache(docId: string): PixelCompositeEntry | undefined {
  return cache.get(docId)
}

export function clearPixelCompositeCache(docId: string): void {
  cache.delete(docId)
  listeners.delete(docId)
}

export function subscribePixelCompositeCache(docId: string, fn: () => void): () => void {
  let set = listeners.get(docId)
  if (!set) {
    set = new Set()
    listeners.set(docId, set)
  }
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (set!.size === 0) listeners.delete(docId)
  }
}
