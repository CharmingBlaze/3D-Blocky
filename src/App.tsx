import { useEffect, useCallback, lazy, Suspense, useState, useRef } from 'react'
import './App.css'
import { subscribeGraphicsNotice } from './rendering/webglContextNotice'
import { ViewportLayout } from './components/ViewportLayout'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { TransformToolbar } from './components/TransformToolbar'
import { PrimitivesToolbar } from './components/PrimitivesToolbar'
import { useAppStore } from './store/appStore'
import { selectionHasComponents } from './mesh/meshSelection'
import type { NudgeDirection } from './utils/viewNavigation'

const SidePanel = lazy(() =>
  import('./components/SidePanel').then((m) => ({ default: m.SidePanel }))
)
const ToolRing = lazy(() =>
  import('./components/ToolRing').then((m) => ({ default: m.ToolRing }))
)
const ExportDialog = lazy(() =>
  import('./components/ExportDialog').then((m) => ({ default: m.ExportDialog }))
)
const MeshModalController = lazy(() =>
  import('./components/MeshModalController').then((m) => ({ default: m.MeshModalController }))
)
const UVEditorPanel = lazy(() =>
  import('./components/UVEditorPanel').then((m) => ({ default: m.UVEditorPanel }))
)
const MaterialEditorPanel = lazy(() =>
  import('./components/MaterialEditorPanel').then((m) => ({ default: m.MaterialEditorPanel }))
)
const PixelEditorPanel = lazy(() =>
  import('./components/PixelEditorPanel').then((m) => ({ default: m.PixelEditorPanel }))
)

const NUDGE_KEYS: Record<string, NudgeDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

const NUDGE_TOOLS = new Set([
  'select-object',
  'move',
  'select-vertex',
  'select-edge',
  'select-face',
])

