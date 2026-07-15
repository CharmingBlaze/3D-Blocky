import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { DEFAULT_EXPORT_BASENAME } from '../app/branding'
import { resolveEffectiveMaterial } from '../material/materials'
import type { Material } from '../material/materialTypes'
import { compositeLayers } from '../pixel/compositeLayers'
import { exportCompositeToPngBlob } from '../pixel/pixelTools'
import type { PixelDocument } from '../pixel/pixelTypes'
import type { UvTextureInfo } from '../store/appStore'
import { downloadBlob, downloadJSON, JSON_EXPORT_FILTERS, ZIP_EXPORT_FILTERS } from './download'
import {
  bakeMaterialTexturePixels,
  materialTextureProcessKey,
} from './exportTextureBake'

export interface TextureExportContext {
  pixelDocuments: Record<string, PixelDocument>
  objectTextures: Record<string, UvTextureInfo>
}

export interface TextureFileEntry {
  path: string
  data: Uint8Array
  objectId: string
  textureId: string
}

export interface MaterialExportEntry {
  objectId: string
  objectName: string
  material: Material
  textureId: string | null
  textureFile: string | null
  textureWidth: number | null
  textureHeight: number | null
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true)
}

/** Minimal ZIP (store/no compression) for bundling textures with mesh exports. */
export function createZipBlob(files: { path: string; data: Uint8Array }[]): Blob {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.path.replace(/\\/g, '/'))
    const checksum = crc32(file.data)
    const local = new Uint8Array(30 + nameBytes.length)
    const view = new DataView(local.buffer)
    writeUint32(view, 0, 0x04034b50)
    writeUint16(view, 4, 20)
    writeUint16(view, 6, 0)
    writeUint16(view, 8, 0)
    writeUint16(view, 10, 0)
    writeUint16(view, 12, 0)
    writeUint32(view, 14, checksum)
    writeUint32(view, 18, file.data.length)
    writeUint32(view, 22, file.data.length)
    writeUint16(view, 26, nameBytes.length)
    writeUint16(view, 28, 0)
    local.set(nameBytes, 30)
    chunks.push(local, file.data)

    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const cview = new DataView(centralHeader.buffer)
    writeUint32(cview, 0, 0x02014b50)
    writeUint16(cview, 4, 20)
    writeUint16(cview, 6, 20)
    writeUint16(cview, 8, 0)
    writeUint16(cview, 10, 0)
    writeUint16(cview, 12, 0)
    writeUint16(cview, 14, 0)
    writeUint32(cview, 16, checksum)
    writeUint32(cview, 20, file.data.length)
    writeUint32(cview, 24, file.data.length)
    writeUint16(cview, 28, nameBytes.length)
    writeUint16(cview, 30, 0)
    writeUint16(cview, 32, 0)
    writeUint16(cview, 34, 0)
    writeUint16(cview, 36, 0)
    writeUint32(cview, 38, 0)
    writeUint32(cview, 42, offset)
    centralHeader.set(nameBytes, 46)
    central.push(centralHeader)

    offset += local.length + file.data.length
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const eview = new DataView(end.buffer)
  writeUint32(eview, 0, 0x06054b50)
  writeUint16(eview, 4, 0)
  writeUint16(eview, 6, 0)
  writeUint16(eview, 8, files.length)
  writeUint16(eview, 10, files.length)
  writeUint32(eview, 12, centralSize)
  writeUint32(eview, 16, offset)
  writeUint16(eview, 20, 0)

  const totalLength =
    chunks.reduce((sum, part) => sum + part.length, 0) + centralSize + end.length
  const out = new Uint8Array(totalLength)
  let cursor = 0
  for (const part of [...chunks, ...central, end]) {
    out.set(part, cursor)
    cursor += part.length
  }
  return new Blob([out], { type: 'application/zip' })
}

export function sanitizeExportBasename(name: string): string {
  const trimmed = name.trim() || 'texture'
  return trimmed.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_').slice(0, 80)
}

export function resolveObjectTextureId(obj: SceneObject): string | null {
  const mat = resolveEffectiveMaterial(obj)
  if (mat.mode !== 'texture') return null
  return mat.textureId ?? obj.id
}

export function textureFilenameForObject(obj: SceneObject, ext = 'png'): string {
  return `${sanitizeExportBasename(obj.name)}_texture.${ext}`
}

export async function pixelDocumentToPngBytes(doc: PixelDocument): Promise<Uint8Array> {
  const blob = await exportCompositeToPngBlob(compositeLayers(doc), doc.width, doc.height)
  return new Uint8Array(await blob.arrayBuffer())
}

export async function materialTextureToPngBytes(
  doc: PixelDocument,
  mat: Material
): Promise<{ data: Uint8Array; hasAlpha: boolean }> {
  const baked = bakeMaterialTexturePixels(doc, mat)
  const blob = await exportCompositeToPngBlob(baked.pixels, baked.width, baked.height)
  return { data: new Uint8Array(await blob.arrayBuffer()), hasAlpha: baked.hasAlpha }
}

