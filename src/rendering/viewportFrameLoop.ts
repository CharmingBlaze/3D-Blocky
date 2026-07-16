import { useSyncExternalStore } from 'react'
import type { ViewportSlotIndex } from '../scene/viewTypes'

export type ViewportInteractionKind = 'local' | 'shared'

type InteractionListener = () => void

export interface ViewportContinuousFrameState {
  layoutVisible: boolean
  isActive: boolean
  localActive: boolean
  sharedActiveHere: boolean
  cadPreviewActive: boolean
}

/**
 * Continuous frames are limited to the viewport producing camera/tool motion.
 * Peer panes receive explicit invalidations when shared scene state changes.
 */
export function shouldViewportRenderContinuously(
  state: ViewportContinuousFrameState
): boolean {
  return (
    state.layoutVisible &&
    (state.localActive ||
      state.sharedActiveHere ||
      (state.isActive && state.cadPreviewActive))
  )
}

const localCounts = new Map<ViewportSlotIndex, number>()
const sharedCounts = new Map<ViewportSlotIndex, number>()
const listeners = new Set<InteractionListener>()

let version = 0

function notifyInteraction(): void {
  version += 1
  for (const listener of listeners) listener()
}

function bump(map: Map<ViewportSlotIndex, number>, slot: ViewportSlotIndex, delta: number): boolean {
  const prev = map.get(slot) ?? 0
  const next = Math.max(0, prev + delta)
  if (next === prev) return false
  if (next === 0) map.delete(slot)
  else map.set(slot, next)
  return true
}

/** Camera orbit/pan/zoom — continuous frames only on this slot. */
export function pushViewportLocalInteraction(slot: ViewportSlotIndex): void {
  if (bump(localCounts, slot, 1)) notifyInteraction()
}

export function popViewportLocalInteraction(slot: ViewportSlotIndex): void {
  if (bump(localCounts, slot, -1)) notifyInteraction()
}

/** Mesh/sculpt/gizmo edits — continuous on source slot; peers demand+invalidate. */
export function pushViewportSharedInteraction(slot: ViewportSlotIndex): void {
  if (bump(sharedCounts, slot, 1)) notifyInteraction()
}

export function popViewportSharedInteraction(slot: ViewportSlotIndex): void {
  if (bump(sharedCounts, slot, -1)) notifyInteraction()
}

/** @deprecated Prefer typed local/shared helpers */
export function pushViewportInteraction(
  slot?: ViewportSlotIndex,
  kind: ViewportInteractionKind = 'shared'
): void {
  const s = (slot ?? 0) as ViewportSlotIndex
  if (kind === 'local') pushViewportLocalInteraction(s)
  else pushViewportSharedInteraction(s)
}

/** @deprecated Prefer typed local/shared helpers */
export function popViewportInteraction(
  slot?: ViewportSlotIndex,
  kind: ViewportInteractionKind = 'shared'
): void {
  const s = (slot ?? 0) as ViewportSlotIndex
  if (kind === 'local') popViewportLocalInteraction(s)
  else popViewportSharedInteraction(s)
}

export function isViewportLocalInteractionActive(slot: ViewportSlotIndex): boolean {
  return (localCounts.get(slot) ?? 0) > 0
}

export function isViewportSharedInteractionActive(slot?: ViewportSlotIndex): boolean {
  if (slot !== undefined) return (sharedCounts.get(slot) ?? 0) > 0
  for (const count of sharedCounts.values()) {
    if (count > 0) return true
  }
  return false
}

export function getSharedInteractionSourceSlot(): ViewportSlotIndex | null {
  for (const [slot, count] of sharedCounts) {
    if (count > 0) return slot
  }
  return null
}

export function isViewportInteractionActive(slot?: ViewportSlotIndex): boolean {
  if (slot !== undefined) {
    return isViewportLocalInteractionActive(slot) || isViewportSharedInteractionActive(slot)
  }
  return isViewportSharedInteractionActive() || localCounts.size > 0
}

export function subscribeViewportInteraction(onStoreChange: InteractionListener): () => void {
  listeners.add(onStoreChange)
  return () => listeners.delete(onStoreChange)
}

function getVersion(): number {
  return version
}

/** Per-slot interaction flags (stable primitive snapshot via version). */
export function useViewportSlotInteraction(slot: ViewportSlotIndex): {
  localActive: boolean
  sharedActiveHere: boolean
  /** @deprecated Prefer sharedActiveHere + invalidate peers; do not continuous-render all. */
  sharedActiveAnywhere: boolean
} {
  const ver = useSyncExternalStore(subscribeViewportInteraction, getVersion, () => 0)
  void ver
  return {
    localActive: isViewportLocalInteractionActive(slot),
    sharedActiveHere: isViewportSharedInteractionActive(slot),
    sharedActiveAnywhere: isViewportSharedInteractionActive(),
  }
}

/** Legacy hook — true if any interaction is active. */
export function useViewportInteractionActive(): boolean {
  return useSyncExternalStore(
    subscribeViewportInteraction,
    isViewportInteractionActive,
    () => false
  )
}

/** Test helper — drop all interaction refcounts. */
export function clearViewportInteractionForTests(): void {
  if (localCounts.size === 0 && sharedCounts.size === 0) return
  localCounts.clear()
  sharedCounts.clear()
  notifyInteraction()
}
