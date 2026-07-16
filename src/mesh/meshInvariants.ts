export const DEFAULT_MESH_STRUCTURE_LIMITS = {
  maxVertices: 1_000_000,
  maxFaces: 2_000_000,
  maxFaceCorners: 16_000_000,
} as const

export type MeshStructureIssueCode =
  | 'positions_missing'
  | 'positions_limit'
  | 'vertex_invalid'
  | 'faces_missing'
  | 'faces_limit'
  | 'face_invalid'
  | 'face_duplicate_vertex'
  | 'face_corner_limit'
  | 'uv_invalid'
  | 'face_uv_invalid'
  | 'corner_color_invalid'
  | 'face_color_index_invalid'

export interface MeshStructureIssue {
  code: MeshStructureIssueCode
  message: string
  vertexIndex?: number
  faceIndex?: number
}

export interface MeshStructureLimits {
  maxVertices: number
  maxFaces: number
  maxFaceCorners: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteVec2(value: unknown, x: string, y: string): boolean {
  return (
    isRecord(value) &&
    Number.isFinite(value[x]) &&
    Number.isFinite(value[y])
  )
}

/**
 * Validate array and index invariants required by render, selection, and export.
 * Geometric policy (open/non-manifold/concave meshes) is deliberately out of scope.
 */
export function validateMeshStructure(
  value: unknown,
  limits: MeshStructureLimits = DEFAULT_MESH_STRUCTURE_LIMITS
): MeshStructureIssue[] {
  if (!isRecord(value)) {
    return [{ code: 'positions_missing', message: 'Mesh is not an object.' }]
  }

  const issues: MeshStructureIssue[] = []
  const positions = value.positions
  const faces = value.faces
  if (!Array.isArray(positions)) {
    issues.push({ code: 'positions_missing', message: 'Mesh positions are missing.' })
    return issues
  }
  if (positions.length > limits.maxVertices) {
    issues.push({
      code: 'positions_limit',
      message: `Mesh has ${positions.length} vertices; limit is ${limits.maxVertices}.`,
    })
  }
  for (let vertexIndex = 0; vertexIndex < positions.length; vertexIndex++) {
    const position = positions[vertexIndex]
    if (
      !isRecord(position) ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(position.z)
    ) {
      issues.push({
        code: 'vertex_invalid',
        message: `Vertex ${vertexIndex} is not a finite 3D point.`,
        vertexIndex,
      })
      break
    }
  }

  if (!Array.isArray(faces)) {
    issues.push({ code: 'faces_missing', message: 'Mesh faces are missing.' })
    return issues
  }
  if (faces.length > limits.maxFaces) {
    issues.push({
      code: 'faces_limit',
      message: `Mesh has ${faces.length} faces; limit is ${limits.maxFaces}.`,
    })
  }

  let faceCorners = 0
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    const face = faces[faceIndex]
    if (
      !Array.isArray(face) ||
      face.length < 3 ||
      face.some(
        (vertexIndex) =>
          !Number.isInteger(vertexIndex) ||
          vertexIndex < 0 ||
          vertexIndex >= positions.length
      )
    ) {
      issues.push({
        code: 'face_invalid',
        message: `Face ${faceIndex} has invalid vertex indices.`,
        faceIndex,
      })
      continue
    }
    faceCorners += face.length
    if (new Set(face).size < 3 || new Set(face).size !== face.length) {
      issues.push({
        code: 'face_duplicate_vertex',
        message: `Face ${faceIndex} repeats a vertex index.`,
        faceIndex,
      })
    }
  }
  if (faceCorners > limits.maxFaceCorners) {
    issues.push({
      code: 'face_corner_limit',
      message: `Mesh has ${faceCorners} face corners; limit is ${limits.maxFaceCorners}.`,
    })
  }

  const uvs = value.uvs
  if (uvs !== undefined) {
    if (!Array.isArray(uvs) || uvs.some((uv) => !finiteVec2(uv, 'u', 'v'))) {
      issues.push({ code: 'uv_invalid', message: 'UV coordinates must be finite 2D points.' })
    }
  }

  const faceUvIndices = value.faceUvIndices
  if (faceUvIndices !== undefined) {
    const validUvCount = Array.isArray(uvs) ? uvs.length : 0
    const valid =
      Array.isArray(faceUvIndices) &&
      faceUvIndices.length === faces.length &&
      faceUvIndices.every(
        (ring, faceIndex) =>
          Array.isArray(ring) &&
          Array.isArray(faces[faceIndex]) &&
          ring.length === faces[faceIndex].length &&
          ring.every(
            (uvIndex) =>
              Number.isInteger(uvIndex) &&
              uvIndex >= 0 &&
              uvIndex < validUvCount
          )
      )
    if (!valid) {
      issues.push({
        code: 'face_uv_invalid',
        message: 'Face UV indices must parallel faces and reference the UV pool.',
      })
    }
  }

  const cornerColors = value.cornerColors
  if (
    cornerColors !== undefined &&
    (!Array.isArray(cornerColors) ||
      cornerColors.some(
        (color) =>
          !Array.isArray(color) ||
          color.length !== 4 ||
          color.some((channel) => !Number.isFinite(channel))
      ))
  ) {
    issues.push({
      code: 'corner_color_invalid',
      message: 'Corner colors must be finite RGBA tuples.',
    })
  }

  const faceColorIndices = value.faceColorIndices
  if (faceColorIndices !== undefined) {
    const validColorCount = Array.isArray(cornerColors) ? cornerColors.length : 0
    const valid =
      Array.isArray(faceColorIndices) &&
      faceColorIndices.length === faces.length &&
      faceColorIndices.every(
        (ring, faceIndex) =>
          Array.isArray(ring) &&
          Array.isArray(faces[faceIndex]) &&
          ring.length === faces[faceIndex].length &&
          ring.every(
            (colorIndex) =>
              Number.isInteger(colorIndex) &&
              colorIndex >= 0 &&
              colorIndex < validColorCount
          )
      )
    if (!valid) {
      issues.push({
        code: 'face_color_index_invalid',
        message: 'Face color indices must parallel faces and reference corner colors.',
      })
    }
  }

  return issues
}
