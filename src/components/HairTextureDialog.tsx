import { useMemo, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { listSceneTextures } from '../uv/sceneTextures'
import { pickOpenFile } from '../io/fileDialogs'
import { IMAGE_IMPORT_FILTERS } from '../io/download'
import { HairUvEditor } from './HairUvEditor'
import type { HairUvTransform } from '../stroke/hairUvTransform'
import { HairTexturePreview3D } from './HairTexturePreview3D'
import { compositeLayers } from '../pixel/compositeLayers'
import type { PixelDocument } from '../pixel/pixelTypes'
import { applyActiveCardTexture, resolveTargetObjectIds } from '../material/materialEditorSlice'

interface HairTextureDialogProps {
  onClose: () => void
}

type TextureAnalysis = {
  darkBackdrop: boolean
  verticalFibers: boolean
  atlasCrop: { minU: number; maxU: number; minV: number; maxV: number } | null
}

function analyzeHairTexture(doc: PixelDocument | null): TextureAnalysis {
  if (!doc) return { darkBackdrop: false, verticalFibers: false, atlasCrop: null }
  const pixels = compositeLayers(doc)
  let dark = 0
  let visible = 0
  let highlights = 0
  const brightColumns = new Uint8Array(doc.width)
  const brightRows = new Uint8Array(doc.height)
  const columnCounts = new Uint32Array(doc.width)
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]! < 12) continue
    visible++
    const luma = (pixels[i]! * 0.2126 + pixels[i + 1]! * 0.7152 + pixels[i + 2]! * 0.0722) / 255
    if (luma < 0.12) dark++
    if (luma > 0.2) {
      highlights++
      const pixel = i / 4
      brightColumns[pixel % doc.width] = 1
      brightRows[Math.floor(pixel / doc.width)] = 1
      columnCounts[pixel % doc.width]++
    }
  }
  const columnCoverage = brightColumns.reduce((sum, n) => sum + n, 0) / doc.width
  const rowCoverage = brightRows.reduce((sum, n) => sum + n, 0) / doc.height
  // A tall image with highlights distributed across most columns/rows is normally a
  // continuous fiber colour map, not an alpha card with disposable black backing.
  const verticalFibers = doc.height > doc.width * 1.2 && columnCoverage > 0.45 && rowCoverage > 0.35
  const darkBackdrop = !verticalFibers && visible > 0 && dark / visible > 0.55 && highlights / visible > 0.005

  // Detect separated bright vertical cards in a dark landscape atlas. Small dark
  // gaps inside one wispy card are merged; large gaps separate atlas entries.
  let atlasCrop: TextureAnalysis['atlasCrop'] = null
  if (darkBackdrop && doc.width > doc.height * 1.12) {
    const active = Array.from(columnCounts, (count) => count >= Math.max(3, doc.height * 0.012))
    const groups: Array<{ start: number; end: number }> = []
    const maxInternalGap = Math.max(5, Math.round(doc.width * 0.018))
    let start = -1
    let last = -1
    for (let x = 0; x < active.length; x++) {
      if (!active[x]) continue
      if (start < 0) start = x
      else if (x - last > maxInternalGap) {
        groups.push({ start, end: last })
        start = x
      }
      last = x
    }
    if (start >= 0) groups.push({ start, end: last })
    const group = groups.find((g) => g.end - g.start >= doc.width * 0.035)
    if (group && groups.length >= 2) {
      let minY = doc.height - 1
      let maxY = 0
      for (let y = 0; y < doc.height; y++) for (let x = group.start; x <= group.end; x++) {
        const i = (y * doc.width + x) * 4
        const luma = (pixels[i]! * 0.2126 + pixels[i + 1]! * 0.7152 + pixels[i + 2]! * 0.0722) / 255
        if (pixels[i + 3]! > 12 && luma > 0.12) { minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
      }
      const padX = doc.width * 0.008
      const padY = doc.height * 0.012
      atlasCrop = {
        minU: Math.max(0, (group.start - padX) / doc.width),
        maxU: Math.min(1, (group.end + padX) / doc.width),
        minV: Math.max(0, (minY - padY) / doc.height),
        maxV: Math.min(1, (maxY + padY) / doc.height),
      }
    }
  }
  return { darkBackdrop, verticalFibers, atlasCrop }
}

