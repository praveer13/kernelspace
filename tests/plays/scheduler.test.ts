/**
 * The scheduler play's UI and session model (docs/specs/wave-2.md §8.3-8.5, task 2b-11): the session the
 * components drive, what the play screen shows before the debrief (never the ghost), the chips' touch size, the
 * mirror, Compose, the In-production card, the ledger events for play and compose, and verify-plays's checks for
 * this play.
 *
 * The world is tested in tests/world/sched.test.ts and sched-policy.test.ts; this file tests the layer above it.
 * Pointer, keyboard and 360 px behaviour is checked in a real browser (e2e/scheduler.spec.ts, `npm run a11y`).
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Compose from '../../src/components/play/scheduler/Compose'
import Debrief from '../../src/components/play/scheduler/Debrief'
import Mirror from '../../src/components/play/scheduler/Mirror'
import { SchedulerPlayView } from '../../src/components/play/scheduler/Play'
import ProductionCard from '../../src/components/play/scheduler/ProductionCard'
import Queue, { KvBar } from '../../src/components/play/scheduler/Queue'
import {
  DEFAULT_SCHED_SPEC,
  SCHED_COMPOSE_FRESH,
  SCHED_DIAL_DEFS,
  actionOf,
  canSkip,
  debrief,
  frameOf,
  kvSplit,
  newSchedSession,
  pickProblem,
  pinnedReleases,
  recordOf,
  roomAfter,
  runIteration,
  schedComposeRecord,
  schedComposeReport,
  schedComposeTraces,
  skip,
  stageOf,
  togglePick,
  togglePreempt,
  withDial,
  type SchedSession,
} from '../../src/components/play/scheduler/session'
import { PLAY_REGISTRY, resolvePlay } from '../../src/components/play/registry'
import { CLAIMS, byId } from '../../src/data/claims'
import { KC } from '../../src/data/kc/ids'
import { BUILD_THIS_SCHEDULER, PLAYS, PLAY_IDS, PLAY_PRODUCTION_ROWS, SCHEDULER, SCHEDULER_PRODUCTION_ROWS, getPlay } from '../../src/data/plays'
import { Engine, HEADROOM_TOKENS, makeRefManager, referenceScheduler, type SchedView } from '../../src/lib/fleet-model'
import { PLAY_MINUTES } from '../../src/lib/economy-table'
import { SCHEDULER_PLAY_ID, SKIP_AFTER_TURNS, TURN_CAP, playSchedAll, schedSetup, summarizeSched, driverDecider } from '../../src/lib/world/sched'
import { REFERENCE_SCHED_SPEC } from '../../src/lib/world/sched-policy'
import {
  FCFS_DRIVER,
  GREEDY_DRIVER,
  SCHED_CFG,
  SCHED_PRACTICE_MINUTE_SEED,
  checkSchedBand,
  drawSchedTrace,
  parseSchedSource,
  practiceMinute,
  practiceSourceLine,
  type SchedSource,
  type SchedTrace,
} from '../../src/lib/world/sched-traces'
import { checkPlay, closureOf, practiceBandOf, type PlayFacts, type PlayWorld } from '../../scripts/verify-plays'
import { makeProfile, startTab } from '../ledger/env'

const ROOT = join(import.meta.dir, '..', '..')
const SRC = join(ROOT, 'src')
const dir = new URL('../../public/traces/', import.meta.url)

let source: SchedSource
/** Minutes drawn into the band the way the play draws them. */
let banded: SchedTrace[]
beforeAll(async () => {
  source = await parseSchedSource(
    await Bun.file(new URL('burstgpt-v2-busiest-minute.json', dir)).json(),
    await Bun.file(new URL('burstgpt-v2-busiest-hour.json', dir)).json(),
  )
  banded = Array.from({ length: 12 }, (_, i) => drawSchedTrace((i + 1) * 7919, source).trace)
})

/** Plays a session to its end: at each turn the learner taps `pick(view)` in order (a tap the chips would refuse is skipped) and runs the iteration. */
function playOut(s0: SchedSession, pick: (view: SchedView) => number[]): SchedSession {
  let s = s0
  for (let guard = 0; guard < 500; guard++) {
    const st = stageOf(s)
    if (st.kind === 'over') return s
    for (const id of pick(st.frame.view)) s = togglePick(s, id)
    s = runIteration(s)
  }
  throw new Error('the play did not end')
}

const refPick = (v: SchedView) => referenceScheduler(v).admit
const greedyPick = (v: SchedView) => GREEDY_DRIVER.schedule(v).admit
const fcfsPick = (v: SchedView) => FCFS_DRIVER.schedule(v).admit
const nothing = () => []

const practice = () => newSchedSession(practiceMinute(source))

/** The first banded minute where `learner` loses a request the reference served (the debrief has a divergence). */
function losingSession(pick: (v: SchedView) => number[]): SchedSession {
  for (const t of banded) {
    const s = debrief(playOut(newSchedSession(t), pick))
    if (s.summary?.divergence?.decision) return s
  }
  throw new Error('no banded minute where this learner loses')
}

