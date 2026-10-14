/**
 * recordProve and completeFleetWeekAct never show an event the engine then drops (the 3a final review's B1, B2 and
 * 3a-01's minor note). The façade folds an action's event into the view at once; the engine validates outbox events
 * (`validateEvent`) when the next load recovers them, and drops what the codec refuses. So an event the codec refuses is
 * seen now and gone on reload, with any `proved` it carried. Each case here writes through a tab whose engine never
 * loads (the tab closed first), checks every event in its outbox against the codec, then loads the next tab and checks
 * that it derives exactly what the first tab showed.
 */
import { describe, expect, test } from 'bun:test'
import { validateEvent } from '../../src/lib/ledger/codec'
import { readOutbox } from '../../src/lib/ledger/outbox'
import { stableStringify } from '../../src/lib/ledger/stable'
import type { FacadeEnv, FleetActMeta, LedgerEngine, ProveData, ProveResult } from '../../src/lib/ledger/types'
import { createProgressStore, type ProgressStore } from '../../src/lib/progress'
import { idStream, makeProfile, startTab, type Profile } from './env'

const SHA = 'ab'.repeat(32)
const v2 = (over: Record<string, unknown> = {}) => ({ v: 2, qid: 'free-after', kcs: ['kc.kv.refcount'], answer: 6, actual: 6, calls: 5, ...over }) as unknown as ProveData

/** A tab that never reaches its engine: whatever it writes lives only in its outbox until the next load. */
function strandedTab(p: Profile, tabId: string): ProgressStore {
  const env: FacadeEnv = { storage: p.storage, clock: p.clock, newId: idStream(`${tabId}:`), tabId, loadEngine: () => new Promise<LedgerEngine>(() => {}) }
  return createProgressStore(env, { scheduleBoot: () => {}, snapshotDelayMs: 5 })
}

/**
 * Run `write` on a stranded tab; every event it built must pass the codec, and the next load must derive what it showed.
 * Returns the events it built.
 */
async function shownAndKept(write: (s: ReturnType<ProgressStore['getState']>) => void) {
  const p = makeProfile()
  const tab = strandedTab(p, 'gone')
  write(tab.getState())
  const box = readOutbox(p.storage, 'gone')
  const events = (box?.events ?? []) as unknown as Array<Record<string, unknown> & { data?: Record<string, unknown> }>
  for (const e of events) {
    const checked = validateEvent(e)
    expect(checked.ok ? '' : `${String(e.kind)} ${String(e.ref)}: ${checked.reason}`).toBe('')
  }
  const next = startTab(p)
  await next.progress.controls.engine()
  expect((await (await next.engine()).events()).length).toBe(events.length)
  expect(stableStringify(next.progress.getState().aggregate)).toBe(stableStringify(tab.getState().aggregate))
  return events
}

const prove = (r: Partial<ProveResult>) => (s: ReturnType<ProgressStore['getState']>) => s.recordProve({ labId: 'kv-block-manager', score: 1, ok: true, data: v2(), ...r } as ProveResult)

