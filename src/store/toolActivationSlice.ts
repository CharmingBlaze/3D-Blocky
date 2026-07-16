import type { ObjectTransform, SceneObject } from '../mesh/HalfEdgeMesh'
import { cloneTransform, ensureTransform, selectionWorldCenter } from '../mesh/objectTransform'
import {
  applyObjectTransformModal,
  type ObjectTransformModalOp,
} from '../mesh/objectTransformModal'
import type { Vec3 } from '../utils/math'
import { categoryForActiveTool, type ToolRingEntry } from '../tools/toolRingConfig'
import {
  meshSelectionWorldCenter,
  selectionHasComponents,
  type MeshComponentSelection,
} from '../mesh/meshSelection'
import type { ViewType } from '../scene/viewTypes'
import {
  applyMeshModalOp,
  cloneSceneObject,
  modalValueFromMouseDelta,
  modalValueFromWheel,
  type MeshModalOpKind,
} from '../mesh/meshOps'
import { clearStrokeDraftState, type DrawInputMode } from './strokeSlice'
import { clearVectorDraftState } from './vectorToolsSlice'
import type { SelectionMode } from './selectionSlice'

export type ToolCategory =
  | 'draw'
  | 'create'
  | 'vector'
  | 'sculpt'
  | 'select'
  | 'transform'
  | 'mesh'
  | 'boolean'

export type ActiveTool =
  | 'draw'
  | 'push'
  | 'pull'
  | 'inflate'
  | 'deflate'
  | 'relax'
  | 'pinch'
  | 'select-object'
  | 'smart'
  | 'extrude'
  | 'move'
  | 'rotate'
  | 'scale'
  | 'bend'
  | 'select-vertex'
  | 'select-edge'
  | 'select-face'
  | 'boolean-hole'
  | 'simplify'
  | 'vector-pen'
  | 'vector-shape'
  | 'primitive-box'
  | 'poly-draw'
  | 'knife'
  | 'mirror-knife'
  | 'loop-cut'

export type MeshModalOp = MeshModalOpKind

export interface MeshModalState {
  op: MeshModalOp
  view: ViewType
  objectId: string
  baseObject: SceneObject
  selection: MeshComponentSelection
  selectionMode: SelectionMode
  value: number
  startClientX: number
  startClientY: number
  currentClientX: number
  currentClientY: number
  pivotWorld: Vec3
  axisLock?: 'x' | 'y' | 'z' | null
  numericInput?: string
}

export interface ObjectTransformModalState {
  op: ObjectTransformModalOp
  view: ViewType
  objectIds: string[]
  baseTransforms: Record<string, ObjectTransform>
  pivotWorld: Vec3
  value: number
  startClientX: number
  startClientY: number
  currentClientX: number
  currentClientY: number
  axisLock?: 'x' | 'y' | 'z' | null
}

export interface ToolActivationLayoutState {
  activeTool: ActiveTool
  toolCategory: ToolCategory
  meshModal: MeshModalState | null
  objectTransformModal: ObjectTransformModalState | null
}

export interface ToolActivationLayoutActions {
  setActiveTool: (tool: ActiveTool) => void
  activateToolRingEntry: (category: ToolCategory, entry: ToolRingEntry) => boolean
  activateSelectTool: () => void
  setToolCategory: (cat: ToolCategory) => void
  beginMeshModal: (op: MeshModalOp, clientX: number, clientY: number, view?: ViewType) => void
  updateMeshModalFromPointer: (clientX: number, clientY: number, shiftKey?: boolean, ctrlKey?: boolean) => void
  adjustMeshModalWheel: (deltaY: number) => void
  inputMeshModalNumericKey: (key: string) => void
  confirmMeshModal: () => void
  cancelMeshModal: () => void
  applyMeshModalPreview: () => void
  beginObjectTransformModal: (op: ObjectTransformModalOp, clientX: number, clientY: number, view?: ViewType) => void
  updateObjectTransformModalFromPointer: (clientX: number, clientY: number, shiftKey?: boolean, ctrlKey?: boolean) => void
  adjustObjectTransformModalWheel: (deltaY: number) => void
  confirmObjectTransformModal: () => void
  cancelObjectTransformModal: () => void
  applyObjectTransformModalPreview: () => void
  setModalAxisLock: (axis: 'x' | 'y' | 'z' | null) => void
}

