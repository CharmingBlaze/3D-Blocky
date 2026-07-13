import { TransformControls, type TransformControlsProps } from '@react-three/drei'
import { forwardRef, useCallback, useLayoutEffect, useRef } from 'react'
import type { TransformControls as TransformControlsImpl } from 'three-stdlib'
import { applyTransformControlsTheme } from '../theme/gizmoTheme'
import { useTheme } from '../theme/useTheme'
import { pushViewportSharedInteraction, popViewportSharedInteraction } from '../rendering/viewportFrameLoop'
import { useViewportSlotIndex } from './ViewportSlotContext'


type TransformControlEvent = Parameters<NonNullable<TransformControlsProps['onMouseDown']>>[0]

export const ThemedTransformControls = forwardRef<
  TransformControlsImpl,
  TransformControlsProps
>(function ThemedTransformControls(props, forwardedRef) {
  const theme = useTheme()
  const slotIndex = useViewportSlotIndex()
  const localRef = useRef<TransformControlsImpl>(null)
  const { onMouseDown, onMouseUp, ...rest } = props

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

  const handleMouseDown = useCallback(
    (event: TransformControlEvent) => {
      pushViewportSharedInteraction(slotIndex)
      onMouseDown?.(event)
    },
    [onMouseDown, slotIndex]
  )

  const handleMouseUp = useCallback(
    (event: TransformControlEvent) => {
      popViewportSharedInteraction(slotIndex)
      onMouseUp?.(event)
    },
    [onMouseUp, slotIndex]
  )

  return (
    <TransformControls
      ref={mergeRef}
      {...rest}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    />
  )
})
