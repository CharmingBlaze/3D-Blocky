import { punchHoleAlongLine } from '../mesh/boolean'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import {
  createSketchSource,
  isSketchDoodleObject,
  regenerateSketchObject,
} from '../stroke/sketchSource'
import {
  isSketchNearClose,
  prepareSketchStroke,
  snapSketchStrokeClosed,
} from '../stroke/sketchDoodle'
import { strokeToMesh, isHoleLineStroke } from '../stroke/strokeToMesh'
import { isVectorDoodleObject, regenerateVectorObject } from '../vector/vectorSource'
import { isNearPoint } from '../vector/penTool'
import { extrudeValueFromScreenDelta } from '../mesh/meshOps'
import { planeToWorld3D } from '../utils/screenToWorld'
import type { ViewType } from '../scene/viewTypes'

export type StrokeMode = 'outline' | 'centerline' | 'blob'
export type DrawInputMode = 'regular' | 'vector-pen'

export interface ExtrudeDragAnchor {
  clientX: number
  clientY: number
  baseAmount: number
}

export interface StrokeLayoutState {
  strokeMode: StrokeMode
  drawInputMode: DrawInputMode
  autoConnectPaths: boolean
  lastStrokeEndpoint: { view: ViewType; position: { x: number; y: number } } | null
  sketchExtrudeMode: boolean
  penExtrudeMode: boolean
  extrudeAmount: number
  extrudeDragAnchor: ExtrudeDragAnchor | null
  currentStroke: { x: number; y: number }[]
  currentStrokeView: ViewType | null
  currentStrokePreview: { x: number; y: number } | null
  isDrawing: boolean
}

export interface StrokeLayoutActions {
  setExtrudeMode: (on: boolean) => void
  toggleExtrudeMode: () => void
  setExtrudeAmount: (amount: number) => void
  commitExtrudeDepth: () => void
  beginExtrudeDrag: (clientX: number, clientY: number) => void
  updateExtrudeFromPointer: (clientX: number, clientY: number) => void
  clearExtrudeDrag: () => void
  startStroke: (point: { x: number; y: number }, view: ViewType) => void
  continueStroke: (point: { x: number; y: number }) => void
  setStrokePreview: (point: { x: number; y: number } | null) => void
  endStroke: (view: ViewType) => void
  setStrokeMode: (mode: StrokeMode) => void
  setDrawInputMode: (mode: DrawInputMode) => void
  setAutoConnectPaths: (on: boolean) => void
  toggleAutoConnectPaths: () => void
}

export type StrokeSlice = StrokeLayoutState & StrokeLayoutActions

export const strokeLayoutInitialState: StrokeLayoutState = {
  strokeMode: 'outline',
  drawInputMode: 'regular',
  autoConnectPaths: true,
  lastStrokeEndpoint: null,
  sketchExtrudeMode: false,
  penExtrudeMode: false,
  extrudeAmount: 16,
  extrudeDragAnchor: null,
  currentStroke: [],
  currentStrokeView: null,
  currentStrokePreview: null,
  isDrawing: false,
}

export function clearStrokeDraftState(): Pick<
  StrokeLayoutState,
  'currentStroke' | 'currentStrokeView' | 'currentStrokePreview' | 'isDrawing'
> {
  return {
    currentStroke: [],
    currentStrokeView: null,
    currentStrokePreview: null,
    isDrawing: false,
  }
}

type StrokeStore = StrokeLayoutState & {
  addObject: (obj: SceneObject) => void
  commitHistory: (label?: string) => boolean
  pushHistory: (label?: string) => boolean
  penCancelPath: () => void
  closeThreshold: number
  polyBudget: number
  brushDensity: number
  rdpTolerance: number
  defaultDepth: number
  activeColor: number
  activeTool: string
  selectedObjectId: string | null
  selectionObjectIds: string[]
  objects: SceneObject[]
  facetExaggeration: number
  activePrimitiveKind: unknown
  primitiveBoxDraft: unknown
  vectorDraft: unknown[]
  vectorIsDrawing: boolean
  vectorDraftView: ViewType | null
}

