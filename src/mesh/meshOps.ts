import * as THREE from 'three'
import type { SceneObject } from './HalfEdgeMesh'
import {
  edgeKey,
  parseEdgeKey,
  getAffectedVertices,
  selectionHasComponents,
  transformMeshSelectionWithGizmo,
  type MeshComponentSelection,
} from './meshSelection'
import type { SelectionMode } from '../store/appStore'
import {
  add3,
  faceNormal,
  normalize3,
  type Vec3,
} from '../utils/math'
import { cloneTransform } from './objectTransform'
import { cloneMaterial } from '../material/materialTypes'
import { mirrorWorldDirection } from '../symmetry/symmetry'
import {
  expandMeshSelectionWithSymmetry,
  mirrorMeshSelection,
  propagateSymmetricVertexPositions,
  type MeshSymmetryPlane,
} from '../symmetry/meshSymmetry'

export function cloneSceneObject(obj: SceneObject): SceneObject {
  return {
    ...obj,
    positions: obj.positions.map((p) => ({ ...p })),
    faces: obj.faces.map((f) => [...f]),
    faceColors: [...obj.faceColors],
    faceGroups: obj.faceGroups?.map((g) => [...g]),
    uvs: obj.uvs?.map((u) => ({ ...u })),
    faceUvIndices: obj.faceUvIndices?.map((f) => [...f]),
    cornerColors: obj.cornerColors?.map(
      (c) => [c[0], c[1], c[2], c[3]] as [number, number, number, number]
    ),
    faceColorIndices: obj.faceColorIndices?.map((f) => [...f]),
    material: obj.material ? cloneMaterial(obj.material) : undefined,
    faceMaterials: obj.faceMaterials?.map((m) => (m ? cloneMaterial(m) : null)),
    pivot: obj.pivot ? { ...obj.pivot } : undefined,
    transform: obj.transform ? cloneTransform(obj.transform) : undefined,
    primitiveSource: obj.primitiveSource
      ? {
          ...obj.primitiveSource,
          box: {
            min: { ...obj.primitiveSource.box.min },
            max: { ...obj.primitiveSource.box.max },
          },
          roundedParams: obj.primitiveSource.roundedParams
            ? { ...obj.primitiveSource.roundedParams }
            : undefined,
        }
      : undefined,
    sketchSource: obj.sketchSource
      ? {
          ...obj.sketchSource,
          relative: obj.sketchSource.relative.map((point) => ({ ...point })),
          center: { ...obj.sketchSource.center },
          planeFrame: obj.sketchSource.planeFrame
            ? {
                origin: { ...obj.sketchSource.planeFrame.origin },
                right: { ...obj.sketchSource.planeFrame.right },
                up: { ...obj.sketchSource.planeFrame.up },
              }
            : obj.sketchSource.planeFrame,
        }
      : undefined,
    vectorSource: obj.vectorSource
      ? {
          ...obj.vectorSource,
          path: {
            ...obj.vectorSource.path,
            anchors: obj.vectorSource.path.anchors.map((a) => ({
              ...a,
              position: { ...a.position },
              inHandle: a.inHandle ? { ...a.inHandle } : null,
              outHandle: a.outHandle ? { ...a.outHandle } : null,
            })),
            shapeParams: obj.vectorSource.path.shapeParams
              ? { ...obj.vectorSource.path.shapeParams }
              : undefined,
          },
        }
      : undefined,
    latheSource: obj.latheSource
      ? {
          ...obj.latheSource,
          points: obj.latheSource.points.map((point) => ({ ...point })),
        }
      : undefined,
  }
}

function collectExtrudeFaces(
  obj: SceneObject,
  selection: MeshComponentSelection,
  mode: SelectionMode
): Set<number> {
  const faces = new Set<number>()
  if (mode === 'face') {
    for (const fi of selection.faces) faces.add(fi)
    return faces
  }
  if (mode === 'edge') {
    for (const key of selection.edges) {
      const [a, b] = parseEdgeKey(key)
      for (let fi = 0; fi < obj.faces.length; fi++) {
        const face = obj.faces[fi]
        for (let i = 0; i < face.length; i++) {
          const va = face[i]
          const vb = face[(i + 1) % face.length]
          if ((va === a && vb === b) || (va === b && vb === a)) faces.add(fi)
        }
      }
    }
    return faces
  }
  if (mode === 'vertex') {
    const verts = new Set(selection.vertices)
    for (let fi = 0; fi < obj.faces.length; fi++) {
      if (obj.faces[fi].some((vi) => verts.has(vi))) faces.add(fi)
    }
  }
  return faces
}

