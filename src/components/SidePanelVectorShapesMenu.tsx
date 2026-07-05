import type { ShapeKind } from '../vector/types'
import { SideButtonDropdown } from './SideButtonDropdown'

const VECTOR_SHAPE_OPTIONS: { id: ShapeKind; label: string }[] = [
  { id: 'sphere', label: 'Sphere (ellipse)' },
  { id: 'circle', label: 'Circle (ellipse)' },
  { id: 'box', label: 'Box (rectangle)' },
  { id: 'roundedBox', label: 'Rounded Box (rectangle)' },
  { id: 'plane', label: 'Plane (rectangle)' },
  { id: 'cylinder', label: 'Cylinder (rectangle)' },
  { id: 'capsule', label: 'Capsule (ellipse)' },
  { id: 'pyramid', label: 'Pyramid (triangle)' },
  { id: 'cone', label: 'Cone (triangle)' },
]

interface SidePanelVectorShapesMenuProps {
  activeShapeKind: ShapeKind
  vectorShapeToolActive: boolean
  onSelect: (kind: ShapeKind) => void
}

export function SidePanelVectorShapesMenu({
  activeShapeKind,
  vectorShapeToolActive,
  onSelect,
}: SidePanelVectorShapesMenuProps) {
  return (
    <SideButtonDropdown
      label="Vector shapes…"
      value={vectorShapeToolActive ? activeShapeKind : null}
      active={vectorShapeToolActive}
      options={VECTOR_SHAPE_OPTIONS.map((shape) => ({ value: shape.id, label: shape.label }))}
      onSelect={(value) => onSelect(value as ShapeKind)}
      title="Drag to draw a low-poly primitive in an ortho view"
    />
  )
}

export { VECTOR_SHAPE_OPTIONS }
