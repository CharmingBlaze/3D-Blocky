import type { SceneObject } from '../mesh/HalfEdgeMesh'

export function isSceneObjectVisible(object: SceneObject): boolean {
  return object.visible !== false
}
