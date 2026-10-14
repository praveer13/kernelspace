/**
 * Ledger contract v3.3 (wave-3.md §3, task 3a-01): schema 6 and aggregate 4, Prove-it v2 and provenance `proved`,
 * the item sources `form` and `play`, the form keys, the return flag, play metrics and levels, Fleet Week receipts,
 * the `fw:runs` and `profile:background` working keys, the stretch shapes, the aggregate v4 folds, the upgrade chain
 * v1 -> v2 -> v3 -> v4 and the façade changes. The property suite (gen.ts) runs every new shape, so this file pins
 * the rules those properties lean on.
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { applyImport, buildExportV3, parseImport, serializeExport, validateEvent, validateWorkingRecord } from '../../src/lib/ledger/codec'
import { AGGREGATE_VERSION, BACKGROUNDS, SCHEMA_VERSION } from '../../src/lib/ledger/constants'
import { broadcastableWorking } from '../../src/lib/ledger/channel'
import { derive, emptyAggregate, upgradeAggregate } from '../../src/lib/ledger/fold'
import { checkMessage, checkSnapshot, checkStoreInfo, createGuard } from '../../src/lib/ledger/guard'
import { SNAPSHOT_KEY } from '../../src/lib/ledger/names'
import { readOutbox } from '../../src/lib/ledger/outbox'
import { refMatchesKind } from '../../src/lib/ledger/refs'
import { stableStringify } from '../../src/lib/ledger/stable'
import type {
  Aggregate,
  AggregateV2,
  AggregateV3,
  Background,
  FleetActData,
  LedgerEvent,
  PlayData,
  ProveData,
  RunRecord,
  WorkingKey,
} from '../../src/lib/ledger/types'
import { toProgressData, xpOf } from '../../src/lib/ledger/view'
import { evt, forSeeds, int, ledgerKey, OPS, PROPERTY_TIMEOUT_MS, runOps, shuffle } from './gen'
import { makeProfile, startTab, tick } from './env'

setDefaultTimeout(PROPERTY_TIMEOUT_MS)

const T1 = '2026-09-01T09:00:00.000Z'
const T2 = '2026-09-02T09:00:00.000Z'
const T3 = '2026-09-03T09:00:00.000Z'
const SHA = 'ab'.repeat(32)
const SHA2 = 'cd'.repeat(32)

const bad = (e: unknown) => {
  const r = validateEvent(e)
  return r.ok ? null : r.reason
}
const ok = (e: unknown) => expect(bad(e)).toBeNull()
const badWorking = (key: string, value: unknown) => {
  const r = validateWorkingRecord({ key, value, at: T1, dev: 'd' })
  return r.ok ? null : r.reason
}

const proveV2 = (over: Record<string, unknown> = {}) => ({ v: 2, qid: 'free-after', kcs: ['kc.kv.size'], answer: [3, 1, 2], actual: [3, 1, 2], calls: 6, ...over })
const prove = (data: unknown, extra: Record<string, unknown> = {}, lab = 'kv-block-manager') => evt('prove', `prove:${lab}`, T1, { data, ...extra })
const formItem = (over: Record<string, unknown> = {}) =>
  evt('item', 'gen:kv/bytes-per-token', T1, { rev: 'r', data: { src: 'form', formId: 'A', track: 't5', formSlot: 3, formSet: 1, ...over } })
const playEvt = (data: Record<string, unknown>, ref = 'play:eplb') => evt('play', ref, T1, { data: { phase: 'play', turns: 4, survived: 0, ghostSurvived: 0, ...data } })
const actEvt = (data: unknown, ref = 'fw:engine') => evt('fleet-act', ref, T1, { data })
const runRecord = (over: Record<string, unknown> = {}): RunRecord => ({
  id: '7f3a9c21',
  act: 'engine',
  job: { kind: 'engine', modules: [{ slot: 'scheduler', sha256: SHA }] },
  entropy: 123456,
  values: { goodput: 41.2, refGoodput: 42 },
  at: T1,
  ...over,
}) as RunRecord
const fleetRun = (ref: string, data: unknown, at = T1, extra: Record<string, unknown> = {}) => evt('fleet-run', ref, at, { data, ...extra })
const raceData = (over: Record<string, unknown> = {}) => ({
  v: 1,
  mode: 'engine',
  components: [{ slot: 'scheduler', labId: 'batching-scheduler', sha256: SHA }],
  seeds: 'fresh',
  goodput: 40,
  refGoodput: 41,
  ...over,
})

/* ------------------------------------------------------------------ */
/* Versions and the schema guard (§3.1)                                 */
/* ------------------------------------------------------------------ */

describe('versions and the schema guard', () => {
  test('SCHEMA_VERSION 6 and AGGREGATE_VERSION 4; the empty aggregate carries the v4 maps', () => {
    expect(SCHEMA_VERSION).toBe(6)
    expect(AGGREGATE_VERSION).toBe(4)
    expect(emptyAggregate()).toMatchObject({ v: 4, proved: {}, labFleetOk: {}, incidents: {}, dailyDays: {}, fleetRuns: {} })
  })

  test('a Wave 2 bundle (schema 5) goes read-only on a v6 snapshot, hello, store or file; a v6 bundle reads v5 data', () => {
    expect(checkSnapshot(5, { schemaVersion: 6 })).toBe('snapshot-newer')
    expect(checkMessage(5, { schemaVersion: 6 })).toBe('newer-schema')
    expect(checkStoreInfo(5, { backend: 'idb', schemaVersion: 6, readOnly: false })).toBe('newer-schema')
    const guard = createGuard(5)
    expect(guard.message({ schemaVersion: SCHEMA_VERSION })).toBe(true)
    expect(guard.reason).toBe('newer-schema')

    expect(checkSnapshot(SCHEMA_VERSION, { schemaVersion: 5 })).toBeNull()
    expect(checkMessage(SCHEMA_VERSION, { schemaVersion: 5 })).toBeNull()
    expect(checkStoreInfo(SCHEMA_VERSION, { backend: 'idb', schemaVersion: 5, readOnly: false })).toBeNull()
  })

  test('the engine of a Wave 2 bundle goes read-only on a database a v6 bundle opened, and writes nothing', async () => {
    const p = makeProfile()
    const wave3 = startTab(p)
    wave3.progress.getState().setWorking('profile:background', 'sre')
    await wave3.progress.controls.flush()
    const old = startTab(p, { schemaVersion: 5 })
    const engine = await old.engine()
    expect(engine.status()).toMatchObject({ readOnly: true, reason: 'newer-schema' })
    const before = (await p.store.readAll()).working.length
    await engine.append([], [{ key: 'profile:background', value: 'ml', at: T3, dev: 'x' }])
    expect((await p.store.readAll()).working).toHaveLength(before)
  })

  test('the meta schema moves up to 6 on the first v6 boot, and the snapshot it writes is read-only to a Wave 2 bundle', async () => {
    const p = makeProfile({ seed: { meta: { schema: { version: 5, at: T1 } } } })
    const tab = startTab(p)
    await tab.progress.controls.engine()
    expect((await p.store.readAll()).meta.schema?.version).toBe(6)
    tab.progress.getState().recordVisit('boot')
    await tab.progress.controls.flush()
    const snap = JSON.parse(p.storage.data.get(SNAPSHOT_KEY)!) as { schemaVersion: number; aggregateVersion: number }
    expect(snap).toMatchObject({ schemaVersion: 6, aggregateVersion: 4 })
    expect(checkSnapshot(5, snap)).toBe('snapshot-newer')
  })

  test('exports carry schemaVersion 6; import accepts every older one and refuses 7', () => {
    const file = buildExportV3({ events: [], working: [], device: 'd', exportedAt: T1 })
    expect(file).toMatchObject({ version: 3, schemaVersion: 6 })
    for (const v of [1, 3, 4, 5, 6]) expect(parseImport(JSON.stringify({ ...file, schemaVersion: v })).ok).toBe(true)
    expect(parseImport(JSON.stringify({ ...file, schemaVersion: 7 }))).toMatchObject({ ok: false, error: 'newer-schema' })
  })

  test('BACKGROUNDS is the list of §3.2', () => {
    expect([...BACKGROUNDS]).toEqual(['jvm', 'backend', 'sre', 'ml', 'student', 'other'])
  })
})

/* ------------------------------------------------------------------ */
/* Refs: no new grammar (§3.2)                                          */
/* ------------------------------------------------------------------ */

