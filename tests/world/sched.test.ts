import { beforeAll, describe, expect, test } from 'bun:test'
import {
  SCHEDULER_PLAY_ID,
  SKIP_AFTER_TURNS,
  TURN_CAP,
  actionProblems,
  actionsDiffer,
  canSkip,
  decisionSentence,
  driverDecider,
  effectiveAdmits,
  groups,
  isTurnView,
  mineRun,
  playSchedAll,
  replaySched,
  schedDivergence,
  schedEndLine,
  schedModel,
  schedPending,
  schedPlayResult,
  schedSetup,
  schedTurn,
  schedTurnLine,
  skipSchedToDebrief,
  startSchedPlay,
  summarizeSched,
  type SchedPlay,
  type SchedSetup,
} from '../../src/lib/world/sched'
import { FCFS_DRIVER, GHOST_DRIVER, GREEDY_DRIVER, drawSchedTrace, parseSchedSource, practiceMinute, runSched, type SchedSource, type SchedTrace } from '../../src/lib/world/sched-traces'
import { HEADROOM_TOKENS, referenceScheduler, type SchedAction, type SchedView } from '../../src/lib/fleet-model'
import { splitmix32u } from '../../src/lib/rng'
import type { Decider } from '../../src/lib/world/play'
import type { SchedDecisionKind, SchedFrame } from '../../src/lib/world/types'

const dir = new URL('../../public/traces/', import.meta.url)
let source: SchedSource
/** 50 banded minutes drawn the way the play draws them. */
let banded: SchedTrace[]
beforeAll(async () => {
  source = await parseSchedSource(
    await Bun.file(new URL('burstgpt-v2-busiest-minute.json', dir)).json(),
    await Bun.file(new URL('burstgpt-v2-busiest-hour.json', dir)).json(),
  )
  banded = Array.from({ length: 50 }, (_, i) => drawSchedTrace((i + 1) * 7919, source).trace)
})

type Learner = Decider<SchedFrame, SchedView, SchedAction>

/** Admits, in `order`, everything that fits the learner's own headroom accounting. */
function admitWith(v: SchedView, order: SchedView['waiting'], headroom: number): SchedAction {
  let used = v.running.reduce((a, r) => a + r.prompt + r.decoded + headroom, 0)
  let slots = v.maxRunning - v.running.length
  const admit: number[] = []
  for (const r of order) {
    if (slots === 0) break
    if (used + r.prompt + headroom > v.memCap) continue
    admit.push(r.id)
    slots--
    used += r.prompt + headroom
  }
  return { admit, preempt: [] }
}

/** Six simulated learners, one per kind of mistake the debrief names (the Opus check's panel). */
function learners(seed: number): Learner[] {
  const rnd = splitmix32u(seed)
  let turn = 0
  return [
    driverDecider(GREEDY_DRIVER),
    driverDecider(FCFS_DRIVER),
    { name: 'longest-first', decide: (_f, v) => admitWith(v, [...v.waiting].sort((a, b) => b.prompt - a.prompt), HEADROOM_TOKENS) },
    { name: 'one-per-turn', decide: (_f, v) => ({ admit: referenceScheduler(v).admit.slice(0, 1), preempt: [] }) },
    {
      name: 'random',
      decide(_f, v) {
        const w = [...v.waiting]
        for (let i = w.length - 1; i > 0; i--) {
          const j = rnd() % (i + 1)
          const swap = w[i]
          w[i] = w[j]
          w[j] = swap
        }
        const a = admitWith(v, w, 0)
        return { admit: a.admit.slice(0, rnd() % (a.admit.length + 1)), preempt: [] }
      },
    },
    {
      name: 'preempter',
      decide(_f, v) {
        turn++
        const r = referenceScheduler(v)
        if (turn % 7 !== 0 || v.running.length === 0) return r
        const newest = [...v.running].sort((a, b) => b.arrival - a.arrival || b.id - a.id)[0]
        return { admit: r.admit, preempt: [newest.id] }
      },
    },
  ]
}

const nothing: Learner = { name: 'nothing', decide: () => ({ admit: [], preempt: [] }) }
const reference = driverDecider(GHOST_DRIVER)

