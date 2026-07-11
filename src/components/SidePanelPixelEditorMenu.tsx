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
  const options = [
    { value: 'open', label: 'Open editor' },
    ...PIXEL_SIZE_PRESETS.map((preset) => ({
      value: `new-${preset.width}x${preset.height}`,
      label: `New ${preset.label}`,
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
