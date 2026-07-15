import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { resolveEffectiveMaterial } from '../material/materials'
import {
  bakeSceneObjectForExport,
  resolveExportObjectWithUvs,
  sceneObjectToThreeMesh,
  type ExportMeshBuildOptions,
} from './sceneMeshBridge'
import {
  collectObjectTextureFiles,
  createZipBlob,
  sanitizeExportBasename,
  textureExportFilename,
  type TextureExportContext,
} from './materialTextureExport'
import { bakeMaterialTexturePixels, bakeMaterialUvTransform } from './exportTextureBake'
import {
  APP_NAME,
  DEFAULT_EXPORT_BASENAME,
  DEFAULT_GLB_FILENAME,
  DEFAULT_GLTF_FILENAME,
  DEFAULT_STL_FILENAME,
} from '../app/branding'
import {
  downloadArrayBuffer,
  downloadBlob,
  downloadFile,
  GLB_EXPORT_FILTERS,
  GLTF_EXPORT_FILTERS,
  OBJ_EXPORT_FILTERS,
  STL_EXPORT_FILTERS,
  ZIP_EXPORT_FILTERS,
} from './download'
import { isDesktopApp, pickSavePath, saveBlob as saveBlobDialog, writeTextToPath, companionPath } from './fileDialogs'

function colorToKd(color: number): { r: number; g: number; b: number } {
  return {
    r: ((color >> 16) & 255) / 255,
    g: ((color >> 8) & 255) / 255,
    b: (color & 255) / 255,
  }
}

function objectUsesTextureMaterial(obj: SceneObject, ctx?: TextureExportContext): boolean {
  if (!ctx) return false
  const mat = resolveEffectiveMaterial(obj)
  if (mat.mode !== 'texture') return false
  const texId = mat.textureId ?? obj.id
  return Boolean(ctx.pixelDocuments[texId] && obj.uvs?.length)
}