describe('the world: a decision log replayed through the Fleet Engine', () => {
  test('the empty log handed to the reference is the plain Engine under referenceScheduler', () => {
    for (const t of [practiceMinute(source), ...banded.slice(0, 10)]) {
      const r = replaySched(t, { decisions: [], rest: 'reference' })
      const plain = runSched(t, GHOST_DRIVER)
      expect(r.met).toBe(plain.met)
      expect(r.completed).toBe(plain.completed)
      expect(r.autoPreempts).toBe(plain.autoPreempts)
      expect(r.frame.iter).toBe(plain.iterations)
      expect(r.frame.done).toBe(true)
      // sched-traces counts turns by the same rule, independently.
      expect(r.turns).toHaveLength(plain.turns)
      expect(r.outcomes.size).toBe(t.requests.length)
    }
  })

  test('the reference never admits outside a turn, so a replay may step those iterations with an empty action', () => {
    let iterations = 0
    for (const t of [practiceMinute(source), ...banded]) {
      replaySched(t, { decisions: [], rest: 'reference' })
      const r = runSched(t, {
        name: 'probe',
        schedule(v) {
          iterations++
          const a = referenceScheduler(v)
          if (!isTurnView(v)) expect(a).toEqual({ admit: [], preempt: [] })
          return a
        },
      })
      expect(r.finished).toBe(true)
    }
    expect(iterations).toBeGreaterThan(3000)
  })

  test('pure: apply returns a new state and leaves the old one, its view and the trace as they were', () => {
    const t = banded[0]
    const before = JSON.stringify(t)
    const m = schedModel(t)
    const s0 = m.init()
    const v0 = m.view(s0)
    const ask = m.ask(s0, 0) as SchedView
    const res = m.apply(s0, 0, referenceScheduler(ask))
    expect(res.state).not.toBe(s0)
    expect(s0.decisions).toHaveLength(0)
    expect(res.state.decisions).toHaveLength(1)
    expect(res.at).toBe(v0.iter)
    expect(m.view(s0)).toBe(v0) // memoized per state
    expect(m.view(res.state).iter).toBeGreaterThan(v0.iter)
    expect(Object.isFrozen(res.state)).toBe(true)
    expect(JSON.stringify(t)).toBe(before)
    // A fresh model replays the same log to the same frame.
    expect(schedModel(t).view(res.state)).toEqual(m.view(res.state))
  })

  test('turns only at admissible iterations: every turn frame passes the rule, in increasing iterations', () => {
    for (const t of banded.slice(0, 10)) {
      for (const l of learners(1)) {
        const setup = schedSetup(t)
        const run = mineRun(setup, playSchedAll(setup, l))
        let last = -1
        for (const turn of run.turns) {
          expect(isTurnView(turn.frame.view)).toBe(true)
          expect(turn.frame.iter).toBeGreaterThan(last)
          last = turn.frame.iter
        }
      }
    }
  })

  test('an illegal decision is refused, not silently replayed', () => {
    const setup = schedSetup(banded[0])
    const p = schedPending(setup, startSchedPlay(setup))
    if (!p) throw new Error('no first turn')
    const running = p.view.running[0]?.id ?? 999
    expect(actionProblems(p.view, { admit: [12345], preempt: [] })).toEqual(['#12345 is not waiting'])
    expect(() => setup.model.apply(setup.model.init(), 0, { admit: [12345], preempt: [] })).toThrow('not waiting')
    expect(() => setup.model.apply(setup.model.init(), 0, null)).toThrow('needs a decision')
    expect(actionProblems(p.view, { admit: [p.view.waiting[0].id, p.view.waiting[0].id], preempt: [] })).toContain('a request is admitted twice')
    expect(actionProblems(p.view, { admit: [], preempt: [running, running] })).toContain('one preempt per turn')
  })

  test('effectiveAdmits is what the Engine takes: a full batch stops it, a prompt that does not fit is skipped', () => {
    const v: SchedView = {
      iter: 5,
      maxRunning: 2,
      memCap: 256,
      memUsed: 128,
      waiting: [
        { id: 1, arrival: 0, prompt: 200 },
        { id: 2, arrival: 1, prompt: 60 },
        { id: 3, arrival: 2, prompt: 10 },
      ],
      running: [{ id: 9, arrival: 0, prompt: 120, decoded: 3, prefillLeft: 0 }],
    }
    expect(effectiveAdmits(v, { admit: [1, 2, 3], preempt: [] }, 16)).toEqual([2])
    // Preempting #9 frees its 122 held tokens (8 blocks) and its slot: #1 takes 13 of the 16 blocks,
    // #2 (4 blocks) no longer fits, #3 (1 block) does.
    expect(effectiveAdmits(v, { admit: [1, 2, 3], preempt: [9] }, 16)).toEqual([1, 3])
    // Tap order alone is not a difference; a different set is, and so is one batch slot short.
    const wide = { ...v, maxRunning: 4 }
    expect(actionsDiffer(wide, { admit: [3, 2], preempt: [] }, { admit: [2, 3], preempt: [] }, 16)).toBe(false)
    expect(actionsDiffer(wide, { admit: [2], preempt: [] }, { admit: [3], preempt: [] }, 16)).toBe(true)
    expect(actionsDiffer(v, { admit: [3, 2], preempt: [] }, { admit: [2, 3], preempt: [] }, 16)).toBe(true)
  })
})

