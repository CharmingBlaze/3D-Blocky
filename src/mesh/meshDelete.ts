import { HalfEdgeMesh, type SceneObject } from './HalfEdgeMesh'
import { edgeKey, type MeshComponentSelection } from './meshSelection'
import type { SelectionMode } from '../store/appStore'

function removeUnreferencedVertices(mesh: HalfEdgeMesh): void {
  const used = new Set<number>()
  for (const face of mesh.faces) {
    for (const vi of face) used.add(vi)
  }
  const oldToNew = new Map<number, number>()
  const newPositions: SceneObject['positions'] = []
  for (const vi of [...used].sort((a, b) => a - b)) {
    oldToNew.set(vi, newPositions.length)
    newPositions.push({ ...mesh.positions[vi] })
  }
  mesh.positions = newPositions
  mesh.faces = mesh.faces.map((face) => face.map((vi) => oldToNew.get(vi)!))
}

export function collectFacesToDelete(
  obj: SceneObject,
  selection: MeshComponentSelection,
  mode: SelectionMode
): Set<number> {
  const toDelete = new Set<number>()

  if (mode === 'face') {
    for (const fi of selection.faces) toDelete.add(fi)
    return toDelete
  }

  if (mode === 'edge') {
    const edgeSet = new Set(selection.edges)
    for (let fi = 0; fi < obj.faces.length; fi++) {
      const face = obj.faces[fi]
      for (let i = 0; i < face.length; i++) {
        const key = edgeKey(face[i], face[(i + 1) % face.length])
        if (edgeSet.has(key)) toDelete.add(fi)
      }
    }
    return toDelete
  }

  if (mode === 'vertex') {
    const verts = new Set(selection.vertices)
    for (let fi = 0; fi < obj.faces.length; fi++) {
      if (obj.faces[fi].some((vi) => verts.has(vi))) toDelete.add(fi)
    }
  }

  return toDelete
}

/** Remove faces; returns null when every face would be removed. */
export function deleteFacesFromObject(
  obj: SceneObject,
  faceIndices: Set<number>
): SceneObject | null {
  if (faceIndices.size === 0) return obj

  const mesh = HalfEdgeMesh.fromObject(obj)
  const newFaces: number[][] = []
  const newColors: number[] = []
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    if (faceIndices.has(fi)) continue
    newFaces.push(mesh.faces[fi])
    newColors.push(mesh.faceColors[fi] ?? obj.color)
  }
  if (newFaces.length === 0) return null

  mesh.faces = newFaces
  mesh.faceColors = newColors
  removeUnreferencedVertices(mesh)
  mesh.buildHalfEdges()
  return mesh.toObject(obj.id, obj.name, obj)
}
