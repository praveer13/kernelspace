/**
 * The live region's speaking rule (wave-1.md §10.5, 2b-07 minor): a sim's `announce` is spoken when it changes,
 * at most once a second, newest wins. It is also spoken again when the sim clears it and then sets the same text,
 * so re-running a deterministic configuration ("Fixed trace complete on static batching ...") is not silent.
 *
 *   push('A')        speak('A')   after announceDelay
 *   push(undefined)  speak('')    the region empties, so the next 'A' is a change a screen reader reports
 *   push('A')        speak('A')   again
 *
 * Pure of React and the DOM so a test can drive it with a fake clock (tests/sims/mirror-live.test.ts).
 */

import { announceDelay } from './host'

export interface Announcer {
  /** The sim's current `announce` (undefined or '' when it has none). Call on every change of that prop. */
  push(text: string | undefined): void
  /** Drop a pending announcement (unmount). */
  cancel(): void
}

export interface AnnouncerDeps {
  /** Sets the live region's text. */
  speak(text: string): void
  now(): number
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  schedule(fn: () => void, ms: number): () => void
}

export function createAnnouncer(deps: AnnouncerDeps): Announcer {
  let lastAt: number | null = null
  let cancelPending: (() => void) | null = null
  const cancel = () => {
    cancelPending?.()
    cancelPending = null
  }
  return {
    push(text) {
      cancel()
      if (text === undefined || text === '') {
        // clear now: an announcement the sim withdrew is not spoken late, and the same text can come back
        deps.speak('')
        return
      }
      cancelPending = deps.schedule(() => {
        cancelPending = null
        lastAt = deps.now()
        deps.speak(text)
      }, announceDelay(lastAt, deps.now()))
    },
    cancel,
  }
}
