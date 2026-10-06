/**
 * Lab 01's hint ladder (H3, docs/specs/wave-1.md §13.2): the authored rungs against `verify:mentor`'s
 * limits, the unlock rules rung by rung, the bottom-out and its 24 h `assisted` window in the real
 * ledger, the walkthrough to the first divergence, and the "ask a human" URL (O2: Q&A, under 2 KB, no code).
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import {
  AFTER_BREAK,
  BOTTOM_RED_RUNS,
  DISCUSSIONS,
  LADDER,
  LADDER_CHECK_IDS,
  LAB_ID,
  LIMITS,
  R2_AFTER_MS,
  URL_BUDGET,
  URL_LIMIT,
  askHumanUrl,
  assistedUntil,
  freshState,
  hintRef,
  ladderReduce,
  parseTrace,
  redRuns,
  referenceScript,
  replayTrace,
  restoreState,
  stripCode,
  teachBackOk,
  unlockOf,
  walkthroughFor,
  wordCount,
} from '../../src/data/forge/rust-allocator/ladder'
import type { CheckLadder, Ctx, LadderAction, LadderState, RungId } from '../../src/data/forge/rust-allocator/ladder'
import HintLadderDefault, { HintLadderView } from '../../src/components/forge/HintLadder'
import { lintLadder } from '../../scripts/lint-mentor'
import type { LintDeps } from '../../scripts/lint-mentor'
import { creditFor } from '../../src/lib/forge/run'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { parseHintRef, refMatchesKind } from '../../src/lib/ledger/refs'
import { extractHeadings } from '../../src/pages/lesson/markdown'
import { makeProfile, startTab } from '../ledger/env'

/* ------------------------------ fixtures ------------------------------ */

const lab = FORGE_LABS.find((l) => l.id === LAB_ID)!
const REQUIRED = lab.checks.filter((c) => c.optional !== true).map((c) => c.id)
const ROOT = new URL('../../', import.meta.url).pathname

const h2s = new Map<string, Set<string>>()
for (const l of ALL_LESSONS) h2s.set(l.id, new Set(extractHeadings(l.blocks).filter((h) => h.level === 2).map((h) => h.id)))
const libRs = await Bun.file(`${ROOT}labs/rust-allocator/src/lib.rs`).text()
const DEPS: LintDeps = { required: REQUIRED, libRs, h2s }

const GOOD_R0 = 'The check frees neighbouring blocks and then asks for one big block, and mine kept them as separate little runs.'

const clone = (): Record<string, CheckLadder> => JSON.parse(JSON.stringify(LADDER))

const row = (id: string, status: CheckResult['status'] = 'fail', extra: Partial<CheckResult> = {}): CheckResult => ({ id, label: id, status, msg: `${id} says no`, ...extra })
const run = (checks: CheckResult[], extra: Partial<LabRunReport> = {}): LabRunReport => ({
  lab: LAB_ID,
  reference: false,
  abi: 2,
  version: 2,
  checks,
  seeds: 'fresh',
  ms: 5,
  ...extra,
})

/** Drives the reducer the way the component does: an action is allowed or it changes nothing. */
function drive(steps: [LadderAction, Ctx][], from: LadderState = freshState()): LadderState {
  return steps.reduce((s, [a, c]) => ladderReduce(s, a, c), from)
}
const at = (red: number, now = 0): Ctx => ({ red, now })
const open = (rung: RungId): LadderAction => ({ type: 'open', rung })
const WRITE: LadderAction = { type: 'draft', text: GOOD_R0 }
const COMPARE: LadderAction = { type: 'compare' }

/* ------------------------------ the authored ladder ------------------------------ */

