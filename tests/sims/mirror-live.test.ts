/**
 * SimMirror's live region (wave-2.md §12, 2b-07 minor): an announcement equal to the previous one is spoken again
 * when the sim cleared it in between, so BatchingSim's deterministic "Fixed trace complete on <mode> batching ..."
 * is not silent on the second run. The speaking rule is src/lib/sims/announcer.ts, driven here by a fake clock.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAnnouncer } from '../../src/lib/sims/announcer'
import { ANNOUNCE_MIN_GAP_MS } from '../../src/lib/sims/host'

const ROOT = join(import.meta.dir, '..', '..')

/** A clock and timer queue the test advances by hand; `spoken` is what the live region held after each change. */
function harness() {
  let t = 1_000_000
  const timers: { at: number; fn: () => void; live: boolean }[] = []
  const spoken: string[] = []
  const announcer = createAnnouncer({
    speak: (s) => spoken.push(s),
    now: () => t,
    schedule: (fn, ms) => {
      const timer = { at: t + ms, fn, live: true }
      timers.push(timer)
      return () => {
        timer.live = false
      }
    },
  })
  const advance = (ms: number) => {
    const end = t + ms
    for (;;) {
      const next = timers.filter((x) => x.live && x.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!next) break
      next.live = false
      t = next.at
      next.fn()
    }
    t = end
  }
  return { announcer, advance, spoken }
}

const TRACE = 'Fixed trace complete on static batching: 41.2 tokens per second.'

describe('SimMirror live region', () => {
  test('a first announcement is spoken at once', () => {
    const h = harness()
    h.announcer.push(TRACE)
    h.advance(0)
    expect(h.spoken).toEqual([TRACE])
  })

  test('the same text after a clear is spoken again (re-running a deterministic configuration)', () => {
    const h = harness()
    h.announcer.push(TRACE)
    h.advance(0)
    h.announcer.push(undefined) // the sim's reset
    h.advance(ANNOUNCE_MIN_GAP_MS)
    h.announcer.push(TRACE) // the second run ends with the same sentence
    h.advance(ANNOUNCE_MIN_GAP_MS)
    expect(h.spoken.filter((s) => s === TRACE).length).toBe(2)
    expect(h.spoken).toEqual([TRACE, '', TRACE])
  })

  test('the clear empties the region, so the repeated text is a change for a screen reader', () => {
    const h = harness()
    h.announcer.push(TRACE)
    h.advance(0)
    h.announcer.push('')
    expect(h.spoken.at(-1)).toBe('')
  })

  test('the repeat still waits out the once-a-second gap', () => {
    const h = harness()
    h.announcer.push(TRACE)
    h.advance(0)
    h.announcer.push(undefined)
    h.advance(200)
    h.announcer.push(TRACE)
    h.advance(ANNOUNCE_MIN_GAP_MS - 200 - 1)
    expect(h.spoken).toEqual([TRACE, ''])
    h.advance(1)
    expect(h.spoken).toEqual([TRACE, '', TRACE])
  })

  test('two different results inside a second: the newest wins, the first is never spoken', () => {
    const h = harness()
    h.announcer.push('first')
    h.advance(0)
    h.announcer.push('second')
    h.advance(100)
    h.announcer.push('third')
    h.advance(ANNOUNCE_MIN_GAP_MS)
    expect(h.spoken).toEqual(['first', 'third'])
  })

  test('an announcement withdrawn before it is spoken is dropped', () => {
    const h = harness()
    h.announcer.push('first')
    h.advance(0)
    h.announcer.push('second')
    h.announcer.push(undefined)
    h.advance(ANNOUNCE_MIN_GAP_MS * 2)
    expect(h.spoken).toEqual(['first', ''])
  })

  test('cancel drops a pending announcement (unmount)', () => {
    const h = harness()
    h.announcer.push('first')
    h.advance(0)
    h.announcer.push('second')
    h.announcer.cancel()
    h.advance(ANNOUNCE_MIN_GAP_MS * 2)
    expect(h.spoken).toEqual(['first'])
  })
})

describe('the sims that rely on it', () => {
  test('SimMirror speaks through the announcer, not a comparison with the previous text', () => {
    const src = readFileSync(join(ROOT, 'src', 'components', 'sims', 'SimMirror.tsx'), 'utf8')
    expect(src).toContain('createAnnouncer')
    expect(src).not.toMatch(/text === lastText/)
  })

  test('BatchingSim clears its announcement whenever it rebuilds the engine, which every fixed-trace run does first', () => {
    const src = readFileSync(join(ROOT, 'src', 'components', 'sims', 'BatchingSim.tsx'), 'utf8')
    const recreate = /const recreateEngine = useCallback\(([\s\S]*?)\n {2}\}, \[\]\)/.exec(src)
    expect(recreate).not.toBeNull()
    expect(recreate![1]).toContain('setAnnounce(undefined)')
    const start = /const runFixedTrace[\s\S]*?setPlaying\(true\)/.exec(src)
    expect(start).not.toBeNull()
    expect(start![0]).toContain('recreateEngine(')
  })
})