export function exportSceneOBJ(
  objects: SceneObject[],
  baseName = 'scene',
  ctx?: TextureExportContext
): {
  obj: string
  mtl: string
} {
  let objText = `# ${APP_NAME} Export\n`
  objText += `mtllib ${baseName}.mtl\n`
  let mtlText = `# ${APP_NAME} Materials\n`
  let vertexOffset = 0
  let uvOffset = 0
  let normalOffset = 0
  const materialNames = new Map<string, string>()

  for (const raw of objects) {
    const obj = bakeSceneObjectForExport(raw)
    if (obj.positions.length === 0 || obj.faces.length === 0) continue

    const withUvs = objectUsesTextureMaterial(obj, ctx) ? resolveExportObjectWithUvs(obj) : obj
    const effMat = resolveEffectiveMaterial(withUvs)
    const texId = effMat.textureId ?? withUvs.id
    const hasTexture =
      Boolean(ctx?.pixelDocuments[texId]) &&
      effMat.mode === 'texture' &&
      withUvs.uvs?.length &&
      withUvs.faceUvIndices?.length
    const writeSmoothNormals = Boolean(withUvs.smoothShading)

    // OBJ/MTL cannot express sampler UV transforms — bake into vt when needed.
    const exportUvs =
      hasTexture && withUvs.uvs ? bakeMaterialUvTransform(withUvs.uvs, effMat) : withUvs.uvs

    const textureHasAlpha =
      hasTexture && ctx?.pixelDocuments[texId]
        ? bakeMaterialTexturePixels(ctx.pixelDocuments[texId]!, effMat).hasAlpha
        : false

    objText += `\no ${withUvs.name}\n`
    objText += `g ${withUvs.name}\n`
    // Blender reads Wavefront smooth groups — keep shared topology so Shade Smooth works.
    objText += writeSmoothNormals ? `s 1\n` : `s off\n`

    for (const pos of withUvs.positions) {
      objText += `v ${pos.x.toFixed(6)} ${pos.y.toFixed(6)} ${pos.z.toFixed(6)}\n`
    }

    if (hasTexture && exportUvs) {
      for (const uv of exportUvs) {
        objText += `vt ${uv.u.toFixed(6)} ${uv.v.toFixed(6)}\n`
      }
    }

    let vertexNormals: { x: number; y: number; z: number }[] | null = null
    if (writeSmoothNormals) {
      const heMesh = HalfEdgeMesh.fromObject(withUvs)
      vertexNormals = withUvs.positions.map((_, vi) => heMesh.getVertexNormal(vi, true))
      for (const n of vertexNormals) {
        objText += `vn ${n.x.toFixed(6)} ${n.y.toFixed(6)} ${n.z.toFixed(6)}\n`
      }
    }

    const formatFaceCorner = (vi: number, ci: number, uvFace: number[]) => {
      const v = vi + 1 + vertexOffset
      if (hasTexture && writeSmoothNormals) {
        const uvIdx = uvFace[ci] ?? 0
        const vt = uvIdx + 1 + uvOffset
        const vn = vi + 1 + normalOffset
        return `${v}/${vt}/${vn}`
      }
      if (hasTexture) {
        const uvIdx = uvFace[ci] ?? 0
        const vt = uvIdx + 1 + uvOffset
        return `${v}/${vt}`
      }
      if (writeSmoothNormals) {
        const vn = vi + 1 + normalOffset
        return `${v}//${vn}`
      }
      return `${v}`
    }

    if (hasTexture && ctx) {
      const mapName = textureExportFilename(withUvs, texId, effMat, ctx)
      const mtlKey = `tex:${texId}:${mapName}`
      const mtlName = materialNames.get(mtlKey) ?? `tex_${sanitizeExportBasename(withUvs.name)}`
      if (!materialNames.has(mtlKey)) {
        materialNames.set(mtlKey, mtlName)
        const kd = colorToKd(withUvs.color)
        mtlText += `\nnewmtl ${mtlName}\n`
        mtlText += `Kd ${kd.r.toFixed(4)} ${kd.g.toFixed(4)} ${kd.b.toFixed(4)}\n`
        mtlText += `Ka 0.0500 0.0500 0.0500\n`
        mtlText += `Ks 0.0000 0.0000 0.0000\n`
        mtlText += `d ${Math.max(0, Math.min(1, effMat.opacity)).toFixed(4)}\n`
        mtlText += `illum 2\n`
        mtlText += `map_Kd ${mapName}\n`
        // Alpha cutouts (image planes, hair luma-alpha) need dissolve map for DCC tools.
        if (textureHasAlpha) {
          mtlText += `map_d ${mapName}\n`
        }
      }

      objText += `usemtl ${mtlName}\n`
      for (let fi = 0; fi < withUvs.faces.length; fi++) {
        const face = withUvs.faces[fi]!
        const uvFace = withUvs.faceUvIndices?.[fi] ?? []
        const corners = face.map((vi, ci) => formatFaceCorner(vi, ci, uvFace)).join(' ')
        objText += `f ${corners}\n`
      }
    } else {
      const colorGroups = new Map<number, number[]>()
      for (let fi = 0; fi < withUvs.faces.length; fi++) {
        const color = withUvs.faceColors[fi] ?? withUvs.color
        if (!colorGroups.has(color)) colorGroups.set(color, [])
        colorGroups.get(color)!.push(fi)
      }

      for (const [color, faceIndices] of colorGroups) {
        let mtlName = materialNames.get(`color:${color}`)
        if (!mtlName) {
          mtlName = `mat_${color.toString(16).padStart(6, '0')}`
          materialNames.set(`color:${color}`, mtlName)
          const kd = colorToKd(color)
          mtlText += `\nnewmtl ${mtlName}\n`
          mtlText += `Kd ${kd.r.toFixed(4)} ${kd.g.toFixed(4)} ${kd.b.toFixed(4)}\n`
          mtlText += `Ka 0.0500 0.0500 0.0500\n`
          mtlText += `Ks 0.0000 0.0000 0.0000\n`
          mtlText += `d 1.0\n`
          mtlText += `illum 1\n`
        }

        objText += `usemtl ${mtlName}\n`
        for (const fi of faceIndices) {
          const face = withUvs.faces[fi]!
          const corners = face.map((vi, ci) => formatFaceCorner(vi, ci, [])).join(' ')
          objText += `f ${corners}\n`
        }
      }
    }

    vertexOffset += withUvs.positions.length
    if (hasTexture && exportUvs) uvOffset += exportUvs.length
    if (vertexNormals) normalOffset += vertexNormals.length
  }

  return { obj: objText, mtl: mtlText }
}

export function downloadSceneOBJ(
  objects: SceneObject[],
  baseName = DEFAULT_EXPORT_BASENAME,
  ctx?: TextureExportContext
): Promise<boolean> {
  const safeBase = sanitizeExportBasename(baseName)
  const { obj, mtl } = exportSceneOBJ(objects, safeBase, ctx)
  return saveObjWithMtl(obj, mtl, `${safeBase}.obj`)
}

async function saveObjWithMtl(objContent: string, mtlContent: string, defaultObjFilename: string): Promise<boolean> {
  if (isDesktopApp()) {
    const path = await pickSavePath({
      title: 'Export OBJ',
      defaultFilename: defaultObjFilename,
      filters: OBJ_EXPORT_FILTERS,
    })
    if (!path) return false

    await writeTextToPath(path, objContent)
    await writeTextToPath(companionPath(path, '.mtl'), mtlContent)
    return true
  }

  const base = defaultObjFilename.replace(/\.obj$/i, '')
  const zip = createZipBlob([
    { path: `${base}.obj`, data: new TextEncoder().encode(objContent) },
    { path: `${base}.mtl`, data: new TextEncoder().encode(mtlContent) },
  ])
  return saveBlobDialog(zip, {
    title: 'Export OBJ + MTL',
    defaultFilename: `${base}-obj.zip`,
    filters: ZIP_EXPORT_FILTERS,
  })
}