describe('the authored ladder (what verify:mentor holds to its limits)', () => {
  test('it passes the lint, with every required check covered and nothing extra', () => {
    expect(lintLadder(LADDER, DEPS)).toEqual([])
    expect(Object.keys(LADDER).sort()).toEqual([...REQUIRED].sort())
    expect([...LADDER_CHECK_IDS].sort()).toEqual([...REQUIRED].sort())
  })

  test('every rung is within its limit, restated here so a loosened lint cannot hide it', () => {
    for (const id of REQUIRED) {
      const c = LADDER[id]
      expect(c.r0.ideas).toHaveLength(3)
      expect(wordCount(c.r1.text)).toBeLessThanOrEqual(60)
      expect(wordCount(c.r2.text)).toBeLessThanOrEqual(40)
      expect(c.r3.split('\n').length).toBeLessThanOrEqual(3)
      expect(wordCount(c.r4)).toBeLessThanOrEqual(80)
      expect(LIMITS).toMatchObject({ r1Words: 60, r2Words: 40, r3Lines: 3, r4Words: 80 })
    }
  })

  test('R3 is never compilable Rust: no fn, impl, pub, no semicolons, no statements', () => {
    for (const id of REQUIRED) {
      const r3 = LADDER[id].r3
      expect(r3).not.toMatch(/\b(fn|impl|pub)\s/)
      expect(r3).not.toContain(';')
      for (const line of r3.split('\n')) expect(line).not.toMatch(/[;{}]\s*$/)
    }
  })

  test('no rung quotes a _solutions file, and R2 names a function lib.rs really defines', () => {
    for (const id of REQUIRED) {
      const c = LADDER[id]
      expect(JSON.stringify(c)).not.toContain('_solutions')
      expect(libRs).toContain(`fn ${c.r2.fn}(`)
      expect(c.r2.text).toContain(c.r2.fn)
    }
  })

  test('R1 links to an H2 that exists on the lesson page', () => {
    for (const id of REQUIRED) expect(h2s.get(LADDER[id].r1.link.lessonId)?.has(LADDER[id].r1.link.anchor)).toBe(true)
  })

  test('the lint catches each way a rung can break', () => {
    const broken = (edit: (l: Record<string, CheckLadder>) => void) => {
      const l = clone()
      edit(l)
      return lintLadder(l, DEPS)
    }
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')
    expect(broken((l) => delete l.coalesce)).toEqual(['coalesce: no ladder (every required check needs R0 to R4)'])
    expect(broken((l) => (l.ghost = l.boot))[0]).toContain('does not require')
    expect(broken((l) => (l.boot.r0.ideas = l.boot.r0.ideas.slice(0, 2)))[0]).toContain('R0 has 2 ideas')
    expect(broken((l) => (l.boot.r0.ideas = [...l.boot.r0.ideas, 'a fourth']))[0]).toContain('R0 has 4 ideas')
    expect(broken((l) => (l.boot.r0.ideas = [l.boot.r0.ideas[0], l.boot.r0.ideas[0], l.boot.r0.ideas[2]]))[0]).toContain('repeats an idea')
    expect(broken((l) => (l.boot.r1.text = words(61)))[0]).toContain('R1 has 61 words')
    expect(broken((l) => (l.boot.r1.text = ''))[0]).toContain('R1 is missing')
    expect(broken((l) => (l.boot.r1.link.anchor = 'no-such-heading'))[0]).toContain('not an H2')
    expect(broken((l) => (l.boot.r2.text = words(41)))[0]).toContain('R2 has 41 words')
    expect(broken((l) => (l.boot.r2.text = 'Look at the check, then at your new.')).join('\n')).toContain('does not name lib.rs')
    expect(broken((l) => (l.boot.r2.fn = 'check_nothing')).join('\n')).toContain('lib.rs does not define')
    expect(broken((l) => (l.boot.r4 = words(81)))[0]).toContain('R4 has 81 words')
    expect(broken((l) => (l.boot.r3 = 'a\nb\nc\nd'))[0]).toContain('R3 has 4 lines')
    expect(broken((l) => (l.boot.r3 = 'pub fn new(capacity: usize) -> Self'))[0]).toContain('reads as Rust')
    expect(broken((l) => (l.boot.r3 = 'impl Allocator for the heap'))[0]).toContain('reads as Rust')
    expect(broken((l) => (l.boot.r3 = 'self.free.push(run);'))[0]).toContain('reads as Rust')
    expect(broken((l) => (l.boot.r3 = 'if run.size >= size {'))[0]).toContain('brace')
    expect(broken((l) => (l.boot.r3 = 'one\n\nthree'))[0]).toContain('empty line')
    expect(broken((l) => (l.boot.r4 += ' See labs/_solutions/rust-allocator/allocator.rs.'))[0]).toContain('_solutions')
    expect(broken((l) => (l.boot.r0.prompt = ''))[0]).toContain('R0 prompt is missing')
  })
})

