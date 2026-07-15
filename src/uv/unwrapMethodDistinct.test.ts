import { describe, expect, it } from 'vitest'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'
import { collectUvIndicesForFaces, ensureObjectUVs } from './uvObject'
import { faceNormal3D } from './uvObject'
import { uvBoundsFromIndices } from './uvEditing'
import { unwrapSelectedFaces, type UvUnwrapMethod } from './uvUnwrap'

const DISTINCT_METHODS: UvUnwrapMethod[] = [
  'smart',
  'regions',
  'planar',
  'box',
  'blockbench',
  'lightmap',
  'view',
]

function makeCube() {
  return ensureObjectUVs(
    primitiveBoxToSceneObject(
      'box',
      { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
      heightAxisForView('front'),
      0x8899aa,
      24
    )!
  )
}

function makeWideBox() {
  return ensureObjectUVs(
    primitiveBoxToSceneObject(
      'box',
      { min: { x: -2, y: -0.5, z: -1 }, max: { x: 2, y: 0.5, z: 1 } },
      heightAxisForView('front'),
      0x8899aa,
      24
    )!
  )
}

function makeIcosphere() {
  return ensureObjectUVs(
    primitiveBoxToSceneObject(
      'icosphere',
      { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
      heightAxisForView('front'),
      0x8899aa,
      48
    )!
  )
}

function fingerprint(uvs: { u: number; v: number }[]) {
  return uvs.map((u) => `${u.u.toFixed(4)},${u.v.toFixed(4)}`).join('|')
}

function unwrapFp(
  obj: ReturnType<typeof makeCube>,
  faces: number[],
  method: UvUnwrapMethod
) {
  return fingerprint(
    unwrapSelectedFaces(obj, faces, method, {
      angleLimitDeg: 66,
      margin: 0.02,
      repackAll: true,
      markPacked: faces.length >= obj.faces.length,
      projectionView: 'front',
    }).uvs
  )
}

function assertPairwiseDistinct(fps: Record<string, string>, methods: UvUnwrapMethod[]) {
  for (let i = 0; i < methods.length; i++) {
    for (let j = i + 1; j < methods.length; j++) {
      const a = methods[i]!
      const b = methods[j]!
      expect(fps[a], `${a} must differ from ${b}`).not.toBe(fps[b])
    }
  }
}

describe('unwrap method dispatch', () => {
  it('full-mesh methods are pairwise distinct (no shared planar+shelf collapse)', () => {
    const cube = makeCube()
    const faces = cube.faces.map((_, i) => i)
    const fps: Record<string, string> = {}
    for (const m of DISTINCT_METHODS) fps[m] = unwrapFp(cube, faces, m)

    assertPairwiseDistinct(fps, DISTINCT_METHODS)

    // Auto on a balanced cube resolves to box net — not smart shelf.
    const autoFp = unwrapFp(cube, faces, 'auto')
    expect(autoFp).toBe(fps.box)
    expect(autoFp).not.toBe(fps.smart)
  })

  it('partial multi-face selection keeps every method distinct', () => {
    const cube = makeCube()
    const faces = [0, 1, 2, 3]
    const fps: Record<string, string> = {}
    for (const m of DISTINCT_METHODS) fps[m] = unwrapFp(cube, faces, m)
    assertPairwiseDistinct(fps, DISTINCT_METHODS)
  })

  it('same-direction faces on an icosphere still yield distinct layouts', () => {
    const sphere = makeIcosphere()
    const frontish = sphere.faces
      .map((_, i) => i)
      .filter((fi) => faceNormal3D(sphere, fi).z > 0.35)
      .slice(0, 4)
    expect(frontish.length).toBeGreaterThanOrEqual(3)

    const fps: Record<string, string> = {}
    for (const m of DISTINCT_METHODS) fps[m] = unwrapFp(sphere, frontish, m)
    assertPairwiseDistinct(fps, DISTINCT_METHODS)
  })

  it('box net places faces off-center unlike full-atlas smart pack', () => {
    const cube = makeCube()
    const faces = cube.faces.map((_, i) => i)
    const boxed = unwrapSelectedFaces(cube, faces, 'box', {
      margin: 0.02,
      repackAll: true,
      markPacked: true,
    })
    const smart = unwrapSelectedFaces(cube, faces, 'smart', {
      angleLimitDeg: 66,
      margin: 0.02,
      repackAll: true,
      markPacked: true,
    })
    expect(fingerprint(boxed.uvs)).not.toBe(fingerprint(smart.uvs))

    // Front (+z) net cell sits on the right half of the net — U centroid > 0.5 typically.
    const frontFaces = faces.filter((fi) => faceNormal3D(cube, fi).z > 0.5)
    const frontUi = collectUvIndicesForFaces({ ...cube, ...boxed }, frontFaces)
    const b = uvBoundsFromIndices(boxed.uvs, frontUi)
    const midU = (b.minU + b.maxU) / 2
    expect(midU).toBeGreaterThan(0.45)
  })

  it('direction atlas keeps per-face islands unlike welded box-net buckets', () => {
    const cube = makeCube()
    const faces = cube.faces.map((_, i) => i)
    const atlas = unwrapSelectedFaces(cube, faces, 'blockbench', {
      margin: 0.02,
      repackAll: true,
      markPacked: true,
    })
    const boxed = unwrapSelectedFaces(cube, faces, 'box', {
      margin: 0.02,
      repackAll: true,
      markPacked: true,
    })
    expect(fingerprint(atlas.uvs)).not.toBe(fingerprint(boxed.uvs))
  })

  it('planar aspect-fit differs from lightmap stretch on non-square faces', () => {
    const box = makeWideBox()
    const faces = box.faces.map((_, i) => i)
    const planar = unwrapSelectedFaces(box, faces, 'planar', {
      angleLimitDeg: 66,
      margin: 0.02,
      repackAll: true,
      markPacked: true,
    })
    const lightmap = unwrapSelectedFaces(box, faces, 'lightmap', {
      angleLimitDeg: 66,
      margin: 0.02,
      repackAll: true,
      markPacked: true,
    })
    expect(fingerprint(planar.uvs)).not.toBe(fingerprint(lightmap.uvs))
  })

  it('regions strip layout differs from smart shelf on a full cube', () => {
    const cube = makeCube()
    const faces = cube.faces.map((_, i) => i)
    expect(unwrapFp(cube, faces, 'regions')).not.toBe(unwrapFp(cube, faces, 'smart'))
  })
})
