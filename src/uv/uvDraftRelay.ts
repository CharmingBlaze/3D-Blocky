import type { Uv2 } from './uvTypes'

export interface UvDraftSnapshot {
  objectId: string
  uvs: readonly Uv2[]
}

type UvDraftListener = (snapshot: UvDraftSnapshot | null) => void

let currentDraft: UvDraftSnapshot | null = null
const listeners = new Set<UvDraftListener>()

function notify() {
  for (const listener of listeners) {
    listener(currentDraft)
  }
}

/** Subscribe to in-progress UV edits. Returns an unsubscribe function. */
export function subscribeUvDraft(listener: UvDraftListener): () => void {
  listeners.add(listener)
  listener(currentDraft)
  return () => {
    listeners.delete(listener)
  }
}

/** Publish draft UVs for live viewport preview — never write these to the global store. */
export function setUvDraft(objectId: string, uvs: readonly Uv2[]): void {
  currentDraft = { objectId, uvs }
  notify()
}

/** Clear draft preview (commit, object change, or panel close). */
export function clearUvDraft(objectId?: string): void {
  if (objectId && currentDraft?.objectId !== objectId) return
  if (!currentDraft) return
  currentDraft = null
  notify()
}
