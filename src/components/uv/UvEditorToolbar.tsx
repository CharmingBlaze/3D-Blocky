import type { SceneObject } from '../../mesh/HalfEdgeMesh'
import { resolveUvMappingMode, type UvMappingMode } from '../../uv/uvObject'
import type { UvSnapMode } from '../../uv/uvSnap'
import { UV_UNWRAP_METHODS, type UvUnwrapMethod } from '../../uv/uvUnwrap'
import type { UvEditorMode } from '../../store/uvEditorSlice'
import { UvToolbarDropdown, type UvDropdownOption } from './UvToolbarDropdown'

type SceneTextureEntry = { id: string; label: string }

interface UvEditorToolbarProps {
  objectId: string | null
  obj: SceneObject | null
  sceneTextures: SceneTextureEntry[]
  activeTextureId: string | null
  uvEditorMode: UvEditorMode
  uvEditorSnap: boolean
  uvEditorSnapMode: UvSnapMode
  uvEditorSmartUvAngle: number
  uvEditorShowGrid: boolean
  uvEditorTilePreview: boolean
  showUvPaintOverlay: boolean
  uvEditorViewAll: boolean
  uvEditorAutoFit: boolean
  uvEditorSticky: boolean
  uvEditorGridDivisions: number
  unwrapMethod: UvUnwrapMethod
  onImport: () => void
  onAssignTexture: (docId: string) => void
  onSetUvEditorMode: (mode: UvEditorMode) => void
  onSetMappingMode: (mode: UvMappingMode) => void
  onTransform: (
    op: 'flipH' | 'flipV' | 'rotateCW' | 'rotateCCW' | 'fit'
  ) => void
  onUnwrap: (method: UvUnwrapMethod) => void
  onSetUnwrapMethod: (method: UvUnwrapMethod) => void
  onSetSmartUvAngle: (deg: number) => void
  onFrameSelection: () => void
  onFitCanvas: () => void
  onSetAutoFit: (on: boolean) => void
  onSetSticky: (on: boolean) => void
  onSetViewAll: (on: boolean) => void
  onSetShowGrid: (on: boolean) => void
  onSetSnap: (on: boolean) => void
  onSetSnapMode: (mode: UvSnapMode) => void
  onSetTilePreview: (on: boolean) => void
  onSetShowUvPaintOverlay: (on: boolean) => void
  onSetGridDivisions: (n: number) => void
  onSetTextureTransform: (patch: {
    repeat?: [number, number]
    offset?: [number, number]
    rotation?: number
    wrap?: 'clamp' | 'repeat' | 'mirror'
  }) => void
  onSelectConnected: () => void
  canSelectConnected: boolean
  imageLayerEdit: boolean
  autoResizeUvsWithImage: boolean
  onSetImageLayerEdit: (on: boolean) => void
  onSetAutoResizeUvsWithImage: (on: boolean) => void
}