/* ------------------------------ unlock rules ------------------------------ */

describe('the unlock rules', () => {
  test('R0 is always open; nothing else opens first', () => {
    const s = freshState()
    expect(unlockOf(s, 'R0', at(0)).ok).toBe(true)
    for (const r of ['R1', 'R2', 'R3', 'R4', 'bottom'] as const) expect(unlockOf(s, r, at(9, 1e9)).ok).toBe(false)
  })

  test('R1 needs a good-faith teach-back of at least 12 words in R0, compared', () => {
    const eleven = 'one two three four five six seven eight nine ten eleven'
    const pasted = 'same '.repeat(14)
    expect(teachBackOk(eleven)).toBe(false)
    expect(teachBackOk(`${eleven} twelve`)).toBe(true)
    expect(teachBackOk(pasted)).toBe(false)
    expect(teachBackOk(GOOD_R0)).toBe(true)

    let s = drive([[open('R0'), at(1)], [{ type: 'draft', text: eleven }, at(1)], [COMPARE, at(1)]])
    expect(s.compared).toBe(false)
    expect(unlockOf(s, 'R1', at(1)).ok).toBe(false)
    s = drive([[{ type: 'draft', text: pasted }, at(1)], [COMPARE, at(1)]], s)
    expect(s.compared).toBe(false)
    s = drive([[WRITE, at(1)], [COMPARE, at(1)]], s)
    expect(s.compared).toBe(true)
    expect(unlockOf(s, 'R1', at(1)).ok).toBe(true)
    // the answer is kept as written once compared, and the ticks only work after the compare
    expect(ladderReduce(s, { type: 'draft', text: 'changed my mind' }, at(1)).r0).toBe(GOOD_R0)
    expect(ladderReduce(freshState(), { type: 'tick', index: 0 }, at(1)).ticks).toEqual([false, false, false])
    expect(ladderReduce(s, { type: 'tick', index: 1 }, at(1)).ticks).toEqual([false, true, false])
    expect(ladderReduce(s, { type: 'tick', index: 7 }, at(1))).toBe(s)
  })

  test('R2: another red run, or two minutes after R1', () => {
    const s = drive([[open('R0'), at(1, 0)], [WRITE, at(1, 0)], [COMPARE, at(1, 0)], [open('R1'), at(1, 1000)]])
    expect(unlockOf(s, 'R2', at(1, 1000 + R2_AFTER_MS - 1)).ok).toBe(false)
    expect(unlockOf(s, 'R2', at(1, 1000 + R2_AFTER_MS)).ok).toBe(true)
    expect(unlockOf(s, 'R2', at(2, 1000)).ok).toBe(true)
    expect(unlockOf(s, 'R2', at(1, 1000)).reason).toContain('another red run')
    expect(ladderReduce(s, open('R2'), at(1, 2000))).toBe(s)
    expect(ladderReduce(s, open('R2'), at(2, 2000)).opened.R2).toEqual({ at: 2000, red: 2 })
  })

  test('R3 needs R2 plus one more red run; R4 is on request after R3; the order cannot be skipped', () => {
    let s = drive([[open('R0'), at(1)], [WRITE, at(1)], [COMPARE, at(1)], [open('R1'), at(1)], [open('R2'), at(2)]])
    expect(unlockOf(s, 'R3', at(2, 1e9)).ok).toBe(false)
    expect(unlockOf(s, 'R3', at(3)).ok).toBe(true)
    expect(unlockOf(s, 'R4', at(9)).ok).toBe(false) // R3 first
    s = drive([[open('R3'), at(3)]], s)
    expect(unlockOf(s, 'R4', at(3)).ok).toBe(true) // no run needed: an explicit request
    expect(unlockOf(freshState(), 'R3', at(9, 1e9)).reason).toBe('Open R2 first.')
  })

  test('the bottom-out needs R4 and two more red runs on that check', () => {
    const s = drive([
      [open('R0'), at(1)],
      [WRITE, at(1)],
      [COMPARE, at(1)],
      [open('R1'), at(1)],
      [open('R2'), at(2)],
      [open('R3'), at(3)],
      [open('R4'), at(3)],
    ])
    expect(BOTTOM_RED_RUNS).toBe(2)
    expect(unlockOf(s, 'bottom', at(3, 1e9)).reason).toBe('Needs 2 more red runs on this check after R4.')
    expect(unlockOf(s, 'bottom', at(4)).reason).toBe('Needs 1 more red run on this check after R4.')
    expect(unlockOf(s, 'bottom', at(5)).ok).toBe(true)
    const done = ladderReduce(s, open('bottom'), at(5, 77))
    expect(done.opened.bottom).toEqual({ at: 77, red: 5 })
    // a rung opens once; opening it again is a no-op
    expect(ladderReduce(done, open('bottom'), at(9))).toBe(done)
  })

  test('red runs count per check: passes, reference builds and runs without the check do not', () => {
    const reports = [
      run([row('coalesce'), row('boot', 'pass')]),
      run([row('coalesce', 'trap'), row('boot', 'pass')]),
      run([row('coalesce'), row('boot')], { reference: true }),
      run([row('boot')]),
      run([row('coalesce', 'timeout'), row('boot', 'pass')]),
      run([row('coalesce', 'pass'), row('boot', 'pass')]),
    ]
    expect(redRuns(reports, 'coalesce')).toBe(3)
    expect(redRuns(reports, 'boot')).toBe(1)
    expect(redRuns(reports, 'align')).toBe(0)
  })

  test('after a reload the acked rungs are open again, and the next one still needs a run', () => {
    const acks = Object.fromEntries((['R0', 'R1', 'R2'] as const).map((r) => [hintRef('coalesce', r), '2026-10-04T09:00:00.000Z']))
    const s = restoreState(acks, 'coalesce', at(4, 500))
    expect(Object.keys(s.opened).sort()).toEqual(['R0', 'R1', 'R2'])
    expect(s.compared).toBe(true)
    expect(unlockOf(s, 'R3', at(4, 600)).ok).toBe(false)
    expect(unlockOf(s, 'R3', at(5, 600)).ok).toBe(true)
    expect(restoreState(acks, 'align', at(1)).opened).toEqual({})
  })
})

