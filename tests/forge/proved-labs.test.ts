/**
 * The `proved` exit gate (docs/specs/wave-3.md §18.1 B3, task 3c-01): labs 02, 04, 06 and 07 write provenance `proved`
 * after an unseen-seed green and a right answer, and never after a miss, a v1 answer, a reference build or a module that
 * was graded on practice seeds. The exit asks for three labs; four are live (D5), and labs 01, 03, 05 and 08 keep v1.
 *
 * Each case drives the same path ForgeLab and ProveFromModule take, on the lab's own shipped templates, with a fake
 * module in place of the learner's wasm (no private solution is committed): the run's report goes through `creditFor`
 * and `recordLabRun` (the `lab-check` event that names the module), the question is drawn with `pickTemplate` and
 * `planQuestion` from the ledger's own history (`attemptsOf`), `proveFromModule` runs the calls and grades the answer,
 * and `recordProve` writes the event. What is asserted is read back from the ledger (the stored events, the aggregate's
 * `proved`), so a gate that only the helper enforced would not pass. The fakes are this file's own line-protocol
 * modules over each bridge's verbs; the lab tests (prove2-lab02, mpmc-queue, batching-scheduler, radix-cache) check the
 * templates against richer fakes with the named bugs.
 */
import { describe, expect, test } from 'bun:test'
import { FORGE_LABS } from '../../src/data/labs'
import { loadForgeBundle } from '../../src/data/forge'
import type { ProveV2Template } from '../../src/data/forge/types'
import { creditFor, toLabRun } from '../../src/lib/forge/run'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import {
  attemptsOf,
  eligibility,
  pickTemplate,
  planQuestion,
  proveFromModule,
  type Prove2Plan,
  type ProveEventLike,
} from '../../src/lib/forge/prove2'
import { RETRY_AFTER_MS, buildProveResult } from '../../src/lib/forge/prove'
import { sha256Hex } from '../../src/lib/ledger/stable'
import type { LedgerEvent, ProveDataV2, ProveResult } from '../../src/lib/ledger/types'
import { LabAbiError } from '../../src/lib/wasm-lab'
import { makeProfile, startTab, type Tab } from '../ledger/env'
import { fakeBlockManager, fakeBridge } from './fixtures'

/* ------------------------------------------------------------------ */
/* Fake modules: the bridges' verbs, as plain functions                 */
/* ------------------------------------------------------------------ */

type Handler = (cmd: string) => string
type Make = () => Handler

/** Lab 04's queue: `init <cap>` (rounded up to a power of two), `push <v>`, `pop`; first in, first out. */
function fakeQueue(): Make {
  return () => {
    let cap = 0
    const q: number[] = []
    return (cmd) => {
      const [op, arg] = cmd.trim().split(/\s+/)
      if (op === 'init') {
        cap = 2 ** Math.ceil(Math.log2(Number(arg)))
        q.length = 0
        return 'ok'
      }
      if (op === 'push') return q.length >= cap ? 'full' : (q.push(Number(arg)), 'ok')
      if (op === 'pop') return q.length === 0 ? 'empty' : String(q.shift())
      return `err unknown command '${cmd.slice(0, 20)}'`
    }
  }
}

/**
 * Lab 06's `schedule` entry: a header (`schedule iter maxRunning memCap used`), then `W id arrival prompt` and
 * `R id arrival prompt decoded _` lines; the reply is `admit <ids>` and `preempt <ids>`. Aged requests go first, then
 * smallest prompt; a request that does not fit (about 48 tokens of headroom per sequence) is skipped.
 */
function fakeScheduler(): Make {
  return () => (cmd) => {
    const lines = cmd.split('\n').map((l) => l.trim().split(/\s+/))
    if (lines[0][0] === 'init') return 'ok'
    const [, iter, maxRunning, memCap] = lines[0].map(Number)
    const running = lines.filter((l) => l[0] === 'R')
    const waiting = lines
      .filter((l) => l[0] === 'W')
      .map((l) => ({ id: Number(l[1]), arrival: Number(l[2]), prompt: Number(l[3]) }))
      .sort((a, b) => {
        const aged = (iter - b.arrival >= 2500 ? 1 : 0) - (iter - a.arrival >= 2500 ? 1 : 0)
        return aged || (iter - a.arrival >= 2500 ? a.arrival - b.arrival : a.prompt - b.prompt || a.id - b.id)
      })
    let used = running.reduce((n, l) => n + Number(l[3]) + Number(l[4]), 0)
    let count = running.length
    const admit: number[] = []
    for (const w of waiting) {
      if (count >= maxRunning) break
      if (used + w.prompt + 48 * count > memCap) continue
      admit.push(w.id)
      used += w.prompt
      count += 1
    }
    return `admit ${admit.join(',')}\npreempt `
  }
}