export async function downloadSceneOBJBundle(
  objects: SceneObject[],
  baseName = DEFAULT_EXPORT_BASENAME,
  ctx?: TextureExportContext
): Promise<boolean> {
  const safeBase = sanitizeExportBasename(baseName)
  const { obj, mtl } = exportSceneOBJ(objects, safeBase, ctx)
  const files: { path: string; data: Uint8Array }[] = [
    { path: `${safeBase}.obj`, data: new TextEncoder().encode(obj) },
    { path: `${safeBase}.mtl`, data: new TextEncoder().encode(mtl) },
  ]

  if (ctx) {
    const textures = await collectObjectTextureFiles(objects, ctx)
    for (const texture of textures) {
      files.push({ path: texture.path, data: texture.data })
    }
  }

  return downloadBlob(createZipBlob(files), `${safeBase}-obj.zip`, {
    title: 'Export OBJ bundle',
    filters: ZIP_EXPORT_FILTERS,
  })
}

function parseGLTFExport(result: ArrayBuffer | { [key: string]: unknown }): ArrayBuffer | object {
  return result
}

async function buildExportGroup(objects: SceneObject[], ctx?: TextureExportContext): Promise<THREE.Group> {
  const group = new THREE.Group()
  group.name = APP_NAME
  const options: ExportMeshBuildOptions | undefined = ctx ? { textures: ctx } : undefined

  for (const obj of objects) {
    if (obj.positions.length === 0 || obj.faces.length === 0) continue
    const baked = bakeSceneObjectForExport(obj)
    group.add(sceneObjectToThreeMesh(baked, options))
  }

  return group
}

export async function exportSceneGLB(
  objects: SceneObject[],
  ctx?: TextureExportContext
): Promise<ArrayBuffer> {
  const group = await buildExportGroup(objects, ctx)
  if (group.children.length === 0) {
    disposeGroup(group)
    return Promise.reject(new Error('Nothing to export'))
  }

  const exporter = new GLTFExporter()
  return new Promise((resolve, reject) => {
    exporter.parse(
      group,
      (result) => {
        disposeGroup(group)
        if (result instanceof ArrayBuffer) resolve(result)
        else reject(new Error('Expected binary GLB output'))
      },
      (error) => {
        disposeGroup(group)
        reject(error)
      },
      { binary: true }
    )
  })
}

export async function exportSceneGLTF(
  objects: SceneObject[],
  ctx?: TextureExportContext
): Promise<object> {
  const group = await buildExportGroup(objects, ctx)
  if (group.children.length === 0) {
    disposeGroup(group)
    return Promise.reject(new Error('Nothing to export'))
  }

  const exporter = new GLTFExporter()
  return new Promise((resolve, reject) => {
    exporter.parse(
      group,
      (result) => {
        disposeGroup(group)
        resolve(parseGLTFExport(result) as object)
      },
      (error) => {
        disposeGroup(group)
        reject(error)
      },
      { binary: false }
    )
  })
}

export async function exportSceneSTL(
  objects: SceneObject[],
  ctx?: TextureExportContext
): Promise<string> {
  const group = await buildExportGroup(objects, ctx)
  if (group.children.length === 0) {
    disposeGroup(group)
    throw new Error('Nothing to export')
  }
  const exporter = new STLExporter()
  const stl = exporter.parse(group, { binary: false }) as string
  disposeGroup(group)
  return stl
}

export async function downloadSceneGLB(
  objects: SceneObject[],
  filename = DEFAULT_GLB_FILENAME,
  ctx?: TextureExportContext
): Promise<boolean> {
  const buffer = await exportSceneGLB(objects, ctx)
  return downloadArrayBuffer(buffer, filename, 'model/gltf-binary', {
    title: 'Export GLB',
    filters: GLB_EXPORT_FILTERS,
  })
}

export async function downloadSceneGLTF(
  objects: SceneObject[],
  filename = DEFAULT_GLTF_FILENAME,
  ctx?: TextureExportContext
): Promise<boolean> {
  const data = await exportSceneGLTF(objects, ctx)
  return downloadFile(JSON.stringify(data, null, 2), filename, 'model/gltf+json', {
    title: 'Export GLTF',
    filters: GLTF_EXPORT_FILTERS,
  })
}

export async function downloadSceneSTL(
  objects: SceneObject[],
  filename = DEFAULT_STL_FILENAME,
  ctx?: TextureExportContext
): Promise<boolean> {
  const stl = await exportSceneSTL(objects, ctx)
  return downloadFile(stl, filename, 'model/stl', {
    title: 'Export STL',
    filters: STL_EXPORT_FILTERS,
  })
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (material.map) material.map.dispose()
      material.dispose()
    }
  })
}

export type { TextureExportContext }