/* ------------------------------ the ledger ------------------------------ */

describe('the ledger: one ack per rung, and the bottom-out opens a 24 h assisted window', () => {
  test('hint refs have the shape the ledger parses', () => {
    expect(hintRef('coalesce', 'R2')).toBe('hint:rust-allocator/coalesce#R2')
    expect(hintRef('coalesce', 'bottom')).toBe('hint:rust-allocator/coalesce#bottom')
    expect(parseHintRef(hintRef('no_overlap', 'R4'))).toEqual({ labId: 'rust-allocator', checkId: 'no_overlap', rung: 'R4' })
    for (const id of REQUIRED) for (const r of ['R0', 'R1', 'R2', 'R3', 'R4', 'bottom'] as const) expect(refMatchesKind('ack', hintRef(id, r))).toBe(true)
  })

  test('acking the rungs through the store records each once; #bottom sets assistedUntil, and runs inside it are assisted', async () => {
    const profile = makeProfile()
    const tab = startTab(profile)
    const { acknowledge } = tab.progress.getState()
    const reports = [run([row('coalesce')])]
    const acked: string[] = []
    const onAck = (ref: `hint:${string}`) => {
      acked.push(ref)
      acknowledge(ref)
    }
    // the component's own order of events
    for (const r of ['R0', 'R1', 'R2', 'R3', 'R4'] as const) onAck(hintRef('coalesce', r))
    expect(tab.progress.getState().aggregate.labs[LAB_ID]?.assistedUntil).toBeUndefined()
    const start = profile.clock.nowIso()
    onAck(hintRef('coalesce', 'bottom'))
    onAck(hintRef('coalesce', 'bottom')) // a reload re-opening it adds nothing
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'ack')
    expect(events.map((e) => e.ref)).toEqual(acked.slice(0, 6).map((r) => r))
    expect(events).toHaveLength(6)

    const until = tab.progress.getState().aggregate.labs[LAB_ID]?.assistedUntil
    expect(until).toBe(assistedUntil(start))
    expect(Date.parse(until!) - Date.parse(start)).toBe(24 * 3_600_000)

    const green = run([row('boot', 'pass'), row('coalesce', 'pass')])
    expect(creditFor(green, { assistedUntil: until, at: new Date(Date.parse(start) + 3_600_000).toISOString() })).toBe('assisted')
    expect(creditFor(green, { assistedUntil: until, at: new Date(Date.parse(until!) + 1).toISOString() })).not.toBe('assisted')
    // other labs and other rungs do not open a window
    const other = startTab(makeProfile())
    other.progress.getState().acknowledge(hintRef('coalesce', 'R4'))
    other.progress.getState().acknowledge('hint:kv-block-manager/paging#R1')
    expect(other.progress.getState().aggregate.labs[LAB_ID]?.assistedUntil).toBeUndefined()
    expect(reports).toHaveLength(1)
  })
})