function collectBevelEdges(
  obj: SceneObject,
  selection: MeshComponentSelection,
  mode: SelectionMode
): string[] {
  if (mode === 'edge') return [...selection.edges]
  if (mode === 'face') {
    const faceSet = new Set(selection.faces)
    const edgeCount = new Map<string, number>()
    for (const fi of faceSet) {
      const face = obj.faces[fi]
      for (let i = 0; i < face.length; i++) {
        const key = edgeKey(face[i], face[(i + 1) % face.length])
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
      }
    }
    return [...edgeCount.entries()].filter(([, c]) => c === 1).map(([k]) => k)
  }
  if (mode === 'vertex') {
    const verts = new Set(selection.vertices)
    const keys = new Set<string>()
    for (const face of obj.faces) {
      for (let i = 0; i < face.length; i++) {
        const a = face[i]
        const b = face[(i + 1) % face.length]
        if (verts.has(a) && verts.has(b)) keys.add(edgeKey(a, b))
      }
    }
    return [...keys]
  }
  return []
}

function faceAreaNormal(obj: SceneObject, face: number[]): Vec3 {
  if (face.length < 3) return { x: 0, y: 0, z: 0 }
  const origin = obj.positions[face[0]]!
  const sum = { x: 0, y: 0, z: 0 }
  for (let i = 1; i < face.length - 1; i++) {
    const a = obj.positions[face[i]]!
    const b = obj.positions[face[i + 1]]!
    const ax = a.x - origin.x, ay = a.y - origin.y, az = a.z - origin.z
    const bx = b.x - origin.x, by = b.y - origin.y, bz = b.z - origin.z
    sum.x += ay * bz - az * by
    sum.y += az * bx - ax * bz
    sum.z += ax * by - ay * bx
  }
  return sum
}

/** Connected face islands, joined only through a shared edge (Blender-style regions). */
function selectedFaceRegions(obj: SceneObject, selected: Set<number>): number[][] {
  const edgeFaces = new Map<string, number[]>()
  for (const fi of selected) {
    const face = obj.faces[fi]
    if (!face) continue
    for (let i = 0; i < face.length; i++) {
      const key = edgeKey(face[i]!, face[(i + 1) % face.length]!)
      const list = edgeFaces.get(key) ?? []
      list.push(fi)
      edgeFaces.set(key, list)
    }
  }
  const neighbors = new Map<number, Set<number>>()
  for (const fi of selected) neighbors.set(fi, new Set())
  for (const list of edgeFaces.values()) for (const a of list) for (const b of list) if (a !== b) neighbors.get(a)?.add(b)
  const remaining = new Set(selected)
  const regions: number[][] = []
  while (remaining.size) {
    const start = remaining.values().next().value as number
    const stack = [start], region: number[] = []
    remaining.delete(start)
    while (stack.length) {
      const fi = stack.pop()!
      region.push(fi)
      for (const next of neighbors.get(fi) ?? []) if (remaining.delete(next)) stack.push(next)
    }
    regions.push(region)
  }
  return regions
}

