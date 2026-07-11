import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
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

  const enabledOptionIndices = () =>
    options.flatMap((option, index) => (option.disabled ? [] : [index]))

  const focusEnabledOption = (index: number) => {
    const enabled = enabledOptionIndices()
    if (enabled.length === 0) return
    const target = enabled[((index % enabled.length) + enabled.length) % enabled.length]!
    itemRefs.current[target]?.focus()
  }

  const openAndFocus = (index: number) => {
    setOpen(true)
    window.requestAnimationFrame(() => focusEnabledOption(index))
  }

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      openAndFocus(0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      openAndFocus(-1)
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
    }
  }

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const currentIndex = itemRefs.current.findIndex((item) => item === document.activeElement)
    const enabledPosition = enabledOptionIndices().indexOf(currentIndex)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusEnabledOption(enabledPosition + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusEnabledOption(enabledPosition - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusEnabledOption(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusEnabledOption(-1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  return (
    <div className="side-button-dropdown" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`side-btn side-btn-wide side-btn-dropdown ${active || selected ? 'active' : ''}`}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        disabled={disabled}
        title={title}
        aria-expanded={open}
        aria-haspopup="menu"
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="side-btn-dropdown-label">{triggerLabel}</span>
        <span className="side-btn-dropdown-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="side-button-dropdown-menu" role="menu" onKeyDown={handleMenuKeyDown}>
          {options.map((opt, index) => (
            <button
              key={opt.value}
              type="button"
              ref={(element) => {
                itemRefs.current[index] = element
              }}
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
