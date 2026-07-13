import { useEffect, useState } from 'react'
import {
  answerAppConfirm,
  subscribeAppConfirm,
  type AppConfirmRequest,
} from '../ui/appConfirm'

/** Themed replacement for window.confirm — works cleanly in the Wails exe. */
export function AppConfirmDialog() {
  const [request, setRequest] = useState<AppConfirmRequest | null>(null)

  useEffect(() => subscribeAppConfirm(setRequest), [])

  if (!request) return null

  return (
    <div
      className="app-confirm-overlay"
      role="presentation"
      onClick={() => answerAppConfirm(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          answerAppConfirm(false)
        }
      }}
    >
      <div
        className="app-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="app-confirm-title"
        aria-describedby="app-confirm-message"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="app-confirm-title">{request.title}</h2>
        <p id="app-confirm-message">{request.message}</p>
        <div className="app-confirm-actions">
          <button
            type="button"
            className="side-btn"
            autoFocus
            onClick={() => answerAppConfirm(false)}
          >
            {request.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            className={`side-btn side-btn-primary${request.danger ? ' app-confirm-danger' : ''}`}
            onClick={() => answerAppConfirm(true)}
          >
            {request.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
