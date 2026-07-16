import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { localPointFromWorld, worldDeltaToLocal } from '../mesh/objectTransform'
import { knifeCutObject } from '../mesh/meshKnife'
import {
  attachKnifePoint,
  cleanupCutTopology,
  knifeCutPath,
  pathHasAttachments,
} from '../mesh/meshKnifePath'
import {
  knifePathOnMirrorPlane,
  knifeSegmentIsMirrorDuplicate,
  knifeSegmentLongEnough,
  mirrorKnifePath,
} from '../mesh/knifeUtils'
import {
  applyBendToObject,
  bendAngleFromScreenDelta,
  bendAxisDirection,
} from '../mesh/bendDeform'
import { cloneSceneObject } from '../mesh/meshOps'
import {
  findEdgeLoop,
  insertMultipleEdgeLoops,
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
import {
  polyDrawShapeHasArea,
  rectangleWorldPoints,
  regularPolygonWorldPoints,
} from '../polyDraw/polyDrawShapes'

export type PolyDrawMode = 'triangle' | 'quad' | 'poly' | 'rectangle' | 'ngon'

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
  /** Stable toward-camera normal captured when drawing begins. */
  viewFacingNormal?: Vec3
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
  numCuts: number
  locked: boolean
}

export type KnifeSnapKind = 'vertex' | 'edge' | 'face' | 'face-center' | 'grid' | 'path' | 'space'

export interface KnifePoint {
  world: Vec3
  local: Vec3
  snap: KnifeSnapKind
  /** Topology attachment (Blockbench-style) — used by path knife apply. */
  vertexIndex?: number | null
  edge?: [number, number] | null
  faceIndex?: number | null
}

export interface KnifeDraft {
  objectId: string
  points: KnifePoint[]
  hover: KnifePoint | null
  view: ViewType
  /** Camera forward at last hover/click — used for Enter-to-confirm. */
  viewForward: Vec3
  /** Non-destructive guidance when the current path cannot produce a cut. */
  feedback: string | null
  angleConstrained?: boolean
  completedPaths?: KnifePoint[][]
  cameraPosition?: Vec3
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
  polyDrawClick: (
    world: Vec3,
    snap: PolyDrawPointSnap | null,
    view: ViewType,
    viewFacingNormal?: Vec3
  ) => void
  polyDrawCancel: () => void
  polyDrawFinish: () => void
  flipLastPolyDrawFace: () => void
  loopCutBegin: (objectId: string, seedEdge: string, locked?: boolean) => void
  loopCutSetT: (t: number) => void
  loopCutAdjustWheel: (deltaY: number) => void
  loopCutAdjustCount: (delta: number) => void
  loopCutCommit: () => void
  loopCutCancel: () => void
  knifeHover: (objectId: string, point: KnifePoint, view: ViewType, viewForward: Vec3, cameraPosition?: Vec3) => void
  knifeClearHover: () => void
  knifeAddPoint: (objectId: string, point: KnifePoint, view: ViewType, viewForward: Vec3, cameraPosition?: Vec3) => void
  knifeRemoveLastPoint: () => void
  knifeApply: (viewForward?: Vec3) => void
  knifeCancel: () => void
  knifeToggleAngleConstrained: () => void
  knifeStartNewPath: () => void
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
  polyDrawMode: 'rectangle',
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
  activeTool: string
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

