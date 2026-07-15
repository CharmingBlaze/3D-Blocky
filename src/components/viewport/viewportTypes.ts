import type { ViewType, ViewportSlotIndex } from '../../scene/viewTypes'

/** Shared props for a single quad-view slot. */
export interface ViewportSlotProps {
  view: ViewType
  slotIndex: ViewportSlotIndex
  isActive: boolean
  isHovered: boolean
  onActivate: () => void
  /** False when hidden during maximize; canvas stays mounted either way. */
  layoutVisible: boolean
}

/** Per-viewport runtime snapshot (context value). */
export interface ViewportRuntimeState {
  slotIndex: ViewportSlotIndex
  view: ViewType
  isActive: boolean
  isHovered: boolean
  layoutVisible: boolean
  /** When true, canvas uses frameloop="always". */
  continuousFrames: boolean
  /** DPR / antialias budget: active slots get higher quality. */
  quality: 'high' | 'low'
}

export type ViewportInvalidateReason =
  | 'scene'
  | 'selection'
  | 'camera'
  | 'hover'
  | 'cad-preview'
  | 'layout'
  | 'fit'
  | 'manual'
  | 'pixel-texture'