describe('refs', () => {
  test('every Wave 3 ref of the §3.2 table, stretch refs included, already passes its kind\'s grammar', () => {
    const table: [Parameters<typeof refMatchesKind>[0], string][] = [
      ['prove', 'prove:kv-block-manager'],
      ['play', 'play:tiling-cube'],
      ['play', 'play:eplb'],
      ['item', 'gen:tiling/raster-ai'],
      ['predict', 'gen:tiling/raster-ai'],
      ['item', 'item:fleet.knee'],
      ['predict', 'item:fleet.knee'],
      ['item', 'item:t2.l2.iso.1'],
      ['item', 'item:t2.l2.iso.1.break'],
      ['item', 'item:lab07.twin.1'],
      ['fleet-run', 'fleet:engine'],
      ['fleet-act', 'fw:engine'],
      ['fleet-act', 'fw:fleet'],
      ['fleet-act', 'fw:business'],
      ['item', 'item:field.decode-kv.tps'],
      ['predict', 'item:field.decode-kv.tps'],
      ['item', 'item:engine.measured-tps'],
      ['predict', 'item:engine.measured-tps'],
      ['item', 'item:t4.l3.protege.1.find'],
      ['item', 'item:t4.l3.protege.2.tag'],
      ['item', 'item:t4.l3.protege.3.fix'],
      ['item', 'item:cube.spatial.1'],
    ]
    for (const [kind, ref] of table) expect(`${kind} ${ref} ${refMatchesKind(kind, ref)}`).toBe(`${kind} ${ref} true`)
  })
})

/* ------------------------------------------------------------------ */
/* Item sources, form keys and the return flag (§3.2)                   */
/* ------------------------------------------------------------------ */

describe('codec: item sources, form keys and the return flag', () => {
  test('form and play are item sources, play and practice are predict sources; an unknown one is not', () => {
    ok(evt('item', 'gen:tiling/raster-ai', T1, { rev: 'r', data: { src: 'play' } }))
    ok(evt('probe', 'gen:tiling/raster-ai', T1, { rev: 'r', data: { src: 'play' } }))
    ok(formItem())
    for (const src of ['play', 'practice']) ok(evt('predict', 'gen:tiling/raster-ai', T1, { rev: 'r', data: { value: 1, truth: 2, unit: 'x', src } }))
    expect(bad(evt('predict', 'gen:tiling/raster-ai', T1, { rev: 'r', data: { value: 1, truth: 2, unit: 'x', src: 'form' } }))).toContain('data.src')
    expect(bad(evt('item', 'gen:tiling/raster-ai', T1, { rev: 'r', data: { src: 'arena' } }))).toContain('data.src')
  })

  test('the Wave 2 sources are still accepted', () => {
    for (const src of ['quiz', 'boot', 'card', 'cold', 'today', 'ticket', 'testout', 'placement', 'pre', 'diagram', 'practice', 'lesson', 'daily']) {
      ok(evt('item', 'gen:kv/bytes-per-token', T1, { rev: 'r', data: { src } }))
    }
    for (const src of ['boot', 'lesson', 'pre', 'diagram', 'placement']) ok(evt('predict', 'boot:x', T1, { rev: 'r', data: { value: 1, truth: 2, unit: 'x', src } }))
  })

  test('a form item takes every formId, formSet and formSlot of the range', () => {
    for (const formId of ['A', 'B', 'C']) ok(formItem({ formId }))
    for (const formSet of [0, 1, 2]) ok(formItem({ formSet }))
    for (const formSlot of [0, 5, 11]) ok(formItem({ formSlot }))
  })

  test('the malformed form items of §3.2 are each refused', () => {
    expect(bad(formItem({ formSlot: 12 }))).toContain('formSlot')
    expect(bad(formItem({ formSlot: -1 }))).toContain('formSlot')
    expect(bad(formItem({ formSlot: 1.5 }))).toContain('formSlot')
    expect(bad(formItem({ formSlot: '3' }))).toContain('formSlot')
    expect(bad(formItem({ form: 'A' }))).toContain('never data.form')
    expect(bad(formItem({ form: 'ticket' }))).toContain('never data.form') // the ticket form is not a form key either
    expect(bad(formItem({ slot: 2 }))).toContain('never data.form') // nor is the Today position
    expect(bad(formItem({ formId: 'D' }))).toContain('formId')
    expect(bad(formItem({ formId: undefined }))).toContain('formId')
    expect(bad(formItem({ formSet: 3 }))).toContain('formSet')
    expect(bad(formItem({ formSet: undefined }))).toContain('formSet')
    expect(bad(formItem({ track: '' }))).toContain('track')
    expect(bad(formItem({ track: undefined }))).toContain('track')
  })

  test('a ticket or Today item keeps data.form and data.slot; the form keys on other sources are not held to the form rules', () => {
    ok(evt('item', 'gen:kv/bytes-per-token', T1, { rev: 'r', data: { src: 'ticket', form: 'ticket', slot: 3, of: 5 } }))
    ok(evt('item', 'gen:kv/bytes-per-token', T1, { rev: 'r', data: { src: 'today', slot: 3, of: 8 } }))
  })

  test('the return flag is absent or true on an item, a probe or a prediction', () => {
    ok(evt('item', 'item:lab02.prove.free-order', T1, { rev: 'r', data: { src: 'today', return: true } }))
    ok(evt('item', 'item:lab02.prove.free-order', T1, { rev: 'r', data: { src: 'today' } }))
    ok(evt('probe', 'item:lab02.prove.free-order', T1, { rev: 'r', data: { src: 'today', return: true } }))
    ok(evt('predict', 'gen:tiling/raster-ai', T1, { rev: 'r', data: { value: 1, truth: 2, unit: 'x', src: 'play', return: true } }))
    for (const value of [false, 1, 'true', null]) expect(bad(evt('item', 'item:lab02.prove.free-order', T1, { rev: 'r', data: { src: 'today', return: value } }))).toContain('data.return')
  })

  test('the stretch shapes pass: field items and predictions (practice, field), protégé items, the spatial proxy', () => {
    ok(evt('item', 'item:field.decode-kv.tps', T1, { rev: 'r', provenance: 'field', data: { src: 'practice', value: 120, truth: 135, unit: 'tok/s' } }))
    ok(evt('predict', 'item:field.decode-kv.tps', T1, { rev: 'r', provenance: 'field', data: { value: 120, truth: 135, unit: 'tok/s', src: 'practice' } }))
    ok(evt('item', 'item:engine.measured-tps', T1, { rev: 'r', provenance: 'field', data: { src: 'practice', value: 30, truth: 41, unit: 'tok/s' } }))
    ok(evt('predict', 'item:engine.measured-tps', T1, { rev: 'r', provenance: 'field', data: { value: 30, truth: 41, unit: 'tok/s', src: 'practice' } }))
    for (const step of ['find', 'tag', 'fix']) ok(evt('item', `item:t4.l3.protege.1.${step}`, T1, { rev: 'r', data: { src: 'lesson', lessonId: 't4.l3', pick: [1] } }))
    ok(evt('item', 'item:cube.spatial.2', T1, { rev: 'r', data: { src: 'practice', pick: [0] } }))
  })
})

/* ------------------------------------------------------------------ */
/* prove: v1, v2 and provenance proved (§3.2)                           */
/* ------------------------------------------------------------------ */

