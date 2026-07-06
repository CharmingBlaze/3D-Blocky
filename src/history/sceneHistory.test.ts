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
    type: 'mesh',
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

  it('push skips duplicate snapshots unless forced', () => {
    const stack = new SceneHistoryStack(emptySnapshot())
    expect(stack.push(emptySnapshot(), 'same')).toBe(false)
    expect(stack.push(emptySnapshot(), 'forced', { force: true })).toBe(true)
    expect(stack.length).toBe(2)
  })
})
