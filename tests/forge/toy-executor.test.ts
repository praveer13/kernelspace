/**
 * Lab 05 (toy-executor) as a Forge bundle (docs/specs/wave-3.md §8.2; task 3b-11): a faded bundle (`fade: 'r2'`) with
 * PRIMM around the committed seed-7 probe run, R0 to R2 for the six required checks, six Prove-it v1 questions and no
 * `prove2`. The reference run is held to the crate's committed probe line; the numbers the items rest on are checked
 * against a small model of the executor mistakes that calibration.json names (a stack, a loop that re-queues Pending
 * tasks), which agrees with what the crate's checks printed when those mutants were run. There is no DOM mounting here:
 * interaction is checked in a browser.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { HintLadderView } from '../../src/components/forge/HintLadder'
import { PrimmPanel } from '../../src/components/forge/PrimmPanel'
import ProveIt from '../../src/components/forge/ProveIt'
import { ReferenceRun } from '../../src/components/forge/ReferenceRun'
import { StagePanel } from '../../src/components/forge/StagePanel'
import { findForgeBundle, forgeBundleIds } from '../../src/data/forge'
import bundle from '../../src/data/forge/toy-executor'
import { DISCUSSIONS_LABEL, LADDER, LADDER_CHECK_IDS, LAB_ID } from '../../src/data/forge/toy-executor/ladder'
import {
  PRIMM_ITEMS,
  PRIMM_MC_ITEMS,
  PRIMM_STEPS,
  PROBE_SEED,
  REFERENCE,
  RUN_ITEM,
  RUN_SPEC,
  SEED7_REPLY,
  STAGES,
  parseProbe,
  pollRounds,
  probeYields,
  yieldsOf,
} from '../../src/data/forge/toy-executor/primm'
import { PROVE_LAB_ID, PROVE_QUESTIONS, followUpRef } from '../../src/data/forge/toy-executor/prove'
import type { NumberPrimm } from '../../src/data/forge/types'
import { kcById } from '../../src/data/kc'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import { hintRef } from '../../src/lib/forge/ladder'
import { followUpRefFor } from '../../src/lib/forge/prove-return'
import { gradeChoice, gradeNumber, observationResponse, primmRef, stageRows } from '../../src/lib/forge/primm'
import { pickQuestions } from '../../src/lib/forge/prove'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { refMatchesKind } from '../../src/lib/ledger/refs'
import { lintBundle } from '../../scripts/lint-mentor'
import { oddOneOut } from '../../scripts/item-cues'
import { extractHeadings } from '../../src/pages/lesson/markdown'

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const LIB_RS = read('labs/toy-executor/src/lib.rs')
const EXECUTOR_RS = read('labs/toy-executor/src/executor.rs')
const CALIBRATION = JSON.parse(read('labs/toy-executor/calibration.json')) as {
  checks: Record<string, unknown>
  probe: { seed: number; reply: string }
  mutants: Record<string, { caughtBy: string[] }>
}
const lab = FORGE_LABS.find((l) => l.id === 'toy-executor')
if (lab === undefined) throw new Error('lab 05 is missing from labs.ts')
const required = lab.checks.filter((c) => c.optional !== true)

const h2s = new Map<string, Set<string>>()
for (const l of ALL_LESSONS) h2s.set(l.id, new Set(extractHeadings(l.blocks).filter((h) => h.level === 2).map((h) => h.id)))

const ISO = '2026-10-04T09:00:00.000Z'
const row = (id: string, status: CheckResult['status'] = 'fail', extra: Partial<CheckResult> = {}): CheckResult => ({ id, label: id, status, msg: `${id} says no`, ...extra })
const report = (checks: CheckResult[]): LabRunReport => ({ lab: 'toy-executor', reference: false, abi: 2, version: 2, checks, seeds: 'fresh', ms: 5 })

/* -------------------- a model of the executor and of the mistakes the items name -------------------- */

interface Mode {
  /** Which end of the queue `run` pops: the reference pops the front. */
  pop: 'front' | 'back'
  /** The loop pushes a Pending task back itself, as well as the waker doing so. */
  requeue: boolean
}
const FIFO: Mode = { pop: 'front', requeue: false }
const STACK: Mode = { pop: 'back', requeue: false }
const REQUEUE: Mode = { pop: 'front', requeue: true }

/** A task: `poll` gets its own waker and says whether it finished. */
type Task = (wake: () => void) => 'pending' | 'ready'

