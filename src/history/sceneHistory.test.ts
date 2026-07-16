import { describe, expect, it } from 'vitest'
import { createPixelDocument } from '../pixel/pixelDocument'
import {
  SceneHistoryStack,
  captureSceneSnapshot,
  cloneSceneObject,
  snapshotsEqual,
  type SceneSnapshot,
} from './sceneHistory'
import type { SceneObject } from '../mesh/HalfEdgeMesh'

function emptySnapshot(): SceneSnapshot {
  return {
    objects: [],
    objectTextures: {},
    pixelDocuments: {},
    referenceImages: [],
    billboardImages: [],
    selectedObjectId: null,
    selectionObjectIds: [],
    meshSelection: null,
  }
}

function boxObject(id: string, x = 0): SceneObject {
  return {
    id,
    name: id,
    positions: [
      { x, y: 0, z: 0 },
      { x: x + 1, y: 0, z: 0 },
      { x: x + 1, y: 1, z: 0 },
      { x, y: 1, z: 0 },
      { x, y: 0, z: 1 },
      { x: x + 1, y: 0, z: 1 },
      { x: x + 1, y: 1, z: 1 },
      { x, y: 1, z: 1 },
    ],
    faces: [
      [0, 1, 2],
      [0, 2, 3],
      [4, 6, 5],
      [4, 7, 6],
      [0, 4, 5],
      [0, 5, 1],
      [1, 5, 6],
      [1, 6, 2],
      [2, 6, 7],
      [2, 7, 3],
      [3, 7, 4],
      [3, 4, 0],
    ],
    faceColors: Array.from({ length: 12 }, () => 0xff0000),
    color: 0xff0000,
    smoothShading: false,
    topologyLocked: false,
    polyBudget: 128,
    polyBudgetMode: 'strict',
    facetExaggeration: 0,
  }
}