export function createStrokeSlice<T extends StrokeLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & StrokeLayoutActions
): StrokeLayoutActions {
  const store = () => get() as T & StrokeLayoutActions & StrokeStore
  const patch = (partial: object) => partial as unknown as Partial<T>
  return {
    setExtrudeMode: (on) =>
      set((s) =>
        s.drawInputMode === 'vector-pen'
          ? ({ penExtrudeMode: on } as Partial<T>)
          : ({ sketchExtrudeMode: on } as Partial<T>)
      ),

    toggleExtrudeMode: () =>
      set((s) =>
        s.drawInputMode === 'vector-pen'
          ? ({ penExtrudeMode: !s.penExtrudeMode } as Partial<T>)
          : ({ sketchExtrudeMode: !s.sketchExtrudeMode } as Partial<T>)
      ),

    setExtrudeAmount: (amount) => {
      const { selectedObjectId, selectionObjectIds, objects } = store()
      if (selectionObjectIds.length === 1 && selectedObjectId) {
        const obj = objects.find((o) => o.id === selectedObjectId)
        if (isSketchDoodleObject(obj) && obj.sketchSource.isClosed) {
          const updated = regenerateSketchObject(obj, amount)
          if (updated) {
            set(
              patch({
                extrudeAmount: amount,
                objects: objects.map((o) => (o.id === obj.id ? updated : o)),
              })
            )
            return
          }
        }
        if (isVectorDoodleObject(obj)) {
          const updated = regenerateVectorObject(obj, amount)
          if (updated) {
            set(
              patch({
                extrudeAmount: amount,
                objects: objects.map((o) => (o.id === obj.id ? updated : o)),
              })
            )
            return
          }
        }
      }
      set({ extrudeAmount: amount } as unknown as Partial<T>)
    },

    commitExtrudeDepth: () => {
      store().pushHistory('Extrude depth')
    },

    beginExtrudeDrag: (clientX, clientY) => {
      const state = get()
      const extrudeOn =
        state.drawInputMode === 'vector-pen' ? state.penExtrudeMode : state.sketchExtrudeMode
      if (!extrudeOn) return
      set({
        extrudeDragAnchor: {
          clientX,
          clientY,
          baseAmount: get().extrudeAmount,
        },
      } as Partial<T>)
    },

    updateExtrudeFromPointer: (clientX, clientY) => {
      const { extrudeDragAnchor, drawInputMode, sketchExtrudeMode, penExtrudeMode } = get()
      const extrudeOn = drawInputMode === 'vector-pen' ? penExtrudeMode : sketchExtrudeMode
      if (!extrudeOn || !extrudeDragAnchor) return
      const dx = clientX - extrudeDragAnchor.clientX
      const dy = extrudeDragAnchor.clientY - clientY
      get().setExtrudeAmount(
        extrudeDragAnchor.baseAmount + extrudeValueFromScreenDelta(dx, dy, 0.15)
      )
    },

    clearExtrudeDrag: () => set({ extrudeDragAnchor: null } as Partial<T>),

    startStroke: (point, view) => {
      const { autoConnectPaths, lastStrokeEndpoint, closeThreshold } = store()
      let p = { ...point }
      if (
        autoConnectPaths &&
        lastStrokeEndpoint?.view === view &&
        isNearPoint(p, lastStrokeEndpoint.position, closeThreshold)
      ) {
        p = { ...lastStrokeEndpoint.position }
      }
      set({
        currentStroke: [p],
        isDrawing: true,
        currentStrokeView: view,
        currentStrokePreview: p,
      } as Partial<T>)
    },

    continueStroke: (point) =>
      set((s) => {
        if (!s.isDrawing) return {} as Partial<T>
        let p = point
        if (
          s.autoConnectPaths &&
          s.currentStroke.length >= 3 &&
          isSketchNearClose(s.currentStroke, point, store().closeThreshold)
        ) {
          p = { ...s.currentStroke[0] }
        }
        const last = s.currentStroke[s.currentStroke.length - 1]
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1.5) {
          return { currentStrokePreview: p } as Partial<T>
        }
        return {
          currentStroke: [...s.currentStroke, p],
          currentStrokePreview: p,
        } as Partial<T>
      }),

    setStrokePreview: (point) => {
      if (point == null) {
        set({ currentStrokePreview: null } as Partial<T>)
        return
      }
      set((s) => {
        if (
          s.autoConnectPaths &&
          s.currentStroke.length >= 3 &&
          isSketchNearClose(s.currentStroke, point, store().closeThreshold)
        ) {
          return { currentStrokePreview: { ...s.currentStroke[0] } } as Partial<T>
        }
        return { currentStrokePreview: point } as Partial<T>
      })
    },

    endStroke: (view) => {
      get().clearExtrudeDrag()
      const {
        currentStroke,
        currentStrokeView,
        polyBudget,
        brushDensity,
        rdpTolerance,
        closeThreshold,
        defaultDepth,
        activeColor,
        activeTool,
        strokeMode,
        selectedObjectId,
        objects,
        facetExaggeration,
        sketchExtrudeMode,
        extrudeAmount,
      } = store()

      if (currentStrokeView !== view || currentStroke.length < 2) {
        set(clearStrokeDraftState() as Partial<T>)
        return
      }

      if (view === 'perspective') {
        set(clearStrokeDraftState() as Partial<T>)
        return
      }

      const snappedStroke = snapSketchStrokeClosed(currentStroke, closeThreshold)

      const strokeInput = {
        points: snappedStroke,
        view,
        polyBudget,
        brushDensity,
        strokeMode,
        rdpTolerance,
        closeThreshold,
        defaultDepth,
        color: activeColor,
        stylize: facetExaggeration,
        extrudeMode: sketchExtrudeMode,
        extrudeAmount,
      }

      if (
        activeTool === 'boolean-hole' ||
        (activeTool === 'draw' && isHoleLineStroke(strokeInput))
      ) {
        const target = objects.find((o) => o.id === selectedObjectId) ?? objects[objects.length - 1]
        if (target) {
          const start = planeToWorld3D(currentStroke[0].x, currentStroke[0].y, view, defaultDepth)
          const end = planeToWorld3D(
            currentStroke[currentStroke.length - 1].x,
            currentStroke[currentStroke.length - 1].y,
            view,
            defaultDepth
          )
          const punched = punchHoleAlongLine(target, start, end, 8)
          if (punched) {
            const { objects: sceneObjects } = store()
            set(
              patch({
                objects: sceneObjects.map((o) => (o.id === target.id ? punched : o)),
              })
            )
            store().commitHistory('Boolean hole')
          }
        }
        set(clearStrokeDraftState() as Partial<T>)
        return
      }

      if (activeTool !== 'draw') {
        set(clearStrokeDraftState() as Partial<T>)
        return
      }

      let obj = strokeToMesh(strokeInput)

      if (obj && sketchExtrudeMode) {
        const prepared = prepareSketchStroke(snappedStroke, closeThreshold, brushDensity)
        if (prepared) {
          obj = {
            ...obj,
            sketchSource: createSketchSource(
              prepared.relative,
              prepared.center,
              view,
              brushDensity,
              polyBudget,
              closeThreshold,
              defaultDepth,
              prepared.isClosed,
              prepared.isClosed ? 'sharp' : 'path',
              extrudeAmount
            ),
          }
        }
      }

      const lastPt = currentStroke[currentStroke.length - 1]

      if (obj) {
        store().addObject(obj)
      }

      set({
        ...clearStrokeDraftState(),
        lastStrokeEndpoint: { view, position: { x: lastPt.x, y: lastPt.y } },
      } as Partial<T>)
    },

    setStrokeMode: (mode) => {
      if (get().drawInputMode === 'regular') {
        set({ strokeMode: mode, drawInputMode: 'regular', activeTool: 'draw' } as unknown as Partial<T>)
      } else {
        set({ strokeMode: mode } as Partial<T>)
      }
    },

    setDrawInputMode: (mode) => {
      store().penCancelPath()
      set(
        patch({
          drawInputMode: mode,
          activeTool: mode === 'regular' ? 'draw' : 'vector-pen',
          activePrimitiveKind: null,
          primitiveBoxDraft: null,
          vectorDraft: [],
          vectorIsDrawing: false,
          vectorDraftView: null,
          ...clearStrokeDraftState(),
        })
      )
    },

    setAutoConnectPaths: (on) => set({ autoConnectPaths: on } as Partial<T>),

    toggleAutoConnectPaths: () =>
      set((s) => ({ autoConnectPaths: !s.autoConnectPaths }) as Partial<T>),
  }
}
