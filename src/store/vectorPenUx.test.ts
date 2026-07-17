import { afterEach, describe, expect, it } from 'vitest'
import { emptySceneSnapshot, resetSceneHistory } from './historySlice'
import { useAppStore } from './appStore'
import { attachVectorSource } from '../vector/vectorSource'
import { vectorPathToMesh } from '../vector/vectorPathToMesh'
import type { VectorPath } from '../vector/types'
import { IDENTITY_TRANSFORM } from '../mesh/objectTransform'
import { TOOL_RING_BRANCHES } from '../tools/toolRingConfig'
import { emptyVectorDocument } from '../vector/types'

afterEach(() => {
  resetSceneHistory(emptySceneSnapshot())
  useAppStore.setState({
    objects: [],
    selectedObjectId: null,
    selectionObjectIds: [],
    vectorPenDraft: null,
    vectorDocument: emptyVectorDocument(),
    activeTool: 'draw',
    drawInputMode: 'regular',
    strokeMode: 'blob',
    sketchExtrudeMode: false,
    penExtrudeMode: false,
  })
})

function makeVectorObject(id = 'vec-edit') {
  const path: VectorPath = {
    id: 'path-1',
    view: 'front',
    closed: false,
    color: 0xffffff,
    source: 'pen',
    objectId: id,
    anchors: [
      { id: 'a0', position: { x: 0, y: 0 }, inHandle: null, outHandle: null },
      { id: 'a1', position: { x: 20, y: 0 }, inHandle: null, outHandle: null },
      { id: 'a2', position: { x: 30, y: 10 }, inHandle: null, outHandle: null },
    ],
  }
  const mesh = vectorPathToMesh(path, {
    view: 'front',
    polyBudget: 128,
    brushDensity: 12,
    strokeMode: 'centerline',
    rdpTolerance: 2,
    closeThreshold: 12,
    defaultDepth: 0,
    color: path.color,
    extrudeAmount: 16,
  })!
  return attachVectorSource(
    {
      ...mesh,
      id,
      name: 'Path',
      transform: {
        position: { x: 1, y: 2, z: 3 },
        rotation: { ...IDENTITY_TRANSFORM.rotation },
        scale: { ...IDENTITY_TRANSFORM.scale },
      },
    },
    {
      path,
      strokeMode: 'centerline',
      extrudeMode: false,
      brushDensity: 12,
      polyBudget: 128,
      rdpTolerance: 2,
      closeThreshold: 12,
      defaultDepth: 0,
      stylize: 0,
      extrudeDepth: 16,
    }
  )
}

