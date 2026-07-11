import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { worldBounds } from '../mesh/objectTransform'
import type { Vec3 } from '../utils/math'
import * as THREE from 'three'
import { getCameraSetup, type ViewType } from '../scene/viewTypes'

export interface ViewportFitFrame {
  center: Vec3
  /** Bounding sphere radius (world units) covering the fit targets. */
  radius: number
}

const FIT_MARGIN = 1.35
const MIN_RADIUS = 4

/** World-space sphere that covers the given objects (AABB diagonal / 2). */
export function computeObjectsFitFrame(objects: SceneObject[]): ViewportFitFrame | null {
  if (objects.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  let any = false

  for (const obj of objects) {
    if (obj.positions.length === 0) continue
    const b = worldBounds(obj)
    if (!Number.isFinite(b.min.x)) continue
    any = true
    minX = Math.min(minX, b.min.x)
    minY = Math.min(minY, b.min.y)
    minZ = Math.min(minZ, b.min.z)
    maxX = Math.max(maxX, b.max.x)
    maxY = Math.max(maxY, b.max.y)
    maxZ = Math.max(maxZ, b.max.z)
  }

  if (!any) return null

  const center = {
    x: (minX + maxX) * 0.5,
    y: (minY + maxY) * 0.5,
    z: (minZ + maxZ) * 0.5,
  }
  const dx = maxX - minX
  const dy = maxY - minY
  const dz = maxZ - minZ
  const radius = Math.max(MIN_RADIUS, 0.5 * Math.hypot(dx, dy, dz))
  return { center, radius }
}

export function computeSelectionFitFrame(
  objects: SceneObject[],
  selectedIds: string[]
): ViewportFitFrame | null {
  const idSet = new Set(selectedIds)
  const selected = objects.filter((o) => idSet.has(o.id))
  return computeObjectsFitFrame(selected)
}

type OrbitLike = {
  target: THREE.Vector3
  update: () => void
  enabled?: boolean
}

/** Reset camera to the view’s canonical orientation and frame the fit sphere. */
export function applyViewportFit(
  camera: THREE.Camera,
  controls: OrbitLike | null | undefined,
  view: ViewType,
  frame: ViewportFitFrame,
  viewportSize: { width: number; height: number }
): void {
  const setup = getCameraSetup(view)
  const { center, radius } = frame
  const padded = radius * FIT_MARGIN

  const dir = new THREE.Vector3(setup.position[0], setup.position[1], setup.position[2])
  if (dir.lengthSq() < 1e-8) dir.set(1, 1, 1)
  dir.normalize()

  camera.up.set(setup.up[0], setup.up[1], setup.up[2])

  if (camera instanceof THREE.OrthographicCamera) {
    const distance = Math.max(padded * 2.5, 80)
    camera.position.set(
      center.x + dir.x * distance,
      center.y + dir.y * distance,
      center.z + dir.z * distance
    )
    const halfMin = Math.max(1, Math.min(viewportSize.width, viewportSize.height) * 0.5)
    camera.zoom = Math.max(0.05, halfMin / padded)
    camera.updateProjectionMatrix()
  } else if (camera instanceof THREE.PerspectiveCamera) {
    const fov = (camera.fov * Math.PI) / 180
    const distance = Math.max(padded / Math.tan(fov * 0.5), padded * 2.2, 40)
    camera.position.set(
      center.x + dir.x * distance,
      center.y + dir.y * distance,
      center.z + dir.z * distance
    )
    camera.updateProjectionMatrix()
  } else {
    return
  }

  camera.lookAt(center.x, center.y, center.z)

  if (controls) {
    controls.target.set(center.x, center.y, center.z)
    controls.update()
  }
}
