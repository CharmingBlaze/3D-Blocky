import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type UvDropdownOption = {
  value: string
  label: string
  disabled?: boolean
  hint?: string
}

interface UvToolbarDropdownProps {
  label: string
  value: string
  options: UvDropdownOption[]
  onChange: (value: string) => void
  disabled?: boolean
  title?: string
  placeholder?: string
  minMenuWidth?: number
  className?: string
}

const MENU_ITEM_HEIGHT = 34
const MENU_PADDING = 6

export function UvToolbarDropdown({
  label,
  value,
  options,
  onChange,
  disabled = false,
  title,
  placeholder = 'Select…',
  minMenuWidth = 168,
  className = '',
}: UvToolbarDropdownProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})

  const selected = options.find((opt) => opt.value === value)
  const displayValue = selected?.label ?? placeholder

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const menuWidth = Math.max(minMenuWidth, rect.width)
    const menuHeight = options.length * MENU_ITEM_HEIGHT + MENU_PADDING * 2

    let left = rect.left
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8)
    }

    let top = rect.bottom + 4
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuHeight - 4)
    }

    setMenuStyle({
      position: 'fixed',
      top,
      left,
      width: menuWidth,
      zIndex: 10050,
    })
  }, [open, options.length, minMenuWidth])

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

  const menu =
    open &&
    createPortal(
      <div className="uv-dropdown-menu" style={menuStyle} role="menu">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="menuitem"
            className={`uv-dropdown-item ${opt.value === value ? 'active' : ''}`}
            disabled={opt.disabled}
            title={opt.hint}
            onClick={() => {
              if (opt.disabled) return
              onChange(opt.value)
              setOpen(false)
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>,
      document.body
    )

  return (
    <div className={`uv-dropdown ${className}`.trim()} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`uv-dropdown-trigger ${open ? 'open' : ''}`}
        disabled={disabled}
        title={title ?? selected?.hint}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span className="uv-dropdown-label">{label}</span>
        <span className="uv-dropdown-value">{displayValue}</span>
        <span className="uv-dropdown-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {menu}
    </div>
  )
}