/** `run` of `executor.rs`'s contract: pop, skip a task with no future, poll, drop on Ready. Returns the poll log (1-based task ids). */
function runModel(tasks: readonly Task[], mode: Mode): number[] {
  const queue = tasks.map((_, i) => i)
  const done = new Set<number>()
  const log: number[] = []
  while (queue.length > 0) {
    const i = mode.pop === 'front' ? (queue.shift() as number) : (queue.pop() as number)
    if (done.has(i)) continue
    log.push(i + 1)
    const r = tasks[i](() => queue.push(i))
    if (r === 'ready') done.add(i)
    else if (mode.requeue) queue.push(i)
  }
  return log
}

/** YieldN in lib.rs: Pending `n` times, waking itself each time, then Ready. */
const yieldN = (n: number): Task => {
  let left = n
  return (wake) => {
    if (left === 0) return 'ready'
    left--
    wake()
    return 'pending'
  }
}

/** `pending_repoll`'s second part in lib.rs: a task parks on a gate (no self-wake) and another yields 3 times, opens it and wakes it. */
function gateRun(mode: Mode): { waits: number; total: number } {
  const gate = { open: false, waiter: null as null | (() => void) }
  let waits = 0
  const wait: Task = (wake) => {
    waits++
    if (gate.open) return 'ready'
    gate.waiter = wake
    return 'pending'
  }
  let remaining = 3
  const opener: Task = (wake) => {
    if (remaining === 0) {
      gate.open = true
      const w = gate.waiter
      gate.waiter = null
      w?.()
      return 'ready'
    }
    remaining--
    wake()
    return 'pending'
  }
  const log = runModel([wait, opener], mode)
  return { waits, total: log.length }
}

/* ---------------------------------------------- the bundle ---------------------------------------------- */

describe('the bundle', () => {
  test('is found by the registry, named for its directory, and faded to R2', async () => {
    expect(await forgeBundleIds()).toContain('toy-executor')
    expect(await findForgeBundle('toy-executor')).toBe(bundle)
    expect(bundle.labId).toBe('toy-executor')
    expect(LAB_ID).toBe('toy-executor')
    expect(PROVE_LAB_ID).toBe('toy-executor')
    expect(bundle.fade).toBe('r2')
    expect(bundle.discussionsLabel).toBe('[lab 05]')
    expect(DISCUSSIONS_LABEL).toBe('[lab 05]')
  })

  test('has no prove2 (its bridge answers probe only, §7.2) and no walkthrough', () => {
    expect(bundle.prove2).toBeUndefined()
    expect(bundle.walkthrough).toBeUndefined()
    expect(LIB_RS).toContain('(Some("probe"), Some(Ok(seed)))')
    expect(LIB_RS).not.toMatch(/Some\("(?!probe)[a-z_]+"\)/)
  })

  test('PRIMM has 2 predict (an estimate and a choice), 3 investigate and 1 modify item, and its steps are the five', () => {
    const count = (step: string) => PRIMM_ITEMS.filter((i) => i.step === step)
    expect(count('predict').map((i) => i.kind).sort()).toEqual(['choice', 'estimate'])
    expect(count('investigate')).toHaveLength(3)
    expect(count('modify')).toHaveLength(1)
    expect(PRIMM_ITEMS).toHaveLength(6)
    expect(bundle.primm.items).toEqual([...PRIMM_ITEMS])
    expect(bundle.primm.steps.map((s) => s.id)).toEqual(['predict', 'run', 'investigate', 'modify', 'make'])
    expect(bundle.primm.steps).toEqual([...PRIMM_STEPS])
    // the Modify step grades a number against a dial's run: the panel only shows a numeric Modify item
    expect(count('modify')[0].kind).not.toBe('choice')
  })

  test('six Prove-it v1 questions with distinct ids, three ideas each', () => {
    expect(bundle.prove).toEqual([...PROVE_QUESTIONS])
    expect(PROVE_QUESTIONS).toHaveLength(6)
    expect(new Set(PROVE_QUESTIONS.map((q) => q.id)).size).toBe(6)
    for (const q of PROVE_QUESTIONS) {
      expect(q.ideas).toHaveLength(3)
      expect(new Set(q.ideas).size).toBe(3)
      expect(q.prompt.length).toBeGreaterThan(30)
      expect(q.model.length).toBeGreaterThan(150)
      expect(q.kcs.length).toBeGreaterThan(0)
    }
  })
})

