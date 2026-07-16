import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Bounds } from '@react-three/drei'
import type * as THREE from 'three'
import type { SceneObject } from '../../mesh/HalfEdgeMesh'
import { ensureTransform, getObjectPivot } from '../../mesh/objectTransform'
import { pickMeshComponent } from '../../select/meshPick'
import { useAppStore } from '../../store/appStore'
import { useTheme } from '../../theme/useTheme'
import { MeshRenderer } from '../MeshRenderer'
import { MeshEditVisuals } from '../MeshEditVisuals'
import { ViewportControls, resolvePrimaryNavigation } from '../viewport/ViewportControls'
import { ViewportRenderContext } from '../ViewportRenderContext'
import { resolveUvPreviewFaceSelection } from '../../uv/uvPreviewSelection'

function CameraBridge({ cameraRef }: { cameraRef: React.MutableRefObject<THREE.Camera | null> }) {
  const camera = useThree((state) => state.camera)
  useEffect(() => {
    cameraRef.current = camera
    return () => {
      if (cameraRef.current === camera) cameraRef.current = null
    }
  }, [camera, cameraRef])
  return null
}

function SelectedObjectScene({
  object,
  selectedFaces,
  hoverFace,
}: {
  object: SceneObject
  selectedFaces: number[]
  hoverFace: number | null
}) {
  const tr = ensureTransform(object)
  const pivot = getObjectPivot(object)
  const meshSelection = selectedFaces.length
    ? { objectId: object.id, vertices: [], edges: [], faces: selectedFaces }
    : null
  const meshHover = hoverFace === null
    ? null
    : { objectId: object.id, face: hoverFace }

  return (
    <Bounds key={object.id} fit clip margin={1.28}>
      <group
        position={[tr.position.x, tr.position.y, tr.position.z]}
        rotation={[tr.rotation.x, tr.rotation.y, tr.rotation.z]}
        scale={[tr.scale.x, tr.scale.y, tr.scale.z]}
      >
        <group position={[-pivot.x, -pivot.y, -pivot.z]}>
          <MeshRenderer
            object={object}
            isSelected
            isPrimary
            facetExaggeration={0}
            showDensityHeatmap={false}
            displayMode="model"
          />
          <MeshEditVisuals
            object={object}
            selectionMode="face"
            meshSelection={meshSelection}
            meshHover={meshHover}
            showPickableOverlay={false}
          />
        </group>
      </group>
    </Bounds>
  )
}

export function UvObjectPreview({ object }: { object: SceneObject | null }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<THREE.Camera | null>(null)
  const hoverRafRef = useRef<number | null>(null)
  const lastHoverRef = useRef<{ x: number; y: number } | null>(null)
  const lastHoverPickAtRef = useRef(0)
  const hoverFaceRef = useRef<number | null>(null)
  const [hoverFace, setHoverFace] = useState<number | null>(null)
  const theme = useTheme()
  const selectedFaces = useAppStore((state) => state.uvEditorSelectedFaces)
  const selectedFaceCount = selectedFaces.length

  const commitHoverFace = useCallback((next: number | null) => {
    if (hoverFaceRef.current === next) return
    hoverFaceRef.current = next
    setHoverFace(next)
  }, [])

  const pickFace = useCallback(
    (clientX: number, clientY: number) => {
      const root = rootRef.current
      const camera = cameraRef.current
      if (!root || !camera || !object) return null
      camera.updateMatrixWorld()
      return pickMeshComponent(
        'face',
        clientX,
        clientY,
        root.getBoundingClientRect(),
        camera,
        [object],
        object.id,
        // Use the surface ray path. The default face path targets small X-ray
        // centroid dots, which made most of each visible face impossible to click.
        { cullBackVertices: true }
      )
    },
    [object]
  )

  const updateHover = useCallback(() => {
    hoverRafRef.current = null
    const pointer = lastHoverRef.current
    if (!pointer || !object) return
    const now = performance.now()
    // Dense meshes stay responsive while 30 Hz remains smooth for hover feedback.
    if (now - lastHoverPickAtRef.current < 32) return
    lastHoverPickAtRef.current = now
    const hit = pickFace(pointer.x, pointer.y)
    commitHoverFace(hit?.face ?? null)
  }, [object, pickFace, commitHoverFace])

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!object || event.buttons !== 0 || resolvePrimaryNavigation(event, true)) return
    lastHoverRef.current = { x: event.clientX, y: event.clientY }
    if (hoverRafRef.current === null) hoverRafRef.current = requestAnimationFrame(updateHover)
  }

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || !object || resolvePrimaryNavigation(event, true)) return
    const hit = pickFace(event.clientX, event.clientY)
    const state = useAppStore.getState()
    if (hit?.face === undefined) {
      if (!event.shiftKey) state.selectUvFaces(object.id, [])
      return
    }
    const next = resolveUvPreviewFaceSelection(
      state.uvEditorSelectedFaces,
      hit.face,
      event.shiftKey
    )
    state.setUvEditorMode('faces')
    state.selectUvFaces(object.id, next)
    commitHoverFace(hit.face)
    event.preventDefault()
  }

  useEffect(() => {
    return () => {
      if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current)
    }
  }, [])

  useEffect(() => {
    hoverFaceRef.current = null
    setHoverFace(null)
  }, [object?.id])

  return (
    <section className="uv-preview" aria-label="Selected object UV preview">
      <div
        ref={rootRef}
        className="uv-preview-viewport"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => commitHoverFace(null)}
        onContextMenu={(event) => event.preventDefault()}
        title="Click faces to select · Shift+click to add · Alt+drag orbit · Shift+Alt or Ctrl+drag pan"
      >
        {object ? (
          <ViewportRenderContext.Provider value={{ layoutVisible: false, continuousFrames: false }}>
            <Canvas
              frameloop="demand"
              dpr={1}
              camera={{ position: [12, 10, 12], fov: 42, near: 0.05, far: 4000 }}
              gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
              style={{ background: theme.bgDark }}
            >
              <color attach="background" args={[theme.bgDark]} />
              <hemisphereLight args={[0xffffff, 0x27303a, 1.8]} />
              <directionalLight position={[8, 12, 10]} intensity={2.2} />
              <directionalLight position={[-7, 3, -6]} intensity={0.65} />
              <SelectedObjectScene
                object={object}
                selectedFaces={selectedFaces}
                hoverFace={hoverFace}
              />
              <CameraBridge cameraRef={cameraRef} />
              <ViewportControls
                rootRef={rootRef}
                view="perspective"
                slotIndex={0}
                trackViewportFrameLoop={false}
              />
            </Canvas>
          </ViewportRenderContext.Provider>
        ) : (
          <div className="uv-preview-empty">Select an object to preview its UV mapping</div>
        )}

        <div className="uv-preview-chrome">
          <strong>{object?.name ?? '3D Preview'}</strong>
          <span>
            {selectedFaceCount ? `${selectedFaceCount} face${selectedFaceCount === 1 ? '' : 's'} selected · ` : ''}
            Click face · Shift adds · Alt orbit · Shift+Alt pan · Scroll zoom
          </span>
        </div>
      </div>
    </section>
  )
}
