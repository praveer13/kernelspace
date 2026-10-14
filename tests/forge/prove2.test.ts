/**
 * Prove-it v2, the core (docs/specs/wave-3.md §7.3): plan a question from (template, seed), grade the answer against what
 * the module replies, and decide the provenance. The modules are fakes (tests/forge/fixtures.ts) and so are the
 * templates: a lab's real templates are 3a-22's and 3b's. The first describe holds the template contract the real
 * ones must meet (answerable from the module, a plausible bug changes the answer, the story alone does not give it).
 */
import { describe, expect, test } from 'bun:test'
import type { ProveV2Template } from '../../src/data/forge/types'
import { RETRY_AFTER_MS } from '../../src/lib/forge/prove'
import {
  PROVE2_MAX_CALLS,
  RETURN_AFTER_DAYS,
  attemptsOf,
  buildProve2Result,
  eligibility,
  firstProve,
  gradeAnswer,
  parseAnswer,
  pickTemplate,
  planQuestion,
  proveFromModule,
  retryWindow,
  returnDay,
  returnDue,
  runPlan,
  type GradedRun,
  type Prove2Attempt,
  type ProveEventLike,
} from '../../src/lib/forge/prove2'
import { sha256Hex } from '../../src/lib/ledger/stable'
import type { ProveData } from '../../src/lib/ledger/types'
import { LabAbiError } from '../../src/lib/wasm-lab'
import { makeProfile, startTab } from '../ledger/env'
import { fakeBlockManager, fakeBridge, Spin, trap } from './fixtures'

/* ------------------------------ fake templates ------------------------------ */

const FREE_AFTER: ProveV2Template = {
  id: 'free-after',
  kcs: ['kc.kv.refcount' as never],
  bug: 'giving a shared block back when its first owner is freed',
  make(seed) {
    const tokens = 5 + (seed % 8) // 2 or 3 blocks of 4
    return {
      calls: ['init 8 4', `allocate 1 ${tokens}`, 'fork 1 2', 'free 1', 'free_blocks'],
      story: [`Start a pool of 8 blocks of 4 tokens. Allocate sequence 1 with ${tokens} tokens; fork 1 as 2; free 1.`],
      ask: 'How many blocks are free now?',
      answer: 'number',
    }
  },
  read: (replies) => Number(replies[replies.length - 1]),
}

const TRANSLATE: ProveV2Template = {
  id: 'translate',
  kcs: ['kc.kv.freelist' as never],
  bug: 'a LIFO free list when the learner meant FIFO',
  make(seed) {
    const token = seed % 4
    return {
      calls: ['init 8 4', 'allocate 1 6', 'free 1', 'allocate 2 8', `translate 2 ${token}`],
      story: ['Pool of 8 blocks of 4 tokens. Allocate sequence 1 with 6 tokens, free it, allocate sequence 2 with 8.'],
      ask: `Which physical block holds token ${token} of sequence 2?`,
      answer: 'number',
    }
  },
  read: (replies) => Number(replies[replies.length - 1]),
}

const DUMP_IDS: ProveV2Template = {
  id: 'blocks-of',
  kcs: [],
  bug: 'none',
  make: () => ({ calls: ['init 8 4', 'allocate 1 12', 'dump'], story: ['Allocate 12 tokens.'], ask: 'Which blocks does sequence 1 hold, in order?', answer: 'ids' }),
  read: (replies) => (/seq 1: ([\d,]+)/.exec(replies[2])?.[1] ?? '').split(',').map(Number),
}

const answerOn = (t: ProveV2Template, seed: number, module = fakeBlockManager()) => {
  const plan = planQuestion(t, seed)
  const bridge = fakeBridge(module)
  return bridge.run(new ArrayBuffer(0), plan.calls).then((replies) => t.read(replies))
}