/** Blender-like Extrude Region: replace selected caps and bridge only island boundaries. */
export function extrudeMeshSelection(
  obj: SceneObject,
  selection: MeshComponentSelection,
  mode: SelectionMode,
  distance: number,
  direction?: Vec3
): SceneObject & { resultingSelection?: MeshComponentSelection } {
  if (mode === 'edge' && selection.edges.length > 0) {
    return extrudeSelectedEdges(obj, selection, distance, direction)
  }
  const faceSet = collectExtrudeFaces(obj, selection, mode)
  if (faceSet.size === 0 || Math.abs(distance) < 1e-8) return cloneSceneObject(obj)

  const positions = obj.positions.map((p) => ({ ...p }))
  const faces = obj.faces.map((f) => [...f])
  const faceColors = [...obj.faceColors]

  const hasUvs = !!obj.uvs?.length && obj.faceUvIndices?.length === obj.faces.length
  const uvs = obj.uvs?.map((uv) => ({ ...uv })) ?? []
  const faceUvIndices = obj.faceUvIndices?.map((face) => [...face]) ?? []
  const faceGroups = obj.faceGroups?.map((group) => [...group])

  for (const region of selectedFaceRegions(obj, faceSet)) {
    let normalSum: Vec3 = { x: 0, y: 0, z: 0 }
    for (const fi of region) normalSum = add3(normalSum, faceAreaNormal(obj, obj.faces[fi]!))
    let regionNormal = direction ? normalize3(direction) : normalize3(normalSum)
    if (Math.hypot(regionNormal.x, regionNormal.y, regionNormal.z) < 1e-8) {
      const first = obj.faces[region[0]!]!
      regionNormal = faceNormal(obj.positions[first[0]]!, obj.positions[first[1]]!, obj.positions[first[2]]!)
    }

    const regionVerts = new Set<number>()
    const boundary = new Map<string, { count: number; a: number; b: number; color: number; group?: number[] }>()
    for (const fi of region) {
      const face = obj.faces[fi]!
      for (const vi of face) regionVerts.add(vi)
      for (let i = 0; i < face.length; i++) {
        const a = face[i]!, b = face[(i + 1) % face.length]!, key = edgeKey(a, b)
        const entry = boundary.get(key)
        if (entry) entry.count++
        else boundary.set(key, { count: 1, a, b, color: faceColors[fi] ?? obj.color, group: faceGroups?.[fi] })
      }
    }

    const oldToNew = new Map<number, number>()
    for (const vi of regionVerts) {
      const p = positions[vi]!
      oldToNew.set(vi, positions.length)
      positions.push({ x: p.x + regionNormal.x * distance, y: p.y + regionNormal.y * distance, z: p.z + regionNormal.z * distance })
    }

    // The selected face indices remain selected and become the translated cap.
    for (const fi of region) faces[fi] = obj.faces[fi]!.map((vi) => oldToNew.get(vi)!)

    for (const edge of boundary.values()) {
      if (edge.count !== 1) continue
      const na = oldToNew.get(edge.a)!, nb = oldToNew.get(edge.b)!
      faces.push([edge.a, edge.b, nb, na])
      faceColors.push(edge.color)
      if (faceGroups) faceGroups.push(edge.group ? [...edge.group] : [])
      if (hasUvs) {
        const base = uvs.length
        uvs.push({ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 }, { u: 0, v: 1 })
        faceUvIndices.push([base, base + 1, base + 2, base + 3])
      }
    }
  }

  return { ...obj, positions, faces, faceColors, faceGroups, uvs: hasUvs ? uvs : obj.uvs, faceUvIndices: hasUvs ? faceUvIndices : obj.faceUvIndices }
}