describe('recordProve: a v2 event says ok when it is right, and nothing the codec refuses is shown', () => {
  test('a right, credited attempt on a hashed module is written as proved, as the caller built it', async () => {
    const [e] = await shownAndKept(prove({ provenance: 'proved', wasmSha256: SHA, seed: 3, ms: 41_235 }))
    expect(e).toMatchObject({ kind: 'prove', ref: 'prove:kv-block-manager', score: 1, ok: true, provenance: 'proved', wasmSha256: SHA, seed: 3, ms: 41_235, data: v2() })
  })

  test('a miss is never ok, whatever the caller said: score 0, practice, no proves[lab], no prove:<lab> fact, no proved', async () => {
    const p = makeProfile()
    const tab = strandedTab(p, 'gone')
    tab.getState().recordProve({ labId: 'kv-block-manager', score: 1, ok: true, provenance: 'proved', wasmSha256: SHA, data: v2({ answer: 5, actual: 6 }) })
    tab.getState().recordProve({ labId: 'kv-block-manager', score: 1, ok: true, provenance: 'proved', wasmSha256: SHA, data: v2({ answer: 5, actual: null }) })
    const agg = tab.getState().aggregate
    expect(agg.proves).toEqual({})
    expect(agg.facts['prove:kv-block-manager']).toBeUndefined()
    expect(agg.proved).toEqual({})
    const events = readOutbox(p.storage, 'gone')!.events as unknown as Array<{ ok: boolean; score: number; provenance: string }>
    expect(events.map((e) => [e.ok, e.score, e.provenance])).toEqual([[false, 0, 'practice'], [false, 0, 'practice']])
  })

  test('a right answer the caller called a miss is ok: the stored answer and actual decide', async () => {
    const [e] = await shownAndKept(prove({ score: 0, ok: false, data: v2({ answer: [3, 1], actual: [3, 1] }) }))
    expect(e).toMatchObject({ ok: true, score: 1, provenance: 'practice' })
  })

  test('a malformed hash is never sent: left out, and a proved request downgraded to practice', async () => {
    for (const hash of ['AB'.repeat(32), 'ab'.repeat(31), 'not a hash', '']) {
      const [proved] = await shownAndKept(prove({ provenance: 'proved', wasmSha256: hash }))
      expect(proved).toMatchObject({ ok: true, provenance: 'practice' })
      expect(proved).not.toHaveProperty('wasmSha256')
      const [practice] = await shownAndKept(prove({ wasmSha256: hash, data: v2({ answer: 1 }) }))
      expect(practice).toMatchObject({ ok: false, provenance: 'practice' })
      expect(practice).not.toHaveProperty('wasmSha256')
    }
  })

  test('a reply the codec could not store is an unreadable one: actual null, a miss', async () => {
    for (const actual of [Array.from({ length: 13 }, (_, i) => i), [3, -1], [1.5], Number.NaN, '6']) {
      const [e] = await shownAndKept(prove({ provenance: 'proved', wasmSha256: SHA, data: v2({ answer: 6, actual }) }))
      expect(e).toMatchObject({ ok: false, score: 0, provenance: 'practice', data: { actual: null } })
    }
  })

  test('KCs, calls, seed and ms are held to the codec\'s bounds', async () => {
    const [e] = await shownAndKept(prove({ seed: -1, ms: -5, data: v2({ kcs: ['a', 'b', 3, 'c', 'd', 'e', 'f', 'g'], calls: 13, return: false }) }))
    expect(e.data).toEqual({ v: 2, qid: 'free-after', kcs: ['a', 'b', 'c', 'd', 'e', 'f'], answer: 6, actual: 6, calls: 12 })
    expect(e).toMatchObject({ ms: 0 })
    expect(e).not.toHaveProperty('seed')
    const [f] = await shownAndKept(prove({ seed: 2 ** 32, ms: Number.NaN, data: v2({ calls: 0, return: true }) }))
    expect(f.data).toMatchObject({ calls: 1, return: true })
    expect(f).not.toHaveProperty('seed')
    expect(f).not.toHaveProperty('ms')
    const [g] = await shownAndKept(prove({ seed: 1.5 }))
    expect(g).not.toHaveProperty('seed')
  })

  test('what cannot be stored without changing what the learner said is not shown at all', async () => {
    const dropped: Array<Partial<ProveResult>> = [
      { data: v2({ answer: Array.from({ length: 13 }, (_, i) => i), actual: null }) },
      { data: v2({ answer: [3, -1], actual: [3, -1] }) },
      { data: v2({ answer: Number.POSITIVE_INFINITY }) },
      { data: v2({ qid: '' }) },
      { data: v2({ qid: 'q'.repeat(41) }) },
      { data: v2({ calls: Number.NaN }) },
      { labId: '' },
      { labId: '__proto__' },
      { score: Number.NaN, data: { v: 1, qids: ['q1'], self: [1] } },
      { data: { v: 1, qids: ['q1', 'q2'], self: [1] } },
      { data: { v: 3, qids: [], self: [] } as unknown as ProveData },
      { data: null as unknown as ProveData },
    ]
    for (const r of dropped) {
      const events = await shownAndKept(prove(r))
      expect(events).toEqual([])
    }
  })

  test('a v1 attempt is written as before, with its self-grade score clamped and a malformed hash left out', async () => {
    const [e] = await shownAndKept(prove({ score: 1.5, ok: true, ms: 120_000, wasmSha256: 'nope', provenance: 'proved', data: { v: 1, qids: ['q1', 'q2', 'q3'], self: [1, 1, 0] } }))
    expect(e).toMatchObject({ score: 1, ok: true, provenance: 'practice', ms: 120_000, data: { v: 1, qids: ['q1', 'q2', 'q3'], self: [1, 1, 0] } })
    expect(e).not.toHaveProperty('wasmSha256')
  })
})

