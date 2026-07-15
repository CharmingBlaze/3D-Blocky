import { describe, expect, it } from 'vitest'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'
import { ensureObjectUVs, collectUvIndicesForFaces } from './uvObject'
import { uvBoundsFromIndices } from './uvEditing'
import {
  clusterFacesSmartUv,
  resolveAutoUnwrapMethod,
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

function makeIcosphere() {
  return ensureObjectUVs(
    primitiveBoxToSceneObject(
      'icosphere',
      TEST_BOX,
      heightAxisForView('front'),
      0x8899aa,
      48
    )
  )
}

function adjacentBentPair(obj: ReturnType<typeof makeIcosphere>): [number, number] {
  for (let a = 0; a < obj.faces.length; a++) {
    for (let b = a + 1; b < obj.faces.length; b++) {
      const shared = obj.faces[a]!.filter((vi) => obj.faces[b]!.includes(vi))
      if (shared.length < 2) continue
      const na = faceNormal3D(obj, a)
      const nb = faceNormal3D(obj, b)
      const dot = Math.max(-1, Math.min(1, na.x * nb.x + na.y * nb.y + na.z * nb.z))
      const angle = Math.acos(dot) * 180 / Math.PI
      if (angle > 1 && angle < 66) return [a, b]
    }
  }
  throw new Error('Expected an adjacent bent face pair')
}

function uvIndexForVertex(
  obj: ReturnType<typeof makeIcosphere>,
  faceUvIndices: number[][],
  faceIndex: number,
  vertexIndex: number
): number {
  const corner = obj.faces[faceIndex]!.indexOf(vertexIndex)
  return faceUvIndices[faceIndex]![corner]!
}

function frontFacingFaces(obj: ReturnType<typeof makeCube>): number[] {
  return obj.faces
    .map((_, i) => i)
    .filter((fi) => faceNormal3D(obj, fi).z > 0.5)
}

describe('unwrapSelectedFaces', () => {
  it('gives generated curved primitives a compact box-style default atlas', () => {
    const sphere = makeIcosphere()
    const allFaces = sphere.faces.map((_, i) => i)
    const allUi = collectUvIndicesForFaces(sphere, allFaces)
    const bounds = uvBoundsFromIndices(sphere.uvs, allUi)

    expect(sphere.uvAutoPacked).toBe(true)
    expect(sphere.uvLayoutVersion).toBe(1)
    expect(sphere.uvMappingMode).toBe('perFace')
    expect(sphere.faceUvIndices).toHaveLength(sphere.faces.length)
    expect(bounds.minU).toBeGreaterThanOrEqual(-0.001)
    expect(bounds.minV).toBeGreaterThanOrEqual(-0.001)
    expect(bounds.maxU).toBeLessThanOrEqual(1.001)
    expect(bounds.maxV).toBeLessThanOrEqual(1.001)
  })

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

  it('keeps adjacent selected curved faces together with Auto UV', () => {
    const sphere = makeIcosphere()
    const faces = adjacentBentPair(sphere)
    expect(resolveAutoUnwrapMethod(sphere, faces)).toBe('smart')

    const result = unwrapSelectedFaces(sphere, faces, 'auto', { repackAll: true })
    const sharedVertices = sphere.faces[faces[0]]!.filter((vi) => sphere.faces[faces[1]]!.includes(vi))
    expect(sharedVertices.length).toBe(2)
    for (const vi of sharedVertices) {
      expect(uvIndexForVertex(sphere, result.faceUvIndices, faces[0], vi)).toBe(
        uvIndexForVertex(sphere, result.faceUvIndices, faces[1], vi)
      )
    }
  })

  it('rebuilds UV topology every time the unwrap method changes', () => {
    const sphere = makeIcosphere()
    const faces = adjacentBentPair(sphere)
    const sharedVertex = sphere.faces[faces[0]]!.find((vi) => sphere.faces[faces[1]]!.includes(vi))!

    const smart = unwrapSelectedFaces(sphere, faces, 'smart', { repackAll: true })
    expect(uvIndexForVertex(sphere, smart.faceUvIndices, faces[0], sharedVertex)).toBe(
      uvIndexForVertex(sphere, smart.faceUvIndices, faces[1], sharedVertex)
    )

    const planar = unwrapSelectedFaces({ ...sphere, ...smart }, faces, 'planar', { repackAll: true })
    expect(uvIndexForVertex(sphere, planar.faceUvIndices, faces[0], sharedVertex)).not.toBe(
      uvIndexForVertex(sphere, planar.faceUvIndices, faces[1], sharedVertex)
    )

    const smartAgain = unwrapSelectedFaces({ ...sphere, ...planar }, faces, 'smart', { repackAll: true })
    expect(uvIndexForVertex(sphere, smartAgain.faceUvIndices, faces[0], sharedVertex)).toBe(
      uvIndexForVertex(sphere, smartAgain.faceUvIndices, faces[1], sharedVertex)
    )
  })

  it('cuts a closed curved surface into multiple smart islands', () => {
    const sphere = makeIcosphere()
    const allFaces = sphere.faces.map((_, i) => i)
    const islands = clusterFacesSmartUv(sphere, allFaces, 66)
    expect(islands.length).toBeGreaterThan(1)
    expect(Math.max(...islands.map((island) => island.length))).toBeLessThan(allFaces.length)
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