function extrudeSelectedEdges(
  obj: SceneObject,
  selection: MeshComponentSelection,
  distance: number,
  direction?: Vec3
): SceneObject & { resultingSelection?: MeshComponentSelection } {
  if (Math.abs(distance) < 1e-8) return cloneSceneObject(obj)
  const selectedEdges = selection.edges
    .map((key) => ({ key, pair: parseEdgeKey(key) }))
    .filter(({ pair: [a,b] }) => a >= 0 && b >= 0 && a < obj.positions.length && b < obj.positions.length && a !== b)
  if (!selectedEdges.length) return cloneSceneObject(obj)

  // Edge islands are joined through vertices, matching Blender's connected edge-region behavior.
  const remaining = new Set(selectedEdges.map((edge) => edge.key))
  const byVertex = new Map<number, string[]>()
  for (const edge of selectedEdges) for (const vi of edge.pair) { const list=byVertex.get(vi)??[];list.push(edge.key);byVertex.set(vi,list) }
  const edgeByKey = new Map(selectedEdges.map((edge) => [edge.key, edge]))
  const islands: typeof selectedEdges[] = []
  while (remaining.size) {
    const first=remaining.values().next().value as string, stack=[first], island: typeof selectedEdges=[]
    remaining.delete(first)
    while(stack.length){const key=stack.pop()!,edge=edgeByKey.get(key);if(!edge)continue;island.push(edge);for(const vi of edge.pair)for(const next of byVertex.get(vi)??[])if(remaining.delete(next))stack.push(next)}
    islands.push(island)
  }

  const positions=obj.positions.map((p)=>({...p})),faces=obj.faces.map((f)=>[...f]),faceColors=[...obj.faceColors]
  const hasUvs=!!obj.uvs?.length&&obj.faceUvIndices?.length===obj.faces.length
  const uvs=obj.uvs?.map((uv)=>({...uv}))??[],faceUvIndices=obj.faceUvIndices?.map((f)=>[...f])??[]
  const faceGroups=obj.faceGroups?.map((g)=>[...g])
  const resultingEdges: string[]=[]

  for(const island of islands){
    const islandVerts=new Set<number>(island.flatMap((edge)=>edge.pair))
    let normalSum:Vec3={x:0,y:0,z:0}
    const adjacentFaces=new Set<number>()
    for(const {pair:[a,b]} of island) for(let fi=0;fi<obj.faces.length;fi++){
      const face=obj.faces[fi]!
      for(let i=0;i<face.length;i++)if((face[i]===a&&face[(i+1)%face.length]===b)||(face[i]===b&&face[(i+1)%face.length]===a)){adjacentFaces.add(fi);break}
    }
    for(const fi of adjacentFaces)normalSum=add3(normalSum,faceAreaNormal(obj,obj.faces[fi]!))
    let normal=direction?normalize3(direction):normalize3(normalSum)
    if(Math.hypot(normal.x,normal.y,normal.z)<1e-8)normal={x:0,y:1,z:0}
    const oldToNew=new Map<number,number>()
    for(const vi of islandVerts){const p=positions[vi]!;oldToNew.set(vi,positions.length);positions.push({x:p.x+normal.x*distance,y:p.y+normal.y*distance,z:p.z+normal.z*distance})}
    for(const {pair:[rawA,rawB]} of island){
      let a=rawA,b=rawB,color=obj.color
      for(const fi of adjacentFaces){const face=obj.faces[fi]!;for(let i=0;i<face.length;i++){const x=face[i]!,y=face[(i+1)%face.length]!;if((x===rawA&&y===rawB)||(x===rawB&&y===rawA)){a=x;b=y;color=obj.faceColors[fi]??obj.color;break}}}
      const na=oldToNew.get(a)!,nb=oldToNew.get(b)!
      // Edge extrude walls are zero-thickness sheets — emit front + reverse so they
      // render and pick from both sides without a separate Make Double Sided step.
      const front=[a,b,nb,na]
      const frontFi=faces.length
      faces.push(front);faceColors.push(color);if(faceGroups)faceGroups.push([frontFi])
      const revFi=faces.length
      faces.push([...front].reverse());faceColors.push(color);if(faceGroups)faceGroups.push([revFi])
      resultingEdges.push(edgeKey(na,nb))
      if(hasUvs){
        const base=uvs.length
        uvs.push({u:0,v:0},{u:1,v:0},{u:1,v:1},{u:0,v:1})
        const frontUv=[base,base+1,base+2,base+3]
        faceUvIndices.push(frontUv,[...frontUv].reverse())
      }
    }
  }
  const tipVertices = [...new Set(resultingEdges.flatMap((key) => parseEdgeKey(key)))]
  return {
    ...obj,positions,faces,faceColors,faceGroups,uvs:hasUvs?uvs:obj.uvs,faceUvIndices:hasUvs?faceUvIndices:obj.faceUvIndices,
    resultingSelection:{objectId:obj.id,vertices:tipVertices,edges:resultingEdges,faces:[]},
  }
}