/* ------------------------------ ask a human ------------------------------ */

describe('ask a human: a prefilled Q&A post, under 2 KB, never code', () => {
  const parts = (url: string) => {
    const u = new URL(url)
    return { u, title: u.searchParams.get('title') ?? '', body: u.searchParams.get('body') ?? '', category: u.searchParams.get('category') }
  }

  test('category Q&A, the title format, and a body with the message and the R0 text', () => {
    const msg = 'freed the left, then the right, then the middle 16 KiB block; a 48 KiB request then failed\nsecond line'
    const { u, title, body, category } = parts(askHumanUrl({ checkId: 'coalesce', message: msg, r0: GOOD_R0 }))
    expect(u.origin + u.pathname).toBe(`https://github.com/${DISCUSSIONS.repo}/discussions/new`)
    expect(DISCUSSIONS.repo).toBe('praveer13/kernelspace')
    expect(category).toBe('q-a')
    expect(title).toBe('[lab 01] coalesce: freed the left, then the right, then the middle 16 KiB block; a 48 KiB request then failed')
    expect(body).toContain('freed the left, then the right')
    expect(body).toContain('second line')
    expect(body).toContain(GOOD_R0)
    expect(body).toContain('No code is attached')
    expect([...u.searchParams.keys()].sort()).toEqual(['body', 'category', 'title'])
  })

  test('the body without an R0 answer omits that section', () => {
    expect(parts(askHumanUrl({ checkId: 'boot', message: 'alloc(1, 1) returned None' })).body).not.toContain('What I understand')
  })

  test('code in the R0 text or the message never reaches the URL', () => {
    const code = [
      'pub fn alloc(&mut self, size: usize, align: usize) -> Option<usize> {',
      '    let start = (self.free[0].off + align - 1) / align * align;',
      '    self.free.remove(0);',
      '}',
    ]
    const r0 = ['My free ignores the right neighbour.', '```rust', ...code, '```', `Here: \`${code[1].trim()}\``, ...code, 'Why does it fail?'].join('\n')
    const url = askHumanUrl({ checkId: 'coalesce', message: `msg\n${code[2]}`, r0 })
    const { body } = parts(url)
    expect(body).toContain('My free ignores the right neighbour.')
    expect(body).toContain('Why does it fail?')
    for (const needle of ['pub fn', 'let start', 'self.free', 'usize', 'Option<usize>']) expect(body).not.toContain(needle)
    expect(body).toContain('[code removed]')
    expect(decodeURIComponent(url)).not.toContain('self.free')
  })

  test('stripCode keeps prose and short names, drops fences, statements and long inline code', () => {
    expect(stripCode('free() should merge `coalesce` first')).toBe('free() should merge `coalesce` first')
    expect(stripCode('a\n```\nlet x = 1;\n```\nb')).toBe('a\n\n[code removed]\n\nb')
    expect(stripCode('open ```never closed\nlet x = 1;')).toContain('[code removed]')
    expect(stripCode('see `self.a = b + 1` here')).toBe('see [code removed] here')
    expect(stripCode('x\nfor a in b {\n  y\n}\nz')).toBe('x\n[code removed]\n  y\n[code removed]\nz')
  })

  test('always under 2 KB, whatever is thrown at it: 8 KB of prose, emoji, percent signs, lone surrogates', () => {
    const inputs = [
      'x'.repeat(8000),
      '\u{1F600}'.repeat(3000),
      '%&=?#/ '.repeat(1500),
      '\uD83D lone \uDE00 surrogates ',
      `${'word '.repeat(2000)}\n`.repeat(3),
      'éè中文'.repeat(1000),
    ]
    for (const a of inputs) {
      for (const b of inputs) {
        const url = askHumanUrl({ checkId: 'fragmentation', message: a, r0: b })
        expect(url.length).toBeLessThanOrEqual(URL_BUDGET)
        expect(url.length).toBeLessThan(URL_LIMIT)
        expect(() => new URL(url)).not.toThrow()
        expect(parts(url).title.startsWith('[lab 01] fragmentation: ')).toBe(true)
      }
    }
    expect(askHumanUrl({ checkId: 'boot', message: 'short', r0: 'tiny' }).length).toBeLessThan(700)
  })
})

