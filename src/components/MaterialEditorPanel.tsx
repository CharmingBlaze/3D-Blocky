import { useCallback, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { FloatingPanel } from './FloatingPanel'
import { ColorWheelPicker } from './material/ColorWheelPicker'
import { GradientLineEditor } from './material/GradientLineEditor'
import { useAppStore } from '../store/appStore'
import { PRESET_PALETTES } from '../material/palettes'
import type { GradientDirection, HarmonyScheme, MaterialMode } from '../material/materialTypes'
import { hexToRgba4, rgba4ToHex } from '../material/materialTypes'
import { resolveEffectiveMaterial } from '../material/materials'
import { downloadObjectTexturePng } from '../io/materialTextureExport'
import { pickOpenFile } from '../io/fileDialogs'
import { IMAGE_IMPORT_FILTERS } from '../io/download'

declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> }
  }
}

export function MaterialEditorPanel() {
  const {
    materialEditorOpen,
    materialEditorPanel,
    materialEditorColor,
    materialEditorPaletteId,
    materialEditorCustomPalettes,
    materialEditorEyedropperActive,
    materialEditorGradientDirection,
    materialEditorGradientStart,
    materialEditorGradientEnd,
    materialEditorGradientActiveStop,
    materialEditorGradientStops,
    materialEditorApplyToSelection,
    selectedObjectId,
    selectionObjectIds,
    objectTextures,
    pixelDocuments,
    setMaterialEditorPanel,
    toggleMaterialEditor,
    setMaterialEditorColorLive,
    commitMaterialEditorColor,
    setMaterialEditorPaletteId,
    addCustomPaletteSwatch,
    generateMaterialHarmonyPalette,
    setMaterialEditorEyedropperActive,
    setMaterialEditorGradientDirection,
    setMaterialEditorGradientHandle,
    setMaterialEditorGradientActiveStop,
    beginMaterialEditorGradientDrag,
    setMaterialEditorGradientStop,
    previewMaterialEditorGradient,
    setMaterialEditorApplyToSelection,
    setMaterialEditorMode,
    setMaterialOpacity,
    setMaterialDoubleSided,
    createCustomPalette,
    renameCustomPalette,
    deleteCustomPalette,
    loadObjectTexture,
  } = useAppStore(
    useShallow((s) => ({
      materialEditorOpen: s.materialEditorOpen,
      materialEditorPanel: s.materialEditorPanel,
      materialEditorColor: s.materialEditorColor,
      materialEditorPaletteId: s.materialEditorPaletteId,
      materialEditorCustomPalettes: s.materialEditorCustomPalettes,
      materialEditorEyedropperActive: s.materialEditorEyedropperActive,
      materialEditorGradientDirection: s.materialEditorGradientDirection,
      materialEditorGradientStart: s.materialEditorGradientStart,
      materialEditorGradientEnd: s.materialEditorGradientEnd,
      materialEditorGradientActiveStop: s.materialEditorGradientActiveStop,
      materialEditorGradientStops: s.materialEditorGradientStops,
      materialEditorApplyToSelection: s.materialEditorApplyToSelection,
      selectedObjectId: s.selectedObjectId,
      selectionObjectIds: s.selectionObjectIds,
      selectionMode: s.selectionMode,
      objectTextures: s.objectTextures,
      pixelDocuments: s.pixelDocuments,
      setMaterialEditorPanel: s.setMaterialEditorPanel,
      toggleMaterialEditor: s.toggleMaterialEditor,
      setMaterialEditorColorLive: s.setMaterialEditorColorLive,
      commitMaterialEditorColor: s.commitMaterialEditorColor,
      setMaterialEditorPaletteId: s.setMaterialEditorPaletteId,
      addCustomPaletteSwatch: s.addCustomPaletteSwatch,
      generateMaterialHarmonyPalette: s.generateMaterialHarmonyPalette,
      setMaterialEditorEyedropperActive: s.setMaterialEditorEyedropperActive,
      setMaterialEditorGradientDirection: s.setMaterialEditorGradientDirection,
      setMaterialEditorGradientHandle: s.setMaterialEditorGradientHandle,
      setMaterialEditorGradientActiveStop: s.setMaterialEditorGradientActiveStop,
      beginMaterialEditorGradientDrag: s.beginMaterialEditorGradientDrag,
      setMaterialEditorGradientStop: s.setMaterialEditorGradientStop,
      previewMaterialEditorGradient: s.previewMaterialEditorGradient,
      setMaterialEditorApplyToSelection: s.setMaterialEditorApplyToSelection,
      setMaterialEditorMode: s.setMaterialEditorMode,
      setMaterialOpacity: s.setMaterialOpacity,
      setMaterialDoubleSided: s.setMaterialDoubleSided,
      createCustomPalette: s.createCustomPalette,
      renameCustomPalette: s.renameCustomPalette,
      deleteCustomPalette: s.deleteCustomPalette,
      loadObjectTexture: s.loadObjectTexture,
    }))
  )

  const primaryId = selectedObjectId ?? selectionObjectIds[0] ?? null
  const obj = useAppStore((s) => s.objects.find((o) => o.id === primaryId) ?? null)
  const mat = obj ? resolveEffectiveMaterial(obj) : null

  const paletteOptions = useMemo(
    () => [
      ...PRESET_PALETTES.map((p) => ({ id: p.id, name: p.name })),
      ...materialEditorCustomPalettes.map((p) => ({ id: p.id, name: p.name })),
    ],
    [materialEditorCustomPalettes]
  )

  const swatches = useMemo(() => {
    const preset = PRESET_PALETTES.find((p) => p.id === materialEditorPaletteId)
    if (preset) return preset.colors
    const custom = materialEditorCustomPalettes.find((p) => p.id === materialEditorPaletteId)
    return custom?.colors ?? []
  }, [materialEditorPaletteId, materialEditorCustomPalettes])

  const runEyedropper = useCallback(async () => {
    if (window.EyeDropper) {
      try {
        const dropper = new window.EyeDropper()
        const result = await dropper.open()
        commitMaterialEditorColor(hexToRgba4(result.sRGBHex, materialEditorColor[3]))
        setMaterialEditorEyedropperActive(false)
        return
      } catch {
        /* cancelled */
      }
    }
    setMaterialEditorEyedropperActive(true)
  }, [commitMaterialEditorColor, materialEditorColor, setMaterialEditorEyedropperActive])

  useEffect(() => {
    if (!materialEditorEyedropperActive) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('.material-editor-panel')) return
      const swatchEl = target?.closest('[data-mat-swatch]') as HTMLElement | null
      if (swatchEl?.dataset.color) {
        commitMaterialEditorColor(hexToRgba4(swatchEl.dataset.color, materialEditorColor[3]))
        setMaterialEditorEyedropperActive(false)
        return
      }
      setMaterialEditorEyedropperActive(false)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [
    materialEditorEyedropperActive,
    commitMaterialEditorColor,
    materialEditorColor,
    setMaterialEditorEyedropperActive,
  ])

  const hasSelection = selectionObjectIds.length > 0 || !!selectedObjectId
  const texId =
    mat?.mode === 'texture' ? mat.textureId ?? primaryId : null
  const textureInfo = texId ? objectTextures[texId] : undefined
  const textureCtx = useMemo(
    () => ({ pixelDocuments, objectTextures }),
    [pixelDocuments, objectTextures]
  )

  const exportTexture = useCallback(async () => {
    if (!obj) return
    await downloadObjectTexturePng(obj, textureCtx)
  }, [obj, textureCtx])

  const importTexture = useCallback(async () => {
    if (!primaryId) return
    const file = await pickOpenFile({
      title: 'Import texture',
      filters: IMAGE_IMPORT_FILTERS,
    })
    if (file) await loadObjectTexture(primaryId, file)
  }, [loadObjectTexture, primaryId])

  if (!materialEditorOpen) return null

  return (
    <FloatingPanel
      title="Material Editor"
      open={materialEditorOpen}
      state={materialEditorPanel}
      minWidth={300}
      minHeight={420}
      onClose={toggleMaterialEditor}
      onStateChange={setMaterialEditorPanel}
    >
      <div className="material-editor-panel">
        <div className="mat-section">
          <div className="mat-section-head">
            <span>Color</span>
            <button
              type="button"
              className={`mat-icon-btn${materialEditorEyedropperActive ? ' active' : ''}`}
              title="Eyedropper — sample from screen or swatches"
              onClick={runEyedropper}
            >
              ⌖
            </button>
          </div>
          <ColorWheelPicker
            color={materialEditorColor}
            onChange={setMaterialEditorColorLive}
            onCommit={commitMaterialEditorColor}
          />
          <label className="mat-slider-row">
            <span>Opacity</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.01}
              value={mat?.opacity ?? materialEditorColor[3]}
              onChange={(e) => setMaterialOpacity(Number(e.target.value))}
            />
            <span>{Math.round((mat?.opacity ?? materialEditorColor[3]) * 100)}%</span>
          </label>
        </div>

        <div className="mat-section">
          <label className="mat-field-block">
            <span>Palette</span>
            <select
              className="side-select shape-kind-select"
              value={materialEditorPaletteId}
              onChange={(e) => setMaterialEditorPaletteId(e.target.value)}
            >
              {paletteOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="mat-palette-grid">
            {swatches.map((hex, i) => (
              <button
                key={`${hex}-${i}`}
                type="button"
                className="mat-palette-swatch"
                data-mat-swatch
                data-color={hex}
                style={{ background: hex }}
                title={hex}
                onClick={() => commitMaterialEditorColor(hexToRgba4(hex, materialEditorColor[3]))}
              />
            ))}
          </div>
          <div className="mat-btn-row">
            <button type="button" className="side-btn" onClick={() => addCustomPaletteSwatch()}>
              + Swatch
            </button>
            <button type="button" className="side-btn" onClick={() => createCustomPalette()}>
              + Palette
            </button>
          </div>
          {materialEditorCustomPalettes.some((p) => p.id === materialEditorPaletteId) && (
            <div className="mat-btn-row">
              <button
                type="button"
                className="side-btn"
                onClick={() => {
                  const name = window.prompt('Palette name')
                  if (name) renameCustomPalette(materialEditorPaletteId, name)
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="side-btn"
                onClick={() => deleteCustomPalette(materialEditorPaletteId)}
              >
                Delete palette
              </button>
            </div>
          )}
          <div className="mat-harmony-row">
            {(['complementary', 'analogous', 'triadic', 'monochromatic'] as HarmonyScheme[]).map(
              (scheme) => (
                <button
                  key={scheme}
                  type="button"
                  className="side-btn"
                  onClick={() => generateMaterialHarmonyPalette(scheme)}
                  title={`Generate ${scheme} palette from active color`}
                >
                  {scheme.slice(0, 4)}
                </button>
              )
            )}
          </div>
        </div>

        <div className="mat-section">
          <span className="mat-section-title">Gradient fill</span>
          <p className="side-color-hint muted">
            Drag the color stops on the preview to shape the gradient on your object.
          </p>
          <GradientLineEditor
            start={materialEditorGradientStart}
            end={materialEditorGradientEnd}
            stops={materialEditorGradientStops}
            activeStop={materialEditorGradientActiveStop}
            radial={materialEditorGradientDirection === 'radial'}
            disabled={!hasSelection}
            onStartChange={(h) => setMaterialEditorGradientHandle(0, h)}
            onEndChange={(h) => setMaterialEditorGradientHandle(1, h)}
            onActiveStopChange={setMaterialEditorGradientActiveStop}
            onDragBegin={beginMaterialEditorGradientDrag}
          />
          <label className="mat-field-block">
            <span>Preset direction</span>
            <select
              className="side-select shape-kind-select"
              value={materialEditorGradientDirection}
              onChange={(e) =>
                setMaterialEditorGradientDirection(e.target.value as GradientDirection)
              }
            >
              <option value="x">World X</option>
              <option value="y">World Y</option>
              <option value="z">World Z</option>
              <option value="radial">Radial</option>
            </select>
          </label>
          <div className="mat-gradient-stops">
            {materialEditorGradientStops.map((stop, i) => (
              <label
                key={i}
                className={`mat-gradient-stop${materialEditorGradientActiveStop === i ? ' active' : ''}`}
              >
                <span>Stop {i + 1}</span>
                <input
                  type="color"
                  value={rgba4ToHex(stop)}
                  onFocus={() => setMaterialEditorGradientActiveStop(i as 0 | 1)}
                  onChange={(e) =>
                    setMaterialEditorGradientStop(i, hexToRgba4(e.target.value, stop[3]))
                  }
                />
              </label>
            ))}
          </div>
          <label className="side-checkbox">
            <input
              type="checkbox"
              checked={materialEditorApplyToSelection}
              onChange={(e) => setMaterialEditorApplyToSelection(e.target.checked)}
            />
            <span>Apply to current selection only</span>
          </label>
          <button
            type="button"
            className="side-btn side-btn-wide"
            disabled={!hasSelection}
            onClick={previewMaterialEditorGradient}
          >
            Re-apply gradient
          </button>
        </div>

        <div className="mat-section">
          <span className="mat-section-title">Material mode</span>
          <div className="mat-mode-row">
            {(['solid', 'vertexGradient', 'texture'] as MaterialMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`side-btn${mat?.mode === mode ? ' active' : ''}`}
                disabled={!hasSelection}
                onClick={() => setMaterialEditorMode(mode)}
              >
                {mode === 'vertexGradient' ? 'Gradient' : mode === 'texture' ? 'Texture' : 'Solid'}
              </button>
            ))}
          </div>
          {mat?.mode === 'texture' && (
            <>
              <p className="side-color-hint muted">
                {textureInfo
                  ? `Using texture: ${textureInfo.name} (${textureInfo.width}×${textureInfo.height})`
                  : 'No texture on this object — import an image below.'}
              </p>
              <div className="mat-btn-row">
                <button
                  type="button"
                  className="side-btn"
                  disabled={!hasSelection}
                  onClick={() => void importTexture()}
                >
                  Import texture…
                </button>
                <button
                  type="button"
                  className="side-btn"
                  disabled={!hasSelection || !obj || mat.mode !== 'texture'}
                  onClick={() => void exportTexture()}
                >
                  Export PNG
                </button>
              </div>
            </>
          )}
          <label className="side-checkbox">
            <input
              type="checkbox"
              checked={mat?.doubleSided ?? false}
              disabled={!hasSelection}
              onChange={(e) => setMaterialDoubleSided(e.target.checked)}
            />
            <span>Double-sided</span>
          </label>
          <p className="side-color-hint muted">
            Double-sided materials render both sides of faces in the viewport.
          </p>
        </div>

        {!hasSelection && (
          <p className="side-color-hint muted">
            No selection — color changes set the default for new objects.
          </p>
        )}
      </div>
    </FloatingPanel>
  )
}
