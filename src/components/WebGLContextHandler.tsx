import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useAppStore } from '../store/appStore'
import {
  WEBGL_RESTORED_EVENT,
  showGraphicsContextFailure,
  showGraphicsRecoveryNotice,
} from '../rendering/webglContextNotice'

const RESTORE_FAILURE_MS = 4000

/** Per-canvas WebGL context loss / restore handling (see item #6 audit). */
export function WebGLContextHandler() {
  const { gl, invalidate } = useThree()

  useEffect(() => {
    const canvas = gl.domElement
    let restoreFailedTimer: ReturnType<typeof setTimeout> | null = null

    const clearFailureTimer = () => {
      if (restoreFailedTimer !== null) {
        clearTimeout(restoreFailedTimer)
        restoreFailedTimer = null
      }
    }

    const onPeerRestored = () => invalidate()

    const onLost = (event: Event) => {
      event.preventDefault()
      clearFailureTimer()
      restoreFailedTimer = setTimeout(() => {
        if (gl.getContext().isContextLost()) {
          showGraphicsContextFailure()
        }
      }, RESTORE_FAILURE_MS)
    }

    const onRestored = () => {
      clearFailureTimer()
      useAppStore.getState().reconcileGpuResources()
      invalidate()
      window.dispatchEvent(new CustomEvent(WEBGL_RESTORED_EVENT))
      showGraphicsRecoveryNotice()
    }

    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    window.addEventListener(WEBGL_RESTORED_EVENT, onPeerRestored)

    if (import.meta.env.DEV) {
      const context = gl.getContext()
      const debugWindow = window as Window & {
        __blockyDebugWebGLContexts?: WebGLRenderingContext[]
        __blockyDebugLoseWebGL?: (canvasIndex?: number) => void
        __blockyDebugRestoreWebGL?: (canvasIndex?: number) => void
      }
      if (!debugWindow.__blockyDebugWebGLContexts) {
        debugWindow.__blockyDebugWebGLContexts = []
        debugWindow.__blockyDebugLoseWebGL = (canvasIndex = 0) => {
          const ctx = debugWindow.__blockyDebugWebGLContexts?.[canvasIndex]
          ctx?.getExtension('WEBGL_lose_context')?.loseContext()
        }
        debugWindow.__blockyDebugRestoreWebGL = (canvasIndex = 0) => {
          const ctx = debugWindow.__blockyDebugWebGLContexts?.[canvasIndex]
          ctx?.getExtension('WEBGL_lose_context')?.restoreContext()
        }
      }
      debugWindow.__blockyDebugWebGLContexts.push(context)
    }

    return () => {
      clearFailureTimer()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      window.removeEventListener(WEBGL_RESTORED_EVENT, onPeerRestored)
    }
  }, [gl, invalidate])

  return null
}
