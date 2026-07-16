import { useState } from 'react'
import { SideButtonDropdown } from './SideButtonDropdown'
import { PIXEL_SIZE_PRESETS } from '../pixel/pixelTypes'

interface SidePanelPixelEditorMenuProps {
  open: boolean
  minimized: boolean
  canPaintOnModel: boolean
  onOpen: () => void
  onClose: () => void
  onPaintOnModel: () => void
  onNewDocument: (width: number, height: number) => void
  onShowCanvas: () => void
}

export function SidePanelPixelEditorMenu({
  open,
  minimized,
  canPaintOnModel,
  onOpen,
  onClose,
  onPaintOnModel,
  onNewDocument,
  onShowCanvas,
}: SidePanelPixelEditorMenuProps) {
  const [customWidth, setCustomWidth] = useState(64)
  const [customHeight, setCustomHeight] = useState(64)
  const clampSize = (value: number) => Math.max(1, Math.min(512, Math.round(value || 1)))

  const createCustomMaterial = () => {
    const width = clampSize(customWidth)
    const height = clampSize(customHeight)
    setCustomWidth(width)
    setCustomHeight(height)
    onNewDocument(width, height)
  }

  const options = [
    { value: 'open', label: 'Open editor' },
    ...PIXEL_SIZE_PRESETS.map((preset) => ({
      value: `new-${preset.width}x${preset.height}`,
      label: `Clear Material · ${preset.label}`,
    })),
    {
      value: 'paint',
      label: 'Paint on selected model',
      disabled: !canPaintOnModel,
    },
    ...(open ? [{ value: 'close', label: 'Close editor' }] : []),
    ...(open && minimized ? [{ value: 'show', label: 'Show canvas' }] : []),
  ]

  return (
    <SideButtonDropdown
      label="Pixel Editor"
      alwaysShowLabel
      value={open ? (minimized ? 'show' : 'open') : null}
      active={open}
      options={options}
      footer={
        <div className="side-pixel-custom-size">
          <label>
            <span>W</span>
            <input
              type="number"
              min={1}
              max={512}
              value={customWidth}
              onChange={(event) => setCustomWidth(Number(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') createCustomMaterial()
              }}
              aria-label="Custom pixel material width"
            />
          </label>
          <span className="side-pixel-custom-times" aria-hidden>×</span>
          <label>
            <span>H</span>
            <input
              type="number"
              min={1}
              max={512}
              value={customHeight}
              onChange={(event) => setCustomHeight(Number(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') createCustomMaterial()
              }}
              aria-label="Custom pixel material height"
            />
          </label>
          <button
            type="button"
            className="side-btn"
            onClick={createCustomMaterial}
            title="Clear the selected material and create this custom pixel size"
          >
            Create
          </button>
        </div>
      }
      onSelect={(action) => {
        if (action === 'open') onOpen()
        else if (action === 'close') onClose()
        else if (action === 'paint') onPaintOnModel()
        else if (action === 'show') onShowCanvas()
        else if (action.startsWith('new-')) {
          const [w, h] = action.slice(4).split('x').map(Number)
          onNewDocument(w, h)
        }
      }}
      title="Pixel Editor — layered pixel art and paint-on-model texturing"
    />
  )
}