export function bevelMeshSelection(
  obj: SceneObject,
  selection: MeshComponentSelection,
  mode: SelectionMode,
  width: number,
  segments = 1
): SceneObject {
  const edgeKeys = collectBevelEdges(obj, selection, mode)
  if (edgeKeys.length === 0 || width <= 1e-8) return cloneSceneObject(obj)
  const segmentCount = Math.max(1, Math.min(16, Math.round(segments)))

  const positions = obj.positions.map((p) => ({ ...p }))
  let faces = obj.faces.map((f) => [...f])
  const faceColors = [...obj.faceColors]

  for (const key of edgeKeys) {
    const [a, b] = parseEdgeKey(key)
    if (a >= positions.length || b >= positions.length) continue

    const pa = positions[a]
    const pb = positions[b]
    const adjacentNormals: Vec3[] = []

    for (let fi = 0; fi < faces.length; fi++) {
      const face = faces[fi]
      for (let i = 0; i < face.length; i++) {
        const va = face[i]
        const vb = face[(i + 1) % face.length]
        if ((va === a && vb === b) || (va === b && vb === a)) {
          adjacentNormals.push(
            faceNormal(
              positions[face[0]],
              positions[face[1]],
              positions[face[2] ?? face[0]]
            )
          )
        }
      }
    }

    let bevelDir = { x: 0, y: 1, z: 0 }
    if (adjacentNormals.length > 0) {
      bevelDir = normalize3(
        adjacentNormals.reduce((acc, n) => add3(acc, n), { x: 0, y: 0, z: 0 })
      )
    }

    const bevelVertices: number[] = []
    for (let segment = 1; segment <= segmentCount; segment++) {
      const t = segment / (segmentCount + 1)
      const profile = Math.sin(Math.PI * t)
      bevelVertices.push(positions.length)
      positions.push({
        x: pa.x + (pb.x - pa.x) * t + bevelDir.x * width * profile,
        y: pa.y + (pb.y - pa.y) * t + bevelDir.y * width * profile,
        z: pa.z + (pb.z - pa.z) * t + bevelDir.z * width * profile,
      })
    }

    const newFaces: number[][] = []
    for (let fi = 0; fi < faces.length; fi++) {
      const face = faces[fi]
      let replaced = false
      for (let i = 0; i < face.length; i++) {
        const va = face[i]
        const vb = face[(i + 1) % face.length]
        if (va === a && vb === b) {
          newFaces.push([...face.slice(0, i + 1), ...bevelVertices, ...face.slice(i + 1)])
          replaced = true
          break
        }
        if (va === b && vb === a) {
          newFaces.push([...face.slice(0, i + 1), ...[...bevelVertices].reverse(), ...face.slice(i + 1)])
          replaced = true
          break
        }
      }
      if (!replaced) newFaces.push(face)
    }
    faces = newFaces
  }

  return { ...obj, positions, faces, faceColors }
}

const _pivot = new THREE.Vector3()
const _axis = new THREE.Vector3()

export function rotateMeshSelection(
  obj: SceneObject,
  selection: MeshComponentSelection,
  angleRad: number,
  pivotWorld: Vec3,
  axis: Vec3 = { x: 0, y: 1, z: 0 }
): SceneObject {
  const verts = getAffectedVertices(selection, obj)
  if (verts.size === 0 || Math.abs(angleRad) < 1e-8) return cloneSceneObject(obj)

  const basePositions: Record<number, Vec3> = {}
  for (const vi of verts) basePositions[vi] = { ...obj.positions[vi] }

  _pivot.set(pivotWorld.x, pivotWorld.y, pivotWorld.z)
  _axis.set(axis.x, axis.y, axis.z).normalize()
  const q = new THREE.Quaternion().setFromAxisAngle(_axis, angleRad)

  const positions = transformMeshSelectionWithGizmo(
    obj,
    verts,
    basePositions,
    pivotWorld,
    _pivot.clone(),
    new THREE.Quaternion(),
    new THREE.Vector3(1, 1, 1),
    _pivot.clone(),
    q,
    new THREE.Vector3(1, 1, 1)
  )

  return { ...obj, positions }
}

