/** @deprecated Import from `../rendering/pixelDocTexture` — thin re-export for legacy imports. */
export {
  acquirePixelCompositeBuffer,
  clearPixelCompositeCache,
  getPixelCompositeCache,
  setPixelCompositeCache,
  subscribePixelCompositeCache,
  subscribePixelDocumentPreview,
  type PixelDocTextureEntry as PixelCompositeEntry,
} from '../rendering/pixelDocTexture'

export type PixelCompositeListener = (dirty: import('./pixelDirtyRect').PixelDirtyRect | null) => void
