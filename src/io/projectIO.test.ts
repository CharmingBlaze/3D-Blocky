import { describe, expect, it } from 'vitest'
import { APP_PROJECT_FORMAT } from '../app/branding'
import { createPixelDocument } from '../pixel/pixelDocument'
import { sanitizeSceneSnapshot, type SceneSnapshot } from '../history/sceneHistory'
import { prepareSceneObject } from '../mesh/objectTransform'
import {
  parseProjectFile,
  preferencesFromProjectFile,
  PROJECT_FILE_VERSION,
  serializeProjectFromSnapshot,
  snapshotFromProjectFile,
  type SerializedProjectFile,
} from './projectIO'
import { DEFAULT_HAIR_UV_TRANSFORM } from '../stroke/hairUvTransform'
import { DEFAULT_HAIR_TEXTURE_SETTINGS } from '../stroke/hairTextureSettings'
import { strokeLayoutInitialState } from '../store/strokeSlice'

function project(objects: unknown[], extras: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, format: APP_PROJECT_FORMAT, objects, ...extras })
}

function texturedPlaneSnapshot(): SceneSnapshot {
  const doc = createPixelDocument(4, 4, 'tex-doc-1')
  doc.layers[0]!.pixels[3] = 128 // alpha cutout sample
  return {
    objects: [
      prepareSceneObject({
        id: 'plane-1',
        name: 'ImagePlane',
        positions: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 1, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
        faces: [
          [0, 1, 2, 3],
          [0, 3, 2, 1],
        ],
        faceColors: [0xffffff, 0xffffff],
        uvs: [
          { u: 0, v: 0 },
          { u: 1, v: 0 },
          { u: 1, v: 1 },
          { u: 0, v: 1 },
          { u: 1, v: 0 },
          { u: 1, v: 1 },
          { u: 0, v: 1 },
          { u: 0, v: 0 },
        ],
        faceUvIndices: [
          [0, 1, 2, 3],
          [4, 5, 6, 7],
        ],
        material: {
          mode: 'texture',
          textureId: 'tex-doc-1',
          textureWrap: 'clamp',
          textureLumaAlpha: true,
          textureBrightness: 1.15,
          opacity: 1,
          doubleSided: false,
        },
        color: 0xffffff,
        topologyLocked: false,
        polyBudget: 128,
        polyBudgetMode: 'strict',
        smoothShading: false,
        facetExaggeration: 0,
        sketchSource: {
          relative: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          center: { x: 0, y: 0 },
          view: 'front',
          brushDensity: 12,
          polyBudget: 128,
          closeThreshold: 8,
          defaultDepth: 0,
          isClosed: false,
          kind: 'hair-path',
          extrudeDepth: 8,
          tipStyle: 'square',
          planeFrame: {
            origin: { x: 1, y: 2, z: 3 },
            right: { x: 1, y: 0, z: 0 },
            up: { x: 0, y: 1, z: 0 },
          },
        },
      }),
    ],
    objectTextures: {
      'tex-doc-1': { url: '', name: 'hair.png', width: 4, height: 4 },
    },
    pixelDocuments: { 'tex-doc-1': doc },
    referenceImages: [],
    billboardImages: [],
    selectedObjectId: 'plane-1',
    selectionObjectIds: ['plane-1'],
    meshSelection: null,
  }
}

