import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** what failed, in a few words — shown in the heading ("this page", "this simulator") */
  label?: string
  /** clears a caught error when it changes (a route or panel switch), so navigating away recovers */
  resetKey?: string
  /** replaces the default message, e.g. `null` for a purely decorative chunk */
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches a failed lazy chunk (a deploy replaced the hashed assets under an open tab, or the
 * network dropped) and any render error beneath it, so one broken panel shows a message and a
 * way out instead of unmounting the whole React root. React.lazy caches its rejection, so the
 * only real recovery is a full reload.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    const label = this.props.label ?? 'this page'
    return (
      <div role="alert" className="mx-auto max-w-5xl px-6 py-24">
        <p className="section-label">0xFF — load failed</p>
        <h2 className="mt-3 text-xl font-semibold text-text-1">Could not load {label}.</h2>
        <p className="mt-2 max-w-xl text-body-sm text-text-2">
          A new version may have been deployed, or the connection dropped. Reloading fetches the
          current files; your progress is saved in this browser.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 rounded-md border border-accent/60 bg-accent/10 px-4 py-2 font-mono text-sm text-accent transition-colors hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Reload
        </button>
      </div>
    )
  }
}
