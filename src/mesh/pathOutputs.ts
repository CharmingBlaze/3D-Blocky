import { HalfEdgeMesh, type SceneObject } from './HalfEdgeMesh'
import { generateCapsuleSweep, generateCapsuleSweep3D, generateTaperedPointedTube, type SweepCapStyle } from './extrusion'
import { generateHairRibbon, type HairTipStyle } from './hairRibbon'
import type { Vec2 } from '../utils/math'
import { ensurePositiveVolume } from './meshWinding'

export type PathOutput = 'tube' | 'ribbon' | 'chain' | 'vine' | 'rope' | 'cards' | 'object-array' | 'profile-sweep'
export type PathProfile = 'round' | 'square' | 'rectangle' | 'rail'
export type PathDistributionMode = 'spacing' | 'count' | 'fit'

export interface PathOutputSettings {
  output: PathOutput
  radius: number
  startScale: number
  endScale: number
  twist: number
  spacing: number
  offset: number
  radialSegments: number
  startCap: SweepCapStyle
  endCap: SweepCapStyle
  ribbonStartTip: HairTipStyle
  ribbonEndTip: HairTipStyle
  ribbonTaper: number
  ribbonFlat: boolean
  profile: PathProfile
  profileWidth: number
  profileHeight: number
  chainAlternating: boolean
  cardCrossed: boolean
  sourceObject?: SceneObject | null
  distributionMode?: PathDistributionMode
  count?: number
  startPadding?: number
  endPadding?: number
  randomScale?: number
  rotation?: number
  randomRotation?: number
  alternateRotation?: boolean
  mirrorAlternate?: boolean
  seed?: number
}

function tangent(path: Vec2[], i: number): Vec2 {
  const a = path[Math.max(0, i - 1)]!
  const b = path[Math.min(path.length - 1, i + 1)]!
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: dx / len, y: dy / len }
}

function mergeOutputMeshes(meshes: HalfEdgeMesh[], color: number): HalfEdgeMesh {
  const out = new HalfEdgeMesh()
  for (const mesh of meshes) {
    const vertexBase = out.positions.length
    const uvBase = out.uvs.length
    out.positions.push(...mesh.positions.map((p) => ({ ...p })))
    out.uvs.push(...mesh.uvs.map((uv) => ({ ...uv })))
    mesh.faces.forEach((face, fi) => {
      out.faces.push(face.map((vi) => vi + vertexBase))
      out.faceColors.push(mesh.faceColors[fi] ?? color)
      const faceUv = mesh.faceUvIndices[fi]
      if (faceUv) out.faceUvIndices.push(faceUv.map((ui) => ui + uvBase))
      else if (out.uvs.length > 0) out.faceUvIndices.push(face.map(() => uvBase))
    })
  }
  out.buildHalfEdges()
  return out
}

function seededRandom(seed: number): () => number {
  let state = (Math.floor(seed) || 1) >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function samplePath(path: Vec2[], settings: PathOutputSettings): Array<{ p: Vec2; t: Vec2; u: number }> {
  if (path.length < 2) return []
  const lengths = [0]
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y))
  const total = lengths[lengths.length - 1]!
  const start = Math.max(0, Math.min(total, settings.startPadding ?? 0))
  const end = Math.max(start, total - Math.max(0, settings.endPadding ?? 0))
  const usable = Math.max(0, end - start)
  const requested = Math.max(1, Math.round(settings.count ?? 8))
  const mode = settings.distributionMode ?? 'spacing'
  const count = mode === 'count' ? requested : Math.max(1, Math.floor(usable / Math.max(1, settings.spacing)) + (mode === 'fit' ? 0 : 1))
  const out: Array<{ p: Vec2; t: Vec2; u: number }> = []
  for (let k = 0; k < count; k++) {
    const d = count === 1 ? start + usable / 2 : start + usable * (k / Math.max(1, count - 1))
    let i = 1
    while (i < lengths.length - 1 && lengths[i]! < d) i++
    const a = path[i - 1]!
    const b = path[i]!
    const span = Math.max(1e-6, lengths[i]! - lengths[i - 1]!)
    const f = (d - lengths[i - 1]!) / span
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    out.push({ p: { x: a.x + dx * f, y: a.y + dy * f }, t: { x: dx / len, y: dy / len }, u: total > 0 ? d / total : 0 })
  }
  return out
}

