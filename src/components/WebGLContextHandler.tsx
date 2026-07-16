import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useAppStore } from '../store/appStore'
import {
  WEBGL_RESTORED_EVENT,
  showGraphicsContextFailure,
  showGraphicsRecoveryNotice,
} from '../rendering/webglContextNotice'
import {
  registerWebGLRenderer,
  unregisterWebGLRenderer,
} from '../rendering/pixelDocTexture'

const RESTORE_FAILURE_MS = 4000

/** Per-canvas WebGL context loss / restore handling (see item #6 audit). */
export function WebGLContextHandler() {
  const { gl, invalidate } = useThree()

  useEffect(() => {
    const canvas = gl.domElement
    let restoreFailedTimer: ReturnType<typeof setTimeout> | null = null
    registerWebGLRenderer(gl)

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
        __blockyDebugWebGLRenderers?: Array<typeof gl>
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
      if (!debugWindow.__blockyDebugWebGLRenderers) {
        debugWindow.__blockyDebugWebGLRenderers = []
      }
      debugWindow.__blockyDebugWebGLRenderers.push(gl)
    }

    return () => {
      clearFailureTimer()
      unregisterWebGLRenderer(gl)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      window.removeEventListener(WEBGL_RESTORED_EVENT, onPeerRestored)
      if (import.meta.env.DEV) {
        const contexts = (
          window as Window & {
            __blockyDebugWebGLContexts?: WebGLRenderingContext[]
            __blockyDebugWebGLRenderers?: Array<typeof gl>
          }
        ).__blockyDebugWebGLContexts
        const contextIndex = contexts?.indexOf(gl.getContext())
        if (contexts && contextIndex !== undefined && contextIndex >= 0) {
          contexts.splice(contextIndex, 1)
        }
        const renderers = (
          window as Window & { __blockyDebugWebGLRenderers?: Array<typeof gl> }
        ).__blockyDebugWebGLRenderers
        const rendererIndex = renderers?.indexOf(gl)
        if (renderers && rendererIndex !== undefined && rendererIndex >= 0) {
          renderers.splice(rendererIndex, 1)
        }
      }
    }
  }, [gl, invalidate])

  return null
}
