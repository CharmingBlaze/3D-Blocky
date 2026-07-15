import * as THREE from 'three'
import { ensureSceneObjectOutward } from '../mesh/MeshBuilder'
import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { identityFaceGroups } from '../mesh/faceGroups'
import { worldPointFromObject } from '../mesh/objectTransform'
import { resolveEffectiveMaterial } from '../material/materials'
import { ensureObjectUVs } from '../uv/uvObject'
import { generateId, type Vec3 } from '../utils/math'
import { APP_NAME } from '../app/branding'
import type { TextureExportContext } from './materialTextureExport'
import { EXPORT_UNIT_SCALE } from '../scene/units'
import { setFlatNormalsFromIndices } from '../rendering/meshGeometry'
import { bakeMaterialTexturePixels } from './exportTextureBake'
import type { Material } from '../material/materialTypes'

export interface ExportMeshBuildOptions {
  textures?: TextureExportContext
}

export function bakeSceneObjectForExport(obj: SceneObject): SceneObject {
  if (obj.positions.length === 0) return { ...obj }
  const scale = EXPORT_UNIT_SCALE
  const baked = {
    ...obj,
    positions: obj.positions.map((p) => {
      const w = worldPointFromObject(obj, p)
      return { x: w.x * scale, y: w.y * scale, z: w.z * scale }
    }),
    pivot: undefined,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }
  return ensureSceneObjectOutward(baked)
}

function wrapModeFromMaterial(mat: Material): THREE.Wrapping {
  if (mat.textureWrap === 'repeat') return THREE.RepeatWrapping
  if (mat.textureWrap === 'mirror') return THREE.MirroredRepeatWrapping
  return THREE.ClampToEdgeWrapping
}

function createDataTextureFromDocument(
  docId: string,
  mat: Material,
  ctx: TextureExportContext
): { map: THREE.DataTexture; hasAlpha: boolean } | null {
  const doc = ctx.pixelDocuments[docId]
  if (!doc) return null
  const baked = bakeMaterialTexturePixels(doc, mat)
  const tex = new THREE.DataTexture(
    new Uint8Array(baked.pixels),
    baked.width,
    baked.height,
    THREE.RGBAFormat
  )
  tex.colorSpace = THREE.SRGBColorSpace
  const wrap = wrapModeFromMaterial(mat)
  tex.wrapS = wrap
  tex.wrapT = wrap
  const repeat = mat.textureRepeat ?? [1, 1]
  const offset = mat.textureOffset ?? [0, 0]
  tex.repeat.set(Math.max(0.01, repeat[0]), Math.max(0.01, repeat[1]))
  tex.offset.set(offset[0], offset[1])
  tex.center.set(0.5, 0.5)
  tex.rotation = ((mat.textureRotation ?? 0) * Math.PI) / 180
  // Keep pixel rows unflipped (canvas/PNG top = row 0). Export UVs are flipped in
  // sceneObjectToThreeMesh to match glTF's top-left UV origin. Do not rely on flipY —
  // GLTFExporter uses putImageData for DataTexture, which ignores the canvas transform.
  tex.flipY = false
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.needsUpdate = true
  return { map: tex, hasAlpha: baked.hasAlpha }
}

/** Keep painted UV layouts intact — only generate UVs when missing. */
export function resolveExportObjectWithUvs(obj: SceneObject): SceneObject {
  if (obj.uvs?.length && obj.faceUvIndices?.length === obj.faces.length) return obj
  return ensureObjectUVs(obj)
}

export function sceneObjectToThreeMesh(
  obj: SceneObject,
  options?: ExportMeshBuildOptions
): THREE.Mesh {
  const effMat = resolveEffectiveMaterial(obj)
  const texId = effMat.textureId ?? obj.id
  const useTexture =
    Boolean(options?.textures?.pixelDocuments[texId]) && effMat.mode === 'texture'
  const source = useTexture ? resolveExportObjectWithUvs(obj) : obj
  const flatShading = !source.smoothShading

  const mesh = HalfEdgeMesh.fromObject(source)
  const data = mesh.toMeshData(flatShading, source.facetExaggeration ?? 0)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1))
  if (!useTexture && data.faceColors.length > 0) {
    geometry.setAttribute('color', new THREE.BufferAttribute(data.faceColors, 3))
  }
  // glTF UV origin is top-left (v=0 = image top). Our app/OpenGL UVs use v=1 = image
  // top (see uvToPixel). flipY on DataTexture does not help — GLTFExporter's putImageData
  // ignores the canvas transform — so flip V here for GLB/GLTF consumers (e.g. Blender).
  if (data.uvs && data.uvs.length > 0) {
    const exportUvs = new Float32Array(data.uvs.length)
    for (let i = 0; i < data.uvs.length; i += 2) {
      exportUvs[i] = data.uvs[i]!
      exportUvs[i + 1] = 1 - data.uvs[i + 1]!
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(exportUvs, 2))
  }
  // Match viewport: smooth uses topology-averaged normals on welded verts so Blender
  // Shade Smooth / custom normals look correct. Flat still uses per-face normals.
  if (flatShading) {
    setFlatNormalsFromIndices(geometry)
  } else if (data.normals && data.normals.length === data.positions.length) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
  } else {
    geometry.computeVertexNormals()
  }

  let material: THREE.MeshStandardMaterial
  if (useTexture && options?.textures) {
    const bakedMap = createDataTextureFromDocument(texId, effMat, options.textures)
    const hasAlpha = bakedMap?.hasAlpha ?? false
    material = new THREE.MeshStandardMaterial({
      map: bakedMap?.map ?? undefined,
      // Tint / luma / brightness already baked into pixels.
      color: 0xffffff,
      metalness: 0.05,
      roughness: 0.85,
      flatShading,
      transparent: hasAlpha || effMat.opacity < 0.999,
      opacity: effMat.opacity,
      alphaTest: hasAlpha ? 0.05 : 0,
      depthWrite: effMat.opacity >= 1,
      side: effMat.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    })
  } else {
    material = new THREE.MeshStandardMaterial({
      vertexColors: data.faceColors.length > 0,
      color: data.faceColors.length > 0 ? 0xffffff : source.color,
      metalness: 0.05,
      roughness: 0.85,
      flatShading,
      transparent: effMat.opacity < 0.999,
      opacity: effMat.opacity,
      side: effMat.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    })
  }

  const threeMesh = new THREE.Mesh(geometry, material)
  threeMesh.name = source.name
  return threeMesh
}

