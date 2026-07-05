import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'

/** Disable R3F raycasting while the transform gizmo is active so drei controls receive pointer input. */
export function ViewportPointerPolicy({ gizmoActive }: { gizmoActive: boolean }) {
  const setEvents = useThree((s) => s.setEvents)
  const setEventsRef = useRef(setEvents)
  setEventsRef.current = setEvents

  useEffect(() => {
    setEventsRef.current({ enabled: !gizmoActive })
    return () => setEventsRef.current({ enabled: true })
  }, [gizmoActive])

  return null
}
