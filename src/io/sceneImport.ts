import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { disposeObject3D, geometryToSceneObject, object3DToSceneObjects } from './sceneMeshBridge'

export type ImportFormat = 'obj' | 'gltf' | 'stl' | 'unknown'

export function detectImportFormat(filename: string): ImportFormat {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.obj')) return 'obj'
  if (lower.endsWith('.glb') || lower.endsWith('.gltf')) return 'gltf'
  if (lower.endsWith('.stl')) return 'stl'
  return 'unknown'
}

function baseNameFromFile(filename: string): string {
  const parts = filename.replace(/\\/g, '/').split('/')
  const file = parts[parts.length - 1] ?? 'Imported'
  return file.replace(/\.[^.]+$/, '') || 'Imported'
}

async function readFileAsText(file: File): Promise<string> {
  return file.text()
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer()
}

function importOBJFromText(text: string, name: string): SceneObject[] {
  const loader = new OBJLoader()
  const group = loader.parse(text)
  group.name = name
  try {
    const objects = object3DToSceneObjects(group)
    if (objects.length === 0) throw new Error('OBJ file contains no meshes')
    return objects.map((obj, i) => ({
      ...obj,
      name: objects.length === 1 ? name : `${name}_${i + 1}`,
    }))
  } finally {
    disposeObject3D(group)
  }
}

function importSTLFromBuffer(buffer: ArrayBuffer, name: string): SceneObject[] {
  const loader = new STLLoader()
  const geometry = loader.parse(buffer)
  geometry.computeVertexNormals()
  try {
    const obj = geometryToSceneObject(name, geometry)
    if (!obj) throw new Error('STL file contains no geometry')
    return [obj]
  } finally {
    geometry.dispose()
  }
}

function importGLTFFromBuffer(buffer: ArrayBuffer, name: string): Promise<SceneObject[]> {
  const loader = new GLTFLoader()
  return new Promise((resolve, reject) => {
    loader.parse(
      buffer,
      '',
      (gltf) => {
        const root = gltf.scene
        root.name = name
        try {
          const objects = object3DToSceneObjects(root)
          if (objects.length === 0) {
            reject(new Error('GLTF/GLB file contains no meshes'))
            return
          }
          resolve(
            objects.map((obj, i) => ({
              ...obj,
              name: obj.name === 'Imported' || !obj.name ? `${name}_${i + 1}` : obj.name,
            }))
          )
        } finally {
          disposeObject3D(root)
        }
      },
      reject
    )
  })
}

export async function importSceneFromFile(file: File): Promise<SceneObject[]> {
  const format = detectImportFormat(file.name)
  const baseName = baseNameFromFile(file.name)

  switch (format) {
    case 'obj': {
      const text = await readFileAsText(file)
      return importOBJFromText(text, baseName)
    }
    case 'gltf': {
      const buffer = await readFileAsArrayBuffer(file)
      return importGLTFFromBuffer(buffer, baseName)
    }
    case 'stl': {
      const buffer = await readFileAsArrayBuffer(file)
      return importSTLFromBuffer(buffer, baseName)
    }
    default:
      throw new Error('Unsupported file type. Use OBJ, GLB, GLTF, or STL.')
  }
}

export const IMPORT_ACCEPT = '.obj,.glb,.gltf,.stl'
