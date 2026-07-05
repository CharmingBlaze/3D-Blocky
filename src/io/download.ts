import { saveBlob, saveJson, saveText, type FileFilter, type SaveFileOptions } from './fileDialogs'

export type { FileFilter, SaveFileOptions }

export const PROJECT_FILE_FILTERS: FileFilter[] = [
  { name: '3D Blocky project', extensions: ['blocky.json'] },
  { name: 'Legacy project', extensions: ['lpo.json'] },
  { name: 'JSON', extensions: ['json'] },
]

export const MESH_IMPORT_FILTERS: FileFilter[] = [
  { name: '3D meshes', extensions: ['obj', 'glb', 'gltf', 'stl'] },
]

export const IMAGE_IMPORT_FILTERS: FileFilter[] = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
]

export const PIXEL_PROJECT_FILTERS: FileFilter[] = [
  { name: 'Pixel texture project', extensions: ['blocky-texture.json'] },
  { name: 'Legacy texture project', extensions: ['lpo-texture.json'] },
  { name: 'JSON', extensions: ['json'] },
]

export const GLB_EXPORT_FILTERS: FileFilter[] = [{ name: 'GLB', extensions: ['glb'] }]
export const GLTF_EXPORT_FILTERS: FileFilter[] = [{ name: 'GLTF', extensions: ['gltf'] }]
export const OBJ_EXPORT_FILTERS: FileFilter[] = [{ name: 'Wavefront OBJ', extensions: ['obj'] }]
export const STL_EXPORT_FILTERS: FileFilter[] = [{ name: 'STL', extensions: ['stl'] }]
export const ZIP_EXPORT_FILTERS: FileFilter[] = [{ name: 'ZIP archive', extensions: ['zip'] }]
export const JSON_EXPORT_FILTERS: FileFilter[] = [{ name: 'JSON', extensions: ['json'] }]

export async function downloadBlob(
  blob: Blob,
  filename: string,
  dialog?: Omit<SaveFileOptions, 'defaultFilename'>
): Promise<boolean> {
  return saveBlob(blob, {
    title: dialog?.title ?? 'Save file',
    defaultFilename: filename,
    filters: dialog?.filters ?? [{ name: 'All files', extensions: ['*'] }],
  })
}

export async function downloadFile(
  content: string,
  filename: string,
  _mimeType: string,
  dialog?: Omit<SaveFileOptions, 'defaultFilename'>
): Promise<boolean> {
  return saveText(content, {
    title: dialog?.title ?? 'Save file',
    defaultFilename: filename,
    filters: dialog?.filters ?? [{ name: 'All files', extensions: ['*'] }],
  })
}

export async function downloadJSON(
  data: object,
  filename: string,
  dialog?: Omit<SaveFileOptions, 'defaultFilename'>
): Promise<boolean> {
  return saveJson(data, {
    title: dialog?.title ?? 'Save file',
    defaultFilename: filename,
    filters: dialog?.filters ?? [{ name: 'JSON', extensions: ['json'] }],
  })
}

export async function downloadArrayBuffer(
  buffer: ArrayBuffer,
  filename: string,
  mimeType: string,
  dialog?: Omit<SaveFileOptions, 'defaultFilename'>
): Promise<boolean> {
  return downloadBlob(new Blob([buffer], { type: mimeType }), filename, dialog)
}
