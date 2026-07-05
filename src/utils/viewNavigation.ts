import type { ViewType } from '../store/appStore'
import type { OrthoViewType } from '../scene/viewTypes'
import { normalizeViewType } from '../scene/viewTypes'
import type { Vec3 } from './math'

export type NudgeDirection = 'up' | 'down' | 'left' | 'right'

export interface ViewMoveBasis {
  right: Vec3
  up: Vec3
}

export function orthoViewNudgeDelta(
  view: OrthoViewType,
  dir: NudgeDirection,
  step: number
): Vec3 {
  const s = step
  switch (view) {
    case 'front':
      if (dir === 'up') return { x: 0, y: s, z: 0 }
      if (dir === 'down') return { x: 0, y: -s, z: 0 }
      if (dir === 'left') return { x: -s, y: 0, z: 0 }
      return { x: s, y: 0, z: 0 }
    case 'back':
      if (dir === 'up') return { x: 0, y: s, z: 0 }
      if (dir === 'down') return { x: 0, y: -s, z: 0 }
      if (dir === 'left') return { x: s, y: 0, z: 0 }
      return { x: -s, y: 0, z: 0 }
    case 'right':
      if (dir === 'up') return { x: 0, y: s, z: 0 }
      if (dir === 'down') return { x: 0, y: -s, z: 0 }
      if (dir === 'left') return { x: 0, y: 0, z: s }
      return { x: 0, y: 0, z: -s }
    case 'left':
      if (dir === 'up') return { x: 0, y: s, z: 0 }
      if (dir === 'down') return { x: 0, y: -s, z: 0 }
      if (dir === 'left') return { x: 0, y: 0, z: -s }
      return { x: 0, y: 0, z: s }
    case 'top':
      if (dir === 'up') return { x: 0, y: 0, z: s }
      if (dir === 'down') return { x: 0, y: 0, z: -s }
      if (dir === 'left') return { x: -s, y: 0, z: 0 }
      return { x: s, y: 0, z: 0 }
    case 'bottom':
      if (dir === 'up') return { x: 0, y: 0, z: -s }
      if (dir === 'down') return { x: 0, y: 0, z: s }
      if (dir === 'left') return { x: -s, y: 0, z: 0 }
      return { x: s, y: 0, z: 0 }
  }
}

export function perspectiveViewNudgeDelta(
  dir: NudgeDirection,
  step: number,
  basis: ViewMoveBasis
): Vec3 {
  const { right, up } = basis
  switch (dir) {
    case 'up':
      return { x: up.x * step, y: up.y * step, z: up.z * step }
    case 'down':
      return { x: -up.x * step, y: -up.y * step, z: -up.z * step }
    case 'left':
      return { x: -right.x * step, y: -right.y * step, z: -right.z * step }
    case 'right':
      return { x: right.x * step, y: right.y * step, z: right.z * step }
  }
}

export function viewNudgeDelta(
  view: ViewType,
  dir: NudgeDirection,
  step: number,
  perspectiveBasis: ViewMoveBasis | null
): Vec3 {
  if (view === 'perspective' && perspectiveBasis) {
    return perspectiveViewNudgeDelta(dir, step, perspectiveBasis)
  }
  if (view === 'perspective') {
    return { x: 0, y: 0, z: 0 }
  }
  return orthoViewNudgeDelta(normalizeViewType(view) as OrthoViewType, dir, step)
}