describe('stages: labs.ts, executor.rs and the crate agree', () => {
  test('four stages, numbered as the required checks are', () => {
    expect(bundle.stages).toEqual([...STAGES])
    expect(STAGES.map((s) => s.n)).toEqual([1, 2, 3, 4])
    for (const s of STAGES) expect(s.minutes).toBeLessThanOrEqual(25)
    expect(STAGES[0].minutes).toBe(2)
    expect([...new Set(required.map((c) => c.stage))].sort()).toEqual([1, 2, 3, 4])
  })

  test('executor.rs carries a STAGE marker for every stage', () => {
    for (const s of STAGES) expect(EXECUTOR_RS).toContain(`STAGE ${s.n}`)
  })

  test('the stage rows go green with the checks of each stage', () => {
    const none = stageRows(STAGES, lab.checks, new Set())
    expect(none.map((r) => r.checks.map((c) => c.id))).toEqual([['block_on'], ['fifo_poll', 'pending_repoll'], ['ping_pong', 'nested_spawn'], ['many_tasks']])
    const one = stageRows(STAGES, lab.checks, new Set(['block_on']))
    expect(one.map((r) => r.green)).toEqual([true, false, false, false])
    const html = renderToStaticMarkup(createElement(StagePanel, { bundle, checks: lab.checks, passed: new Set(['block_on']) }))
    expect(html).toContain('Queue and loop')
    expect(html).toContain('Order and count')
  })
})

/* ------------------------------------------ the reference run ------------------------------------------ */