export function scaleMeshSelection(
  obj: SceneObject,
  selection: MeshComponentSelection,
  factor: number | Vec3,
  pivotWorld: Vec3
): SceneObject {
  const verts = getAffectedVertices(selection, obj)
  const isUniform = typeof factor === 'number'
  const maxFactor = isUniform ? Math.abs((factor as number) - 1) : Math.max(Math.abs((factor as Vec3).x - 1), Math.abs((factor as Vec3).y - 1), Math.abs((factor as Vec3).z - 1))
  if (verts.size === 0 || maxFactor < 1e-8) return cloneSceneObject(obj)

  const basePositions: Record<number, Vec3> = {}
  for (const vi of verts) basePositions[vi] = { ...obj.positions[vi] }

  _pivot.set(pivotWorld.x, pivotWorld.y, pivotWorld.z)
  
  const safeScale = (value: number) => Math.abs(value) < 0.001 ? (value < 0 ? -0.001 : 0.001) : value
  let scaleVec = new THREE.Vector3(1, 1, 1)
  if (isUniform) {
    const s = safeScale(factor as number)
    scaleVec.set(s, s, s)
  } else {
    const v = factor as Vec3
    scaleVec.set(safeScale(v.x), safeScale(v.y), safeScale(v.z))
  }

  const positions = transformMeshSelectionWithGizmo(
    obj,
    verts,
    basePositions,
    pivotWorld,
    _pivot.clone(),
    new THREE.Quaternion(),
    new THREE.Vector3(1, 1, 1),
    _pivot.clone(),
    new THREE.Quaternion(),
    scaleVec
  )

  return { ...obj, positions }
}

export type MeshModalOpKind = 'extrude' | 'rotate' | 'scale' | 'bevel' | 'move' | 'round'

export function roundMeshSelection(
  obj: SceneObject,
  selection: MeshComponentSelection,
  factor: number
): SceneObject {
  const vertices = getAffectedVertices(selection, obj)
  if (vertices.size === 0) return cloneSceneObject(obj)
  const amount = Math.max(0, Math.min(1, factor))
  const indices = [...vertices]
  const center = indices.reduce(
    (sum, index) => {
      const p = obj.positions[index]!
      return { x: sum.x + p.x, y: sum.y + p.y, z: sum.z + p.z }
    },
    { x: 0, y: 0, z: 0 }
  )
  center.x /= indices.length
  center.y /= indices.length
  center.z /= indices.length

  const radii = indices.map((index) => {
    const p = obj.positions[index]!
    return Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z)
  })
  const targetRadius = radii.reduce((sum, radius) => sum + radius, 0) / radii.length
  if (targetRadius < 1e-8) return cloneSceneObject(obj)

  const positions = obj.positions.map((p) => ({ ...p }))
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i]!
    const p = obj.positions[index]!
    const radius = radii[i]!
    if (radius < 1e-8) continue
    const target = {
      x: center.x + ((p.x - center.x) / radius) * targetRadius,
      y: center.y + ((p.y - center.y) / radius) * targetRadius,
      z: center.z + ((p.z - center.z) / radius) * targetRadius,
    }
    positions[index] = {
      x: p.x + (target.x - p.x) * amount,
      y: p.y + (target.y - p.y) * amount,
      z: p.z + (target.z - p.z) * amount,
    }
  }
  return { ...obj, positions, smoothShading: amount > 0 ? true : obj.smoothShading }
}

export function moveMeshSelection(
  obj: SceneObject,
  selection: MeshComponentSelection,
  _value: number,
  deltaWorldX: number,
  deltaWorldY: number,
  axisLock: 'x' | 'y' | 'z' | null | undefined,
  view: string = 'perspective'
): SceneObject {
  const verts = getAffectedVertices(selection, obj)
  if (verts.size === 0) return cloneSceneObject(obj)

  const positions = obj.positions.map((p) => ({ ...p }))
  let dx = 0, dy = 0, dz = 0

  if (axisLock === 'x') {
    dx = deltaWorldX + deltaWorldY
  } else if (axisLock === 'y') {
    dy = deltaWorldX + deltaWorldY
  } else if (axisLock === 'z') {
    dz = deltaWorldX + deltaWorldY
  } else {
    // Smart view defaults
    if (view === 'front') {
      dx = deltaWorldX
      dy = deltaWorldY
    } else if (view === 'top') {
      dx = deltaWorldX
      dz = deltaWorldY
    } else if (view === 'right') {
      dz = deltaWorldX
      dy = deltaWorldY
    } else {
      dx = deltaWorldX
      dy = deltaWorldY
    }
  }

  for (const vi of verts) {
    positions[vi].x += dx
    positions[vi].y += dy
    positions[vi].z += dz
  }

  return { ...obj, positions }
}