export type ToolActivationSlice = ToolActivationLayoutState & ToolActivationLayoutActions

export const toolActivationInitialState: ToolActivationLayoutState = {
  activeTool: 'draw',
  toolCategory: 'draw',
  meshModal: null,
  objectTransformModal: null,
}

type ToolStore = ToolActivationLayoutState & {
  drawInputMode: DrawInputMode
  selectionObjectIds: string[]
  selectedObjectId: string | null
  selectionMode: SelectionMode
  meshSelection: MeshComponentSelection | null
  objects: SceneObject[]
  showExportDialog: boolean
  penCancelPath: () => void
  polyDrawCancel: () => void
  clearPolyDrawHover: () => void
  knifeCancel: () => void
  bendCancel: () => void
  loopCutCancel: () => void
  setSelectionMode: (mode: SelectionMode) => void
  setActivePrimitiveKind: (kind: import('./vectorToolsSlice').PrimitiveKind | null) => void
  setActiveShapeKind: (kind: import('../vector/types').ShapeKind) => void
  setPolyDrawMode: (mode: import('./cadMeshToolsSlice').PolyDrawMode) => void
  setDrawInputMode: (mode: DrawInputMode) => void
  simplifySelected: () => void
  subdivideSelected: () => void
  flipSelectedNormals: () => void
  makeSelectedDoubleSided: () => void
  toggleSubDSelected: () => void
  setSelectionSmoothShading: (smooth: boolean) => void
  toggleUvEditor: () => void
  toggleTopologyLock: () => void
  copySelection: () => void
  pasteClipboard: () => void
  deleteSelection: () => void
  updateObject: (id: string, updates: Partial<SceneObject>) => void
  captureUndoPoint: (label?: string) => void
  replaceHistoryHead: (label?: string) => void
  pauseHistory: () => void
  undo: () => void
  resumeHistory: () => void
}

