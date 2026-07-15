import type { ReactElement, ReactNode } from 'react'
import type { PrimitiveKind } from '../store/appStore'

/** Isometric CAD-style wireframe icons for each primitive. */
function IconSvg({ children }: { children: ReactNode }) {
  return (
    <svg
      className="primitive-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
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
      <path d="M12 2.8 18.7 6.7 20.1 13.8 15.5 20H8.5l-4.6-6.2 1.4-7.1L12 2.8Z" />
      <path d="m12 2.8-3.1 5 3.1 4.4 3.1-4.4-3.1-5Z" />
      <path d="M5.3 6.7 8.9 7.8 3.9 13.8l8.1-1.6 8.1 1.6-5-6 3.6-1.1M8.5 20l3.5-7.8 3.5 7.8" />
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
      <path d="M12 2.8 20.2 17.1 12 21 3.8 17.1 12 2.8Z" />
      <path d="M3.8 17.1 12 14.1l8.2 3M12 2.8v11.3M12 14.1V21" />
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
      <path d="M3.2 18.7h4.2v-4h4.3v-4h4.2v-4h4.2" />
      <path d="m3.2 18.7 3 2.1h4.2v-4h4.3v-4h4.2v-4l1.2-2.1" opacity="0.72" />
      <path d="m7.4 14.7 3 2.1m1.3-6.1 3 2.1m1.2-6.1 3 2.1" opacity="0.62" />
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
      <path d="M3.3 15.5a8.7 8.7 0 0 1 17.4 0" />
      <ellipse cx="12" cy="15.5" rx="8.7" ry="2.7" />
      <path d="M12 6.8c-2.3 2.1-3.4 5-3.2 8.7M12 6.8c2.3 2.1 3.4 5 3.2 8.7" />
      <path d="M5.6 10.6c3.7 1.5 9.1 1.5 12.8 0" opacity="0.7" />
    </IconSvg>
  )
}

function HalfCircleIcon() {
  return (
    <IconSvg>
      <path d="M3.2 16.8a8.8 8.8 0 0 1 17.6 0H3.2Z" />
      <path d="M12 8v8.8M5.4 11.2c3.9 1.4 9.3 1.4 13.2 0" opacity="0.72" />
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