export function HairTextureDialog({ onClose }: HairTextureDialogProps) {
  const pixelDocuments = useAppStore((s) => s.pixelDocuments)
  const objectTextures = useAppStore((s) => s.objectTextures)
  const objects = useAppStore((s) => s.objects)
  const selectedObjectId = useAppStore((s) => s.selectedObjectId)
  const selectionObjectIds = useAppStore((s) => s.selectionObjectIds)
  const hairTextureId = useAppStore((s) => s.hairTextureId)
  const hairUvTransform = useAppStore((s) => s.hairUvTransform)
  const hairTextureSettings = useAppStore((s) => s.hairTextureSettings)
  const setHairTextureId = useAppStore((s) => s.setHairTextureId)
  const clearHairTexture = useAppStore((s) => s.clearHairTexture)
  const setHairUvTransform = useAppStore((s) => s.setHairUvTransform)
  const resetHairUvTransform = useAppStore((s) => s.resetHairUvTransform)
  const setHairTextureSettings = useAppStore((s) => s.setHairTextureSettings)
  const importHairTextureImage = useAppStore((s) => s.importHairTextureImage)
  const strokeMode = useAppStore((s) => s.strokeMode)
  const setStrokeMode = useAppStore((s) => s.setStrokeMode)
  const hairTipStyle = useAppStore((s) => s.hairTipStyle)
  const setHairTipStyle = useAppStore((s) => s.setHairTipStyle)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showGradientEditor, setShowGradientEditor] = useState(false)

  const textures = useMemo(
    () => listSceneTextures(pixelDocuments, objectTextures, objects),
    [pixelDocuments, objectTextures, objects]
  )

  const activeLabel = textures.find((t) => t.id === hairTextureId)?.label ?? null
  const selectedPreviewObject = useMemo(() => {
    const id = selectedObjectId ?? (selectionObjectIds.length === 1 ? selectionObjectIds[0] : null)
    const object = id ? objects.find((candidate) => candidate.id === id) ?? null : null
    const kind = object?.sketchSource?.kind
    return kind === 'hair-path' || kind === 'hair-strip' || kind === 'hair-round' ||
      kind === 'ribbon' || kind === 'tapered-tube'
      ? object
      : null
  }, [objects, selectedObjectId, selectionObjectIds])
  const textureDoc = hairTextureId ? pixelDocuments[hairTextureId] ?? null : null
  const textureUrl = hairTextureId ? objectTextures[hairTextureId]?.url ?? null : null
  const previewKind = strokeMode === 'hair-strips' || strokeMode === 'hair-round' ? strokeMode : 'hair-paths'

  const applyTextureToSelectedCards = (textureId: string) => {
    const state = useAppStore.getState()
    const ids = resolveTargetObjectIds(state.selectedObjectId, state.selectionObjectIds)
    let changed = false
    for (const objectId of ids) {
      const object = state.objects.find((candidate) => candidate.id === objectId)
      const isCard = object?.sketchSource?.pathOutput === 'cards' || object?.vectorSource?.pathOutput === 'cards'
      if (!object || !isCard) continue
      const textured = applyActiveCardTexture(object, textureId, state.hairTextureSettings)
      state.updateObject(objectId, { material: textured.material })
      changed = true
    }
    if (changed) state.commitHistory('Apply card image')
  }

  const applySmartDefaults = (doc: PixelDocument | null) => {
    const { darkBackdrop, verticalFibers, atlasCrop } = analyzeHairTexture(doc)
    if (atlasCrop) {
      const cropWidth = atlasCrop.maxU - atlasCrop.minU
      const cropHeight = atlasCrop.maxV - atlasCrop.minV
      const centerU = (atlasCrop.minU + atlasCrop.maxU) / 2
      const centerV = (atlasCrop.minV + atlasCrop.maxV) / 2
      // At 90°, local length maps to image V and local width maps to image U.
      setHairUvTransform({
        offsetU: centerU - cropHeight / 2,
        offsetV: centerV - cropWidth / 2,
        scaleU: cropHeight,
        scaleV: cropWidth,
        flipU: false,
        flipV: false,
        rotationDeg: 90,
      })
    } else {
      setHairUvTransform({ offsetU: 0, offsetV: 0, scaleU: 1, scaleV: 1, flipU: false, flipV: false, rotationDeg: verticalFibers ? 90 : 0 })
    }
    setHairTextureSettings({
      wrap: darkBackdrop || verticalFibers ? 'clamp' : 'repeat',
      tintEnabled: false,
      tint: '#ffffff',
      colorMode: 'image',
      gradientStart: '#8b4513',
      gradientEnd: '#f2c18d',
      gradientAngle: 90,
      opacity: 1,
      removeDarkBackground: darkBackdrop,
      brightness: atlasCrop ? 1 : darkBackdrop ? 1.35 : verticalFibers ? 1.45 : 1,
      shadowDetail: atlasCrop ? 0.08 : verticalFibers ? 0.52 : darkBackdrop ? 0.3 : 0.18,
    })
    setHairTipStyle('pointed')
    // Smart texture analysis may choose a better hair preview shape, but must
    // not replace a general Ribbon or Tapered Tube tool the user selected.
    const isHairTool = strokeMode === 'hair-paths' || strokeMode === 'hair-strips' || strokeMode === 'hair-round'
    if (isHairTool && atlasCrop) setStrokeMode('hair-strips')
    else if (isHairTool && darkBackdrop) setStrokeMode('hair-paths')
  }

  const chooseTexture = (id: string) => {
    setHairTextureId(id)
    applySmartDefaults(pixelDocuments[id] ?? null)
    applyTextureToSelectedCards(id)
  }

  const runImport = async () => {
    setError(null)
    setBusy(true)
    try {
      const file = await pickOpenFile({
        title: 'Import hair texture',
        filters: IMAGE_IMPORT_FILTERS,
      })
      if (!file) return
      const id = await importHairTextureImage(file)
      const imported = useAppStore.getState().pixelDocuments[id] ?? null
      applySmartDefaults(imported)
      applyTextureToSelectedCards(id)
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
            <h2 id="hair-texture-title">Hair Properties</h2>
            <p className="ie-subtitle">
              Shape, texture, and preview for new hair strokes.
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

          <section className="hair-preview-section" aria-label="Live hair preview">
            <div className="hair-preview-heading">
              <div>
                <strong>Live preview</strong>
                <span className="muted">{selectedPreviewObject ? selectedPreviewObject.name : 'Sample strand'} · updates as you edit</span>
              </div>
              <span className="hair-live-badge"><i /> Live</span>
            </div>
            <HairTexturePreview3D
              textureDoc={textureDoc}
              textureUrl={textureUrl}
              transform={hairUvTransform}
              settings={hairTextureSettings}
              kind={previewKind}
              pointed={hairTipStyle === 'pointed'}
              object={selectedPreviewObject}
            />
            <div className="hair-preview-choice-row" aria-label="Hair shape">
              {([
                ['hair-paths', 'Smooth ribbon'],
                ['hair-strips', 'Low-poly strip'],
                ['hair-round', 'Rounded strand'],
              ] as const).map(([id, label]) => (
                <button key={id} type="button" className={`side-btn ${previewKind === id ? 'active' : ''}`} onClick={() => setStrokeMode(id)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="hair-preview-choice-row" aria-label="Hair tips">
              <button type="button" className={`side-btn ${hairTipStyle === 'pointed' ? 'active' : ''}`} onClick={() => setHairTipStyle('pointed')}>Pointed tips</button>
              <button type="button" className={`side-btn ${hairTipStyle === 'square' ? 'active' : ''}`} onClick={() => setHairTipStyle('square')}>Square tips</button>
            </div>
          </section>

          <div className="hair-properties-grid">
          <section className="hair-texture-controls" aria-label="Texture controls">
            <div className="hair-texture-control-heading">
              <span>Appearance</span>
              <span className="muted">New strokes</span>
            </div>

            <div className="hair-texture-control-row">
              <label htmlFor="hair-wrap">Edges</label>
              <select
                id="hair-wrap"
                value={hairTextureSettings.wrap}
                onChange={(e) => setHairTextureSettings({ wrap: e.target.value as 'clamp' | 'repeat' | 'mirror' })}
              >
                <option value="repeat">Repeat</option>
                <option value="mirror">Mirror repeat</option>
                <option value="clamp">Stretch edge</option>
              </select>
            </div>

            <div className="hair-texture-repeat-grid">
              <label>
                Repeat along
                <input
                  type="number"
                  min="0.1"
                  max="12"
                  step="0.1"
                  value={Number(hairUvTransform.scaleU.toFixed(2))}
                  onChange={(e) => setHairUvTransform({ ...hairUvTransform, scaleU: Math.max(0.1, Math.min(12, Number(e.target.value) || 1)) })}
                />
              </label>
              <label>
                Repeat across
                <input
                  type="number"
                  min="0.1"
                  max="12"
                  step="0.1"
                  value={Number(hairUvTransform.scaleV.toFixed(2))}
                  onChange={(e) => setHairUvTransform({ ...hairUvTransform, scaleV: Math.max(0.1, Math.min(12, Number(e.target.value) || 1)) })}
                />
              </label>
              <button type="button" className="side-btn" onClick={resetHairUvTransform}>
                Fit once
              </button>
            </div>

            <div className="hair-color-mode-tabs" aria-label="Texture color mode">
              <button
                type="button"
                className={`side-btn ${hairTextureSettings.colorMode === 'image' ? 'active' : ''}`}
                disabled={busy}
                title={hairTextureId ? 'Use the selected image without a color tint' : 'Import an image texture'}
                onClick={() => {
                  setHairTextureSettings({ colorMode: 'image', tintEnabled: false })
                  if (!hairTextureId) void runImport()
                }}
              >
                {hairTextureId ? 'Image' : 'Import image…'}
              </button>
              <button type="button" className={`side-btn ${hairTextureSettings.colorMode === 'tint' ? 'active' : ''}`} onClick={() => setHairTextureSettings({ colorMode: 'tint', tintEnabled: true })}>Color</button>
              <button type="button" className={`side-btn ${hairTextureSettings.colorMode === 'gradient' ? 'active' : ''}`} onClick={() => { setHairTextureSettings({ colorMode: 'gradient', tintEnabled: false }); setShowGradientEditor(true) }}>Gradient</button>
            </div>

            {hairTextureSettings.colorMode === 'tint' && <div className="hair-texture-tint-row">
              <span>Hair color</span>
              <input
                type="color"
                aria-label="Texture tint color"
                value={hairTextureSettings.tint}
                onChange={(e) => setHairTextureSettings({ tint: e.target.value })}
              />
              <input
                type="text"
                className="hair-texture-hex"
                aria-label="Texture color hex value"
                value={hairTextureSettings.tint.toUpperCase()}
                maxLength={7}
                onChange={(e) => {
                  const value = e.target.value
                  if (/^#[0-9a-fA-F]{6}$/.test(value)) setHairTextureSettings({ tint: value })
                }}
              />
            </div>}

            {hairTextureSettings.colorMode === 'gradient' && (
              <button type="button" className="hair-gradient-summary" onClick={() => setShowGradientEditor((open) => !open)}>
                <span style={{ background: `linear-gradient(${hairTextureSettings.gradientAngle}deg, ${hairTextureSettings.gradientStart}, ${hairTextureSettings.gradientEnd})` }} />
                Edit gradient…
              </button>
            )}

            {hairTextureSettings.colorMode === 'gradient' && showGradientEditor && (
              <div className="hair-gradient-editor">
                <div className="hair-gradient-editor-heading"><strong>Gradient fill</strong><span className="muted">Live preview</span></div>
                <div className="hair-gradient-preview" style={{ background: `linear-gradient(${hairTextureSettings.gradientAngle}deg, ${hairTextureSettings.gradientStart}, ${hairTextureSettings.gradientEnd})` }}>
                  <input type="color" value={hairTextureSettings.gradientStart} onChange={(e) => setHairTextureSettings({ gradientStart: e.target.value })} aria-label="Gradient start color" />
                  <input type="color" value={hairTextureSettings.gradientEnd} onChange={(e) => setHairTextureSettings({ gradientEnd: e.target.value })} aria-label="Gradient end color" />
                </div>
                <label className="hair-gradient-angle">
                  <span>Direction <output>{hairTextureSettings.gradientAngle}°</output></span>
                  <input type="range" min="0" max="360" step="1" value={hairTextureSettings.gradientAngle} onChange={(e) => setHairTextureSettings({ gradientAngle: Number(e.target.value) })} />
                </label>
                <div className="hair-gradient-actions">
                  <button type="button" className="side-btn" onClick={() => setHairTextureSettings({ gradientStart: hairTextureSettings.gradientEnd, gradientEnd: hairTextureSettings.gradientStart })}>Swap colors</button>
                  <button type="button" className="side-btn" onClick={() => setHairTextureSettings({ gradientAngle: 90 })}>Root → tip</button>
                </div>
              </div>
            )}

            <label className="hair-texture-check hair-texture-alpha-check" title="Makes dark pixels transparent—ideal for hair images drawn on black">
              <input
                type="checkbox"
                checked={hairTextureSettings.removeDarkBackground}
                onChange={(e) => setHairTextureSettings({ removeDarkBackground: e.target.checked })}
              />
              <span>
                Remove dark background
                <small>Use for strands on black</small>
              </span>
            </label>

            <label className="hair-texture-opacity">
              <span>Texture brightness <output>{hairTextureSettings.brightness.toFixed(1)}×</output></span>
              <input
                type="range"
                min="0.5"
                max="2.5"
                step="0.1"
                value={hairTextureSettings.brightness}
                onChange={(e) => setHairTextureSettings({ brightness: Number(e.target.value) })}
              />
            </label>

            <label className="hair-texture-opacity" title="Reveals fibre detail hidden close to black while preserving true black">
              <span>Shadow detail <output>{Math.round(hairTextureSettings.shadowDetail * 100)}%</output></span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={hairTextureSettings.shadowDetail}
                onChange={(e) => setHairTextureSettings({ shadowDetail: Number(e.target.value) })}
              />
            </label>

            <label className="hair-texture-opacity">
              <span>Opacity <output>{Math.round(hairTextureSettings.opacity * 100)}%</output></span>
              <input
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                value={hairTextureSettings.opacity}
                onChange={(e) => setHairTextureSettings({ opacity: Number(e.target.value) })}
              />
            </label>
          </section>

          <HairUvEditor
            transform={hairUvTransform}
            onChange={(next: HairUvTransform) => setHairUvTransform(next)}
            onReset={resetHairUvTransform}
            textureDoc={textureDoc}
            shape={hairTipStyle}
            onShapeChange={setHairTipStyle}
          />
          </div>

          <section className="hair-texture-library">
          <div className="hair-texture-library-heading">
            <div><strong>Texture source</strong><span className="muted">{hairTextureId ? activeLabel ?? 'Selected texture' : 'Using current color'}</span></div>
            <button type="button" className="side-btn" onClick={() => void runImport()} disabled={busy}>Import image…</button>
          </div>
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
                  onClick={() => chooseTexture(entry.id)}
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
          </section>
        </div>

        <footer className="hair-texture-actions">
          <button type="button" className="side-btn" onClick={() => applySmartDefaults(textureDoc)} disabled={busy} title="Restore a useful starting setup for this texture">
            Smart reset
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
