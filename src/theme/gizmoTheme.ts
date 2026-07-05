import * as THREE from 'three'
import type { ThemeColors } from './useTheme'
import { hexToNumber } from './themes'

const GIZMO_SLOT = '__gizmoColorSlot__'

type GizmoSlot = 'x' | 'y' | 'z' | 'planeA' | 'planeB' | 'planeC' | 'neutral'

/** Default TransformControls material colors from three-stdlib. */
const SLOT_BY_DEFAULT_HEX: Record<number, GizmoSlot> = {
  0xff0000: 'x',
  0x00ff00: 'y',
  0x0000ff: 'z',
  0xffff00: 'planeA',
  0x00ffff: 'planeB',
  0xff00ff: 'planeC',
  0x787878: 'neutral',
}

function slotColor(theme: ThemeColors, slot: GizmoSlot): number {
  switch (slot) {
    case 'x':
      return hexToNumber(theme.accentPink)
    case 'y':
      return hexToNumber(theme.accentGreen)
    case 'z':
      return hexToNumber(theme.accent)
    case 'planeA':
      return hexToNumber(theme.accentOrange)
    case 'planeB':
      return hexToNumber(theme.meshHover)
    case 'planeC':
      return hexToNumber(theme.accentPink)
    case 'neutral':
      return hexToNumber(theme.textMuted)
    default:
      return hexToNumber(theme.accent)
  }
}

function themedMaterialColor(
  mat: THREE.MeshBasicMaterial | THREE.LineBasicMaterial,
  theme: ThemeColors
): void {
  if (!mat.userData[GIZMO_SLOT]) {
    const hex = mat.color.getHex()
    mat.userData[GIZMO_SLOT] = SLOT_BY_DEFAULT_HEX[hex] ?? 'neutral'
  }
  const slot = mat.userData[GIZMO_SLOT] as GizmoSlot
  const next = slotColor(theme, slot)
  mat.color.setHex(next)
  const temp = (mat as THREE.Material & { tempColor?: THREE.Color }).tempColor
  if (temp instanceof THREE.Color) temp.setHex(next)
}

/** Recolor translate/rotate/scale gizmo handles to match the active theme. */
export function applyTransformControlsTheme(
  controls: THREE.Object3D,
  theme: ThemeColors
): void {
  controls.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.material) return
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]
    for (const mat of materials) {
      if (
        mat instanceof THREE.MeshBasicMaterial ||
        mat instanceof THREE.LineBasicMaterial
      ) {
        themedMaterialColor(mat, theme)
      }
    }
  })
}
