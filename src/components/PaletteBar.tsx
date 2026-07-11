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
  } = useAppStore(
    useShallow((s) => ({
      activeColor: s.activeColor,
      setActiveColor: s.setActiveColor,
      selectedObjectId: s.selectedObjectId,
      selectionObjectIds: s.selectionObjectIds,
      selectionMode: s.selectionMode,
      meshSelection: s.meshSelection,
      objects: s.objects,
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
      if (obj) return obj.color
    }
    return activeColor
  }, [selectionMode, meshSelection, selectedObjectId, objects, activeColor])

  const faceRecoloring =
    selectionMode === 'face' && meshSelection != null && meshSelection.faces.length > 0
  const recoloring = selectionObjectIds.length > 0 || faceRecoloring
  const hex = colorToHex(displayColor)

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
        {swatches}
        {customPicker}
      </div>
    </div>
  )
}

export default PaletteBar