describe('codec: prove', () => {
  test('v1 is checked as today, and a v checked beyond 1 and 2 is refused', () => {
    ok(prove({ v: 1, qids: ['a', 'b', 'c'], self: [1, 0, 1] }))
    ok(prove({ v: 1, qids: [], self: [], kcs: ['kc.a'] }))
    ok(prove({ qids: ['a'], self: [1] })) // a v1 written before `v` was checked
    for (const data of [undefined, { v: 1, qids: ['a'] }, { v: 1, qids: ['a', 'b'], self: [1] }, { v: 1, qids: [1], self: [1] }, { v: 3, qids: ['a'], self: [1] }, { v: '1', qids: ['a'], self: [1] }]) {
      expect(bad(prove(data))).not.toBeNull()
    }
  })

  test('v2 is accepted: a number or an ordered id list, a null actual, the return flag', () => {
    ok(prove(proveV2()))
    ok(prove(proveV2({ answer: 4, actual: 4 })))
    ok(prove(proveV2({ answer: 4.5, actual: 5.25 })))
    ok(prove(proveV2({ answer: [], actual: null })))
    ok(prove(proveV2({ actual: null, calls: 1 })))
    ok(prove(proveV2({ return: true })))
    ok(prove(proveV2({ kcs: ['a', 'b', 'c', 'd', 'e', 'f'] })))
    ok(prove(proveV2({ qid: 'q'.repeat(40), calls: 12, answer: Array.from({ length: 12 }, (_, i) => i), actual: Array.from({ length: 12 }, (_, i) => i) })))
  })

  test('the malformed v2 cases of §3.2 are each refused', () => {
    expect(bad(prove(proveV2({ calls: 0 })))).toContain('data.calls')
    expect(bad(prove(proveV2({ calls: 13 })))).toContain('data.calls')
    expect(bad(prove(proveV2({ calls: 2.5 })))).toContain('data.calls')
    expect(bad(prove(proveV2({ calls: undefined })))).toContain('data.calls')
    expect(bad(prove(proveV2({ qid: '' })))).toContain('data.qid')
    expect(bad(prove(proveV2({ qid: 'q'.repeat(41) })))).toContain('data.qid')
    expect(bad(prove(proveV2({ kcs: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })))).toContain('data.kcs')
    expect(bad(prove(proveV2({ kcs: [1] })))).toContain('data.kcs')
    expect(bad(prove(proveV2({ kcs: undefined })))).toContain('data.kcs')
    expect(bad(prove(proveV2({ answer: Number.POSITIVE_INFINITY })))).toContain('data.answer')
    expect(bad(prove(proveV2({ answer: '3' })))).toContain('data.answer')
    expect(bad(prove(proveV2({ answer: [1, -1] })))).toContain('data.answer')
    expect(bad(prove(proveV2({ answer: [1.5] })))).toContain('data.answer')
    expect(bad(prove(proveV2({ answer: Array.from({ length: 13 }, (_, i) => i) })))).toContain('data.answer')
    expect(bad(prove(proveV2({ answer: undefined })))).toContain('data.answer')
    expect(bad(prove(proveV2({ actual: undefined })))).toContain('data.actual') // null is a trap or a timeout; absent is a bug
    expect(bad(prove(proveV2({ actual: [-2] })))).toContain('data.actual')
    expect(bad(prove(proveV2({ actual: Array.from({ length: 13 }, (_, i) => i) })))).toContain('data.actual')
    expect(bad(prove(proveV2({ return: false })))).toContain('data.return')
    expect(bad(prove(proveV2({ return: 1 })))).toContain('data.return')
  })

  test('provenance proved is accepted only on a v2 event with ok: true and a 64-hex wasmSha256', () => {
    ok(prove(proveV2(), { provenance: 'proved', wasmSha256: SHA }))
    ok(prove(proveV2({ return: true }), { provenance: 'proved', wasmSha256: SHA2 }))
    // on a v1 event
    expect(bad(prove({ v: 1, qids: ['a'], self: [1] }, { provenance: 'proved', wasmSha256: SHA }))).toContain('proved')
    expect(bad(prove({ qids: ['a'], self: [1] }, { provenance: 'proved', wasmSha256: SHA }))).toContain('proved')
    // on a not-ok event
    expect(bad(prove(proveV2({ actual: [1, 2] }), { provenance: 'proved', wasmSha256: SHA, ok: false, score: 0 }))).toContain('proved')
    // without a hash, or with a short one
    expect(bad(prove(proveV2(), { provenance: 'proved' }))).toContain('proved')
    expect(bad(prove(proveV2(), { provenance: 'proved', wasmSha256: 'ab'.repeat(31) }))).toContain('wasmSha256')
    expect(bad(prove(proveV2(), { provenance: 'proved', wasmSha256: SHA.toUpperCase() }))).toContain('wasmSha256')
    // a v2 event of any other provenance needs no hash
    for (const provenance of ['practice', 'unseen', 'assisted']) ok(prove(proveV2(), { provenance }))
    ok(prove(proveV2(), { ok: false, score: 0 }))
  })
})

/* ------------------------------------------------------------------ */
/* play: metric, levels and EPLB dials (§3.2)                           */
/* ------------------------------------------------------------------ */

describe('codec: play', () => {
  const metric = (over: Record<string, unknown> = {}) => ({ name: 'imbalance', mine: 1.12, ghost: 1.04, lowerIsBetter: true, ...over })

  test('metric, levels and an EPLB spec are accepted; the Wave 1 and Wave 2 plays are unchanged', () => {
    ok(playEvt({ metric: metric() }))
    ok(playEvt({ metric: metric({ mine: 0, ghost: 0 }) }))
    ok(playEvt({ metric: { name: 'imbalance', mine: 1, ghost: 1 } })) // lowerIsBetter absent
    ok(playEvt({ levels: [{ id: 'roofline', ok: true }, { id: 'raster', ok: false, logErr: 0.31, view: '3d' }, { id: 'tile', ok: true, logErr: 0, view: '2d' }] }, 'play:tiling-cube'))
    ok(playEvt({ levels: Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, ok: true })) }, 'play:tiling-cube'))
    ok(playEvt({ levels: [] }, 'play:tiling-cube'))
    for (const replicate of ['none', 'per-copy', 'total']) for (const place of ['round-robin', 'least-loaded']) ok(playEvt({ phase: 'compose', spec: { replicate, place }, equivalent: true }))
    ok(playEvt({ phase: 'compose', spec: { fit: 'best', coalesce: 'eager', minSplit: 16, classes: 'pow2' } }, 'play:block-placement'))
    ok(playEvt({ phase: 'compose', spec: { order: 'sjf', guard: 2000, headroom: 48, preempt: 'none' } }, 'play:scheduler'))
  })

  test('the malformed play cases of §3.2 are each refused', () => {
    expect(bad(playEvt({ levels: [{ id: 'a', ok: 'yes' }] }))).toContain('data.levels')
    expect(bad(playEvt({ levels: [{ id: 'a' }] }))).toContain('data.levels')
    expect(bad(playEvt({ levels: [{ ok: true }] }))).toContain('data.levels')
    expect(bad(playEvt({ levels: [{ id: 'a', ok: true, logErr: -1 }] }))).toContain('data.levels')
    expect(bad(playEvt({ levels: [{ id: 'a', ok: true, logErr: Number.NaN }] }))).toContain('data.levels')
    expect(bad(playEvt({ levels: [{ id: 'a', ok: true, view: '4d' }] }))).toContain('data.levels')
    expect(bad(playEvt({ levels: Array.from({ length: 9 }, (_, i) => ({ id: `l${i}`, ok: true })) }))).toContain('data.levels')
    expect(bad(playEvt({ levels: 'all' }))).toContain('data.levels')
    expect(bad(playEvt({ metric: metric({ name: 'p99' }) }))).toContain('data.metric')
    expect(bad(playEvt({ metric: metric({ mine: -0.1 }) }))).toContain('data.metric')
    expect(bad(playEvt({ metric: metric({ ghost: Number.POSITIVE_INFINITY }) }))).toContain('data.metric')
    expect(bad(playEvt({ metric: metric({ mine: '1.1' }) }))).toContain('data.metric')
    expect(bad(playEvt({ metric: metric({ lowerIsBetter: false }) }))).toContain('lowerIsBetter')
    expect(bad(playEvt({ metric: 3 }))).toContain('data.metric')
    expect(bad(playEvt({ phase: 'compose', spec: { replicate: 'all', place: 'round-robin' } }))).toContain('data.spec')
    expect(bad(playEvt({ phase: 'compose', spec: { replicate: 'none', place: 'random' } }))).toContain('data.spec')
    expect(bad(playEvt({ phase: 'compose', spec: { replicate: 'none' } }))).toContain('data.spec')
  })
})

/* ------------------------------------------------------------------ */
/* fleet-act: receipts, rubric and runs (§3.2)                          */
/* ------------------------------------------------------------------ */