describe('the play', () => {
  test('the ghost is referenceScheduler on its own Engine, complete before the first turn', () => {
    const setup = schedSetup(banded[1])
    const play = startSchedPlay(setup)
    expect(play.ghost.met).toBe(runSched(banded[1], GHOST_DRIVER).met)
    expect(play.ghost.frame.done).toBe(true)
    expect(play.turns).toBe(0)
    expect(play.ended).toBeNull()
  })

  test('the ghost stays hidden: what the play screen reads carries the learner’s side only', () => {
    const setup = schedSetup(banded[1])
    const play = startSchedPlay(setup)
    const p = schedPending(setup, play)
    expect(Object.keys(p ?? {}).sort()).toEqual(['frame', 'turn', 'view'])
    // Nothing in the pending turn is the ghost's: its frame is the learner's, before any decision.
    expect(p?.frame.turn).toBe(0)
    expect(p?.frame).toEqual(setup.model.view(play.mine))
    expect(JSON.stringify(p)).not.toContain('ghost')
  })

  test('the reference as the learner keeps pace with the ghost: same turns, same requests, no debrief', () => {
    for (const t of [practiceMinute(source), ...banded.slice(0, 10)]) {
      const setup = schedSetup(t)
      const play = playSchedAll(setup, reference)
      const s = summarizeSched(setup, play)
      expect(s.survived).toBe(s.ghostSurvived)
      expect(s.divergence).toBeNull()
      if (play.ended === 'trace-end') expect(play.turns).toBe(play.ghost.turns.length)
    }
  })

  test('the 60-turn cap: a learner who admits nothing is stopped at 60 turns and the reference finishes the run', () => {
    const setup = schedSetup(banded[2])
    const play = playSchedAll(setup, nothing)
    expect(TURN_CAP).toBe(60)
    expect(play.turns).toBe(60)
    expect(play.ended).toBe('turn-cap')
    expect(play.mine.rest).toBe('reference')
    const run = mineRun(setup, play)
    expect(run.frame.done).toBe(true)
    expect(run.turns.filter((t) => t.by === 'you')).toHaveLength(60)
    expect(schedPending(setup, play)).toBeNull()
    expect(schedTurn(setup, play, { admit: [], preempt: [] })).toBe(play)
    expect(schedEndLine(setup, play)).toMatch(/^turn cap reached after 60 turns; the reference finished your run: \d+ of 40 requests/)
  })

  test('skip after 5 turns: the reference finishes the learner’s own run', () => {
    const setup = schedSetup(banded[3])
    let play = startSchedPlay(setup)
    for (let i = 0; i < SKIP_AFTER_TURNS; i++) {
      expect(canSkip(play)).toBe(false)
      const p = schedPending(setup, play)
      if (!p) throw new Error('ended early')
      play = schedTurn(setup, play, FCFS_DRIVER.schedule(p.view))
    }
    expect(canSkip(play)).toBe(true)
    const skipped = skipSchedToDebrief(play)
    expect(skipped).toMatchObject({ skipped: true, ended: 'trace-end', turns: SKIP_AFTER_TURNS })
    const run = mineRun(setup, skipped)
    expect(run.frame.done).toBe(true)
    expect(run.turns.slice(0, SKIP_AFTER_TURNS).every((t) => t.by === 'you')).toBe(true)
    expect(run.turns.slice(SKIP_AFTER_TURNS).every((t) => t.by === 'reference')).toBe(true)
    expect(summarizeSched(setup, skipped).skipped).toBe(true)
  })

  test('the practice minute plays to its end: 40 turns, as sched-traces counts them', () => {
    const setup = schedSetup(practiceMinute(source))
    const play = playSchedAll(setup, reference)
    expect(play).toMatchObject({ turns: 40, ended: 'trace-end', skipped: false })
    expect(summarizeSched(setup, play).seed).toBe(0)
  })

  test('deterministic: the same minute and the same taps give the same summary', () => {
    for (const l of [0, 4, 5]) {
      const a = summarizeSched(schedSetup(banded[4]), playSchedAll(schedSetup(banded[4]), learners(9)[l]))
      const b = summarizeSched(schedSetup(banded[4]), playSchedAll(schedSetup(banded[4]), learners(9)[l]))
      expect(a).toEqual(b)
    }
  })

  test('the aria-live line for a turn', () => {
    const setup = schedSetup(banded[0])
    const p = schedPending(setup, startSchedPlay(setup))
    if (!p) throw new Error('no first turn')
    const a = referenceScheduler(p.view)
    const line = schedTurnLine(p.frame, a)
    expect(line).toStartWith(`Iteration ${p.view.iter}: admitted #${a.admit[0]} (`)
    expect(line).toMatch(/ Free [\d,]+ → [\d,]+\. \d+ waiting\.$/)
    expect(schedTurnLine(p.frame, { admit: [], preempt: [] })).toBe(`Iteration ${p.view.iter}: admitted nothing. Free ${groups(p.frame.free)}. ${p.view.waiting.length} waiting.`)
  })
})

