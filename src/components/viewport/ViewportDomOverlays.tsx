import { MarqueeOverlay } from '../MarqueeOverlay'
import { SymmetryPlaneOverlay } from '../SymmetryPlaneOverlay'
import { ReferenceImageOverlay } from '../ReferenceImageOverlay'
import { useAppStore, type ActiveTool, type ViewType } from '../../store/appStore'
import type * as THREE from 'three'
import type { KnifeDraft } from '../../store/cadMeshToolsSlice'

function knifeSnapLabel(draft: KnifeDraft | null): string {
  if (draft?.feedback) return draft.feedback
  switch (draft?.hover?.snap) {
    case 'vertex': return 'Vertex snap'
    case 'edge': return 'Edge snap'
    case 'face-center': return 'Face center'
    case 'grid': return 'Face grid'
    case 'path': return 'Existing cut point'
    default: return draft?.points.length ? 'Place the next point' : 'Click a mesh to start'
  }
}

/** DOM-layer overlays (outside the R3F canvas). */
export function ViewportDomOverlays({
  view,
  isActive,
  activeTool,
  containerRef,
  cameraRef,
  marqueeRect,
  knifeDraft,
}: {
  view: ViewType
  isActive: boolean
  activeTool: ActiveTool
  containerRef: React.RefObject<HTMLDivElement | null>
  cameraRef: React.MutableRefObject<THREE.Camera | null>
  marqueeRect: { x0: number; y0: number; x1: number; y1: number } | null
  knifeDraft: KnifeDraft | null
}) {
  return (
    <>
      {isActive && activeTool === 'knife' && (
        <div className="knife-tool-toast" role="status">
          <div className="knife-tool-toast-copy">
            <strong className="knife-tool-toast-title">
              Knife{knifeDraft?.points.length ? ` · ${knifeDraft.points.length} points` : ''}
            </strong>
            <span className="knife-tool-toast-message">{knifeSnapLabel(knifeDraft)}</span>
            <span className="knife-tool-toast-shortcuts">
              Shift: centers/steps&nbsp;&nbsp; Ctrl: grid&nbsp;&nbsp; Enter: apply
            </span>
          </div>
          <div className="knife-tool-toast-actions">
            <button
              type="button"
              className="knife-tool-toast-btn"
              disabled={!knifeDraft?.points.length}
              onClick={(e) => {
                e.stopPropagation()
                useAppStore.getState().knifeRemoveLastPoint()
              }}
            >
              Back
            </button>
            <button
              type="button"
              className="knife-tool-toast-btn knife-tool-toast-btn-primary"
              disabled={!knifeDraft || knifeDraft.points.length < 2}
              onClick={(e) => {
                e.stopPropagation()
                useAppStore.getState().knifeApply()
              }}
            >
              Apply <kbd>Enter</kbd>
            </button>
          </div>
          <button
            type="button"
            className="knife-tool-toast-close"
            aria-label="Cancel knife"
            onClick={(e) => {
              e.stopPropagation()
              useAppStore.getState().knifeCancel()
            }}
          >
            ×
          </button>
        </div>
      )}

      {marqueeRect && <MarqueeOverlay rect={marqueeRect} />}

      <ReferenceImageOverlay view={view} containerRef={containerRef} />

      <SymmetryPlaneOverlay view={view} containerRef={containerRef} cameraRef={cameraRef} />
    </>
  )
}
