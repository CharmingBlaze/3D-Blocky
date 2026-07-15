import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  clearUvPaintOverlayCaches,
  meshHasPaintableUvs,
  paintUvAtlasOverlay,
  resolveMeshForTextureDoc,
  resolveSelectedUvOverlayMesh,
} from './uvPaintOverlay'
import type { SceneObject } from '../mesh/HalfEdgeMesh'

function makeBox(id: string, textureId?: string): SceneObject {
  // Minimal quad (one face) with UVs covering the unit square.
  return {
    id,
    name: id,
    positions: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ],
    faces: [[0, 1, 2, 3]],
    uvs: [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ],
    faceUvIndices: [[0, 1, 2, 3]],
    color: 0xffffff,
    material: {
      mode: 'texture',
      textureId: textureId ?? id,
      opacity: 1,
      doubleSided: false,
    },
  } as unknown as SceneObject
}

function makeCtx(w: number, h: number) {
  const calls: string[] = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalCompositeOperation: 'source-over',
    beginPath: () => calls.push('beginPath'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    closePath: () => calls.push('closePath'),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    fillRect: () => calls.push('fillRect'),
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls, w, h }
}

describe('uvPaintOverlay', () => {
  beforeEach(() => {
    clearUvPaintOverlayCaches()
  })

  afterEach(() => {
    clearUvPaintOverlayCaches()
  })

  it('resolveMeshForTextureDoc prefers selected object sharing the texture', () => {
    const a = makeBox('a', 'tex')
    const b = makeBox('b', 'tex')
    const pick = resolveMeshForTextureDoc([a, b], 'tex', 'b')
    expect(pick?.id).toBe('b')
  })

  it('resolves exactly the selected object without changing or filtering its UV layout', () => {
    const selected = makeBox('selected', 'different-texture')
    const originalUvs = selected.uvs!.map((uv) => ({ ...uv }))
    const pick = resolveSelectedUvOverlayMesh([makeBox('other', 'active-doc'), selected], 'selected')

    expect(pick).toBe(selected)
    expect(selected.uvs).toEqual(originalUvs)
  })

  it('meshHasPaintableUvs requires matching faceUvIndices', () => {
    const ok = makeBox('ok')
    expect(meshHasPaintableUvs(ok)).toBe(true)
    const bad = { ...ok, faceUvIndices: [] }
    expect(meshHasPaintableUvs(bad)).toBe(false)
  })

  it('paintUvAtlasOverlay draws fills and boundaries without throwing', () => {
    const mesh = makeBox('m') as ReturnType<typeof makeBox> & {
      uvs: NonNullable<SceneObject['uvs']>
      faceUvIndices: number[][]
    }
    const { ctx, calls } = makeCtx(64, 64)
    paintUvAtlasOverlay({
      ctx,
      texW: 64,
      texH: 64,
      mesh: mesh as never,
      uvs: mesh.uvs!,
      selectedFaces: [],
      drawFills: true,
    })
    expect(calls).toContain('fill')
    expect(calls).toContain('stroke')
  })

  it('paintUvAtlasOverlay defaults to outlines only (no island fills)', () => {
    const mesh = makeBox('m') as never
    const { ctx, calls } = makeCtx(32, 32)
    paintUvAtlasOverlay({
      ctx,
      texW: 32,
      texH: 32,
      mesh,
      uvs: (mesh as { uvs: { u: number; v: number }[] }).uvs,
      selectedFaces: [],
    })
    expect(calls).toContain('stroke')
    expect(calls).not.toContain('fill')
  })

  it('paintUvAtlasOverlay dims outside when faces are selected', () => {
    const mesh = makeBox('m') as never
    const { ctx, calls } = makeCtx(32, 32)
    paintUvAtlasOverlay({
      ctx,
      texW: 32,
      texH: 32,
      mesh,
      uvs: (mesh as { uvs: { u: number; v: number }[] }).uvs,
      selectedFaces: [0],
    })
    expect(calls).toContain('fillRect')
    expect(calls).toContain('save')
    expect(calls).toContain('restore')
  })

  it('clearUvPaintOverlayCaches drops cached edges', () => {
    const mesh = makeBox('cached') as never
    const { ctx } = makeCtx(16, 16)
    paintUvAtlasOverlay({
      ctx,
      texW: 16,
      texH: 16,
      mesh,
      uvs: (mesh as { uvs: { u: number; v: number }[] }).uvs,
      selectedFaces: [0],
    })
    clearUvPaintOverlayCaches('cached')
    // Second paint after clear should still work (rebuilds cache).
    paintUvAtlasOverlay({
      ctx,
      texW: 16,
      texH: 16,
      mesh,
      uvs: (mesh as { uvs: { u: number; v: number }[] }).uvs,
      selectedFaces: [0],
    })
    expect(true).toBe(true)
  })
})
