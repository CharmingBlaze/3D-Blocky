import { describe, expect, it } from 'vitest'
import { generateLathe } from '../mesh/lathe'
import {
  strokeToLatheProfile,
  isLatheViewSupported,
  LATHE_MAX_PROFILE_RINGS,
  LATHE_RADIAL_SEGMENTS,
} from './latheProfile'
import { projectMeshToView } from './worldProjection'
import { polylineToMesh } from './polylineToMesh'
import { regenerateLatheObject } from './latheSource'

describe('latheProfile', () => {
  it('keeps profile corners but drops dense straight runs', () => {
    const denseLine = [
      { x: 10, y: 0 },
      { x: 30, y: 10 },
      { x: 30, y: 12 },
      { x: 30, y: 14 },
      { x: 30, y: 16 },
      { x: 20, y: 40 },
    ]
    const result = strokeToLatheProfile(denseLine)
    expect(result).not.toBeNull()
    expect(result!.profile.length).toBeLessThan(denseLine.length)
    expect(result!.profile.length).toBeGreaterThanOrEqual(3)
    expect(result!.profile[0]).toEqual({ x: 0, y: 0 })
    expect(result!.axisH).toBe(10)
  })

  it('caps profile rings for low poly', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      x: 10 + Math.sin(i * 0.4) * 8,
      y: i * 2,
    }))
    const result = strokeToLatheProfile(many)!
    expect(result.profile.length).toBeLessThanOrEqual(LATHE_MAX_PROFILE_RINGS)
  })

  it('honors adjustable profile precision and smoothing', () => {
    const wave = Array.from({ length: 100 }, (_, i) => ({
      x: 20 + Math.sin(i * 0.35) * 5,
      y: i,
    }))
    const precise = strokeToLatheProfile(wave, { maxProfileRings: 64, smoothing: 0 })!
    const smooth = strokeToLatheProfile(wave, { maxProfileRings: 16, smoothing: 1 })!
    expect(precise.profile.length).toBeGreaterThan(smooth.profile.length)
    expect(precise.profile.length).toBeLessThanOrEqual(64)
    expect(smooth.profile.length).toBeLessThanOrEqual(16)
  })

  it('follows a curved silhouette instead of collapsing to a few chords', () => {
    // Wide S-curve: radius changes smoothly along height
    const curve = Array.from({ length: 40 }, (_, i) => {
      const t = i / 39
      return {
        x: 12 + Math.sin(t * Math.PI * 2) * 10,
        y: t * 60,
      }
    })
    const result = strokeToLatheProfile(curve)!
    expect(result.profile.length).toBeGreaterThanOrEqual(8)
    const radii = result.profile.map((p) => p.x)
    const minR = Math.min(...radii)
    const maxR = Math.max(...radii)
    // Should still show both the waist and the bulge from the drawn sine
    expect(maxR - minR).toBeGreaterThan(8)
  })

  it('supports all orthographic views', () => {
    expect(isLatheViewSupported('front')).toBe(true)
    expect(isLatheViewSupported('back')).toBe(true)
    expect(isLatheViewSupported('right')).toBe(true)
    expect(isLatheViewSupported('left')).toBe(true)
    expect(isLatheViewSupported('top')).toBe(true)
    expect(isLatheViewSupported('bottom')).toBe(true)
    expect(isLatheViewSupported('perspective')).toBe(false)
  })

  it('projects the same profile to different world shapes per view', () => {
    const stroke = [
      { x: 5, y: 0 },
      { x: 15, y: 12 },
      { x: 10, y: 24 },
    ]
    const lathe = strokeToLatheProfile(stroke)!
    const build = (view: 'front' | 'top') => {
      const mesh = generateLathe(lathe.profile, {
        radialSegments: LATHE_RADIAL_SEGMENTS,
        preserveProfile: true,
        axis: 'y',
      })
      for (const p of mesh.positions) {
        p.x += lathe.axisH
      }
      projectMeshToView(mesh, view, 0)
      return mesh.positions.map((p) => ({ x: p.x, y: p.y, z: p.z }))
    }

    const front = build('front')
    const top = build('top')
    expect(front.length).toBeGreaterThan(0)
    expect(top.length).toBe(front.length)

    const ringVert = front.find((p) => Math.abs(p.x - lathe.axisH) > 1 && Math.abs(p.y - 12) < 2)
    expect(ringVert).toBeDefined()
    const topMatch = top.find((p) => Math.abs(p.x - ringVert!.x) < 0.01 && Math.abs(p.y - ringVert!.y) < 0.01 && Math.abs(p.z - ringVert!.z) < 0.01)
    expect(topMatch).toBeUndefined()
  })

  it('retains its profile and can rebuild an existing lathe at a new precision', () => {
    const object = polylineToMesh({
      points: [{ x: 4, y: 0 }, { x: 18, y: 12 }, { x: 10, y: 30 }],
      view: 'front', polyBudget: 128, brushDensity: 12, strokeMode: 'outline',
      rdpTolerance: 0.5, closeThreshold: 8, defaultDepth: 0, color: 0x336699,
      latheMode: true, latheRadialSegments: 12, latheProfileRings: 16,
    })!
    expect(object.latheSource?.radialSegments).toBe(12)
    const rebuilt = regenerateLatheObject(object, { radialSegments: 32, profileRings: 48 })!
    expect(rebuilt.id).toBe(object.id)
    expect(rebuilt.latheSource?.radialSegments).toBe(32)
    expect(rebuilt.positions.length).toBeGreaterThan(object.positions.length)
    expect(rebuilt.uvs?.length).toBeGreaterThan(0)
  })
})
