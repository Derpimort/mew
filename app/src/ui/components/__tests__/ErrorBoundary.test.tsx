/* The app's vitest runs headless (no jsdom), so we exercise the boundary the
   way React does: getDerivedStateFromError flips it into the error state, the
   fallback renders (not the throwing child), and the reset transition clears
   the error + bumps the remount key so children come back. Static markup is
   enough — the contract is the state machine + which branch renders. */

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ErrorBoundary } from '../ErrorBoundary'

const CHILD = 'child-content-marker'
const Healthy = () => <span>{CHILD}</span>

function Boom(): never {
  throw new Error('kaboom')
}

describe('ErrorBoundary — a throwing child shows the fallback, not a crash', () => {
  it('renders children untouched when nothing throws', () => {
    const html = renderToStaticMarkup(
      <ErrorBoundary label="the session">
        <Healthy />
      </ErrorBoundary>,
    )
    expect(html).toContain(CHILD)
    expect(html).not.toContain('hit a snag')
  })

  it('getDerivedStateFromError flips the boundary into the error state', () => {
    const err = new Error('kaboom')
    expect(ErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err })
  })

  it('in the error state it renders the calm fallback, never the throwing child', () => {
    // mirror what React does after catching: state holds the error, then render()
    const eb = new ErrorBoundary({ label: 'the session', children: <Boom /> })
    eb.state = { error: new Error('kaboom'), resetKey: 0 }
    const html = renderToStaticMarkup(<>{eb.render()}</>)

    expect(html).toContain('the session hit a snag')
    expect(html).toContain('reload the session') // the reset affordance
    expect(html).not.toContain('kaboom') // no stack/raw error leaks
    expect(html).toContain('role="alert"')
  })

  it('the outermost full-variant fallback owns the viewport (err-full)', () => {
    const eb = new ErrorBoundary({ label: 'mew', variant: 'full', children: <Boom /> })
    eb.state = { error: new Error('x'), resetKey: 0 }
    expect(renderToStaticMarkup(<>{eb.render()}</>)).toContain('err-full')
  })
})

describe('ErrorBoundary — reset re-mounts the subtree', () => {
  it('clearError clears the error and bumps the remount key', () => {
    const next = ErrorBoundary.clearError({ error: new Error('kaboom'), resetKey: 3 })
    expect(next.error).toBeNull()
    expect(next.resetKey).toBe(4) // bumped → React remounts children fresh
  })

  it('after reset the boundary renders children again', () => {
    const eb = new ErrorBoundary({ label: 'the session', children: <Healthy /> })
    eb.state = ErrorBoundary.clearError({ error: new Error('kaboom'), resetKey: 0 })
    expect(renderToStaticMarkup(<>{eb.render()}</>)).toContain(CHILD)
  })
})

describe('ErrorBoundary — console-only, no network (privacy law)', () => {
  it('componentDidCatch logs to console and never opens a network call', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const eb = new ErrorBoundary({ label: 'the stage', children: <Boom /> })
    eb.componentDidCatch(new Error('kaboom'), { componentStack: '\n  at Boom' })

    expect(consoleSpy).toHaveBeenCalledOnce()
    expect(fetchSpy).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
    vi.unstubAllGlobals()
  })
})
