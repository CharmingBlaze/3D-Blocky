import { useId, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { PALETTE } from '../palette/drawPalette'
import { useAppStore } from '../store/appStore'

interface PaletteBarProps {
  variant?: 'bar' | 'side'
}

function colorToHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

export function PaletteBar({ variant = 'bar' }: PaletteBarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const contentId = useId()
  const {
    activeColor,
    setActiveColor,
    selectedObjectId,
    selectionObjectIds,
    selectionMode,
    meshSelection,
    objects,
    setSelectedTextureTintStrength,
  } = useAppStore(
    useShallow((s) => ({
      activeColor: s.activeColor,
      setActiveColor: s.setActiveColor,
      selectedObjectId: s.selectedObjectId,
      selectionObjectIds: s.selectionObjectIds,
      selectionMode: s.selectionMode,
      meshSelection: s.meshSelection,
      objects: s.objects,
      setSelectedTextureTintStrength: s.setSelectedTextureTintStrength,
    }))
  )

  const displayColor = useMemo(() => {
    if (selectionMode === 'face' && meshSelection && meshSelection.faces.length > 0) {
      const obj = objects.find((o) => o.id === meshSelection.objectId)
      if (obj) {
        const fi = meshSelection.faces[0]
        return obj.faceColors[fi] ?? obj.color
      }
    }
    if (selectedObjectId) {
      const obj = objects.find((o) => o.id === selectedObjectId)
      if (obj) {
        const tint = obj.material?.mode === 'texture' ? obj.material.textureTint : undefined
        if (tint) return (Math.round(tint[0] * 255) << 16) | (Math.round(tint[1] * 255) << 8) | Math.round(tint[2] * 255)
        return obj.color
      }
    }
    return activeColor
  }, [selectionMode, meshSelection, selectedObjectId, objects, activeColor])

  const faceRecoloring =
    selectionMode === 'face' && meshSelection != null && meshSelection.faces.length > 0
  const recoloring = selectionObjectIds.length > 0 || faceRecoloring
  const hex = colorToHex(displayColor)
  const texturedSelection = useMemo(() => {
    const ids = selectionObjectIds.length > 0 ? selectionObjectIds : selectedObjectId ? [selectedObjectId] : []
    return objects.filter((obj) => ids.includes(obj.id) && obj.material?.mode === 'texture')
  }, [objects, selectionObjectIds, selectedObjectId])
  const tintStrength = texturedSelection[0]?.material?.textureTintStrength ?? 0.5

  const swatches = (
    <div className="palette-swatches">
      {PALETTE.map((color, index) => (
        <button
          key={`${color}-${index}`}
          type="button"
          className={`palette-swatch ${displayColor === color ? 'active' : ''}`}
          style={{ background: colorToHex(color) }}
          onClick={() => setActiveColor(color)}
          title={colorToHex(color)}
        />
      ))}
    </div>
  )

  const customPicker = (
    <label
      className={`palette-custom ${recoloring ? 'palette-custom-recolor' : ''}`}
      title={
        faceRecoloring
          ? 'Custom color for selected faces'
          : recoloring
            ? 'Custom color for selection'
            : 'Custom draw color'
      }
    >
      <span className="palette-custom-preview" style={{ background: hex }} />
      <input
        type="color"
        value={hex}
        onChange={(e) => setActiveColor(parseInt(e.target.value.slice(1), 16))}
      />
    </label>
  )

  if (variant !== 'side') {
    return (
      <div className="palette-bar">
        {swatches}
        {customPicker}
      </div>
    )
  }

  return (
    <div className="palette-bar palette-bar-side">
      <button
        type="button"
        className="palette-minimize-toggle"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        aria-controls={contentId}
        title={collapsed ? 'Expand palette' : 'Minimize palette'}
      >
        <span className="palette-minimize-label">
          <span className="palette-minimize-swatch" style={{ background: hex }} aria-hidden />
          Palette
        </span>
        <span className="side-section-chevron" aria-hidden>
          {collapsed ? '▸' : '▾'}
        </span>
      </button>
      <div id={contentId} className="palette-minimize-body" hidden={collapsed}>
        <div className="palette-scroll-box themed-scroll">{swatches}</div>
        {customPicker}
        {texturedSelection.length > 0 && (
          <label className="palette-texture-tint">
            <span>Texture color amount <output>{Math.round(tintStrength * 100)}%</output></span>
            <input type="range" min="0" max="1" step="0.05" value={tintStrength} onChange={(e) => setSelectedTextureTintStrength(Number(e.target.value))} />
            <small>0% keeps the image · 100% applies the chosen color</small>
          </label>
        )}
      </div>
    </div>
  )
}

export default PaletteBar