describe('the registry', () => {
  test('the scheduler is the second play: T5.L7, 20 minutes, KCs from the contract, ids tied to the world and the economy', () => {
    expect(PLAY_IDS).toEqual(['block-placement', 'scheduler'])
    expect(SCHEDULER.id).toBe(SCHEDULER_PLAY_ID)
    expect(SCHEDULER.lessonId).toBe('t5.l7')
    expect(SCHEDULER.minutes).toBe(PLAY_MINUTES.scheduler)
    expect(SCHEDULER.turnCap).toBe(TURN_CAP)
    const known = new Set<string>(Object.values(KC))
    expect(SCHEDULER.kcs).toEqual([KC.continuousBatching, KC.admissionHeadroom, KC.schedOrder, KC.batchingThroughput])
    for (const k of SCHEDULER.kcs) expect(known.has(k)).toBe(true)
    expect(getPlay('scheduler')).toBe(SCHEDULER)
    expect(Object.keys(PLAYS)).toEqual(PLAY_IDS as string[])
  })

  test('the registry loads the scheduler on demand and it leaves PENDING_PLAYS', () => {
    expect(resolvePlay('scheduler').kind).toBe('play')
    expect(Object.keys(PLAY_REGISTRY).sort()).toEqual([...PLAY_IDS].sort())
    expect(readFileSync(join(SRC, 'components', 'play', 'registry.ts'), 'utf8')).toContain("import('@/components/play/scheduler/Play')")
  })

  test('every play has its own card rows, and the scheduler card is the §8.5 table', () => {
    expect(Object.keys(PLAY_PRODUCTION_ROWS).sort()).toEqual([...PLAY_IDS].sort())
    expect(SCHEDULER.productionClaims).toEqual(SCHEDULER_PRODUCTION_ROWS.map((r) => r.claim))
    expect(new Set(SCHEDULER.productionClaims).size).toBe(SCHEDULER.productionClaims.length)
    expect(SCHEDULER.productionClaims.length).toBeGreaterThanOrEqual(3)
    const ids = new Set(CLAIMS.map((c) => c.id))
    for (const id of SCHEDULER.productionClaims) expect(ids.has(id)).toBe(true)
    // The spec's table: order, headroom, preemption, concurrency and chunk, for both engines.
    for (const claim of [
      'production.vllm.scheduling-policy',
      'production.sglang.schedule-policy',
      'production.sglang.schedule-conservativeness',
      'production.vllm.v1-preemption',
      'production.sglang.retract',
      'production.vllm.max-num-seqs',
      'production.sglang.max-running-requests',
      'production.vllm.max-num-batched-tokens',
      'production.sglang.chunked-prefill-size',
    ]) {
      expect(SCHEDULER.productionClaims).toContain(claim)
    }
  })

  test('every card claim is pinned to a release its source url contains (D19)', () => {
    for (const id of SCHEDULER.productionClaims) {
      const c = byId[id]
      expect(c.pin).toBeDefined()
      expect(c.source?.url).toContain(c.pin?.ref)
    }
  })

  test('the Code step is lab 06, whose lesson is T5.L7', () => {
    expect(BUILD_THIS_SCHEDULER.to).toBe('/forge/batching-scheduler')
    expect(BUILD_THIS_SCHEDULER.label).toBe('Build this: lab 06, Goodput or Nothing')
  })
})