describe('codec: fleet-act data', () => {
  const full = (): FleetActData => ({
    receipts: { cited: 3, verified: 2, uncited: 1 },
    rubric: { capacity: 2, slo: 0, cost: 3, failure: 1 },
    runs: ['7f3a9c21', '00ab12ef'],
  })

  test('no data, the Wave 2 data and FleetActData are accepted', () => {
    ok(evt('fleet-act', 'fw:engine', T1))
    ok(actEvt({ goodput: 20, refGoodput: 40 }))
    ok(actEvt(full()))
    ok(actEvt({ receipts: { cited: 0, verified: 0, uncited: 0 } }))
    ok(actEvt({ rubric: { capacity: 0, slo: 0, cost: 0, failure: 0 } }, 'fw:business'))
    ok(actEvt({ runs: Array.from({ length: 20 }, (_, i) => i.toString(16).padStart(8, '0')) }, 'fw:fleet'))
    ok(actEvt({ ...full(), goodput: 20 })) // extras survive
  })

  test('the malformed fleet-act cases of §3.2 are each refused', () => {
    expect(bad(actEvt({ rubric: { capacity: 4, slo: 0, cost: 0, failure: 0 } }))).toContain('data.rubric')
    expect(bad(actEvt({ rubric: { capacity: 1, slo: -1, cost: 0, failure: 0 } }))).toContain('data.rubric')
    expect(bad(actEvt({ rubric: { capacity: 1.5, slo: 0, cost: 0, failure: 0 } }))).toContain('data.rubric')
    expect(bad(actEvt({ rubric: { capacity: 1, slo: 0, cost: 0 } }))).toContain('data.rubric')
    expect(bad(actEvt({ runs: ['7f3a9c212'] }))).toContain('data.runs') // 9 hex
    expect(bad(actEvt({ runs: ['7F3A9C21'] }))).toContain('data.runs') // not lowercase
    expect(bad(actEvt({ runs: ['7f3a9c2'] }))).toContain('data.runs')
    expect(bad(actEvt({ runs: Array.from({ length: 21 }, (_, i) => i.toString(16).padStart(8, '0')) }))).toContain('data.runs')
    expect(bad(actEvt({ runs: '7f3a9c21' }))).toContain('data.runs')
    expect(bad(actEvt({ receipts: { cited: -1, verified: 0, uncited: 0 } }))).toContain('data.receipts')
    expect(bad(actEvt({ receipts: { cited: 1.5, verified: 0, uncited: 0 } }))).toContain('data.receipts')
    expect(bad(actEvt({ receipts: { cited: 1, verified: 0 } }))).toContain('data.receipts')
    expect(bad(actEvt([]))).toContain('data')
  })
})

/* ------------------------------------------------------------------ */
/* The working keys fw:runs and profile:background (§3.2, §3.5)         */
/* ------------------------------------------------------------------ */

describe('codec: working keys', () => {
  test('fw:runs holds RunRecords, newest last, at most 50', () => {
    expect(badWorking('fw:runs', [])).toBeNull()
    expect(badWorking('fw:runs', [runRecord()])).toBeNull()
    expect(badWorking('fw:runs', [runRecord({ act: 'fleet' }), runRecord({ act: 'business', id: '00000000', entropy: 0xffffffff })])).toBeNull()
    const many = (n: number) => Array.from({ length: n }, (_, i) => runRecord({ id: i.toString(16).padStart(8, '0') }))
    expect(badWorking('fw:runs', many(50))).toBeNull()
    expect(badWorking('fw:runs', many(51))).toContain('at most 50')
    expect(badWorking('fw:runs', {})).toContain('fw:runs')
    expect(badWorking('fw:runs', 'x')).toContain('fw:runs')
  })

  test('each malformed RunRecord is refused', () => {
    expect(badWorking('fw:runs', [runRecord({ id: '7f3a9c212' })])).toContain('id') // 9 hex
    expect(badWorking('fw:runs', [runRecord({ id: '7F3A9C21' })])).toContain('id')
    expect(badWorking('fw:runs', [runRecord({ act: 'incident' })])).toContain('act')
    expect(badWorking('fw:runs', [runRecord({ job: 'x' })])).toContain('job')
    expect(badWorking('fw:runs', [runRecord({ job: [] })])).toContain('job')
    expect(badWorking('fw:runs', [runRecord({ job: { blob: 'x'.repeat(4097) } })])).toContain('job')
    expect(badWorking('fw:runs', [runRecord({ entropy: 0x1_0000_0000 })])).toContain('entropy')
    expect(badWorking('fw:runs', [runRecord({ entropy: -1 })])).toContain('entropy')
    expect(badWorking('fw:runs', [runRecord({ entropy: 1.5 })])).toContain('entropy')
    expect(badWorking('fw:runs', [runRecord({ values: [] })])).not.toBeNull()
    expect(badWorking('fw:runs', [runRecord({ values: { goodput: null } })])).toContain('values')
    expect(badWorking('fw:runs', [runRecord({ values: { goodput: '41' } })])).toContain('values')
    expect(badWorking('fw:runs', [runRecord({ at: 'yesterday' })])).toContain('at')
    expect(badWorking('fw:runs', [runRecord(), 7])).toContain('run record')
  })

  test('a job of exactly 4 KB and 40 values pass; 41 values do not', () => {
    const job = { blob: '' }
    job.blob = 'x'.repeat(4096 - stableStringify(job).length)
    expect(stableStringify(job).length).toBe(4096)
    expect(badWorking('fw:runs', [runRecord({ job })])).toBeNull()
    const values = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]))
    expect(badWorking('fw:runs', [runRecord({ values: values(40) })])).toBeNull()
    expect(badWorking('fw:runs', [runRecord({ values: values(41) })])).toContain('values')
  })

  test('profile:background is one of BACKGROUNDS', () => {
    for (const b of BACKGROUNDS) expect(badWorking('profile:background', b)).toBeNull()
    for (const b of ['rust', '', 'JVM', 3, null, ['sre']]) expect(badWorking('profile:background', b)).toContain('profile:background')
  })

  test('both keys are accepted as working keys, and both are broadcast to other tabs (zoo:config alone is device-local)', () => {
    const rec = (key: WorkingKey, value: unknown) => ({ key, value: value as never, at: T1, dev: 'd' })
    const sent = broadcastableWorking([rec('fw:runs', []), rec('profile:background', 'sre'), rec('zoo:config', '{}'), rec('scroll:t0.l1', 4)])
    expect(sent.map((w) => w.key)).toEqual(['fw:runs', 'profile:background'])
  })
})

/* ------------------------------------------------------------------ */
/* Aggregate v4 folds (§3.4)                                            */
/* ------------------------------------------------------------------ */

