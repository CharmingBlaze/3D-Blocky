import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { worldBounds } from '../mesh/objectTransform'

export interface SceneWorldBounds {
  min: THREE.Vector3
  max: THREE.Vector3
}

const MIN_NEAR = 0.01
const DEFAULT_FAR = 4000
const ORTHO_CAMERA_MARGIN = 32
const _forward = new THREE.Vector3()
const _corner = new THREE.Vector3()

/** Compute model bounds once per immutable objects collection. */
export function computeSceneWorldBounds(objects: SceneObject[]): SceneWorldBounds | null {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  let any = false
  for (const object of objects) {
    if (object.positions.length === 0) continue
    const bounds = worldBounds(object)
    if (!Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.x)) continue
    min.min(new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z))
    max.max(new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z))
    any = true
  }
  return any ? { min, max } : null
}

function depthRange(camera: THREE.Camera, bounds: SceneWorldBounds): { min: number; max: number } {
  camera.getWorldDirection(_forward).normalize()
  let minDepth = Infinity
  let maxDepth = -Infinity
  for (let xi = 0; xi < 2; xi++) {
    for (let yi = 0; yi < 2; yi++) {
      for (let zi = 0; zi < 2; zi++) {
        _corner.set(
          xi ? bounds.max.x : bounds.min.x,
          yi ? bounds.max.y : bounds.min.y,
          zi ? bounds.max.z : bounds.min.z
        )
        const depth = _corner.sub(camera.position).dot(_forward)
        minDepth = Math.min(minDepth, depth)
        maxDepth = Math.max(maxDepth, depth)
      }
    }
  }
  return { min: minDepth, max: maxDepth }
}

/**
 * Keep every orthographic model in front of its camera and tune clipping for
 * both tiny and very large scenes. Returns true when the projection changed.
 */
export function updateAdaptiveCameraClip(
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera,
  bounds: SceneWorldBounds | null
): boolean {
  if (!bounds) return false
  let range = depthRange(camera, bounds)
  let moved = false

  if (camera instanceof THREE.OrthographicCamera && range.min < ORTHO_CAMERA_MARGIN) {
    const shift = ORTHO_CAMERA_MARGIN - range.min
    // Move opposite the viewing direction. Lateral pan and zoom stay untouched.
    camera.position.addScaledVector(_forward, -shift)
    camera.updateMatrixWorld(true)
    range = { min: range.min + shift, max: range.max + shift }
    moved = true
  }

  const nextFar = Math.max(DEFAULT_FAR, range.max + Math.max(64, (range.max - range.min) * 0.25))
  const nextNear = camera instanceof THREE.OrthographicCamera
    ? MIN_NEAR
    : Math.max(MIN_NEAR, Math.min(10, range.min > 0 ? range.min * 0.05 : MIN_NEAR))
  const planesChanged =
    Math.abs(camera.near - nextNear) > 1e-4 ||
    Math.abs(camera.far - nextFar) > Math.max(0.1, nextFar * 1e-5)
  if (planesChanged) {
    camera.near = nextNear
    camera.far = nextFar
    camera.updateProjectionMatrix()
  }
  return moved || planesChanged
}
