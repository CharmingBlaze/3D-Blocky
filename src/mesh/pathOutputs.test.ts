import { describe, expect, it } from 'vitest'
import { generatePathOutput, type PathOutput, type PathOutputSettings } from './pathOutputs'

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
  it('supports exact counts, padding, and seeded randomization',()=>{
    const settings={...base,output:'object-array' as const,distributionMode:'count' as const,count:5,startPadding:4,endPadding:6,randomScale:.4,randomRotation:45,seed:77}
    const first=generatePathOutput(path,settings,0)
    const same=generatePathOutput(path,settings,0)
    const changed=generatePathOutput(path,{...settings,seed:78},0)
    expect(first.faces.length).toBe(5*6)
    expect(first.positions).toEqual(same.positions)
    expect(first.positions).not.toEqual(changed.positions)
  })
})
