/**
 * Top-level React error boundary.
 *
 * Without this, a single thrown render (malformed API payload, undefined
 * access in a lazy island, a bad query-key) blanks the entire SPA — the user
 * sees a white page with no recovery path short of a hard reload.
 *
 * The boundary catches render-time errors anywhere in the subtree, logs them,
 * and shows a localized fallback with a "Thử lại" (retry) button that remounts
 * the tree from scratch. It is intentionally framework-light: no external
 * error-boundary lib, just the React class API (the only way to catch render
 * errors).
 *
 * Per-island boundaries can be added later by wrapping each `<Suspense>`
 * island in its own `<ErrorBoundary>`; this top-level one is the safety net.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
  /** Incremented on each retry to force a fresh subtree mount. */
  retryKey: number
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '', retryKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, message: error?.message ?? 'Lỗi không xác định' }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console + the browser's error overlay. In production
    // this is where a Sentry/Datadog reportError() call would go.
    console.error('[ErrorBoundary] render crashed', error, info.componentStack)
  }

  private handleRetry = (): void => {
    this.setState((s) => ({ hasError: false, message: '', retryKey: s.retryKey + 1 }))
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50 ring-1 ring-red-100 dark:bg-red-950/40 dark:ring-red-900/50">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-8 w-8 text-red-500 dark:text-red-400"
              aria-hidden="true"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Ứng dụng gặp lỗi
            </h2>
            <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
              Đã xảy ra lỗi không mong muốn. Bạn có thể thử tải lại phần này hoặc
              làm mới toàn bộ trang.
            </p>
            {this.state.message && (
              <p className="mt-2 wrap-break-word rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-400 dark:bg-slate-900/60 dark:text-slate-500">
                {this.state.message}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-ring"
            >
              Thử lại
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      )
    }
    // key={retryKey} forces React to discard the old subtree and remount
    // cleanly on retry — the crashed state can't leak into the new tree.
    return <div key={this.state.retryKey}>{this.props.children}</div>
  }
}
