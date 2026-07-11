import type { ReactElement, ReactNode } from 'react'
import type { PrimitiveKind } from '../store/appStore'

/** Isometric CAD-style wireframe icons for each primitive. */
function IconSvg({ children }: { children: ReactNode }) {
  return (
    <svg
      className="primitive-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

function BoxIcon() {
  return (
    <IconSvg>
      <path d="M12 3.2 20 7.5v9L12 20.8 4 16.5v-9L12 3.2Z" />
      <path d="M12 12.2 20 7.5M12 12.2 4 7.5M12 12.2V20.8" />
    </IconSvg>
  )
}

function IcosphereIcon() {
  return (
    <IconSvg>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 3.8 16.8 8.2 12 20.2 7.2 8.2Z" />
      <path d="M3.8 12h16.4M7.2 8.2h9.6M8.4 15.6h7.2" />
    </IconSvg>
  )
}

function SphereIcon() {
  return (
    <IconSvg>
      <circle cx="12" cy="12" r="8.2" />
      <ellipse cx="12" cy="12" rx="3.4" ry="8.2" />
      <path d="M3.8 12h16.4" />
    </IconSvg>
  )
}

function ConeIcon() {
  return (
    <IconSvg>
      <path d="M12 3.4 19.4 18.8H4.6L12 3.4Z" />
      <ellipse cx="12" cy="18.8" rx="7.4" ry="2.1" />
    </IconSvg>
  )
}

function CylinderIcon() {
  return (
    <IconSvg>
      <ellipse cx="12" cy="5.2" rx="6.4" ry="2.2" />
      <path d="M5.6 5.2v12.8" />
      <path d="M18.4 5.2v12.8" />
      <ellipse cx="12" cy="18" rx="6.4" ry="2.2" />
    </IconSvg>
  )
}

function CapsuleIcon() {
  return (
    <IconSvg>
      <path d="M8.2 7.2a3.8 3.8 0 0 1 7.6 0v9.6a3.8 3.8 0 0 1-7.6 0V7.2Z" />
      <path d="M8.2 7.2h7.6M8.2 16.8h7.6" />
    </IconSvg>
  )
}

function PyramidIcon() {
  return (
    <IconSvg>
      <path d="M12 3.2 20.2 18.6 12 15.4 3.8 18.6 12 3.2Z" />
      <path d="M12 15.4V3.2" />
    </IconSvg>
  )
}

function DoughnutIcon() {
  return (
    <IconSvg>
      <ellipse cx="12" cy="12" rx="8.2" ry="4.4" />
      <ellipse cx="12" cy="12" rx="3.2" ry="1.7" />
      <path d="M3.8 12c0 2.4 3.7 4.4 8.2 4.4s8.2-2 8.2-4.4" opacity="0.55" />
    </IconSvg>
  )
}

function RingIcon() {
  return (
    <IconSvg>
      <ellipse cx="12" cy="12" rx="8" ry="5.2" />
      <ellipse cx="12" cy="12" rx="4.2" ry="2.7" />
    </IconSvg>
  )
}

function StairsIcon() {
  return (
    <IconSvg>
      <path d="M4.2 18.8H9V14h4.8V9.2H18.6V5.2H20" />
      <path d="M4.2 18.8V20H20V5.2" opacity="0.45" />
    </IconSvg>
  )
}

function StarIcon() {
  return (
    <IconSvg>
      <path d="M12 2.8 13.7 8.4H19.6L14.9 11.8 16.6 17.4 12 14 7.4 17.4 9.1 11.8 4.4 8.4h5.9L12 2.8Z" />
    </IconSvg>
  )
}

function DomeIcon() {
  return (
    <IconSvg>
      <path d="M4.2 15.2a7.8 7.8 0 0 1 15.6 0" />
      <ellipse cx="12" cy="15.2" rx="7.8" ry="2.4" />
      <path d="M12 7.4v7.8" opacity="0.55" />
    </IconSvg>
  )
}

function HalfCircleIcon() {
  return (
    <IconSvg>
      <path d="M4.2 14.8a7.8 7.8 0 0 1 15.6 0" />
      <path d="M4.2 14.8h15.6" />
      <path d="M12 7v7.8" opacity="0.5" />
    </IconSvg>
  )
}

const ICONS: Record<Exclude<PrimitiveKind, 'roundedBox'>, () => ReactElement> = {
  box: BoxIcon,
  icosphere: IcosphereIcon,
  sphere: SphereIcon,
  cone: ConeIcon,
  cylinder: CylinderIcon,
  capsule: CapsuleIcon,
  pyramid: PyramidIcon,
  doughnut: DoughnutIcon,
  ring: RingIcon,
  stairs: StairsIcon,
  star: StarIcon,
  dome: DomeIcon,
  halfCircle: HalfCircleIcon,
}

export function PrimitiveIcon({ kind }: { kind: PrimitiveKind }) {
  const resolved = kind === 'roundedBox' ? 'box' : kind
  const Icon = ICONS[resolved]
  return <Icon />
}
