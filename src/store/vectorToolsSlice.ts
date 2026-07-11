import { attachVectorSource } from '../vector/vectorSource'
import { vectorPathToMesh } from '../vector/vectorPathToMesh'
import { emptyVectorDocument, type VectorDocument, type VectorPath, type VectorAnchor, type ShapeKind } from '../vector/types'
import {
  findNearestPathEndpoint,
  snapPointToEndpoint,
  cloneAnchors,
} from '../vector/autoConnect'
import {
  createAnchor,
  finalizePendingAnchor,
  applySmoothHandles,
  isNearPoint,
  mirrorHandle,
} from '../vector/penTool'
import { vectorShapeToObject } from '../mesh/lowPolyPrimitives'
import {
  clampRoundness,
  clampRoundedBoxSubdivisions,
  type RoundedBoxParams,
} from '../mesh/roundedBox'
import { generateId, type Vec2, type Vec3 } from '../utils/math'
import type { PrimitiveBoxType } from '../primitives/primitivesBox'
import {
  baseBoxFromPlaneCorners,
  baseBoxFromGroundCorners,
  extrudeFlatBoxToHeight,
  extrudeBoxOnHeightAxis,
  flattenBoxOnHeightAxis,
  startPerspectivePrimitiveBoxSession,
  startPrimitiveBoxSession,
  type WorldBox,
} from '../primitives/primitiveBoxMath'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { canExtrudeHeightInView, isOrthoView, type Axis } from '../primitives/viewAxes'
import { maxRoundedBoxSubdivisionsForBudget } from '../mesh/meshPolyBudget'
import type { ViewType, OrthoViewType } from '../scene/viewTypes'
import { clearStrokeDraftState } from './strokeSlice'

type UvTextureInfo = {
  url: string
  name: string
  width: number
  height: number
}

export type PrimitiveKind = PrimitiveBoxType
export type PrimitiveBoxPhase = 'drawingBase' | 'drawingHeight' | 'scrollHeight'

export interface PrimitiveBoxDraft {
  phase: PrimitiveBoxPhase
  baseView: ViewType
  heightAxis: Axis
  box: WorldBox
  baseBoxLocked: WorldBox
  baseCornerA: Vec2
  baseCornerB: Vec2
  heightCornerA: Vec2 | null
  heightCornerB: Vec2 | null
  heightView: OrthoViewType | null
  worldCornerA?: Vec3
  worldCornerB?: Vec3
  groundY?: number
  scrollHeight?: number
}

export interface VectorPenDraft {
  anchors: VectorAnchor[]
  view: ViewType
  previewPoint: { x: number; y: number } | null
  pendingAnchorIndex: number | null
  continuePathId: string | null
  closeTargetActive: boolean
  /** Loop marked closed in 2D — mesh is not created until Enter commits. */
  closed: boolean
  editDrag?: {
    type: 'anchor' | 'inHandle' | 'outHandle'
    index: number
    startPoint: { x: number; y: number }
  }
}

export interface VectorToolsLayoutState {
  lastPenEndpoint: { view: ViewType; position: { x: number; y: number } } | null
  lastPenClickAt: number
  vectorDocument: VectorDocument
  vectorDraft: { x: number; y: number }[]
  vectorDraftView: ViewType | null
  vectorIsDrawing: boolean
  vectorPenDraft: VectorPenDraft | null
  activeShapeKind: ShapeKind
  activePrimitiveKind: PrimitiveKind | null
  roundedBoxRoundness: number
  roundedBoxSubdivisions: number
  primitiveBoxDraft: PrimitiveBoxDraft | null
}

export interface VectorToolsLayoutActions {
  startVectorStroke: (point: { x: number; y: number }, view: ViewType) => void
  continueVectorStroke: (point: { x: number; y: number }) => void
  endVectorStroke: (view: ViewType) => void
  penPointerDown: (point: { x: number; y: number }, view: ViewType) => void
  penPointerMove: (point: { x: number; y: number }, options?: { altKey?: boolean }) => void
  penPointerUp: (point: { x: number; y: number }, options?: { altKey?: boolean }) => void
  penFinishPath: () => void
  penCancelPath: () => void
  commitPenPath: (closed: boolean) => void
  commitVectorPath: (path: VectorPath, options?: { skipHistory?: boolean; skipSymmetry?: boolean }) => void
  commitVectorShape: (
    kind: ShapeKind,
    a: { x: number; y: number },
    b: { x: number; y: number },
    view: ViewType
  ) => void
  setActiveShapeKind: (kind: ShapeKind) => void
  setActivePrimitiveKind: (kind: PrimitiveKind | null) => void
  setRoundedBoxRoundness: (value: number) => void
  setRoundedBoxSubdivisions: (value: number) => void
  adjustRoundedBoxWheel: (deltaY: number, shiftKey: boolean) => boolean
  cancelPrimitiveBoxDraft: () => void
  primitiveBoxPointerDown: (
    point: Vec2,
    view: ViewType,
    shiftKey: boolean,
    worldPoint?: Vec3
  ) => void
  primitiveBoxPointerMove: (
    point: Vec2,
    view: ViewType,
    shiftKey: boolean,
    worldPoint?: Vec3
  ) => void
  primitiveBoxPointerUp: (point: Vec2, view: ViewType, shiftKey: boolean, worldPoint?: Vec3) => void
  adjustPrimitiveBoxWheel: (deltaY: number) => void
  setPrimitiveBoxScrollHeight: (height: number) => void
  commitPrimitiveBox: () => void
}

