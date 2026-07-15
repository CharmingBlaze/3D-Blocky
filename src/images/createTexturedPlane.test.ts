import { describe, expect, it } from 'vitest'
import { ensureObjectUVs } from '../uv/uvObject'
import {
  BACK_IMAGE_FACE_UVS,
  createEditableImagePlaneObject,
  createTexturedPlaneObject,
  hasMatchingFullImageFaceUVs,
  planeSizeFromAspect,
  FULL_IMAGE_FACE_UVS,
} from './createTexturedPlane'
import { DEFAULT_IMAGE_WORLD_WIDTH } from './imageDropTypes'

describe('planeSizeFromAspect', () => {
  it('preserves landscape aspect', () => {
    expect(planeSizeFromAspect(100, 2)).toEqual({ width: 100, height: 50 })
  })

  it('preserves portrait aspect', () => {
    expect(planeSizeFromAspect(100, 0.5)).toEqual({ width: 100, height: 200 })
  })
})

describe('createTexturedPlaneObject', () => {
  it('builds a dual-face textured quad with matching upright UVs on both sides', () => {
    const obj = createTexturedPlaneObject(
      'Photo',
      'front',
      { x: 10, y: 20, z: 30 },
      DEFAULT_IMAGE_WORLD_WIDTH,
      2,
      'tex-doc'
    )

    expect(obj.name).toBe('Photo')
    expect(obj.faces).toHaveLength(2)
    expect(obj.uvs).toHaveLength(8)
    expect(obj.faceUvIndices).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ])
    expect(obj.uvs?.slice(0, 4)).toEqual(FULL_IMAGE_FACE_UVS.map((uv) => ({ ...uv })))
    expect(obj.uvs?.slice(4, 8)).toEqual(BACK_IMAGE_FACE_UVS.map((uv) => ({ ...uv })))
    expect(hasMatchingFullImageFaceUVs(obj)).toBe(true)
    expect(obj.uvAutoPacked).toBe(true)
    expect(obj.uvMappingMode).toBe('perFace')
    expect(obj.material?.mode).toBe('texture')
    expect(obj.material?.textureId).toBe('tex-doc')
    expect(obj.material?.textureWrap).toBe('clamp')
    expect(obj.material?.textureRepeat).toEqual([1, 1])
    // Separate front/back faces — FrontSide avoids DoubleSide z-fighting over alpha holes.
    expect(obj.material?.doubleSided).toBe(false)
    expect(obj.transform?.position).toEqual({ x: 10, y: 20, z: 30 })

    // Front plane: X spans worldWidth, Y spans worldWidth/aspect
    const xs = obj.positions.map((p) => p.x)
    const ys = obj.positions.map((p) => p.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(DEFAULT_IMAGE_WORLD_WIDTH)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(DEFAULT_IMAGE_WORLD_WIDTH / 2)
  })

  it('keeps full-image UVs after ensureObjectUVs (no auto-repack)', () => {
    const obj = createTexturedPlaneObject(
      'KeepUVs',
      'front',
      { x: 0, y: 0, z: 0 },
      64,
      1,
      'doc'
    )
    const ensured = ensureObjectUVs(obj)
    expect(hasMatchingFullImageFaceUVs(ensured)).toBe(true)
    expect(ensured.uvs?.[0]).toEqual(FULL_IMAGE_FACE_UVS[0])
    expect(ensured.uvs?.[4]).toEqual(BACK_IMAGE_FACE_UVS[0])
  })
})

describe('createEditableImagePlaneObject', () => {
  it('links a pixel document id and sizes from image pixels', () => {
    const obj = createEditableImagePlaneObject(
      'Sprite',
      'top',
      { x: 0, y: 0, z: 0 },
      80,
      40,
      20,
      'doc-1'
    )

    expect(obj.material?.textureId).toBe('doc-1')
    expect(hasMatchingFullImageFaceUVs(obj)).toBe(true)
    const xs = obj.positions.map((p) => p.x)
    const zs = obj.positions.map((p) => p.z)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(80)
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(40)
  })
})