describe('the reference run is the committed seed-7 probe, one frame per poll round', () => {
  const probe = parseProbe(SEED7_REPLY)
  if (probe === undefined) throw new Error('SEED7_REPLY is not a probe line')

  test('the line is the one calibration.json committed, for seed 7', () => {
    expect(CALIBRATION.probe.seed).toBe(PROBE_SEED)
    expect(CALIBRATION.probe.reply).toBe(SEED7_REPLY)
    expect(probe).toEqual({ tasks: 10, yields: 25, polls: 35, modelPolls: 35, firstPolls: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2] })
    expect(parseProbe('nonsense')).toBeUndefined()
    expect(parseProbe('tasks=1 yields=0 polls=1 model_polls=1 first_polls=')).toEqual({ tasks: 1, yields: 0, polls: 1, modelPolls: 1, firstPolls: [] })
  })

  test('the harness generator redraws the line’s tasks, yields and first polls', () => {
    const yields = probeYields()
    expect(yields).toEqual([2, 2, 1, 4, 1, 2, 4, 1, 4, 4])
    expect(yields).toHaveLength(probe.tasks)
    expect(yields.reduce((a, b) => a + b, 0)).toBe(probe.yields)
    const log = pollRounds(yields).flatMap((r) => r.polled)
    expect(log).toHaveLength(probe.polls)
    expect(log).toHaveLength(probe.modelPolls)
    expect(log.slice(0, probe.firstPolls.length)).toEqual(probe.firstPolls)
    // the probe draws its task count with range(6, 12) and one below(5) per task, as lib.rs's probe does
    expect(LIB_RS).toContain('let n = rng.range(6, 12);')
    expect(LIB_RS).toContain('(0..n).map(|_| rng.below(5) as u32).collect()')
  })

  test('pollRounds is a FIFO queue cut at the round borders (the model in lib.rs and the model of this file agree)', () => {
    const yields = probeYields()
    const rounds = pollRounds(yields)
    expect(rounds.map((r) => r.polled.length)).toEqual([10, 10, 7, 4, 4])
    expect(rounds.map((r) => r.finished)).toEqual([[], [3, 5, 8], [1, 2, 6], [], [4, 7, 9, 10]])
    expect(rounds.flatMap((r) => r.polled)).toEqual(runModel(yields.map(yieldN), FIFO))
    expect(pollRounds([])).toEqual([])
  })

  test('the spec: more than one frame, and one frame per round with the polls so far', () => {
    const run = RUN_SPEC.run(RUN_SPEC.reference)
    expect(RUN_SPEC.reference).toEqual(REFERENCE)
    expect(run.frames).toHaveLength(5)
    expect(run.frames.length).toBeGreaterThan(1)
    expect(run.frames.map((f) => f.op)).toEqual([10, 20, 27, 31, 35])
    expect(run.frames.map((f) => f.stats.find((s) => s.label === 'tasks finished')?.value)).toEqual(['0 of 10', '3 of 10', '6 of 10', '6 of 10', '10 of 10'])
    expect(run.frames.every((f) => f.cells.length === 10)).toBe(true)
    expect(run.frames[0].cells.every((c) => c === 30)).toBe(true)
    expect(run.frames[4].cells.every((c) => c === 100)).toBe(true)
    expect(run.total).toBe(35)
    expect(run.value).toBe(probe.polls)
    expect(run.truth).toBe(probe.modelPolls)
    expect(run.clean).toBe(true)
    expect(run.summary).toContain('10 tasks that yield 25 times in all take 35 polls in 5 rounds')
    for (const f of run.frames) expect(f.alt).toMatch(/^After round \d of 5: \d+ polls so far, \d+ of 10 tasks finished and \d+ queued for the next round\./)
    expect(RUN_SPEC.run(RUN_SPEC.reference)).toEqual(run)
  })

  test('it is titled as the reference on seed 7, labelled a replay and not a check', () => {
    expect(RUN_SPEC.title(RUN_SPEC.reference)).toBe('The reference on seed 7: 10 tasks, 25 yields')
    expect(RUN_SPEC.disclaimer).toContain(SEED7_REPLY)
    expect(RUN_SPEC.disclaimer).toContain('It is not a check')
    expect(RUN_SPEC.baseline).toBeUndefined()
    expect(RUN_SPEC.item).toEqual(RUN_ITEM)
    expect(RUN_ITEM.id).toBe('lab05.primm.r1')
  })

  test('the Modify dials change the poll count as the explain says: 45, 15 and 35', () => {
    const dials = RUN_SPEC.modify?.dials ?? []
    expect(dials.map((d) => d.id)).toEqual(['more1', 'first5', 'reverse'])
    const polls = Object.fromEntries(dials.map((d) => [d.id, RUN_SPEC.run(d.config).value]))
    expect(polls).toEqual({ more1: 45, first5: 15, reverse: 35 })
    for (const d of dials) {
      const r = RUN_SPEC.run(d.config)
      expect(r.frames.length).toBeGreaterThan(1)
      expect(r.clean).toBe(true)
      expect(r.value).toBe(r.truth)
      expect(RUN_SPEC.title(d.config)).toContain('changed')
    }
    expect(RUN_SPEC.modify?.lead).toContain('35 polls')
    // polls are tasks plus yields, whatever the order
    expect(yieldsOf({ tasks: 10, more: 0, reverse: true })).toEqual([...probeYields()].reverse())
    expect(yieldsOf({ tasks: 5, more: 0, reverse: false })).toEqual([2, 2, 1, 4, 1])
    // a config the page did not offer is clamped, not trusted
    expect(yieldsOf({ tasks: 99, more: -3, reverse: false })).toEqual(probeYields())
    expect(yieldsOf({ tasks: Number.NaN, more: 'x', reverse: false })).toEqual(probeYields())
    expect(yieldsOf({ tasks: 0, more: 0, reverse: false })).toHaveLength(1)
  })

  test('the Run step’s observation carries the poll count and the model’s count', () => {
    const r = observationResponse(RUN_ITEM, RUN_SPEC.run(RUN_SPEC.reference))
    expect(r.ref).toBe('item:lab05.primm.r1')
    expect(r.data).toMatchObject({ value: 35, truth: 35 })
  })
})

/* ---------------------------------------------- the items ---------------------------------------------- */

