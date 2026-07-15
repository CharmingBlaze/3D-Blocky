import { Component, type ErrorInfo, type ReactNode } from 'react'
import { APP_NAME } from '../app/branding'
import { AppBrandMark } from './AppBrandMark'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
}

/** Keeps a recoverable UI on screen if a tool or viewport throws unexpectedly. */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error(`${APP_NAME} encountered an unexpected error.`, error, info)
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <main className="app-recovery" role="alert">
        <div className="app-recovery-card">
          <AppBrandMark className="app-recovery-brand" />
          <p className="app-recovery-kicker">{APP_NAME} needs to restart</p>
          <h1>Something went wrong in the workspace.</h1>
          <p>
            Reload the app to return to a clean state. If you have an open project file, you can
            load it again after restarting.
          </p>
          <button type="button" className="side-btn side-btn-primary" onClick={() => window.location.reload()}>
            Reload app
          </button>
        </div>
      </main>
    )
  }
}
