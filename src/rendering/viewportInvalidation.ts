import type { ViewportSlotIndex } from '../scene/viewTypes'
import type { ViewportInvalidateReason } from '../components/viewport/viewportTypes'

type SlotEntry = {
  invalidate: () => void
  layoutVisible: boolean
}

const slots = new Map<ViewportSlotIndex, SlotEntry>()
const pendingRaf = new Map<ViewportSlotIndex, number>()

/** At most one pending rAF per slot. */
function scheduleSlot(slot: ViewportSlotIndex): void {
  const entry = slots.get(slot)
  if (!entry || !entry.layoutVisible) return
  if (pendingRaf.has(slot)) return
  const id = requestAnimationFrame(() => {
    pendingRaf.delete(slot)
    const current = slots.get(slot)
    if (current?.layoutVisible) current.invalidate()
  })
  pendingRaf.set(slot, id)
}

export function registerViewportInvalidator(
  slotIndex: ViewportSlotIndex,
  invalidate: () => void,
  layoutVisible: boolean
): void {
  slots.set(slotIndex, { invalidate, layoutVisible })
}

export function updateViewportInvalidatorVisibility(
  slotIndex: ViewportSlotIndex,
  layoutVisible: boolean
): void {
  const entry = slots.get(slotIndex)
  if (!entry) return
  entry.layoutVisible = layoutVisible
}

export function unregisterViewportInvalidator(
  slotIndex: ViewportSlotIndex,
  invalidate?: () => void
): void {
  const entry = slots.get(slotIndex)
  if (!entry) return
  if (invalidate && entry.invalidate !== invalidate) return
  const raf = pendingRaf.get(slotIndex)
  if (raf != null) {
    cancelAnimationFrame(raf)
    pendingRaf.delete(slotIndex)
  }
  slots.delete(slotIndex)
}

/** Demand-render one viewport (camera, hover, local preview). */
export function invalidateViewport(
  slotIndex: ViewportSlotIndex,
  _reason?: ViewportInvalidateReason
): void {
  scheduleSlot(slotIndex)
}

/** Demand-render every registered visible viewport (scene / selection commits). */
export function invalidateAllViewports(_reason?: ViewportInvalidateReason): void {
  for (const slot of slots.keys()) {
    scheduleSlot(slot)
  }
}

/** Test helpers */
export function clearViewportInvalidationForTests(): void {
  for (const id of pendingRaf.values()) cancelAnimationFrame(id)
  pendingRaf.clear()
  slots.clear()
}

export function getRegisteredViewportSlotsForTests(): ViewportSlotIndex[] {
  return [...slots.keys()]
}

export function hasPendingViewportInvalidationForTests(slot: ViewportSlotIndex): boolean {
  return pendingRaf.has(slot)
}