export type VectorToolsSlice = VectorToolsLayoutState & VectorToolsLayoutActions

export const vectorToolsInitialState: VectorToolsLayoutState = {
  lastPenEndpoint: null,
  lastPenClickAt: 0,
  vectorDocument: emptyVectorDocument(),
  vectorDraft: [],
  vectorDraftView: null,
  vectorIsDrawing: false,
  vectorPenDraft: null,
  activeShapeKind: 'sphere',
  activePrimitiveKind: null,
  roundedBoxRoundness: 0.25,
  roundedBoxSubdivisions: 2,
  primitiveBoxDraft: null,
}

export function clearVectorDraftState(): Pick<
  VectorToolsLayoutState,
  | 'vectorDraft'
  | 'vectorDraftView'
  | 'vectorIsDrawing'
  | 'vectorPenDraft'
  | 'primitiveBoxDraft'
> {
  return {
    vectorDraft: [],
    vectorDraftView: null,
    vectorIsDrawing: false,
    vectorPenDraft: null,
    primitiveBoxDraft: null,
  }
}

function withoutObjectTexture(
  objectTextures: Record<string, UvTextureInfo>,
  objectId: string
): Record<string, UvTextureInfo> {
  if (!objectTextures[objectId]) return objectTextures
  const next = { ...objectTextures }
  delete next[objectId]
  return next
}

export interface VectorToolsSliceDeps {
  reconcileBlobUrls: () => void
}

type VectorStore = VectorToolsLayoutState & {
  addObject: (
    obj: import('../mesh/HalfEdgeMesh').SceneObject,
    options?: { skipHistory?: boolean; skipSymmetry?: boolean }
  ) => void
  commitHistory: (label?: string) => boolean
  clearExtrudeDrag: () => void
  autoConnectPaths: boolean
  closeThreshold: number
  polyBudget: number
  brushDensity: number
  strokeMode: import('./strokeSlice').StrokeMode
  rdpTolerance: number
  defaultDepth: number
  facetExaggeration: number
  penExtrudeMode: boolean
  penLatheMode: boolean
  penLatheCaps: boolean
  extrudeAmount: number
  activeColor: number
  activeTool: string
  toolCategory: string
  objects: import('../mesh/HalfEdgeMesh').SceneObject[]
  objectTextures: Record<string, UvTextureInfo>
}

