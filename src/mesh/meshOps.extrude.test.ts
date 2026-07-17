import { describe, expect, it } from 'vitest'
import type { SceneObject } from './HalfEdgeMesh'
import {
  applyMeshModalOp,
  bevelMeshSelection,
  extrudeMeshSelection,
  modalValueFromMouseDelta,
  roundMeshSelection,
} from './meshOps'

function object(positions: SceneObject['positions'], faces: number[][]): SceneObject {
  return {
    id:'mesh',name:'Mesh',positions,faces,faceColors:faces.map(()=>0xabcdef),topologyLocked:false,
    polyBudget:128,polyBudgetMode:'adaptive',smoothShading:false,facetExaggeration:0,color:0xabcdef,
  }
}

describe('Blender-style face region extrusion',()=>{
  it('replaces the selected caps and creates walls only on the outside boundary',()=>{
    const source=object([
      {x:0,y:0,z:0},{x:1,y:0,z:0},{x:2,y:0,z:0},
      {x:0,y:1,z:0},{x:1,y:1,z:0},{x:2,y:1,z:0},
    ],[[0,1,4,3],[1,2,5,4]])
    source.uvs=[{u:0,v:0},{u:.5,v:0},{u:1,v:0},{u:0,v:1},{u:.5,v:1},{u:1,v:1}]
    source.faceUvIndices=[[0,1,4,3],[1,2,5,4]]
    const result=extrudeMeshSelection(source,{objectId:'mesh',vertices:[],edges:[],faces:[0,1]},'face',2)
    expect(result.positions).toHaveLength(12)
    expect(result.faces).toHaveLength(8)
    expect(result.faces[0].every((vi)=>vi>=6)).toBe(true)
    expect(result.faces[1].every((vi)=>vi>=6)).toBe(true)
    expect(result.faces.filter((face)=>face.includes(1)&&face.includes(4))).toHaveLength(0)
    expect(result.faceUvIndices).toHaveLength(result.faces.length)
    for(const vi of result.faces[0]) expect(result.positions[vi]!.z).toBeCloseTo(2)
  })

  it('extrudes disconnected face islands along their own region normals',()=>{
    const source=object([
      {x:0,y:0,z:0},{x:1,y:0,z:0},{x:1,y:1,z:0},{x:0,y:1,z:0},
      {x:3,y:0,z:0},{x:3,y:1,z:0},{x:3,y:1,z:1},{x:3,y:0,z:1},
    ],[[0,1,2,3],[4,5,6,7]])
    const result=extrudeMeshSelection(source,{objectId:'mesh',vertices:[],edges:[],faces:[0,1]},'face',1)
    expect(result.faces).toHaveLength(10)
    const firstCap=result.faces[0].map((vi)=>result.positions[vi]!)
    const secondCap=result.faces[1].map((vi)=>result.positions[vi]!)
    expect(firstCap.every((p)=>Math.abs(p.z)===1)).toBe(true)
    expect(secondCap.every((p)=>Math.abs(p.x-3)===1)).toBe(true)
  })
})

describe('Blender-style component transforms',()=>{
  const source=object([{x:-1,y:0,z:0},{x:1,y:0,z:0},{x:1,y:2,z:0},{x:-1,y:2,z:0}],[[0,1,2,3]])
  it('scales an edge around the selection pivot and honors an axis constraint',()=>{
    const result=applyMeshModalOp(source,{objectId:'mesh',vertices:[],edges:['0-1'],faces:[]},'edge','scale',2,{x:0,y:0,z:0},0,0,'x','front')
    expect(result.positions[0]).toEqual({x:-2,y:0,z:0})
    expect(result.positions[1]).toEqual({x:2,y:0,z:0})
    expect(result.positions[2]).toEqual(source.positions[2])
  })
  it('rotates a face around the active view axis',()=>{
    const result=applyMeshModalOp(source,{objectId:'mesh',vertices:[],edges:[],faces:[0]},'face','rotate',Math.PI/2,{x:0,y:0,z:0},0,0,null,'front')
    expect(result.positions[0]!.x).toBeCloseTo(1)
    expect(result.positions[0]!.y).toBeCloseTo(0)
    expect(result.positions[2]!.x).toBeCloseTo(-1)
    expect(result.positions[2]!.y).toBeCloseTo(2)
  })
  it('allows a negative typed scale for mirroring',()=>{
    const result=applyMeshModalOp(source,{objectId:'mesh',vertices:[],edges:['0-1'],faces:[]},'edge','scale',-1,{x:0,y:0,z:0})
    expect(result.positions[0]!.x).toBeCloseTo(1)
    expect(result.positions[1]!.x).toBeCloseTo(-1)
  })
})

