import { useCallback, useEffect, useRef } from 'react'

/**
 * Time a page spends visible, for the `ms` its ledger events carry (docs/specs/wave-3.md §15.1, the journey re-cut).
 *
 * The clock runs only while the document is visible: a tab left open in the background adds nothing, so a Daily or a
 * Fleet Week act that waits behind other tabs for an evening does not log hours. Time on a visible page that nobody
 * reads still runs, which is why every writer also caps what one event records (`INCIDENT_MAX_MS`, `FLEET_RUN_MAX_MS`,
 * `FLEET_ACT_MAX_MS`). A page reads the clock and passes numbers in: the world and fleet modules never read a clock
 * (verify:determinism).
 */
export interface VisibleClock {
  /** Visible milliseconds since the clock was made. */
  read(): number
  /** Stop listening for visibility changes; `read` then holds its last value. */
  dispose(): void
}

/** What the clock reads from its page; tests give their own. */
export interface VisibleClockEnv {
  /** A monotonic clock in milliseconds. */
  now(): number
  hidden(): boolean
  /** Subscribe to visibility changes; returns the unsubscribe. */
  watch(onChange: () => void): () => void
}

function browserEnv(): VisibleClockEnv {
  const doc = typeof document === 'undefined' ? null : document
  return {
    now: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
    hidden: () => doc?.visibilityState === 'hidden',
    watch: (onChange) => {
      doc?.addEventListener('visibilitychange', onChange)
      return () => doc?.removeEventListener('visibilitychange', onChange)
    },
  }
}

export function visibleClock(env: VisibleClockEnv = browserEnv()): VisibleClock {
  let total = 0
  /** When the current visible stretch began, or null while hidden. */
  let since: number | null = env.hidden() ? null : env.now()
  const settle = () => {
    if (since === null) return
    const now = env.now()
    total += Math.max(0, now - since)
    since = now
  }
  const unwatch = env.watch(() => {
    settle()
    since = env.hidden() ? null : env.now()
  })
  let live = true
  return {
    read: () => {
      if (live) settle()
      return total
    },
    dispose: () => {
      if (!live) return
      settle()
      live = false
      since = null
      unwatch()
    },
  }
}

/**
 * The page's visible clock: `read()` gives the visible milliseconds since the page mounted (0 before its first effect).
 * Callers take marks and subtract them, so one clock times every attempt on the page.
 */
export function useVisibleClock(): () => number {
  const clock = useRef<VisibleClock | null>(null)
  useEffect(() => {
    const c = visibleClock()
    clock.current = c
    return () => {
      c.dispose()
      if (clock.current === c) clock.current = null
    }
  }, [])
  return useCallback(() => clock.current?.read() ?? 0, [])
}