describe('aggregate v4 folds', () => {
  const provedAt = (at: string, lab = 'kv-block-manager', extra: Record<string, unknown> = {}) => evt('prove', `prove:${lab}`, at, { provenance: 'proved', wasmSha256: SHA, data: proveV2(), ...extra })

  test('proved[lab] is the earliest ok prove event with provenance proved', () => {
    const agg = derive([provedAt(T3), provedAt(T2), provedAt(T1, 'mpmc-queue')])
    expect(agg.proved).toEqual({ 'kv-block-manager': T2, 'mpmc-queue': T1 })
    expect(agg.proves).toEqual({ 'kv-block-manager': T2, 'mpmc-queue': T1 }) // the v1 map moves with it
    expect(agg.facts['prove:kv-block-manager']).toBe(true)
  })

  test('a practice prove, a v1 prove or a not-ok prove is not proved', () => {
    const agg = derive([
      prove(proveV2(), {}, 'a'),
      prove({ v: 1, qids: ['q'], self: [1] }, {}, 'b'),
      prove(proveV2({ actual: [9] }), { ok: false, score: 0, provenance: 'unseen' }, 'c'),
      prove(proveV2(), { provenance: 'unseen' }, 'd'),
    ])
    expect(agg.proved).toEqual({})
    expect(Object.keys(agg.proves).sort()).toEqual(['a', 'b', 'd']) // the ok ones still count as proves
  })

  test('the earliest proved event wins whichever order they arrive in, and a later practice one does not move it', () => {
    const events = [provedAt(T2), prove(proveV2(), { at: T1 }), provedAt(T3)]
    expect(derive(events).proved['kv-block-manager']).toBe(T2)
    expect(derive([...events].reverse()).proved['kv-block-manager']).toBe(T2)
  })

  test('labFleetOk[lab] is an ok, unseen engine run with exactly one component, from that lab', () => {
    expect(derive([fleetRun('fleet:engine', raceData(), T1, { provenance: 'unseen' })]).labFleetOk).toEqual({ 'batching-scheduler': true })
    const other = raceData({ components: [{ slot: 'allocator', labId: 'rust-allocator', sha256: SHA2 }] })
    expect(derive([fleetRun('fleet:engine', other, T1, { provenance: 'unseen' })]).labFleetOk).toEqual({ 'rust-allocator': true })
  })

  test('no labFleetOk without ok, provenance unseen, mode engine or a lone component', () => {
    const two = raceData({ components: [{ slot: 'scheduler', labId: 'batching-scheduler', sha256: SHA }, { slot: 'allocator', labId: 'rust-allocator', sha256: SHA2 }] })
    const none = raceData({ components: [] })
    const cases: [string, LedgerEvent][] = [
      ['practice provenance', fleetRun('fleet:engine', raceData(), T1, { provenance: 'practice' })],
      ['not ok', fleetRun('fleet:engine', raceData({ goodput: 10 }), T1, { provenance: 'unseen', ok: false, score: 0.2 })],
      ['another mode', fleetRun('fleet:act1', raceData({ mode: 'act1' }), T1, { provenance: 'unseen' })],
      ['two components', fleetRun('fleet:engine', two, T1, { provenance: 'unseen' })],
      ['no component', fleetRun('fleet:engine', none, T1, { provenance: 'unseen' })],
      ['assisted', fleetRun('fleet:engine', raceData(), T1, { provenance: 'assisted' })],
    ]
    for (const [name, e] of cases) expect(`${name}: ${JSON.stringify(derive([e]).labFleetOk)}`).toBe(`${name}: {}`)
    // the v3 maps are unaffected by any of it
    expect(derive(cases.map(([, e]) => e)).fleetRuns.engine).toBeDefined()
  })

  test('a malformed fleet-run data never throws in the fold, and an own __proto__ lab id never reaches the prototype', () => {
    const e = fleetRun('fleet:engine', { components: 'x' }, T1, { provenance: 'unseen' })
    expect(() => derive([e])).not.toThrow()
    const proto = fleetRun('fleet:engine', raceData({ components: [{ slot: 'scheduler', labId: '__proto__', sha256: SHA }] }), T1, { provenance: 'unseen' })
    const agg = derive([proto, provedAt(T1, '__proto__')])
    expect(Object.keys(agg.labFleetOk)).toContain('__proto__')
    expect(Object.keys(agg.proved)).toContain('__proto__')
    expect(Object.getPrototypeOf(agg.labFleetOk)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  test('P6: the new fields do not depend on event order or repeats, over 100 seeds x 40 ops', () => {
    let proved = 0
    let races = 0
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, OPS)
      const events = [...d.events.values()]
      const want = stableStringify(derive(events))
      expect(stableStringify(derive(shuffle(ctx.rand, events)))).toBe(want)
      expect(stableStringify(derive([...events, ...shuffle(ctx.rand, events)]))).toBe(want) // repeats collapse
      const agg = derive(events)
      proved += Object.keys(agg.proved).length
      races += Object.keys(agg.labFleetOk).length
    })
    expect(proved).toBeGreaterThan(0)
    expect(races).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ */
/* The upgrade chain (§3.1)                                             */
/* ------------------------------------------------------------------ */

/** The Wave 2 fold's view of a ledger: today's derive, less the two maps v4 added. */
function deriveV3(events: LedgerEvent[]): AggregateV3 {
  const agg: Partial<Aggregate> & { v: number } = structuredClone(derive(events))
  delete agg.proved
  delete agg.labFleetOk
  agg.v = 3
  return agg as AggregateV3
}

/** The Wave 1 fold's view: v3 less the incident, daily and fleet-run maps and the facts they pay. */
function deriveV2(events: LedgerEvent[]): AggregateV2 {
  const agg: Partial<AggregateV3> & { v: number } = structuredClone(deriveV3(events))
  delete agg.incidents
  delete agg.dailyDays
  delete agg.fleetRuns
  agg.v = 2
  agg.facts = Object.fromEntries(Object.entries(agg.facts ?? {}).filter(([k]) => !/^(inc|fleet):/.test(k)))
  return agg as AggregateV2
}

/** The aggregate restricted to the v3 fields. */
function v3Fields(a: Aggregate | AggregateV3) {
  const agg: Partial<Aggregate> = structuredClone(a)
  delete agg.v
  delete agg.proved
  delete agg.labFleetOk
  return agg
}

function v2Fields(a: Aggregate | AggregateV3 | AggregateV2) {
  const agg: Partial<Aggregate> = structuredClone(a as Aggregate)
  delete agg.v
  delete agg.proved
  delete agg.labFleetOk
  delete agg.incidents
  delete agg.dailyDays
  delete agg.fleetRuns
  return { ...agg, facts: Object.fromEntries(Object.entries(agg.facts ?? {}).filter(([k]) => !/^(inc|fleet):/.test(k))) }
}

describe('upgradeAggregate', () => {
  test('upgradeAggregate(derive_v3(L)) equals derive_v4(L) on every v3 field, over the generated ledgers', () => {
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, OPS)
      const events = d.ledger().events
      const up = upgradeAggregate(deriveV3(events))
      expect(up.v).toBe(4)
      expect(stableStringify(v3Fields(up))).toBe(stableStringify(v3Fields(derive(events))))
      expect(up.proved).toEqual({})
      expect(up.labFleetOk).toEqual({})
    })
  })

  test('upgradeAggregate(derive_v2(L)) equals derive_v4(L) on every v2 field, over the generated ledgers', () => {
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, OPS)
      const events = d.ledger().events
      const up = upgradeAggregate(deriveV2(events))
      expect(up.v).toBe(4)
      expect(stableStringify(v2Fields(up))).toBe(stableStringify(v2Fields(derive(events))))
      expect(up).toMatchObject({ incidents: {}, dailyDays: {}, fleetRuns: {}, proved: {}, labFleetOk: {} })
    })
  })

  test('the full derive replaces the upgrade: proved and labFleetOk fill in', () => {
    const events = [
      evt('prove', 'prove:kv-block-manager', T1, { provenance: 'proved', wasmSha256: SHA, data: proveV2() }),
      fleetRun('fleet:engine', raceData(), T1, { provenance: 'unseen' }),
    ]
    const up = upgradeAggregate(deriveV3(events))
    expect(up.proved).toEqual({})
    expect(up.labFleetOk).toEqual({})
    const full = derive(events)
    expect(full.proved['kv-block-manager']).toBe(T1)
    expect(full.labFleetOk['batching-scheduler']).toBe(true)
    expect(xpOf(up)).toBe(xpOf(full)) // neither map pays XP, so the first paint shows the same number
  })

  test('a version-1 aggregate goes through all three steps', () => {
    const v2 = deriveV2([evt('complete', 'lesson:t0.l1', T1), evt('quiz', 'lesson:t0.l2', T2, { score: 1, ok: true })])
    const v1 = {
      ...structuredClone(v2),
      v: 1,
      lessons: Object.fromEntries(Object.entries(v2.lessons).map(([k, L]) => [k, { done: L.done, completedAt: L.completedAt, lastAt: L.lastAt, quizBest: L.quizBest }])),
      sims: {},
      labs: {},
    }
    const up = upgradeAggregate(v1 as unknown as Parameters<typeof upgradeAggregate>[0])
    expect(up).toMatchObject({ v: 4, incidents: {}, dailyDays: {}, fleetRuns: {}, plays: {}, proves: {}, itemSec: {}, proved: {}, labFleetOk: {} })
    expect(up.lessons['t0.l1']).toMatchObject({ read: true })
    expect(up.lessons['t0.l2'].passedAt).toBe(T2)
  })

  test('the upgrade does not touch its input, and an own __proto__ key survives', () => {
    const v3 = deriveV3([evt('visit', 'lesson:t0.l1', T1)])
    const frozen = structuredClone(v3)
    upgradeAggregate(v3)
    expect(v3).toEqual(frozen)
    const odd = JSON.parse(JSON.stringify(v3).replace('"lessons":{', '"lessons":{"__proto__":{"done":true},')) as AggregateV3
    const up = upgradeAggregate(odd)
    expect(Object.keys(up.lessons)).toContain('__proto__')
    expect(Object.getPrototypeOf(up.lessons)).toBe(Object.prototype)
  })
})

