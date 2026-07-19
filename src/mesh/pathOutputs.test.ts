import { describe, expect, it } from 'vitest'
import { generatePathOutput, type PathOutput, type PathOutputSettings } from './pathOutputs'
import { assignFullImageCardUVs, ensureObjectUVs } from '../uv/uvObject'
import { HalfEdgeMesh } from './HalfEdgeMesh'

const path = [{x:0,y:0},{x:20,y:8},{x:45,y:-4},{x:70,y:12}]
const base: PathOutputSettings = {
  output:'tube', radius:3, startScale:1, endScale:.5, twist:360, spacing:12, offset:0,
  radialSegments:8, startCap:'flat', endCap:'round', ribbonStartTip:'square', ribbonEndTip:'pointed',
  ribbonTaper:.25, ribbonFlat:false, profile:'round', profileWidth:1, profileHeight:.7,
  chainAlternating:true, cardCrossed:false,
}

describe('procedural path outputs',()=>{
  for(const output of ['tube','ribbon','chain','vine','rope','cards','object-array','profile-sweep'] as PathOutput[]){
    it(`generates editable ${output} geometry`,()=>{
      const mesh=generatePathOutput(path,{...base,output},0x6ecbf5)
      expect(mesh.positions.length).toBeGreaterThan(0)
      expect(mesh.faces.length).toBeGreaterThan(0)
      expect(mesh.faceColors.length).toBe(mesh.faces.length)
      expect(mesh.uvs.length).toBeGreaterThan(0)
      expect(mesh.faceUvIndices.length).toBe(mesh.faces.length)
    })
  }
  it('crossed cards and alternating chain settings change generated geometry',()=>{
    const single=generatePathOutput(path,{...base,output:'cards',cardCrossed:false},0)
    const crossed=generatePathOutput(path,{...base,output:'cards',cardCrossed:true},0)
    expect(crossed.faces.length).toBe(single.faces.length*2)
    const plain=generatePathOutput(path,{...base,output:'chain',chainAlternating:false},0)
    const alternating=generatePathOutput(path,{...base,output:'chain',chainAlternating:true},0)
    expect(alternating.positions).not.toEqual(plain.positions)
  })
  it('twists rope as a true three-strand 3D helix',()=>{
    const straight=[{x:0,y:0},{x:25,y:0},{x:50,y:0},{x:75,y:0},{x:100,y:0}]
    const mesh=generatePathOutput(straight,{...base,output:'rope',startScale:1,endScale:1,twist:360,startCap:'flat',endCap:'flat'},0)
    const ringSegments=Math.max(5,base.radialSegments-2)
    const centerZ=(ring:number)=>{
      const vertices=mesh.positions.slice(ring*ringSegments,(ring+1)*ringSegments)
      return vertices.reduce((sum,p)=>sum+p.z,0)/vertices.length
    }
    expect(Math.abs(centerZ(1))).toBeGreaterThan(base.radius*.2)
    expect(Math.abs(centerZ(1)-centerZ(2))).toBeGreaterThan(base.radius*.2)
    expect(Math.max(...mesh.positions.map((p)=>p.z))-Math.min(...mesh.positions.map((p)=>p.z))).toBeGreaterThan(base.radius*1.5)
    expect(mesh.faceUvIndices.length).toBe(mesh.faces.length)
  })
  it('keeps chain links outward-mapped, path-aligned, and interlocked',()=>{
    const straight=[{x:0,y:0},{x:100,y:0}]
    const mesh=generatePathOutput(straight,{...base,output:'chain',startScale:1,endScale:1,spacing:40,chainAlternating:true},0)
    const around=Math.max(12,Math.min(20,Math.round(base.radialSegments)*2))
    const tube=Math.max(6,Math.min(10,Math.round(base.radialSegments)))
    const vertsPerLink=around*tube
    expect(mesh.positions.length).toBeGreaterThanOrEqual(vertsPerLink*2)
    const first=mesh.positions.slice(0,vertsPerLink)
    const second=mesh.positions.slice(vertsPerLink,vertsPerLink*2)
    const spanX=Math.max(...first.map((p)=>p.x))-Math.min(...first.map((p)=>p.x))
    const spanY=Math.max(...first.map((p)=>p.y))-Math.min(...first.map((p)=>p.y))
    expect(spanX).toBeGreaterThan(spanY)
    const centerX=(points: typeof first)=>points.reduce((sum,p)=>sum+p.x,0)/points.length
    expect(Math.abs(centerX(second)-centerX(first))).toBeLessThan(spanX)
    expect(Math.max(...second.map((p)=>p.z))-Math.min(...second.map((p)=>p.z))).toBeGreaterThan(1)
    for(const faceUv of mesh.faceUvIndices){
      const uv=faceUv.map((i)=>mesh.uvs[i]!)
      expect(Math.max(...uv.map((p)=>p.u))-Math.min(...uv.map((p)=>p.u))).toBeLessThanOrEqual(1/around+1e-6)
      expect(Math.max(...uv.map((p)=>p.v))-Math.min(...uv.map((p)=>p.v))).toBeLessThanOrEqual(1/tube+1e-6)
    }
    // First link lies flat, centered at the beginning of the sampled path.
    // Its face normals must point away from the elliptical torus core.
    const center={x:centerX(first),y:first.reduce((sum,p)=>sum+p.y,0)/first.length}
    const major=base.radius*1.35
    for(const face of mesh.faces.slice(0,around*tube)){
      const a=mesh.positions[face[0]!]!,b=mesh.positions[face[1]!]!,c=mesh.positions[face[2]!]!
      const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z
      const normal={x:uy*vz-uz*vy,y:uz*vx-ux*vz,z:ux*vy-uy*vx}
      const point={x:(a.x+b.x+c.x)/3-center.x,y:(a.y+b.y+c.y)/3-center.y,z:(a.z+b.z+c.z)/3}
      const angle=Math.atan2(point.y/.72,point.x)
      const outward={x:point.x-major*Math.cos(angle),y:point.y-major*.72*Math.sin(angle),z:point.z}
      expect(normal.x*outward.x+normal.y*outward.y+normal.z*outward.z).toBeGreaterThan(0)
    }
  })
  it('builds elongated cards with vertical full-image UVs on both sides',()=>{
    const mesh=generatePathOutput(path,{...base,output:'cards',distributionMode:'count',count:1,profileWidth:1,profileHeight:1},0)
    const xs=mesh.positions.map((p)=>p.x), ys=mesh.positions.map((p)=>p.y)
    expect(Math.max(...xs)-Math.min(...xs)).toBeGreaterThan(Math.max(...ys)-Math.min(...ys))
    expect(Math.min(...mesh.uvs.map((uv)=>uv.u))).toBe(0)
    expect(Math.max(...mesh.uvs.map((uv)=>uv.u))).toBe(1)
    expect(Math.min(...mesh.uvs.map((uv)=>uv.v))).toBe(0)
    expect(Math.max(...mesh.uvs.map((uv)=>uv.v))).toBe(1)
    expect(mesh.faces.length).toBe(2)
    expect(mesh.faceUvIndices[0]!.map((index)=>mesh.uvs[index]!)).toEqual([
      {u:0,v:0},{u:0,v:1},{u:1,v:1},{u:1,v:0},
    ])
    expect(mesh.faceUvIndices[1]!.map((index)=>mesh.uvs[index]!)).toEqual([
      {u:1,v:0},{u:0,v:0},{u:0,v:1},{u:1,v:1},
    ])
    for(const faceUv of mesh.faceUvIndices){
      const uv=faceUv.map((index)=>mesh.uvs[index]!)
      expect(new Set(uv.map((point)=>point.u))).toEqual(new Set([0,1]))
      expect(new Set(uv.map((point)=>point.v))).toEqual(new Set([0,1]))
    }
  })
  it('preserves intentional full-image overlap instead of atlas-packing cards',()=>{
    const mesh=generatePathOutput(path,{...base,output:'cards',distributionMode:'count',count:4},0)
    const baseObject=mesh.toObject('cards','Cards')
    const object=assignFullImageCardUVs({
      ...baseObject,
      sketchSource:{kind:'path',pathOutput:'cards'} as any,
    })
    const ensured=ensureObjectUVs(object)
    for(const faceUv of ensured.faceUvIndices){
      const uv=faceUv.map((index)=>ensured.uvs[index]!)
      expect(Math.min(...uv.map((point)=>point.u))).toBe(0)
      expect(Math.max(...uv.map((point)=>point.u))).toBe(1)
      expect(Math.min(...uv.map((point)=>point.v))).toBe(0)
      expect(Math.max(...uv.map((point)=>point.v))).toBe(1)
    }
  })
  it('supports exact counts, padding, and seeded randomization',()=>{
    const settings={...base,output:'object-array' as const,distributionMode:'count' as const,count:5,startPadding:4,endPadding:6,randomScale:.4,randomRotation:45,seed:77}
    const first=generatePathOutput(path,settings,0)
    const same=generatePathOutput(path,settings,0)
    const changed=generatePathOutput(path,{...settings,seed:78},0)
    expect(first.faces.length).toBe(5*6)
    expect(first.positions).toEqual(same.positions)
    expect(first.positions).not.toEqual(changed.positions)
  })
  it('instances the chosen scene mesh instead of the Object Array placeholder',()=>{
    const source=new HalfEdgeMesh()
    source.positions=[{x:-2,y:-1,z:0},{x:2,y:-1,z:0},{x:0,y:3,z:0}]
    source.faces=[[0,1,2]]
    source.faceColors=[0xff00ff]
    source.uvs=[{u:0,v:0},{u:1,v:0},{u:.5,v:1}]
    source.faceUvIndices=[[0,1,2]]
    source.buildHalfEdges()
    const mesh=generatePathOutput(path,{
      ...base, output:'object-array', distributionMode:'count', count:4,
      sourceObject:source.toObject('source','Triangle'),
    },0)
    expect(mesh.positions.length).toBe(4*3)
    expect(mesh.faces.length).toBe(4)
    expect(mesh.faceColors).toEqual([0xff00ff,0xff00ff,0xff00ff,0xff00ff])
    expect(mesh.faceUvIndices.length).toBe(4)
  })
})