describe('items: ids, refs, tags, whys', () => {
  test('ids are item:lab05.primm.* and unique', () => {
    const ids = PRIMM_ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of [...ids, RUN_ITEM.id]) {
      expect(id.startsWith('lab05.primm.')).toBe(true)
      expect(refMatchesKind('item', primmRef(id))).toBe(true)
    }
  })

  test('every item is tagged with a KC of this lab and a nominal time', () => {
    const own = new Set(lab.checks.flatMap((c) => c.kcs ?? []))
    expect([...own].sort()).toEqual(['t3.futures-state-machines', 't3.wakers-executor'])
    for (const i of PRIMM_ITEMS) {
      const kcs = i.kind === 'choice' ? i.item.kcs : i.kcs
      expect(kcs.length).toBeGreaterThan(0)
      for (const k of kcs) {
        expect(kcById(k)?.id).toBe(k)
        expect(own.has(k)).toBe(true)
      }
      expect(i.nsec).toBeGreaterThan(0)
    }
  })

  test('every multiple-choice item has four distinct options, one key and a why for each', () => {
    expect(PRIMM_MC_ITEMS).toHaveLength(3)
    expect(PRIMM_MC_ITEMS).toEqual(bundle.primm.items.flatMap((i) => (i.kind === 'choice' ? [i.item] : [])))
    for (const { id, q } of PRIMM_MC_ITEMS) {
      expect(id.startsWith('lab05.primm.')).toBe(true)
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      expect(q.correct).toHaveLength(1)
      expect(q.why).toHaveLength(4)
      for (const w of q.why ?? []) expect(w.trim().length).toBeGreaterThan(40)
      expect(q.explanation?.length).toBeGreaterThan(20)
      expect(q.kcs?.length).toBeGreaterThan(0)
    }
  })

  test('no key is the only odd option out, and none is strictly the longest (the pool-level rates are verify-items’ gate, once the labs are merged)', () => {
    // Three items cannot be judged by a rate: `verify:items -- --subset 'forge/toy-executor '` reports them and the merged pool decides.
    for (const { q } of PRIMM_MC_ITEMS) {
      expect(oddOneOut(q)).toEqual([])
      const lens = q.options.map((o) => o.trim().length)
      const longest = Math.max(...lens)
      expect(lens[q.correct[0]] < longest || lens.filter((l) => l === longest).length > 1).toBe(true)
    }
  })

  test('each numeric item names its lures, and no lure is the truth', () => {
    for (const i of PRIMM_ITEMS) {
      if (i.kind !== 'numeric') continue
      expect(i.truth).toBeDefined()
      expect(i.lures?.length).toBeGreaterThanOrEqual(3)
      for (const l of i.lures ?? []) {
        expect(l.value).not.toBe(i.truth)
        expect(l.message.length).toBeGreaterThan(40)
        expect(l.miss).toMatch(/^exec\./)
      }
    }
  })
})

