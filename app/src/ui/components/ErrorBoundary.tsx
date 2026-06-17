/* A render crash in one panel used to take down the whole SPA — there was no
   boundary anywhere. This catches render/lifecycle errors below it, keeps the
   rest of the app interactive, and offers a calm "reload this" affordance in
   MEW's voice (never a stack dump). Console-only logging — no telemetry, keys
   and privacy unaffected (a product law). Dependency-free by design. */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '../primitives'

interface Props {
  children: ReactNode
  /* names the panel in the fallback copy ("the session hit a snag") and the
     console line, so a contained failure reads in place. */
  label?: string
  /* compact = an in-place panel fallback; full = the outermost last-resort
     catch that owns the viewport. */
  variant?: 'compact' | 'full'
}

interface State {
  error: Error | null
  /* bumping this key on reset remounts the subtree fresh, so a transient
     error clears instead of the same render throwing straight back. */
  resetKey: number
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  /* reset is a pure transition: clear the error and bump the key so the subtree
     remounts clean. Kept static so the recovery path is unit-testable without a
     DOM (the app's vitest runs headless — no jsdom). */
  static clearError(s: State): Pick<State, 'error' | 'resetKey'> {
    return { error: null, resetKey: s.resetKey + 1 }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const where = this.props.label ? ` [${this.props.label}]` : ''
    // console only — no network. Surfaced for the dev console / `mew session` log.
    console.error(`mew: a panel hit a snag${where}`, error, info.componentStack)
  }

  private reset = () => {
    this.setState(ErrorBoundary.clearError)
  }

  render() {
    const { error, resetKey } = this.state
    if (!error) {
      // keyed so reset forces a clean remount of the wrapped subtree
      return <div key={resetKey} style={{ display: 'contents' }}>{this.props.children}</div>
    }

    const what = this.props.label ?? 'this panel'
    return (
      <div className={'err-boundary' + (this.props.variant === 'full' ? ' err-full' : '')} role="alert">
        <div className="err-mark" aria-hidden>
          ❯_
        </div>
        <div className="err-body">
          <div className="err-head">{what} hit a snag</div>
          <p className="err-msg">nothing was lost — reload it and we'll pick up where we left off.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={this.reset}>
          ↻ reload {this.props.label ?? 'panel'}
        </Button>
      </div>
    )
  }
}