describe('the template contract, on a fake correct module and a fake module with the bug', () => {
  test('a correct module answers free-after, and the bug changes the answer on every seed', async () => {
    for (const seed of [0, 1, 2, 3, 17, 4_000_000_000]) {
      const right = await answerOn(FREE_AFTER, seed)
      const bugged = await answerOn(FREE_AFTER, seed, fakeBlockManager({ freeSharedAtFirstFree: true }))
      expect(right).toBe(8 - Math.ceil((5 + (seed % 8)) / 4))
      expect(bugged).not.toBe(right)
    }
  })

  test('translate reads a free design choice: FIFO and LIFO modules answer differently', async () => {
    for (const seed of [0, 1, 2, 3]) {
      expect(await answerOn(TRANSLATE, seed)).not.toBe(await answerOn(TRANSLATE, seed, fakeBlockManager({ lifo: true })))
    }
  })

  test('the story alone does not give the answer: it differs across seeds', async () => {
    const answers = new Set<number | number[]>()
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7]) answers.add(await answerOn(FREE_AFTER, seed))
    expect(answers.size).toBeGreaterThan(1)
  })

  test('the fake keeps state between the entries of one list and starts fresh for the next', async () => {
    const bridge = fakeBridge(fakeBlockManager())
    expect(await bridge.run(new ArrayBuffer(0), ['init 8 4', 'allocate 1 5', 'free_blocks'])).toEqual(['ok', 'true', '6'])
    expect(await bridge.run(new ArrayBuffer(0), ['init 8 4', 'free_blocks'])).toEqual(['ok', '8'])
    expect(bridge.runs).toHaveLength(2)
  })
})

/* ------------------------------ planning ------------------------------ */

describe('planning a question from (template, seed)', () => {
  test('the same seed gives the same question; another seed gives another trace', () => {
    expect(planQuestion(FREE_AFTER, 3)).toEqual(planQuestion(FREE_AFTER, 3))
    expect(planQuestion(FREE_AFTER, 3).calls).not.toEqual(planQuestion(FREE_AFTER, 4).calls)
    expect(planQuestion(FREE_AFTER, 3)).toMatchObject({ templateId: 'free-after', seed: 3, kcs: ['kc.kv.refcount'], answer: 'number' })
  })

  test('a trace is 1 to 12 calls with a story and an ask, or the template is refused', () => {
    const q = (calls: string[], story = ['s'], ask = 'a') => ({ ...FREE_AFTER, make: () => ({ calls, story, ask, answer: 'number' as const }) })
    expect(planQuestion(q(Array(PROVE2_MAX_CALLS).fill('init')), 1).calls).toHaveLength(12)
    expect(() => planQuestion(q(Array(PROVE2_MAX_CALLS + 1).fill('init')), 1)).toThrow('13 calls')
    expect(() => planQuestion(q([]), 1)).toThrow('0 calls')
    expect(() => planQuestion(q(['init', ' ']), 1)).toThrow('empty call')
    expect(() => planQuestion(q(['init'], []), 1)).toThrow('story')
    expect(() => planQuestion(q(['init'], ['s'], ' '), 1)).toThrow('story')
  })

  test('the seed is a uint32', () => {
    expect(planQuestion(FREE_AFTER, 2 ** 32 + 5).seed).toBe(5)
  })

  test('the next template is the never-served one, then the one served longest ago', () => {
    const all = [FREE_AFTER, TRANSLATE, DUMP_IDS]
    const at = (h: number, qid: string): Prove2Attempt => ({ at: new Date(Date.UTC(2026, 9, 1, h)).toISOString(), qid, right: true })
    expect(pickTemplate(all, []).id).toBe('free-after')
    expect(pickTemplate(all, [at(1, 'free-after')]).id).toBe('translate')
    expect(pickTemplate(all, [at(1, 'free-after'), at(2, 'translate')]).id).toBe('blocks-of')
    expect(pickTemplate(all, [at(1, 'free-after'), at(2, 'translate'), at(3, 'blocks-of')]).id).toBe('free-after')
    expect(pickTemplate(all, [at(5, 'free-after'), at(1, 'translate'), at(3, 'blocks-of'), at(6, 'translate')]).id).toBe('blocks-of')
    expect(() => pickTemplate([], [])).toThrow('no Prove-it v2 templates')
  })

  test('answers: a number, or ids separated by commas or spaces; anything else is not an answer', () => {
    expect(parseAnswer(' 12 ', 'number')).toBe(12)
    expect(parseAnswer('-3', 'number')).toBe(-3)
    expect(parseAnswer('2.5', 'number')).toBe(2.5)
    expect(parseAnswer('twelve', 'number')).toBeNull()
    expect(parseAnswer('1,2', 'number')).toBeNull()
    expect(parseAnswer('', 'number')).toBeNull()
    expect(parseAnswer('3, 7, 1', 'ids')).toEqual([3, 7, 1])
    expect(parseAnswer('3 7  1', 'ids')).toEqual([3, 7, 1])
    expect(parseAnswer('3,,7', 'ids')).toEqual([3, 7])
    expect(parseAnswer('', 'ids')).toBeNull()
    expect(parseAnswer('3, x', 'ids')).toBeNull()
    expect(parseAnswer('1.5', 'ids')).toBeNull()
    expect(parseAnswer(Array(17).fill('1').join(','), 'ids')).toBeNull()
  })
})