describe('the answers are true of the executor', () => {
  const item = (id: string) => {
    const i = PRIMM_ITEMS.find((x) => x.id === `lab05.primm.${id}`)
    if (i === undefined) throw new Error(`no item ${id}`)
    return i
  }
  const key = (id: string) => {
    const i = item(id)
    if (i.kind !== 'choice') throw new Error(`${id} is not a choice`)
    return i.item.q.options[i.item.q.correct[0]]
  }
  /** Poll order of `yields` under a mode, as the fifo_poll check compares it. */
  const orderOf = (yields: readonly number[], mode: Mode) => runModel(yields.map(yieldN), mode)

  test('p1: polls are the tasks plus the yields: 35 for the committed line, 3000 for many_tasks', () => {
    const p1 = item('p1') as NumberPrimm
    expect(p1.kind).toBe('estimate')
    const truth = RUN_SPEC.run(RUN_SPEC.reference).value
    expect(truth).toBe(10 + 25)
    expect(gradeNumber(p1, 35, truth).ok).toBe(true)
    // forgetting each task's last poll gives 25; that is outside the item's factor
    expect(gradeNumber(p1, 25, truth).ok).toBe(false)
    expect(p1.prompt).toContain('10 tasks')
    expect(p1.prompt).toContain('25 times')
    // many_tasks: 200 each of 0 to 4 yields
    const many = Array.from({ length: 1000 }, (_, i) => Math.floor(i / 200))
    expect(orderOf(many, FIFO)).toHaveLength(3000)
    expect(p1.explain).toContain('3,000')
    expect(LIB_RS).toContain('(0..1000).map(|i| (i / 200) as u32)')
  })

  test('p2: a stack makes the same number of polls in another order, and parks the waiter late (fifo_poll and pending_repoll red; many_tasks green)', () => {
    const yields = [2, 3, 3, 3, 3, 1, 2, 1] // the crate's own default-seed run of fifo_poll
    expect(orderOf(yields, STACK)).not.toEqual(orderOf(yields, FIFO))
    expect(orderOf(yields, STACK)).toHaveLength(orderOf(yields, FIFO).length)
    expect(gateRun(FIFO)).toEqual({ waits: 2, total: 6 })
    expect(gateRun(STACK).waits).toBe(1)
    const many = Array.from({ length: 1000 }, (_, i) => Math.floor(i / 200))
    expect(orderOf(many, STACK)).toHaveLength(3000)
    // block_on has one task: the order cannot differ
    expect(orderOf([1], STACK)).toEqual(orderOf([1], FIFO))
    expect(CALIBRATION.mutants.lifo.caughtBy).toEqual(['fifo_poll', 'pending_repoll'])
    expect(key('p2')).toContain('`fifo_poll` and `pending_repoll`')
    expect(key('p2')).not.toContain('block_on')
  })

  test('i1: the parked task is polled twice by a correct executor; one poll is a stack, four a re-queueing loop', () => {
    const i1 = item('i1') as NumberPrimm
    const fifo = gateRun(FIFO)
    expect(fifo.waits).toBe(i1.truth)
    expect(fifo.total).toBe(6)
    const lures = Object.fromEntries((i1.lures ?? []).map((l) => [l.miss, l.value]))
    expect(gateRun(STACK).waits).toBe(lures['exec.wake-dropped'])
    expect(gateRun(REQUEUE).waits).toBe(lures['exec.requeue-pending'])
    // 3 is the opener's yields
    expect(lures['exec.counted-opener']).toBe(3)
    expect(i1.explain).toContain('6')
    expect(gradeNumber(i1, 4, 2).miss).toBe('exec.requeue-pending')
    expect(LIB_RS).toContain('waits.get() != 2')
    expect(LIB_RS).toContain('total != 6')
    expect(LIB_RS).toContain('OpenAfter { remaining: 3')
  })

  test('i2: a guard held through the loop body panics at the first wake, which is block_on’s second future', () => {
    expect(EXECUTOR_RS).toContain('while let Some(t) = queue.borrow_mut().pop_front()')
    expect(EXECUTOR_RS.replace(/\s*\n\/\/!\s*/g, ' ')).toContain('holds the RefMut for the whole loop body')
    // block_on's second future is YieldN, which wakes itself inside poll; wake_task borrows the queue mutably
    expect(LIB_RS).toContain('YieldN { remaining: 1, polls: Rc::clone(&polls), on_ready: None }.await')
    expect(LIB_RS).toContain('cx.waker().wake_by_ref();')
    expect(LIB_RS).toContain('self.queue.inner.borrow_mut().push_back(Rc::clone(self));')
    expect(CALIBRATION.mutants.borrow_held.caughtBy).toEqual(['block_on', 'fifo_poll', 'pending_repoll', 'ping_pong', 'many_tasks', 'nested_spawn'])
    expect(required[0].id).toBe('block_on')
    expect(key('i2')).toContain('`block_on`')
  })

  test('i3: a loop over a copy never runs what a poll spawned (nested_spawn reports 0 children)', () => {
    expect(CALIBRATION.mutants.one_pass.caughtBy).toContain('nested_spawn')
    expect(LIB_RS).toContain('spawn inside poll must grow the live queue')
    expect(LIB_RS).toContain('{} of {kids} children and {} of {grand} grandchildren ran')
    expect(key('i3')).toContain('none of them ran')
  })

  test('m1: the Modify item is graded against each dial’s run', () => {
    const m1 = item('m1') as NumberPrimm
    expect(m1.step).toBe('modify')
    expect(m1.kind).toBe('estimate')
    for (const d of RUN_SPEC.modify?.dials ?? []) {
      const run = RUN_SPEC.run(d.config)
      expect(gradeNumber(m1, run.value, run.value).ok).toBe(true)
    }
    expect(gradeNumber(m1, 35, RUN_SPEC.run({ tasks: 10, more: 1, reverse: false }).value).ok).toBe(false)
    for (const n of ['45', '15', '35']) expect(m1.explain).toContain(`(${n})`)
  })

  test('grading a choice gives the picked option’s why, then the key’s', () => {
    for (const i of PRIMM_ITEMS) {
      if (i.kind !== 'choice') continue
      const key = i.item.q.correct[0]
      expect(gradeChoice(i, key).ok).toBe(true)
      const wrong = [0, 1, 2, 3].find((n) => n !== key) as number
      const g = gradeChoice(i, wrong)
      expect(g.ok).toBe(false)
      expect(g.feedback).toContain(i.item.q.why?.[key] ?? '')
    }
  })
})

/* ---------------------------------------------- the ladder ---------------------------------------------- */

