import * as THREE from 'three'

/** Flat-shaded normals derived from triangle index winding (not vertex averaging). */
export function setFlatNormalsFromIndices(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined
  const index = geo.getIndex()
  if (!pos || !index) {
    geo.computeVertexNormals()
    return
  }

  const normals = new Float32Array(pos.count * 3)
  for (let t = 0; t < index.count; t += 3) {
    const ia = index.getX(t)!
    const ib = index.getX(t + 1)!
    const ic = index.getX(t + 2)!

    const ax = pos.getX(ia)
    const ay = pos.getY(ia)
    const az = pos.getZ(ia)
    const bx = pos.getX(ib)
    const by = pos.getY(ib)
    const bz = pos.getZ(ib)
    const cx = pos.getX(ic)
    const cy = pos.getY(ic)
    const cz = pos.getZ(ic)

    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = cx - ax
    const vy = cy - ay
    const vz = cz - az

    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len

    for (const vi of [ia, ib, ic]) {
      normals[vi * 3] = nx
      normals[vi * 3 + 1] = ny
      normals[vi * 3 + 2] = nz
    }
  }

  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
}
