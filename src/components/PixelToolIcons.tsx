import type { ReactNode } from 'react'
import type { PixelTool } from '../pixel/pixelTypes'

/** Compact stroke icons matching PrimitiveIcons style. */
function IconSvg({ children }: { children: ReactNode }) {
  return (
    <svg
      className="px-tool-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

function PencilIcon() {
  return (
    <IconSvg>
      <path d="M14.5 4.5 19.5 9.5 8 21H3v-5L14.5 4.5Z" />
      <path d="M12.5 6.5 17.5 11.5" />
    </IconSvg>
  )
}

function BrushIcon() {
  return (
    <IconSvg>
      {/* Tip / bristles */}
      <path d="M9.5 11.5C7 14 4.5 14.5 3 15.5c1.2 2.8 4.2 6 7 7 1-1.5 1.5-4 4-6.5" />
      {/* Ferrule */}
      <path d="M9.5 11.5 14.5 16.5" />
      {/* Handle */}
      <path d="M14.5 8.5 19.2 3.8a1.6 1.6 0 0 1 2.3 2.3L16.8 10.8" />
      <path d="M12.8 10.2 16.2 13.6" />
      <path d="M11.5 9.5c1.2-1.2 3.2-1.4 4.5-.2l1.2 1.2c1.2 1.3 1 3.3-.2 4.5" />
    </IconSvg>
  )
}

function EraserIcon() {
  return (
    <IconSvg>
      <path d="M7.5 20H20" />
      <path d="M16.5 3.5 5.2 14.8a2 2 0 0 0 0 2.8L7.4 20l9.4-9.4a2 2 0 0 0 0-2.8L14.6 5.6a2 2 0 0 0-2.8 0Z" />
      <path d="M9.2 18.2 14.8 12.6" />
    </IconSvg>
  )
}

function LineIcon() {
  return (
    <IconSvg>
      <path d="M5 19 19 5" />
      <circle cx="5" cy="19" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="5" r="1.4" fill="currentColor" stroke="none" />
    </IconSvg>
  )
}

function RectIcon() {
  return (
    <IconSvg>
      <rect x="4.5" y="6.5" width="15" height="11" rx="1" />
    </IconSvg>
  )
}

function EllipseIcon() {
  return (
    <IconSvg>
      <ellipse cx="12" cy="12" rx="8" ry="5.5" />
    </IconSvg>
  )
}

function BucketIcon() {
  return (
    <IconSvg>
      <path d="M4.5 11.5 11 5l7.5 7.5-4.2 4.2a3 3 0 0 1-4.2 0L4.5 11.5Z" />
      <path d="M8.2 8.8 14.7 15.3" />
      <path d="M16.8 16.2c1.2 0 2.2 1.2 2.2 2.6 0 1.2-.8 2.2-2.2 2.2" />
    </IconSvg>
  )
}

function SelectIcon() {
  return (
    <IconSvg>
      <rect x="4.5" y="4.5" width="15" height="15" rx="1" strokeDasharray="2.5 2" />
    </IconSvg>
  )
}

function LassoIcon() {
  return (
    <IconSvg>
      <path d="M7.5 16.5c-2-1.4-3-3.4-3-5.4C4.5 7.2 7.6 4.5 12 4.5s7.5 2.7 7.5 6.6c0 2.6-1.4 4.6-3.6 5.8" />
      <path d="M10.5 17.5c.6 1.6 1.6 2.5 2.8 2.5 1.4 0 2.2-1.1 2.2-2.4 0-1.6-1.3-2.4-2.6-3.2" />
    </IconSvg>
  )
}

function PickIcon() {
  return (
    <IconSvg>
      <path d="M9.5 14.5 4.8 19.2" />
      <path d="M11.2 4.5 19.5 12.8l-3.4 1.1-1.1 3.4L6.7 9.1l1.1-3.4L11.2 4.5Z" />
      <path d="M13.2 6.5 17.5 10.8" />
    </IconSvg>
  )
}

const ICONS: Record<PixelTool, () => ReactNode> = {
  pencil: PencilIcon,
  paintBrush: BrushIcon,
  eraser: EraserIcon,
  line: LineIcon,
  rectangle: RectIcon,
  ellipse: EllipseIcon,
  bucket: BucketIcon,
  rectSelect: SelectIcon,
  lassoSelect: LassoIcon,
  eyedropper: PickIcon,
}

export function PixelToolIcon({ tool }: { tool: PixelTool }) {
  const Icon = ICONS[tool]
  return <Icon />
}
