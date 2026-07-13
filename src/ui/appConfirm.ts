/** In-app confirm dialog (avoids native window.confirm in Wails exe). */

export type AppConfirmRequest = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type Listener = (request: AppConfirmRequest | null) => void

let current: AppConfirmRequest | null = null
let resolver: ((ok: boolean) => void) | null = null
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener(current)
}

export function subscribeAppConfirm(listener: Listener): () => void {
  listeners.add(listener)
  listener(current)
  return () => {
    listeners.delete(listener)
  }
}

export function getAppConfirmRequest(): AppConfirmRequest | null {
  return current
}

export function answerAppConfirm(ok: boolean): void {
  const resolve = resolver
  current = null
  resolver = null
  emit()
  resolve?.(ok)
}

/** Show a themed confirm dialog. Resolves true if the user confirms. */
export function appConfirm(request: AppConfirmRequest): Promise<boolean> {
  if (resolver) {
    // Replace any pending prompt (shouldn't happen often).
    answerAppConfirm(false)
  }
  current = {
    confirmLabel: 'OK',
    cancelLabel: 'Cancel',
    danger: false,
    ...request,
  }
  return new Promise<boolean>((resolve) => {
    resolver = resolve
    emit()
  })
}

export function confirmDiscardProject(): Promise<boolean> {
  return appConfirm({
    title: 'New project',
    message: 'Discard the current project? Unsaved changes will be lost.',
    confirmLabel: 'Discard',
    cancelLabel: 'Cancel',
    danger: true,
  })
}
