import type { Uv2 } from './uvTypes'

export interface UvDraftSnapshot {
  objectId: string
  uvs: readonly Uv2[]
}

type UvDraftListener = (snapshot: UvDraftSnapshot | null) => void

let currentDraft: UvDraftSnapshot | null = null
const listeners = new Set<UvDraftListener>()
let pendingRaf: number | null = null
let pendingSnapshot: UvDraftSnapshot | null = null

function notify(snapshot: UvDraftSnapshot | null) {
  currentDraft = snapshot
  for (const listener of listeners) listener(currentDraft)
}

/** Subscribe to in-progress UV edits. Returns an unsubscribe function. */
export function subscribeUvDraft(listener: UvDraftListener): () => void {
  listeners.add(listener)
  listener(currentDraft)
  return () => {
    listeners.delete(listener)
  }
}

/** Publish draft UVs immediately (tests / rare sync paths). */
export function setUvDraft(objectId: string, uvs: readonly Uv2[]): void {
  if (pendingRaf != null) {
    cancelAnimationFrame(pendingRaf)
    pendingRaf = null
    pendingSnapshot = null
  }
  notify({ objectId, uvs })
}

/**
 * Publish draft UVs at most once per animation frame.
 * Mutate `uvs` in place between calls — listeners always read the latest pool.
 */
export function scheduleUvDraft(objectId: string, uvs: readonly Uv2[]): void {
  pendingSnapshot = { objectId, uvs }
  if (pendingRaf != null) return
  pendingRaf = requestAnimationFrame(() => {
    pendingRaf = null
    const next = pendingSnapshot
    pendingSnapshot = null
    if (next) notify(next)
  })
}

/** Clear draft preview (commit, cancel, object change, or panel close). */
export function clearUvDraft(objectId?: string): void {
  if (pendingRaf != null) {
    cancelAnimationFrame(pendingRaf)
    pendingRaf = null
    pendingSnapshot = null
  }
  if (objectId && currentDraft?.objectId !== objectId) return
  if (!currentDraft) return
  notify(null)
}

export function getUvDraftForTests(): UvDraftSnapshot | null {
  return currentDraft
}