describe('hydrate from a Wave 2 snapshot', () => {
  const wave2Events = (): LedgerEvent[] => [
    evt('complete', 'lesson:t0.l1', T1, { data: { via: 'read' } }),
    evt('quiz', 'lesson:t0.l2', T2, { score: 1, ok: true, data: { n: 1 } }),
    evt('incident', 'inc:daily/2027-05-03', T2, {
      provenance: 'practice',
      data: { v: 1, src: 'daily', fault: 'drain-stall', severity: 2, probes: [], diagnosed: true, fixed: true, burn: 4, expertBurn: 2, streetlight: 1, components: [SHA], date: '2027-05-03' },
    }),
    fleetRun('fleet:engine', raceData(), T2, { provenance: 'unseen' }),
  ]
  const snapshotV3 = (events: LedgerEvent[]) => ({ schemaVersion: 5, aggregateVersion: 3, writtenAt: T2, tab: 'old', aggregate: deriveV3(events), working: [] })

  test('a v3 snapshot paints its numbers at once, upgraded, and boots the engine at once, not on idle', async () => {
    const events = wave2Events()
    const p = makeProfile({ seed: { events, meta: { schema: { version: 5, at: T1 } } } })
    p.storage.data.set(SNAPSHOT_KEY, JSON.stringify(snapshotV3(events)))
    const tab = startTab(p) // scheduleBoot is a no-op, so anything the engine does is the upgrade's doing
    const s = tab.progress.getState()
    expect(s.lessons['t0.l1']?.status).toBe('read') // no empty first paint
    expect(s.lessons['t0.l2']?.status).toBe('done')
    expect(s.aggregate.dailyDays['2027-05-03']).toBe(true) // the v3 maps came across
    expect(s.aggregate).toMatchObject({ v: 4, proved: {}, labFleetOk: {} })
    expect(s.xp).toBe(xpOf(derive(events)))
    expect(s.ledger).toMatchObject({ ready: false, readOnly: false })
    expect(tab.loads()).toBe(1)

    await tab.progress.controls.flush()
    await tab.progress.controls.engine()
    await tick(5)
    expect(tab.progress.getState().ledger.ready).toBe(true)
    expect(stableStringify(tab.progress.getState().aggregate)).toBe(stableStringify(derive(events)))
    expect(tab.progress.getState().aggregate.labFleetOk).toEqual({ 'batching-scheduler': true })
  })

  test('a v2 snapshot (Wave 1) is upgraded through all three steps and boots the engine at once', async () => {
    const events = wave2Events().slice(0, 2)
    const p = makeProfile({ seed: { events, meta: { schema: { version: 4, at: T1 } } } })
    p.storage.data.set(SNAPSHOT_KEY, JSON.stringify({ ...snapshotV3(events), schemaVersion: 4, aggregateVersion: 2, aggregate: deriveV2(events) }))
    const tab = startTab(p)
    expect(tab.progress.getState().lessons['t0.l2']?.status).toBe('done')
    expect(tab.progress.getState().aggregate).toMatchObject({ v: 4, incidents: {}, proved: {}, labFleetOk: {} })
    expect(tab.loads()).toBe(1)
  })

  test('a v4 snapshot of this bundle does not boot the engine early; one with a missing new map is ignored', async () => {
    const p = makeProfile()
    const first = startTab(p)
    first.progress.getState().recordProve({ labId: 'lab-a', score: 1, ok: true, provenance: 'proved', wasmSha256: SHA, data: proveV2() as unknown as ProveData })
    await first.progress.controls.flush()
    const second = startTab(p)
    expect(second.progress.getState().aggregate.proved['lab-a']).toEqual(expect.any(String))
    expect(second.loads()).toBe(0)

    const broken = { ...snapshotV3(wave2Events()), schemaVersion: SCHEMA_VERSION, aggregateVersion: AGGREGATE_VERSION, aggregate: { ...derive(wave2Events()) } as Partial<Aggregate> }
    delete broken.aggregate.proved
    const q = makeProfile()
    q.storage.data.set(SNAPSHOT_KEY, JSON.stringify(broken))
    const tab = startTab(q)
    expect(tab.progress.getState().lessons).toEqual({})
    tab.progress.getState().recordProve({ labId: 'lab-a', score: 1, ok: true, provenance: 'proved', wasmSha256: SHA, data: proveV2() as unknown as ProveData }) // an action on the empty aggregate does not throw
    expect(tab.progress.getState().aggregate.proved['lab-a']).toBeDefined()
  })

  test('a v3 snapshot written by a newer schema still goes read-only', () => {
    const p = makeProfile()
    p.storage.data.set(SNAPSHOT_KEY, JSON.stringify({ ...snapshotV3(wave2Events()), schemaVersion: SCHEMA_VERSION + 1 }))
    const tab = startTab(p)
    expect(tab.progress.getState().ledger).toMatchObject({ readOnly: true, reason: 'snapshot-newer' })
    expect(tab.loads()).toBe(0)
  })

  test('a Wave 2 fixture ledger derives identically on every v3 field', () => {
    // One of each Wave 2 shape, as a Wave 2 tab would have written them (plus the Wave 1 shapes they sit beside).
    const events: LedgerEvent[] = [
      evt('complete', 'lesson:t0.l1', T1, { data: { via: 'read' } }),
      evt('quiz', 'lesson:t0.l2', T1, { score: 1, ok: true, data: { form: 'ticket', n: 3, kcs: ['kc.a'] } }),
      evt('item', 'gen:sig/name-fault', T1, { rev: 'r', provenance: 'unseen', seed: 3, data: { src: 'daily', nsec: 40, kcs: ['kc.a'] } }),
      evt('item', 'gen:goodput/knee', T1, { rev: 'r', data: { src: 'lesson', nsec: 30 } }),
      evt('lab-check', 'lab:rust-allocator', T2, { provenance: 'unseen', data: { passed: ['boot', 'align'], total: 6, abi: 2, seeds: 'fresh', checks: [{ id: 'boot', status: 'pass', fresh: true }] } }),
      evt('play', 'play:scheduler', T2, { data: { phase: 'compose', turns: 2, survived: 0, ghostSurvived: 0, spec: { order: 'sjf', guard: 2000, headroom: 48, preempt: 'none' }, equivalent: true } }),
      evt('prove', 'prove:rust-allocator', T2, { data: { v: 1, qids: ['q'], self: [1] } }),
      evt('fleet-act', 'fw:engine', T2, { provenance: 'unseen', seed: 4, data: { goodput: 41, refGoodput: 42 } }),
      evt('incident', 'inc:daily/2027-05-03', T2, {
        provenance: 'practice',
        data: { v: 1, src: 'daily', fault: 'drain-stall', severity: 2, probes: ['queue-depth'], diagnosed: true, fixed: true, burn: 4, expertBurn: 2, streetlight: 1, components: [SHA], date: '2027-05-03' },
      }),
      evt('incident', 'inc:drill/straggler', T2, {
        provenance: 'unseen',
        ok: false,
        score: 0,
        data: { v: 1, src: 'drill', fault: 'straggler', severity: 1, probes: [], diagnosed: false, fixed: false, burn: 9, expertBurn: 3, streetlight: 2, components: [] },
      }),
      fleetRun('fleet:act1', raceData({ mode: 'act1' }), T2, { provenance: 'unseen' }),
      fleetRun('fleet:cluster', raceData({ mode: 'cluster', seeds: 'practice' }), T3, { provenance: 'practice', ok: false, score: 0.5 }),
      evt('ack', 'packet:lab/kv-block-manager/cow', T2, { data: { via: 'claude', chars: 4200 } }),
      evt('ack', 'hint:rust-allocator/boot#bottom', T2),
      evt('complete', 'placement', T3),
    ]
    const v3 = deriveV3(events)
    const v4 = derive(events)
    expect(stableStringify(v3Fields(v4))).toBe(stableStringify(v3Fields(v3)))
    // the v3 maps, spelled out
    expect(v4.incidents['inc:daily/2027-05-03']).toEqual({ n: 1, best: 1, okAt: T2 })
    expect(v4.incidents['inc:drill/straggler']).toEqual({ n: 1, best: 0 })
    expect(v4.dailyDays).toEqual({ '2027-05-03': true })
    expect(v4.fleetRuns.act1).toEqual({ best: 1, own: true, unseenOk: true })
    expect(v4.fleetRuns.cluster).toEqual({ best: 0.5, own: true })
    expect(v4.acks['packet:lab/kv-block-manager/cow']).toBe(T2)
    // and nothing in a Wave 2 ledger is proved; the v4 views agree with the upgrade of the v3 aggregate
    expect(v4.proved).toEqual({})
    expect(v4.labFleetOk).toEqual({})
    expect(toProgressData(v4)).toEqual(toProgressData(upgradeAggregate(v3)))
    expect(xpOf(v4)).toBe(xpOf(upgradeAggregate(v3)))
  })
})

