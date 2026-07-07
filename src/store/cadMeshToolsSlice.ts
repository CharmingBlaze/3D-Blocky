import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { localPointFromWorld, worldDeltaToLocal } from '../mesh/objectTransform'
import { knifeCutObject } from '../mesh/meshKnife'
import { knifeSegmentLongEnough } from '../mesh/knifeUtils'
import {
  applyBendToObject,
  bendAngleFromScreenDelta,
  bendAxisDirection,
} from '../mesh/bendDeform'
import { cloneSceneObject } from '../mesh/meshOps'
import {
  findEdgeLoop,
  insertEdgeLoop,
  isValidLoopSeed,
} from '../mesh/meshTopologyOps'
import {
  autoFinalizeCount,
  commitPolyDrawFace,
  flipFacesWinding,
} from '../polyDraw/polyDrawCommit'
import type { SelectionMode } from './selectionSlice'
import { mirrorSceneObject, type SymmetryAxis } from '../symmetry/symmetry'
import type { Vec3 } from '../utils/math'
import type { ViewType } from '../scene/viewTypes'

export type PolyDrawMode = 'triangle' | 'quad' | 'poly'

export type PolyDrawPointSnap =
  | { kind: 'mesh'; objectId: string; vertexIndex: number }
  | { kind: 'draft'; draftIndex: number }

export interface PolyDrawDraftPoint {
  world: Vec3
  snap?: PolyDrawPointSnap
}

export interface PolyDrawDraft {
  points: PolyDrawDraftPoint[]
  view: ViewType
  previewWorld: Vec3 | null
  snapHighlight: { world: Vec3; isDraft?: boolean } | null
}

export interface LastPolyDrawFace {
  objectId: string
  faceStartIndex: number
  faceCount: number
}

export interface LoopCutDraft {
  objectId: string
  seedEdge: string
  loopEdges: string[]
  t: number
}

export interface KnifeDraft {
  objectId: string | null
  start: Vec3 | null
  end: Vec3 | null
  committed: Array<{ start: Vec3; end: Vec3 }>
  view: ViewType
}

export interface BendDraft {
  objectId: string
  axisOrigin: Vec3
  axisEnd: Vec3 | null
  angle: number
  axisLocked: boolean
  baseObject: SceneObject
  view: ViewType
  startClientX: number
  startClientY: number
  startAngle: number
}

export interface CadMeshToolsLayoutState {
  polyDrawMode: PolyDrawMode
  polyDrawDraft: PolyDrawDraft | null
  polyDrawHover: { world: Vec3; snap: PolyDrawPointSnap | null } | null
  polyDrawSnapAllScene: boolean
  lastPolyDrawFace: LastPolyDrawFace | null
  lastPolyDrawClickAt: number
  loopCutDraft: LoopCutDraft | null
  knifeDraft: KnifeDraft | null
  bendDraft: BendDraft | null
}

export interface CadMeshToolsLayoutActions {
  setPolyDrawMode: (mode: PolyDrawMode) => void
  setPolyDrawSnapAllScene: (on: boolean) => void
  polyDrawPointerMove: (
    world: Vec3,
    snapHighlight: PolyDrawDraft['snapHighlight'],
    hoverSnap: PolyDrawPointSnap | null
  ) => void
  clearPolyDrawHover: () => void
  polyDrawClick: (world: Vec3, snap: PolyDrawPointSnap | null, view: ViewType) => void
  polyDrawCancel: () => void
  polyDrawFinish: () => void
  flipLastPolyDrawFace: () => void
  loopCutBegin: (objectId: string, seedEdge: string) => void
  loopCutSetT: (t: number) => void
  loopCutAdjustWheel: (deltaY: number) => void
  loopCutCommit: () => void
  loopCutCancel: () => void
  knifePointerDown: (objectId: string, world: Vec3, view: ViewType) => void
  knifePointerMove: (world: Vec3) => void
  knifeCommit: (viewForward: Vec3) => void
  knifeCancel: () => void
  bendBegin: (objectId: string, origin: Vec3, view: ViewType, clientX: number, clientY: number) => void
  bendPointerMove: (world: Vec3 | null, clientX: number, clientY: number) => void
  bendPointerUp: () => void
  bendStartAngleDrag: (clientX: number, clientY: number) => void
  bendCommit: () => void
  bendCancel: () => void
}