describe('Vector Pen UX store', () => {
  it('removes the last anchor with penRemoveLastAnchor', () => {
    useAppStore.getState().setDrawInputMode('vector-pen')
    useAppStore.setState({
      vectorPenDraft: {
        anchors: [
          { id: 'a0', position: { x: 0, y: 0 }, inHandle: null, outHandle: null },
          { id: 'a1', position: { x: 10, y: 0 }, inHandle: null, outHandle: null },
          { id: 'a2', position: { x: 20, y: 8 }, inHandle: null, outHandle: null },
        ],
        view: 'front',
        previewPoint: { x: 20, y: 8 },
        pendingAnchorIndex: null,
        continuePathId: null,
        editingObjectId: null,
        closeTargetActive: false,
        closed: false,
      },
    })

    expect(useAppStore.getState().vectorPenDraft?.anchors.length).toBe(3)
    useAppStore.getState().penRemoveLastAnchor()
    expect(useAppStore.getState().vectorPenDraft?.anchors.length).toBe(2)
    useAppStore.getState().penRemoveLastAnchor()
    expect(useAppStore.getState().vectorPenDraft?.anchors.length).toBe(1)
    useAppStore.getState().penRemoveLastAnchor()
    expect(useAppStore.getState().vectorPenDraft).toBeNull()
  })

  it('first placed point is pending so drag can create curves', () => {
    useAppStore.getState().setDrawInputMode('vector-pen')
    useAppStore.getState().penPointerDown({ x: 5, y: 5 }, 'front')
    const draft = useAppStore.getState().vectorPenDraft
    expect(draft?.anchors).toHaveLength(1)
    expect(draft?.pendingAnchorIndex).toBe(0)
  })

  it('beginEditVectorPath loads anchors; cancel restores original mesh', () => {
    const object = makeVectorObject('vec-a')
    useAppStore.setState({
      objects: [object],
      selectedObjectId: object.id,
      selectionObjectIds: [object.id],
      vectorDocument: { ...emptyVectorDocument(), paths: [object.vectorSource!.path] },
    })

    useAppStore.getState().beginEditVectorPath(object.id)
    const draft = useAppStore.getState().vectorPenDraft
    expect(draft?.editingObjectId).toBe('vec-a')
    expect(draft?.anchors).toHaveLength(3)
    expect(useAppStore.getState().activeTool).toBe('vector-pen')

    useAppStore.getState().penCancelPath()
    expect(useAppStore.getState().vectorPenDraft).toBeNull()
    expect(useAppStore.getState().objects[0]?.id).toBe('vec-a')
    expect(useAppStore.getState().objects[0]?.transform?.position).toEqual({ x: 1, y: 2, z: 3 })
    expect(useAppStore.getState().objects[0]?.vectorSource).toBeTruthy()
  })

  it('finish after beginEditVectorPath preserves object id and transform', () => {
    const object = makeVectorObject('vec-b')
    useAppStore.setState({
      objects: [object],
      selectedObjectId: object.id,
      selectionObjectIds: [object.id],
      vectorDocument: { ...emptyVectorDocument(), paths: [object.vectorSource!.path] },
    })

    useAppStore.getState().beginEditVectorPath(object.id)
    const draft = useAppStore.getState().vectorPenDraft!
    useAppStore.setState({
      vectorPenDraft: {
        ...draft,
        anchors: draft.anchors.map((a, i) =>
          i === 2 ? { ...a, position: { x: 40, y: 20 } } : a
        ),
        pendingAnchorIndex: null,
      },
    })
    useAppStore.getState().penFinishPath()

    const next = useAppStore.getState().objects[0]
    expect(useAppStore.getState().vectorPenDraft).toBeNull()
    expect(next?.id).toBe('vec-b')
    expect(next?.transform?.position).toEqual({ x: 1, y: 2, z: 3 })
    expect(next?.vectorSource?.path.anchors[2]?.position).toEqual({ x: 40, y: 20 })
  })

  it('keeps Vector Pen active when choosing stroke mode or Extrude from the tool ring', () => {
    useAppStore.getState().setDrawInputMode('vector-pen')
    expect(useAppStore.getState().activeTool).toBe('vector-pen')

    useAppStore.getState().activateToolRingEntry('draw', {
      kind: 'stroke',
      mode: 'ribbon',
      label: 'Ribbon',
    })
    expect(useAppStore.getState().activeTool).toBe('vector-pen')
    expect(useAppStore.getState().drawInputMode).toBe('vector-pen')
    expect(useAppStore.getState().strokeMode).toBe('ribbon')

    useAppStore.getState().activateToolRingEntry('draw', {
      kind: 'action',
      id: 'extrude',
      label: 'Extrude',
    })
    expect(useAppStore.getState().activeTool).toBe('vector-pen')
    expect(useAppStore.getState().drawInputMode).toBe('vector-pen')
    expect(useAppStore.getState().sketchExtrudeMode).toBe(true)
    expect(useAppStore.getState().penExtrudeMode).toBe(true)
  })

  it('tool ring Extrude label is shared (not Sketch-only)', () => {
    const extrude = TOOL_RING_BRANCHES.draw.find(
      (entry) => entry.kind === 'action' && entry.id === 'extrude'
    )
    expect(extrude?.label).toBe('Extrude')
  })
})