describe('the ladder: R0 to R2 for every required check, then the packet', () => {
  test('one entry per required check, in the order the module lists them, and none for an optional one', () => {
    expect([...LADDER_CHECK_IDS]).toEqual(required.map((c) => c.id))
    expect(bundle.ladder.map((l) => l.checkId)).toEqual([...LADDER_CHECK_IDS])
    expect(Object.keys(LADDER).sort()).toEqual([...LADDER_CHECK_IDS].sort())
  })

  test('there is no R3 or R4, and R2 names a function that exists in lib.rs and the check it is for', () => {
    for (const l of bundle.ladder) {
      expect('r3' in l).toBe(false)
      expect('r4' in l).toBe(false)
      expect(l.r2.fn).toBe(`check_${l.checkId}`)
      expect(LIB_RS).toMatch(new RegExp(`pub fn ${l.r2.fn}\\(`))
      expect(l.r2.text).toContain('lib.rs')
      expect(l.r2.text).toContain(l.r2.fn)
      expect(l.r0.ideas).toHaveLength(3)
    }
  })

  test('R1 links to an H2 that exists in the host lesson or the readiness lesson', () => {
    for (const l of bundle.ladder) {
      expect(h2s.get(l.r1.link.lessonId)?.has(l.r1.link.anchor)).toBe(true)
      expect(['t3.l4', 'r.l8']).toContain(l.r1.link.lessonId)
    }
  })

  test('only nested_spawn’s R1 leaves the host lesson: t3.l4 never teaches a borrow’s scope, and r.l8 is the lab’s readiness', () => {
    expect(bundle.ladder.filter((l) => l.r1.link.lessonId !== lab?.lessonId).map((l) => l.checkId)).toEqual(['nested_spawn'])
    expect(LADDER.nested_spawn.r1.link).toMatchObject({ lessonId: 'r.l8', anchor: 'make-the-guard-shorter' })
    expect(lab?.readiness?.lessonIds).toContain('r.l8')
    const host = JSON.stringify(ALL_LESSONS.find((l) => l.id === lab?.lessonId)?.blocks)
    expect(host).not.toMatch(/RefCell|borrow/)
  })

  test('passes lint-mentor as a faded bundle, and would fail as a whole one (R3 and R4 missing)', () => {
    const deps = { required: required.map((c) => c.id), libRs: LIB_RS, h2s }
    expect(lintBundle(bundle, deps)).toEqual([])
    const asWhole = lintBundle({ ...bundle, fade: undefined }, deps)
    expect(asWhole.length).toBe(required.length * 2)
    expect(asWhole.every((p) => /R[34] is missing/.test(p))).toBe(true)
  })

  test('the facts the rungs state are the check’s own', () => {
    expect(LIB_RS).toContain('YieldN { remaining: 3,')
    expect(LIB_RS).toContain('polls.get() != 4')
    expect(LIB_RS).toContain('rng.range(3, 8)')
    expect(LIB_RS).toContain('rng.below(4)')
    expect(LIB_RS).toContain('target: 100')
    expect(LIB_RS).toContain('want_polls')
    expect(LIB_RS).toContain('done.get() != 1000')
    expect(LIB_RS).toContain('let kids = rng.range(3, 8);')
    // 200 each of 0 to 4 yields: 2000 yields and 1000 finishing polls
    expect(200 * (0 + 1 + 2 + 3 + 4) + 1000).toBe(3000)
    expect(LADDER.many_tasks.r0.ideas.join(' ')).toContain('2000 yields plus 1000 tasks')
  })

  test('renders R0 first, offers R1 and R2, and ends at R2 with no bottom-out', () => {
    const acks = (rungs: ('R0' | 'R1' | 'R2')[]) => Object.fromEntries(rungs.map((r) => [hintRef('fifo_poll', r, LAB_ID), ISO]))
    const html = (rungs: ('R0' | 'R1' | 'R2')[]) =>
      renderToStaticMarkup(
        createElement(MemoryRouter, null, createElement(HintLadderView, { bundle, reports: [report([row('fifo_poll', 'fail', { msg: 'poll order [8, 8, 7]' })])], acks: acks(rungs), onAck: () => {}, now: () => 0 })),
      )
    const early = html(['R0'])
    expect(early).toContain('R0 · say it first')
    expect(early).toContain('Open R1')
    for (const gone of ['R3', 'R4', 'Show the walkthrough', 'Bottom-out']) expect(early).not.toContain(gone)
    const late = html(['R0', 'R1', 'R2'])
    expect(late).toContain(LADDER.fifo_poll.r2.text)
    expect(late).not.toMatch(/Open R\d/)
    expect(late).not.toContain('data-walkthrough')
  })
})

/* ------------------------------------------ the panels, rendered ------------------------------------------ */