describe('sceneHistory', () => {
  it('reuses unchanged scene objects between consecutive snapshots', () => {
    const base = emptySnapshot()
    base.objects = [boxObject('a'), boxObject('b')]
    const first = captureSceneSnapshot(base)
    const secondInput = {
      ...base,
      objects: [cloneSceneObject(base.objects[0]), cloneSceneObject(base.objects[1])],
    }
    secondInput.objects[0].transform = {
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }
    const second = captureSceneSnapshot(secondInput, first)
    expect(second.objects[0]).not.toBe(first.objects[0])
    expect(second.objects[1]).toBe(first.objects[1])
  })

  it('reuses the captured clone when the immutable source object is unchanged', () => {
    const base = emptySnapshot()
    base.objects = [boxObject('stable')]
    const first = captureSceneSnapshot(base)
    const second = captureSceneSnapshot(base, first)
    expect(second.objects[0]).toBe(first.objects[0])
    expect(snapshotsEqual(first, second)).toBe(true)
  })

  it('reuses unchanged pixel documents between consecutive snapshots', () => {
    const doc = createPixelDocument(4, 4, 'tex-a')
    doc.layers[0].pixels[0] = 255
    const base = emptySnapshot()
    base.pixelDocuments = { [doc.id]: doc }
    base.objects = [boxObject('mesh-a')]
    const first = captureSceneSnapshot(base)
    const moved = {
      ...base,
      objects: [cloneSceneObject(base.objects[0])],
    }
    moved.objects[0].transform = {
      position: { x: 2, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }
    const second = captureSceneSnapshot(moved, first)
    expect(second.pixelDocuments[doc.id]).toBe(first.pixelDocuments[doc.id])
    expect(second.objects[0]).not.toBe(first.objects[0])
  })

  it('keeps captured pixel buffers isolated while the live stroke mutates in place', () => {
    const doc = createPixelDocument(8, 8, 'live-stroke')
    const base = emptySnapshot()
    base.pixelDocuments = { [doc.id]: doc }
    const captured = captureSceneSnapshot(base)

    doc.layers[0].pixels[0] = 255
    doc.layers[0].pixels[3] = 255

    expect(captured.pixelDocuments[doc.id].layers[0].pixels[0]).toBe(0)
    expect(captured.pixelDocuments[doc.id].layers[0].pixels[3]).toBe(0)
  })

  it('detects pixel-only edits as unequal snapshots', () => {
    const doc = createPixelDocument(2, 2, 'tex-a')
    const base = emptySnapshot()
    base.pixelDocuments = { [doc.id]: doc }
    const edited = captureSceneSnapshot({
      ...base,
      pixelDocuments: {
        [doc.id]: {
          ...doc,
          layers: doc.layers.map((layer) => ({
            ...layer,
            pixels: layer.pixels.slice(),
          })),
        },
      },
    })
    edited.pixelDocuments[doc.id].layers[0].pixels[0] = 99
    expect(snapshotsEqual(base, edited)).toBe(false)
  })

  it('detects face appearance edits as unequal snapshots', () => {
    const base = emptySnapshot()
    base.objects = [boxObject('colored')]
    const first = captureSceneSnapshot(base)
    const editedObject = cloneSceneObject(base.objects[0])
    editedObject.faceColors[0] = 0x00ff00
    const edited = captureSceneSnapshot({ ...base, objects: [editedObject] })
    expect(snapshotsEqual(first, edited)).toBe(false)
  })

  it('does not round away precise vertex edits', () => {
    const base = emptySnapshot()
    base.objects = [boxObject('precise')]
    const first = captureSceneSnapshot(base)
    const editedObject = cloneSceneObject(base.objects[0])
    editedObject.positions[0].x += 0.000001
    const edited = captureSceneSnapshot({ ...base, objects: [editedObject] })
    expect(snapshotsEqual(first, edited)).toBe(false)
  })

  it('reuses mesh content across new object identity without JSON.stringify', () => {
    const base = emptySnapshot()
    base.objects = [boxObject('reuse')]
    const first = captureSceneSnapshot(base)
    const twin = cloneSceneObject(base.objects[0])
    const second = captureSceneSnapshot({ ...base, objects: [twin] }, first)
    expect(second.objects[0]).toBe(first.objects[0])
    expect(snapshotsEqual(first, second)).toBe(true)
  })

  it('captures visibility-only edits instead of reusing a stale object', () => {
    const base = emptySnapshot()
    base.objects = [boxObject('visibility')]
    const first = captureSceneSnapshot(base)
    const hidden = cloneSceneObject(base.objects[0])
    hidden.visible = false

    const second = captureSceneSnapshot({ ...base, objects: [hidden] }, first)

    expect(second.objects[0]).not.toBe(first.objects[0])
    expect(second.objects[0].visible).toBe(false)
    expect(snapshotsEqual(first, second)).toBe(false)
  })

  it('captures primitive source-only edits instead of reusing stale parameters', () => {
    const base = emptySnapshot()
    const primitive = boxObject('primitive')
    primitive.primitiveSource = {
      type: 'box',
      box: {
        min: { x: -1, y: -1, z: -1 },
        max: { x: 1, y: 1, z: 1 },
      },
      heightAxis: 1,
      polyBudget: 48,
    }
    base.objects = [primitive]
    const first = captureSceneSnapshot(base)
    const resized = cloneSceneObject(primitive)
    resized.primitiveSource!.box.max.x = 2

    const second = captureSceneSnapshot({ ...base, objects: [resized] }, first)

    expect(second.objects[0]).not.toBe(first.objects[0])
    expect(second.objects[0].primitiveSource?.box.max.x).toBe(2)
    expect(snapshotsEqual(first, second)).toBe(false)
  })

  it('deep-clones lathe sources and detects parameter-only edits', () => {
    const base = emptySnapshot()
    const lathe = boxObject('lathe')
    lathe.latheSource = {
      points: [{ x: 1, y: -1 }, { x: 2, y: 1 }],
      view: 'front',
      defaultDepth: 0,
      caps: true,
      radialSegments: 16,
      profileRings: 12,
      smoothing: 0.25,
    }
    base.objects = [lathe]
    const first = captureSceneSnapshot(base)
    const edited = cloneSceneObject(lathe)
    edited.latheSource!.radialSegments = 24
    edited.latheSource!.points[0].x = 99

    expect(first.objects[0].latheSource?.radialSegments).toBe(16)
    expect(first.objects[0].latheSource?.points[0].x).toBe(1)

    const second = captureSceneSnapshot({ ...base, objects: [edited] }, first)
    expect(second.objects[0]).not.toBe(first.objects[0])
    expect(second.objects[0].latheSource?.radialSegments).toBe(24)
    expect(snapshotsEqual(first, second)).toBe(false)
  })

  it('push skips duplicate snapshots unless forced', () => {
    const stack = new SceneHistoryStack(emptySnapshot())
    expect(stack.push(emptySnapshot(), 'same')).toBe(false)
    expect(stack.push(emptySnapshot(), 'forced', { force: true })).toBe(true)
    expect(stack.length).toBe(2)
  })
})