export function createVectorToolsSlice<T extends VectorToolsLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & VectorToolsLayoutActions,
  deps: VectorToolsSliceDeps
): VectorToolsLayoutActions {
  const store = () => get() as T & VectorToolsLayoutActions & VectorStore
  const setPartial = (partial: object | ((state: T) => object)) => {
    if (typeof partial === 'function') {
      set((state) => partial(state) as Partial<T>)
    } else {
      set(partial as unknown as Partial<T>)
    }
  }

  return {
    startVectorStroke: (point, view) =>
      setPartial({ vectorDraft: [point], vectorIsDrawing: true, vectorDraftView: view }),

    continueVectorStroke: (point) =>
      setPartial((s) => {
        if (!s.vectorIsDrawing || s.vectorDraft.length === 0) return {}
        if ((s as unknown as VectorStore).activeTool !== 'vector-shape') return {}

        return { vectorDraft: [s.vectorDraft[0], point] }
      }),

    penPointerDown: (point, view) => {
      const {
        vectorPenDraft,
        closeThreshold,
        autoConnectPaths,
        vectorDocument,
        lastPenEndpoint,
      } = store()

      let pt = { ...point }
      const draft = vectorPenDraft?.view === view ? vectorPenDraft : null
      // Generous close hit so first-point connect wins over handles / nearby nodes.
      const closeHit = closeThreshold * 3

      // Click near first anchor: mark closed in 2D only — keep editing until Enter.
      if (draft && draft.anchors.length >= 3 && !draft.closed) {
        const first = draft.anchors[0].position
        if (isNearPoint(pt, first, closeHit)) {
          let anchors = draft.anchors.map((a) => ({
            ...a,
            position: { ...a.position },
            inHandle: a.inHandle ? { ...a.inHandle } : null,
            outHandle: a.outHandle ? { ...a.outHandle } : null,
          }))
          // Drop a dangling pending node sitting on the close target.
          if (
            draft.pendingAnchorIndex !== null &&
            draft.pendingAnchorIndex === anchors.length - 1 &&
            anchors.length > 3 &&
            isNearPoint(anchors[draft.pendingAnchorIndex]!.position, first, closeHit)
          ) {
            anchors = anchors.slice(0, -1)
          }
          setPartial({
            vectorPenDraft: {
              ...draft,
              anchors,
              closed: true,
              closeTargetActive: true,
              previewPoint: { ...first },
              pendingAnchorIndex: null,
              editDrag: undefined,
            },
          })
          return
        }
      }

      if (draft) {
        const threshold = closeThreshold * 1.5
        // Check handles of all anchors (skip first while closable — handles steal close clicks)
        for (let i = 0; i < draft.anchors.length; i++) {
          if (!draft.closed && draft.anchors.length >= 3 && i === 0) continue
          const a = draft.anchors[i]
          if (a.inHandle && isNearPoint(pt, a.inHandle, threshold)) {
            setPartial({
              vectorPenDraft: {
                ...draft,
                editDrag: { type: 'inHandle', index: i, startPoint: { ...pt } },
              },
            })
            return
          }
          if (a.outHandle && isNearPoint(pt, a.outHandle, threshold)) {
            setPartial({
              vectorPenDraft: {
                ...draft,
                editDrag: { type: 'outHandle', index: i, startPoint: { ...pt } },
              },
            })
            return
          }
        }
        // Check positions of all anchors
        for (let i = 0; i < draft.anchors.length; i++) {
          if (!draft.closed && draft.anchors.length >= 3 && i === 0) continue
          const a = draft.anchors[i]
          if (isNearPoint(pt, a.position, threshold)) {
            setPartial({
              vectorPenDraft: {
                ...draft,
                editDrag: { type: 'anchor', index: i, startPoint: { ...pt } },
              },
            })
            return
          }
        }

        // Closed drafts stay editable (handles/anchors) until Enter — no new points.
        if (draft.closed) return
      }

      if (!draft) {
        let anchors = [createAnchor(pt, generateId())]
        let continuePathId: string | null = null

        if (autoConnectPaths) {
          const hit = findNearestPathEndpoint(
            pt,
            view,
            vectorDocument.paths,
            closeThreshold * 1.5
          )
          if (hit) {
            pt = snapPointToEndpoint(pt, hit)
            if (
              !hit.path.closed &&
              hit.isStart &&
              hit.path.anchors.length >= 3 &&
              isNearPoint(pt, hit.path.anchors[0].position, closeThreshold * 3)
            ) {
              // Resume as a closed 2D draft — commit only on Enter.
              setPartial({
                vectorPenDraft: {
                  anchors: cloneAnchors(hit.path),
                  view,
                  previewPoint: pt,
                  pendingAnchorIndex: null,
                  continuePathId: hit.pathId,
                  closeTargetActive: true,
                  closed: true,
                },
              })
              return
            }
            if (!hit.path.closed && hit.isEnd && hit.path.anchors.length >= 1) {
              anchors = cloneAnchors(hit.path)
              anchors[anchors.length - 1] = {
                ...anchors[anchors.length - 1],
                position: { ...pt },
              }
              continuePathId = hit.pathId
            } else if (hit.isEnd || hit.isStart) {
              anchors = [createAnchor(pt, generateId())]
            }
          } else if (
            lastPenEndpoint?.view === view &&
            isNearPoint(pt, lastPenEndpoint.position, closeThreshold * 1.5)
          ) {
            pt = { ...lastPenEndpoint.position }
            anchors = [createAnchor(pt, generateId())]
          }
        }

        setPartial({
          vectorPenDraft: {
            anchors,
            view,
            previewPoint: pt,
            pendingAnchorIndex: null,
            continuePathId,
            closeTargetActive: false,
            closed: false,
          },
        })
        return
      }

      if (draft.pendingAnchorIndex !== null) return

      // Placing a node on the start point closes the loop instead of stacking a duplicate.
      if (
        !draft.closed &&
        draft.anchors.length >= 3 &&
        isNearPoint(pt, draft.anchors[0].position, closeThreshold * 3)
      ) {
        const first = draft.anchors[0].position
        setPartial({
          vectorPenDraft: {
            ...draft,
            closed: true,
            closeTargetActive: true,
            previewPoint: { ...first },
            pendingAnchorIndex: null,
            editDrag: undefined,
          },
        })
        return
      }

      if (autoConnectPaths) {
        const hit = findNearestPathEndpoint(
          pt,
          view,
          vectorDocument.paths.filter((p) => p.id !== draft.continuePathId),
          closeThreshold * 1.5
        )
        if (hit) pt = snapPointToEndpoint(pt, hit)
      }

      const anchors = draft.anchors.map((a) => ({
        ...a,
        position: { ...a.position },
        inHandle: a.inHandle ? { ...a.inHandle } : null,
        outHandle: a.outHandle ? { ...a.outHandle } : null,
      }))
      const newIndex = anchors.length
      anchors.push(createAnchor(pt, generateId()))

      setPartial({
        vectorPenDraft: {
          ...draft,
          anchors,
          previewPoint: pt,
          pendingAnchorIndex: newIndex,
          closeTargetActive: false,
          closed: false,
        },
      })
    },

    penPointerMove: (point, options) => {
      const { vectorPenDraft, closeThreshold } = store()
      if (!vectorPenDraft) return

      if (vectorPenDraft.editDrag) {
        const { type, index } = vectorPenDraft.editDrag
        const anchors = vectorPenDraft.anchors.map((a) => ({
          ...a,
          position: { ...a.position },
          inHandle: a.inHandle ? { ...a.inHandle } : null,
          outHandle: a.outHandle ? { ...a.outHandle } : null,
        }))
        const anchor = anchors[index]
        if (anchor) {
          if (type === 'anchor') {
            const dx = point.x - anchor.position.x
            const dy = point.y - anchor.position.y
            anchor.position.x = point.x
            anchor.position.y = point.y
            if (anchor.inHandle) {
              anchor.inHandle.x += dx
              anchor.inHandle.y += dy
            }
            if (anchor.outHandle) {
              anchor.outHandle.x += dx
              anchor.outHandle.y += dy
            }
          } else if (type === 'inHandle') {
            anchor.inHandle = { ...point }
            if (!options?.altKey && anchor.outHandle) {
              anchor.outHandle = mirrorHandle(anchor.position, point)
            }
          } else if (type === 'outHandle') {
            anchor.outHandle = { ...point }
            if (!options?.altKey && anchor.inHandle) {
              anchor.inHandle = mirrorHandle(anchor.position, point)
            }
          }
        }
        setPartial({
          vectorPenDraft: {
            ...vectorPenDraft,
            anchors,
            previewPoint: point,
          },
        })
        return
      }

      const first = vectorPenDraft.anchors[0]?.position
      const closeHit = closeThreshold * 3
      const closeTargetActive =
        vectorPenDraft.closed ||
        (!!first &&
          vectorPenDraft.anchors.length >= 3 &&
          vectorPenDraft.pendingAnchorIndex === null &&
          isNearPoint(point, first, closeHit))

      const anchors = vectorPenDraft.anchors.map((a) => ({
        ...a,
        position: { ...a.position },
        inHandle: a.inHandle ? { ...a.inHandle } : null,
        outHandle: a.outHandle ? { ...a.outHandle } : null,
      }))

      if (vectorPenDraft.pendingAnchorIndex !== null) {
        applySmoothHandles(anchors, vectorPenDraft.pendingAnchorIndex, point)
      }

      setPartial({
        vectorPenDraft: {
          ...vectorPenDraft,
          anchors,
          previewPoint: closeTargetActive && first ? { ...first } : point,
          closeTargetActive,
        },
      })
    },

    penPointerUp: (point, options) => {
      const { vectorPenDraft } = store()
      if (!vectorPenDraft) return

      if (vectorPenDraft.editDrag) {
        setPartial({
          vectorPenDraft: {
            ...vectorPenDraft,
            editDrag: undefined,
          },
        })
        return
      }

      if (vectorPenDraft.pendingAnchorIndex === null) {
        if (vectorPenDraft) {
          setPartial({ vectorPenDraft: { ...vectorPenDraft, previewPoint: point } })
        }
        return
      }

      const anchors = vectorPenDraft.anchors.map((a) => ({
        ...a,
        position: { ...a.position },
        inHandle: a.inHandle ? { ...a.inHandle } : null,
        outHandle: a.outHandle ? { ...a.outHandle } : null,
      }))

      finalizePendingAnchor(
        anchors,
        vectorPenDraft.pendingAnchorIndex,
        point,
        options?.altKey
      )

      setPartial({
        vectorPenDraft: {
          ...vectorPenDraft,
          anchors,
          previewPoint: point,
          pendingAnchorIndex: null,
        },
      })
    },

    penFinishPath: () => {
      const { vectorPenDraft, closeThreshold } = store()
      if (!vectorPenDraft) return

      let closed = vectorPenDraft.closed
      if (!closed && vectorPenDraft.anchors.length >= 3 && vectorPenDraft.pendingAnchorIndex === null) {
        const first = vectorPenDraft.anchors[0].position
        const last = vectorPenDraft.anchors[vectorPenDraft.anchors.length - 1].position
        closed =
          vectorPenDraft.closeTargetActive ||
          isNearPoint(first, last, closeThreshold * 3)
      }

      store().commitPenPath(closed)
    },

    penCancelPath: () => {
      store().clearExtrudeDrag()
      setPartial({ vectorPenDraft: null })
    },

    commitPenPath: (closed: boolean) => {
      const { vectorPenDraft, activeColor, commitVectorPath } = store()
      if (!vectorPenDraft) return
      if (vectorPenDraft.pendingAnchorIndex !== null) return

      const minAnchors = closed ? 3 : 2
      if (vectorPenDraft.anchors.length < minAnchors) {
        setPartial({ vectorPenDraft: null })
        return
      }

      const continuePathId = vectorPenDraft.continuePathId
      const prev = continuePathId
        ? get().vectorDocument.paths.find((p) => p.id === continuePathId)
        : null

      const path: VectorPath = {
        id: continuePathId ?? generateId(),
        anchors: vectorPenDraft.anchors.map((a) => ({
          ...a,
          position: { ...a.position },
          inHandle: a.inHandle ? { ...a.inHandle } : null,
          outHandle: a.outHandle ? { ...a.outHandle } : null,
        })),
        closed,
        view: vectorPenDraft.view,
        color: activeColor,
        source: 'pen',
      }

      const lastAnchor = path.anchors[path.anchors.length - 1].position

      if (continuePathId) {
        setPartial((s) => {
          const st = s as unknown as VectorStore
          return {
            vectorPenDraft: null,
            objects: prev?.objectId
              ? st.objects.filter((o) => o.id !== prev.objectId)
              : st.objects,
            objectTextures: prev?.objectId
              ? withoutObjectTexture(st.objectTextures, prev.objectId)
              : st.objectTextures,
            vectorDocument: {
              ...s.vectorDocument,
              paths: s.vectorDocument.paths.filter((p) => p.id !== continuePathId),
            },
          }
        })
        deps.reconcileBlobUrls()
      } else {
        setPartial({ vectorPenDraft: null })
      }

      commitVectorPath(path, { skipHistory: !!continuePathId })
      if (continuePathId) store().commitHistory('Connect pen path')

      store().clearExtrudeDrag()
      setPartial({
        lastPenEndpoint: { view: path.view, position: { ...lastAnchor } },
      })
    },

    endVectorStroke: (view) => {
      const {
        vectorDraft,
        vectorDraftView,
        activeTool,
        activeShapeKind,
        commitVectorShape,
      } = store()

      if (vectorDraft.length < 2 || view === 'perspective') {
        setPartial({ vectorDraft: [], vectorIsDrawing: false, vectorDraftView: null })
        return
      }

      if (activeTool !== 'vector-shape') {
        setPartial({ vectorDraft: [], vectorIsDrawing: false, vectorDraftView: null })
        return
      }

      if (vectorDraftView !== null && vectorDraftView !== view) {
        return
      }

      if (activeTool === 'vector-shape') {
        const a = vectorDraft[0]
        const b = vectorDraft[vectorDraft.length - 1]
        const span = Math.hypot(b.x - a.x, b.y - a.y)
        if (span < 3) {
          setPartial({ vectorDraft: [], vectorIsDrawing: false, vectorDraftView: null })
          return
        }

        commitVectorShape(activeShapeKind, a, b, view)
      }

      setPartial({ vectorDraft: [], vectorIsDrawing: false, vectorDraftView: null })
    },

    commitVectorPath: (path, options?: { skipHistory?: boolean; skipSymmetry?: boolean }) => {
      const {
        polyBudget,
        brushDensity,
        strokeMode,
        rdpTolerance,
        closeThreshold,
        defaultDepth,
        facetExaggeration,
        penExtrudeMode,
        penLatheMode,
        penLatheCaps,
        extrudeAmount,
      } = store()

      const obj = vectorPathToMesh(path, {
        view: path.view,
        polyBudget,
        brushDensity,
        strokeMode,
        rdpTolerance,
        closeThreshold,
        defaultDepth,
        color: path.color,
        stylize: facetExaggeration,
        extrudeMode: penLatheMode ? false : penExtrudeMode,
        latheMode: penLatheMode,
        latheCaps: penLatheCaps,
        extrudeAmount,
      })

      const pathWithObject = { ...path, objectId: obj?.id }

      const objToAdd =
        obj && path.source === 'pen'
          ? attachVectorSource(obj, {
              path: pathWithObject,
              strokeMode: penExtrudeMode ? 'outline' : strokeMode,
              extrudeMode: penExtrudeMode,
              brushDensity,
              rdpTolerance,
              closeThreshold,
              defaultDepth,
              stylize: facetExaggeration,
              extrudeDepth: extrudeAmount,
            })
          : obj

      if (objToAdd) {
        store().addObject(objToAdd, { skipHistory: options?.skipHistory, skipSymmetry: options?.skipSymmetry })
      }

      setPartial((s) => ({
        vectorDocument: {
          ...s.vectorDocument,
          paths: [...s.vectorDocument.paths, pathWithObject],
        },
      }))
    },

    commitVectorShape: (kind, a, b, view) => {
      const {
        polyBudget,
        defaultDepth,
        activeColor,
        roundedBoxRoundness,
        roundedBoxSubdivisions,
      } = store()
      const obj = vectorShapeToObject(kind, a, b, {
        view,
        depth: defaultDepth,
        polyBudget,
        color: activeColor,
        ...(kind === 'roundedBox'
          ? {
              roundedBoxParams: {
                roundness: roundedBoxRoundness,
                subdivisions: roundedBoxSubdivisions,
              } satisfies RoundedBoxParams,
            }
          : {}),
      })
      if (obj) store().addObject(obj)
    },

    setActiveShapeKind: (kind) => {
      store().penCancelPath()
      setPartial({
        activeShapeKind: kind,
        activeTool: 'vector-shape',
        toolCategory: 'vector',
        activePrimitiveKind: null,
        primitiveBoxDraft: null,
        vectorDraft: [],
        vectorIsDrawing: false,
        vectorDraftView: null,
        vectorPenDraft: null,
        ...clearStrokeDraftState(),
      })
    },

    setActivePrimitiveKind: (kind) => {
      store().penCancelPath()
      const resolvedKind = kind === 'roundedBox' ? 'box' : kind
      setPartial({
        activePrimitiveKind: resolvedKind,
        activeTool: resolvedKind ? 'primitive-box' : 'draw',
        toolCategory: 'draw',
        primitiveBoxDraft: null,
        vectorDraft: [],
        vectorIsDrawing: false,
        vectorDraftView: null,
        vectorPenDraft: null,
        ...clearStrokeDraftState(),
      })
    },

    setRoundedBoxRoundness: (value) =>
      setPartial({ roundedBoxRoundness: clampRoundness(value) }),

    setRoundedBoxSubdivisions: (value) =>
      setPartial({
        roundedBoxSubdivisions: Math.min(
          clampRoundedBoxSubdivisions(value),
          maxRoundedBoxSubdivisionsForBudget(store().polyBudget)
        ),
      }),

    adjustRoundedBoxWheel: (deltaY, shiftKey) => {
      const {
        activeTool,
        activePrimitiveKind,
        activeShapeKind,
        primitiveBoxDraft,
        vectorIsDrawing,
      } = store()

      const primitiveRounded =
        activeTool === 'primitive-box' &&
        activePrimitiveKind === 'roundedBox' &&
        primitiveBoxDraft != null
      const vectorRounded =
        activeTool === 'vector-shape' && activeShapeKind === 'roundedBox' && vectorIsDrawing

      if (!primitiveRounded && !vectorRounded) return false

      if (
        primitiveRounded &&
        primitiveBoxDraft!.phase === 'scrollHeight' &&
        primitiveBoxDraft!.baseView === 'perspective' &&
        !shiftKey
      ) {
        return false
      }

      if (shiftKey) {
        const step = deltaY > 0 ? -0.05 : 0.05
        setPartial({ roundedBoxRoundness: clampRoundness(get().roundedBoxRoundness + step) })
      } else {
        const step = deltaY > 0 ? -1 : 1
        setPartial({
          roundedBoxSubdivisions: clampRoundedBoxSubdivisions(
            get().roundedBoxSubdivisions + step
          ),
        })
      }
      return true
    },

    cancelPrimitiveBoxDraft: () => setPartial({ primitiveBoxDraft: null }),

    primitiveBoxPointerDown: (point, view, _shiftKey, worldPoint) => {
      const { activePrimitiveKind, primitiveBoxDraft, defaultDepth } = store()
      if (!activePrimitiveKind) return

      if (view === 'perspective') {
        if (!worldPoint) return

        if (
          primitiveBoxDraft?.phase === 'scrollHeight' &&
          primitiveBoxDraft.baseView === 'perspective'
        ) {
          return
        }

        const session = startPerspectivePrimitiveBoxSession(worldPoint, defaultDepth)
        setPartial({
          primitiveBoxDraft: {
            phase: 'drawingBase',
            baseView: 'perspective',
            heightAxis: session.heightAxis,
            box: session.box,
            baseBoxLocked: session.box,
            baseCornerA: { x: 0, y: 0 },
            baseCornerB: { x: 0, y: 0 },
            heightCornerA: null,
            heightCornerB: null,
            heightView: null,
            worldCornerA: session.worldCornerA,
            worldCornerB: session.worldCornerB,
            groundY: session.groundY,
          },
        })
        return
      }

      if (!isOrthoView(view)) return

      if (
        primitiveBoxDraft?.phase === 'drawingHeight' &&
        isOrthoView(primitiveBoxDraft.baseView) &&
        view === primitiveBoxDraft.baseView
      ) {
        const session = startPrimitiveBoxSession(view, point, defaultDepth)
        if (!session) return
        setPartial({
          primitiveBoxDraft: {
            phase: 'drawingBase',
            baseView: session.baseView,
            heightAxis: session.heightAxis,
            box: session.box,
            baseBoxLocked: session.box,
            baseCornerA: session.cornerA,
            baseCornerB: session.cornerB,
            heightCornerA: null,
            heightCornerB: null,
            heightView: null,
          },
        })
        return
      }

      if (
        primitiveBoxDraft?.phase === 'drawingHeight' &&
        isOrthoView(primitiveBoxDraft.baseView) &&
        canExtrudeHeightInView(primitiveBoxDraft.baseView, view, primitiveBoxDraft.heightAxis)
      ) {
        setPartial({
          primitiveBoxDraft: {
            ...primitiveBoxDraft,
            heightCornerA: { ...point },
            heightCornerB: { ...point },
            heightView: view,
          },
        })
        return
      }

      const session = startPrimitiveBoxSession(view, point, defaultDepth)
      if (!session) return
      setPartial({
        primitiveBoxDraft: {
          phase: 'drawingBase',
          baseView: session.baseView,
          heightAxis: session.heightAxis,
          box: session.box,
          baseBoxLocked: session.box,
          baseCornerA: session.cornerA,
          baseCornerB: session.cornerB,
          heightCornerA: null,
          heightCornerB: null,
          heightView: null,
        },
      })
    },

    primitiveBoxPointerMove: (point, view, shiftKey, worldPoint) => {
      const { primitiveBoxDraft, defaultDepth } = store()
      if (!primitiveBoxDraft) return

      if (view === 'perspective' && primitiveBoxDraft.baseView === 'perspective') {
        if (
          primitiveBoxDraft.phase !== 'drawingBase' ||
          !worldPoint ||
          !primitiveBoxDraft.worldCornerA ||
          primitiveBoxDraft.groundY === undefined
        ) {
          return
        }
        const groundY = primitiveBoxDraft.groundY
        const cornerB: Vec3 = { x: worldPoint.x, y: groundY, z: worldPoint.z }
        const box = baseBoxFromGroundCorners(
          primitiveBoxDraft.worldCornerA,
          cornerB,
          groundY,
          shiftKey
        )
        setPartial({
          primitiveBoxDraft: {
            ...primitiveBoxDraft,
            worldCornerB: cornerB,
            box,
          },
        })
        return
      }

      if (!isOrthoView(view)) return

      if (
        primitiveBoxDraft.phase === 'drawingBase' &&
        isOrthoView(primitiveBoxDraft.baseView) &&
        view === primitiveBoxDraft.baseView
      ) {
        const box = baseBoxFromPlaneCorners(
          primitiveBoxDraft.baseView,
          primitiveBoxDraft.baseCornerA,
          point,
          defaultDepth,
          shiftKey
        )
        setPartial({
          primitiveBoxDraft: {
            ...primitiveBoxDraft,
            baseCornerB: { ...point },
            box,
          },
        })
        return
      }

      if (
        primitiveBoxDraft.phase === 'drawingHeight' &&
        primitiveBoxDraft.heightCornerA &&
        primitiveBoxDraft.heightView === view &&
        isOrthoView(primitiveBoxDraft.baseView) &&
        canExtrudeHeightInView(primitiveBoxDraft.baseView, view, primitiveBoxDraft.heightAxis)
      ) {
        const box = extrudeBoxOnHeightAxis(
          flattenBoxOnHeightAxis(primitiveBoxDraft.baseBoxLocked, primitiveBoxDraft.heightAxis),
          primitiveBoxDraft.heightAxis,
          view,
          primitiveBoxDraft.heightCornerA,
          point,
          defaultDepth,
          shiftKey
        )
        setPartial({
          primitiveBoxDraft: {
            ...primitiveBoxDraft,
            heightCornerB: { ...point },
            box,
          },
        })
      }
    },

    primitiveBoxPointerUp: (point, view, shiftKey, worldPoint) => {
      const { primitiveBoxDraft, defaultDepth, activePrimitiveKind } = store()
      if (!primitiveBoxDraft || !activePrimitiveKind) return

      if (view === 'perspective' && primitiveBoxDraft.baseView === 'perspective') {
        if (
          primitiveBoxDraft.phase !== 'drawingBase' ||
          !worldPoint ||
          !primitiveBoxDraft.worldCornerA ||
          primitiveBoxDraft.groundY === undefined
        ) {
          return
        }
        const groundY = primitiveBoxDraft.groundY
        const cornerB: Vec3 = { x: worldPoint.x, y: groundY, z: worldPoint.z }
        const footprint = baseBoxFromGroundCorners(
          primitiveBoxDraft.worldCornerA,
          cornerB,
          groundY,
          shiftKey
        )
        const locked = flattenBoxOnHeightAxis(footprint, primitiveBoxDraft.heightAxis)
        const initialHeight = 4
        setPartial({
          primitiveBoxDraft: {
            ...primitiveBoxDraft,
            phase: 'scrollHeight',
            worldCornerB: cornerB,
            baseBoxLocked: locked,
            scrollHeight: initialHeight,
            box: extrudeFlatBoxToHeight(locked, primitiveBoxDraft.heightAxis, initialHeight),
          },
        })
        return
      }

      if (!isOrthoView(view)) return

      if (
        primitiveBoxDraft.phase === 'drawingBase' &&
        isOrthoView(primitiveBoxDraft.baseView) &&
        view === primitiveBoxDraft.baseView
      ) {
        const box = baseBoxFromPlaneCorners(
          primitiveBoxDraft.baseView,
          primitiveBoxDraft.baseCornerA,
          point,
          defaultDepth,
          shiftKey
        )
        const locked = flattenBoxOnHeightAxis(box, primitiveBoxDraft.heightAxis)
        setPartial({
          primitiveBoxDraft: {
            ...primitiveBoxDraft,
            phase: 'drawingHeight',
            baseCornerB: { ...point },
            box: locked,
            baseBoxLocked: locked,
            heightCornerA: null,
            heightCornerB: null,
            heightView: null,
          },
        })
        return
      }

      if (
        primitiveBoxDraft.phase === 'drawingHeight' &&
        primitiveBoxDraft.heightCornerA &&
        primitiveBoxDraft.heightView === view &&
        isOrthoView(primitiveBoxDraft.baseView) &&
        canExtrudeHeightInView(primitiveBoxDraft.baseView, view, primitiveBoxDraft.heightAxis)
      ) {
        const box = extrudeBoxOnHeightAxis(
          flattenBoxOnHeightAxis(primitiveBoxDraft.baseBoxLocked, primitiveBoxDraft.heightAxis),
          primitiveBoxDraft.heightAxis,
          view,
          primitiveBoxDraft.heightCornerA,
          point,
          defaultDepth,
          shiftKey
        )
        setPartial({
          primitiveBoxDraft: {
            ...primitiveBoxDraft,
            heightCornerB: { ...point },
            box,
          },
        })
        store().commitPrimitiveBox()
      }
    },

    adjustPrimitiveBoxWheel: (deltaY) => {
      const { primitiveBoxDraft } = store()
      if (
        !primitiveBoxDraft ||
        primitiveBoxDraft.phase !== 'scrollHeight' ||
        primitiveBoxDraft.baseView !== 'perspective'
      ) {
        return
      }

      const step = deltaY > 0 ? -3 : 3
      const prev = primitiveBoxDraft.scrollHeight ?? 4
      store().setPrimitiveBoxScrollHeight(prev + step)
    },

    setPrimitiveBoxScrollHeight: (height) => {
      const { primitiveBoxDraft } = store()
      if (
        !primitiveBoxDraft ||
        primitiveBoxDraft.phase !== 'scrollHeight' ||
        primitiveBoxDraft.baseView !== 'perspective'
      ) {
        return
      }

      const next = Math.max(0.5, height)
      setPartial({
        primitiveBoxDraft: {
          ...primitiveBoxDraft,
          scrollHeight: next,
          box: extrudeFlatBoxToHeight(
            primitiveBoxDraft.baseBoxLocked,
            primitiveBoxDraft.heightAxis,
            next
          ),
        },
      })
    },

    commitPrimitiveBox: () => {
      const {
        activePrimitiveKind,
        primitiveBoxDraft,
        activeColor,
        polyBudget,
        roundedBoxRoundness,
        roundedBoxSubdivisions,
      } = store()
      if (!activePrimitiveKind || !primitiveBoxDraft) return

      const roundedParams: RoundedBoxParams | undefined =
        activePrimitiveKind === 'roundedBox'
          ? { roundness: roundedBoxRoundness, subdivisions: roundedBoxSubdivisions }
          : undefined

      const obj = primitiveBoxToSceneObject(
        activePrimitiveKind,
        primitiveBoxDraft.box,
        primitiveBoxDraft.heightAxis,
        activeColor,
        polyBudget,
        roundedParams,
        primitiveBoxDraft.baseView
      )

      if (obj) {
        store().addObject(obj)
      }

      setPartial({ primitiveBoxDraft: null })
    },

  }
}