function UvSegment<T extends string>({
  options,
  value,
  onChange,
  title,
}: {
  options: { id: T; label: string; title?: string }[]
  value: T
  onChange: (id: T) => void
  title?: string
}) {
  return (
    <div className="uv-segment uv-segment-block" role="group" title={title}>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`uv-segment-btn ${value === opt.id ? 'active' : ''}`}
          title={opt.title}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function UvToggle({
  label,
  checked,
  onChange,
  title,
}: {
  label: string
  checked: boolean
  onChange: (on: boolean) => void
  title?: string
}) {
  return (
    <label className="uv-toggle uv-toggle-block" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function UvEditorToolbar({
  objectId,
  obj,
  sceneTextures,
  activeTextureId,
  uvEditorMode,
  uvEditorSnap,
  uvEditorSnapMode,
  uvEditorSmartUvAngle,
  uvEditorShowGrid,
  uvEditorTilePreview,
  showUvPaintOverlay,
  uvEditorViewAll,
  uvEditorAutoFit,
  uvEditorSticky,
  uvEditorGridDivisions,
  unwrapMethod,
  onImport,
  onAssignTexture,
  onSetUvEditorMode,
  onSetMappingMode,
  onTransform,
  onUnwrap,
  onSetUnwrapMethod,
  onSetSmartUvAngle,
  onFrameSelection,
  onFitCanvas,
  onSetAutoFit,
  onSetSticky,
  onSetViewAll,
  onSetShowGrid,
  onSetSnap,
  onSetSnapMode,
  onSetTilePreview,
  onSetShowUvPaintOverlay,
  onSetGridDivisions,
  onSetTextureTransform,
  onSelectConnected,
  canSelectConnected,
  imageLayerEdit,
  autoResizeUvsWithImage,
  onSetImageLayerEdit,
  onSetAutoResizeUvsWithImage,
}: UvEditorToolbarProps) {
  const textureOptions: UvDropdownOption[] =
    sceneTextures.length === 0
      ? [{ value: '', label: 'No textures — import one', disabled: true }]
      : sceneTextures.map((entry) => ({ value: entry.id, label: entry.label }))

  const unwrapOptions: UvDropdownOption[] = UV_UNWRAP_METHODS.map((m) => ({
    value: m.id,
    label: m.label,
    hint: m.hint,
  }))

  const snapOptions: UvDropdownOption[] = [
    { value: 'grid', label: 'Grid' },
    { value: 'vertex', label: 'Vertices' },
    {
      value: 'island',
      label: 'Islands',
      hint: uvEditorMode === 'faces' ? 'Align faces to other UV islands' : undefined,
    },
  ]

  const mappingMode = obj ? resolveUvMappingMode(obj) : 'perFace'
  const showSmartAngle = unwrapMethod === 'smart' || unwrapMethod === 'auto'
  const repeat = obj?.material?.textureRepeat ?? [1, 1]
  const offset = obj?.material?.textureOffset ?? [0, 0]
  const rotation = obj?.material?.textureRotation ?? 0
  const wrap = obj?.material?.textureWrap ?? 'clamp'

  return (
    <nav className="uv-sidebar" aria-label="UV editor tools">
      <section className="uv-sidebar-section">
        <div className="uv-sidebar-section-head">Source</div>
        <div className="uv-sidebar-stack">
          {objectId && (
            <UvToolbarDropdown
              className="uv-sidebar-control"
              label="Texture"
              value={activeTextureId ?? ''}
              options={textureOptions}
              placeholder="Select texture…"
              minMenuWidth={220}
              disabled={sceneTextures.length === 0}
              title="Scene textures shared across objects"
              onChange={onAssignTexture}
            />
          )}
          <button type="button" className="uv-btn uv-btn-block" onClick={() => void onImport()}>
            Import texture…
          </button>
        </div>
      </section>

      {obj && activeTextureId && (
        <section className="uv-sidebar-section uv-tiling-section">
          <div className="uv-sidebar-section-head">Texture tiling</div>
          <button
            type="button"
            className={`uv-btn uv-btn-block ${imageLayerEdit ? 'active' : ''}`}
            onClick={() => onSetImageLayerEdit(!imageLayerEdit)}
            title="Temporarily edit the texture layer instead of UV faces"
          >
            {imageLayerEdit ? 'Finish image layer' : 'Edit image layer'}
          </button>
          <UvToggle
            label="Auto-resize UVs"
            checked={autoResizeUvsWithImage}
            onChange={onSetAutoResizeUvsWithImage}
            title="Scale the UV layout together with image-layer resizing"
          />
          <UvSegment
            title="Texture edge behavior"
            value={wrap}
            onChange={(value) => onSetTextureTransform({ wrap: value })}
            options={[
              { id: 'clamp', label: 'Clamp' },
              { id: 'repeat', label: 'Repeat' },
              { id: 'mirror', label: 'Mirror' },
            ]}
          />
          <div className="uv-tiling-grid">
            <label><span>Repeat X</span><input type="number" min="0.01" max="100" step="0.1" value={repeat[0]} onChange={(e) => onSetTextureTransform({ repeat: [Math.max(0.01, Number(e.target.value)), repeat[1]] })} /></label>
            <label><span>Repeat Y</span><input type="number" min="0.01" max="100" step="0.1" value={repeat[1]} onChange={(e) => onSetTextureTransform({ repeat: [repeat[0], Math.max(0.01, Number(e.target.value))] })} /></label>
            <label><span>Offset X</span><input type="number" min="-10" max="10" step="0.01" value={offset[0]} onChange={(e) => onSetTextureTransform({ offset: [Number(e.target.value), offset[1]] })} /></label>
            <label><span>Offset Y</span><input type="number" min="-10" max="10" step="0.01" value={offset[1]} onChange={(e) => onSetTextureTransform({ offset: [offset[0], Number(e.target.value)] })} /></label>
            <label className="uv-tiling-wide"><span>Rotation</span><input type="number" min="-360" max="360" step="1" value={rotation} onChange={(e) => onSetTextureTransform({ rotation: Number(e.target.value) })} /></label>
          </div>
          <div className="uv-btn-grid uv-sidebar-stack-spaced">
            <button type="button" className="uv-btn" onClick={() => onSetTextureTransform({ wrap: 'repeat', repeat: [2, 2] })}>2 × 2</button>
            <button type="button" className="uv-btn" onClick={() => onSetTextureTransform({ wrap: 'repeat', repeat: [4, 4] })}>4 × 4</button>
            <button type="button" className="uv-btn uv-tiling-wide" onClick={() => onSetTextureTransform({ wrap: 'clamp', repeat: [1, 1], offset: [0, 0], rotation: 0 })}>Reset tiling</button>
          </div>
          <p className="uv-sidebar-help">Updates the UV canvas and 3D preview live.</p>
        </section>
      )}

      <section className="uv-sidebar-section">
        <div className="uv-sidebar-section-head">Selection</div>
        <div className="uv-sidebar-stack">
          <UvSegment
            title="Edit points or face islands"
            value={uvEditorMode}
            onChange={onSetUvEditorMode}
            options={[
              { id: 'points', label: 'Points', title: 'Select and move UV points' },
              { id: 'faces', label: 'Faces', title: 'Select and move UV face islands' },
            ]}
          />
          {obj && objectId && (
            <UvSegment
              title="UV mapping mode"
              value={mappingMode}
              onChange={onSetMappingMode}
              options={[
                { id: 'perFace', label: 'Per-Face', title: 'Planar UV per face' },
                { id: 'box', label: 'Box UV', title: 'Each face maps to a full 0–1 square' },
              ]}
            />
          )}
          <button
            type="button"
            className="uv-btn uv-btn-block"
            disabled={!canSelectConnected}
            onClick={onSelectConnected}
            title="Select every face in the connected UV island"
          >
            Select connected island
          </button>
        </div>
      </section>

      <section className="uv-sidebar-section">
        <div className="uv-sidebar-section-head">Transform</div>
        <div className="uv-btn-grid">
          <button type="button" className="uv-btn" onClick={() => onTransform('flipH')}>
            Flip H
          </button>
          <button type="button" className="uv-btn" onClick={() => onTransform('flipV')}>
            Flip V
          </button>
          <button type="button" className="uv-btn" onClick={() => onTransform('rotateCW')}>
            Rot 90°
          </button>
          <button type="button" className="uv-btn" onClick={() => onTransform('rotateCCW')}>
            Rot −90°
          </button>
          <button type="button" className="uv-btn" onClick={() => onTransform('fit')}>
            Fit
          </button>
          <button type="button" className="uv-btn" onClick={onFrameSelection} title="Frame view (F · double-click)">
            Frame
          </button>
        </div>
        <div className="uv-sidebar-stack uv-sidebar-stack-spaced">
          <UvToolbarDropdown
            className="uv-sidebar-control"
            label="Method"
            value={unwrapMethod}
            options={unwrapOptions}
            minMenuWidth={200}
            title="Unwrap algorithm"
            onChange={(v) => onSetUnwrapMethod(v as UvUnwrapMethod)}
          />
          <button
            type="button"
            className="uv-btn uv-btn-block uv-btn-primary"
            onClick={() => onUnwrap(unwrapMethod)}
            title={
              (UV_UNWRAP_METHODS.find((m) => m.id === unwrapMethod)?.hint ??
                'Unwrap selected faces (or all if none selected)') + ' (U)'
            }
          >
            Unwrap
          </button>
          {showSmartAngle && (
            <label className="uv-field uv-field-block" title="Smart UV angle limit (degrees)">
              <span className="uv-field-label">Angle</span>
              <input
                className="uv-num-input"
                type="number"
                min={1}
                max={180}
                value={uvEditorSmartUvAngle}
                onChange={(e) => onSetSmartUvAngle(Number(e.target.value))}
              />
              <span className="uv-field-suffix">°</span>
            </label>
          )}
        </div>
      </section>

      <section className="uv-sidebar-section">
        <div className="uv-sidebar-section-head">View &amp; snap</div>
        <div className="uv-sidebar-stack">
          <UvToggle label="Auto fit" checked={uvEditorAutoFit} onChange={onSetAutoFit} title="Pan/zoom to selection when off-screen" />
          <UvToggle label="Sticky regions" checked={uvEditorSticky} onChange={onSetSticky} title="Coplanar faces move together" />
          <button
            type="button"
            className={`uv-btn uv-btn-block ${uvEditorViewAll ? 'active' : ''}`}
            onClick={() => onSetViewAll(!uvEditorViewAll)}
            title="Show all UV islands in the atlas"
          >
            All islands
          </button>
          <button
            type="button"
            className="uv-btn uv-btn-block"
            onClick={onFitCanvas}
            title="Fit the entire UV grid canvas to the camera view"
          >
            Fit Canvas
          </button>
          <UvToggle label="Grid" checked={uvEditorShowGrid} onChange={onSetShowGrid} />
          <UvToggle label="Snap" checked={uvEditorSnap} onChange={onSetSnap} />
          <UvToolbarDropdown
            className="uv-sidebar-control"
            label="Snap to"
            value={uvEditorSnapMode}
            options={snapOptions}
            disabled={!uvEditorSnap}
            minMenuWidth={160}
            onChange={(v) => onSetSnapMode(v as UvSnapMode)}
          />
          <UvToggle label="Tile preview" checked={uvEditorTilePreview} onChange={onSetTilePreview} title="3×3 tiled texture preview" />
          <UvToggle
            label="Paint UV overlay"
            checked={showUvPaintOverlay}
            onChange={onSetShowUvPaintOverlay}
            title="Show UV islands on the Pixel Editor canvas so you know where to paint"
          />
          <label className="uv-field uv-field-block" title="Grid divisions">
            <span className="uv-field-label">Grid div</span>
            <input
              className="uv-num-input"
              type="number"
              min={1}
              max={64}
              value={uvEditorGridDivisions}
              onChange={(e) => onSetGridDivisions(Number(e.target.value))}
            />
          </label>
        </div>
      </section>
    </nav>
  )
}