/** Allow global shortcuts while using range/checkbox controls in the side panel. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) {
    const type = target.type
    return (
      type === 'text' ||
      type === 'search' ||
      type === 'password' ||
      type === 'email' ||
      type === 'url' ||
      type === 'number' ||
      type === 'tel'
    )
  }
  return false
}

export default function App() {
  const [graphicsNotice, setGraphicsNotice] = useState<string | null>(null)

  useEffect(() => subscribeGraphicsNotice(setGraphicsNotice), [])

  const lastMousePosRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      lastMousePosRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', handleMouseMove, true)
    return () => window.removeEventListener('mousemove', handleMouseMove, true)
  }, [])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
      const ctrlOrMeta = e.ctrlKey || e.metaKey
      const store = () => useAppStore.getState()

      // Undo / redo — always intercept so the browser doesn't steal Ctrl+Z.
      if (ctrlOrMeta && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault()
        if (!isTypingTarget(e.target)) store().undo()
        return
      }
      if (ctrlOrMeta && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) {
        e.preventDefault()
        if (!isTypingTarget(e.target)) store().redo()
        return
      }

      if (isTypingTarget(e.target)) return

      if (ctrlOrMeta && e.code === 'KeyC' && !e.shiftKey) {
        e.preventDefault()
        store().copySelection()
        return
      }
      if (ctrlOrMeta && e.code === 'KeyV' && !e.shiftKey) {
        e.preventDefault()
        store().pasteClipboard()
        return
      }
      if (ctrlOrMeta && e.code === 'KeyS' && !e.shiftKey) {
        e.preventDefault()
        void useAppStore.getState().saveProject().catch((err) => {
          window.alert(err instanceof Error ? err.message : 'Save failed.')
        })
        return
      }
      if (ctrlOrMeta && e.code === 'KeyO' && !e.shiftKey) {
        e.preventDefault()
        void useAppStore.getState().loadProjectFromDialog().catch((err) => {
          window.alert(err instanceof Error ? err.message : 'Load failed.')
        })
        return
      }
      if (ctrlOrMeta && e.code === 'KeyN' && !e.shiftKey) {
        e.preventDefault()
        const state = useAppStore.getState()
        const hasContent =
          state.objects.length > 0 ||
          state.referenceImages.length > 0 ||
          state.billboardImages.length > 0 ||
          Object.keys(state.pixelDocuments).length > 0
        if (!hasContent || window.confirm('Discard the current project? Unsaved changes will be lost.')) {
          state.newProject()
        }
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        const s = store()
        s.setShowToolRing(!s.showToolRing)
      }
      if (e.key === '\\' || e.code === 'Backslash') {
        e.preventDefault()
        const state = store()
        state.setShowSidePanel(!state.showSidePanel)
        return
      }
      if (e.key === 'Escape') {
        const state = store()
        if (state.meshModal) {
          e.preventDefault()
          state.cancelMeshModal()
          return
        }
        if (state.objectTransformModal) {
          e.preventDefault()
          state.cancelObjectTransformModal()
          return
        }
        if (state.uvEditorOpen) {
          e.preventDefault()
          const objectId = state.selectedObjectId ?? state.meshSelection?.objectId
          if (objectId) state.selectUvFaces(objectId, [])
          else {
            state.setUvEditorSelectedPoints([])
            state.setUvEditorSelectedFaces([])
          }
          return
        }
        state.setShowToolRing(false)
        state.setShowExportDialog(false)
        state.penCancelPath()
        state.cancelPrimitiveBoxDraft()
        state.polyDrawCancel()
        state.knifeCancel()
        state.bendCancel()
        state.loopCutCancel()
        state.clearMeshSelection()
        state.setMeshHover(null)
        state.setVertexMergeModifierHeld(false)
        if (state.maximizedSlot !== null) state.toggleMaximizedView()
      }
      if (e.key === ' ') {
        const state = store()
        if (state.uvEditorOpen) return
        e.preventDefault()
        state.toggleMaximizedView()
      }
      if (e.key === 'Enter') {
        const state = store()
        if (state.meshModal) {
          e.preventDefault()
          state.confirmMeshModal()
          return
        }
        if (state.objectTransformModal) {
          e.preventDefault()
          state.confirmObjectTransformModal()
          return
        }
        if (state.vectorPenDraft) {
          e.preventDefault()
          state.penFinishPath()
          return
        }
        if (state.activeTool === 'poly-draw') {
          e.preventDefault()
          state.polyDrawFinish()
          return
        }
        if (state.loopCutDraft) {
          e.preventDefault()
          state.loopCutCommit()
          return
        }
        if (state.activeTool === 'knife' && state.knifeDraft && state.knifeDraft.points.length >= 2) {
          e.preventDefault()
          state.knifeApply()
        }
      }
      if (e.key === 'f' || e.key === 'F') {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          const state = useAppStore.getState()
          if (state.activeTool === 'poly-draw' && state.lastPolyDrawFace) {
            e.preventDefault()
            state.flipLastPolyDrawFace()
            return
          }
          if (
            state.selectionMode === 'vertex' &&
            state.meshSelection &&
            (state.meshSelection.vertices.length === 3 ||
              state.meshSelection.vertices.length === 4)
          ) {
            e.preventDefault()
            state.createFaceFromVertexSelection()
            return
          }
          if (
            state.selectionMode !== 'object' &&
            selectionHasComponents(state.meshSelection)
          ) {
            e.preventDefault()
            state.flipSelectedNormals()
          }
        }
      }
      if (ctrlOrMeta && (e.code === 'KeyR')) {
        const state = useAppStore.getState()
        if (!state.meshModal && !state.objectTransformModal) {
          e.preventDefault()
          if (state.loopCutDraft) {
            state.loopCutCommit()
            return
          }
          let objectId: string | null = null
          let seedEdge: string | null = null
          if (state.meshHover?.edge) {
            objectId = state.meshHover.objectId
            seedEdge = `${Math.min(state.meshHover.edge[0], state.meshHover.edge[1])}-${Math.max(state.meshHover.edge[0], state.meshHover.edge[1])}`
          } else if (
            state.selectionMode === 'edge' &&
            state.meshSelection?.edges.length
          ) {
            objectId = state.meshSelection.objectId
            seedEdge = state.meshSelection.edges[0]
          }
          if (objectId && seedEdge) {
            state.loopCutBegin(objectId, seedEdge)
            state.selectObject(objectId)
          } else {
            state.setActiveTool('loop-cut')
            state.setSelectionMode('edge')
          }
          return
        }
      }
      if ((e.code === 'KeyK') && !ctrlOrMeta && !e.altKey) {
        e.preventDefault()
        useAppStore.getState().setActiveTool('knife')
        return
      }
      if (e.code === 'KeyU' && !ctrlOrMeta && !e.altKey && !e.repeat) {
        const state = useAppStore.getState()
        if (state.uvEditorOpen || state.meshModal || state.objectTransformModal) return
        const objectId = state.selectedObjectId ?? state.meshSelection?.objectId
        if (!objectId) return
        e.preventDefault()
        state.unwrapSelectedUvFaces('auto')
        return
      }
      if (ctrlOrMeta && e.code === 'Digit2') {
        e.preventDefault()
        if (e.shiftKey) {
          useAppStore.getState().adjustSubDLevelsSelected(-1)
        } else {
          useAppStore.getState().adjustSubDLevelsSelected(1)
        }
        return
      }
      if (e.key === '1') store().setSelectionMode('object')
      if (e.key === '2') store().setSelectionMode('vertex')
      if (e.key === '3') store().setSelectionMode('edge')
      if (e.key === '4') store().setSelectionMode('face')
      const state = store()
      const hasMeshComponents =
        state.selectionMode !== 'object' && selectionHasComponents(state.meshSelection)

      if (
        !state.meshModal &&
        !state.objectTransformModal &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        if (
          state.selectionMode === 'object' &&
          state.selectionObjectIds.length > 0
        ) {
          if (e.key === 'r' || e.key === 'R') {
            e.preventDefault()
            state.beginObjectTransformModal(
              'rotate',
              lastMousePosRef.current.x,
              lastMousePosRef.current.y
            )
            return
          }
          if (e.key === 's' || e.key === 'S') {
            e.preventDefault()
            state.beginObjectTransformModal(
              'scale',
              lastMousePosRef.current.x,
              lastMousePosRef.current.y
            )
            return
          }
        }

        if (hasMeshComponents) {
          if (e.key === 'e' || e.key === 'E') {
            e.preventDefault()
            state.beginMeshModal('extrude', lastMousePosRef.current.x, lastMousePosRef.current.y)
            return
          }
          if (e.key === 'r' || e.key === 'R') {
            e.preventDefault()
            state.beginMeshModal('rotate', lastMousePosRef.current.x, lastMousePosRef.current.y)
            return
          }
          if (e.key === 's' || e.key === 'S') {
            e.preventDefault()
            state.beginMeshModal('scale', lastMousePosRef.current.x, lastMousePosRef.current.y)
            return
          }
          if (e.key === 'b' || e.key === 'B') {
            e.preventDefault()
            state.beginMeshModal('bevel', lastMousePosRef.current.x, lastMousePosRef.current.y)
            return
          }
        }
      }

      if ((e.key === 'a' || e.key === 'A') && !ctrlOrMeta && !e.altKey && !e.shiftKey) {
        if (!store().uvEditorOpen) {
          e.preventDefault()
          store().toggleSelectAll()
          return
        }
      }

      if (e.key === 'q' || e.key === 'Q') store().setSelectionMode('object')
      if (e.key === 'w' || e.key === 'W') store().setActiveTool('move')
      if (e.key === 'e' || e.key === 'E') store().setActiveTool('rotate')
      if (e.key === 'r' || e.key === 'R') store().setActiveTool('rotate')
      if (e.key === 's' || e.key === 'S') store().setActiveTool('scale')
      if (e.key === 'v' || e.key === 'V') store().setDrawInputMode('vector-pen')
      if (e.key === 'd') store().setDrawInputMode('regular')
      if (e.key === 'l') store().toggleTopologyLock()
      if (e.key === 'g') {
        const s = store()
        s.setShowGrid(!s.showGrid)
      }
      if (e.key === 'x' || e.key === 'X') {
        const s = store()
        s.setViewportXRay(!s.viewportXRay)
      }
      if (e.code === 'KeyM' && !e.repeat && !ctrlOrMeta && !e.altKey) {
        const mergeState = store()
        if (mergeState.selectionMode === 'vertex' && mergeState.meshSelection) {
          const verts = mergeState.meshSelection.vertices
          if (verts.length >= 2) {
            e.preventDefault()
            mergeState.mergeSelectedVertices()
            return
          }
          if (verts.length === 1) {
            mergeState.setVertexMergeModifierHeld(true)
            return
          }
        }
      }
      if (e.key === 'h') store().setActiveTool('boolean-hole')

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const delState = store()
        if (delState.selectedReferenceImageId || delState.selectedBillboardImageId) {
          e.preventDefault()
          delState.deleteSelectedImageDrop()
          return
        }
        const hasObjectSelection = delState.selectionObjectIds.length > 0
        const hasComponentSelection =
          delState.selectionMode !== 'object' &&
          selectionHasComponents(delState.meshSelection)
        if (hasObjectSelection || hasComponentSelection) {
          e.preventDefault()
          delState.deleteSelection()
        }
      }
      if (e.key in NUDGE_KEYS) {
        const nudgeState = store()
        const hasObjectSelection =
          nudgeState.selectionMode === 'object' && nudgeState.selectionObjectIds.length > 0
        const hasComponentSelection =
          (nudgeState.selectionMode === 'vertex' ||
            nudgeState.selectionMode === 'edge' ||
            nudgeState.selectionMode === 'face') &&
          selectionHasComponents(nudgeState.meshSelection)
        if (
          (hasObjectSelection || hasComponentSelection) &&
          NUDGE_TOOLS.has(nudgeState.activeTool)
        ) {
          e.preventDefault()
          nudgeState.nudgeSelection(NUDGE_KEYS[e.key], e.shiftKey)
        }
      }
    }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyDown])

  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyM') {
        useAppStore.getState().setVertexMergeModifierHeld(false)
      }
    }
    window.addEventListener('keyup', onKeyUp, true)
    return () => window.removeEventListener('keyup', onKeyUp, true)
  }, [])

  return (
    <AppErrorBoundary>
      <div className="app">
      <div className="app-body">
        <div className="app-main">
          <ViewportLayout />
        </div>
        <Suspense fallback={null}>
          <SidePanelHost />
        </Suspense>
      </div>

      {graphicsNotice && (
        <div className="graphics-notice" role="status" aria-live="polite">
          {graphicsNotice}
        </div>
      )}

      <TransformToolbar />
      <PrimitivesToolbar />
      <Suspense fallback={null}>
        <AppOverlays />
      </Suspense>
      </div>
    </AppErrorBoundary>
  )
}

function SidePanelHost() {
  const showSidePanel = useAppStore((s) => s.showSidePanel)
  if (!showSidePanel) return null
  return <SidePanel />
}

function AppOverlays() {
  const showToolRing = useAppStore((s) => s.showToolRing)
  const showExportDialog = useAppStore((s) => s.showExportDialog)
  const uvEditorOpen = useAppStore((s) => s.uvEditorOpen)
  const materialEditorOpen = useAppStore((s) => s.materialEditorOpen)
  const pixelEditorOpen = useAppStore((s) => s.pixelEditorOpen)
  const meshModalOpen = useAppStore((s) => !!(s.meshModal || s.objectTransformModal))

  return (
    <>
      {showToolRing && (
        <ToolRing onClose={() => useAppStore.getState().setShowToolRing(false)} />
      )}
      {showExportDialog && (
        <ExportDialog onClose={() => useAppStore.getState().setShowExportDialog(false)} />
      )}
      {meshModalOpen && <MeshModalController />}
      {uvEditorOpen && <UVEditorPanel />}
      {materialEditorOpen && <MaterialEditorPanel />}
      {pixelEditorOpen && <PixelEditorPanel />}
    </>
  )
}
