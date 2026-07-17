import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore, type ViewType } from '../store/appStore'
import { sampleAnchors } from '../vector/bezier'
import { ExtrudePreviewMesh } from './ExtrudePreviewMesh'
import type { Vec2 } from '../utils/math'

/**
 * Live Extrude/Hair/Sweep/Lathe preview for Vector Pen drafts.
 * Rebuilds are coalesced to one rAF tick so handle drags stay smooth.
 */
export function VectorPenVolumePreview({ view }: { view: ViewType }) {
  const {
    vectorPenDraft,
    activeTool,
    strokeMode,
    sketchExtrudeMode,
    penExtrudeMode,
    sketchLatheMode,
    penLatheMode,
  } = useAppStore(
    useShallow((s) => ({
      vectorPenDraft: s.vectorPenDraft,
      activeTool: s.activeTool,
      strokeMode: s.strokeMode,
      sketchExtrudeMode: s.sketchExtrudeMode,
      penExtrudeMode: s.penExtrudeMode,
      sketchLatheMode: s.sketchLatheMode,
      penLatheMode: s.penLatheMode,
    }))
  )

  const [previewPoints, setPreviewPoints] = useState<Vec2[]>([])
  const [closed, setClosed] = useState(false)
  const [draftView, setDraftView] = useState<ViewType | null>(null)
  const rafRef = useRef<number | null>(null)
  const draftRef = useRef(vectorPenDraft)

  draftRef.current = vectorPenDraft

  const explicitlyVolumetric =
    sketchExtrudeMode ||
    penExtrudeMode ||
    sketchLatheMode ||
    penLatheMode ||
    strokeMode.startsWith('hair-') ||
    strokeMode === 'ribbon' ||
    strokeMode === 'tapered-tube' ||
    strokeMode === 'capsule' ||
    strokeMode === 'centerline'

  useEffect(() => {
    if (activeTool !== 'vector-pen' || !explicitlyVolumetric) {
      setPreviewPoints([])
      setDraftView(null)
      return
    }

    const schedule = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const draft = draftRef.current
        if (!draft || draft.anchors.length < 2) {
          setPreviewPoints([])
          setDraftView(null)
          return
        }
        const pts = sampleAnchors(
          draft.anchors,
          draft.closed,
          1.25,
          draft.closed ? null : draft.previewPoint
        )
        setPreviewPoints(pts)
        setClosed(draft.closed || draft.closeTargetActive)
        setDraftView(draft.view)
      })
    }

    schedule()
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [
    activeTool,
    explicitlyVolumetric,
    vectorPenDraft,
  ])

  // Match Sketch: volume preview in other viewports so the active plane stays clear.
  if (
    !explicitlyVolumetric ||
    !draftView ||
    draftView === view ||
    previewPoints.length < 2
  ) {
    return null
  }

  return <ExtrudePreviewMesh points={previewPoints} view={draftView} closed={closed} />
}
