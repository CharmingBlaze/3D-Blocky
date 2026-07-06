import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { resolveEffectiveMaterial } from '../material/materials'
import type { PixelDocument } from '../pixel/pixelTypes'
import type { UvTextureInfo } from '../store/appStore'

export interface SceneTextureEntry {
  id: string
  label: string
  width: number
  height: number
  refCount: number
}

export function listSceneTextures(
  pixelDocuments: Record<string, PixelDocument>,
  objectTextures: Record<string, UvTextureInfo>,
  objects: SceneObject[]
): SceneTextureEntry[] {
  const refCounts = new Map<string, number>()
  for (const obj of objects) {
    const mat = resolveEffectiveMaterial(obj)
    if (mat.mode !== 'texture') continue
    const texId = mat.textureId ?? obj.id
    refCounts.set(texId, (refCounts.get(texId) ?? 0) + 1)
  }

  return Object.entries(pixelDocuments)
    .map(([id, doc]) => {
      const meta = objectTextures[id]
      const name = meta?.name ?? doc.layers[0]?.name ?? 'Texture'
      const width = meta?.width ?? doc.width
      const height = meta?.height ?? doc.height
      const refCount = refCounts.get(id) ?? 0
      const shared = refCount > 1 ? ` · ${refCount} objects` : ''
      return {
        id,
        label: `${name} (${width}×${height})${shared}`,
        width,
        height,
        refCount,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function activeObjectTextureId(obj: SceneObject | null | undefined): string | null {
  if (!obj) return null
  const mat = resolveEffectiveMaterial(obj)
  if (mat.mode !== 'texture') return null
  return mat.textureId ?? obj.id
}