function transformCopy(source: HalfEdgeMesh, p: Vec2, angle: number, scale: number, roll = 0, mirror = false): HalfEdgeMesh {
  const out = new HalfEdgeMesh()
  const c = Math.cos(angle), s = Math.sin(angle), cr = Math.cos(roll), sr = Math.sin(roll)
  out.positions = source.positions.map((v) => {
    const x0 = v.x * scale * (mirror ? -1 : 1), y0 = v.y * scale, z0 = v.z * scale
    const y1 = y0 * cr - z0 * sr, z1 = y0 * sr + z0 * cr
    return { x: p.x + x0 * c - y1 * s, y: p.y + x0 * s + y1 * c, z: z1 }
  })
  out.faces = source.faces.map((f) => [...f])
  out.faceColors = [...source.faceColors]
  out.uvs = source.uvs.map((uv) => ({ ...uv }))
  out.faceUvIndices = source.faceUvIndices.map((f) => [...f])
  out.buildHalfEdges()
  return out
}

function makeBox(width: number, height: number, depth: number, color: number): HalfEdgeMesh {
  const m = new HalfEdgeMesh(), x = width / 2, y = height / 2, z = depth / 2
  m.positions = [
    { x: -x, y: -y, z: -z }, { x, y: -y, z: -z }, { x, y, z: -z }, { x: -x, y, z: -z },
    { x: -x, y: -y, z }, { x, y: -y, z }, { x, y, z }, { x: -x, y, z },
  ]
  m.faces = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]
  m.faceColors = m.faces.map(() => color)
  // A predictable per-face atlas keeps the fallback object texture-ready.
  m.uvs = [
    {u:0,v:1},{u:1,v:1},{u:1,v:0},{u:0,v:0},
  ]
  m.faceUvIndices = m.faces.map(() => [0,1,2,3])
  m.buildHalfEdges(); return m
}

/** A path-aligned image card. Local X follows the path and local Y is the
 * card's upright axis. UVs use normal image orientation. The reverse face has
 * opposite U handedness so it reads identically instead of mirrored. */
function makeCard(width: number, length: number, color: number): HalfEdgeMesh {
  const m = new HalfEdgeMesh(), x = length / 2, y = width / 2
  m.positions = [{x:-x,y:-y,z:0},{x:-x,y:y,z:0},{x:x,y:y,z:0},{x:x,y:-y,z:0}]
  m.faces = [[0,1,2,3],[0,3,2,1]]; m.faceColors = [color,color]
  m.uvs = [{u:0,v:0},{u:0,v:1},{u:1,v:1},{u:1,v:0}]
  m.faceUvIndices = [[0,1,2,3],[3,0,1,2]]; m.buildHalfEdges(); return m
}

function makeLink(major: number, minor: number, color: number, detail: number): HalfEdgeMesh {
  const m = new HalfEdgeMesh()
  // Two independent loops keep topology regular: more segments around the
  // link silhouette, fewer around the metal cross-section.
  const around = Math.max(12, Math.min(20, Math.round(detail) * 2))
  const tube = Math.max(6, Math.min(10, Math.round(detail)))
  for (let i=0;i<around;i++) for (let j=0;j<tube;j++) {
    const a=i/around*Math.PI*2, b=j/tube*Math.PI*2
    m.positions.push({x:Math.cos(a)*(major+minor*Math.cos(b)),y:Math.sin(a)*(major*.72+minor*Math.cos(b)),z:minor*Math.sin(b)})
  }
  for (let i=0;i<around;i++) for (let j=0;j<tube;j++) {
    const n=(i+1)%around, q=(j+1)%tube
    m.faces.push([i*tube+j,n*tube+j,n*tube+q,i*tube+q]); m.faceColors.push(color)
    // Face-local UV corners keep both torus seams continuous (the final cells
    // end at 1 instead of jumping backward to 0). Winding follows dMajor ×
    // dTube, so the textured side and normals face away from the link core.
    const u0=i/around,u1=(i+1)/around,v0=j/tube,v1=(j+1)/tube
    const uvBase=m.uvs.length
    m.uvs.push({u:u0,v:v0},{u:u1,v:v0},{u:u1,v:v1},{u:u0,v:v1})
    m.faceUvIndices.push([uvBase,uvBase+1,uvBase+2,uvBase+3])
  }
  m.buildHalfEdges(); return m
}