export function createToolActivationSlice<T extends ToolActivationLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & ToolActivationLayoutActions
): ToolActivationLayoutActions {
  const store = () => get() as T & ToolActivationLayoutActions & ToolStore
  const setPartial = (partial: object | ((state: T) => object)) => {
    if (typeof partial === 'function') {
      set((state) => partial(state) as Partial<T>)
    } else {
      set(partial as unknown as Partial<T>)
    }
  }

  return {
    setActiveTool: (tool) => {
      const drawInputMode: DrawInputMode =
        tool === 'vector-pen' ? 'vector-pen' : tool === 'draw' ? 'regular' : store().drawInputMode
      if (tool !== 'vector-pen' && tool !== 'draw') {
        store().penCancelPath()
      }
      if (tool !== 'poly-draw') {
        store().polyDrawCancel()
        store().clearPolyDrawHover()
      }
      if (tool !== 'knife') {
        store().knifeCancel()
      }
      if (tool !== 'bend') {
        store().bendCancel()
      }
      if (tool !== 'loop-cut') {
        store().loopCutCancel()
      }
      const toolCategory = categoryForActiveTool(tool, store().toolCategory)
      setPartial({ activeTool: tool, drawInputMode, toolCategory })
    },

    activateToolRingEntry: (category, entry) => {
      const state = store()
      const hasObjectSelection =
        state.selectionObjectIds.length > 0 || !!state.selectedObjectId

      const activateMeshEditTool = (tool: 'knife' | 'loop-cut') => {
        if (!hasObjectSelection) return false
        store().penCancelPath()
        store().polyDrawCancel()
        store().clearPolyDrawHover()
        if (tool !== 'knife') store().knifeCancel()
        if (tool !== 'loop-cut') store().loopCutCancel()
        setPartial({
          activeTool: tool,
          toolCategory: 'mesh',
          drawInputMode: state.drawInputMode,
          ...(tool === 'loop-cut'
            ? { selectionMode: 'edge' as const }
            : {}),
        })
        return true
      }

      switch (entry.kind) {
        case 'tool': {
          if (entry.tool === 'knife' || entry.tool === 'loop-cut') {
            return activateMeshEditTool(entry.tool)
          }
          if (entry.selectionMode) {
            store().setSelectionMode(entry.selectionMode)
            if (entry.tool.startsWith('select-')) return true
          }
          store().setActiveTool(entry.tool)
          setPartial({ toolCategory: categoryForActiveTool(entry.tool, category) })
          return true
        }
        case 'primitive': {
          store().setActivePrimitiveKind(entry.primitive)
          setPartial({ toolCategory: category })
          return true
        }
        case 'shape': {
          store().setActiveShapeKind(entry.shape)
          setPartial({ toolCategory: 'vector' })
          return true
        }
        case 'polyMode': {
          store().penCancelPath()
          store().setPolyDrawMode(entry.mode)
          setPartial({ toolCategory: 'draw' })
          return true
        }
        case 'stroke': {
          store().penCancelPath()
          setPartial({
            strokeMode: entry.mode,
            drawInputMode: 'regular',
            activeTool: 'draw',
            toolCategory: 'draw',
            sketchExtrudeMode: false,
            sketchLatheMode: false,
            penExtrudeMode: false,
            penLatheMode: false,
            ...clearVectorDraftState(),
            ...clearStrokeDraftState(),
          })
          return true
        }
        case 'drawInput': {
          store().setDrawInputMode(entry.mode)
          setPartial({ toolCategory: entry.mode === 'vector-pen' ? 'vector' : 'draw' })
          return true
        }
        case 'action': {
          switch (entry.id) {
            case 'extrude': {
              store().penCancelPath()
              setPartial({
                sketchExtrudeMode: true,
                drawInputMode: 'regular',
                activeTool: 'draw',
                toolCategory: 'draw',
                ...clearVectorDraftState(),
            ...clearStrokeDraftState(),
              })
              return true
            }
            case 'select-tool':
              store().activateSelectTool()
              return true
            case 'simplify':
              store().simplifySelected()
              return true
            case 'subdivide':
              store().subdivideSelected()
              return true
            case 'flip-normals':
              store().flipSelectedNormals()
              return true
            case 'double-sided':
              store().makeSelectedDoubleSided()
              return true
            case 'subd':
              store().toggleSubDSelected()
              return true
            case 'shade-smooth':
              store().setSelectionSmoothShading(true)
              return true
            case 'shade-flat':
              store().setSelectionSmoothShading(false)
              return true
            case 'uv-editor':
              store().toggleUvEditor()
              return true
            case 'topology-lock':
              store().toggleTopologyLock()
              return true
            case 'export':
              setPartial({ showExportDialog: true })
              return true
            case 'import':
              setPartial({ showExportDialog: true })
              return true
            case 'copy':
              store().copySelection()
              return true
            case 'paste':
              store().pasteClipboard()
              return true
            case 'delete':
              store().deleteSelection()
              return true
            default:
              return false
          }
        }
        default:
          return false
      }
    },
    activateSelectTool: () => {
      const { selectionMode } = store()
      const toolByMode: Record<SelectionMode, ActiveTool> = {
        object: 'select-object',
        vertex: 'select-vertex',
        edge: 'select-edge',
        face: 'select-face',
      }
      store().penCancelPath()
      store().polyDrawCancel()
      store().knifeCancel()
      store().loopCutCancel()
      setPartial({ activeTool: toolByMode[selectionMode], toolCategory: 'select' })
    },
    setToolCategory: (cat) => setPartial({ toolCategory: cat }),

    applyMeshModalPreview: () => {
      const modal = store().meshModal
      if (!modal) return

      const result = applyMeshModalOp(
        modal.baseObject,
        modal.selection,
        modal.selectionMode,
        modal.op,
        modal.value,
        modal.pivotWorld,
        modal.currentClientX - modal.startClientX,
        modal.startClientY - modal.currentClientY,
        modal.axisLock,
        modal.view
      )

      store().updateObject(modal.objectId, {
        positions: result.positions,
        faces: result.faces,
        faceColors: result.faceColors,
        faceGroups: result.faceGroups,
        uvs: result.uvs,
        faceUvIndices: result.faceUvIndices,
      })
      if (result.resultingSelection) setPartial({ meshSelection: result.resultingSelection })
    },

    beginMeshModal: (op, clientX, clientY, view = 'perspective') => {
      const { meshSelection, objects, selectionMode } = store()
      if (!meshSelection || !selectionHasComponents(meshSelection)) return
      if (store().meshModal) store().cancelMeshModal()
      if (store().objectTransformModal) store().cancelObjectTransformModal()

      const obj = objects.find((o) => o.id === meshSelection.objectId)
      if (!obj || obj.topologyLocked) return

      store().captureUndoPoint('Mesh edit')
      const pivotWorld = meshSelectionWorldCenter(obj, meshSelection)

      setPartial({
        meshModal: {
          op,
          view,
          objectId: obj.id,
          baseObject: cloneSceneObject(obj),
          selection: {
            vertices: new Set(meshSelection.vertices),
            edges: new Set(meshSelection.edges),
            faces: new Set(meshSelection.faces),
          },
          selectionMode,
          value: op === 'scale' ? 1 : 0,
          startClientX: clientX,
          startClientY: clientY,
          currentClientX: clientX,
          currentClientY: clientY,
          pivotWorld,
          axisLock: null,
        },
      })
      store().applyMeshModalPreview()
    },

    updateMeshModalFromPointer: (clientX, clientY, shiftKey = false, ctrlKey = false) => {
      const modal = store().meshModal
      if (!modal) return

      const dx = clientX - modal.startClientX
      const dy = modal.startClientY - clientY

      let value = modalValueFromMouseDelta(modal.op, dx, dy, shiftKey)

      if (modal.op === 'extrude') {
        const positions = modal.baseObject.positions
        if (positions.length) {
          let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity
          for (const p of positions) { minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);minZ=Math.min(minZ,p.z);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);maxZ=Math.max(maxZ,p.z) }
          const diagonal = Math.max(1e-3, Math.hypot(maxX-minX,maxY-minY,maxZ-minZ))
          value = (dx + dy) * diagonal / 300 * (shiftKey ? .1 : 1)
        }
      }

      if (ctrlKey) {
        if (modal.op === 'extrude' || modal.op === 'bevel') {
          value = Math.round(value / 0.25) * 0.25
        } else if (modal.op === 'rotate') {
          const step = 15 * Math.PI / 180
          value = Math.round(value / step) * step
        } else if (modal.op === 'scale') {
          value = Math.round(value / 0.1) * 0.1
        }
      }

      setPartial({ meshModal: { ...modal, value, currentClientX: clientX, currentClientY: clientY, numericInput: undefined } })
      store().applyMeshModalPreview()
    },

    adjustMeshModalWheel: (deltaY) => {
      const modal = store().meshModal
      if (!modal) return

      const value = modalValueFromWheel(modal.op, modal.value, deltaY)
      setPartial({ meshModal: { ...modal, value } })
      store().applyMeshModalPreview()
    },

    inputMeshModalNumericKey: (key) => {
      const modal = store().meshModal
      if (!modal) return
      let input = modal.numericInput ?? ''
      if (key === 'Backspace') input = input.slice(0, -1)
      else if (key === '-' && input.length === 0) input = '-'
      else if (key === '.' && !input.includes('.')) input += input.length === 0 ? '0.' : '.'
      else if (/^[0-9]$/.test(key)) input += key
      else return
      const parsed = input !== '' && input !== '-' && input !== '.' && input !== '-.' ? Number(input) : Number.NaN
      const value = modal.op === 'rotate' ? parsed * Math.PI / 180 : parsed
      setPartial({ meshModal: { ...modal, numericInput: input, value: Number.isFinite(value) ? value : modal.value } })
      if (Number.isFinite(value)) store().applyMeshModalPreview()
    },

    confirmMeshModal: () => {
      store().replaceHistoryHead('Mesh edit')
      setPartial({ meshModal: null })
    },

    cancelMeshModal: () => {
      const modal = store().meshModal
      if (!modal) return
      store().pauseHistory()
      store().undo()
      store().resumeHistory()
      setPartial({ meshModal: null, meshSelection: modal.selection })
    },

    applyObjectTransformModalPreview: () => {
      const modal = store().objectTransformModal
      if (!modal) return

      const dx = (modal.currentClientX - modal.startClientX) * 0.02
      const dy = -(modal.currentClientY - modal.startClientY) * 0.02

      setPartial((s) => {
        const st = s as unknown as ToolStore
        return {
          objects: st.objects.map((o) => {
            if (!modal.objectIds.includes(o.id)) return o
            const base = modal.baseTransforms[o.id]
            if (!base) return o

            return {
              ...o,
              transform: applyObjectTransformModal(
                base,
                modal.op,
                modal.value,
                modal.pivotWorld,
                dx,
                dy,
                modal.axisLock,
                modal.view
              ),
            }
          }),
        }
      })
    },

    setModalAxisLock: (axis) => {
      const state = store()
      if (state.meshModal) {
        setPartial({ meshModal: { ...state.meshModal, axisLock: axis } })
        store().applyMeshModalPreview()
      } else if (state.objectTransformModal) {
        setPartial({ objectTransformModal: { ...state.objectTransformModal, axisLock: axis } })
        store().applyObjectTransformModalPreview()
      }
    },

    beginObjectTransformModal: (op, clientX, clientY, view = 'perspective') => {
      const { selectionObjectIds, objects } = store()
      if (selectionObjectIds.length === 0) return
      if (store().meshModal) store().cancelMeshModal()
      if (store().objectTransformModal) store().cancelObjectTransformModal()

      store().captureUndoPoint('Transform')

      const pivotWorld = selectionWorldCenter(objects, selectionObjectIds)
      const baseTransforms: Record<string, ObjectTransform> = {}
      for (const id of selectionObjectIds) {
        const obj = objects.find((o) => o.id === id)
        if (obj) baseTransforms[id] = cloneTransform(ensureTransform(obj))
      }
      if (Object.keys(baseTransforms).length === 0) return

      setPartial({
        objectTransformModal: {
          op,
          view,
          objectIds: [...selectionObjectIds],
          baseTransforms,
          pivotWorld,
          value: op === 'scale' ? 1 : 0,
          startClientX: clientX,
          startClientY: clientY,
          currentClientX: clientX,
          currentClientY: clientY,
          axisLock: null,
        },
        activeTool: op === 'rotate' ? 'rotate' : 'scale',
        toolCategory: 'transform',
      })
      store().applyObjectTransformModalPreview()
    },

    updateObjectTransformModalFromPointer: (clientX, clientY, shiftKey = false, ctrlKey = false) => {
      const modal = store().objectTransformModal
      if (!modal) return

      const dx = clientX - modal.startClientX
      const dy = modal.startClientY - clientY

      let value = modalValueFromMouseDelta(modal.op, dx, dy, shiftKey)

      if (ctrlKey) {
        if (modal.op === 'rotate') {
          const step = 15 * Math.PI / 180
          value = Math.round(value / step) * step
        } else if (modal.op === 'scale') {
          value = Math.round(value / 0.1) * 0.1
        }
      }

      setPartial({ objectTransformModal: { ...modal, value } })
      store().applyObjectTransformModalPreview()
    },

    adjustObjectTransformModalWheel: (deltaY) => {
      const modal = store().objectTransformModal
      if (!modal) return

      const value = modalValueFromWheel(modal.op, modal.value, deltaY)
      setPartial({ objectTransformModal: { ...modal, value } })
      store().applyObjectTransformModalPreview()
    },

    confirmObjectTransformModal: () => {
      store().replaceHistoryHead('Transform')
      setPartial({ objectTransformModal: null })
    },

    cancelObjectTransformModal: () => {
      if (!store().objectTransformModal) return
      store().pauseHistory()
      store().undo()
      store().resumeHistory()
      setPartial({ objectTransformModal: null })
    },

  }
}
