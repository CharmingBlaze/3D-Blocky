import {
  add3,
  faceNormal,
  generateId,
  normalize3,
  scale3,
  sub3,
  type Vec3,
} from '../utils/math'
import { defaultMaterial, cloneMaterial, type Material } from '../material/materialTypes'
import type { CornerColor } from '../material/colorObject'
import type { Uv2 } from '../uv/uvTypes'
import type { SketchSource } from '../stroke/sketchSource'

export interface HalfEdge {
  origin: number
  twin: number
  next: number
  face: number
}

export interface MeshData {
  positions: Float32Array
  indices: Uint32Array
  uvs?: Float32Array
  /** Per-corner RGB (3) or RGBA (4) — length = cornerCount * components */
  faceColors: Float32Array
  flatShading: boolean
}

export interface ObjectTransform {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}

export interface SceneObject {
  id: string
  name: string
  positions: Vec3[]
  faces: number[][]
  faceColors: number[]
  /** UV coordinate pool (normalized 0–1). */
  uvs?: Uv2[]
  /** Per-face UV indices parallel to `faces`. */
  faceUvIndices?: number[][]
  /** Corner color pool (RGBA 0–1). */
  cornerColors?: CornerColor[]
  /** Per-face corner color indices parallel to `faces`. */
  faceColorIndices?: number[][]
  material?: Material
  /** Per-face material overrides; null entries inherit `material`. */
  faceMaterials?: (Material | null)[]
  /** Logical face groups — indices into `faces` that form one selectable region. */
  faceGroups?: number[][]
  /** Box = full 0–1 per face; perFace = planar projection per face. */
  uvMappingMode?: 'box' | 'perFace'
  /** True after automatic seam detection + island packing has been applied. */
  uvAutoPacked?: boolean
  topologyLocked: boolean
  polyBudget: number
  polyBudgetMode: 'strict' | 'adaptive'
  smoothShading: boolean
  /** Blender-style Subdivision Surface modifier — viewport preview only until applied. */
  subdEnabled?: boolean
  subdLevels?: number
  facetExaggeration: number
  color: number
  pivot?: Vec3
  transform?: ObjectTransform
  /** When set, mesh can be rebuilt from stroke data (sketch doodles). */
  sketchSource?: SketchSource
}

function emptyMesh(): SceneObject {
  return {
    id: generateId(),
    name: 'Object',
    positions: [],
    faces: [],
    faceColors: [],
    topologyLocked: false,
    polyBudget: 64,
    polyBudgetMode: 'strict',
    smoothShading: false,
    facetExaggeration: 0,
    color: 0x6ecbf5,
    material: defaultMaterial(0x6ecbf5),
  }
}

export class HalfEdgeMesh {
  positions: Vec3[] = []
  faces: number[][] = []
  faceColors: number[] = []
  uvs: Uv2[] = []
  faceUvIndices: number[][] = []
  cornerColors: CornerColor[] = []
  faceColorIndices: number[][] = []
  faceGroups: number[][] = []
  halfEdges: HalfEdge[] = []
  topologyLocked = false

  static fromObject(obj: SceneObject): HalfEdgeMesh {
    const mesh = new HalfEdgeMesh()
    mesh.positions = obj.positions.map((p) => ({ ...p }))
    mesh.faces = obj.faces.map((f) => [...f])
    mesh.faceColors = [...obj.faceColors]
    mesh.uvs = (obj.uvs ?? []).map((u) => ({ ...u }))
    mesh.faceUvIndices = (obj.faceUvIndices ?? []).map((f) => [...f])
    mesh.cornerColors = (obj.cornerColors ?? []).map((c) => [...c] as CornerColor)
    mesh.faceColorIndices = (obj.faceColorIndices ?? []).map((f) => [...f])
    mesh.cornerColors = (obj.cornerColors ?? []).map((c) => [...c] as CornerColor)
    mesh.faceColorIndices = (obj.faceColorIndices ?? []).map((f) => [...f])
    mesh.faceGroups = (obj.faceGroups ?? []).map((g) => [...g])
    mesh.topologyLocked = obj.topologyLocked
    mesh.buildHalfEdges()
    return mesh
  }

