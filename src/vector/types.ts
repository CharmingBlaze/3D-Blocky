import type { ViewType } from '../store/appStore'

export type ShapeKind =
  | 'sphere'
  | 'circle'
  | 'box'
  | 'roundedBox'
  | 'plane'
  | 'cylinder'
  | 'capsule'
  | 'pyramid'
  | 'cone'

export interface VectorAnchor {
  id: string
  position: { x: number; y: number }
  inHandle: { x: number; y: number } | null
  outHandle: { x: number; y: number } | null
}

export interface ShapeParams {
  center?: { x: number; y: number }
  rx?: number
  ry?: number
  width?: number
  height?: number
  cornerRadius?: number
  sides?: number
  starPoints?: number
  innerRatio?: number
  rotation?: number
}

export interface VectorPath {
  id: string
  anchors: VectorAnchor[]
  closed: boolean
  view: ViewType
  color: number
  source: 'pen' | 'shape'
  shapeKind?: ShapeKind
  shapeParams?: ShapeParams
  /** Scene mesh created from this path (for auto-connect replace) */
  objectId?: string
}

export interface VectorDocument {
  paths: VectorPath[]
  activePathId: string | null
  selectedAnchorIds: string[]
}

export const emptyVectorDocument = (): VectorDocument => ({
  paths: [],
  activePathId: null,
  selectedAnchorIds: [],
})