describe('the debrief', () => {
  const debriefed = (t: SchedTrace, l: Learner): { setup: SchedSetup; play: SchedPlay } => {
    const setup = schedSetup(t)
    return { setup, play: playSchedAll(setup, l) }
  }

  test('the request is the earliest-arriving one the ghost served within SLO and the learner did not', () => {
    for (const t of banded.slice(0, 10)) {
      const { setup, play } = debriefed(t, learners(3)[1])
      const d = schedDivergence(setup, play)
      const mine = mineRun(setup, play)
      const lost = t.requests.filter((r) => play.ghost.outcomes.get(r.id)?.met && !mine.outcomes.get(r.id)?.met)
      if (lost.length === 0) {
        expect(d).toBeNull()
        continue
      }
      const first = [...lost].sort((a, b) => a.arrival - b.arrival || a.id - b.id)[0]
      expect(d?.request.id).toBe(first.id)
      expect(d?.request.deadline).toBe(first.arrival + t.cfg.sloTtft)
      expect(d?.request.ttft).toBeGreaterThan(t.cfg.sloTtft)
      expect(d?.request.ghostTtft).toBeLessThanOrEqual(t.cfg.sloTtft)
    }
  })

  test('the decision is the latest differing hand turn from which the reference serves the request in time', () => {
    for (const t of banded.slice(0, 8)) {
      for (const l of learners(5)) {
        const { setup, play } = debriefed(t, l)
        const d = schedDivergence(setup, play)
        if (!d?.decision) continue
        const dec = d.decision
        const handover = (turn: number) => replaySched(t, { decisions: play.mine.decisions.slice(0, turn), rest: 'reference' })
        expect(actionsDiffer(dec.mineFrame.view, dec.mine, dec.reference, dec.mineFrame.blockSize)).toBe(true)
        expect(dec.reference).toEqual(referenceScheduler(dec.mineFrame.view))
        expect(dec.mine).toEqual(play.mine.decisions[dec.turn])
        if (!dec.recoverable) continue
        expect(handover(dec.turn).outcomes.get(d.request.id)?.met).toBe(true)
        expect(dec.cost).toContain(d.request.id)
        // No later differing hand turn (up to the request's finish) could have saved it.
        for (const turn of mineRun(setup, play).turns) {
          if (turn.by !== 'you' || turn.frame.turn <= dec.turn || turn.frame.iter > d.request.finishedAt) continue
          if (!actionsDiffer(turn.frame.view, turn.action, referenceScheduler(turn.frame.view), turn.frame.blockSize)) continue
          expect(handover(turn.frame.turn).outcomes.get(d.request.id)?.met).toBeFalsy()
        }
      }
    }
  })

  test('both runs are shown at the decision’s iteration', () => {
    const { setup, play } = debriefed(banded[5], learners(1)[1])
    const d = schedDivergence(setup, play)
    if (!d?.decision) throw new Error('FCFS lost nothing on this minute')
    expect(d.decision.mineFrame.iter).toBe(d.decision.iter)
    expect(d.decision.ghostFrame.iter).toBe(d.decision.iter)
    expect(d.decision.ghostFrame).toEqual(replaySched(banded[5], { decisions: [], rest: 'reference' }, d.decision.iter).frame)
  })

  test('the ledger result: score = min(1, survived / ghostSurvived), divergenceOp = the decision’s iteration', () => {
    const { setup, play } = debriefed(banded[6], learners(1)[0])
    const s = summarizeSched(setup, play)
    const r = schedPlayResult(s, { provenance: 'unseen', kcs: ['t5.continuous-batching'] })
    expect(r.playId).toBe(SCHEDULER_PLAY_ID)
    expect(r.ok).toBe(true)
    expect(r.seed).toBe(banded[6].seed as number)
    expect(r.score).toBeCloseTo(Math.min(1, s.survived / s.ghostSurvived), 10)
    expect(r.data).toEqual({
      phase: 'play',
      turns: s.turns,
      survived: s.survived,
      ghostSurvived: s.ghostSurvived,
      skipped: false,
      divergenceOp: s.divergence?.decision?.iter,
      kcs: ['t5.continuous-batching'],
    })
  })

  test('the four §8.3 templates, with numbers from the learner’s view', () => {
    const v: SchedView = {
      iter: 37,
      maxRunning: 8,
      memCap: 4096,
      memUsed: 2992,
      waiting: [
        { id: 9, arrival: 30, prompt: 1024 },
        { id: 11, arrival: 31, prompt: 60 },
        { id: 12, arrival: 33, prompt: 70 },
        { id: 13, arrival: 34, prompt: 80 },
      ],
      running: [
        { id: 3, arrival: 10, prompt: 1400, decoded: 30, prefillLeft: 0 },
        { id: 7, arrival: 20, prompt: 1500, decoded: 30, prefillLeft: 0 },
      ],
    }
    const frame = { ...setupFrame(v) }
    const ref = referenceScheduler(v)
    expect(ref.admit).toEqual([11, 12, 13])
    const say = (mine: SchedAction, cost: number[] = [11, 12, 13]) => decisionSentence(frame, mine, ref, cost, 11)
    expect(say({ admit: [9], preempt: [] })).toEqual({
      kind: 'over-headroom',
      sentence:
        'At iteration 37 you admitted #9, a 1,024-token prompt, with 1,104 tokens free. The reference skips it: keeping 48 tokens of headroom for each of your 2 running requests leaves 1,040, and 1,024 + 48 > 1,040. That cost #11, #12 and #13 their deadline.',
    })
    expect(say({ admit: [9], preempt: [] }, [11, 12, 13, 14, 15]).sentence).toEndWith('That cost 5 requests their deadline, #11 among them.')
    expect(say({ admit: [], preempt: [7] }, [11, 12])).toEqual({ kind: 'preempted', sentence: 'At iteration 37 you preempted #7 after 30 decode steps; recomputing it cost #11 and #12 their deadline.' })
    expect(say({ admit: [12, 13], preempt: [] })).toEqual({ kind: 'held-back', sentence: 'At iteration 37 you admitted #12 and #13 and left 2 requests waiting with room for 1 more; the reference also admits #11.' })
    expect(say({ admit: [], preempt: [] })).toEqual({ kind: 'held-back', sentence: 'At iteration 37 you left 4 requests waiting with room for 3 of them; the reference admits #11, #12 and #13.' })
    // Order: one running request and three free slots, so the 1,024-token prompt fits under headroom
    // but takes the slot the reference gives #11.
    const roomy: SchedView = { ...v, maxRunning: 4, memUsed: 2992 - 1504, running: [v.running[0]] }
    const roomyRef = referenceScheduler(roomy)
    expect(roomyRef.admit).toEqual([11, 12, 13])
    expect(decisionSentence(setupFrame(roomy), { admit: [12, 13, 9], preempt: [] }, roomyRef, [], 11)).toEqual({
      kind: 'order',
      sentence: 'At iteration 37 you admitted #9 (1,024 tokens) before #11 (60 tokens). The reference takes the shortest first.',
    })
  })
})

