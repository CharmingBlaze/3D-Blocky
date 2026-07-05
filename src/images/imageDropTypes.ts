import type { ViewType } from '../store/appStore'
import type { Vec3 } from '../utils/math'

/** Mutually exclusive — only one mode active at a time. */
export type ImageDropMode = 'off' | 'reference' | 'billboard' | 'textured-plane'

/** Screen-space reference pinned to a single viewport. */
export interface ReferenceImage {
  id: string
  view: ViewType
  url: string
  name: string
  /** Center X in normalized viewport coords (0–1). */
  x: number
  /** Center Y in normalized viewport coords (0–1). */
  y: number
  /** Width as a fraction of viewport width. */
  width: number
  /** Image width / height. */
  aspect: number
  opacity: number
}

/** World-space image that always faces the active camera. */
export interface BillboardImage {
  id: string
  url: string
  name: string
  position: Vec3
  /** Optional pivot rotation; plane still billboards toward the camera. */
  rotation?: Vec3
  width: number
  height: number
  opacity: number
}

export const DEFAULT_REFERENCE_WIDTH = 0.38
export const DEFAULT_IMAGE_WORLD_WIDTH = 96
