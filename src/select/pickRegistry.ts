import * as THREE from 'three'

const registry = new Map<string, THREE.Object3D>()

export function registerPickTarget(id: string, object: THREE.Object3D): void {
  object.userData.sceneObjectId = id
  registry.set(id, object)
}

export function unregisterPickTarget(id: string): void {
  registry.delete(id)
}

export function getPickTargets(): THREE.Object3D[] {
  return [...registry.values()]
}

export function getPickTarget(id: string): THREE.Object3D | undefined {
  return registry.get(id)
}

/** @deprecated use registerPickTarget */
export function registerPickMesh(id: string, mesh: THREE.Mesh): void {
  registerPickTarget(id, mesh)
}

/** @deprecated use unregisterPickTarget */
export function unregisterPickMesh(id: string): void {
  unregisterPickTarget(id)
}

export function getPickMeshes(): THREE.Mesh[] {
  return getPickTargets().filter((o): o is THREE.Mesh => o instanceof THREE.Mesh)
}
