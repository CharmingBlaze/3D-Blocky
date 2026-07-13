import type { SceneObject } from '../mesh/HalfEdgeMesh'

/** Parallel index into `objects[]` — rebuilt on structural scene changes only. */
let objectIndexById = new Map<string, number>()

export function rebuildObjectIndex(objects: SceneObject[]): void {
  const next = new Map<string, number>()
  for (let i = 0; i < objects.length; i++) {
    next.set(objects[i]!.id, i)
  }
  objectIndexById = next
}

export function getObjectIndex(id: string): number | undefined {
  return objectIndexById.get(id)
}

export function clearObjectIndex(): void {
  objectIndexById = new Map()
}

/** Test helper */
export function objectIndexSizeForTests(): number {
  return objectIndexById.size
}
