let dismissTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(message: string | null) => void>()

export const WEBGL_RESTORED_EVENT = 'blocky-webgl-restored'

export function subscribeGraphicsNotice(listener: (message: string | null) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(message: string | null): void {
  for (const listener of listeners) listener(message)
}

/** Brief non-blocking notice after a successful context restore. */
export function showGraphicsRecoveryNotice(
  message = 'Graphics were reset and recovered.'
): void {
  if (dismissTimer) clearTimeout(dismissTimer)
  notify(message)
  dismissTimer = setTimeout(() => {
    notify(null)
    dismissTimer = null
  }, 4000)
}

/** Blocking notice when the GPU context cannot be recovered. */
export function showGraphicsContextFailure(
  message = 'Graphics context was lost and could not be recovered. Please save your work and reload the page.'
): void {
  if (dismissTimer) clearTimeout(dismissTimer)
  dismissTimer = null
  notify(null)
  window.alert(message)
}