/* ------------------------------------------------------------------ */
/* The façade (§3.3)                                                    */
/* ------------------------------------------------------------------ */

describe('façade: recordProve, recordPlay and the working keys', () => {
  const stored = async (tab: ReturnType<typeof startTab>) => {
    await tab.progress.controls.flush()
    return (await (await tab.engine()).events()) as unknown as Array<LedgerEvent & { provenance: string; wasmSha256?: string; data: Record<string, unknown> }>
  }

  test('recordProve defaults to practice with ProveData v1, unchanged', async () => {
    const tab = startTab(makeProfile())
    tab.progress.getState().recordProve({ labId: 'lab-a', score: 2 / 3, ok: true, ms: 120000, data: { v: 1, qids: ['q1', 'q2', 'q3'], self: [1, 1, 0] } })
    const events = await stored(tab)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'prove', ref: 'prove:lab-a', provenance: 'practice', ok: true, ms: 120000, data: { v: 1 } })
    expect(events[0].wasmSha256).toBeUndefined()
    expect(tab.progress.getState().aggregate.proved).toEqual({})
    expect(tab.progress.getState().aggregate.proves['lab-a']).toEqual(expect.any(String))
  })

  test('recordProve with provenance proved writes a v2 event with its hash, and the fold derives proved[lab]', async () => {
    const tab = startTab(makeProfile())
    tab.progress.getState().recordProve({ labId: 'lab-a', score: 1, ok: true, provenance: 'proved', wasmSha256: SHA, data: proveV2() as unknown as ProveData })
    expect(tab.progress.getState().aggregate.proved['lab-a']).toEqual(expect.any(String))
    const events = await stored(tab)
    expect(events[0]).toMatchObject({ provenance: 'proved', wasmSha256: SHA, ok: true, data: { v: 2, qid: 'free-after' } })
    expect(validateEvent(events[0]).ok).toBe(true)
  })

  test('proved is only written when the codec would accept it: a not-ok, v1 or hash-less request is written as practice', async () => {
    const tab = startTab(makeProfile())
    const s = tab.progress.getState()
    s.recordProve({ labId: 'a', score: 0, ok: false, provenance: 'proved', wasmSha256: SHA, data: proveV2({ actual: null }) as unknown as ProveData })
    s.recordProve({ labId: 'b', score: 1, ok: true, provenance: 'proved', wasmSha256: SHA, data: { v: 1, qids: ['q'], self: [1] } })
    s.recordProve({ labId: 'c', score: 1, ok: true, provenance: 'proved', data: proveV2() as unknown as ProveData })
    expect(tab.progress.getState().aggregate.proved).toEqual({})
    const events = await stored(tab)
    expect(events).toHaveLength(3)
    for (const e of events) expect(e.provenance).toBe('practice')
    expect((await (await tab.engine()).events()).length).toBe(3) // none was lost at the flush
  })

  test('an over-long KC list on a v2 prove is cut to 6, so the event is never refused at the flush', async () => {
    const tab = startTab(makeProfile())
    tab.progress.getState().recordProve({ labId: 'lab-a', score: 1, ok: true, data: proveV2({ kcs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }) as unknown as ProveData })
    const events = await stored(tab)
    expect(events).toHaveLength(1)
    expect(events[0].data.kcs).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  test('recordPlay carries the metric, the levels and the EPLB dials through; more than 8 levels are cut', async () => {
    const tab = startTab(makeProfile())
    const s = tab.progress.getState()
    const data: PlayData = { phase: 'play', turns: 20, survived: 0, ghostSurvived: 0, metric: { name: 'imbalance', mine: 1.1, ghost: 1.05, lowerIsBetter: true } }
    s.recordPlay({ playId: 'eplb', score: 0.95, ok: true, seed: 3, provenance: 'unseen', data })
    s.recordPlay({ playId: 'eplb', score: 1, ok: true, seed: 4, provenance: 'unseen', data: { phase: 'compose', turns: 2, survived: 0, ghostSurvived: 0, spec: { replicate: 'total', place: 'least-loaded' }, equivalent: true } })
    s.recordPlay({
      playId: 'tiling-cube',
      score: 0.5,
      ok: true,
      seed: 5,
      provenance: 'unseen',
      data: { phase: 'play', turns: 6, survived: 0, ghostSurvived: 0, levels: Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, ok: i % 2 === 0, view: '2d' as const })) },
    })
    const events = await stored(tab)
    expect(events).toHaveLength(3)
    expect(events.find((e) => e.data.metric)?.data.metric).toEqual({ name: 'imbalance', mine: 1.1, ghost: 1.05, lowerIsBetter: true })
    expect(events.find((e) => e.data.spec)?.data.spec).toEqual({ replicate: 'total', place: 'least-loaded' })
    expect((events.find((e) => e.data.levels)?.data.levels as unknown[]).length).toBe(8)
    expect(tab.progress.getState().aggregate.plays).toMatchObject({ eplb: { done: true, composed: true, best: 1 }, 'tiling-cube': { done: true } })
  })

  test('setWorking(fw:runs) keeps the newest 50, newest last; profile:background is stored and read back', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const records = Array.from({ length: 60 }, (_, i) => runRecord({ id: i.toString(16).padStart(8, '0'), entropy: i }))
    tab.progress.getState().setWorking('fw:runs', records as never)
    tab.progress.getState().setWorking('profile:background', 'ml')
    const runs = tab.progress.getState().working['fw:runs'] as unknown as RunRecord[]
    expect(runs).toHaveLength(50)
    expect(runs[0].entropy).toBe(10)
    expect(runs[49].entropy).toBe(59)
    expect(tab.progress.getState().working['profile:background']).toBe('ml')
    await tab.progress.controls.flush()
    const reload = startTab(p)
    await reload.progress.controls.engine()
    expect((reload.progress.getState().working['fw:runs'] as unknown[]).length).toBe(50)
    expect(reload.progress.getState().working['profile:background']).toBe('ml')
  })

  test('completeFleetWeekAct carries FleetActData as the act\'s data, with the seed and provenance unseen', async () => {
    const tab = startTab(makeProfile())
    const data: FleetActData = { receipts: { cited: 3, verified: 3, uncited: 0 }, rubric: { capacity: 3, slo: 2, cost: 2, failure: 1 }, runs: ['7f3a9c21'] }
    tab.progress.getState().completeFleetWeekAct('engine', 0.9, { seed: 99, provenance: 'unseen', data })
    const events = await stored(tab)
    expect(events[0]).toMatchObject({ kind: 'fleet-act', ref: 'fw:engine', provenance: 'unseen', seed: 99, data })
    expect(tab.progress.getState().fleetWeek.actsDone).toContain('engine')
  })

  test('recordItems writes the form, return, play and field shapes unchanged', async () => {
    const tab = startTab(makeProfile())
    tab.progress.getState().recordItems([
      { kind: 'item', ref: 'gen:kv/bytes-per-token', rev: 'f', score: 1, ok: true, data: { src: 'form', formId: 'C', track: 't5', formSlot: 7, formSet: 0 } },
      { kind: 'item', ref: 'item:lab02.prove.free-order', rev: 'v', score: 0, ok: false, data: { src: 'today', return: true } },
      { kind: 'predict', ref: 'gen:tiling/raster-ai', rev: 'p', score: 1, ok: true, data: { value: 7, unit: 'x', truth: 7, src: 'play' } },
    ])
    const events = await stored(tab)
    expect(events).toHaveLength(3)
    expect(events.find((e) => e.data.src === 'form')?.data).toMatchObject({ formId: 'C', track: 't5', formSlot: 7, formSet: 0 })
    expect(events.find((e) => e.data.return)?.data).toMatchObject({ src: 'today', return: true })
    for (const e of events) expect(validateEvent(e).ok).toBe(true)
  })

  test('a read-only tab writes nothing through the Wave 3 shapes', async () => {
    const p = makeProfile({ seed: { meta: { schema: { version: SCHEMA_VERSION + 1, at: T1 } } } })
    const tab = startTab(p)
    await tab.progress.controls.engine().catch(() => undefined)
    const s = tab.progress.getState()
    s.recordProve({ labId: 'lab-a', score: 1, ok: true, provenance: 'proved', wasmSha256: SHA, data: proveV2() as unknown as ProveData })
    s.recordPlay({ playId: 'eplb', score: 1, ok: true, seed: 1, provenance: 'unseen', data: { phase: 'play', turns: 1, survived: 0, ghostSurvived: 0 } })
    s.setWorking('profile:background', 'jvm')
    s.setWorking('fw:runs', [runRecord()] as never)
    expect((await p.store.readAll()).events).toHaveLength(0)
    expect((await p.store.readAll()).working).toHaveLength(0)
  })
})

