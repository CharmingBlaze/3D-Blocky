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
import { stampDrawMaterial } from '../material/materialEditorSlice'
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

export type KnifeSnapKind = 'vertex' | 'edge' | 'face'

export interface KnifePoint {
  world: Vec3
  local: Vec3
  snap: KnifeSnapKind
}

export interface KnifeDraft {
  objectId: string
  points: KnifePoint[]
  hover: KnifePoint | null
  view: ViewType
  /** Camera forward at last hover/click — used for Enter-to-confirm. */
  viewForward: Vec3
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
  knifeHover: (objectId: string, point: KnifePoint, view: ViewType, viewForward: Vec3) => void
  knifeClearHover: () => void
  knifeAddPoint: (objectId: string, point: KnifePoint, view: ViewType, viewForward: Vec3) => void
  knifeApply: (viewForward?: Vec3) => void
  knifeCancel: () => void
  /** @deprecated use knifeAddPoint / knifeApply — kept for transitional call sites */
  knifePointerDown: (objectId: string, world: Vec3, view: ViewType) => void
  knifePointerMove: (world: Vec3) => void
  knifeCommit: (viewForward: Vec3) => void
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
      const state = get() as ReturnType<typeof get> & { drawDoubleSided?: boolean }
      const {
        polyDrawDraft,
        polyDrawMode,
        objects,
        activeColor,
        symmetryEnabled,
        symmetryAxis,
        symmetryPlane,
      } = state
      const drawDoubleSided = state.drawDoubleSided ?? false
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
      if (isNewObject) {
        nextObjects = nextObjects.map((o) =>
          o.id === result.primaryId ? stampDrawMaterial(o, drawDoubleSided) : o
        )
      }

      const facesToSelect = Array.from(
        { length: result.newFaceCount },
        (_, i) => result.newFaceStartIndex + i
      )
      const meshSelection = {
        objectId: result.primaryId,
        vertices: [],
        edges: [],
        faces: facesToSelect,
      }

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
            selectionMode: 'face',
            activeTool: 'select-face',
            toolCategory: 'select',
            meshSelection,
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
        selectionMode: 'face',
        activeTool: 'select-face',
        toolCategory: 'select',
        meshSelection,
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

    knifeHover: (objectId, point, view, viewForward) => {
      const prev = get().knifeDraft
      if (prev && prev.objectId !== objectId) {
        set({
          knifeDraft: {
            objectId,
            points: [],
            hover: { ...point },
            view,
            viewForward: { ...viewForward },
          },
          activeTool: 'knife',
        } as unknown as Partial<S>)
        return
      }
      set({
        knifeDraft: {
          objectId,
          points: prev?.points ?? [],
          hover: { ...point, world: { ...point.world }, local: { ...point.local } },
          view: prev?.view ?? view,
          viewForward: { ...viewForward },
        },
        activeTool: 'knife',
      } as unknown as Partial<S>)
    },

    knifeClearHover: () => {
      const { knifeDraft } = get()
      if (!knifeDraft?.hover) return
      set({ knifeDraft: { ...knifeDraft, hover: null } } as unknown as Partial<S>)
    },

    knifeAddPoint: (objectId, point, view, viewForward) => {
      const prev = get().knifeDraft
      const points =
        prev?.objectId === objectId ? [...prev.points] : ([] as KnifePoint[])
      const last = points[points.length - 1]
      if (
        last &&
        Math.hypot(
          last.local.x - point.local.x,
          last.local.y - point.local.y,
          last.local.z - point.local.z
        ) < 1e-5
      ) {
        return
      }
      points.push({
        world: { ...point.world },
        local: { ...point.local },
        snap: point.snap,
      })
      set({
        knifeDraft: {
          objectId,
          points,
          hover: null,
          view,
          viewForward: { ...viewForward },
        },
        activeTool: 'knife',
      } as unknown as Partial<S>)
    },

    knifeApply: (viewForward) => {
      const { knifeDraft, objects } = get()
      if (!knifeDraft || knifeDraft.points.length < 2) return
      const obj = objects.find((o) => o.id === knifeDraft.objectId)
      if (!obj || obj.topologyLocked) {
        set({ knifeDraft: null } as unknown as Partial<S>)
        return
      }

      const forward = viewForward ?? knifeDraft.viewForward
      const localForward = worldDeltaToLocal(obj, forward)
      let current = obj
      let applied = 0
      for (let i = 0; i + 1 < knifeDraft.points.length; i++) {
        const a = knifeDraft.points[i]!
        const b = knifeDraft.points[i + 1]!
        if (!knifeSegmentLongEnough(a.local, b.local)) continue
        const next = knifeCutObject(current, a.local, b.local, localForward)
        if (next !== current) {
          current = next
          applied++
        }
      }

      if (applied === 0) {
        set({ knifeDraft: null } as unknown as Partial<S>)
        return
      }

      get().updateObject(obj.id, {
        positions: current.positions,
        faces: current.faces,
        faceColors: current.faceColors,
        faceGroups: current.faceGroups,
        uvs: current.uvs,
        faceUvIndices: current.faceUvIndices,
      })
      set({ knifeDraft: null } as unknown as Partial<S>)
      get().commitHistory(applied === 1 ? 'Knife cut' : `Knife cut ×${applied}`)
    },

    knifeCancel: () => set({ knifeDraft: null } as unknown as Partial<S>),

    // Legacy drag API → maps onto point path (two-point stroke)
    knifePointerDown: (objectId, world, view) => {
      const obj = get().objects.find((o) => o.id === objectId)
      const local = obj ? localPointFromWorld(obj, world) : { ...world }
      get().knifeAddPoint(
        objectId,
        { world, local, snap: 'face' },
        view,
        { x: 0, y: 0, z: -1 }
      )
    },

    knifePointerMove: (world) => {
      const { knifeDraft, objects } = get()
      if (!knifeDraft) return
      const obj = objects.find((o) => o.id === knifeDraft.objectId)
      const local = obj ? localPointFromWorld(obj, world) : { ...world }
      set({
        knifeDraft: {
          ...knifeDraft,
          hover: { world: { ...world }, local, snap: 'face' },
        },
      } as unknown as Partial<S>)
    },

    knifeCommit: (viewForward) => {
      const { knifeDraft } = get()
      if (!knifeDraft) return
      if (knifeDraft.hover && knifeDraft.points.length >= 1) {
        get().knifeAddPoint(
          knifeDraft.objectId,
          knifeDraft.hover,
          knifeDraft.view,
          viewForward
        )
      }
      get().knifeApply(viewForward)
    },

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
