/// <reference types="vite/client" />

interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string | string[]>
}

interface SaveFilePickerOptions {
  excludeAcceptAllOption?: boolean
  id?: string
  startIn?: WellKnownDirectory | FileSystemHandle
  suggestedName?: string
  types?: FilePickerAcceptType[]
}

interface OpenFilePickerOptions {
  excludeAcceptAllOption?: boolean
  id?: string
  multiple?: boolean
  startIn?: WellKnownDirectory | FileSystemHandle
  types?: FilePickerAcceptType[]
}

type WellKnownDirectory = 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'

interface FileSystemHandle {
  readonly kind: 'file' | 'directory'
  readonly name: string
}

interface FileSystemFileHandle extends FileSystemHandle {
  readonly kind: 'file'
  createWritable(): Promise<FileSystemWritableFileStream>
  getFile(): Promise<File>
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: BufferSource | Blob | string): Promise<void>
  close(): Promise<void>
}
