import { punchHoleAlongLine } from '../mesh/boolean'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import {
  createSketchSource,
  isSketchDoodleObject,
  regenerateSketchObject,
  regenerateSketchObjectFromSource,
  type EditableSketchSourcePatch,
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
import { planeToWorld3D, type StrokePlaneFrame } from '../utils/screenToWorld'
import type { ViewType } from '../scene/viewTypes'
import { emaSmoothPoint, movingAverageSmoothStroke } from '../stroke/strokeCapture'
import { applyActiveHairTexture } from '../material/materialEditorSlice'
import {
  applyHairUvTransformToObject,
  DEFAULT_HAIR_UV_TRANSFORM,
  normalizeHairUvTransform,
  type HairUvTransform,
} from '../stroke/hairUvTransform'
import type { HairTipStyle } from '../mesh/hairRibbon'

export type StrokeMode =
  | 'outline'
  | 'centerline'
  | 'blob'
  | 'capsule'
  | 'hair-paths'
  | 'hair-strips'
  | 'hair-round'
export type DrawInputMode = 'regular' | 'vector-pen'
export type { HairTipStyle }

export function isHairStrokeMode(mode: StrokeMode): boolean {
  return mode === 'hair-paths' || mode === 'hair-strips' || mode === 'hair-round'
}

export interface ExtrudeDragAnchor {
  clientX: number
  clientY: number
  baseAmount: number
}

export interface StrokeLayoutState {
  strokeMode: StrokeMode
  drawInputMode: DrawInputMode
  autoConnectPaths: boolean
  /** Soften freehand mouse/pen input for steadier sketch strokes. */
  smoothDrawing: boolean
  lastStrokeEndpoint: { view: ViewType; position: { x: number; y: number } } | null
  sketchExtrudeMode: boolean
  penExtrudeMode: boolean
  sketchLatheMode: boolean
  penLatheMode: boolean
  sketchLatheCaps: boolean
  penLatheCaps: boolean
  extrudeAmount: number
  extrudeDragAnchor: ExtrudeDragAnchor | null
  currentStroke: { x: number; y: number }[]
  currentStrokeView: ViewType | null
  currentStrokePreview: { x: number; y: number } | null
  /** Locked camera-facing plane while drawing in perspective. */
  currentStrokePlane: StrokePlaneFrame | null
  isDrawing: boolean
  editingSketchObjectId: string | null
  /** Global texture doc id applied to new hair strokes; null = use palette colors/materials. */
  hairTextureId: string | null
  /** How procedural hair UVs map into the hair texture (applies to new strokes). */
  hairUvTransform: HairUvTransform
  /** Tip shape for new hair strokes: pointed (tapered) or square (blunt). */
  hairTipStyle: HairTipStyle
}

export interface StrokeLayoutActions {
  setExtrudeMode: (on: boolean) => void
  toggleExtrudeMode: () => void
  setLatheMode: (on: boolean) => void
  toggleLatheMode: () => void
  setLatheCaps: (on: boolean) => void
  toggleLatheCaps: () => void
  setExtrudeAmount: (amount: number) => void
  commitExtrudeDepth: () => void
  beginExtrudeDrag: (clientX: number, clientY: number) => void
  updateExtrudeFromPointer: (clientX: number, clientY: number) => void
  clearExtrudeDrag: () => void
  startStroke: (
    point: { x: number; y: number },
    view: ViewType,
    planeFrame?: StrokePlaneFrame | null
  ) => void
  continueStroke: (point: { x: number; y: number }) => void
  setStrokePreview: (point: { x: number; y: number } | null) => void
  endStroke: (view: ViewType) => void
  setStrokeMode: (mode: StrokeMode) => void
  setDrawInputMode: (mode: DrawInputMode) => void
  setAutoConnectPaths: (on: boolean) => void
  setHairTextureId: (id: string | null) => void
  clearHairTexture: () => void
  setHairUvTransform: (transform: HairUvTransform | Partial<HairUvTransform>) => void
  resetHairUvTransform: () => void
  setHairTipStyle: (style: HairTipStyle) => void
  toggleAutoConnectPaths: () => void
  setSmoothDrawing: (on: boolean) => void
  setEditingSketchObject: (objectId: string | null) => void
  updateSelectedSketchSource: (changes: EditableSketchSourcePatch) => void
  commitSketchSourceEdit: () => void
  convertSelectedSketchToMesh: () => void
}

export type StrokeSlice = StrokeLayoutState & StrokeLayoutActions

export const strokeLayoutInitialState: StrokeLayoutState = {
  strokeMode: 'blob',
  drawInputMode: 'regular',
  autoConnectPaths: true,
  smoothDrawing: true,
  lastStrokeEndpoint: null,
  sketchExtrudeMode: false,
  penExtrudeMode: false,
  sketchLatheMode: false,
  penLatheMode: false,
  sketchLatheCaps: false,
  penLatheCaps: false,
  extrudeAmount: 16,
  extrudeDragAnchor: null,
  currentStroke: [],
  currentStrokeView: null,
  currentStrokePreview: null,
  currentStrokePlane: null,
  isDrawing: false,
  editingSketchObjectId: null,
  hairTextureId: null,
  hairUvTransform: { ...DEFAULT_HAIR_UV_TRANSFORM },
  hairTipStyle: 'pointed',
}

export function clearStrokeDraftState(): Pick<
  StrokeLayoutState,
  | 'currentStroke'
  | 'currentStrokeView'
  | 'currentStrokePreview'
  | 'currentStrokePlane'
  | 'isDrawing'
> {
  return {
    currentStroke: [],
    currentStrokeView: null,
    currentStrokePreview: null,
    currentStrokePlane: null,
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
          ? ({ penExtrudeMode: on, penLatheMode: on ? false : s.penLatheMode } as Partial<T>)
          : ({ sketchExtrudeMode: on, sketchLatheMode: on ? false : s.sketchLatheMode } as Partial<T>)
      ),

    toggleExtrudeMode: () =>
      set((s) => {
        if (s.drawInputMode === 'vector-pen') {
          const next = !s.penExtrudeMode
          return { penExtrudeMode: next, penLatheMode: next ? false : s.penLatheMode } as Partial<T>
        }
        const next = !s.sketchExtrudeMode
        return { sketchExtrudeMode: next, sketchLatheMode: next ? false : s.sketchLatheMode } as Partial<T>
      }),

    setLatheMode: (on) =>
      set((s) =>
        s.drawInputMode === 'vector-pen'
          ? ({ penLatheMode: on, penExtrudeMode: on ? false : s.penExtrudeMode } as Partial<T>)
          : ({ sketchLatheMode: on, sketchExtrudeMode: on ? false : s.sketchExtrudeMode } as Partial<T>)
      ),

    toggleLatheMode: () =>
      set((s) => {
        if (s.drawInputMode === 'vector-pen') {
          const next = !s.penLatheMode
          return { penLatheMode: next, penExtrudeMode: next ? false : s.penExtrudeMode } as Partial<T>
        }
        const next = !s.sketchLatheMode
        return { sketchLatheMode: next, sketchExtrudeMode: next ? false : s.sketchExtrudeMode } as Partial<T>
      }),

    setLatheCaps: (on) =>
      set((s) =>
        s.drawInputMode === 'vector-pen'
          ? ({ penLatheCaps: on } as Partial<T>)
          : ({ sketchLatheCaps: on } as Partial<T>)
      ),

    toggleLatheCaps: () =>
      set((s) =>
        s.drawInputMode === 'vector-pen'
          ? ({ penLatheCaps: !s.penLatheCaps } as Partial<T>)
          : ({ sketchLatheCaps: !s.sketchLatheCaps } as Partial<T>)
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

    setEditingSketchObject: (objectId) => {
      if (objectId) {
        const object = store().objects.find((candidate) => candidate.id === objectId)
        if (!isSketchDoodleObject(object)) return
      }
      set({ editingSketchObjectId: objectId } as unknown as Partial<T>)
    },

    updateSelectedSketchSource: (changes) => {
      const { selectedObjectId, selectionObjectIds, objects } = store()
      if (!selectedObjectId || selectionObjectIds.length !== 1) return
      const object = objects.find((candidate) => candidate.id === selectedObjectId)
      if (!isSketchDoodleObject(object)) return
      const updated = regenerateSketchObjectFromSource(object, changes)
      if (!updated) return
      set(patch({ objects: objects.map((candidate) => candidate.id === object.id ? updated : candidate) }))
    },

    commitSketchSourceEdit: () => {
      store().pushHistory('Edit sketch')
    },

    convertSelectedSketchToMesh: () => {
      const { selectedObjectId, selectionObjectIds, objects } = store()
      if (!selectedObjectId || selectionObjectIds.length !== 1) return
      const object = objects.find((candidate) => candidate.id === selectedObjectId)
      if (!isSketchDoodleObject(object)) return
      const { sketchSource: _source, ...meshObject } = object
      set(patch({
        objects: objects.map((candidate) => candidate.id === object.id ? meshObject : candidate),
        editingSketchObjectId: null,
      }))
      store().commitHistory('Convert sketch to mesh')
    },

    startStroke: (point, view, planeFrame = null) => {
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
        currentStrokePlane: view === 'perspective' ? planeFrame : null,
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
          p = { ...s.currentStroke[0]! }
        } else if (s.smoothDrawing && s.currentStroke.length > 0) {
          const last = s.currentStroke[s.currentStroke.length - 1]!
          p = emaSmoothPoint(last, point, 0.3)
        }
        const last = s.currentStroke[s.currentStroke.length - 1]
        const minDist = s.smoothDrawing ? 2.4 : 1.5
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < minDist) {
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
          return { currentStrokePreview: { ...s.currentStroke[0]! } } as Partial<T>
        }
        if (s.smoothDrawing && s.currentStroke.length > 0) {
          const last = s.currentStroke[s.currentStroke.length - 1]!
          return { currentStrokePreview: emaSmoothPoint(last, point, 0.35) } as Partial<T>
        }
        return { currentStrokePreview: point } as Partial<T>
      })
    },

    endStroke: (view) => {
      get().clearExtrudeDrag()
      const {
        currentStroke,
        currentStrokeView,
        currentStrokePlane,
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
        sketchLatheMode,
        sketchLatheCaps,
        extrudeAmount,
        smoothDrawing,
        hairTextureId,
        hairUvTransform,
        hairTipStyle,
      } = store()

      if (currentStrokeView !== view || currentStroke.length < 2) {
        set(clearStrokeDraftState() as Partial<T>)
        return
      }

      if (view === 'perspective' && !currentStrokePlane) {
        set(clearStrokeDraftState() as Partial<T>)
        return
      }

      const stabilizedStroke =
        sketchLatheMode
          ? currentStroke
          : smoothDrawing
            ? movingAverageSmoothStroke(currentStroke, 2)
            : currentStroke
      const snappedStroke = sketchLatheMode
        ? stabilizedStroke
        : snapSketchStrokeClosed(stabilizedStroke, closeThreshold)

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
        extrudeMode: sketchLatheMode ? false : sketchExtrudeMode,
        latheMode: sketchLatheMode,
        latheCaps: sketchLatheCaps,
        extrudeAmount,
        hairTipStyle,
        planeFrame: currentStrokePlane,
      }

      if (
        activeTool === 'boolean-hole' ||
        (activeTool === 'draw' && isHoleLineStroke(strokeInput))
      ) {
        const target = objects.find((o) => o.id === selectedObjectId) ?? objects[objects.length - 1]
        if (target) {
          const start = planeToWorld3D(
            snappedStroke[0]!.x,
            snappedStroke[0]!.y,
            view,
            defaultDepth,
            currentStrokePlane
          )
          const end = planeToWorld3D(
            snappedStroke[snappedStroke.length - 1]!.x,
            snappedStroke[snappedStroke.length - 1]!.y,
            view,
            defaultDepth,
            currentStrokePlane
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
              extrudeAmount,
              { planeFrame: currentStrokePlane }
            ),
          }
        }
      }

      if (obj && isHairStrokeMode(strokeMode)) {
        obj = applyActiveHairTexture(obj, hairTextureId)
        obj = applyHairUvTransformToObject(obj, hairUvTransform)
      }

      const lastPt = snappedStroke[snappedStroke.length - 1]!

      if (obj) {
        store().addObject(obj)
      }

      set({
        ...clearStrokeDraftState(),
        lastStrokeEndpoint: { view, position: { x: lastPt.x, y: lastPt.y } },
      } as Partial<T>)
    },

    setStrokeMode: (mode) => {
      // Outline / Path / Blob are mutually exclusive with Extrude and Lathe.
      const clearExtras = {
        sketchExtrudeMode: false,
        sketchLatheMode: false,
        penExtrudeMode: false,
        penLatheMode: false,
      }
      if (get().drawInputMode === 'regular') {
        set({
          strokeMode: mode,
          drawInputMode: 'regular',
          activeTool: 'draw',
          ...clearExtras,
        } as unknown as Partial<T>)
      } else {
        set({ strokeMode: mode, ...clearExtras } as Partial<T>)
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

    setSmoothDrawing: (on) => set({ smoothDrawing: on } as Partial<T>),

    setHairTextureId: (id) => set({ hairTextureId: id } as Partial<T>),

    clearHairTexture: () => set({ hairTextureId: null } as Partial<T>),

    setHairUvTransform: (transform) =>
      set({
        hairUvTransform: normalizeHairUvTransform({
          ...get().hairUvTransform,
          ...transform,
        }),
      } as Partial<T>),

    resetHairUvTransform: () =>
      set({ hairUvTransform: { ...DEFAULT_HAIR_UV_TRANSFORM } } as Partial<T>),

    setHairTipStyle: (style) =>
      set({ hairTipStyle: style === 'square' ? 'square' : 'pointed' } as Partial<T>),
  }
}