describe('Blender-style bevel modal', () => {
  it('uses pointer distance for width in any screen direction', () => {
    expect(modalValueFromMouseDelta('bevel', 25, 0)).toBeCloseTo(1)
    expect(modalValueFromMouseDelta('bevel', 0, 25)).toBeCloseTo(1)
    expect(modalValueFromMouseDelta('bevel', 25, 0, true)).toBeCloseTo(0.15)
  })

  it('adds the requested rounded profile segments to both sides of an edge', () => {
    const source = object(
      [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
      [[0, 1, 2], [1, 0, 3]]
    )
    const result = bevelMeshSelection(
      source,
      { objectId: 'mesh', vertices: [], edges: ['0-1'], faces: [] },
      'edge',
      0.25,
      3
    )

    expect(result.positions).toHaveLength(source.positions.length + 3)
    expect(result.faces[0]).toHaveLength(6)
    expect(result.faces[1]).toHaveLength(6)
    expect(result.faces[1]!.slice(1, 4)).toEqual([...result.faces[0]!.slice(1, 4)].reverse())
  })
})

describe('Rounded To Sphere', () => {
  const source = object(
    [
      { x: -3, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 2, z: 0 },
      { x: 0, y: 0, z: 5 },
      { x: 20, y: 20, z: 20 },
    ],
    [[0, 1, 2, 3]]
  )
  const selection = { objectId: 'mesh', vertices: [0, 1, 2, 3], edges: [], faces: [] }

  it('blends selected vertices to one common radius at full strength', () => {
    const result = roundMeshSelection(source, selection, 1)
    const center = source.positions.slice(0, 4).reduce(
      (sum, p) => ({ x: sum.x + p.x / 4, y: sum.y + p.y / 4, z: sum.z + p.z / 4 }),
      { x: 0, y: 0, z: 0 }
    )
    const radii = result.positions.slice(0, 4).map((p) =>
      Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z)
    )
    for (const radius of radii.slice(1)) expect(radius).toBeCloseTo(radii[0]!, 5)
    expect(result.positions[4]).toEqual(source.positions[4])
    expect(result.smoothShading).toBe(true)
  })

  it('preserves the original geometry at zero strength', () => {
    const result = roundMeshSelection(source, selection, 0)
    expect(result.positions).toEqual(source.positions)
  })

  it('maps mouse distance to a clamped 0-100% strength', () => {
    expect(modalValueFromMouseDelta('round', 100, 0)).toBeCloseTo(0.5)
    expect(modalValueFromMouseDelta('round', 300, 0)).toBe(1)
    expect(modalValueFromMouseDelta('round', 100, 0, true)).toBeCloseTo(0.075)
  })
})

describe('Blender-style edge extrusion',()=>{
  it('duplicates a boundary edge, bridges it with a double-sided quad, and selects the new edge',()=>{
    const source=object([{x:0,y:0,z:0},{x:2,y:0,z:0},{x:2,y:2,z:0},{x:0,y:2,z:0}],[[0,1,2,3]])
    source.uvs=[{u:0,v:0},{u:1,v:0},{u:1,v:1},{u:0,v:1}]
    source.faceUvIndices=[[0,1,2,3]]
    const result=extrudeMeshSelection(source,{objectId:'mesh',vertices:[],edges:['0-1'],faces:[]},'edge',1)
    expect(result.positions).toHaveLength(6)
    expect(result.faces).toEqual([[0,1,2,3],[0,1,5,4],[4,5,1,0]])
    expect(result.resultingSelection?.edges).toEqual(['4-5'])
    expect(result.resultingSelection?.vertices.sort((a, b) => a - b)).toEqual([4, 5])
    expect(result.faceUvIndices).toHaveLength(3)
    expect(result.faceUvIndices?.[2]).toEqual([...(result.faceUvIndices?.[1] ?? [])].reverse())
  })
  it('extrudes a connected edge chain without changing its neighboring face',()=>{
    const source=object([{x:0,y:0,z:0},{x:1,y:0,z:0},{x:2,y:0,z:0},{x:2,y:1,z:0},{x:0,y:1,z:0}],[[0,1,2,3,4]])
    const result=extrudeMeshSelection(source,{objectId:'mesh',vertices:[],edges:['0-1','1-2'],faces:[]},'edge',2)
    expect(result.positions).toHaveLength(8)
    expect(result.faces).toHaveLength(5)
    expect(result.faces[0]).toEqual(source.faces[0])
    expect(result.resultingSelection?.edges).toHaveLength(2)
  })
  it('honors a global axis constraint during edge extrusion',()=>{
    const source=object([{x:0,y:0,z:0},{x:1,y:0,z:0},{x:1,y:1,z:0}],[[0,1,2]])
    const result=applyMeshModalOp(source,{objectId:'mesh',vertices:[],edges:['0-1'],faces:[]},'edge','extrude',3,{x:0,y:0,z:0},0,0,'y','front')
    const newEdge=result.resultingSelection!.edges[0]!.split('-').map(Number)
    expect(newEdge.map((vi)=>result.positions[vi]!.y)).toEqual([3,3])
    expect(newEdge.map((vi)=>result.positions[vi]!.z)).toEqual([0,0])
  })
})