describe('the generic panels render lab 05', () => {
  const panel = (initial: 'predict' | 'run' | 'investigate' | 'modify' | 'make') =>
    renderToStaticMarkup(createElement(PrimmPanel, { bundle, checks: lab.checks, passed: new Set<string>(), initial, title: lab.title }))

  test('Predict names the lab and shows the estimate and the choice', () => {
    const html = panel('predict')
    expect(html).toContain(`aria-label="${lab.title}, in five steps"`)
    expect(html).toContain('data-item="lab05.primm.p1"')
    expect(html).toContain('data-item="lab05.primm.p2"')
    expect(html).toContain('10 tasks')
  })

  test('Investigate shows its three items, and Modify the three dials, its lead and its prompt', () => {
    const inv = panel('investigate')
    for (const id of ['i1', 'i2', 'i3']) expect(inv).toContain(`data-item="lab05.primm.${id}"`)
    const mod = panel('modify')
    expect(mod).toContain('Change one thing about the reference run (seed 7: 10 tasks, 25 yields, 35 polls).')
    for (const d of RUN_SPEC.modify?.dials ?? []) expect(mod).toContain(d.label)
    expect(mod).toContain('How many polls does your changed run make?')
    expect(mod).not.toContain('no Modify question')
  })

  test('the reference run is titled, labelled a replay, and starts on the first round', () => {
    const html = renderToStaticMarkup(createElement(ReferenceRun, { bundle, config: RUN_SPEC.reference }))
    expect(html).toContain('The reference on seed 7: 10 tasks, 25 yields')
    expect(html).toContain('data-reference-run="toy-executor"')
    expect(html).toContain('op 10 / 35')
    expect(html).toContain('After round 1 of 5: 10 polls so far')
    expect(html).toContain('It is not a check')
  })

  test('Prove it shows three of the lab’s six questions and no other lab’s', () => {
    const html = renderToString(createElement(ProveIt, { bundle, history: [], now: 0, seed: 4 })).replaceAll('<!-- -->', '')
    expect(html).toContain('data-prove="active"')
    const qids = [...html.matchAll(/data-qid="([a-z-]+)"/g)].map((m) => m[1])
    expect(qids.length).toBeGreaterThan(0)
    for (const q of qids) expect(PROVE_QUESTIONS.map((p) => p.id)).toContain(q)
    expect(html).not.toContain('allocator')
  })
})

/* ------------------------------------------------ Prove it v1 ------------------------------------------------ */

describe('Prove it v1', () => {
  const q = (id: string) => PROVE_QUESTIONS.find((p) => p.id === id)?.model ?? ''

  test('the model answers state what the lab’s code and checks do', () => {
    expect(q('stale-wake')).toContain('`None`')
    expect(EXECUTOR_RS).toContain('A popped task whose future is')
    expect(q('borrow-scope')).toContain('already borrowed')
    expect(q('poll-count')).toContain('200 × (0 + 1 + 2 + 3 + 4) = 2000')
    expect(q('poll-count')).toContain('2000 + 1000 = 3000')
    expect(q('block-on-output')).toContain('Rc<RefCell<Option<Output>>>')
    expect(EXECUTOR_RS).toContain('Rc<RefCell<Option<Output>>>')
    expect(q('take-poll-restore')).toContain('make_waker(&task)')
    expect(LIB_RS).toContain('pub fn make_waker(task: &Rc<Task>) -> Waker')
    expect(q('who-requeues')).toContain('wake_task')
    expect(LIB_RS).toContain('pub fn wake_task(self: &Rc<Task>)')
  })

  test('the draw takes three of the lab’s questions, and the second attempt gets exactly the other three', () => {
    const first = pickQuestions([], 3, bundle.prove)
    expect(first).toHaveLength(3)
    for (const p of first) expect(PROVE_QUESTIONS).toContain(p)
    const second = pickQuestions([{ at: ISO, qids: first.map((p) => p.id) }], 3, bundle.prove)
    expect(second).toHaveLength(3)
    expect(new Set([...first, ...second].map((p) => p.id)).size).toBe(6)
  })

  test('the 30-day follow-up is a lab 05 item ref the ledger accepts, and Today’s lookup agrees', () => {
    for (const p of PROVE_QUESTIONS) {
      expect(followUpRef(p.id)).toBe(`item:lab05.prove.${p.id}`)
      expect(followUpRefFor('toy-executor', p.id)).toBe(followUpRef(p.id))
      expect(refMatchesKind('item', followUpRef(p.id))).toBe(true)
    }
  })
})