/** Lab 07's router bridge: `reset`, `insert <ids>` (replies `ok <n>`) and `match <ids>` (the longest cached prefix). */
function fakeRadix(): Make {
  return () => {
    let cached: number[][] = []
    const ids = (arg: string | undefined) => (arg ?? '').split(',').filter((s) => s !== '').map(Number)
    return (cmd) => {
      const [op, arg] = cmd.trim().split(/\s+/)
      if (op === 'reset') {
        cached = []
        return 'ok'
      }
      if (op === 'insert') {
        cached.push(ids(arg))
        return `ok ${ids(arg).length}`
      }
      if (op === 'match') {
        const q = ids(arg)
        return String(Math.max(0, ...cached.map((c) => commonPrefix(c, q))))
      }
      return `err unknown command '${cmd.slice(0, 20)}'`
    }
  }
}

const commonPrefix = (a: readonly number[], b: readonly number[]): number => {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

interface LabCase {
  /** The lab's number, as /forge shows it. */
  n: string
  labId: string
  make: Make
}

/** Lab 02 reuses the fixtures' block manager: its verbs are the bridge's (init, allocate, fork, append, free, translate, free_blocks). */
const CASES: LabCase[] = [
  { n: '02', labId: 'kv-block-manager', make: fakeBlockManager({ lifo: true }) },
  { n: '04', labId: 'mpmc-queue', make: fakeQueue() },
  { n: '06', labId: 'batching-scheduler', make: fakeScheduler() },
  { n: '07', labId: 'radix-cache', make: fakeRadix() },
]

/* ------------------------------------------------------------------ */
/* The path a learner takes                                             */
/* ------------------------------------------------------------------ */

const lab = (id: string) => FORGE_LABS.find((l) => l.id === id)!
const required = (id: string) => lab(id).checks.filter((c) => !c.optional).map((c) => c.id)
const row = (id: string): CheckResult => ({ id, label: id, status: 'pass', msg: '' })

/** A v2 run report with every required check passed; `seeds: 'fresh'` is an unseen-seed green, `'default'` a practice-seed one. */
function report(labId: string, opts: { seeds?: 'fresh' | 'default'; reference?: boolean } = {}): LabRunReport {
  return { lab: labId, reference: opts.reference ?? false, abi: 2, version: 3, checks: required(labId).map(row), seeds: opts.seeds ?? 'fresh', ms: 40 }
}

/** A module's bytes; the content only has to differ between modules (the fakes never read them). */
const moduleBytes = (tag: number): ArrayBuffer => new Uint8Array([0, 0x61, 0x73, 0x6d, tag, tag, tag, tag]).buffer

interface Session {
  tab: Tab
  labId: string
  templates: readonly ProveV2Template[]
  fake: ReturnType<typeof fakeBridge>
  /** Epoch ms of the profile's clock. */
  now(): number
  advance(minutes: number): void
  /** The lab run a learner just made: writes its `lab-check` the way ForgeLab does (nothing for a reference build). Returns the credit. */
  run(bytes: ArrayBuffer, rep: LabRunReport): Promise<ReturnType<typeof creditFor>>
  events(kind: 'prove' | 'lab-check'): Promise<LedgerEvent[]>
  /** The whole path for one question; `answer` gets the module's own reply read, and returns what to type. */
  ask(opts: {
    bytes: ArrayBuffer
    graded: { sha256: string; credit: 'unseen' | 'lab-green' | 'assisted' } | null
    seed: number
    answer: (right: number | number[], plan: Prove2Plan) => number | number[]
    template?: ProveV2Template
    run?: (bytes: ArrayBuffer, calls: string[]) => Promise<string[]>
  }): Promise<{ result: ProveResult; right: number | number[]; template: ProveV2Template } | { refused: string }>
}

async function session(c: LabCase): Promise<Session> {
  const bundle = await loadForgeBundle(c.labId)
  const templates = bundle.prove2?.templates ?? []
  const p = makeProfile()
  const tab = startTab(p)
  const fake = fakeBridge(c.make)
  const events = async (kind: 'prove' | 'lab-check'): Promise<LedgerEvent[]> => {
    await tab.progress.controls.flush()
    return (await tab.engine()).events({ kinds: [kind] })
  }
  const s: Session = {
    tab,
    labId: c.labId,
    templates,
    fake,
    now: () => p.clock.ms,
    advance: (m) => p.clock.advance(m),
    async run(bytes, rep) {
      const earlier = tab.progress.getState().aggregate.labs[c.labId]
      const credit = creditFor(rep, { unseen: earlier?.unseen }, required(c.labId))
      // a reference build is shown and never written (ForgeLab, spec §12.3)
      if (credit !== null) tab.progress.getState().recordLabRun(toLabRun(rep, credit, required(c.labId), { wasmSha256: await sha256Hex(bytes) }))
      return credit
    },
    events,
    async ask(o) {
      const history = attemptsOf([...(await events('lab-check')), ...(await events('prove'))] as unknown as ProveEventLike[], c.labId)
      const template = o.template ?? pickTemplate(templates, history)
      const plan = planQuestion(template, o.seed)
      const right = template.read(await fake.run(o.bytes, plan.calls))
      const out = await proveFromModule({
        labId: c.labId,
        template,
        plan,
        answer: o.answer(right, plan),
        bytes: o.bytes,
        graded: o.graded,
        history,
        now: p.clock.ms,
        run: o.run ?? fake.run,
      })
      if (out.kind === 'refused') return { refused: out.message }
      tab.progress.getState().recordProve(out.result)
      return { result: out.result, right, template }
    },
  }
  return s
}

const rightAnswer = (right: number | number[]) => right
/** An answer that is certainly not the module's: a number one off, or the ids with an id no request has. */
const wrongAnswer = (right: number | number[]) => (typeof right === 'number' ? right + 1 : [...right, 99])

const SEEDS = [0x5eed01, 0x5eed02, 0x5eed03, 0xc0ffee]

/* ------------------------------------------------------------------ */
/* The gate                                                             */
/* ------------------------------------------------------------------ */

describe('Prove-it v2 is live on labs 02, 04, 06 and 07, and v1 stays on the rest', () => {
  test('exactly those four labs ship templates, and the exit needs three', async () => {
    const live: string[] = []
    for (const l of FORGE_LABS.filter((x) => x.index >= 1 && x.index <= 8 && !x.id.startsWith('rust-zero'))) {
      const b = await loadForgeBundle(l.id).catch(() => null)
      if (b?.prove2 && b.prove2.templates.length > 0) live.push(`${String(l.index).padStart(2, '0')} ${l.id}`)
    }
    expect(live).toEqual(CASES.map((c) => `${c.n} ${c.labId}`))
    expect(live.length).toBeGreaterThanOrEqual(3)
  })
})

describe.each(CASES)('lab $n ($labId)', (c) => {
  test('an unseen-seed green and a right answer write proved, on every template and several seeds', async () => {
    const bundle = await loadForgeBundle(c.labId)
    for (const template of bundle.prove2!.templates) {
      for (const seed of SEEDS) {
        const s = await session(c)
        const bytes = moduleBytes(7)
        const sha = await sha256Hex(bytes)
        // the unseen green: fresh seeds, every required check passed
        expect(await s.run(bytes, report(c.labId))).toBe('unseen')
        s.advance(1)
        const out = await s.ask({ bytes, graded: { sha256: sha, credit: 'unseen' }, seed, answer: rightAnswer, template })
        if ('refused' in out) throw new Error(out.refused)
        expect(out.result.provenance, `${template.id} seed ${seed}`).toBe('proved')
        expect(out.result.ok).toBe(true)
        expect(out.result.wasmSha256).toBe(sha)

        // read back from the ledger: the stored event and the aggregate
        const [event] = (await s.events('prove')) as unknown as Array<{ ref: string; provenance: string; ok: boolean; score: number; wasmSha256: string; seed: number; data: { v: number; qid: string; answer: unknown; actual: unknown } }>
        expect(event).toMatchObject({ ref: `prove:${c.labId}`, provenance: 'proved', ok: true, score: 1, wasmSha256: sha, seed: seed >>> 0 })
        expect(event.data).toMatchObject({ v: 2, qid: template.id })
        expect(event.data.answer).toEqual(event.data.actual)
        const agg = s.tab.progress.getState().aggregate
        expect(agg.proved[c.labId], `${template.id} seed ${seed}`).toBeDefined()
        expect(agg.proves[c.labId]).toBeDefined()
      }
    }
  })

  test('a miss is practice: no proved, no proves, and the 24 h retry opens, after which a right answer is proved', async () => {
    const s = await session(c)
    const bytes = moduleBytes(7)
    const sha = await sha256Hex(bytes)
    const graded = { sha256: sha, credit: 'unseen' as const }
    await s.run(bytes, report(c.labId))
    s.advance(1)
    const miss = await s.ask({ bytes, graded, seed: SEEDS[0], answer: wrongAnswer })
    if ('refused' in miss) throw new Error(miss.refused)
    expect(miss.result).toMatchObject({ ok: false, score: 0, provenance: 'practice' })
    let agg = s.tab.progress.getState().aggregate
    expect(agg.proved[c.labId]).toBeUndefined()
    expect(agg.proves[c.labId]).toBeUndefined()
    const [stored] = (await s.events('prove')) as unknown as Array<{ provenance: string; ok: boolean }>
    expect(stored).toMatchObject({ provenance: 'practice', ok: false })

    // a right answer an hour later is inside the credited miss's wait: practice, and says why
    s.advance(60)
    const history = attemptsOf([...(await s.events('lab-check')), ...(await s.events('prove'))] as unknown as ProveEventLike[], c.labId)
    expect(eligibility({ sha256: sha, credit: 'unseen' }, sha, history, s.now())).toMatchObject({ credited: false, reason: 'retry' })
    const early = await s.ask({ bytes, graded, seed: SEEDS[1], answer: rightAnswer })
    if ('refused' in early) throw new Error(early.refused)
    expect(early.result).toMatchObject({ ok: true, provenance: 'practice' })
    agg = s.tab.progress.getState().aggregate
    expect(agg.proved[c.labId]).toBeUndefined()
    expect(agg.proves[c.labId]).toBeDefined() // the right answer is evidence, and is not proved

    // past the 24 h, a right answer on the module that was graded is proved
    s.advance(RETRY_AFTER_MS / 60_000)
    const late = await s.ask({ bytes, graded, seed: SEEDS[2], answer: rightAnswer })
    if ('refused' in late) throw new Error(late.refused)
    expect(late.result.provenance).toBe('proved')
    expect(s.tab.progress.getState().aggregate.proved[c.labId]).toBeDefined()
  })

  test('a v1 answer is never proved, even when the result claims it', async () => {
    const s = await session(c)
    const bundle = await loadForgeBundle(c.labId)
    const qs = bundle.prove.slice(0, 3)
    const v1 = buildProveResult(qs, qs.map(() => ({ answer: 'x', revealed: true, self: 1 as const })), { labId: c.labId })
    expect(v1).not.toBeNull()
    expect(v1!.data.v).toBe(1)
    const bytes = moduleBytes(7)
    const sha = await sha256Hex(bytes)
    await s.run(bytes, report(c.labId))
    s.tab.progress.getState().recordProve(v1!)
    s.tab.progress.getState().recordProve({ ...v1!, provenance: 'proved', wasmSha256: sha })
    const stored = (await s.events('prove')) as unknown as Array<{ provenance: string }>
    expect(stored.map((e) => e.provenance)).toEqual(['practice', 'practice'])
    const agg = s.tab.progress.getState().aggregate
    expect(agg.proves[c.labId]).toBeDefined() // the v1 attempt still counts as the practice it is
    expect(agg.proved[c.labId]).toBeUndefined()
  })

  test('a v2 result that claims proved without a right answer or a module hash is written as practice', async () => {
    const s = await session(c)
    const bytes = moduleBytes(7)
    const sha = await sha256Hex(bytes)
    await s.run(bytes, report(c.labId))
    s.advance(1)
    const right = await s.ask({ bytes, graded: { sha256: sha, credit: 'unseen' }, seed: SEEDS[0], answer: rightAnswer })
    if ('refused' in right) throw new Error(right.refused)
    const { result } = right
    // forged claims on a fresh profile: a wrong answer marked ok, and a right one with no module named
    const fresh = await session(c)
    const claim = (r: ProveResult) => fresh.tab.progress.getState().recordProve(r)
    const d = result.data as ProveDataV2
    claim({ ...result, ok: true, provenance: 'proved', data: { ...d, answer: wrongAnswer(d.actual as number | number[]) } })
    const { wasmSha256: _sha, ...unnamed } = result
    void _sha
    claim({ ...unnamed, provenance: 'proved' })
    const stored = (await fresh.events('prove')) as unknown as Array<{ provenance: string; ok: boolean }>
    expect(stored.map((e) => e.provenance)).toEqual(['practice', 'practice'])
    expect(stored[0].ok).toBe(false)
    expect(fresh.tab.progress.getState().aggregate.proved[c.labId]).toBeUndefined()
  })

  test('a reference build earns no credit, is never asked, and nothing is written', async () => {
    const s = await session(c)
    const bytes = moduleBytes(9)
    const credit = await s.run(bytes, report(c.labId, { reference: true }))
    expect(credit).toBeNull()
    expect(await s.events('lab-check')).toEqual([]) // ForgeLab writes no lab-check for it, so no module is ever named
    // the panel is not mounted for credit null; and the worker refuses its calls, as runLabCalls does for a `@reference` module
    expect(eligibility(null, await sha256Hex(bytes), [], s.now())).toEqual({ credited: false, reason: 'credit' })
    const refuse = async (): Promise<string[]> => {
      throw new LabAbiError(`this is a reference build (${c.labId}@reference): reference modules earn no credit`)
    }
    const out = await s.ask({ bytes, graded: null, seed: SEEDS[0], answer: rightAnswer, run: refuse })
    expect(out).toMatchObject({ refused: expect.stringContaining('reference') })
    expect(await s.events('prove')).toEqual([])
    const agg = s.tab.progress.getState().aggregate
    expect(agg.proved[c.labId]).toBeUndefined()
    expect(agg.proves[c.labId]).toBeUndefined()
  })

  test('a module graded on practice seeds can answer right and is practice, not proved', async () => {
    const s = await session(c)
    const bytes = moduleBytes(7)
    const sha = await sha256Hex(bytes)
    const credit = await s.run(bytes, report(c.labId, { seeds: 'default' }))
    expect(credit).toBe('lab-green')
    s.advance(1)
    const out = await s.ask({ bytes, graded: { sha256: sha, credit: credit! }, seed: SEEDS[0], answer: rightAnswer })
    if ('refused' in out) throw new Error(out.refused)
    expect(out.result).toMatchObject({ ok: true, provenance: 'practice' })
    const [event] = (await s.events('prove')) as unknown as Array<{ provenance: string; ok: boolean }>
    expect(event).toMatchObject({ provenance: 'practice', ok: true })
    const agg = s.tab.progress.getState().aggregate
    expect(agg.proved[c.labId]).toBeUndefined()
    expect(agg.proves[c.labId]).toBeDefined()
  })

  test('another module than the one graded, and a run that was not unseen, also stay practice', async () => {
    const s = await session(c)
    const graded = moduleBytes(7)
    const other = moduleBytes(8)
    await s.run(graded, report(c.labId))
    s.advance(1)
    const swapped = await s.ask({ bytes: other, graded: { sha256: await sha256Hex(graded), credit: 'unseen' }, seed: SEEDS[0], answer: rightAnswer })
    if ('refused' in swapped) throw new Error(swapped.refused)
    expect(swapped.result).toMatchObject({ ok: true, provenance: 'practice' })
    const assisted = await s.ask({ bytes: graded, graded: { sha256: await sha256Hex(graded), credit: 'assisted' }, seed: SEEDS[1], answer: rightAnswer })
    if ('refused' in assisted) throw new Error(assisted.refused)
    expect(assisted.result).toMatchObject({ ok: true, provenance: 'practice' })
    expect(s.tab.progress.getState().aggregate.proved[c.labId]).toBeUndefined()
  })

  test('the proved event passes the ledger codec: it is stored, not dropped at the flush', async () => {
    const s = await session(c)
    const bytes = moduleBytes(7)
    const sha = await sha256Hex(bytes)
    await s.run(bytes, report(c.labId))
    s.advance(1)
    const out = await s.ask({ bytes, graded: { sha256: sha, credit: 'unseen' }, seed: SEEDS[3], answer: rightAnswer })
    if ('refused' in out) throw new Error(out.refused)
    expect(out.result.provenance).toBe('proved')
    const stored = await s.events('prove')
    expect(stored).toHaveLength(1) // the codec accepted it: a refused event would be absent here
  })
})