/* ------------------------------ the walkthrough ------------------------------ */

describe('the walkthrough to the first divergence', () => {
  test('parseTrace reads alloc and free lines, tolerates noise and spacing', () => {
    expect(parseTrace('alloc(16, 8) -> 0\nnoise\nalloc(4) -> none\n free(0) \nalloc( 32 , 16 ) => Some(64)\nalloc(1, 1) -> None')).toEqual([
      { kind: 'alloc', size: 16, align: 8, got: 0 },
      { kind: 'alloc', size: 4, align: 1, got: null },
      { kind: 'free', offset: 0 },
      { kind: 'alloc', size: 32, align: 16, got: 64 },
      { kind: 'alloc', size: 1, align: 1, got: null },
    ])
    expect(parseTrace('')).toEqual([])
    expect(parseTrace('alloc(16, 8) -> 0\n'.repeat(5000))).toHaveLength(4000)
  })

  test('an overlap is found at the op that causes it, with the live block it hits', () => {
    const w = replayTrace(parseTrace('alloc(100, 8) -> 0\nalloc(200, 8) -> 104\nfree(0)\nalloc(90, 8) -> 0\nalloc(64, 8) -> 80\nalloc(8, 8) -> 400'))
    expect(w.source).toBe('trace')
    expect(w.divergedAt).toBe(5)
    const bad = w.steps.find((s) => s.diverges)!
    expect(bad.op).toBe('alloc(64, align 8)')
    expect(bad.reference).toBe('[80, 144) overlaps your live block [0, 90)')
    expect(w.steps.at(-1)).toBe(bad) // nothing after the first divergence is shown
    expect(w.steps.slice(0, 4).every((s) => !s.diverges)).toBe(true)
    expect(w.headline).toContain('op 5')
  })

  test('misalignment, running past the heap, a bad free and a refusal while a span fits are each a divergence', () => {
    expect(replayTrace(parseTrace('alloc(8, 16) -> 8')).steps[0].reference).toBe('8 is not a multiple of 16')
    expect(replayTrace(parseTrace('alloc(1024, 1) -> 1048000')).steps[0].reference).toContain('runs past the 1048576 B heap')
    const free = replayTrace(parseTrace('alloc(8, 8) -> 0\nfree(8)'))
    expect(free.divergedAt).toBe(2)
    expect(free.steps[1].reference).toBe('no live block starts there')
    const refused = replayTrace(parseTrace('alloc(512, 8) -> 0\nalloc(4096, 8) -> none'))
    expect(refused.divergedAt).toBe(2)
    expect(refused.steps[1].yours).toBe('None')
    expect(refused.steps[1].reference).toMatch(/refused, yet \d+ B are free in one run/)
  })

  test('a refusal is fine when no free span is that big, and a legal trace shows no divergence', () => {
    // 1 MiB heap: take it all, then refuse. (the harness forgives a refusal unless a span is 64 B bigger)
    const w = replayTrace(parseTrace(`alloc(${1 << 20}, 1) -> 0\nalloc(16, 1) -> none\nfree(0)\nalloc(16, 8) -> 0`))
    expect(w.divergedAt).toBeNull()
    expect(w.steps[1].diverges).toBe(false)
    expect(w.steps[1].reference).toContain('refusing is right')
    expect(w.headline).toContain('No op in your trace breaks the rules')
  })

  test('a long trace shows the last eight ops up to the divergence and counts the rest', () => {
    const ok = Array.from({ length: 30 }, (_, i) => `alloc(16, 16) -> ${i * 16}`)
    const w = replayTrace(parseTrace([...ok, 'alloc(16, 16) -> 32'].join('\n')))
    expect(w.divergedAt).toBe(31)
    expect(w.steps).toHaveLength(8)
    expect(w.skipped).toBe(23)
  })

  test('without a parseable trace, each check gets its op sequence on the reference alone', () => {
    for (const id of REQUIRED) {
      const w = walkthroughFor(id, 'nothing the parser understands\n')
      expect(w.source).toBe('script')
      expect(w.steps.length).toBeGreaterThan(0)
      expect(w.divergedAt).toBeNull()
      expect(w.steps.every((s) => s.yours === '-' && !s.reference.startsWith('refused'))).toBe(true)
      expect(w.headline).toContain('kslab::trace!')
    }
    expect(walkthroughFor('boot').source).toBe('script')
    expect(referenceScript('no-such-check').steps).toEqual([])
    // the scripts show the lesson of their check
    const reuse = referenceScript('reuse').steps
    expect(reuse[0].reference.startsWith('at 0')).toBe(true)
    expect(reuse[2].reference.startsWith('at 0')).toBe(true) // the freed block came back
    const co = referenceScript('coalesce').steps
    expect(co.at(-1)?.reference.startsWith('at 0')).toBe(true) // 48 KiB served from the merged run
    const fr = referenceScript('fragmentation').steps
    expect(fr.at(-1)?.reference.startsWith('at 2048')).toBe(true)
    const al = referenceScript('align').steps
    expect(al[1].reference.startsWith('at 64')).toBe(true)
    expect(al[3].reference.startsWith('at 8,')).toBe(true) // the padding is reused
  })

  test('the learner trace wins over the script when it has lines', () => {
    expect(walkthroughFor('coalesce', 'alloc(8, 8) -> 0\n').source).toBe('trace')
  })
})