function extrudeDirectionForAxisLock(
  axisLock?: 'x' | 'y' | 'z' | null
): Vec3 | undefined {
  if (axisLock === 'x') return { x: 1, y: 0, z: 0 }
  if (axisLock === 'y') return { x: 0, y: 1, z: 0 }
  if (axisLock === 'z') return { x: 0, y: 0, z: 1 }
  return undefined
}

export function applyMeshModalOp(
  baseObject: SceneObject,
  selection: MeshComponentSelection,
  selectionMode: SelectionMode,
  op: MeshModalOpKind,
  value: number,
  pivotWorld: Vec3,
  deltaWorldX: number = 0,
  deltaWorldY: number = 0,
  axisLock?: 'x' | 'y' | 'z' | null,
  view: string = 'perspective',
  bevelSegments = 1
): SceneObject & { resultingSelection?: MeshComponentSelection } {
  switch (op) {
    case 'extrude':
      return extrudeMeshSelection(
        baseObject,
        selection,
        selectionMode,
        value,
        extrudeDirectionForAxisLock(axisLock)
      )
    case 'bevel':
      return bevelMeshSelection(baseObject, selection, selectionMode, value, bevelSegments)
    case 'rotate': {
      let ax: Vec3 = { x: 0, y: 1, z: 0 }
      if (axisLock === 'x') ax = { x: 1, y: 0, z: 0 }
      else if (axisLock === 'y') ax = { x: 0, y: 1, z: 0 }
      else if (axisLock === 'z') ax = { x: 0, y: 0, z: 1 }
      else {
        if (view === 'front') ax = { x: 0, y: 0, z: 1 }
        else if (view === 'right') ax = { x: 1, y: 0, z: 0 }
        else if (view === 'top') ax = { x: 0, y: 1, z: 0 }
      }
      return rotateMeshSelection(baseObject, selection, value, pivotWorld, ax)
    }
    case 'scale': {
      let scaleVec: Vec3 | number = value
      if (axisLock) {
        scaleVec = {
          x: axisLock === 'y' || axisLock === 'z' ? 1 : value,
          y: axisLock === 'x' || axisLock === 'z' ? 1 : value,
          z: axisLock === 'x' || axisLock === 'y' ? 1 : value,
        }
      } else {
        if (view === 'front') scaleVec = { x: value, y: value, z: 1 }
        else if (view === 'top') scaleVec = { x: value, y: 1, z: value }
        else if (view === 'right') scaleVec = { x: 1, y: value, z: value }
      }
      return scaleMeshSelection(baseObject, selection, scaleVec, pivotWorld)
    }
    case 'move':
      return moveMeshSelection(baseObject, selection, value, deltaWorldX, deltaWorldY, axisLock, view)
    case 'round':
      return roundMeshSelection(baseObject, selection, value)
  }
}

function mergeResultingSelections(
  objectId: string,
  a?: MeshComponentSelection,
  b?: MeshComponentSelection
): MeshComponentSelection | undefined {
  if (!a && !b) return undefined
  return {
    objectId,
    vertices: [...new Set([...(a?.vertices ?? []), ...(b?.vertices ?? [])])],
    edges: [...new Set([...(a?.edges ?? []), ...(b?.edges ?? [])])],
    faces: [...new Set([...(a?.faces ?? []), ...(b?.faces ?? [])])],
  }
}