describe('a play session', () => {
  test('starts at the first turn of the practice minute, deciding from the learner’s own frame', () => {
    const s = practice()
    const st = stageOf(s)
    expect(st.kind).toBe('turn')
    if (st.kind !== 'turn') return
    expect(st.turn).toBe(0)
    expect(st.frame.view.waiting.length).toBeGreaterThan(0)
    expect(st.frame.view.running).toHaveLength(0)
    expect(s.provenance).toBe('practice')
    expect(s.summary).toBeNull()
    expect(frameOf(s)).toBe(st.frame)
  })

  test('taps build the admit order; a second tap takes a request out again', () => {
    let s = newSchedSession(banded[0])
    const waiting = (stageOf(s) as { frame: { view: SchedView } }).frame.view.waiting
    const fits = waiting.filter((r) => pickProblem(frameOf(s), s.picks, s.preempt, r.id) === '')
    expect(fits.length).toBeGreaterThan(0)
    s = togglePick(s, fits[0].id)
    expect(s.picks).toEqual([fits[0].id])
    if (fits.length > 1 && pickProblem(frameOf(s), s.picks, s.preempt, fits[1].id) === '') {
      s = togglePick(s, fits[1].id)
      expect(s.picks).toEqual([fits[0].id, fits[1].id])
      s = togglePick(s, fits[0].id)
      expect(s.picks).toEqual([fits[1].id])
    }
    expect(actionOf(s)).toEqual({ admit: [...s.picks], preempt: [] })
    expect(togglePick(s, 99999)).toBe(s)
  })

  test('a request that does not fit what the picks leave is disabled and says why', () => {
    let seen: string | null = null
    for (const t of banded) {
      let s = newSchedSession(t)
      for (let i = 0; i < 60 && stageOf(s).kind === 'turn' && seen === null; i++) {
        const frame = frameOf(s)
        const blocked = frame.view.waiting.find((r) => pickProblem(frame, s.picks, s.preempt, r.id) !== '')
        if (blocked) {
          seen = pickProblem(frame, s.picks, s.preempt, blocked.id)
          expect(togglePick(s, blocked.id)).toBe(s)
        }
        s = runIteration(newPicks(s, refPick(frame.view)))
      }
      if (seen !== null) break
    }
    expect(seen).toMatch(/^(needs [\d,]+, [\d,]+ free|batch full: \d+ running)$/)
  })

  test('the free memory after the picks is what the next chip must fit', () => {
    const s0 = newSchedSession(banded[1])
    const frame = frameOf(s0)
    const first = frame.view.waiting.find((r) => pickProblem(frame, [], null, r.id) === '')
    if (!first) throw new Error('nothing fits at the first turn')
    const room = roomAfter(frame, [first.id], null)
    expect(room.free).toBe(frame.free - Math.ceil(first.prompt / frame.blockSize) * frame.blockSize)
    expect(room.slots).toBe(frame.view.maxRunning - frame.view.running.length - 1)
  })

  test('running an iteration plays the turn, says it in one line and clears the taps', () => {
    let s = newSchedSession(banded[2])
    const frame = frameOf(s)
    for (const id of refPick(frame.view)) s = togglePick(s, id)
    expect(s.picks.length).toBeGreaterThan(0)
    const next = runIteration(s)
    expect(next.play.turns).toBe(1)
    expect(next.picks).toEqual([])
    expect(next.preempt).toBeNull()
    expect(next.line).toMatch(/^Iteration \d+: admitted #\d+ \([\d,]+ tokens\)/)
    expect(next.line).toMatch(/ Free [\d,]+ → [\d,]+\. \d+ waiting\.$/)
  })

  test('a preempt marks a running request, one at a time, and drops picks that no longer fit', () => {
    for (const t of banded) {
      let s = newSchedSession(t)
      for (let i = 0; i < 40; i++) {
        const st = stageOf(s)
        if (st.kind !== 'turn') break
        if (st.frame.view.running.length > 0) {
          const [a, b] = st.frame.view.running
          s = togglePreempt(s, a.id)
          expect(s.preempt).toBe(a.id)
          if (b) {
            s = togglePreempt(s, b.id)
            expect(s.preempt).toBe(b.id)
          }
          const marked = s.preempt as number
          expect(togglePreempt(s, marked).preempt).toBeNull()
          expect(togglePreempt(s, 99999)).toBe(s)
          expect(actionOf(s).preempt).toEqual([marked])
          const next = runIteration(s)
          expect(next.preempt).toBeNull()
          return
        }
        s = runIteration(newPicks(s, refPick(st.frame.view)))
      }
    }
    throw new Error('no turn with a running request')
  })

  test('the KV bar splits the pool into what is held, what is chosen, the headroom and what is left', () => {
    let s = newSchedSession(banded[3])
    for (let i = 0; i < 6 && stageOf(s).kind === 'turn'; i++) s = runIteration(newPicks(s, refPick(frameOf(s).view)))
    const frame = frameOf(s)
    const a = kvSplit(frame)
    expect(a.capacity).toBe(SCHED_CFG.numBlocks * SCHED_CFG.blockSize)
    expect(a.used + a.chosen + a.headroom + a.free).toBe(a.capacity)
    expect(a.chosen).toBe(0)
    expect(a.headroom).toBeLessThanOrEqual(HEADROOM_TOKENS * frame.view.running.length)
    const pick = frame.view.waiting.find((r) => pickProblem(frame, [], null, r.id) === '')
    if (pick) {
      const b = kvSplit(frame, [pick.id])
      expect(b.chosen).toBe(Math.ceil(pick.prompt / frame.blockSize) * frame.blockSize)
      expect(b.used + b.chosen + b.headroom + b.free).toBe(b.capacity)
    }
  })

  test('the reference’s own choices, tapped by hand, serve what the ghost serves', () => {
    for (const t of [practiceMinute(source), ...banded.slice(0, 4)]) {
      const s = debrief(playOut(newSchedSession(t), refPick))
      expect(s.play.ended).toBe('trace-end')
      expect(s.summary?.survived).toBe(s.summary?.ghostSurvived)
      expect(s.summary?.divergence).toBeNull()
    }
  })

  test('tapping through the session is the world’s own run (the same survivors as playSchedAll)', () => {
    for (const t of banded.slice(0, 4)) {
      const setup = schedSetup(t)
      for (const [pick, driver] of [[greedyPick, GREEDY_DRIVER], [fcfsPick, FCFS_DRIVER]] as const) {
        const mine = debrief(playOut(newSchedSession(t), pick)).summary
        const world = summarizeSched(setup, playSchedAll(setup, driverDecider(driver)))
        expect(mine?.survived).toBe(world.survived)
        expect(mine?.turns).toBe(world.turns)
      }
    }
  })

  test('admitting nothing every turn ends at the 60-turn cap with the reference finishing the run', () => {
    const s = debrief(playOut(practice(), nothing))
    expect(s.play.ended).toBe('turn-cap')
    expect(s.play.turns).toBe(TURN_CAP)
    expect(s.summary?.divergence).not.toBeNull()
    expect(s.summary?.survived).toBeLessThan(s.summary?.ghostSurvived ?? 0)
  })

  test('the expert skip is offered after five turns, and the reference finishes the run', () => {
    let s = practice()
    expect(canSkip(s)).toBe(false)
    expect(skip(s)).toBe(s)
    while (s.play.turns < SKIP_AFTER_TURNS) s = runIteration(newPicks(s, refPick(frameOf(s).view)))
    expect(canSkip(s)).toBe(true)
    const done = debrief(skip(s))
    expect(done.play.skipped).toBe(true)
    expect(done.play.ended).not.toBeNull()
    expect(done.summary?.skipped).toBe(true)
    expect(done.summary?.survived).toBe(done.summary?.ghostSurvived)
    expect(canSkip(done)).toBe(false)
  })

  test('no debrief before the run ends', () => {
    const s = runIteration(newPicks(practice(), refPick(frameOf(practice()).view)))
    expect(debrief(s)).toBe(s)
    expect(s.summary).toBeNull()
    expect(recordOf(s)).toBeNull()
  })

  test('the same minute and the same taps give the same debrief (determinism)', () => {
    const a = debrief(playOut(newSchedSession(banded[5]), fcfsPick)).summary
    const b = debrief(playOut(newSchedSession(banded[5]), fcfsPick)).summary
    expect(a).toEqual(b)
  })

  test('a fresh minute is in band, unseen, and not the practice minute', () => {
    const draw = drawSchedTrace(123456789, source)
    expect(draw.band.inBand).toBe(true)
    const s = newSchedSession(draw.trace)
    expect(s.provenance).toBe('unseen')
    expect(s.trace.seed).not.toBeNull()
  })
})

/** The session with these requests tapped, in order (taps the chips would refuse are skipped). */
function newPicks(s: SchedSession, ids: readonly number[]): SchedSession {
  let next = s
  for (const id of ids) next = togglePick(next, id)
  return next
}

describe('the ghost stays hidden until the debrief', () => {
  const html = () => renderToString(createElement(SchedulerPlayView, { source, mode: 'embed' }))

  test('the play screen shows no reference run, score or debrief', () => {
    const out = html()
    expect(out).toContain('data-phase-now="play"')
    expect(out).not.toContain('data-phase="debrief"')
    expect(out).not.toContain('data-debrief-side')
    expect(out).not.toMatch(/The reference served|You served|ghost|first divergence/i)
    // One KV bar, and it is the learner's.
    expect(out.match(/data-kv-bar/g)).toHaveLength(1)
    expect(out).toContain('Your KV pool')
  })

  test('the stage the play screen is built from carries the learner side only', () => {
    const st = stageOf(practice())
    expect(Object.keys(st).sort()).toEqual(['frame', 'kind', 'turn'])
    expect(JSON.stringify(st)).not.toContain('ghost')
    // The session holds the ghost (the lockstep runner plays it up front). Compose shows it only after the debrief, and the debrief reads it.
    const readers = ['Play.tsx', 'Queue.tsx', 'Mirror.tsx', 'ProductionCard.tsx'].filter((f) =>
      /\.ghost\b|ghostFrame|ghostSurvived/.test(readFileSync(join(SRC, 'components', 'play', 'scheduler', f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
    )
    expect(readers).toEqual([])
  })

  test('the screen says where the minute comes from, with both counts read from the artifact', () => {
    expect(html()).toContain(practiceSourceLine(source.minute).replace(/'/g, '&#x27;'))
    // F13: the count carries its thousands separator.
    expect(html()).toContain('(1,095 requests)')
    expect(html()).not.toContain('1095')
    const other = structuredClone(source)
    other.minute.sampling.sourceRowsInWindow = 777
    expect(renderToString(createElement(SchedulerPlayView, { source: other, mode: 'page' }))).toContain('busiest minute (777 requests)')
  })

  test('the debrief shows both runs at the first divergence with the sentences', () => {
    const s = losingSession(greedyPick)
    const out = renderToString(createElement(Debrief, { session: s, onAgain: () => {} }))
    const div = s.summary?.divergence
    if (!div?.decision) throw new Error('no divergence')
    expect(out).toContain('data-phase="debrief"')
    expect(out).toContain(`The first divergence is at iteration ${div.decision.iter}`)
    expect(out).toContain(`Your run at iteration ${div.decision.iter}`)
    expect(out).toContain(`The reference&#x27;s run at iteration ${div.decision.iter}`)
    expect(out.match(/data-debrief-side/g)).toHaveLength(2)
    expect(out.match(/data-play-mirror/g)).toHaveLength(2)
    expect(out.match(/data-kv-bar/g)).toHaveLength(2)
    expect(out).toContain(div.explanation.replace(/'/g, '&#x27;').replace(/→/g, '→'))
    expect(out).toContain('Play again with a new minute')
  })

  test('a run with no divergence says so and shows no side by side; the practice minute is not called gentle', () => {
    const s = debrief(playOut(practice(), refPick))
    const out = renderToString(createElement(Debrief, { session: s, onAgain: () => {} }))
    expect(out).toContain('You kept pace with the reference')
    expect(out).not.toContain('data-debrief-side')
    expect(out).toContain('Compose a policy below')
    expect(out).not.toContain('gentle')
    expect(out).not.toContain('never fills')
  })

  test('the practice minute is in band on every §8.2 rule, and verify-plays enforces all five', async () => {
    const band = checkSchedBand(practiceMinute(source))
    expect(band.rules).toEqual([true, true, true, true, true])
    const result = await practiceBandOf('scheduler', ROOT)
    expect(result?.inBand).toBe(true)
    expect(result?.note).toContain(`seed ${SCHED_PRACTICE_MINUTE_SEED}`)
    expect(result?.note).toContain('in band on all five rules')
    expect(await practiceBandOf('not-a-play', ROOT)).toBeNull()
  })

  test('the In-production card’s claim about the practice minute is true of it: the pool nearly fills and requests also wait for a slot', () => {
    const row = SCHEDULER_PRODUCTION_ROWS.find((r) => r.claim === 'production.vllm.max-num-seqs')
    expect(row?.lead).toContain('that cap and the pool both bind')
    expect(row?.lead).not.toContain('a minute fills the pool')
    const t = practiceMinute(source)
    let peak = 0
    let waitedForSlot = 0
    const e = new Engine(
      t.cfg,
      t.requests.map((r) => ({ ...r })),
      {
        name: 'watch',
        schedule(v) {
          peak = Math.max(peak, v.memUsed)
          if (v.waiting.length > 0 && v.running.length >= v.maxRunning) waitedForSlot++
          return referenceScheduler(v)
        },
      },
      makeRefManager(t.cfg.numBlocks, t.cfg.blockSize),
    )
    while (!e.done && e.tick < 2000) e.step()
    expect(peak).toBeGreaterThanOrEqual(0.9 * t.cfg.numBlocks * t.cfg.blockSize)
    expect(waitedForSlot).toBeGreaterThan(0)
  })
})

describe('touch targets and the mirror (§8.3)', () => {
  test('a waiting chip is a full-width button at least 44 px tall, a toggle that carries its place in the admit order', () => {
    const out = renderToString(createElement(SchedulerPlayView, { source, mode: 'page' }))
    const chips = out.match(/<button[^>]*data-chip[^>]*>/g) ?? []
    expect(chips.length).toBeGreaterThan(0)
    for (const c of chips) {
      expect(c).toContain('min-h-11')
      expect(c).toContain('w-full')
      expect(c).toContain('aria-pressed="false"')
    }
    const s = togglePick(practice(), frameOf(practice()).view.waiting[0].id)
    const frame = frameOf(s)
    const q = renderToString(createElement(Queue, { frame, picks: s.picks, preempt: null, onToggleAdmit: () => {}, onTogglePreempt: () => {}, onRun: () => {} }))
    expect(q).toContain('aria-pressed="true"')
    expect(q).toContain('admit 1')
  })

  test('a running request has a 44 px Preempt toggle named for it', () => {
    let s = newSchedSession(banded[0])
    for (let i = 0; i < 4 && stageOf(s).kind === 'turn' && frameOf(s).view.running.length === 0; i++) s = runIteration(newPicks(s, refPick(frameOf(s).view)))
    const frame = frameOf(s)
    expect(frame.view.running.length).toBeGreaterThan(0)
    const q = renderToString(createElement(Queue, { frame, picks: [], preempt: frame.view.running[0].id, onToggleAdmit: () => {}, onTogglePreempt: () => {}, onRun: () => {} }))
    const buttons = q.match(/<button[^>]*data-preempt[^>]*>/g) ?? []
    expect(buttons).toHaveLength(frame.view.running.length)
    for (const b of buttons) expect(b).toContain('min-h-11')
    expect(q).toContain(`aria-label="Preempting #${frame.view.running[0].id}"`)
  })

  test('the KV bar is one image with a text equivalent, described by the mirror, which lists every request', () => {
    let s = newSchedSession(banded[0])
    for (let i = 0; i < 4 && stageOf(s).kind === 'turn'; i++) s = runIteration(newPicks(s, refPick(frameOf(s).view)))
    const frame = frameOf(s)
    const bar = renderToString(createElement(KvBar, { frame, describedBy: 'm1', title: 'Your KV pool' }))
    expect(bar).toContain('role="img"')
    expect(bar).toContain('aria-describedby="m1"')
    expect(bar).toMatch(/aria-label="Your KV pool\. KV pool: [\d,]+ of [\d,]+ tokens in use by \d+ running/)
    expect(bar.replace(/<!-- -->/g, '')).toContain(`Headroom is ${HEADROOM_TOKENS} tokens for each running request`)
    const mirror = renderToString(createElement(Mirror, { id: 'm1', frame, title: 'Your queues', line: s.line }))
    expect(mirror).toContain('id="m1"')
    expect(mirror).toContain('aria-expanded="false"')
    expect(mirror).toContain('aria-live="polite"')
    expect(mirror).toContain(s.line.replace('→', '→'))
    expect(mirror.match(/<tr>/g)).toHaveLength(frame.view.waiting.length + frame.view.running.length + 1)
  })

  test('the play screen has one live line per turn, and no transitions without motion-safe', () => {
    const out = renderToString(createElement(SchedulerPlayView, { source, mode: 'page' }))
    expect(out.match(/aria-live="polite"/g)).toHaveLength(1)
    for (const file of ['Play.tsx', 'Queue.tsx', 'Mirror.tsx', 'Compose.tsx', 'Debrief.tsx']) {
      const text = readFileSync(join(SRC, 'components', 'play', 'scheduler', file), 'utf8')
      expect(text.match(/(^|[\s'"])transition-/g) ?? []).toEqual([])
      expect(text).not.toMatch(/\banimate-/)
    }
  })

  test('the keys are on the page: Tab, arrows, Space, P and Enter', () => {
    const out = renderToString(createElement(SchedulerPlayView, { source, mode: 'page' }))
    for (const word of ['Tab', 'Space', 'P preempts', 'Enter runs the iteration']) expect(out).toContain(word)
  })
})

describe('Compose (§8.4)', () => {
  let traces: SchedTrace[]
  beforeAll(() => {
    traces = schedComposeTraces(practiceMinute(source), source, 42)
  })

  test('the play’s minute plus five fresh in-band minutes, deterministic in the entropy', () => {
    expect(traces).toHaveLength(1 + SCHED_COMPOSE_FRESH)
    expect(traces[0].seed).toBe(SCHED_PRACTICE_MINUTE_SEED)
    for (const t of traces.slice(1)) expect(checkSchedBand(t).inBand).toBe(true)
    expect(schedComposeTraces(practiceMinute(source), source, 42).map((t) => t.seed)).toEqual(traces.map((t) => t.seed))
    expect(schedComposeTraces(practiceMinute(source), source, 43).map((t) => t.seed)).not.toEqual(traces.map((t) => t.seed))
  })

  test('the dials are the four of the spec, and the defaults are plain FCFS', () => {
    expect(SCHED_DIAL_DEFS.map((d) => d.key)).toEqual(['order', 'guard', 'headroom', 'preempt'])
    expect(SCHED_DIAL_DEFS.map((d) => d.options.map((o) => o.value))).toEqual([['fcfs', 'sjf'], [0, 20, 2000], [0, 16, 48, 128], ['none', 'newest']])
    expect(DEFAULT_SCHED_SPEC).toEqual({ order: 'fcfs', guard: 0, headroom: 0, preempt: 'none' })
    expect(withDial(DEFAULT_SCHED_SPEC, 'order', 'sjf')).toEqual({ order: 'sjf', guard: 0, headroom: 0, preempt: 'none' })
  })

  test('the reference dials reproduce the ghost: ok and equivalent, with a ghost row beside every run', () => {
    const rep = schedComposeReport(REFERENCE_SCHED_SPEC, traces)
    expect(rep.equivalent).toBe(true)
    expect(rep.ok).toBe(true)
    expect(rep.mine).toHaveLength(traces.length)
    expect(rep.ghost).toHaveLength(traces.length)
    expect(rep.survived).toBe(rep.ghostSurvived)
    expect(rep.note).toContain('exactly what the reference chooses')
    expect(rep.note).toContain('shortest prompt first')
  })

  test('the starting dials lose on the fresh minutes and are not ok', () => {
    const rep = schedComposeReport(DEFAULT_SCHED_SPEC, traces)
    expect(rep.ok).toBe(false)
    expect(rep.equivalent).toBe(false)
    expect(rep.survived).toBeLessThan(rep.ghostSurvived)
    expect(rep.note).toContain('Change a dial')
  })

  test('the guard that never fires inside a minute still reproduces the reference; a short one does not', () => {
    expect(schedComposeReport({ ...REFERENCE_SCHED_SPEC, guard: 0 }, traces).equivalent).toBe(true)
    const short = schedComposeReport({ ...REFERENCE_SCHED_SPEC, guard: 20 }, traces)
    expect(short.survived).toBeGreaterThan(0)
  })

  test('the panel renders four labelled dial groups of 44 px options and no result before the first run', () => {
    const out = renderToString(createElement(Compose, { trace: traces[0], source }))
    expect(out.match(/<fieldset/g)).toHaveLength(4)
    for (const label of ['Order', 'Guard', 'Headroom', 'Preempt']) expect(out).toContain(`>${label}</legend>`)
    expect(out.match(/type="radio"/g)).toHaveLength(2 + 3 + 4 + 2)
    expect((out.match(/min-h-11/g) ?? []).length).toBeGreaterThanOrEqual(11)
    expect(out).not.toContain('data-compose-result')
    // The default dials are checked: one radio per group.
    expect(out.match(/checked=""/g)).toHaveLength(4)
  })
})

describe('the In-production card (§8.5)', () => {
  test('every number is a claim chip with a source button, and each row names its dial', () => {
    const out = renderToString(createElement(ProductionCard))
    expect(out.match(/Show source/g)).toHaveLength(SCHEDULER_PRODUCTION_ROWS.length)
    for (const r of SCHEDULER_PRODUCTION_ROWS) expect(out).toContain(r.dial)
    // Values come from the claims, not from the copy.
    for (const text of ['fcfs', '1,024 sequences', '8,192 tokens/iteration', '8,192 tokens/chunk', 'recompute', 'retract', '2,048 to 4,096']) expect(out).toContain(text)
  })

  test('the card names the releases its claims pin, read from the claims', () => {
    const releases = pinnedReleases()
    expect(releases).toHaveLength(2)
    const out = renderToString(createElement(ProductionCard))
    for (const r of releases) expect(out).toContain(r)
    expect(releases.join(' ')).toContain(byId['production.vllm.scheduling-policy'].pin?.ref)
    expect(releases.join(' ')).toContain(byId['production.sglang.schedule-policy'].pin?.ref)
  })

  test('no typed-in real-world number sits next to a chip: the row copy holds no digits', () => {
    for (const r of SCHEDULER_PRODUCTION_ROWS) expect(`${r.dial} ${r.lead} ${r.tail}`.replace(/\b[A-Z]\d(\.L\d)?\b/g, '').replace(/\bV1\b/g, '')).not.toMatch(/\d/)
  })

  test('the card is honest about the engines: SJF has a flag in SGLang and none in vLLM, and vLLM has a watermark that defaults off', () => {
    expect(byId['production.vllm.scheduling-policy'].boundary).toContain('shortest-prompt-first is a choice')
    expect(byId['production.sglang.schedule-policy'].boundary).toContain('shortest-prefill-first')
    expect(byId['production.vllm.watermark'].value).toBe(0)
  })
})

describe('the ledger sees play and compose (recordPlay)', () => {
  test('a debriefed play is one `play` event, phase play, ok, scored against the ghost, with the scheduler shape', async () => {
    const tab = startTab(makeProfile())
    const s = losingSession(fcfsPick)
    const result = recordOf(s, 4200)
    if (!result) throw new Error('no result')
    tab.progress.getState().recordPlay(result)
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'play')
    expect(events).toHaveLength(1)
    const sum = s.summary
    if (!sum) throw new Error('no summary')
    expect(events[0]).toMatchObject({
      ref: 'play:scheduler',
      ok: true,
      provenance: 'unseen',
      seed: s.trace.seed,
      ms: 4200,
      data: {
        phase: 'play',
        turns: sum.turns,
        survived: sum.survived,
        ghostSurvived: sum.ghostSurvived,
        skipped: false,
        divergenceOp: sum.divergence?.decision?.iter,
        kcs: [...SCHEDULER.kcs],
      },
    })
    expect(events[0].score).toBeCloseTo(Math.min(1, sum.survived / sum.ghostSurvived), 10)
    expect(tab.progress.getState().aggregate.plays.scheduler).toMatchObject({ done: true })
  })

  test('the practice minute is provenance practice with its pinned seed', async () => {
    const tab = startTab(makeProfile())
    const s = debrief(playOut(practice(), refPick))
    tab.progress.getState().recordPlay(recordOf(s) as NonNullable<ReturnType<typeof recordOf>>)
    await tab.progress.controls.flush()
    const [e] = (await (await tab.engine()).events()).filter((x) => x.kind === 'play')
    expect(e).toMatchObject({ ref: 'play:scheduler', provenance: 'practice', ok: true, seed: SCHED_PRACTICE_MINUTE_SEED, score: 1 })
    expect(e.data).not.toHaveProperty('divergenceOp')
  })

  test('a skipped play says so in the ledger', async () => {
    const tab = startTab(makeProfile())
    let s = newSchedSession(banded[1])
    while (s.play.turns < SKIP_AFTER_TURNS) s = runIteration(newPicks(s, fcfsPick(frameOf(s).view)))
    const done = debrief(skip(s))
    tab.progress.getState().recordPlay(recordOf(done) as NonNullable<ReturnType<typeof recordOf>>)
    await tab.progress.controls.flush()
    const [e] = (await (await tab.engine()).events()).filter((x) => x.kind === 'play')
    expect(e).toMatchObject({ data: { phase: 'play', skipped: true, turns: SKIP_AFTER_TURNS } })
  })

  test('a compose run is a `play` event, phase compose, with the four dials, ok for the reference and not for a losing spec', async () => {
    const tab = startTab(makeProfile())
    const base = practiceMinute(source)
    const traces = schedComposeTraces(base, source, 7)
    const lose = DEFAULT_SCHED_SPEC
    const record = tab.progress.getState().recordPlay
    record(schedComposeRecord(lose, schedComposeReport(lose, traces), base, 1))
    record(schedComposeRecord(REFERENCE_SCHED_SPEC, schedComposeReport(REFERENCE_SCHED_SPEC, traces), base, 2))
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'play')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ ref: 'play:scheduler', ok: false, seed: SCHED_PRACTICE_MINUTE_SEED, provenance: 'practice', data: { phase: 'compose', equivalent: false, turns: 1, spec: { order: 'fcfs', guard: 0, headroom: 0, preempt: 'none' } } })
    expect(events[1]).toMatchObject({ ok: true, score: 1, data: { phase: 'compose', equivalent: true, turns: 2, spec: { order: 'sjf', guard: 2000, headroom: 48, preempt: 'none' } } })
    expect(tab.progress.getState().aggregate.plays.scheduler).toMatchObject({ composed: true })
  })
})

describe('verify-plays: the scheduler’s checks (§8.5)', () => {
  const world: PlayWorld = {
    kcIds: new Set<string>(Object.values(KC)),
    claimIds: new Set(CLAIMS.map((c) => c.id)),
    lessonIds: new Set(['t5.l7']),
  }
  const read = (f: string) => readFileSync(join(SRC, 'components', 'play', 'scheduler', f), 'utf8')
  const facts = (): PlayFacts => ({
    id: SCHEDULER.id,
    lessonId: SCHEDULER.lessonId,
    kcs: SCHEDULER.kcs,
    productionClaims: SCHEDULER.productionClaims,
    cardClaims: SCHEDULER_PRODUCTION_ROWS.map((r) => r.claim),
    play: read('Play.tsx'),
    mirror: read('Mirror.tsx'),
    debrief: read('Debrief.tsx'),
    practiceInBand: true,
  })

  test('a practice trace outside the band fails the play', () => {
    expect(checkPlay({ ...facts(), practiceInBand: false }, world).some((p) => p.includes('practice trace is outside the band'))).toBe(true)
  })

  test('the registered scheduler passes with the real files', () => {
    expect(checkPlay(facts(), world)).toEqual([])
  })

  test('the card is compared with the play’s own claims, not another play’s', () => {
    const wrong = { ...facts(), cardClaims: PLAY_PRODUCTION_ROWS['block-placement'].map((r) => r.claim) }
    expect(checkPlay(wrong, { ...world, claimIds: new Set(CLAIMS.map((c) => c.id)) }).some((p) => p.includes('productionClaims does not list'))).toBe(true)
  })

  test('the play the registry loads reaches its queue, mirror and debrief, and the Fleet engine, but no worker or sim; Compose and the card are lazy chunks', () => {
    const c = closureOf(join(SRC, 'components', 'play', 'scheduler', 'Play.tsx'), SRC)
    for (const f of ['Play.tsx', 'Queue.tsx', 'Mirror.tsx', 'Debrief.tsx', 'session.ts']) {
      expect(c.files).toContain(`src/components/play/scheduler/${f}`)
    }
    for (const f of ['src/data/plays.ts', 'src/lib/world/sched.ts', 'src/lib/world/sched-policy.ts', 'src/lib/fleet-model.ts']) expect(c.files).toContain(f)
    // F10: they appear only after the debrief, so they load then (the route's gzip closure was 221.5 KB against its 220 KB figure).
    expect(c.files).not.toContain('src/components/play/scheduler/Compose.tsx')
    expect(c.files).not.toContain('src/components/play/scheduler/ProductionCard.tsx')
    const play = readFileSync(join(SRC, 'components', 'play', 'scheduler', 'Play.tsx'), 'utf8')
    expect(play).toMatch(/lazy\(loadCompose\)/)
    expect(play).toMatch(/lazy\(loadCard\)/)
    expect(play).toContain("import('./Compose')")
    expect(play).toContain("import('./ProductionCard')")
    expect(c.files.some((f) => f.includes('workers/') || (f.includes('components/sims/') && !f.endsWith('SimMirror.tsx')))).toBe(false)
    expect(c.packages).toContain('react')
  })

  test('the play block, the page and the route budget are wired to it', () => {
    const bundle = readFileSync(join(ROOT, 'scripts', 'verify-bundle.ts'), 'utf8')
    expect(bundle).toMatch(/route: '\/play\/scheduler'[^}]*budgetKb: null[^}]*playSrc: 'src\/components\/play\/scheduler\/Play\.tsx'/)
  })
})

describe('the keyboard walk, as a model', () => {
  test('Space then Enter on the first chip, every turn, plays the practice minute to its end inside the cap', () => {
    // e2e/scheduler.spec.ts presses Space on the first enabled chip and Enter, at each turn. As a model: tap the first
    // chip that can be pressed, run the iteration.
    let s = practice()
    let turns = 0
    for (; stageOf(s).kind === 'turn' && turns < 100; turns++) {
      const frame = frameOf(s)
      const first = frame.view.waiting.find((r) => pickProblem(frame, s.picks, s.preempt, r.id) === '')
      if (!first) throw new Error('no chip can be pressed at a turn')
      s = runIteration(togglePick(s, first.id))
    }
    expect(stageOf(s).kind).toBe('over')
    expect(s.play.ended).not.toBeNull()
    expect(turns).toBeLessThanOrEqual(TURN_CAP)
    const done = debrief(s)
    expect(done.summary).not.toBeNull()
  })
})