describe('completeFleetWeekAct: the act is kept, held to what the codec bounds', () => {
  const act = (meta: FleetActMeta | undefined, actId = 'engine', score = 0.8) => (s: ReturnType<ProgressStore['getState']>) => s.completeFleetWeekAct(actId, score, meta)
  const ids = (n: number) => Array.from({ length: n }, (_, i) => (0x7f3a9c00 + i).toString(16))

  test('more than 20 receipt ids are cut to 20, and ids that are not 8 hex digits are left out', async () => {
    const [e] = await shownAndKept(act({ seed: 7, provenance: 'unseen', data: { runs: ids(25) } }))
    expect(e).toMatchObject({ kind: 'fleet-act', ref: 'fw:engine', seed: 7, provenance: 'unseen', data: { runs: ids(20) } })
    const [f] = await shownAndKept(act({ data: { runs: ['7f3a9c21', 'XYZ', '7f3a9c210', '7F3A9C21', 3 as unknown as string] } }))
    expect(f.data).toEqual({ runs: ['7f3a9c21'] })
  })

  test('rubric scores are whole numbers 0 to 3, receipt counts whole numbers of at least 0; an unreadable part is left out', async () => {
    const [e] = await shownAndKept(act({ data: { rubric: { capacity: 4, slo: -1, cost: 2.4, failure: 3 } as never, receipts: { cited: -1, verified: 2.6, uncited: 0 }, goodput: 41 } }))
    expect(e.data).toEqual({ rubric: { capacity: 3, slo: 0, cost: 2, failure: 3 }, receipts: { cited: 0, verified: 3, uncited: 0 }, goodput: 41 })
    const [f] = await shownAndKept(act({ data: { rubric: { capacity: 1, slo: 1, cost: 1 } as never, receipts: { cited: Number.NaN, verified: 1, uncited: 0 }, runs: 'x' as never, note: 'kept' } }))
    expect(f.data).toEqual({ note: 'kept' })
  })

  test('a seed that is not a uint32 is left out, a provenance it may not claim is practice, and data that is not an object is dropped', async () => {
    const [e] = await shownAndKept(act({ seed: -1, provenance: 'proved' as never, data: [1, 2] as never }))
    expect(e).toMatchObject({ provenance: 'practice', ok: true, score: 0.8 })
    expect(e).not.toHaveProperty('seed')
    expect(e).not.toHaveProperty('data')
  })

  test('the Wave 2 data passes through unchanged', async () => {
    const [e] = await shownAndKept(act({ seed: 99, provenance: 'unseen', data: { goodput: 42, refGoodput: 50 } }))
    expect(e).toMatchObject({ seed: 99, provenance: 'unseen', data: { goodput: 42, refGoodput: 50 } })
  })

  test('an act whose ref the codec refuses is not shown', async () => {
    expect(await shownAndKept(act(undefined, ''))).toEqual([])
    expect(await shownAndKept(act(undefined, '__proto__'))).toEqual([])
    expect(await shownAndKept(act(undefined, 'engine', Number.NaN))).toEqual([])
  })
})
