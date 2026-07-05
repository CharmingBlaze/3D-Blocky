import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import type { ViewType } from '../store/appStore'
import type { OrthoViewType } from '../scene/viewTypes'
import {
  getViewLabel,
  isOrthoView,
  normalizeViewType,
  ORTHO_VIEW_OPTIONS,
} from '../scene/viewTypes'

interface ViewportViewPickerProps {
  view: ViewType
  onSelect: (view: OrthoViewType) => void
}

function stopViewportEvent(e: SyntheticEvent) {
  e.stopPropagation()
}

export function ViewportViewPicker({ view, onSelect }: ViewportViewPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const currentLabel = getViewLabel(view)
  const currentOrtho = isOrthoView(view) ? normalizeViewType(view) : null

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="viewport-view-picker" ref={rootRef}>
      <button
        type="button"
        className="viewport-label viewport-view-picker-trigger"
        aria-label="Change viewport view"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          stopViewportEvent(e)
          setOpen((wasOpen) => !wasOpen)
        }}
        onPointerDown={stopViewportEvent}
      >
        {currentLabel}
      </button>
      {open && (
        <div className="viewport-view-picker-menu" role="menu">
          {ORTHO_VIEW_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              className={`viewport-view-picker-item ${currentOrtho === option.id ? 'active' : ''}`}
              onClick={(e) => {
                stopViewportEvent(e)
                onSelect(option.id)
                setOpen(false)
              }}
              onPointerDown={stopViewportEvent}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
