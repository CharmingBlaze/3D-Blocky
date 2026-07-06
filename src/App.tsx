import { useEffect, useCallback, lazy, Suspense, useState } from 'react'
import './App.css'
import { subscribeGraphicsNotice } from './rendering/webglContextNotice'
import { ViewportLayout } from './components/ViewportLayout'
import { SidePanel } from './components/SidePanel'
import { ToolRing } from './components/ToolRing'
import { ExportDialog } from './components/ExportDialog'
import { MeshModalController } from './components/MeshModalController'
import { useAppStore } from './store/appStore'
import { selectionHasComponents } from './mesh/meshSelection'
import type { NudgeDirection } from './utils/viewNavigation'

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
  const setActiveTool = useAppStore((s) => s.setActiveTool)
  const setSelectionMode = useAppStore((s) => s.setSelectionMode)
  const setShowGrid = useAppStore((s) => s.setShowGrid)
  const setViewportXRay = useAppStore((s) => s.setViewportXRay)
  const setShowToolRing = useAppStore((s) => s.setShowToolRing)
  const setShowExportDialog = useAppStore((s) => s.setShowExportDialog)
  const undo = useAppStore((s) => s.undo)
  const redo = useAppStore((s) => s.redo)
  const toggleTopologyLock = useAppStore((s) => s.toggleTopologyLock)
  const penFinishPath = useAppStore((s) => s.penFinishPath)
  const penCancelPath = useAppStore((s) => s.penCancelPath)
  const toggleMaximizedView = useAppStore((s) => s.toggleMaximizedView)
  const setDrawInputMode = useAppStore((s) => s.setDrawInputMode)
  const showToolRing = useAppStore((s) => s.showToolRing)
  const showExportDialog = useAppStore((s) => s.showExportDialog)
  const uvEditorOpen = useAppStore((s) => s.uvEditorOpen)
  const materialEditorOpen = useAppStore((s) => s.materialEditorOpen)
  const pixelEditorOpen = useAppStore((s) => s.pixelEditorOpen)
  const [graphicsNotice, setGraphicsNotice] = useState<string | null>(null)

  useEffect(() => subscribeGraphicsNotice(setGraphicsNotice), [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const ctrlOrMeta = e.ctrlKey || e.metaKey

      // Undo / redo — always intercept so the browser doesn't steal Ctrl+Z.
      if (ctrlOrMeta && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault()
        if (!isTypingTarget(e.target)) undo()
        return
      }
      if (ctrlOrMeta && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) {
        e.preventDefault()
        if (!isTypingTarget(e.target)) redo()
        return
      }

      if (isTypingTarget(e.target)) return

      if (ctrlOrMeta && e.code === 'KeyC' && !e.shiftKey) {
        e.preventDefault()
        useAppStore.getState().copySelection()
        return
      }
      if (ctrlOrMeta && e.code === 'KeyV' && !e.shiftKey) {
        e.preventDefault()
        useAppStore.getState().pasteClipboard()
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
        setShowToolRing(!useAppStore.getState().showToolRing)
      }
      if (e.key === 'Escape') {
        const state = useAppStore.getState()
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
        setShowToolRing(false)
        setShowExportDialog(false)
        penCancelPath()
        useAppStore.getState().cancelPrimitiveBoxDraft()
        useAppStore.getState().polyDrawCancel()
        useAppStore.getState().knifeCancel()
        useAppStore.getState().loopCutCancel()
        useAppStore.getState().clearMeshSelection()
        useAppStore.getState().setMeshHover(null)
        useAppStore.getState().setVertexMergeModifierHeld(false)
        if (useAppStore.getState().maximizedView) toggleMaximizedView()
      }
      if (e.key === ' ') {
        const state = useAppStore.getState()
        if (state.uvEditorOpen) return
        e.preventDefault()
        toggleMaximizedView()
      }
      if (e.key === 'Enter') {
        const state = useAppStore.getState()
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
        penFinishPath()
        if (useAppStore.getState().activeTool === 'poly-draw') {
          useAppStore.getState().polyDrawFinish()
        }
        if (useAppStore.getState().loopCutDraft) {
          useAppStore.getState().loopCutCommit()
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
      if (e.key === '1') setSelectionMode('object')
      if (e.key === '2') setSelectionMode('vertex')
      if (e.key === '3') setSelectionMode('edge')
      if (e.key === '4') setSelectionMode('face')
      const state = useAppStore.getState()
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
              window.innerWidth / 2,
              window.innerHeight / 2
            )
            return
          }
          if (e.key === 's' || e.key === 'S') {
            e.preventDefault()
            state.beginObjectTransformModal(
              'scale',
              window.innerWidth / 2,
              window.innerHeight / 2
            )
            return
          }
        }

        if (hasMeshComponents) {
          if (e.key === 'e' || e.key === 'E') {
            e.preventDefault()
            state.beginMeshModal('extrude', window.innerWidth / 2, window.innerHeight / 2)
            return
          }
          if (e.key === 'r' || e.key === 'R') {
            e.preventDefault()
            state.beginMeshModal('rotate', window.innerWidth / 2, window.innerHeight / 2)
            return
          }
          if (e.key === 's' || e.key === 'S') {
            e.preventDefault()
            state.beginMeshModal('scale', window.innerWidth / 2, window.innerHeight / 2)
            return
          }
          if (e.key === 'b' || e.key === 'B') {
            e.preventDefault()
            state.beginMeshModal('bevel', window.innerWidth / 2, window.innerHeight / 2)
            return
          }
        }
      }

      if (e.key === 'q' || e.key === 'Q') setSelectionMode('object')
      if (e.key === 'w' || e.key === 'W') setActiveTool('move')
      if (e.key === 'e' || e.key === 'E') setActiveTool('rotate')
      if (e.key === 'r' || e.key === 'R') setActiveTool('rotate')
      if (e.key === 's' || e.key === 'S') setActiveTool('scale')
      if (e.key === 'v' || e.key === 'V') setDrawInputMode('vector-pen')
      if (e.key === 'd') setDrawInputMode('regular')
      if (e.key === 'l') toggleTopologyLock()
      if (e.key === 'g') {
        const showGrid = useAppStore.getState().showGrid
        setShowGrid(!showGrid)
      }
      if (e.key === 'x' || e.key === 'X') {
        const xRay = useAppStore.getState().viewportXRay
        setViewportXRay(!xRay)
      }
      if (e.code === 'KeyM' && !e.repeat && !ctrlOrMeta && !e.altKey) {
        const state = useAppStore.getState()
        if (state.selectionMode === 'vertex' && state.meshSelection) {
          const verts = state.meshSelection.vertices
          if (verts.length >= 2) {
            e.preventDefault()
            state.mergeSelectedVertices()
            return
          }
          if (verts.length === 1) {
            state.setVertexMergeModifierHeld(true)
            return
          }
        }
      }
      if (e.key === 'h') setActiveTool('boolean-hole')

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const state = useAppStore.getState()
        if (state.selectedReferenceImageId || state.selectedBillboardImageId) {
          e.preventDefault()
          state.deleteSelectedImageDrop()
          return
        }
        const hasObjectSelection = state.selectionObjectIds.length > 0
        const hasComponentSelection =
          state.selectionMode !== 'object' &&
          selectionHasComponents(state.meshSelection)
        if (hasObjectSelection || hasComponentSelection) {
          e.preventDefault()
          state.deleteSelection()
        }
      }
      if (e.key in NUDGE_KEYS) {
        const state = useAppStore.getState()
        const hasObjectSelection =
          state.selectionMode === 'object' && state.selectionObjectIds.length > 0
        const hasComponentSelection =
          (state.selectionMode === 'vertex' ||
            state.selectionMode === 'edge' ||
            state.selectionMode === 'face') &&
          selectionHasComponents(state.meshSelection)
        if (
          (hasObjectSelection || hasComponentSelection) &&
          NUDGE_TOOLS.has(state.activeTool)
        ) {
          e.preventDefault()
          state.nudgeSelection(NUDGE_KEYS[e.key], e.shiftKey)
        }
      }
    },
    [
      undo,
      redo,
      setShowGrid,
      setViewportXRay,
      setShowToolRing,
      setShowExportDialog,
      setSelectionMode,
      setActiveTool,
      toggleTopologyLock,
      penFinishPath,
      penCancelPath,
      setDrawInputMode,
      toggleMaximizedView,
    ]
  )

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
    <div className="app">
      <div className="app-body">
        <div className="app-main">
          <ViewportLayout />
        </div>
        <SidePanel />
      </div>

      {graphicsNotice && (
        <div className="graphics-notice" role="status" aria-live="polite">
          {graphicsNotice}
        </div>
      )}

      {showToolRing && <ToolRing onClose={() => setShowToolRing(false)} />}
      {showExportDialog && <ExportDialog onClose={() => setShowExportDialog(false)} />}
      <MeshModalController />
      <Suspense fallback={null}>
        {uvEditorOpen && <UVEditorPanel />}
        {materialEditorOpen && <MaterialEditorPanel />}
        {pixelEditorOpen && <PixelEditorPanel />}
      </Suspense>
    </div>
  )
}