/* ------------------------------ running and grading ------------------------------ */

describe('running the calls and grading the answer', () => {
  const plan = planQuestion(FREE_AFTER, 3)
  const truth = 8 - Math.ceil(8 / 4) // seed 3: 8 tokens, 2 blocks

  test('the answer is right when it equals the module\'s reply exactly', async () => {
    const out = await runPlan(new ArrayBuffer(0), plan, fakeBridge(fakeBlockManager()).run)
    if (out.kind === 'refused') throw new Error('refused')
    expect(gradeAnswer(FREE_AFTER, truth, out)).toEqual({ right: true, actual: truth, failed: null })
    expect(gradeAnswer(FREE_AFTER, truth + 1, out)).toEqual({ right: false, actual: truth, failed: null })
    expect(gradeAnswer(FREE_AFTER, [truth], out).right).toBe(false)
  })

  test('your module\'s bug is your module\'s answer: the prediction is graded against the module, not the spec', async () => {
    const out = await runPlan(new ArrayBuffer(0), plan, fakeBridge(fakeBlockManager({ freeSharedAtFirstFree: true })).run)
    if (out.kind === 'refused') throw new Error('refused')
    expect(gradeAnswer(FREE_AFTER, 8, out).right).toBe(true)
    expect(gradeAnswer(FREE_AFTER, truth, out).right).toBe(false)
  })

  test('an ids answer must match in order', async () => {
    const p = planQuestion(DUMP_IDS, 1)
    const out = await runPlan(new ArrayBuffer(0), p, fakeBridge(fakeBlockManager()).run)
    if (out.kind === 'refused') throw new Error('refused')
    expect(gradeAnswer(DUMP_IDS, [0, 1, 2], out).right).toBe(true)
    expect(gradeAnswer(DUMP_IDS, [2, 1, 0], out).right).toBe(false)
    expect(gradeAnswer(DUMP_IDS, [0, 1], out).right).toBe(false)
  })

  test('a trap makes actual null and the answer wrong, whatever it was', async () => {
    const out = await runPlan(new ArrayBuffer(0), plan, fakeBridge(() => (cmd) => (cmd === 'fork 1 2' ? trap('not yet implemented: fork') : 'ok')).run)
    expect(out).toMatchObject({ kind: 'failed', reason: 'trap' })
    if (out.kind === 'refused') throw new Error('refused')
    expect(gradeAnswer(FREE_AFTER, truth, out)).toMatchObject({ right: false, actual: null, failed: 'trap' })
  })

  test('a timeout is the same: actual null, wrong', async () => {
    const out = await runPlan(new ArrayBuffer(0), plan, fakeBridge(() => () => { throw new Spin() }).run)
    expect(out).toMatchObject({ kind: 'failed', reason: 'timeout' })
    if (out.kind === 'refused') throw new Error('refused')
    expect(gradeAnswer(FREE_AFTER, truth, out)).toMatchObject({ right: false, actual: null, failed: 'timeout' })
  })

  test('replies the template cannot read fail the module, they do not crash the panel', async () => {
    const out = await runPlan(new ArrayBuffer(0), plan, async () => ['ok', 'true', 'true', 'ok', 'lots'])
    if (out.kind === 'refused') throw new Error('refused')
    expect(gradeAnswer(FREE_AFTER, 0, out)).toMatchObject({ right: false, actual: null, failed: 'error' })
    const throwing = { ...FREE_AFTER, read: () => { throw new Error('no free_blocks reply') } }
    expect(gradeAnswer(throwing, 0, { kind: 'replied', replies: [] })).toMatchObject({ right: false, actual: null, failed: 'error', message: 'no free_blocks reply' })
  })

  test('the wrong number of replies is a failure, not a grade', async () => {
    expect(await runPlan(new ArrayBuffer(0), plan, async () => ['ok'])).toMatchObject({ kind: 'failed', reason: 'error' })
  })

  test('a refusal (reference build, no bridge) is an outcome of its own; any other error is thrown', async () => {
    const refused = await runPlan(new ArrayBuffer(0), plan, async () => { throw new LabAbiError('this module has no ks_invoke bridge') })
    expect(refused).toEqual({ kind: 'refused', message: 'this module has no ks_invoke bridge' })
    await expect(runPlan(new ArrayBuffer(0), plan, async () => { throw new Error('worker crashed') })).rejects.toThrow('worker crashed')
  })
})