describe('the outbox flush keeps every Wave 3 shape', () => {
  test('a tab that never reached the engine leaves its events in the outbox; the next load commits all of them', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const s = tab.progress.getState()
    s.recordProve({ labId: 'lab-a', score: 1, ok: true, provenance: 'proved', wasmSha256: SHA, data: proveV2() as unknown as ProveData })
    s.recordProve({ labId: 'lab-b', score: 0, ok: false, data: proveV2({ actual: null, return: true }) as unknown as ProveData })
    s.recordPlay({ playId: 'eplb', score: 0.9, ok: true, seed: 3, provenance: 'unseen', data: { phase: 'play', turns: 20, survived: 0, ghostSurvived: 0, metric: { name: 'imbalance', mine: 1.1, ghost: 1.05, lowerIsBetter: true } } })
    s.recordPlay({ playId: 'tiling-cube', score: 0.5, ok: true, seed: 5, provenance: 'unseen', data: { phase: 'play', turns: 6, survived: 0, ghostSurvived: 0, levels: [{ id: 'roofline', ok: true, view: '3d' }] } })
    s.completeFleetWeekAct('engine', 0.8, { seed: 7, provenance: 'unseen', data: { receipts: { cited: 2, verified: 2, uncited: 0 }, rubric: { capacity: 1, slo: 1, cost: 1, failure: 1 }, runs: ['7f3a9c21'] } })
    s.recordItems([
      { kind: 'item', ref: 'gen:kv/bytes-per-token', rev: 'f', score: 1, ok: true, data: { src: 'form', formId: 'A', track: 't0', formSlot: 0, formSet: 0 } },
      { kind: 'item', ref: 'item:lab02.prove.free-order', rev: 'v', score: 1, ok: true, data: { src: 'today', return: true } },
      { kind: 'item', ref: 'gen:tiling/raster-ai', rev: 'p', score: 1, ok: true, data: { src: 'play' } },
      { kind: 'predict', ref: 'item:engine.measured-tps', rev: 'm', score: 0, ok: false, provenance: 'field', data: { value: 90, unit: 'tok/s', truth: 40, src: 'practice' } },
    ])
    s.setWorking('fw:runs', [runRecord()] as never)
    s.setWorking('profile:background', 'student')

    const box = readOutbox(p.storage, tab.tabId)!
    expect(box.events).toHaveLength(9)
    for (const e of box.events) expect(validateEvent(e).ok ? '' : `${e.kind} ${e.ref}: ${bad(e)}`).toBe('')
    for (const w of box.working) expect(validateWorkingRecord(w).ok).toBe(true)
    expect(box.working.map((w) => w.key).sort()).toEqual(['fw:runs', 'profile:background'])
    const expected = new Set(box.events.map((e) => e.id))

    const next = startTab(p)
    await next.progress.controls.engine()
    const stored = await (await next.engine()).events()
    expect(new Set(stored.map((e) => e.id))).toEqual(expected)
    expect(next.progress.getState().working['profile:background']).toBe('student')
    expect(next.progress.getState().aggregate.proved['lab-a']).toEqual(expect.any(String))
  })

  test('every event the generator writes, Wave 3 shapes included, passes validateEvent, and every shape is reached', () => {
    const seen = new Set<string>()
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, OPS)
      for (const e of d.events.values()) {
        expect(validateEvent(e).ok ? '' : `${e.kind} ${e.ref}: ${bad(e)}`).toBe('')
        const data = (e as { data?: Record<string, unknown> }).data ?? {}
        if (e.kind === 'prove' && data.v === 2) seen.add(e.provenance === 'proved' ? 'proved' : 'prove-v2')
        if (e.kind === 'item' && data.src === 'form') seen.add('form')
        if (e.kind === 'item' && data.return === true) seen.add('return')
        if ((e.kind === 'item' || e.kind === 'predict') && data.src === 'play') seen.add('play-src')
        if (e.kind === 'predict' && data.src === 'practice') seen.add('predict-practice')
        if (e.provenance === 'field') seen.add('field')
        if (e.kind === 'play' && data.metric) seen.add('metric')
        if (e.kind === 'play' && data.levels) seen.add('levels')
        if (e.kind === 'fleet-act' && data.receipts) seen.add('receipts')
        if (e.kind === 'fleet-run' && e.ref === 'fleet:engine') seen.add('engine-race')
      }
      for (const w of d.working.values()) {
        expect(validateWorkingRecord(w).ok).toBe(true)
        if (w.key === 'fw:runs' || w.key === 'profile:background') seen.add(w.key)
      }
    })
    expect([...seen].sort()).toEqual(['engine-race', 'field', 'form', 'fw:runs', 'levels', 'metric', 'play-src', 'predict-practice', 'proved', 'profile:background', 'prove-v2', 'receipts', 'return'].sort())
  })
})

/* ------------------------------------------------------------------ */
/* Round trip and properties (§3.6)                                     */
/* ------------------------------------------------------------------ */

describe('export round trip', () => {
  test('every generated ledger, Wave 3 ops included, survives export -> JSON -> import(replace)', () => {
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, OPS)
      const text = serializeExport(buildExportV3({ ...d.ledger(), device: d.id, exportedAt: T3 }))
      const parsed = parseImport(JSON.stringify(JSON.parse(text)))
      if (!parsed.ok) throw new Error(`${parsed.error}: ${parsed.detail}`)
      const back = applyImport({ events: [], working: [] }, parsed.file, 'replace')
      expect(ledgerKey(back)).toBe(ledgerKey(d.ledger()))
      expect(derive(back.events)).toEqual(derive(d.ledger().events))
    })
  })

  test('the new shapes in a hand-made ledger survive the round trip byte for byte', () => {
    const events = [
      prove(proveV2(), { provenance: 'proved', wasmSha256: SHA }),
      formItem(),
      evt('item', 'item:lab02.prove.free-order', T1, { rev: 'r', data: { src: 'today', return: true } }),
      playEvt({ metric: { name: 'imbalance', mine: 1.1, ghost: 1.05, lowerIsBetter: true } }),
      actEvt({ receipts: { cited: 1, verified: 1, uncited: 0 }, rubric: { capacity: 1, slo: 2, cost: 3, failure: 0 }, runs: ['7f3a9c21'] }),
    ]
    const working = [
      { key: 'fw:runs' as const, value: [runRecord()] as never, at: T1, dev: 'hand' },
      { key: 'profile:background' as const, value: 'backend', at: T1, dev: 'hand' },
    ]
    const text = serializeExport(buildExportV3({ events, working, device: 'hand', exportedAt: T3 }))
    const parsed = parseImport(text)
    if (!parsed.ok) throw new Error(`${parsed.error}: ${parsed.detail}`)
    expect(serializeExport(parsed.file)).toBe(text)
    expect(parsed.file.events).toHaveLength(5)
    expect(parsed.file.working).toHaveLength(2)
  })

  test('RunRecord and FleetActData are typed as the approved shapes', () => {
    const r: RunRecord = { id: '7f3a9c21', act: 'business', job: { kind: 'business' }, entropy: 1, values: { 'costPerMtok.h100': 1.5 }, at: T1 }
    const act: FleetActData = { receipts: { cited: 1, verified: 1, uncited: 0 }, rubric: { capacity: 0, slo: 1, cost: 2, failure: 3 }, runs: [r.id] }
    const bg: Background = 'other'
    expect([Object.keys(r).sort(), Object.keys(act).sort(), bg]).toEqual([['act', 'at', 'entropy', 'id', 'job', 'values'], ['receipts', 'rubric', 'runs'], 'other'])
    expect(badWorking('fw:runs', [r])).toBeNull()
  })

  test('the generator reaches every Wave 3 op at least once over the seeds', () => {
    const seen = new Set<string>()
    const ops = ['prove-v2', 'form-item', 'return-item', 'play-item', 'stretch-item', 'play-metric', 'fleet-act-receipts', 'engine-race']
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, int(ctx.rand, OPS, OPS))
      for (const line of ctx.trace) for (const op of ops) if (line.includes(` ${op} `) || line.endsWith(` ${op}`)) seen.add(op)
    })
    expect([...seen].sort()).toEqual([...ops].sort())
  })
})