/* ------------------------------ the component ------------------------------ */

describe('HintLadder renders', () => {
  const html = (reports: LabRunReport[], acks: Record<string, string> = {}) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(HintLadderView, { reports, acks, onAck: () => {}, now: () => 0 })))
  const ISO = '2026-10-04T09:00:00.000Z'
  const allAcks = (check: string) => Object.fromEntries((['R0', 'R1', 'R2', 'R3', 'R4', 'bottom'] as const).map((r) => [hintRef(check, r), ISO]))

  test('with no run it asks for one; with every check green it has nothing to unlock', () => {
    expect(html([])).toContain('Run your build first')
    expect(html([run([row('boot', 'pass')])])).toContain('nothing to unlock')
    expect(html([run([row('boot')], { reference: true })])).toContain('Run your build first')
  })

  test('a card per red check, collapsed, with its red-run count; green checks get none', () => {
    const out = html([run([row('boot', 'pass'), row('align'), row('coalesce', 'trap')]), run([row('boot', 'pass'), row('align', 'pass'), row('coalesce', 'trap')])])
    expect(out).not.toContain('data-check="boot"')
    expect(out).not.toContain('data-check="align"') // green in the latest run
    expect(out).toContain('data-check="coalesce"')
    expect(out).toContain('not implemented yet, 2 red runs')
    expect(out).toContain('aria-expanded="false"')
    expect(out).not.toContain('R0 · say it first') // collapsed
  })

  test('a check whose rungs were acked comes back expanded: R0 to R4, the walkthrough at its first divergence, the break, the window', () => {
    const trace = 'alloc(100, 8) -> 0\nalloc(200, 8) -> 104\nfree(0)\nalloc(90, 8) -> 0\nalloc(64, 8) -> 80'
    const out = html([run([row('coalesce', 'fail', { trace, msg: 'a 48 KiB request then failed' })])], allAcks('coalesce'))
    expect(out).toContain('aria-expanded="true"')
    for (const title of ['R0 · say it first', 'R1 · the concept', 'R2 · where to look', 'R3 · a fragment', 'R4 · the design']) expect(out).toContain(title)
    const c = LADDER.coalesce
    expect(out).toContain(c.r0.prompt)
    expect(out).toContain(c.r2.text)
    expect(out).toContain(c.r4)
    expect(out).toContain('a 48 KiB request then failed') // R2 shows the check's own message
    expect(out).toContain('href="/lesson/t1.l3#the-two-operations-that-matter"')
    expect(out).toContain('Pseudo-code, not Rust.')
    expect(out).toContain('data-walkthrough="trace"')
    expect(out).toContain('first divergence')
    expect(out).toContain('overlaps your live block [0, 90)')
    expect(out).toContain(AFTER_BREAK.title)
    expect(out).toContain('assisted until')
    expect(out).not.toContain('Show the walkthrough') // already opened
  })

  test('a fresh expanded ladder locks everything after R0 and says why, and the walkthrough is not in the page', () => {
    const out = html([run([row('align')])], { [hintRef('align', 'R0')]: ISO })
    expect(out).toContain('R0 · say it first')
    expect(out).toContain(LADDER.align.r0.prompt)
    expect(out).not.toContain(LADDER.align.r0.ideas[0]) // the ideas wait for the teach-back
    expect(out).toContain('Compare with the ideas')
    expect(out).toContain('Write 12 or more words of your own in R0, then compare.')
    expect(out).toContain('Open R1')
    expect(out).not.toContain(LADDER.align.r1.text)
    expect(out).not.toContain(LADDER.align.r3)
    expect(out).not.toContain('data-walkthrough')
    expect(out).toContain('Show the walkthrough')
    expect(out).toContain('Open R4 first.')
  })

  test('a card restored after R1 shows the R2 countdown from the restore time', () => {
    const acks = { [hintRef('reuse', 'R0')]: ISO, [hintRef('reuse', 'R1')]: ISO }
    const out = html([run([row('reuse')])], acks)
    expect(out).toContain('Needs another red run on this check, or 120 s more after R1.')
  })

  test('Ask a human links to a prefilled Q&A post, in a new tab, with no code field', () => {
    const out = html([run([row('coalesce', 'fail', { msg: 'a 48 KiB request then failed' })])], { [hintRef('coalesce', 'R0')]: ISO })
    const href = /href="(https:\/\/github\.com\/praveer13\/kernelspace\/discussions\/new[^"]*)"/.exec(out)?.[1]
    expect(href).toBeDefined()
    const url = new URL((href ?? '').replace(/&amp;/g, '&'))
    expect(url.searchParams.get('category')).toBe('q-a')
    expect(url.searchParams.get('title')).toBe('[lab 01] coalesce: a 48 KiB request then failed')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
    expect(out).toContain('It never includes your code')
  })

  test('a trap shows the panic text after the message in R2', () => {
    const acks = { [hintRef('boot', 'R0')]: ISO, [hintRef('boot', 'R1')]: ISO, [hintRef('boot', 'R2')]: ISO }
    const out = html([run([row('boot', 'trap', { msg: 'not implemented yet', panic: 'not yet implemented: construct your allocator' })])], acks)
    expect(out).toContain('not yet implemented: construct your allocator')
  })

  test('two expanded checks never share an id: the locked-rung reasons carry the check id', () => {
    const out = html([run([row('align'), row('coalesce')])], { [hintRef('align', 'R0')]: ISO, [hintRef('coalesce', 'R0')]: ISO })
    expect(out).toContain('data-check="align"')
    expect(out).toContain('data-check="coalesce"')
    const ids = [...out.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!)
    expect(ids.length).toBeGreaterThan(10)
    expect(new Set(ids).size).toBe(ids.length)
    const why = ids.filter((id) => id.startsWith('hint-why-'))
    expect(why).toContain('hint-why-align-R1-Open-R1')
    expect(why).toContain('hint-why-coalesce-R1-Open-R1')
    // every describedby points at a reason that is on the page
    for (const m of out.matchAll(/aria-describedby="([^"]+)"/g)) expect(ids).toContain(m[1]!)
  })

  test('the connected component is the default export', () => {
    expect(typeof HintLadderDefault).toBe('function')
  })
})
