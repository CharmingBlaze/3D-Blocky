import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { MOUSE } from 'three'
import {
  popViewportLocalInteraction,
  pushViewportLocalInteraction,
} from '../../rendering/viewportFrameLoop'
import { invalidateViewport } from '../../rendering/viewportInvalidation'
import type { ViewType } from '../../store/appStore'
import type { ViewportSlotIndex } from '../../scene/viewTypes'
import { useViewportRender } from '../ViewportRenderContext'

function resolvePrimaryNavigation(
  modifiers: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
  isPerspective: boolean
): 'orbit' | 'pan' | null {
  // Shift stays free for additive selection unless Alt is also held (laptop pan).
  if (modifiers.ctrlKey || modifiers.metaKey || (modifiers.shiftKey && modifiers.altKey)) {
    return 'pan'
  }
  if (isPerspective && modifiers.altKey) return 'orbit'
  return null
}

function leftMouseAction(
  navigation: 'orbit' | 'pan' | null,
  isPerspective: boolean
): (typeof MOUSE)[keyof typeof MOUSE] | undefined {
  if (navigation === 'pan') return MOUSE.PAN
  if (navigation === 'orbit' && isPerspective) return MOUSE.ROTATE
  return undefined
}

export function ViewportControls({
  rootRef,
  view,
  slotIndex,
  enableZoom = true,
  disableMiddlePan = false,
  trackViewportFrameLoop = true,
}: {
  rootRef: React.RefObject<HTMLDivElement | null>
  view: ViewType
  slotIndex: ViewportSlotIndex
  enableZoom?: boolean
  disableMiddlePan?: boolean
  /** False for secondary canvases that are not part of the quad viewport registry. */
  trackViewportFrameLoop?: boolean
}) {
  const { layoutVisible } = useViewportRender()
  const invalidate = useThree((s) => s.invalidate)
  const [domElement, setDomElement] = useState<HTMLElement | null>(null)
  const [primaryNavigation, setPrimaryNavigation] = useState<'orbit' | 'pan' | null>(null)
  const controlsRef = useRef<{ mouseButtons: { LEFT?: number; MIDDLE?: number; RIGHT?: number } } | null>(
    null
  )
  const interactionHeldRef = useRef(false)
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPerspective = view === 'perspective'

  useLayoutEffect(() => {
    if (rootRef.current) setDomElement(rootRef.current)
  }, [rootRef])

  useEffect(() => {
    return () => {
      if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current)
      if (interactionHeldRef.current && trackViewportFrameLoop) {
        popViewportLocalInteraction(slotIndex)
      }
      setDomElement(null)
    }
  }, [slotIndex, trackViewportFrameLoop])

  useEffect(() => {
    const syncFromModifiers = (modifiers: {
      shiftKey: boolean
      altKey: boolean
      ctrlKey: boolean
      metaKey: boolean
    }) => {
      const next = resolvePrimaryNavigation(modifiers, isPerspective)
      // Keep the active camera gesture stable if modifiers are released mid-drag.
      if (next == null && interactionHeldRef.current) return
      setPrimaryNavigation(next)
      const controls = controlsRef.current
      if (controls) {
        controls.mouseButtons.LEFT = leftMouseAction(next, isPerspective)
      }
    }

    const onKey = (event: KeyboardEvent) => {
      syncFromModifiers(event)
    }
    const clearNavigation = () => {
      if (interactionHeldRef.current) return
      setPrimaryNavigation(null)
      const controls = controlsRef.current
      if (controls) controls.mouseButtons.LEFT = undefined
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', clearNavigation)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', clearNavigation)
    }
  }, [isPerspective])

  // Sync LEFT-button mapping from the pointer event itself (before OrbitControls),
  // so Shift+Alt / Ctrl pan matches middle-mouse pan without waiting on React state.
  useEffect(() => {
    if (!domElement) return

    const onPointerDownCapture = (event: PointerEvent) => {
      if (event.button !== 0) return
      const next = resolvePrimaryNavigation(event, isPerspective)
      setPrimaryNavigation(next)
      const controls = controlsRef.current
      if (controls) {
        controls.mouseButtons.LEFT = leftMouseAction(next, isPerspective)
        controls.mouseButtons.MIDDLE = disableMiddlePan ? undefined : MOUSE.PAN
        controls.mouseButtons.RIGHT = isPerspective ? MOUSE.ROTATE : undefined
      }
    }

    domElement.addEventListener('pointerdown', onPointerDownCapture, true)
    return () => domElement.removeEventListener('pointerdown', onPointerDownCapture, true)
  }, [domElement, isPerspective, disableMiddlePan])

  const handleControlsChange = useCallback(() => {
    if (layoutVisible) invalidateViewport(slotIndex, 'camera')
    else invalidate()
  }, [invalidate, layoutVisible, slotIndex])

  const handleControlsStart = useCallback(() => {
    if (releaseTimerRef.current !== null) {
      clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
    }
    if (!interactionHeldRef.current) {
      interactionHeldRef.current = true
      if (trackViewportFrameLoop) pushViewportLocalInteraction(slotIndex)
    }
  }, [slotIndex, trackViewportFrameLoop])

  const handleControlsEnd = useCallback(() => {
    if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current)
    // Keep a few frames alive after the gesture so damping can settle naturally.
    releaseTimerRef.current = setTimeout(() => {
      releaseTimerRef.current = null
      if (!interactionHeldRef.current) return
      interactionHeldRef.current = false
      if (trackViewportFrameLoop) popViewportLocalInteraction(slotIndex)
    }, 260)
  }, [slotIndex, trackViewportFrameLoop])

  if (!domElement) return null

  return (
    <OrbitControls
      ref={controlsRef as never}
      domElement={domElement}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      enableRotate={isPerspective}
      enablePan
      enableZoom={enableZoom}
      zoomSpeed={0.75}
      panSpeed={0.9}
      rotateSpeed={0.75}
      onChange={handleControlsChange}
      onStart={handleControlsStart}
      onEnd={handleControlsEnd}
      mouseButtons={{
        // Laptop-friendly camera navigation with the primary button.
        // Shift alone stays free for additive selection; Shift+Alt pans like MMB.
        LEFT: leftMouseAction(primaryNavigation, isPerspective),
        MIDDLE: disableMiddlePan ? undefined : MOUSE.PAN,
        RIGHT: isPerspective ? MOUSE.ROTATE : undefined,
      }}
    />
  )
}

export { resolvePrimaryNavigation }
