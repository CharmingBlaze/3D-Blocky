import * as THREE from 'three'

const _worldPos = new THREE.Vector3()

/** Convert a screen-pixel size to world units at `worldPosition` for the active camera. */
export function worldUnitsForScreenPixels(
  camera: THREE.Camera,
  worldPosition: THREE.Vector3,
  pixels: number,
  viewportHeight: number
): number {
  if (viewportHeight <= 0 || pixels <= 0) return pixels

  if (camera instanceof THREE.OrthographicCamera) {
    const worldHeight = (camera.top - camera.bottom) / camera.zoom
    return (pixels / viewportHeight) * worldHeight
  }

  const distance = camera.position.distanceTo(worldPosition)
  const fov =
    camera instanceof THREE.PerspectiveCamera ? camera.fov : 50
  const fovRad = fov * (Math.PI / 180)
  const worldHeight = 2 * distance * Math.tan(fovRad / 2)
  return (pixels / viewportHeight) * worldHeight
}

/** Read world position from an object3D each frame without allocating. */
export function readWorldPosition(object: THREE.Object3D, target = _worldPos): THREE.Vector3 {
  return object.getWorldPosition(target)
}
