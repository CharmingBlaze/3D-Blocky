import type { PrimitiveKind } from '../store/appStore'
import { SideButtonDropdown } from './SideButtonDropdown'

const PRIMITIVE_OPTIONS: { id: PrimitiveKind; label: string }[] = [
  { id: 'box', label: 'Box' },
  { id: 'roundedBox', label: 'Rounded Box' },
  { id: 'icosphere', label: 'Icosphere' },
  { id: 'sphere', label: 'Sphere' },
  { id: 'cone', label: 'Cone' },
  { id: 'cylinder', label: 'Cylinder' },
  { id: 'capsule', label: 'Capsule' },
  { id: 'pyramid', label: 'Pyramid' },
]

interface SidePanelPrimitivesMenuProps {
  activePrimitiveKind: PrimitiveKind | null
  primitiveToolActive: boolean
  onSelect: (kind: PrimitiveKind) => void
}

export function SidePanelPrimitivesMenu({
  activePrimitiveKind,
  primitiveToolActive,
  onSelect,
}: SidePanelPrimitivesMenuProps) {
  return (
    <SideButtonDropdown
      label="CAD"
      alwaysShowLabel
      value={primitiveToolActive ? activePrimitiveKind : null}
      active={primitiveToolActive && !!activePrimitiveKind}
      options={PRIMITIVE_OPTIONS.map((p) => ({ value: p.id, label: p.label }))}
      onSelect={(value) => onSelect(value as PrimitiveKind)}
      title="Ortho: drag base in Front/Side/Top, extrude in another view. Perspective: drag footprint, scroll height, middle-click to place."
    />
  )
}

export { PRIMITIVE_OPTIONS as PRIMITIVE_KINDS }