export async function sceneObjectsToGroup(
  objects: SceneObject[],
  options?: ExportMeshBuildOptions
): Promise<THREE.Group> {
  const group = new THREE.Group()
  group.name = APP_NAME
  for (const obj of objects) {
    if (obj.positions.length === 0 || obj.faces.length === 0) continue
    const baked = bakeSceneObjectForExport(obj)
    group.add(sceneObjectToThreeMesh(baked, options))
  }
  return group
}

function colorFromMaterial(material: THREE.Material | THREE.Material[]): number {
  const mat = Array.isArray(material) ? material[0] : material
  if (!mat) return 0x6ecbf5
  if ('color' in mat && mat.color instanceof THREE.Color) {
    return mat.color.getHex()
  }
  return 0x6ecbf5
}

function vertexColorToHex(r: number, g: number, b: number): number {
  return (
    (Math.round(Math.min(1, Math.max(0, r)) * 255) << 16) |
    (Math.round(Math.min(1, Math.max(0, g)) * 255) << 8) |
    Math.round(Math.min(1, Math.max(0, b)) * 255)
  )
}

export function geometryToSceneObject(
  name: string,
  geometry: THREE.BufferGeometry,
  fallbackColor = 0x6ecbf5
): SceneObject | null {
  const working = geometry.clone()
  if (!working.getAttribute('position')) return null

  const indexed = working.index ? working : working.toNonIndexed()
  const posAttr = indexed.getAttribute('position') as THREE.BufferAttribute
  const colorAttr = indexed.getAttribute('color') as THREE.BufferAttribute | undefined
  const indexAttr = indexed.index
  if (!indexAttr || posAttr.count === 0) return null

  const positions: Vec3[] = []
  for (let i = 0; i < posAttr.count; i++) {
    positions.push({ x: posAttr.getX(i), y: posAttr.getY(i), z: posAttr.getZ(i) })
  }

  const faces: number[][] = []
  const faceColors: number[] = []

  for (let i = 0; i < indexAttr.count; i += 3) {
    const a = indexAttr.getX(i)
    const b = indexAttr.getX(i + 1)
    const c = indexAttr.getX(i + 2)
    if (a === b || b === c || a === c) continue
    faces.push([a, b, c])

    let color = fallbackColor
    if (colorAttr) {
      color = vertexColorToHex(colorAttr.getX(a), colorAttr.getY(a), colorAttr.getZ(a))
    }
    faceColors.push(color)
  }

  if (faces.length === 0) return null

  return {
    id: generateId(),
    name: name || 'Imported',
    positions,
    faces,
    faceColors,
    faceGroups: identityFaceGroups(faces.length),
    topologyLocked: false,
    polyBudget: 128,
    polyBudgetMode: 'strict',
    smoothShading: false,
    facetExaggeration: 0,
    color: faceColors[0] ?? fallbackColor,
  }
}

export function meshToSceneObject(mesh: THREE.Mesh): SceneObject | null {
  mesh.updateWorldMatrix(true, false)
  const geometry = mesh.geometry.clone()
  geometry.applyMatrix4(mesh.matrixWorld)
  return geometryToSceneObject(
    mesh.name || 'Imported',
    geometry,
    colorFromMaterial(mesh.material)
  )
}

export function object3DToSceneObjects(root: THREE.Object3D): SceneObject[] {
  root.updateWorldMatrix(true, true)
  const out: SceneObject[] = []
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const obj = meshToSceneObject(child)
    if (obj) out.push(obj)
  })
  return out
}

export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (!material) continue
      if (material.map) material.map.dispose()
      material.dispose()
    }
  })
}