/* ------------------------------ retries and eligibility ------------------------------ */

const H = 3_600_000
const T0 = Date.parse('2026-10-05T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()
const att = (ms: number, right: boolean, extra: Partial<Prove2Attempt> = {}): Prove2Attempt => ({ at: iso(ms), qid: 'free-after', right, ...extra })

describe('the 24 h retry', () => {
  test('with no attempts, or only right ones, a credited attempt is open', () => {
    expect(retryWindow([], T0)).toEqual({ open: true, opensAt: null })
    expect(retryWindow([att(T0 - H, true), att(T0 - 2 * H, true)], T0)).toEqual({ open: true, opensAt: null })
  })

  test('a wrong credited attempt closes the window for 24 h, to the millisecond', () => {
    const miss = [att(T0, false)]
    expect(retryWindow(miss, T0 + 1)).toEqual({ open: false, opensAt: T0 + RETRY_AFTER_MS })
    expect(retryWindow(miss, T0 + RETRY_AFTER_MS - 1).open).toBe(false)
    expect(retryWindow(miss, T0 + RETRY_AFTER_MS)).toEqual({ open: true, opensAt: null })
  })

  test('attempts in between are practice: they never extend the wait', () => {
    const history = [att(T0, false), att(T0 + 2 * H, false), att(T0 + 10 * H, true), att(T0 + 23 * H, false)]
    expect(retryWindow(history, T0 + 23.5 * H)).toEqual({ open: false, opensAt: T0 + RETRY_AFTER_MS })
    expect(retryWindow(history, T0 + RETRY_AFTER_MS).open).toBe(true)
  })

  test('a miss after the window reopened starts a new wait, and the order of the list does not matter', () => {
    const history = [att(T0 + RETRY_AFTER_MS + H, false), att(T0, false)]
    expect(retryWindow(history, T0 + RETRY_AFTER_MS + 2 * H)).toEqual({ open: false, opensAt: T0 + 2 * RETRY_AFTER_MS + H })
  })

  test('an attempt known not to be credited neither waits nor opens anything', () => {
    expect(retryWindow([att(T0, false, { credited: false })], T0 + H)).toEqual({ open: true, opensAt: null })
  })
})

describe('eligibility: an unseen run of this very module, and no retry waiting', () => {
  const sha = 'ab'.repeat(32)
  const graded: GradedRun = { sha256: sha, credit: 'unseen' }

  test('credited when the graded run was unseen, the hash matches and the window is open', () => {
    expect(eligibility(graded, sha, [], T0)).toEqual({ credited: true })
  })

  test.each([['lab-green'], ['assisted'], [null]] as const)('a run with credit %p does not credit the attempt', (credit) => {
    expect(eligibility({ sha256: sha, credit }, sha, [], T0)).toEqual({ credited: false, reason: 'credit' })
    expect(eligibility(null, sha, [], T0)).toEqual({ credited: false, reason: 'credit' })
  })

  test('another module than the one graded, or one that could not be hashed, is not credited', () => {
    expect(eligibility(graded, 'cd'.repeat(32), [], T0)).toEqual({ credited: false, reason: 'module' })
    expect(eligibility(graded, null, [], T0)).toEqual({ credited: false, reason: 'module' })
  })

  test('a waiting retry is named with the time it opens', () => {
    expect(eligibility(graded, sha, [att(T0, false)], T0 + H)).toEqual({ credited: false, reason: 'retry', opensAt: T0 + RETRY_AFTER_MS })
  })
})

/* ------------------------------ the whole attempt ------------------------------ */

describe('proveFromModule: the result and its provenance', () => {
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 42]).buffer
  const plan = planQuestion(FREE_AFTER, 3)
  const truth = 6
  const attempt = async (over: { answer?: number; graded?: GradedRun | null; history?: Prove2Attempt[]; now?: number; module?: () => (cmd: string) => string; ret?: boolean; bytes?: ArrayBuffer; hash?: (b: ArrayBuffer) => Promise<string> } = {}) => {
    const sha = await sha256Hex(bytes)
    const r = await proveFromModule({
      labId: 'kv-block-manager',
      template: FREE_AFTER,
      plan,
      answer: over.answer ?? truth,
      bytes: over.bytes ?? bytes,
      graded: over.graded === undefined ? { sha256: sha, credit: 'unseen' } : over.graded,
      history: over.history ?? [],
      now: over.now ?? T0,
      run: fakeBridge(over.module ?? fakeBlockManager()).run,
      ms: 41_234.6,
      ...(over.hash ? { hash: over.hash } : {}),
      ...(over.ret ? { ret: true } : {}),
    })
    if (r.kind === 'refused') throw new Error(r.message)
    return { ...r, sha }
  }

  test('right, on the module the unseen run graded, with no retry waiting: proved', async () => {
    const r = await attempt()
    expect(r.result).toEqual({
      labId: 'kv-block-manager',
      score: 1,
      ok: true,
      ms: 41_235,
      provenance: 'proved',
      wasmSha256: r.sha,
      seed: 3,
      data: { v: 2, qid: 'free-after', kcs: ['kc.kv.refcount'], answer: truth, actual: truth, calls: 5 },
    })
    expect(r.opensAt).toBeNull()
  })

  test('wrong: practice with score 0, the module\'s actual reply kept, and the next credited attempt 24 h on', async () => {
    const r = await attempt({ answer: 7 })
    expect(r.result).toMatchObject({ score: 0, ok: true, provenance: 'practice', wasmSha256: r.sha, data: { answer: 7, actual: truth } })
    expect(r.grade).toMatchObject({ right: false, actual: truth })
    expect(r.opensAt).toBe(T0 + RETRY_AFTER_MS)
  })

  test('a failed module is a wrong, credited answer with actual null', async () => {
    const r = await attempt({ module: () => () => trap('boom') })
    expect(r.grade).toMatchObject({ right: false, actual: null, failed: 'trap' })
    expect(r.result).toMatchObject({ provenance: 'practice', score: 0, data: { actual: null } })
    expect(r.opensAt).toBe(T0 + RETRY_AFTER_MS)
  })

  test('right inside the 24 h after a credited miss is practice, and says when the next credited attempt opens', async () => {
    const r = await attempt({ history: [att(T0 - 3 * H, false)] })
    expect(r.result.provenance).toBe('practice')
    expect(r.result.score).toBe(1)
    expect(r.eligibility).toEqual({ credited: false, reason: 'retry', opensAt: T0 - 3 * H + RETRY_AFTER_MS })
    expect(r.opensAt).toBe(T0 - 3 * H + RETRY_AFTER_MS)
  })

  test('a miss inside the wait does not push the opening later', async () => {
    const r = await attempt({ answer: 0, history: [att(T0 - 3 * H, false)] })
    expect(r.opensAt).toBe(T0 - 3 * H + RETRY_AFTER_MS)
  })

  test('right once the 24 h has passed: proved again, with a fresh question', async () => {
    const r = await attempt({ history: [att(T0 - RETRY_AFTER_MS, false)] })
    expect(r.result.provenance).toBe('proved')
  })

  test('a run that was not unseen, no run at all, or a different module: practice', async () => {
    const sha = await sha256Hex(bytes)
    expect((await attempt({ graded: { sha256: sha, credit: 'lab-green' } })).result.provenance).toBe('practice')
    expect((await attempt({ graded: { sha256: sha, credit: null } })).result.provenance).toBe('practice')
    expect((await attempt({ graded: null })).result.provenance).toBe('practice')
    const other = await attempt({ graded: { sha256: 'cd'.repeat(32), credit: 'unseen' } })
    expect(other.result.provenance).toBe('practice')
    expect(other.eligibility).toMatchObject({ credited: false, reason: 'module' })
    expect(other.opensAt).toBeNull() // a practice miss opens and closes nothing
  })

  test('a wrong answer on a module that was not credited does not start a 24 h wait', async () => {
    const r = await attempt({ answer: 0, graded: { sha256: await sha256Hex(bytes), credit: 'lab-green' } })
    expect(r.opensAt).toBeNull()
  })

  test('a module that cannot be hashed is practice and carries no hash', async () => {
    const r = await attempt({ hash: async () => { throw new Error('no crypto.subtle') } })
    expect(r.result.provenance).toBe('practice')
    expect(r.result.wasmSha256).toBeUndefined()
  })

  test('the hash is of the bytes asked, so the module graded and the module asked must be the same file', async () => {
    const edited = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 43]).buffer
    const r = await attempt({ bytes: edited })
    expect(r.result.provenance).toBe('practice')
    expect(r.result.wasmSha256).toBe(await sha256Hex(edited))
  })

  test('the 30-day return carries data.return', async () => {
    expect((await attempt({ ret: true })).result.data).toMatchObject({ v: 2, return: true })
    expect((await attempt()).result.data).not.toHaveProperty('return')
  })

  test('a refused module is reported and nothing is graded', async () => {
    const r = await proveFromModule({
      labId: 'kv-block-manager',
      template: FREE_AFTER,
      plan,
      answer: truth,
      bytes,
      graded: null,
      history: [],
      now: T0,
      run: async () => { throw new LabAbiError('this is a reference build (kv-block-manager@reference): reference modules earn no credit, so Prove-it runs learner builds only.') },
    })
    expect(r).toEqual({ kind: 'refused', message: expect.stringContaining('reference build') })
  })

  test('more than six KCs are cut to six', () => {
    const many = { ...plan, kcs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }
    const r = buildProve2Result({ labId: 'x', plan: many, answer: 1, grade: { right: true, actual: 1, failed: null }, eligibility: { credited: true }, moduleSha: 'ab'.repeat(32) })
    expect((r.data as { kcs: string[] }).kcs).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  test('proved never leaves without a hash, even for a right, credited answer', () => {
    const r = buildProve2Result({ labId: 'x', plan, answer: 1, grade: { right: true, actual: 1, failed: null }, eligibility: { credited: true }, moduleSha: null })
    expect(r.provenance).toBe('practice')
  })
})