function sweepProfile(path: Vec2[], profile: Vec2[], settings: PathOutputSettings, color: number): HalfEdgeMesh {
  const m = new HalfEdgeMesh(), n = profile.length
  for (let i=0;i<path.length;i++) {
    const t=tangent(path,i), nx=-t.y, ny=t.x, u=i/Math.max(1,path.length-1)
    const scale=settings.startScale+(settings.endScale-settings.startScale)*u
    const roll=settings.twist*Math.PI/180*u, cr=Math.cos(roll), sr=Math.sin(roll)
    for (const q of profile) {
      const lateral=(q.x*cr-q.y*sr)*scale+settings.offset, z=(q.x*sr+q.y*cr)*scale
      m.positions.push({x:path[i]!.x+nx*lateral,y:path[i]!.y+ny*lateral,z})
      m.uvs.push({u, v: profile.indexOf(q) / n})
    }
  }
  for(let i=0;i<path.length-1;i++) for(let j=0;j<n;j++){const q=(j+1)%n;m.faces.push([i*n+j,(i+1)*n+j,(i+1)*n+q,i*n+q]);m.faceUvIndices.push([i*n+j,(i+1)*n+j,(i+1)*n+q,i*n+q]);m.faceColors.push(color)}
  if(settings.startCap!=='open'){m.faces.push(Array.from({length:n},(_,i)=>n-1-i));m.faceUvIndices.push(Array.from({length:n},(_,i)=>n-1-i));m.faceColors.push(color)}
  if(settings.endCap!=='open'){m.faces.push(Array.from({length:n},(_,i)=>(path.length-1)*n+i));m.faceUvIndices.push(Array.from({length:n},(_,i)=>(path.length-1)*n+i));m.faceColors.push(color)}
  m.buildHalfEdges(); return m
}

