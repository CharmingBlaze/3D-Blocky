import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'

/**
 * Reuses a HalfEdgeMesh across sculpt dabs in one stroke.
 * Topology is stable during sculpt; only positions mutate.
 * Cleared on undo/restore, object delete/update, and stroke end.
 */
const sessions = new Map<string, HalfEdgeMesh>()

export function getSculptSessionMesh(obj: SceneObject): HalfEdgeMesh {
  const existing = sessions.get(obj.id)
  if (existing) return existing
  const mesh = HalfEdgeMesh.fromObject(obj)
  sessions.set(obj.id, mesh)
  return mesh
}

export function clearSculptSession(objectId?: string): void {
  if (objectId === undefined) {
    sessions.clear()
    return
  }
  sessions.delete(objectId)
}

/** Test helper — returns whether a live session exists for an object. */
export function hasSculptSession(objectId: string): boolean {
  return sessions.has(objectId)
}