  toObject(id: string, name: string, meta: Partial<SceneObject> = {}): SceneObject {
    return {
      id,
      name,
      positions: this.positions.map((p) => ({ ...p })),
      faces: this.faces.map((f) => [...f]),
      faceColors: [...this.faceColors],
      uvs: this.uvs.length > 0 ? this.uvs.map((u) => ({ ...u })) : meta.uvs,
      faceUvIndices:
        this.faceUvIndices.length > 0
          ? this.faceUvIndices.map((f) => [...f])
          : meta.faceUvIndices,
      cornerColors:
        this.cornerColors.length > 0
          ? this.cornerColors.map((c) => [...c] as CornerColor)
          : meta.cornerColors,
      faceColorIndices:
        this.faceColorIndices.length > 0
          ? this.faceColorIndices.map((f) => [...f])
          : meta.faceColorIndices,
      material: meta.material ? cloneMaterial(meta.material) : undefined,
      faceMaterials: meta.faceMaterials?.map((m) => (m ? cloneMaterial(m) : null)),
      faceGroups:
        this.faceGroups.length > 0
          ? this.faceGroups.map((g) => [...g])
          : meta.faceGroups,
      topologyLocked: this.topologyLocked,
      polyBudget: meta.polyBudget ?? 64,
      polyBudgetMode: meta.polyBudgetMode ?? 'strict',
      smoothShading: meta.smoothShading ?? false,
      facetExaggeration: meta.facetExaggeration ?? 0,
      color: meta.color ?? 0x6ecbf5,
      pivot: meta.pivot ? { ...meta.pivot } : undefined,
      transform: meta.transform
        ? {
            position: { ...meta.transform.position },
            rotation: { ...meta.transform.rotation },
            scale: { ...meta.transform.scale },
          }
        : undefined,
      sketchSource: meta.sketchSource
        ? {
            ...meta.sketchSource,
            relative: meta.sketchSource.relative.map((p) => ({ ...p })),
            center: { ...meta.sketchSource.center },
          }
        : undefined,
    }
  }

  buildHalfEdges(): void {
    this.halfEdges = []
    const edgeMap = new Map<string, number>()

    for (let fi = 0; fi < this.faces.length; fi++) {
      const face = this.faces[fi]
      const n = face.length
      for (let i = 0; i < n; i++) {
        const origin = face[i]
        const dest = face[(i + 1) % n]
        const heIdx = this.halfEdges.length
        this.halfEdges.push({ origin, twin: -1, next: -1, face: fi })

        const key = `${origin}_${dest}`
        const reverseKey = `${dest}_${origin}`
        if (edgeMap.has(reverseKey)) {
          const twinIdx = edgeMap.get(reverseKey)!
          this.halfEdges[heIdx].twin = twinIdx
          this.halfEdges[twinIdx].twin = heIdx
        }
        edgeMap.set(key, heIdx)
      }
    }

    for (let fi = 0; fi < this.faces.length; fi++) {
      const face = this.faces[fi]
      const n = face.length
      for (let i = 0; i < n; i++) {
        const origin = face[i]
        const dest = face[(i + 1) % n]
        const key = `${origin}_${dest}`
        const heIdx = edgeMap.get(key)!
        const nextDest = face[(i + 2) % n]
        const nextKey = `${dest}_${nextDest}`
        this.halfEdges[heIdx].next = edgeMap.get(nextKey)!
      }
    }
  }

  getVertexNeighbors(vi: number): number[] {
    const neighbors = new Set<number>()
    for (const face of this.faces) {
      const idx = face.indexOf(vi)
      if (idx >= 0) {
        neighbors.add(face[(idx + face.length - 1) % face.length])
        neighbors.add(face[(idx + 1) % face.length])
      }
    }
    return [...neighbors]
  }

  getVertexNormal(vi: number, averaged = true): Vec3 {
    const normals: Vec3[] = []
    for (const face of this.faces) {
      if (!face.includes(vi)) continue
      const idx = face.indexOf(vi)
      const a = this.positions[face[idx]]
      const b = this.positions[face[(idx + 1) % face.length]]
      const c = this.positions[face[(idx + face.length - 1) % face.length]]
      normals.push(faceNormal(a, b, c))
    }
    if (normals.length === 0) return { x: 0, y: 1, z: 0 }
    if (!averaged) return normals[0]
    const sum = normals.reduce((acc, n) => add3(acc, n), { x: 0, y: 0, z: 0 })
    return normalize3(sum)
  }