/* ------------------------------ through the ledger ------------------------------ */

describe('the ledger takes what prove2 builds', () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer
  const stored = async (tab: ReturnType<typeof startTab>) => {
    await tab.progress.controls.flush()
    return (await (await tab.engine()).events()) as unknown as Array<ProveEventLike & { provenance: string; seed?: number; wasmSha256?: string; score: number }>
  }

  test('a proved result is written as proved with its seed and hash; a practice miss is practice; history and retry read back from the events', async () => {
    const tab = startTab(makeProfile())
    const plan = planQuestion(FREE_AFTER, 3)
    const sha = await sha256Hex(bytes)
    const graded: GradedRun = { sha256: sha, credit: 'unseen' }
    const go = async (answer: number, history: Prove2Attempt[], now: number) => {
      const r = await proveFromModule({ labId: 'kv-block-manager', template: FREE_AFTER, plan, answer, bytes, graded, history, now, run: fakeBridge(fakeBlockManager()).run })
      if (r.kind === 'refused') throw new Error(r.message)
      tab.progress.getState().recordProve({ ...r.result, data: r.result.data as ProveData })
      return r
    }
    const miss = await go(0, [], Date.now())
    expect(miss.result.provenance).toBe('practice')
    let events = await stored(tab)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'prove', ref: 'prove:kv-block-manager', provenance: 'practice', score: 0, seed: 3, wasmSha256: sha })
    expect(tab.progress.getState().aggregate.proved).toEqual({})

    // the miss is a credited one: reading the ledger back, a retry is waiting
    const history = attemptsOf(events, 'kv-block-manager')
    expect(history).toEqual([{ at: events[0].at, qid: 'free-after', right: false }])
    expect(retryWindow(history, Date.parse(events[0].at) + H)).toEqual({ open: false, opensAt: Date.parse(events[0].at) + RETRY_AFTER_MS })

    // a right answer a day later is proved, and the fold derives proved[lab]
    const later = Date.parse(events[0].at) + RETRY_AFTER_MS
    const hit = await go(6, history, later)
    expect(hit.result.provenance).toBe('proved')
    events = await stored(tab)
    expect(events.map((e) => e.provenance).sort()).toEqual(['practice', 'proved'])
    expect(tab.progress.getState().aggregate.proved['kv-block-manager']).toEqual(expect.any(String))
  })
})

