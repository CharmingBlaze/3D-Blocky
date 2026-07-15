import { describe, expect, it } from 'vitest'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'
import { ensureObjectUVs, collectUvIndicesForFaces } from './uvObject'
import { uvBoundsFromIndices } from './uvEditing'
import {
  resolveViewProjectionSpec,
  unwrapSelectedFaces,
  type UvUnwrapMethod,
} from './uvUnwrap'
import { faceNormal3D } from './uvObject'

const TEST_BOX = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }

function makeCube() {
  return ensureObjectUVs(
    primitiveBoxToSceneObject('box', TEST_BOX, heightAxisForView('front'), 'test-cube')
  )
}

function makeWideBox() {
  return ensureObjectUVs(
    primitiveBoxToSceneObject(
      'box',
      { min: { x: -2, y: -0.5, z: -1 }, max: { x: 2, y: 0.5, z: 1 } },
      heightAxisForView('front'),
      'wide-box'
    )
  )
}

function frontFacingFaces(obj: ReturnType<typeof makeCube>): number[] {
  return obj.faces
    .map((_, i) => i)
    .filter((fi) => faceNormal3D(obj, fi).z > 0.5)
}

describe('unwrapSelectedFaces', () => {
  it.each<UvUnwrapMethod>(['auto', 'smart', 'regions', 'planar', 'box', 'blockbench', 'lightmap'])(
    'produces finite, indexed UVs for %s',
    (method) => {
      const cube = makeCube()
      const allFaces = cube.faces.map((_, i) => i)
      const result = unwrapSelectedFaces(cube, allFaces, method, {
        angleLimitDeg: 66,
        margin: 0.02,
        repackAll: true,
      })
      expect(result.faceUvIndices).toHaveLength(cube.faces.length)
      for (let fi = 0; fi < cube.faces.length; fi++) {
        expect(result.faceUvIndices[fi]).toHaveLength(cube.faces[fi]!.length)
        for (const ui of result.faceUvIndices[fi]!) {
          expect(ui).toBeGreaterThanOrEqual(0)
          expect(ui).toBeLessThan(result.uvs.length)
        }
      }
      for (const uv of result.uvs) {
        expect(Number.isFinite(uv.u)).toBe(true)
        expect(Number.isFinite(uv.v)).toBe(true)
      }
    }
  )

  it('unwraps only selected faces for auto without repacking the whole mesh', () => {
    const cube = makeCube()
    const untouchedBefore = collectUvIndicesForFaces(cube, [0, 1, 2, 3, 4])
    const untouchedCoords = untouchedBefore.map((ui) => ({ ...cube.uvs[ui]! }))

    const { uvs, faceUvIndices } = unwrapSelectedFaces(cube, [5], 'auto', { repackAll: true })

    for (let i = 0; i < untouchedBefore.length; i++) {
      const ui = untouchedBefore[i]!
      const before = untouchedCoords[i]!
      const after = uvs[ui]!
      expect(after.u).toBeCloseTo(before.u, 5)
      expect(after.v).toBeCloseTo(before.v, 5)
    }

    const selectedUi = collectUvIndicesForFaces({ ...cube, uvs, faceUvIndices }, [5])
    const selectedBounds = uvBoundsFromIndices(uvs, selectedUi)
    expect(selectedBounds.maxU - selectedBounds.minU).toBeGreaterThan(0.01)
    expect(selectedBounds.maxV - selectedBounds.minV).toBeGreaterThan(0.01)
  })

  it('supports smart UV on a partial ring selection', () => {
    const cube = makeCube()
    const { uvs, faceUvIndices } = unwrapSelectedFaces(cube, [0, 1], 'smart', {
      angleLimitDeg: 66,
      repackAll: true,
    })
    const selectedUi = collectUvIndicesForFaces({ ...cube, uvs, faceUvIndices }, [0, 1])
    expect(selectedUi.length).toBeGreaterThan(0)
    const bounds = uvBoundsFromIndices(uvs, selectedUi)
    expect(bounds.maxU).toBeLessThanOrEqual(1.05)
    expect(bounds.maxV).toBeLessThanOrEqual(1.05)
  })

  it('still repacks the entire mesh when all faces are selected', () => {
    const cube = makeCube()
    const allFaces = cube.faces.map((_, i) => i)
    const { uvs, faceUvIndices, uvAutoPacked } = unwrapSelectedFaces(cube, allFaces, 'auto', {
      repackAll: true,
      markPacked: true,
    })
    expect(uvAutoPacked).toBe(true)
    const allUi = collectUvIndicesForFaces({ ...cube, uvs, faceUvIndices }, allFaces)
    const bounds = uvBoundsFromIndices(uvs, allUi)
    expect(bounds.minU).toBeGreaterThanOrEqual(-0.02)
    expect(bounds.maxU).toBeLessThanOrEqual(1.02)
  })

  it('projects selected faces from front view with aspect-correct bounds', () => {
    const cube = makeCube()
    const faces = frontFacingFaces(cube)
    expect(faces.length).toBeGreaterThan(0)
    const { uvs, faceUvIndices, uvAutoPacked } = unwrapSelectedFaces(cube, faces, 'view', {
      projectionView: 'front',
    })
    expect(uvAutoPacked).toBe(true)
    const selectedUi = collectUvIndicesForFaces({ ...cube, uvs, faceUvIndices }, faces)
    const bounds = uvBoundsFromIndices(uvs, selectedUi)
    const width = bounds.maxU - bounds.minU
    const height = bounds.maxV - bounds.minV
    expect(width).toBeGreaterThan(0.2)
    expect(height).toBeGreaterThan(0.2)
    // Front face of a cube is square — aspect should stay near 1, not a vertical strip.
    expect(width / height).toBeGreaterThan(0.85)
    expect(width / height).toBeLessThan(1.15)
    expect(bounds.minU).toBeGreaterThanOrEqual(-0.01)
    expect(bounds.minV).toBeGreaterThanOrEqual(-0.01)
    expect(bounds.maxU).toBeLessThanOrEqual(1.01)
    expect(bounds.maxV).toBeLessThanOrEqual(1.01)
  })

  it('preserves wider-than-tall front silhouette proportions', () => {
    const box = makeWideBox()
    const faces = frontFacingFaces(box)
    const { uvs, faceUvIndices } = unwrapSelectedFaces(box, faces, 'view', {
      projectionView: 'front',
    })
    const selectedUi = collectUvIndicesForFaces({ ...box, uvs, faceUvIndices }, faces)
    const bounds = uvBoundsFromIndices(uvs, selectedUi)
    const width = bounds.maxU - bounds.minU
    const height = bounds.maxV - bounds.minV
    // World face is 4×1 — UV must stay clearly wider than tall (not stretched to a square).
    expect(width / height).toBeGreaterThan(2.5)
  })

  it('falls back when the preferred view is edge-on to the selection', () => {
    const cube = makeCube()
    const faces = frontFacingFaces(cube)
    // Right view projects front faces to a vertical line — must not keep that.
    const { uvs, faceUvIndices } = unwrapSelectedFaces(cube, faces, 'view', {
      projectionView: 'right',
      projectionAxes: { right: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } },
    })
    const selectedUi = collectUvIndicesForFaces({ ...cube, uvs, faceUvIndices }, faces)
    const bounds = uvBoundsFromIndices(uvs, selectedUi)
    const width = bounds.maxU - bounds.minU
    const height = bounds.maxV - bounds.minV
    expect(Math.min(width, height) / Math.max(width, height)).toBeGreaterThan(0.5)
  })

  it('works without projectionAxes by resolving from the view', () => {
    const cube = makeCube()
    const faces = frontFacingFaces(cube)
    const { uvs, faceUvIndices } = unwrapSelectedFaces(cube, faces, 'view', {
      projectionView: 'front',
    })
    const selectedUi = collectUvIndicesForFaces({ ...cube, uvs, faceUvIndices }, faces)
    const bounds = uvBoundsFromIndices(uvs, selectedUi)
    expect(bounds.maxU - bounds.minU).toBeGreaterThan(0.2)
    expect(bounds.maxV - bounds.minV).toBeGreaterThan(0.2)
  })
})

describe('resolveViewProjectionSpec', () => {
  it('keeps front when the selection faces the camera', () => {
    const cube = makeCube()
    const faces = frontFacingFaces(cube)
    const spec = resolveViewProjectionSpec(cube, faces, { projectionView: 'front' })
    expect(spec).toEqual({ kind: 'ortho', view: 'front' })
  })

  it('rejects edge-on right view for front faces', () => {
    const cube = makeCube()
    const faces = frontFacingFaces(cube)
    const spec = resolveViewProjectionSpec(cube, faces, { projectionView: 'right' })
    expect(spec.kind).toBe('ortho')
    if (spec.kind === 'ortho') {
      expect(spec.view === 'front' || spec.view === 'back').toBe(true)
    }
  })
})
