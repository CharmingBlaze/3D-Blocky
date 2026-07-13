import { useMemo, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { listSceneTextures } from '../uv/sceneTextures'
import { pickOpenFile } from '../io/fileDialogs'
import { IMAGE_IMPORT_FILTERS } from '../io/download'
import { HairUvEditor } from './HairUvEditor'
import type { HairUvTransform } from '../stroke/hairUvTransform'

interface HairTextureDialogProps {
  onClose: () => void
}

export function HairTextureDialog({ onClose }: HairTextureDialogProps) {
  const pixelDocuments = useAppStore((s) => s.pixelDocuments)
  const objectTextures = useAppStore((s) => s.objectTextures)
  const objects = useAppStore((s) => s.objects)
  const hairTextureId = useAppStore((s) => s.hairTextureId)
  const hairUvTransform = useAppStore((s) => s.hairUvTransform)
  const setHairTextureId = useAppStore((s) => s.setHairTextureId)
  const clearHairTexture = useAppStore((s) => s.clearHairTexture)
  const setHairUvTransform = useAppStore((s) => s.setHairUvTransform)
  const resetHairUvTransform = useAppStore((s) => s.resetHairUvTransform)
  const importHairTextureImage = useAppStore((s) => s.importHairTextureImage)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const textures = useMemo(
    () => listSceneTextures(pixelDocuments, objectTextures, objects),
    [pixelDocuments, objectTextures, objects]
  )

  const activeLabel = textures.find((t) => t.id === hairTextureId)?.label ?? null
  const textureDoc = hairTextureId ? pixelDocuments[hairTextureId] ?? null : null

  const runImport = async () => {
    setError(null)
    setBusy(true)
    try {
      const file = await pickOpenFile({
        title: 'Import hair texture',
        filters: IMAGE_IMPORT_FILTERS,
      })
      if (!file) return
      await importHairTextureImage(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ie-overlay" onClick={onClose}>
      <div
        className="ie-dialog bb-dialog hair-texture-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="hair-texture-title"
      >
        <header className="ie-header bb-dialog-header">
          <div>
            <h2 id="hair-texture-title">Hair Texture</h2>
            <p className="ie-subtitle">
              Choose a project texture and UV mapping for Hair Paths, Hair Strips, and Rounded Hair.
              Mapping applies to new strokes; reopen anytime to change it.
            </p>
          </div>
          <button
            type="button"
            className="ie-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="hair-texture-body">
          {error && <p className="import-export-error">{error}</p>}

          <p className="hair-texture-active">
            {hairTextureId
              ? `Active: ${activeLabel ?? hairTextureId}`
              : 'Active: none — hair strokes use colors / materials'}
          </p>

          <HairUvEditor
            transform={hairUvTransform}
            onChange={(next: HairUvTransform) => setHairUvTransform(next)}
            onReset={resetHairUvTransform}
            textureDoc={textureDoc}
          />

          <div className="hair-texture-list" role="listbox" aria-label="Project textures">
            <button
              type="button"
              role="option"
              aria-selected={!hairTextureId}
              className={`hair-texture-item ${!hairTextureId ? 'active' : ''}`}
              onClick={() => clearHairTexture()}
              disabled={busy}
            >
              <span className="hair-texture-item-label">None (use colors)</span>
              <span className="hair-texture-item-meta">Palette / materials</span>
            </button>

            {textures.length === 0 ? (
              <p className="hair-texture-empty muted">
                No textures in this project yet. Import an image or create one in the Pixel Editor.
              </p>
            ) : (
              textures.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="option"
                  aria-selected={hairTextureId === entry.id}
                  className={`hair-texture-item ${hairTextureId === entry.id ? 'active' : ''}`}
                  onClick={() => setHairTextureId(entry.id)}
                  disabled={busy}
                >
                  <span className="hair-texture-item-label">{entry.label}</span>
                  <span className="hair-texture-item-meta">
                    {entry.width}×{entry.height}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <footer className="hair-texture-actions">
          <button type="button" className="side-btn" onClick={() => void runImport()} disabled={busy}>
            Import…
          </button>
          <button
            type="button"
            className="side-btn"
            onClick={() => clearHairTexture()}
            disabled={busy || !hairTextureId}
          >
            Clear
          </button>
          <button type="button" className="side-btn side-btn-primary" onClick={onClose} disabled={busy}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}