describe('parseProjectFile', () => {
  it('returns a clear error for a non-object JSON root', () => {
    expect(() => parseProjectFile('null')).toThrow('expected a project object')
  })

  it('rejects faces that point outside the vertex array', () => {
    expect(() =>
      parseProjectFile(
        project([
          {
            id: 'broken',
            positions: [
              { x: 0, y: 0, z: 0 },
              { x: 1, y: 0, z: 0 },
              { x: 0, y: 1, z: 0 },
            ],
            faces: [[0, 1, 4]],
            faceColors: [0xffffff],
          },
        ])
      )
    ).toThrow('has invalid mesh data')
  })

  it('rejects faces with repeated vertex indices', () => {
    expect(() =>
      parseProjectFile(
        project([
          {
            id: 'degenerate-ring',
            positions: [
              { x: 0, y: 0, z: 0 },
              { x: 1, y: 0, z: 0 },
              { x: 0, y: 1, z: 0 },
            ],
            faces: [[0, 1, 1]],
            faceColors: [0xffffff],
          },
        ])
      )
    ).toThrow('repeats a vertex index')
  })

  it('fills missing legacy face colors from the object color', () => {
    const parsed = parseProjectFile(
      project([
        {
          id: 'legacy-colors',
          color: 0x123456,
          positions: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
          ],
          faces: [[0, 1, 2]],
        },
      ])
    )
    expect(parsed.objects[0]!.faceColors).toEqual([0x123456])
  })

  it('rejects UV rings that do not parallel face corners', () => {
    expect(() =>
      parseProjectFile(
        project([
          {
            id: 'broken-uvs',
            positions: [
              { x: 0, y: 0, z: 0 },
              { x: 1, y: 0, z: 0 },
              { x: 0, y: 1, z: 0 },
            ],
            faces: [[0, 1, 2]],
            faceColors: [0xffffff],
            uvs: [{ u: 0, v: 0 }],
            faceUvIndices: [[0, 1, 0]],
          },
        ])
      )
    ).toThrow('Face UV indices must parallel faces')
  })

  it('rejects duplicate object ids before they can corrupt selection maps', () => {
    const triangle = {
      id: 'duplicate',
      positions: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      faces: [[0, 1, 2]],
      faceColors: [0xffffff],
    }
    expect(() => parseProjectFile(project([triangle, triangle]))).toThrow(
      'duplicate object id "duplicate"'
    )
  })

  it('rejects duplicate pixel document ids before restoration overwrites one', () => {
    expect(() =>
      parseProjectFile(
        project([], {
          pixelDocuments: [{ id: 'duplicate-doc' }, { id: 'duplicate-doc' }],
        })
      )
    ).toThrow('duplicate pixel document id "duplicate-doc"')
  })

  it('rejects non-finite object transforms', () => {
    expect(() =>
      parseProjectFile(
        project([
          {
            id: 'bad-transform',
            positions: [
              { x: 0, y: 0, z: 0 },
              { x: 1, y: 0, z: 0 },
              { x: 0, y: 1, z: 0 },
            ],
            faces: [[0, 1, 2]],
            faceColors: [0xffffff],
            transform: {
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: Number.NaN, z: 1 },
            },
          },
        ])
      )
    ).toThrow('invalid transform')
  })

  it('rejects remote embedded-image URLs', () => {
    expect(() =>
      parseProjectFile(
        project([], {
          objectTextures: {
            remote: {
              name: 'remote.png',
              width: 1,
              height: 1,
              dataUrl: 'https://example.invalid/tracker.png',
            },
          },
        })
      )
    ).toThrow('invalid texture "remote"')
  })

  it('accepts a structurally valid legacy-compatible mesh', () => {
    const parsed = parseProjectFile(
      project([
        {
          id: 'triangle',
          positions: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
          ],
          faces: [[0, 1, 2]],
          faceColors: [0xffffff],
        },
      ])
    )
    expect(parsed.objects).toHaveLength(1)
    expect(parsed.version).toBe(1)
  })

  it('accepts version 2 project files', () => {
    const parsed = parseProjectFile(
      JSON.stringify({
        version: PROJECT_FILE_VERSION,
        format: APP_PROJECT_FORMAT,
        objects: [
          {
            id: 'triangle',
            positions: [
              { x: 0, y: 0, z: 0 },
              { x: 1, y: 0, z: 0 },
              { x: 0, y: 1, z: 0 },
            ],
            faces: [[0, 1, 2]],
            faceColors: [0xffffff],
          },
        ],
        hair: {
          textureId: 'tex-a',
          tipStyle: 'square',
          uvTransform: { ...DEFAULT_HAIR_UV_TRANSFORM, scaleU: 2 },
          textureSettings: { ...DEFAULT_HAIR_TEXTURE_SETTINGS },
        },
      })
    )
    expect(parsed.version).toBe(2)
    expect(preferencesFromProjectFile(parsed).hair?.tipStyle).toBe('square')
    expect(preferencesFromProjectFile(parsed).hair?.uvTransform.scaleU).toBe(2)
  })
})