    polyDrawClick: (world, snap, view, viewFacingNormal) => {
      const { polyDrawDraft, polyDrawMode } = get()
      const now = performance.now()

      const draft: PolyDrawDraft = polyDrawDraft ?? {
        points: [],
        view,
        viewFacingNormal: viewFacingNormal ? { ...viewFacingNormal } : undefined,
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
      let shouldAutoFinish = autoCount !== null && nextPoints.length >= autoCount
      let committedPoints = nextPoints
      if (shouldAutoFinish && polyDrawMode === 'rectangle') {
        const worlds = rectangleWorldPoints(nextPoints[0]!.world, nextPoints[1]!.world, view)
        if (polyDrawShapeHasArea(worlds)) {
          committedPoints = worlds.map((point, index) => ({
            world: point,
            ...(index === 0 ? { snap: nextPoints[0]!.snap } : {}),
            ...(index === 2 ? { snap: nextPoints[1]!.snap } : {}),
          }))
        } else {
          committedPoints = [nextPoints[0]!]
          shouldAutoFinish = false
        }
      } else if (shouldAutoFinish && polyDrawMode === 'ngon') {
        const worlds = regularPolygonWorldPoints(nextPoints[0]!.world, nextPoints[1]!.world, view)
        if (polyDrawShapeHasArea(worlds)) {
          committedPoints = worlds.map((point, index) => ({
            world: point,
            ...(index === 0 ? { snap: nextPoints[1]!.snap } : {}),
          }))
        } else {
          committedPoints = [nextPoints[0]!]
          shouldAutoFinish = false
        }
      }

      set({
        polyDrawDraft: {
          ...draft,
          points: committedPoints,
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
      if ((polyDrawMode === 'quad' || polyDrawMode === 'rectangle') && polyDrawDraft.points.length < 4) return
      if (polyDrawMode === 'triangle' && polyDrawDraft.points.length < 3) return

      const result = commitPolyDrawFace(polyDrawDraft.points, objects, {
        mode: polyDrawMode,
        color: activeColor,
        view: polyDrawDraft.view,
        facingNormal: polyDrawDraft.viewFacingNormal,
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
            polyDrawHover: null,
            selectionMode: 'object',
            activeTool: 'poly-draw',
            toolCategory: 'draw',
            meshSelection: null,
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
        polyDrawHover: null,
        selectionMode: 'object',
        activeTool: 'poly-draw',
        toolCategory: 'draw',
        meshSelection: null,
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

    loopCutBegin: (objectId, seedEdge, locked = false) => {
      const obj = get().objects.find((o) => o.id === objectId)
      if (!obj || obj.topologyLocked) return
      if (!isValidLoopSeed(obj, seedEdge)) return

      const prev = get().loopCutDraft
      const numCuts = prev?.seedEdge === seedEdge ? prev.numCuts : 1
      const loopEdges = findEdgeLoop(obj, seedEdge)

      set({
        loopCutDraft: { objectId, seedEdge, loopEdges, t: prev?.seedEdge === seedEdge ? prev.t : 0.5, numCuts, locked },
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

    loopCutAdjustCount: (delta) => {
      const { loopCutDraft } = get()
      if (!loopCutDraft) return
      const numCuts = Math.max(1, Math.min(32, (loopCutDraft.numCuts ?? 1) + delta))
      set({
        loopCutDraft: { ...loopCutDraft, numCuts },
      } as unknown as Partial<S>)
    },

    loopCutCommit: () => {
      const { loopCutDraft, objects } = get()
      if (!loopCutDraft) return
      const obj = objects.find((o) => o.id === loopCutDraft.objectId)
      if (!obj || obj.topologyLocked) {
        set({ loopCutDraft: null } as unknown as Partial<S>)
        return
      }

      const numCuts = loopCutDraft.numCuts ?? 1
      const factor = (loopCutDraft.t - 0.5) * 2 // Translate t [0, 1] to slide factor [-1, 1]

      const tValues: number[] = []
      for (let i = 0; i < numCuts; i++) {
        const tDefault = (i + 1) / (numCuts + 1)
        if (factor > 0) {
          tValues.push(tDefault + factor * (1 - tDefault))
        } else if (factor < 0) {
          tValues.push(tDefault + factor * tDefault)
        } else {
          tValues.push(tDefault)
        }
      }

      const cut = insertMultipleEdgeLoops(obj, loopCutDraft.loopEdges, loopCutDraft.seedEdge, tValues)
      const cleaned = cleanupCutTopology(cut)
      get().updateObject(obj.id, {
        positions: cleaned.positions,
        faces: cleaned.faces,
        faceColors: cleaned.faceColors,
        faceGroups: cleaned.faceGroups,
        uvs: cleaned.uvs,
        faceUvIndices: cleaned.faceUvIndices,
      })
      set({ loopCutDraft: null } as unknown as Partial<S>)
      get().commitHistory(numCuts === 1 ? 'Loop cut' : `Loop cut ×${numCuts}`)
    },

    loopCutCancel: () => set({ loopCutDraft: null } as unknown as Partial<S>),

    knifeHover: (objectId, point, view, viewForward, cameraPosition) => {
      const prev = get().knifeDraft
      const keepTool = get().activeTool === 'mirror-knife' ? 'mirror-knife' : 'knife'
      if (prev && prev.objectId !== objectId) {
        set({
          knifeDraft: {
            objectId,
            points: [],
            hover: { ...point },
            view,
            viewForward: { ...viewForward },
            feedback: null,
            cameraPosition,
          },
          activeTool: keepTool,
        } as unknown as Partial<S>)
        return
      }
      set({
        knifeDraft: {
          objectId,
          points: prev?.points ?? [],
          hover: { ...point, world: { ...point.world }, local: { ...point.local } },
          view: prev?.view ?? view,
          viewForward: prev?.points.length ? prev.viewForward : { ...viewForward },
          feedback: null,
          angleConstrained: prev?.angleConstrained,
          completedPaths: prev?.completedPaths,
          cameraPosition: prev?.points.length ? prev.cameraPosition : (cameraPosition ?? prev?.cameraPosition),
        },
        activeTool: keepTool,
      } as unknown as Partial<S>)
    },

    knifeClearHover: () => {
      const { knifeDraft } = get()
      if (!knifeDraft?.hover) return
      set({ knifeDraft: { ...knifeDraft, hover: null } } as unknown as Partial<S>)
    },

    knifeAddPoint: (objectId, point, view, viewForward, cameraPosition) => {
      const prev = get().knifeDraft
      const keepTool = get().activeTool === 'mirror-knife' ? 'mirror-knife' : 'knife'
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
        vertexIndex: point.vertexIndex ?? null,
        edge: point.edge ? [point.edge[0], point.edge[1]] : null,
        faceIndex: point.faceIndex ?? null,
      })
      set({
        knifeDraft: {
          objectId,
          points,
          hover: null,
          view,
          viewForward: prev?.points.length ? prev.viewForward : { ...viewForward },
          feedback: null,
          angleConstrained: prev?.angleConstrained,
          completedPaths: prev?.completedPaths,
          cameraPosition: prev?.points.length ? prev.cameraPosition : (cameraPosition ?? prev?.cameraPosition),
        },
        activeTool: keepTool,
      } as unknown as Partial<S>)
    },

    knifeRemoveLastPoint: () => {
      const { knifeDraft } = get()
      if (!knifeDraft) return
      if (knifeDraft.points.length > 0) {
        if (knifeDraft.points.length === 1 && (!knifeDraft.completedPaths || knifeDraft.completedPaths.length === 0)) {
          set({ knifeDraft: null } as unknown as Partial<S>)
          return
        }
        set({
          knifeDraft: {
            ...knifeDraft,
            points: knifeDraft.points.slice(0, -1),
            hover: null,
            feedback: null,
          },
        } as unknown as Partial<S>)
        return
      }

      // Active path is empty, try to restore the last completed path
      if (knifeDraft.completedPaths && knifeDraft.completedPaths.length > 0) {
        const nextCompleted = [...knifeDraft.completedPaths]
        const restored = nextCompleted.pop()!
        set({
          knifeDraft: {
            ...knifeDraft,
            completedPaths: nextCompleted,
            points: restored,
            hover: null,
            feedback: null,
          },
        } as unknown as Partial<S>)
      }
    },

    knifeApply: (viewForward) => {
      const { knifeDraft, objects, activeTool } = get()
      if (!knifeDraft) return

      const allPaths = [...(knifeDraft.completedPaths ?? []), knifeDraft.points].filter((p) => p.length >= 2)
      if (allPaths.length === 0) return

      const obj = objects.find((o) => o.id === knifeDraft.objectId)
      if (!obj || obj.topologyLocked) {
        set({
          knifeDraft: {
            ...knifeDraft,
            hover: null,
            feedback: obj?.topologyLocked ? 'Unlock topology before cutting' : 'Mesh is no longer available',
          },
        } as unknown as Partial<S>)
        return
      }

      const forward = viewForward ?? knifeDraft.viewForward
      const hasCam = knifeDraft.cameraPosition && knifeDraft.view === 'perspective'
      const localCamPos = hasCam ? localPointFromWorld(obj, knifeDraft.cameraPosition!) : null
      let current = obj
      let applied = 0

      const planeForwardForSegment = (aLocal: Vec3, bLocal: Vec3): Vec3 => {
        if (localCamPos) {
          const mid = {
            x: (aLocal.x + bLocal.x) * 0.5,
            y: (aLocal.y + bLocal.y) * 0.5,
            z: (aLocal.z + bLocal.z) * 0.5,
          }
          return {
            x: mid.x - localCamPos.x,
            y: mid.y - localCamPos.y,
            z: mid.z - localCamPos.z,
          }
        }
        return worldDeltaToLocal(obj, forward)
      }

      /** Blockbench path remesh when attachments exist; plane bridge otherwise. */
      const applyPath = (path: KnifePoint[]): number => {
        let cuts = 0
        if (pathHasAttachments(path)) {
          const next = knifeCutPath(current, path)
          if (next !== current) {
            current = next
            cuts++
            return cuts
          }
        }
        // Fallback / bridge: view-plane cut per segment (intermediate faces).
        for (let i = 0; i + 1 < path.length; i++) {
          const a = path[i]!
          const b = path[i + 1]!
          if (!knifeSegmentLongEnough(a.local, b.local)) continue
          const next = knifeCutObject(
            current,
            a.local,
            b.local,
            planeForwardForSegment(a.local, b.local)
          )
          if (next !== current) {
            current = next
            cuts++
          }
        }
        return cuts
      }

      // 1. Apply primary cuts (Blockbench-style path remesh).
      for (const path of allPaths) {
        applied += applyPath(path)
      }

      // 2. Mirror knife: mirror the path, reattach to topology, remesh both sides.
      // Post-weld cleans seam duplicate verts (Blockbench auto-merge idea).
      if (activeTool === 'mirror-knife') {
        const { symmetryAxis, symmetryPlane } = get()
        for (const path of allPaths) {
          if (knifePathOnMirrorPlane(path, symmetryAxis, symmetryPlane)) continue

          const mirroredPath = mirrorKnifePath(path, current, symmetryAxis, symmetryPlane)
          if (
            path.length >= 2 &&
            knifeSegmentIsMirrorDuplicate(
              path[0]!.local,
              path[path.length - 1]!.local,
              mirroredPath[0]!.local,
              mirroredPath[mirroredPath.length - 1]!.local
            )
          ) {
            continue
          }

          const reattached: KnifePoint[] = mirroredPath.map((p) => {
            const att = attachKnifePoint(current, p.local, null)
            return {
              world: { ...p.world },
              local: att.local,
              snap: (att.snap as KnifePoint['snap']) ?? 'face',
              vertexIndex: att.vertexIndex ?? null,
              edge: att.edge ?? null,
              faceIndex: att.faceIndex ?? null,
            }
          })
          applied += applyPath(reattached)
        }
      }

      if (applied > 0) {
        current = cleanupCutTopology(current)
      }

      if (applied === 0) {
        set({
          knifeDraft: {
            ...knifeDraft,
            hover: null,
            feedback: 'No visible face was crossed — adjust the cut points',
          },
        } as unknown as Partial<S>)
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

    knifeToggleAngleConstrained: () => {
      const { knifeDraft } = get()
      if (!knifeDraft) return
      set({
        knifeDraft: {
          ...knifeDraft,
          angleConstrained: !knifeDraft.angleConstrained,
          feedback: null,
        },
      } as unknown as Partial<S>)
    },

    knifeStartNewPath: () => {
      const { knifeDraft } = get()
      if (!knifeDraft || knifeDraft.points.length === 0) return
      const completed = knifeDraft.completedPaths ?? []
      set({
        knifeDraft: {
          ...knifeDraft,
          completedPaths: [...completed, knifeDraft.points],
          points: [],
          hover: null,
          feedback: null,
        },
      } as unknown as Partial<S>)
    },

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
          feedback: null,
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