export function generatePathOutput(path: Vec2[], settings: PathOutputSettings, color: number): HalfEdgeMesh {
  const radius = Math.max(.25, settings.radius)
  if (settings.output === 'tube') return generateCapsuleSweep(path,{radius,radialSegments:settings.radialSegments,preserveSpine:true,color,startCap:settings.startCap,endCap:settings.endCap})
  if (settings.output === 'ribbon') return generateHairRibbon(path,{halfWidth:radius,depth:Math.max(.2,radius*.25),flat:settings.ribbonFlat,color,startTipStyle:settings.ribbonStartTip,endTipStyle:settings.ribbonEndTip,taperFraction:settings.ribbonTaper})
  if (settings.output === 'vine') return generateTaperedPointedTube(path,{radius,radialSegments:settings.radialSegments,preserveSpine:true,color,tipStyle:'pointed'})
  if (settings.output === 'rope') {
    const strands: HalfEdgeMesh[]=[]
    const arc=[0]
    for(let i=1;i<path.length;i++) arc.push(arc[i-1]!+Math.hypot(path[i]!.x-path[i-1]!.x,path[i]!.y-path[i-1]!.y))
    const total=Math.max(arc[arc.length-1]??0,1e-8)
    const orbit=radius*.48
    for(let strand=0;strand<3;strand++) {
      const centerline=path.map((p,i)=>{
        const t=tangent(path,i)
        const phase=arc[i]!/total*settings.twist*Math.PI/180+strand*Math.PI*2/3
        const radial=Math.cos(phase)*orbit
        return {x:p.x-t.y*radial,y:p.y+t.x*radial,z:Math.sin(phase)*orbit}
      })
      strands.push(ensurePositiveVolume(generateCapsuleSweep3D(centerline,{radius:radius*.44,radialSegments:Math.max(5,settings.radialSegments-2),color,startCap:settings.startCap,endCap:settings.endCap})))
    }
    return mergeOutputMeshes(strands,color)
  }
  if (settings.output === 'profile-sweep') {
    const w=radius*settings.profileWidth,h=radius*settings.profileHeight
    const profile=settings.profile==='rail'?[{x:-w,y:-h},{x:w,y:-h},{x:w,y:-h*.55},{x:w*.3,y:-h*.55},{x:w*.3,y:h*.55},{x:w,y:h*.55},{x:w,y:h},{x:-w,y:h},{x:-w,y:h*.55},{x:-w*.3,y:h*.55},{x:-w*.3,y:-h*.55},{x:-w,y:-h*.55}]:settings.profile==='round'?Array.from({length:settings.radialSegments},(_,i)=>({x:Math.cos(i/settings.radialSegments*Math.PI*2)*w,y:Math.sin(i/settings.radialSegments*Math.PI*2)*h})):[{x:-w,y:-h},{x:w,y:-h},{x:w,y:h},{x:-w,y:h}]
    return sweepProfile(path,profile,settings,color)
  }
  // Chain spacing is capped at an interlocking pitch. Larger gaps made the
  // alternating link look missing because no neighboring ring crossed it.
  const samplingSettings = settings.output === 'chain' && (settings.distributionMode ?? 'spacing') === 'spacing'
    ? { ...settings, spacing: Math.min(settings.spacing, radius * 2.35) }
    : settings
  const samples=samplePath(path,samplingSettings).map((sample)=>({ ...sample, p: { x: sample.p.x - sample.t.y * settings.offset, y: sample.p.y + sample.t.x * settings.offset } }))
  const random = seededRandom(settings.seed ?? 1)
  const placement = (s: typeof samples[number], i: number) => {
    const randomScale = Math.max(0, settings.randomScale ?? 0)
    const scale = Math.max(.01, (settings.startScale+(settings.endScale-settings.startScale)*s.u) * (1 + (random()*2-1)*randomScale))
    const randomRotation = (random()*2-1) * (settings.randomRotation ?? 0)
    const alternate = settings.alternateRotation && i % 2 ? 90 : 0
    const angle = Math.atan2(s.t.y,s.t.x) + ((settings.rotation ?? 0) + randomRotation + alternate) * Math.PI / 180
    return { scale, angle, mirror: !!settings.mirrorAlternate && i % 2 === 1 }
  }
  if(settings.output==='chain') {
    const link=makeLink(radius*1.35,radius*.34,color,settings.radialSegments)
    // Link major axis follows the path. Alternating links roll 90° around that
    // axis, passing through their neighbors instead of merely sitting beside them.
    return mergeOutputMeshes(samples.map((s,i)=>{
      const p=placement(s,i)
      // Validate each disconnected solid independently. This also repairs a
      // reflected winding if a procedural/mirrored chain source is restored.
      return ensurePositiveVolume(transformCopy(link,s.p,p.angle,p.scale,settings.chainAlternating&&i%2?Math.PI/2:0,p.mirror))
    }),color)
  }
  if(settings.output==='cards') {
    const cardWidth = radius * 2 * Math.max(.1, settings.profileWidth)
    const cardLength = radius * 4 * Math.max(.1, settings.profileHeight)
    const card=makeCard(cardWidth,cardLength,color)
    const meshes=samples.flatMap((s,i)=>{const p=placement(s,i);const first=transformCopy(card,s.p,p.angle,p.scale,0,p.mirror);return settings.cardCrossed?[first,transformCopy(card,s.p,p.angle,p.scale,Math.PI/2,p.mirror)]:[first]})
    return mergeOutputMeshes(meshes,color)
  }
  const source=settings.sourceObject?HalfEdgeMesh.fromObject(settings.sourceObject):makeBox(radius*1.3,radius*1.3,radius*1.3,color)
  return mergeOutputMeshes(samples.map((s,i)=>{const p=placement(s,i);return transformCopy(source,s.p,p.angle,p.scale,0,p.mirror)}),color)
}