export type CadMeshToolsSlice = CadMeshToolsLayoutState & CadMeshToolsLayoutActions

export const cadMeshToolsInitialState: CadMeshToolsLayoutState = {
  polyDrawMode: 'quad',
  polyDrawDraft: null,
  polyDrawHover: null,
  polyDrawSnapAllScene: true,
  lastPolyDrawFace: null,
  lastPolyDrawClickAt: 0,
  loopCutDraft: null,
  knifeDraft: null,
  bendDraft: null,
}

type CadMeshToolsHost = CadMeshToolsLayoutState & {
  objects: SceneObject[]
  activeColor: number
  symmetryEnabled: boolean
  symmetryAxis: SymmetryAxis
  symmetryPlane: number
  updateObject: (id: string, updates: Partial<SceneObject>) => void
  commitHistory: (label: string) => boolean
  captureUndoPoint: (label?: string) => boolean
  replaceHistoryHead: (label?: string) => void
  pauseHistory: () => void
  undo: () => void
  resumeHistory: () => void
  selectedObjectId: string | null
  selectionObjectIds: string[]
}

export function createCadMeshToolsSlice<S extends CadMeshToolsHost & CadMeshToolsLayoutActions>(
  set: (partial: Partial<S> | ((state: S) => Partial<S>)) => void,
  get: () => S
): CadMeshToolsLayoutActions {
  return {
    setPolyDrawMode: (mode) => {
      set({
        polyDrawMode: mode,
        activeTool: 'poly-draw',
        polyDrawDraft: null,
        polyDrawHover: null,
        toolCategory: 'draw',
      } as unknown as Partial<S>)
    },

    setPolyDrawSnapAllScene: (on) => set({ polyDrawSnapAllScene: on } as unknown as Partial<S>),

    polyDrawPointerMove: (world, snapHighlight, hoverSnap) => {
      const { polyDrawDraft } = get()
      set({
        polyDrawHover: { world: { ...world }, snap: hoverSnap },
        ...(polyDrawDraft
          ? {
              polyDrawDraft: {
                ...polyDrawDraft,
                previewWorld: world,
                snapHighlight,
              },
            }
          : {}),
      } as unknown as Partial<S>)
    },

    clearPolyDrawHover: () => set({ polyDrawHover: null } as unknown as Partial<S>),

    polyDrawClick: (world, snap, view) => {
      const { polyDrawDraft, polyDrawMode } = get()
      const now = performance.now()

      const draft: PolyDrawDraft = polyDrawDraft ?? {
        points: [],
        view,
        previewWorld: null,
        snapHighlight: null,
      }

      const newPoint: PolyDrawDraftPoint = {
        world: { ...world },
        snap: snap ?? undefined,
      }

      const nextPoints = [...draft.points, newPoint]
      const closingPoly =
        polyDrawMode === 'poly' &&
        snap?.kind === 'draft' &&
        snap.draftIndex === 0 &&
        draft.points.length >= 3

      if (closingPoly) {
        set({
          polyDrawDraft: { ...draft, points: draft.points, view },
        } as unknown as Partial<S>)
        get().polyDrawFinish()
        return
      }

      const autoCount = autoFinalizeCount(polyDrawMode)
      const shouldAutoFinish = autoCount !== null && nextPoints.length >= autoCount

      set({
        polyDrawDraft: {
          ...draft,
          points: nextPoints,
          view,
          previewWorld: world,
          snapHighlight: null,
        },
        lastPolyDrawClickAt: now,
      } as unknown as Partial<S>)

      if (shouldAutoFinish) {
        get().polyDrawFinish()
      }
    },

    polyDrawCancel: () => set({ polyDrawDraft: null, polyDrawHover: null } as unknown as Partial<S>),

    polyDrawFinish: () => {
      const {
        polyDrawDraft,
        polyDrawMode,
        objects,
        activeColor,
        symmetryEnabled,
        symmetryAxis,
        symmetryPlane,
      } = get()
      if (!polyDrawDraft || polyDrawDraft.points.length < 3) {
        set({ polyDrawDraft: null } as unknown as Partial<S>)
        return
      }
      if (polyDrawMode === 'quad' && polyDrawDraft.points.length < 4) return
      if (polyDrawMode === 'triangle' && polyDrawDraft.points.length < 3) return

      const result = commitPolyDrawFace(polyDrawDraft.points, objects, {
        mode: polyDrawMode,
        color: activeColor,
      })

      if (!result) {
        set({ polyDrawDraft: null } as unknown as Partial<S>)
        return
      }

      const isNewObject =
        result.removedIds.length === 0 && !objects.some((o) => o.id === result.primaryId)
      let nextObjects = result.objects

      if (symmetryEnabled && isNewObject) {
        const primary = nextObjects.find((o) => o.id === result.primaryId)
        if (primary) {
          const mirrored = mirrorSceneObject(primary, symmetryAxis, symmetryPlane)
          nextObjects = [...nextObjects, mirrored]
          set({
            objects: nextObjects,
            selectedObjectId: result.primaryId,
            selectionObjectIds: [result.primaryId, mirrored.id],
            polyDrawDraft: null,
            lastPolyDrawFace: {
              objectId: result.primaryId,
              faceStartIndex: result.newFaceStartIndex,
              faceCount: result.newFaceCount,
            },
          } as unknown as Partial<S>)
          get().commitHistory('Poly draw')
          return
        }
      }

      set({
        objects: nextObjects,
        selectedObjectId: result.primaryId,
        selectionObjectIds: [result.primaryId],
        polyDrawDraft: null,
        lastPolyDrawFace: {
          objectId: result.primaryId,
          faceStartIndex: result.newFaceStartIndex,
          faceCount: result.newFaceCount,
        },
      } as unknown as Partial<S>)
      get().commitHistory('Poly draw')
    },

    flipLastPolyDrawFace: () => {
      const { lastPolyDrawFace, objects } = get()
      if (!lastPolyDrawFace) return
      const obj = objects.find((o) => o.id === lastPolyDrawFace.objectId)
      if (!obj) return
      const flipped = flipFacesWinding(
        obj,
        lastPolyDrawFace.faceStartIndex,
        lastPolyDrawFace.faceCount
      )
      get().updateObject(obj.id, { faces: flipped.faces })
      get().commitHistory('Flip face')
    },

    loopCutBegin: (objectId, seedEdge) => {
      const obj = get().objects.find((o) => o.id === objectId)
      if (!obj || obj.topologyLocked) return
      if (!isValidLoopSeed(obj, seedEdge)) return
      const loopEdges = findEdgeLoop(obj, seedEdge)
      set({
        loopCutDraft: { objectId, seedEdge, loopEdges, t: 0.5 },
        activeTool: 'loop-cut',
        selectionMode: 'edge' as SelectionMode,
      } as unknown as Partial<S>)
    },

    loopCutSetT: (t) => {
      const { loopCutDraft } = get()
      if (!loopCutDraft) return
      set({
        loopCutDraft: { ...loopCutDraft, t: Math.max(0.01, Math.min(0.99, t)) },
      } as unknown as Partial<S>)
    },

    loopCutAdjustWheel: (deltaY) => {
      const { loopCutDraft } = get()
      if (!loopCutDraft) return
      const step = deltaY > 0 ? -0.02 : 0.02
      get().loopCutSetT(loopCutDraft.t + step)
    },

    loopCutCommit: () => {
      const { loopCutDraft, objects } = get()
      if (!loopCutDraft) return
      const obj = objects.find((o) => o.id === loopCutDraft.objectId)
      if (!obj || obj.topologyLocked) {
        set({ loopCutDraft: null } as unknown as Partial<S>)
        return
      }
      const cut = insertEdgeLoop(obj, loopCutDraft.loopEdges, loopCutDraft.t)
      get().updateObject(obj.id, {
        positions: cut.positions,
        faces: cut.faces,
        faceColors: cut.faceColors,
      })
      set({ loopCutDraft: null } as unknown as Partial<S>)
      get().commitHistory('Loop cut')
    },

    loopCutCancel: () => set({ loopCutDraft: null } as unknown as Partial<S>),

    knifePointerDown: (objectId, world, view) => {
      const prev = get().knifeDraft
      const committed =
        prev?.objectId === objectId && prev.committed?.length ? [...prev.committed] : []
      set({
        knifeDraft: {
          objectId,
          start: { ...world },
          end: null,
          committed,
          view,
        },
        activeTool: 'knife',
      } as unknown as Partial<S>)
    },

    knifePointerMove: (world) => {
      const { knifeDraft } = get()
      if (!knifeDraft?.start) return
      set({ knifeDraft: { ...knifeDraft, end: { ...world } } } as unknown as Partial<S>)
    },

    knifeCommit: (viewForward) => {
      const { knifeDraft, objects } = get()
      if (!knifeDraft?.start || !knifeDraft.end || !knifeDraft.objectId) {
        set({ knifeDraft: null } as unknown as Partial<S>)
        return
      }
      const obj = objects.find((o) => o.id === knifeDraft.objectId)
      if (!obj || obj.topologyLocked) {
        set({ knifeDraft: null } as unknown as Partial<S>)
        return
      }

      const localStart = localPointFromWorld(obj, knifeDraft.start)
      const localEnd = localPointFromWorld(obj, knifeDraft.end)
      if (!knifeSegmentLongEnough(localStart, localEnd)) {
        set({ knifeDraft: null } as unknown as Partial<S>)
        return
      }

      const localForward = worldDeltaToLocal(obj, viewForward)
      const cut = knifeCutObject(obj, localStart, localEnd, localForward)
      const committed = [
        ...(knifeDraft.committed ?? []),
        { start: { ...knifeDraft.start }, end: { ...knifeDraft.end } },
      ]
      get().updateObject(obj.id, {
        positions: cut.positions,
        faces: cut.faces,
        faceColors: cut.faceColors,
        faceGroups: cut.faceGroups,
      })
      set({
        knifeDraft: {
          objectId: knifeDraft.objectId,
          start: null,
          end: null,
          committed,
          view: knifeDraft.view,
        },
      } as unknown as Partial<S>)
      get().commitHistory('Knife cut')
    },

    knifeCancel: () => set({ knifeDraft: null } as unknown as Partial<S>),

    bendBegin: (objectId, origin, view, clientX, clientY) => {
      const obj = get().objects.find((o) => o.id === objectId)
      if (!obj || obj.topologyLocked) return
      get().captureUndoPoint('Bend')
      set({
        bendDraft: {
          objectId,
          axisOrigin: { ...origin },
          axisEnd: null,
          angle: 0,
          axisLocked: false,
          baseObject: cloneSceneObject(obj),
          view,
          startClientX: clientX,
          startClientY: clientY,
          startAngle: 0,
        },
        activeTool: 'bend',
      } as unknown as Partial<S>)
    },

    bendPointerMove: (world, _clientX, clientY) => {
      const { bendDraft } = get()
      if (!bendDraft) return

      const axisEnd = world ? { ...world } : bendDraft.axisEnd
      const angle = bendDraft.axisLocked
        ? bendDraft.startAngle + bendAngleFromScreenDelta(bendDraft.startClientY, clientY)
        : bendAngleFromScreenDelta(bendDraft.startClientY, clientY)

      const next: BendDraft = {
        ...bendDraft,
        axisEnd,
        angle,
      }
      set({ bendDraft: next } as unknown as Partial<S>)

      const obj = get().objects.find((o) => o.id === next.objectId)
      if (!obj) return
      const fallback = { x: 1, y: 0, z: 0 }
      const axisDirection = bendAxisDirection(next.axisOrigin, next.axisEnd, fallback)
      const positions = applyBendToObject(next.baseObject, {
        axisOrigin: next.axisOrigin,
        axisDirection,
        angle: next.angle,
      })
      get().updateObject(obj.id, { positions })
    },

    bendPointerUp: () => {
      const { bendDraft } = get()
      if (!bendDraft || bendDraft.axisLocked) return
      set({
        bendDraft: {
          ...bendDraft,
          axisLocked: true,
          startClientX: bendDraft.startClientX,
          startClientY: bendDraft.startClientY,
          startAngle: bendDraft.angle,
        },
      } as unknown as Partial<S>)
    },

    bendStartAngleDrag: (clientX, clientY) => {
      const { bendDraft } = get()
      if (!bendDraft?.axisLocked) return
      set({
        bendDraft: {
          ...bendDraft,
          startClientX: clientX,
          startClientY: clientY,
          startAngle: bendDraft.angle,
        },
      } as unknown as Partial<S>)
    },

    bendCommit: () => {
      const { bendDraft } = get()
      if (!bendDraft) return
      get().replaceHistoryHead('Bend')
      set({ bendDraft: null } as unknown as Partial<S>)
    },

    bendCancel: () => {
      const { bendDraft } = get()
      if (!bendDraft) return
      get().pauseHistory()
      get().undo()
      get().resumeHistory()
      set({ bendDraft: null } as unknown as Partial<S>)
    },
  }
}
