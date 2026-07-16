import { describe, expect, it } from 'vitest'
import type { MeshStandardMaterial } from 'three'
import { createPixelDocument } from '../pixel/pixelDocument'
import { prepareSceneObject } from '../mesh/objectTransform'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { bakeMaterialTexturePixels, bakeMaterialUvTransform } from './exportTextureBake'
import { exportSceneOBJ } from './sceneExport'
import { sceneObjectToThreeMesh } from './sceneMeshBridge'
import type { TextureExportContext } from './materialTextureExport'

function texturedQuad(overrides?: Partial<SceneObject['material']>): {
  obj: SceneObject
  ctx: TextureExportContext
} {
  const doc = createPixelDocument(2, 2, 'tex-a')
  // Checker with transparent pixel for alpha export.
  doc.layers[0]!.pixels[0] = 255
  doc.layers[0]!.pixels[1] = 0
  doc.layers[0]!.pixels[2] = 0
  doc.layers[0]!.pixels[3] = 255
  doc.layers[0]!.pixels[7] = 0 // second pixel fully transparent

  const obj = prepareSceneObject({
    id: 'quad',
    name: 'AlphaPlane',
    positions: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ],
    faces: [[0, 1, 2, 3]],
    faceColors: [0xffffff],
    uvs: [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ],
    faceUvIndices: [[0, 1, 2, 3]],
    material: {
      mode: 'texture',
      textureId: 'tex-a',
      textureWrap: 'repeat',
      textureRepeat: [2, 1],
      textureOffset: [0.25, 0],
      textureRotation: 0,
      textureLumaAlpha: false,
      opacity: 1,
      doubleSided: false,
      ...overrides,
    },
    color: 0xffffff,
    topologyLocked: false,
    polyBudget: 32,
    polyBudgetMode: 'strict',
    smoothShading: false,
    facetExaggeration: 0,
  })

  return {
    obj,
    ctx: {
      pixelDocuments: { 'tex-a': doc },
      objectTextures: { 'tex-a': { url: '', name: 'cutout.png', width: 2, height: 2 } },
    },
  }
}

describe('export texture bake', () => {
  it('detects alpha in painted textures', () => {
    const { obj, ctx } = texturedQuad()
    const doc = ctx.pixelDocuments['tex-a']!
    const baked = bakeMaterialTexturePixels(doc, obj.material!)
    expect(baked.hasAlpha).toBe(true)
  })

  it('applies luma-alpha cutout when enabled', () => {
    const doc = createPixelDocument(1, 1, 'dark')
    doc.layers[0]!.pixels[0] = 5
    doc.layers[0]!.pixels[1] = 5
    doc.layers[0]!.pixels[2] = 5
    doc.layers[0]!.pixels[3] = 255
    const baked = bakeMaterialTexturePixels(doc, {
      mode: 'texture',
      textureLumaAlpha: true,
      opacity: 1,
      doubleSided: false,
    })
    expect(baked.pixels[3]).toBeLessThan(40)
    expect(baked.hasAlpha).toBe(true)
  })

  it('bakes UV repeat/offset into mesh UVs for OBJ', () => {
    const uvs = bakeMaterialUvTransform(
      [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
      ],
      {
        mode: 'texture',
        textureRepeat: [2, 1],
        textureOffset: [0.25, 0],
        opacity: 1,
        doubleSided: false,
      }
    )
    expect(uvs[0]!.u).toBeCloseTo(0.25)
    expect(uvs[1]!.u).toBeCloseTo(2.25)
  })
})

describe('OBJ textured export', () => {
  it('writes UVs, map_Kd, and map_d for alpha textures', () => {
    const { obj, ctx } = texturedQuad()
    const { obj: objText, mtl } = exportSceneOBJ([obj], 'scene', ctx)
    expect(objText).toMatch(/^vt /m)
    expect(mtl).toContain('map_Kd')
    expect(mtl).toContain('map_d')
    expect(mtl).toContain('cutout_texture.png')
  })

  it('bakes sampler UV transform into vt values', () => {
    const { obj, ctx } = texturedQuad()
    const { obj: objText } = exportSceneOBJ([obj], 'scene', ctx)
    // First corner u=0 → offset 0.25 after repeat bake.
    expect(objText).toMatch(/vt 0\.250000/)
  })
})

describe('GLB mesh build with textures', () => {
  it('embeds texture map and enables alphaTest when texture has transparency', () => {
    const { obj, ctx } = texturedQuad()
    const mesh = sceneObjectToThreeMesh(obj, { textures: ctx })
    if (Array.isArray(mesh.material)) throw new Error('Expected one export material')
    const mat = mesh.material as MeshStandardMaterial
    expect(mat.map).toBeTruthy()
    expect(mat.alphaTest).toBeGreaterThan(0)
    expect(mat.transparent).toBe(true)
    expect(mesh.geometry.getAttribute('uv')).toBeTruthy()

    mesh.geometry.dispose()
    ;(mesh.material as { map?: { dispose: () => void }; dispose: () => void }).map?.dispose()
    ;(mesh.material as { dispose: () => void }).dispose()
  })
})