describe('reading attempts and the first prove event from events', () => {
  const ev = (at: string, ref: string, data: unknown, day = at.slice(0, 10)): ProveEventLike => ({ kind: 'prove', ref, at, day, data })
  const v2 = (answer: number | number[], actual: number | number[] | null, qid = 'free-after') => ({ v: 2, qid, kcs: [], answer, actual, calls: 5 })

  test('v2 attempts of this lab only, oldest first, with right read from answer and actual', () => {
    const events: ProveEventLike[] = [
      ev('2026-10-03T10:00:00.000Z', 'prove:kv-block-manager', v2([1, 2], [1, 2], 'blocks-of')),
      ev('2026-10-01T10:00:00.000Z', 'prove:kv-block-manager', v2(5, 6)),
      ev('2026-10-02T10:00:00.000Z', 'prove:kv-block-manager', v2(5, null)),
      ev('2026-10-02T11:00:00.000Z', 'prove:kv-block-manager', { v: 1, qids: ['q'], self: [1] }),
      ev('2026-10-02T12:00:00.000Z', 'prove:mpmc-queue', v2(1, 1)),
      { kind: 'item', ref: 'item:x', at: '2026-10-02T13:00:00.000Z', day: '2026-10-02', data: v2(1, 1) },
      ev('2026-10-02T14:00:00.000Z', 'prove:kv-block-manager', { v: 2, qid: 'x' }),
    ]
    expect(attemptsOf(events, 'kv-block-manager')).toEqual([
      { at: '2026-10-01T10:00:00.000Z', qid: 'free-after', right: false },
      { at: '2026-10-02T10:00:00.000Z', qid: 'free-after', right: false },
      { at: '2026-10-03T10:00:00.000Z', qid: 'blocks-of', right: true },
    ])
  })

  test('the first prove event, v1 or v2, of that lab', () => {
    const events = [
      ev('2026-10-09T10:00:00.000Z', 'prove:kv-block-manager', v2(1, 1)),
      ev('2026-10-02T23:30:00.000Z', 'prove:kv-block-manager', { v: 1, qids: [], self: [] }, '2026-10-03'),
      ev('2026-09-01T10:00:00.000Z', 'prove:mpmc-queue', v2(1, 1)),
    ]
    expect(firstProve(events, 'kv-block-manager')).toEqual({ at: '2026-10-02T23:30:00.000Z', day: '2026-10-03' })
    expect(firstProve(events, 'radix-cache')).toBeNull()
  })
})

describe('the 30-day return is due 30 local days after the first prove event', () => {
  test('the day is the event\'s own local day plus 30', () => {
    expect(RETURN_AFTER_DAYS).toBe(30)
    expect(returnDay('2026-10-03')).toBe('2026-11-02')
    expect(returnDay('2026-12-15')).toBe('2027-01-14')
    expect(returnDay('2028-02-01')).toBe('2028-03-02') // a leap year
  })

  test('not due on day 29, due on day 30 and after', () => {
    expect(returnDue('2026-10-03', '2026-11-01')).toBe(false)
    expect(returnDue('2026-10-03', '2026-11-02')).toBe(true)
    expect(returnDue('2026-10-03', '2027-03-01')).toBe(true)
    expect(returnDue('2026-10-03', '2026-10-03')).toBe(false)
  })

  test('a malformed day is never due', () => {
    expect(returnDue('soon', '2026-11-02')).toBe(false)
    expect(returnDue('2026-10-03', 'later')).toBe(false)
  })
})
