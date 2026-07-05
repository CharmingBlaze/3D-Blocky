import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore, PALETTE } from '../store/appStore'

interface PaletteBarProps {
  variant?: 'bar' | 'side'
}

function colorToHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

export function PaletteBar({ variant = 'bar' }: PaletteBarProps) {
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
    if (
      selectionMode === 'face' &&
      meshSelection &&
      meshSelection.faces.length > 0
    ) {
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
    selectionMode === 'face' &&
    meshSelection != null &&
    meshSelection.faces.length > 0
  const recoloring = selectionObjectIds.length > 0 || faceRecoloring
  const hex = colorToHex(displayColor)

  return (
    <div className={`palette-bar ${variant === 'side' ? 'palette-bar-side' : ''}`}>
      {PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          className={`palette-swatch ${displayColor === color ? 'active' : ''}`}
          style={{ background: colorToHex(color) }}
          onClick={() => setActiveColor(color)}
          title={colorToHex(color)}
        />
      ))}
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
    </div>
  )
}