describe('sanitizeSceneSnapshot texture retention', () => {
  it('keeps pixel docs and texture meta keyed by material textureId (not object id)', () => {
    const snapshot = texturedPlaneSnapshot()
    const sanitized = sanitizeSceneSnapshot(snapshot)
    expect(sanitized.pixelDocuments['tex-doc-1']).toBeTruthy()
    expect(sanitized.objectTextures['tex-doc-1']?.name).toBe('hair.png')
    expect(sanitized.objects[0]?.material?.textureId).toBe('tex-doc-1')
    expect(sanitized.objects[0]?.sketchSource?.tipStyle).toBe('square')
    expect(sanitized.objects[0]?.sketchSource?.planeFrame?.origin.x).toBe(1)
  })

  it('retains unused hair texture docs when retainTextureIds is provided', () => {
    const doc = createPixelDocument(2, 2, 'hair-only')
    const snapshot: SceneSnapshot = {
      objects: [],
      objectTextures: {
        'hair-only': { url: '', name: 'strand.png', width: 2, height: 2 },
      },
      pixelDocuments: { 'hair-only': doc },
      referenceImages: [],
      billboardImages: [],
      selectedObjectId: null,
      selectionObjectIds: [],
      meshSelection: null,
    }
    expect(sanitizeSceneSnapshot(snapshot).pixelDocuments['hair-only']).toBeUndefined()
    expect(
      sanitizeSceneSnapshot(snapshot, { retainTextureIds: ['hair-only'] }).pixelDocuments[
        'hair-only'
      ]
    ).toBeTruthy()
  })
})

describe('project serialize ↔ load round-trip', () => {
  it('preserves textured plane materials, UVs, hair tip, plane frame, and preferences', async () => {
    const snapshot = texturedPlaneSnapshot()
    const file = await serializeProjectFromSnapshot(snapshot, {
      hair: {
        textureId: 'tex-doc-1',
        tipStyle: 'square',
        uvTransform: { ...DEFAULT_HAIR_UV_TRANSFORM, scaleV: 3, flipU: true },
        textureSettings: {
          ...DEFAULT_HAIR_TEXTURE_SETTINGS,
          removeDarkBackground: true,
          brightness: 1.4,
        },
      },
      stroke: {
        ...strokeLayoutInitialState,
        strokeMode: 'hair-paths',
        blobInflation: 0.4,
        extrudeAmount: 22,
        sketchExtrudeMode: true,
        penExtrudeMode: false,
      },
      sceneSettings: {
        polyBudget: 256,
        brushDensity: 18,
        drawDoubleSided: true,
        closeThreshold: 8,
        defaultDepth: 5,
        activeColor: 0xff00aa,
      },
    })

    expect(file.version).toBe(PROJECT_FILE_VERSION)
    expect(file.hair?.textureId).toBe('tex-doc-1')
    expect(file.objects[0]?.material?.textureLumaAlpha).toBe(true)

    const json = JSON.stringify(file)
    const parsed = parseProjectFile(json)
    const restored = await snapshotFromProjectFile(parsed)
    const prefs = preferencesFromProjectFile(parsed)

    expect(restored.pixelDocuments['tex-doc-1']).toBeTruthy()
    expect(restored.objectTextures['tex-doc-1']?.name).toBe('hair.png')
    expect(restored.objects[0]?.uvs).toHaveLength(8)
    expect(restored.objects[0]?.material?.textureId).toBe('tex-doc-1')
    expect(restored.objects[0]?.material?.textureBrightness).toBe(1.15)
    expect(restored.objects[0]?.sketchSource?.kind).toBe('hair-path')
    expect(restored.objects[0]?.sketchSource?.tipStyle).toBe('square')
    expect(restored.objects[0]?.sketchSource?.planeFrame?.origin).toEqual({
      x: 1,
      y: 2,
      z: 3,
    })
    expect(prefs.hair?.tipStyle).toBe('square')
    expect(prefs.hair?.uvTransform.scaleV).toBe(3)
    expect(prefs.hair?.textureSettings.brightness).toBe(1.4)
    expect(prefs.stroke?.strokeMode).toBe('hair-paths')
    expect(prefs.sceneSettings?.polyBudget).toBe(256)
  })

  it('loads legacy v1 files without preferences', () => {
    const parsed = parseProjectFile(
      project([
        {
          id: 'triangle',
          positions: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
          ],
          faces: [[0, 1, 2]],
          faceColors: [0xffffff],
        },
      ])
    ) as SerializedProjectFile
    const prefs = preferencesFromProjectFile(parsed)
    expect(prefs.hair).toBeUndefined()
    expect(prefs.stroke).toBeUndefined()
    expect(prefs.sceneSettings).toBeUndefined()
  })
})