/** Stable texture file name shared by OBJ MTL + ZIP when materials match. */
export function textureExportFilename(
  obj: SceneObject,
  textureId: string,
  mat: Material,
  ctx: TextureExportContext,
  ext = 'png'
): string {
  const processKey = materialTextureProcessKey(mat)
  const identityKey = materialTextureProcessKey({
    mode: 'texture',
    opacity: 1,
    doubleSided: false,
  })
  const meta = ctx.objectTextures[textureId]
  const base = meta?.name
    ? sanitizeExportBasename(meta.name.replace(/\.[^.]+$/, ''))
    : sanitizeExportBasename(obj.name)
  const suffix =
    processKey === identityKey ? '' : `_${sanitizeExportBasename(processKey).slice(0, 20)}`
  return `${base}${suffix}_texture.${ext}`
}

export async function collectObjectTextureFiles(
  objects: SceneObject[],
  ctx: TextureExportContext
): Promise<TextureFileEntry[]> {
  const seen = new Set<string>()
  const files: TextureFileEntry[] = []

  for (const obj of objects) {
    const textureId = resolveObjectTextureId(obj)
    if (!textureId) continue
    const doc = ctx.pixelDocuments[textureId]
    if (!doc) continue
    const mat = resolveEffectiveMaterial(obj)
    const dedupeKey = `${textureId}|${materialTextureProcessKey(mat)}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    const { data } = await materialTextureToPngBytes(doc, mat)
    files.push({
      path: textureExportFilename(obj, textureId, mat, ctx),
      data,
      objectId: obj.id,
      textureId,
    })
  }

  return files
}

export function buildMaterialsManifest(
  objects: SceneObject[],
  ctx: TextureExportContext
): { version: 1; exportedAt: string; materials: MaterialExportEntry[] } {
  const materials: MaterialExportEntry[] = objects.map((obj) => {
    const material = resolveEffectiveMaterial(obj)
    const textureId = material.mode === 'texture' ? material.textureId ?? obj.id : null
    const meta = textureId ? ctx.objectTextures[textureId] : undefined
    const doc = textureId ? ctx.pixelDocuments[textureId] : undefined
    return {
      objectId: obj.id,
      objectName: obj.name,
      material,
      textureId,
      textureFile:
        textureId && doc ? textureExportFilename(obj, textureId, material, ctx) : null,
      textureWidth: doc?.width ?? meta?.width ?? null,
      textureHeight: doc?.height ?? meta?.height ?? null,
    }
  })

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    materials,
  }
}

export function textureCountForObjects(objects: SceneObject[], ctx: TextureExportContext): number {
  const seen = new Set<string>()
  let count = 0
  for (const obj of objects) {
    const textureId = resolveObjectTextureId(obj)
    if (!textureId || seen.has(textureId) || !ctx.pixelDocuments[textureId]) continue
    seen.add(textureId)
    count++
  }
  return count
}

export async function downloadTexturesZip(
  objects: SceneObject[],
  ctx: TextureExportContext,
  baseName = DEFAULT_EXPORT_BASENAME
): Promise<number> {
  const files = await collectObjectTextureFiles(objects, ctx)
  if (files.length === 0) throw new Error('No painted textures to export in the current scope.')
  const zip = createZipBlob(files.map(({ path, data }) => ({ path, data })))
  await downloadBlob(zip, `${sanitizeExportBasename(baseName)}-textures.zip`, {
    title: 'Export textures',
    filters: ZIP_EXPORT_FILTERS,
  })
  return files.length
}

export async function downloadMaterialsJson(
  objects: SceneObject[],
  ctx: TextureExportContext,
  baseName = DEFAULT_EXPORT_BASENAME
): Promise<boolean> {
  return downloadJSON(buildMaterialsManifest(objects, ctx), `${sanitizeExportBasename(baseName)}-materials.json`, {
    title: 'Export materials',
    filters: JSON_EXPORT_FILTERS,
  })
}

export async function downloadObjectTexturePng(
  obj: SceneObject,
  ctx: TextureExportContext
): Promise<void> {
  const textureId = resolveObjectTextureId(obj)
  if (!textureId) throw new Error('Object is not using a texture material.')
  const doc = ctx.pixelDocuments[textureId]
  if (!doc) throw new Error('No pixel texture found for this object.')
  const mat = resolveEffectiveMaterial(obj)
  const { data } = await materialTextureToPngBytes(doc, mat)
  const filename = textureExportFilename(obj, textureId, mat, ctx)
  await downloadBlob(new Blob([data], { type: 'image/png' }), filename, {
    title: 'Export texture',
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  })
}

export function exportFilenameForPixelDocument(
  doc: PixelDocument,
  ctx: TextureExportContext,
  linkedObject?: SceneObject | null
): string {
  const meta = ctx.objectTextures[doc.id]
  if (meta?.name) {
    return `${sanitizeExportBasename(meta.name.replace(/\.[^.]+$/, ''))}.png`
  }
  if (linkedObject) {
    return textureFilenameForObject(linkedObject)
  }
  const layerName = doc.layers[0]?.name
  if (layerName && layerName !== 'Layer 1') {
    return `${sanitizeExportBasename(layerName)}.png`
  }
  return `${sanitizeExportBasename(doc.id)}.png`
}
