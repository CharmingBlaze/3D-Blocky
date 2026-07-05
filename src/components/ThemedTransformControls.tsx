import { TransformControls, type TransformControlsProps } from '@react-three/drei'
import { forwardRef, useLayoutEffect, useRef } from 'react'
import type { TransformControls as TransformControlsImpl } from 'three-stdlib'
import { applyTransformControlsTheme } from '../theme/gizmoTheme'
import { useTheme } from '../theme/useTheme'

export const ThemedTransformControls = forwardRef<
  TransformControlsImpl,
  TransformControlsProps
>(function ThemedTransformControls(props, forwardedRef) {
  const theme = useTheme()
  const localRef = useRef<TransformControlsImpl>(null)

  useLayoutEffect(() => {
    const controls = localRef.current
    if (!controls) return
    applyTransformControlsTheme(controls, theme)
  })

  const mergeRef = (instance: TransformControlsImpl | null) => {
    localRef.current = instance
    if (typeof forwardedRef === 'function') forwardedRef(instance)
    else if (forwardedRef) forwardedRef.current = instance
  }

  return <TransformControls ref={mergeRef} {...props} />
})
