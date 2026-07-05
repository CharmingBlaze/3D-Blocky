import { useEffect, useRef, useState, type ReactNode } from 'react'

export type SideButtonDropdownOption = {
  value: string
  label: string
  disabled?: boolean
}

interface SideButtonDropdownProps {
  label: string
  value?: string | null
  options: SideButtonDropdownOption[]
  onSelect: (value: string) => void
  title?: string
  disabled?: boolean
  active?: boolean
  /** Keep `label` visible when idle; show `label · option` when selected. */
  alwaysShowLabel?: boolean
  footer?: ReactNode
}

export function SideButtonDropdown({
  label,
  value = null,
  options,
  onSelect,
  title,
  disabled = false,
  active = false,
  alwaysShowLabel = false,
  footer,
}: SideButtonDropdownProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  const selected = value ? options.find((opt) => opt.value === value) : undefined
  const triggerLabel = alwaysShowLabel
    ? selected
      ? `${label} · ${selected.label}`
      : label
    : (selected?.label ?? label)

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
    <div className="side-button-dropdown" ref={rootRef}>
      <button
        type="button"
        className={`side-btn side-btn-wide side-btn-dropdown ${active || selected ? 'active' : ''}`}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        disabled={disabled}
        title={title}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="side-btn-dropdown-label">{triggerLabel}</span>
        <span className="side-btn-dropdown-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="side-button-dropdown-menu" role="menu">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="menuitem"
              className={`side-button-dropdown-item ${opt.value === value ? 'active' : ''}`}
              disabled={opt.disabled}
              onClick={() => {
                if (opt.disabled) return
                onSelect(opt.value)
                setOpen(false)
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      {footer}
    </div>
  )
}