/** A frame for a hand-made view, as the replay would build it (blockSize 16). */
function setupFrame(v: SchedView): SchedFrame {
  return {
    iter: v.iter,
    turn: 0,
    view: v,
    running: v.running.map((r) => ({ ...r, output: 100 })),
    blockSize: 16,
    free: v.memCap - v.memUsed,
    arrived: 0,
    total: 40,
    completed: 0,
    met: 0,
    autoPreempts: 0,
    done: false,
  }
}

describe('Opus check: the turn rule and the debrief on 50 banded seeds, six simulated learners', () => {
  test('every lost request gets a recoverable decision, every kind appears, and the sentences hold together', () => {
    const kinds: Record<string, Record<SchedDecisionKind | 'none' | 'fallback', number>> = {}
    const mismatch = { tapOrder: 0, effective: 0, turns: 0 }
    const samples: string[] = []
    let plays = 0
    let debriefs = 0
    for (const [i, t] of banded.entries()) {
      for (const l of learners(i + 1)) {
        plays++
        const setup = schedSetup(t)
        const play = playSchedAll(setup, l)
        const d = schedDivergence(setup, play)
        const row = (kinds[l.name] ??= { preempted: 0, 'over-headroom': 0, order: 0, 'held-back': 0, other: 0, none: 0, fallback: 0 })
        for (const turn of mineRun(setup, play).turns) {
          if (turn.by !== 'you') continue
          const r = referenceScheduler(turn.frame.view)
          mismatch.turns++
          if (JSON.stringify(turn.action.admit) !== JSON.stringify(r.admit) || turn.action.preempt.length) mismatch.tapOrder++
          if (actionsDiffer(turn.frame.view, turn.action, r, turn.frame.blockSize)) mismatch.effective++
        }
        if (!d) {
          row.none++
          continue
        }
        debriefs++
        expect(d.decision).not.toBeNull()
        const dec = d.decision!
        row[dec.kind]++
        if (!dec.recoverable) row.fallback++
        expect(d.explanation).toBe(`${d.outcome} ${dec.sentence}`)
        expect(d.explanation).not.toMatch(/undefined|NaN|Infinity|null/)
        expect(dec.sentence).toStartWith(`At iteration ${dec.iter} you `)
        expect(d.outcome).toStartWith(`#${d.request.id} (${groups(d.request.prompt)} tokens) arrived at iteration ${d.request.arrival} and `)
        if (dec.kind === 'over-headroom') expect(dec.sentence).toContain(`with ${groups(dec.mineFrame.free)} tokens free`)
        if (dec.kind === 'preempted') expect(dec.sentence).toContain(`you preempted #${dec.mine.preempt[0]} `)
        if (samples.length < 12 && i % 9 === 0) samples.push(`  [${l.name}, minute ${t.seed}] ${d.explanation}`)
      }
    }
    console.log(`scheduler debrief review: ${plays} plays, ${debriefs} debriefs`)
    console.log('  learner         preempted over-headroom order held-back other | no loss fallback')
    for (const [name, k] of Object.entries(kinds)) {
      console.log(`  ${name.padEnd(15)} ${[k.preempted, k['over-headroom'], k.order, k['held-back'], k.other].map((n) => String(n).padStart(9)).join('')} | ${String(k.none).padStart(7)} ${String(k.fallback).padStart(8)}`)
    }
    console.log(`  hand turns ${mismatch.turns}: ${mismatch.tapOrder} differ in tap order, ${mismatch.effective} in what the Engine admits`)
    for (const s of samples) console.log(s)
    // Each mistake is named by its own template.
    expect(kinds['greedy']['over-headroom']).toBeGreaterThanOrEqual(45)
    expect(kinds['fcfs'].order).toBeGreaterThanOrEqual(45)
    expect(kinds['one-per-turn']['held-back']).toBeGreaterThan(0)
    expect(kinds['preempter'].preempted).toBeGreaterThan(0)
    const fallbacks = Object.values(kinds).reduce((a, k) => a + k.fallback, 0)
    expect(fallbacks).toBeLessThanOrEqual(debriefs / 20)
    expect(mismatch.effective).toBeLessThan(mismatch.tapOrder)
  }, 30000)
})
