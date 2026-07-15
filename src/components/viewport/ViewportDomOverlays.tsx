import { MarqueeOverlay } from '../MarqueeOverlay'
import { SymmetryPlaneOverlay } from '../SymmetryPlaneOverlay'
import { ReferenceImageOverlay } from '../ReferenceImageOverlay'
import type { ViewType } from '../../store/appStore'
import type * as THREE from 'three'

/** DOM-layer overlays (outside the R3F canvas). */
export function ViewportDomOverlays({
  view,
  containerRef,
  cameraRef,
  marqueeRect,
}: {
  view: ViewType
  containerRef: React.RefObject<HTMLDivElement | null>
  cameraRef: React.MutableRefObject<THREE.Camera | null>
  marqueeRect: { x0: number; y0: number; x1: number; y1: number } | null
}) {
  return (
    <>
      {marqueeRect && <MarqueeOverlay rect={marqueeRect} />}

      <ReferenceImageOverlay view={view} containerRef={containerRef} />

      <SymmetryPlaneOverlay view={view} containerRef={containerRef} cameraRef={cameraRef} />
    </>
  )
}