/** Mesh modal op with bilateral symmetry for extrude/bevel/transform. */
export function applyMeshModalOpWithSymmetry(
  baseObject: SceneObject,
  selection: MeshComponentSelection,
  selectionMode: SelectionMode,
  op: MeshModalOpKind,
  value: number,
  pivotWorld: Vec3,
  deltaWorldX: number = 0,
  deltaWorldY: number = 0,
  axisLock?: 'x' | 'y' | 'z' | null,
  view: string = 'perspective',
  bevelSegments = 1,
  symmetry?: MeshSymmetryPlane | null
): SceneObject & { resultingSelection?: MeshComponentSelection } {
  if (!symmetry?.enabled) {
    return applyMeshModalOp(
      baseObject,
      selection,
      selectionMode,
      op,
      value,
      pivotWorld,
      deltaWorldX,
      deltaWorldY,
      axisLock,
      view,
      bevelSegments
    )
  }

  const { axis, plane } = symmetry

  if (op === 'extrude' || op === 'bevel') {
    const direction = extrudeDirectionForAxisLock(axisLock)
    if (op === 'extrude' && direction) {
      const mirrored = mirrorMeshSelection(baseObject, selection, axis, plane)
      const primary = extrudeMeshSelection(
        baseObject,
        selection,
        selectionMode,
        value,
        direction
      )
      if (!selectionHasComponents(mirrored)) return primary
      const mirrorDir = mirrorWorldDirection(direction, axis)
      const secondary = extrudeMeshSelection(
        primary,
        mirrored,
        selectionMode,
        value,
        mirrorDir
      )
      return {
        ...secondary,
        resultingSelection: mergeResultingSelections(
          baseObject.id,
          primary.resultingSelection,
          secondary.resultingSelection
        ),
      }
    }

    const expanded = expandMeshSelectionWithSymmetry(baseObject, selection, axis, plane)
    return applyMeshModalOp(
      baseObject,
      expanded,
      selectionMode,
      op,
      value,
      pivotWorld,
      deltaWorldX,
      deltaWorldY,
      axisLock,
      view,
      bevelSegments
    )
  }

  const primary = applyMeshModalOp(
    baseObject,
    selection,
    selectionMode,
    op,
    value,
    pivotWorld,
    deltaWorldX,
    deltaWorldY,
    axisLock,
    view,
    bevelSegments
  )
  const primaryVerts = getAffectedVertices(selection, baseObject)
  return {
    ...primary,
    positions: propagateSymmetricVertexPositions(
      baseObject,
      primaryVerts,
      primary.positions,
      axis,
      plane
    ),
  }
}

export function extrudeValueFromScreenDelta(
  dx: number,
  dyUp: number,
  sensitivity = 0.04
): number {
  return (dyUp + dx) * sensitivity
}

export function modalValueFromMouseDelta(
  op: MeshModalOpKind,
  dx: number,
  dy: number,
  shiftKey = false
): number {
  const sensitivityScale = shiftKey ? 0.15 : 1.0
  switch (op) {
    case 'extrude':
      return extrudeValueFromScreenDelta(dx, dy, 0.15 * sensitivityScale)
    case 'bevel':
      return Math.hypot(dx, dy) * 0.04 * sensitivityScale
    case 'rotate':
      return dx * 0.02 * sensitivityScale
    case 'scale':
      const dyScaled = dy * 0.015 * sensitivityScale
      return Math.max(0.01, 1 + dyScaled)
    case 'move':
      return 0
    case 'round':
      return Math.max(0, Math.min(1, Math.hypot(dx, dy) * 0.005 * sensitivityScale))
  }
}

export function modalValueFromWheel(
  op: MeshModalOpKind,
  current: number,
  deltaY: number
): number {
  const step = deltaY > 0 ? -1 : 1
  switch (op) {
    case 'extrude':
      return current + step * 0.4
    case 'bevel':
      return current + step * 0.2
    case 'rotate':
      return current + step * 0.08
    case 'scale':
      return Math.max(0.01, current + step * 0.05)
    case 'move':
      return current + step * 0.1
    case 'round':
      return Math.max(0, Math.min(1, current + step * 0.05))
  }
}

export function formatModalValue(op: MeshModalOpKind, value: number): string {
  switch (op) {
    case 'extrude':
      return value.toFixed(2)
    case 'bevel':
      return value.toFixed(3)
    case 'rotate':
      return `${((value * 180) / Math.PI).toFixed(1)}°`
    case 'scale':
      return value.toFixed(3)
    case 'move':
      return value.toFixed(3)
    case 'round':
      return `${Math.round(value * 100)}%`
  }
}
