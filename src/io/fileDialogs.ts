import {
  PickOpenFile as wailsPickOpen,
  PickSaveFile as wailsPickSave,
  ReadFileBase64 as wailsReadBase64,
  WriteFileBase64 as wailsWriteBase64,
  WriteTextFile as wailsWriteText,
} from '../../wailsjs/go/main/App'

export type FileFilter = {
  name: string
  extensions: string[]
}

export type PickOpenFileOptions = {
  title: string
  filters: FileFilter[]
}

export type SaveFileOptions = {
  title: string
  defaultFilename: string
  filters: FileFilter[]
}

type SaveTarget =
  | { kind: 'wails'; path: string }
  | { kind: 'fs-handle'; handle: FileSystemFileHandle }
  | { kind: 'download'; filename: string }

declare global {
  interface Window {
    go?: {
      main: {
        App: Record<string, unknown>
      }
    }
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>
  }
}

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && !!window.go?.main?.App
}

/** True when export can open a system / browser save dialog (not a silent download). */
export function canPickSaveLocation(): boolean {
  return isDesktopApp() || typeof window.showSaveFilePicker === 'function'
}

function primaryFilter(options: { filters: FileFilter[] }): FileFilter {
  return options.filters[0] ?? { name: 'All files', extensions: ['*'] }
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? 'file'
}

function mimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.glb')) return 'model/gltf-binary'
  if (lower.endsWith('.gltf')) return 'model/gltf+json'
  if (lower.endsWith('.obj')) return 'model/obj'
  if (lower.endsWith('.mtl')) return 'text/plain'
  if (lower.endsWith('.stl')) return 'model/stl'
  if (lower.endsWith('.zip')) return 'application/zip'
  if (lower.endsWith('.json')) return 'application/json'
  return 'application/octet-stream'
}

function mimeExtensions(ext: string): string[] {
  switch (ext.replace(/^\./, '')) {
    case 'png':
      return ['image/png']
    case 'jpg':
    case 'jpeg':
      return ['image/jpeg']
    case 'webp':
      return ['image/webp']
    case 'json':
      return ['application/json']
    case 'glb':
      return ['model/gltf-binary']
    case 'gltf':
      return ['model/gltf+json']
    case 'obj':
      return ['model/obj', 'text/plain']
    case 'mtl':
      return ['text/plain']
    case 'stl':
      return ['model/stl', 'application/octet-stream']
    case 'zip':
      return ['application/zip']
    default:
      return ['application/octet-stream']
  }
}

function savePickerTypes(filters: FileFilter[]): FilePickerAcceptType[] | undefined {
  const filter = primaryFilter({ filters })
  const extensions = filter.extensions
    .filter((ext) => ext !== '*')
    .map((ext) => `.${ext.replace(/^\./, '')}`)
  if (extensions.length === 0) return undefined

  const accept: Record<string, string[]> = {}
  for (const ext of extensions) {
    const clean = ext.replace(/^\./, '')
    const mime = mimeExtensions(clean)[0] ?? 'application/octet-stream'
    if (!accept[mime]) accept[mime] = []
    accept[mime].push(ext)
  }

  return [{ description: filter.name, accept }]
}

async function pickSaveTarget(options: SaveFileOptions): Promise<SaveTarget | null> {
  const filter = primaryFilter(options)

  if (isDesktopApp()) {
    const path = await wailsPickSave(
      options.title,
      options.defaultFilename,
      filter.name,
      filter.extensions
    )
    return path ? { kind: 'wails', path } : null
  }

  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: options.defaultFilename,
        types: savePickerTypes(options.filters),
      })
      return { kind: 'fs-handle', handle }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null
      throw err
    }
  }

  return { kind: 'download', filename: options.defaultFilename }
}

async function writeBlobTarget(target: SaveTarget, blob: Blob): Promise<void> {
  switch (target.kind) {
    case 'wails':
      await wailsWriteBase64(target.path, bytesToBase64(new Uint8Array(await blob.arrayBuffer())))
      return
    case 'fs-handle': {
      const writable = await target.handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    }
    case 'download':
      triggerBrowserDownload(blob, target.filename)
  }
}

async function writeTextTarget(target: SaveTarget, content: string): Promise<void> {
  await writeBlobTarget(target, new Blob([content], { type: 'text/plain;charset=utf-8' }))
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function pickOpenFileBrowser(options: PickOpenFileOptions): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.hidden = true
    const filter = primaryFilter(options)
    if (filter.extensions[0] !== '*') {
      input.accept = filter.extensions
        .flatMap((ext) => {
          const clean = ext.replace(/^\./, '')
          return [`.${clean}`, ...mimeExtensions(clean)]
        })
        .join(',')
    }
    input.onchange = () => {
      const file = input.files?.[0] ?? null
      input.remove()
      resolve(file)
    }
    input.oncancel = () => {
      input.remove()
      resolve(null)
    }
    document.body.appendChild(input)
    input.click()
  })
}

export async function pickOpenFile(options: PickOpenFileOptions): Promise<File | null> {
  if (isDesktopApp()) {
    const filter = primaryFilter(options)
    const path = await wailsPickOpen(options.title, filter.name, filter.extensions)
    if (!path) return null
    const encoded = await wailsReadBase64(path)
    const bytes = base64ToBytes(encoded)
    const name = basename(path)
    return new File([bytes], name, { type: mimeFromFilename(name) })
  }

  return pickOpenFileBrowser(options)
}

/** @deprecated Use pickSaveTarget via saveBlob/saveText */
export async function pickSavePath(options: SaveFileOptions): Promise<string | null> {
  const target = await pickSaveTarget(options)
  if (!target) return null
  if (target.kind === 'wails') return target.path
  if (target.kind === 'download') return target.filename
  return target.handle.name
}

export async function saveBlob(blob: Blob, options: SaveFileOptions): Promise<boolean> {
  const target = await pickSaveTarget(options)
  if (!target) return false
  await writeBlobTarget(target, blob)
  return true
}

export async function saveText(content: string, options: SaveFileOptions): Promise<boolean> {
  const target = await pickSaveTarget(options)
  if (!target) return false
  await writeTextTarget(target, content)
  return true
}

export async function saveJson(data: object, options: SaveFileOptions): Promise<boolean> {
  return saveText(JSON.stringify(data, null, 2), options)
}

export async function writeTextToPath(path: string, content: string): Promise<void> {
  if (!isDesktopApp()) throw new Error('writeTextToPath is only available in the desktop app.')
  await wailsWriteText(path, content)
}

export function companionPath(path: string, newExtension: string): string {
  return path.replace(/\.[^./\\]+$/, '') + newExtension
}

export function saveResultLabel(saved: boolean, filename: string): string | null {
  if (!saved) return null
  return `Saved ${filename}.`
}
