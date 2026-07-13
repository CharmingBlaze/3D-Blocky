import * as THREE from 'three'
import type { ViewportSlotIndex } from '../scene/viewTypes'

/** Per-viewport Object3D roots used for ray picking. */
const registries = new Map<ViewportSlotIndex, Map<string, THREE.Object3D>>()

function slotRegistry(slot: ViewportSlotIndex): Map<string, THREE.Object3D> {
  let map = registries.get(slot)
  if (!map) {
    map = new Map()
    registries.set(slot, map)
  }
  return map
}

export function registerPickTarget(
  slotIndex: ViewportSlotIndex,
  id: string,
  object: THREE.Object3D
): void {
  object.userData.sceneObjectId = id
  slotRegistry(slotIndex).set(id, object)
}

export function unregisterPickTarget(slotIndex: ViewportSlotIndex, id: string): void {
  const map = registries.get(slotIndex)
  if (!map) return
  map.delete(id)
  if (map.size === 0) registries.delete(slotIndex)
}

export function getPickTargets(slotIndex: ViewportSlotIndex): THREE.Object3D[] {
  const map = registries.get(slotIndex)
  return map ? [...map.values()] : []
}

export function getPickTarget(
  slotIndex: ViewportSlotIndex,
  id: string
): THREE.Object3D | undefined {
  return registries.get(slotIndex)?.get(id)
}

export function getPickMeshes(slotIndex: ViewportSlotIndex): THREE.Mesh[] {
  return getPickTargets(slotIndex).filter((o): o is THREE.Mesh => o instanceof THREE.Mesh)
}

/** @deprecated use registerPickTarget(slot, id, mesh) */
export function registerPickMesh(
  slotIndex: ViewportSlotIndex,
  id: string,
  mesh: THREE.Mesh
): void {
  registerPickTarget(slotIndex, id, mesh)
}

/** @deprecated use unregisterPickTarget(slot, id) */
export function unregisterPickMesh(slotIndex: ViewportSlotIndex, id: string): void {
  unregisterPickTarget(slotIndex, id)
}

export function clearPickRegistryForTests(): void {
  registries.clear()
}