  toMeshData(flatShading = true, facetExaggeration = 0): MeshData {
    const positions: number[] = []
    const indices: number[] = []
    const uvs: number[] = []
    const faceColors: number[] = []
    const hasUv =
      this.uvs.length > 0 && this.faceUvIndices.length === this.faces.length
    const hasCornerColors =
      this.cornerColors.length > 0 && this.faceColorIndices.length === this.faces.length

    if (flatShading) {
      for (let fi = 0; fi < this.faces.length; fi++) {
        const face = this.faces[fi]
        const color = this.faceColors[fi] ?? 0x6ecbf5
        const r = ((color >> 16) & 255) / 255
        const g = ((color >> 8) & 255) / 255
        const b = (color & 255) / 255

        const pushCornerColor = (ci: number) => {
          if (hasCornerColors) {
            const poolIdx = this.faceColorIndices[fi]?.[ci] ?? 0
            const c = this.cornerColors[poolIdx] ?? [r, g, b, 1]
            faceColors.push(c[0], c[1], c[2])
          } else {
            faceColors.push(r, g, b)
          }
        }

        const baseIdx = positions.length / 3
        const verts = face.map((vi) => this.positions[vi])
        let normal = faceNormal(verts[0], verts[1], verts[2])

        if (facetExaggeration > 0) {
          const avgNormal = normalize3(
            verts.reduce((acc, _, i) => {
              const n = this.getVertexNormal(face[i], true)
              return add3(acc, n)
            }, { x: 0, y: 0, z: 0 })
          )
          normal = normalize3(
            add3(
              scale3(normal, 1 - facetExaggeration),
              scale3(sub3(normal, avgNormal), facetExaggeration)
            )
          )
        }

        for (let ci = 0; ci < verts.length; ci++) {
          const v = verts[ci]
          positions.push(v.x, v.y, v.z)
          if (hasUv) {
            const uvIdx = this.faceUvIndices[fi]?.[ci] ?? 0
            const uv = this.uvs[uvIdx] ?? { u: 0, v: 0 }
            uvs.push(uv.u, uv.v)
          }
          pushCornerColor(ci)
        }
        if (face.length === 3) {
          indices.push(baseIdx, baseIdx + 1, baseIdx + 2)
        } else {
          for (let i = 1; i < face.length - 1; i++) {
            indices.push(baseIdx, baseIdx + i, baseIdx + i + 1)
          }
        }
      }
    } else {
      // Blender-style shade smooth: weld corners so vertex normals interpolate.
      const weldMap = new Map<string, number>()

      const weldKey = (vi: number, fi: number, ci: number): string => {
        if (!hasUv && !hasCornerColors) return String(vi)
        if (hasCornerColors) {
          const poolIdx = this.faceColorIndices[fi]?.[ci] ?? 0
          const uvIdx = hasUv ? (this.faceUvIndices[fi]?.[ci] ?? 0) : 0
          return `${vi}:${poolIdx}:${uvIdx}`
        }
        if (hasUv) {
          const uvIdx = this.faceUvIndices[fi]?.[ci] ?? 0
          return `${vi}:${uvIdx}`
        }
        const faceColor = this.faceColors[fi] ?? 0
        return `${vi}:${faceColor}`
      }

      const getOrCreateCorner = (vi: number, fi: number, ci: number): number => {
        const key = weldKey(vi, fi, ci)
        const existing = weldMap.get(key)
        if (existing !== undefined) return existing

        const renderIdx = positions.length / 3
        const p = this.positions[vi]!
        positions.push(p.x, p.y, p.z)
        if (hasUv) {
          const uvIdx = this.faceUvIndices[fi]?.[ci] ?? 0
          const uv = this.uvs[uvIdx] ?? { u: 0, v: 0 }
          uvs.push(uv.u, uv.v)
        }
        const color = this.faceColors[fi] ?? 0x6ecbf5
        const r = ((color >> 16) & 255) / 255
        const g = ((color >> 8) & 255) / 255
        const b = (color & 255) / 255
        if (hasCornerColors) {
          const poolIdx = this.faceColorIndices[fi]?.[ci] ?? 0
          const c = this.cornerColors[poolIdx] ?? [r, g, b, 1]
          faceColors.push(c[0], c[1], c[2])
        } else {
          faceColors.push(r, g, b)
        }
        weldMap.set(key, renderIdx)
        return renderIdx
      }

      for (let fi = 0; fi < this.faces.length; fi++) {
        const face = this.faces[fi]!
        const cornerIdx: number[] = []
        for (let ci = 0; ci < face.length; ci++) {
          cornerIdx.push(getOrCreateCorner(face[ci]!, fi, ci))
        }

        if (face.length === 3) {
          indices.push(cornerIdx[0]!, cornerIdx[1]!, cornerIdx[2]!)
        } else {
          for (let i = 1; i < face.length - 1; i++) {
            indices.push(cornerIdx[0]!, cornerIdx[i]!, cornerIdx[i + 1]!)
          }
        }
      }
    }

    return {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      uvs: uvs.length > 0 ? new Float32Array(uvs) : undefined,
      faceColors: new Float32Array(faceColors),
      flatShading,
    }
  }

  vertexCount(): number {
    return this.positions.length
  }

  faceCount(): number {
    return this.faces.length
  }
}

export function createEmptyObject(name = 'Object'): SceneObject {
  return { ...emptyMesh(), name, id: generateId() }
}
