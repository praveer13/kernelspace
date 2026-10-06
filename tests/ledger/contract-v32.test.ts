/**
 * Ledger contract v3.2 (wave-2.md §3, task 2a-01): schema 5 and aggregate 3, the incident and fleet-run refs and
 * data, `packet:` acks, the `lesson` and `daily` item sources, the four working keys, the aggregate v3 folds, the
 * upgrade chain, the Wave 2 façade actions and component writes through the memory store. The property suite
 * (fold, codec, engine, façade) runs the Wave 2 ops from gen.ts, so this file pins the rules those properties lean on.
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import {
  applyImport,
  buildExportV3,
  parseImport,
  serializeExport,
  slotHashes,
  validateEvent,
  validateWorkingRecord,
} from '../../src/lib/ledger/codec'
import { AGGREGATE_VERSION, ENGINE_SLOTS, FAULT_IDS, FLEET_RUN_MODES, SCHEMA_VERSION } from '../../src/lib/ledger/constants'
import {
  derive,
  emptyAggregate,
  fleetRunOk,
  fleetRunScore,
  GRADED_KINDS,
  incidentOk,
  incidentScore,
  upgradeAggregate,
} from '../../src/lib/ledger/fold'
import { checkMessage, checkSnapshot, checkStoreInfo, createGuard } from '../../src/lib/ledger/guard'
import { MemoryStore } from '../../src/lib/ledger/memory-store'
import { mergeLedgers } from '../../src/lib/ledger/merge'
import { SNAPSHOT_KEY } from '../../src/lib/ledger/names'
import { readOutbox } from '../../src/lib/ledger/outbox'
import { parseFleetRunRef, parseIncidentRef, refMatchesKind } from '../../src/lib/ledger/refs'
import { sha256Hex, stableStringify } from '../../src/lib/ledger/stable'
import type { Aggregate, AggregateV2, EngineSlots, FleetRunData, IncidentData, LedgerEvent, WorkingRecord } from '../../src/lib/ledger/types'
import { toProgressData, workingMap, xpOf } from '../../src/lib/ledger/view'
import { broadcastableWorking } from '../../src/lib/ledger/channel'
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

const incData = (over: Partial<IncidentData> & Record<string, unknown> = {}): IncidentData =>
  ({
    v: 1,
    src: 'daily',
    fault: 'drain-stall',
    severity: 2,
    probes: ['queue-depth'],
    diagnosed: true,
    fixed: true,
    burn: 4,
    expertBurn: 2,
    streetlight: 1,
    components: [SHA],
    date: '2027-05-03',
    ...over,
  }) as IncidentData

const runData = (over: Partial<FleetRunData> & Record<string, unknown> = {}): FleetRunData =>
  ({
    v: 1,
    mode: 'act1',
    components: [{ slot: 'allocator', labId: 'rust-allocator', sha256: SHA }],
    seeds: 'fresh',
    goodput: 40,
    refGoodput: 41,
    ...over,
  }) as FleetRunData

const incident = (ref: string, data: unknown, at = T1, extra: Record<string, unknown> = {}) => evt('incident', ref, at, { data, ...extra })
const fleetRun = (ref: string, data: unknown, at = T1, extra: Record<string, unknown> = {}) => evt('fleet-run', ref, at, { data, ...extra })
const packetAck = (ref: string, data: unknown) => evt('ack', ref, T1, { data })

const slotEntry = (sha256 = SHA, over: Record<string, unknown> = {}) => ({ sha256, labId: 'kv-block-manager', version: 1, at: T1, ...over })

/* ------------------------------------------------------------------ */
/* Versions and the schema guard (§3.1)                                 */
/* ------------------------------------------------------------------ */

describe('versions and the schema guard', () => {
  test('SCHEMA_VERSION 5 and AGGREGATE_VERSION 3', () => {
    expect(SCHEMA_VERSION).toBe(5)
    expect(AGGREGATE_VERSION).toBe(3)
    expect(emptyAggregate()).toMatchObject({ v: 3, incidents: {}, dailyDays: {}, fleetRuns: {} })
  })

  test('a Wave 1 bundle (schema 4) goes read-only on a v5 snapshot, hello, store or file; a v5 bundle reads v4 data', () => {
    expect(checkSnapshot(4, { schemaVersion: 5 })).toBe('snapshot-newer')
    expect(checkMessage(4, { schemaVersion: 5 })).toBe('newer-schema')
    expect(checkStoreInfo(4, { backend: 'idb', schemaVersion: 5, readOnly: false })).toBe('newer-schema')
    const guard = createGuard(4)
    expect(guard.message({ schemaVersion: SCHEMA_VERSION })).toBe(true)
    expect(guard.reason).toBe('newer-schema')

    expect(checkSnapshot(SCHEMA_VERSION, { schemaVersion: 4 })).toBeNull()
    expect(checkMessage(SCHEMA_VERSION, { schemaVersion: 4 })).toBeNull()
    expect(checkStoreInfo(SCHEMA_VERSION, { backend: 'idb', schemaVersion: 4, readOnly: false })).toBeNull()
  })

  test('the engine of a Wave 1 bundle goes read-only on a database a v5 bundle opened, and writes nothing', async () => {
    const p = makeProfile()
    const wave2 = startTab(p)
    wave2.progress.getState().recordHelp('packet:lesson/t5.l4', { via: 'copy', chars: 10 })
    await wave2.progress.controls.flush()
    const old = startTab(p, { schemaVersion: 4 })
    const engine = await old.engine()
    expect(engine.status()).toMatchObject({ readOnly: true, reason: 'newer-schema' })
    const before = (await p.store.readAll()).events.length
    await engine.append([evt('visit', 'lesson:t0.l1', T1)], [])
    expect((await p.store.readAll()).events).toHaveLength(before)
  })

  test('the meta schema moves up to 5 on the first v5 boot, and the snapshot it writes is read-only to a Wave 1 bundle', async () => {
    const p = makeProfile({ seed: { meta: { schema: { version: 4, at: T1 } } } })
    const tab = startTab(p)
    await tab.progress.controls.engine()
    expect((await p.store.readAll()).meta.schema?.version).toBe(5)
    tab.progress.getState().recordVisit('boot')
    await tab.progress.controls.flush()
    const snap = JSON.parse(p.storage.data.get(SNAPSHOT_KEY)!) as { schemaVersion: number; aggregateVersion: number }
    expect(snap).toMatchObject({ schemaVersion: 5, aggregateVersion: 3 })
    expect(checkSnapshot(4, snap)).toBe('snapshot-newer')
  })

  test('exports carry schemaVersion 5; import accepts every older one and refuses 6', () => {
    const file = buildExportV3({ events: [], working: [], device: 'd', exportedAt: T1 })
    expect(file).toMatchObject({ version: 3, schemaVersion: 5 })
    for (const v of [1, 3, 4, 5]) expect(parseImport(JSON.stringify({ ...file, schemaVersion: v })).ok).toBe(true)
    expect(parseImport(JSON.stringify({ ...file, schemaVersion: 6 }))).toMatchObject({ ok: false, error: 'newer-schema' })
  })

  test('the constants lists are what §3.2 names', () => {
    expect([...FAULT_IDS]).toEqual(['pool-shrink', 'drain-stall', 'node-death', 'tenant-burst', 'straggler', 'admission-greedy'])
    expect([...FLEET_RUN_MODES]).toEqual(['engine', 'cluster', 'epd', 'act1', 'act2', 'daily'])
    expect([...ENGINE_SLOTS]).toEqual(['scheduler', 'block-manager', 'intake', 'prefix-router', 'tokenizer', 'executor', 'grammar', 'allocator'])
    expect(GRADED_KINDS.has('incident') && GRADED_KINDS.has('fleet-run')).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Refs (§3.2)                                                          */
/* ------------------------------------------------------------------ */

describe('refs', () => {
  test('incident refs: daily, drill and team', () => {
    for (const ref of ['inc:daily/2027-05-03', 'inc:daily/2028-02-29', 'inc:drill/drain-stall', 'inc:drill/admission-greedy', 'inc:team/blue/2027-05-03']) {
      expect(refMatchesKind('incident', ref)).toBe(true)
    }
    expect(parseIncidentRef('inc:daily/2027-05-03')).toEqual({ src: 'daily', date: '2027-05-03' })
    expect(parseIncidentRef('inc:drill/node-death')).toEqual({ src: 'drill', fault: 'node-death' })
    expect(parseIncidentRef('inc:team/blue/2027-05-03')).toEqual({ src: 'team', code: 'blue', date: '2027-05-03' })
  })

  test('malformed incident refs are refused, and the old "any non-empty ref" is gone', () => {
    for (const ref of [
      'inc:daily/2027-13-01', 'inc:daily/2027-02-30', 'inc:daily/2027-5-3', 'inc:daily/', 'inc:daily', 'inc:daily/x',
      'inc:drill/', 'inc:drill/nope', 'inc:drill/Drain-Stall', 'inc:team/blue', 'inc:team/blue/', 'inc:team//2027-05-03',
      'inc:team/blue/2027-99-01', 'inc:weekly/2027-05-03', 'inc:', 'incident', 'x', '',
    ]) {
      expect(refMatchesKind('incident', ref)).toBe(false)
    }
  })

  test('fleet-run refs: one per mode', () => {
    for (const mode of FLEET_RUN_MODES) expect(refMatchesKind('fleet-run', `fleet:${mode}`)).toBe(true)
    expect(parseFleetRunRef('fleet:act1')).toBe('act1')
    for (const ref of ['fleet:', 'fleet:nope', 'fleet:Act1', 'fleet', 'fleet:act1/x', 'x', '']) expect(refMatchesKind('fleet-run', ref)).toBe(false)
  })

  test('packet acks: lab, lesson and sim', () => {
    for (const ref of ['packet:lab/kv-block-manager/cow', 'packet:lesson/t5.l4', 'packet:sim/sim-kv']) expect(refMatchesKind('ack', ref)).toBe(true)
    for (const ref of ['packet:', 'packet:lab/', 'packet:lab/kv', 'packet:lab/kv/', 'packet:lab//cow', 'packet:lab/a/b/c', 'packet:lesson/', 'packet:lesson/a/b', 'packet:sim/', 'packet:sim/a/b', 'packet:x/y', 'packet:lesson']) {
      expect(refMatchesKind('ack', ref)).toBe(false)
    }
    // the older ack grammars are untouched
    for (const ref of ['erratum:e1', 'screen:welcome', 'hint:lab-a/c1#R1']) expect(refMatchesKind('ack', ref)).toBe(true)
    expect(refMatchesKind('item', 'packet:lesson/t5.l4')).toBe(false)
  })

  test('play:scheduler and the new gen refs ride the existing grammars', () => {
    expect(refMatchesKind('play', 'play:scheduler')).toBe(true)
    for (const ref of ['gen:goodput/knee', 'gen:sig/name-fault', 'gen:compile/verdict', 'item:lab02.primm.p1', 'item:lab02.prove.q1', 'item:engine.bpe-gap']) {
      for (const kind of ['item', 'probe', 'predict'] as const) expect(refMatchesKind(kind, ref)).toBe(true)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Codec: data shapes (§3.2)                                            */
/* ------------------------------------------------------------------ */

describe('codec: item sources and the Wave 2 working keys', () => {
  const item = (data: Record<string, unknown>) => evt('item', 'gen:sig/name-fault', T1, { rev: 'r', data })

  test('lesson and daily are item sources; an unknown one is not', () => {
    for (const src of ['lesson', 'daily']) ok(item({ src }))
    for (const kind of ['item', 'probe'] as const) ok(evt(kind, 'gen:goodput/knee', T1, { rev: 'r', data: { src: 'lesson' } }))
    expect(bad(item({ src: 'weekly' }))).toContain('data.src')
  })

  test('the Wave 1 sources are still accepted', () => {
    for (const src of ['quiz', 'boot', 'card', 'cold', 'today', 'ticket', 'testout', 'placement', 'pre', 'diagram', 'practice']) ok(item({ src }))
  })

  test('engine:slots', () => {
    const slots = (o: Record<string, unknown>) => badWorking('engine:slots', o)
    expect(slots({})).toBeNull()
    expect(slots({ scheduler: slotEntry(), allocator: slotEntry(SHA2, { version: 3 }) })).toBeNull()
    for (const slot of ENGINE_SLOTS) expect(slots({ [slot]: slotEntry() })).toBeNull()
    expect(slots({ sched: slotEntry() })).toContain('unknown slot')
    expect(slots({ scheduler: slotEntry('xyz') })).toContain('scheduler')
    expect(slots({ scheduler: slotEntry('AB'.repeat(32)) })).toContain('scheduler') // lowercase hex only
    expect(slots({ scheduler: slotEntry(SHA, { version: 0 }) })).toContain('scheduler')
    expect(slots({ scheduler: slotEntry(SHA, { version: 1.5 }) })).toContain('scheduler')
    expect(slots({ scheduler: slotEntry(SHA, { at: 'yesterday' }) })).toContain('scheduler')
    expect(slots({ scheduler: slotEntry(SHA, { labId: '' }) })).toContain('scheduler')
    expect(slots({ scheduler: 'x' })).toContain('scheduler')
    expect(badWorking('engine:slots', [])).toContain('engine:slots')
    expect(badWorking('engine:slots', 'x')).toContain('engine:slots')
    expect(badWorking('engine:slots', null)).toContain('engine:slots')
  })

  test('exp:seed is a uint32, zoo:config a string of at most 20,000 characters, daily:team a non-empty string', () => {
    expect(badWorking('exp:seed', 0)).toBeNull()
    expect(badWorking('exp:seed', 0xffffffff)).toBeNull()
    for (const v of [-1, 0x100000000, 1.5, '7', null]) expect(badWorking('exp:seed', v)).toContain('uint32')
    expect(badWorking('zoo:config', 'x'.repeat(20_000))).toBeNull()
    expect(badWorking('zoo:config', '')).toBeNull()
    expect(badWorking('zoo:config', 'x'.repeat(20_001))).toContain('zoo:config')
    expect(badWorking('zoo:config', { a: 1 })).toContain('zoo:config')
    expect(badWorking('daily:team', 'blue')).toBeNull()
    expect(badWorking('daily:team', '')).toContain('daily:team')
    expect(badWorking('daily:team', 3)).toContain('daily:team')
  })

  test('zoo:config never leaves the device (not broadcast); the other new keys are', () => {
    const w = (key: string): WorkingRecord => ({ key, value: 1, at: T1, dev: 'd' }) as WorkingRecord
    const out = broadcastableWorking([w('zoo:config'), w('engine:slots'), w('exp:seed'), w('daily:team'), w('scroll:t0.l1')])
    expect(out.map((r) => r.key)).toEqual(['engine:slots', 'exp:seed', 'daily:team'])
  })
})

describe('codec: incident', () => {
  test('every shape of §3.2 is accepted', () => {
    ok(incident('inc:daily/2027-05-03', incData()))
    ok(incident('inc:drill/drain-stall', incData({ src: 'drill', date: undefined })))
    ok(incident('inc:drill/pool-shrink', incData({ src: 'drill', fault: 'pool-shrink', date: '2027-05-03', act4: true })))
    ok(incident('inc:team/blue/2027-05-03', incData({ src: 'team' })))
    ok(incident('inc:daily/2027-05-03', incData({ firstHypothesis: 'unsure', hypothesis: 'node-death', fix: 'restart-node', kcs: ['t6.goodput'], diagnosed: false, fixed: false })))
    ok(incident('inc:daily/2027-05-03', incData({ probes: Array.from({ length: 12 }, (_, i) => `p${i}`), components: Array.from({ length: 8 }, () => SHA), burn: 0, expertBurn: 0, streetlight: 0 })))
    ok(incident('inc:daily/2027-05-03', incData({ components: [] })))
    for (const severity of [1, 2, 3] as const) ok(incident('inc:daily/2027-05-03', incData({ severity })))
    for (const fault of FAULT_IDS) ok(incident(`inc:drill/${fault}`, incData({ src: 'drill', fault, date: undefined })))
  })

  test('the malformed cases of §3.2 are each refused', () => {
    const daily = (over: Record<string, unknown>) => bad(incident('inc:daily/2027-05-03', incData(over)))
    expect(daily({ src: 'weekly' })).toContain('data.src')
    expect(daily({ src: 'drill' })).toContain('data.src') // must match the ref
    expect(daily({ src: undefined })).toContain('data.src')
    expect(daily({ fault: 'cache-miss' })).toContain('data.fault')
    expect(daily({ fault: undefined })).toContain('data.fault')
    for (const severity of [0, 4, 1.5, '2', undefined]) expect(daily({ severity })).toContain('data.severity')
    expect(daily({ firstHypothesis: 'cache-miss' })).toContain('data.firstHypothesis')
    expect(daily({ hypothesis: 3 })).toContain('data.hypothesis')
    expect(daily({ probes: Array.from({ length: 13 }, (_, i) => `p${i}`) })).toContain('data.probes')
    expect(daily({ probes: [1] })).toContain('data.probes')
    expect(daily({ probes: 'queue-depth' })).toContain('data.probes')
    expect(daily({ probes: undefined })).toContain('data.probes')
    expect(daily({ fix: 3 })).toContain('data.fix')
    for (const key of ['burn', 'expertBurn', 'streetlight']) {
      expect(daily({ [key]: -1 })).toContain(`data.${key}`)
      expect(daily({ [key]: Infinity })).toContain(`data.${key}`)
      expect(daily({ [key]: '1' })).toContain(`data.${key}`)
      expect(daily({ [key]: undefined })).toContain(`data.${key}`)
    }
    expect(daily({ diagnosed: 1 })).toContain('data.diagnosed')
    expect(daily({ fixed: 'yes' })).toContain('data.diagnosed')
    expect(daily({ components: Array.from({ length: 9 }, () => SHA) })).toContain('data.components')
    expect(daily({ components: ['abc'] })).toContain('data.components')
    expect(daily({ components: ['AB'.repeat(32)] })).toContain('data.components')
    expect(daily({ components: [`${SHA}0`] })).toContain('data.components')
    expect(daily({ components: SHA })).toContain('data.components')
    expect(daily({ date: '2027-05-04' })).toContain('data.date') // must equal the ref's date
    expect(daily({ date: undefined })).toContain('data.date')
    expect(bad(incident('inc:team/blue/2027-05-03', incData({ src: 'team', date: '2027-05-04' })))).toContain('data.date')
    expect(bad(incident('inc:team/blue/2027-05-03', incData({ src: 'team', date: undefined })))).toContain('data.date')
    expect(bad(incident('inc:drill/drain-stall', incData({ src: 'drill', date: 3 })))).toContain('data.date')
    expect(daily({ act4: 'yes' })).toContain('data.act4')
    expect(daily({ kcs: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).toContain('data.kcs')
    expect(bad(incident('inc:daily/2027-05-03', undefined))).toContain('data')
    expect(bad(incident('inc:daily/2027-05-03', []))).toContain('data')
    expect(bad(incident('inc:daily/2027-05-03', 'x'))).toContain('data')
  })

  test('an incident is graded: score, ok and provenance are checked, and the ref must fit the kind', () => {
    const e = incident('inc:daily/2027-05-03', incData())
    ok(e)
    expect(bad({ ...e, score: 1.5 })).toContain('score')
    expect(bad({ ...e, ok: 'yes' })).toContain('ok')
    expect(bad({ ...e, provenance: undefined })).toContain('provenance')
    expect(bad({ ...e, seed: -1 })).toContain('seed')
    expect(bad({ ...e, ref: 'inc:daily/nope' })).toContain('does not fit')
    expect(bad({ ...e, ref: 'fleet:act1' })).toContain('does not fit')
  })
})

describe('codec: fleet-run', () => {
  test('every shape of §3.2 is accepted', () => {
    ok(fleetRun('fleet:act1', runData()))
    for (const mode of FLEET_RUN_MODES) ok(fleetRun(`fleet:${mode}`, runData({ mode })))
    for (const slot of ENGINE_SLOTS) ok(fleetRun('fleet:engine', runData({ mode: 'engine', components: [{ slot, labId: 'l', sha256: SHA }] })))
    ok(fleetRun('fleet:daily', runData({ mode: 'daily', seeds: 'practice', ttftP95: 812.5, goodput: 0, refGoodput: 0 })))
    ok(fleetRun('fleet:cluster', runData({ mode: 'cluster', components: Array.from({ length: 8 }, () => ({ slot: 'scheduler', labId: 'l', sha256: SHA })) })))
  })

  test('the malformed cases of §3.2 are each refused', () => {
    const run = (over: Record<string, unknown>, ref = 'fleet:act1') => bad(fleetRun(ref, runData(over)))
    expect(run({ mode: 'engine' })).toContain('data.mode') // must equal the ref's tail
    expect(run({ mode: 'nope' })).toContain('data.mode')
    expect(run({ mode: undefined })).toContain('data.mode')
    expect(run({ components: [] })).toContain('data.components')
    expect(run({ components: undefined })).toContain('data.components')
    expect(run({ components: Array.from({ length: 9 }, () => ({ slot: 'scheduler', labId: 'l', sha256: SHA })) })).toContain('data.components')
    expect(run({ components: [{ slot: 'sched', labId: 'l', sha256: SHA }] })).toContain('data.components')
    expect(run({ components: [{ slot: 'scheduler', labId: '', sha256: SHA }] })).toContain('data.components')
    expect(run({ components: [{ slot: 'scheduler', sha256: SHA }] })).toContain('data.components')
    expect(run({ components: [{ slot: 'scheduler', labId: 'l', sha256: 'abc' }] })).toContain('data.components')
    expect(run({ components: [{ slot: 'scheduler', labId: 'l', sha256: 'AB'.repeat(32) }] })).toContain('data.components')
    expect(run({ components: ['x'] })).toContain('data.components')
    expect(run({ seeds: 'default' })).toContain('data.seeds')
    expect(run({ goodput: Infinity })).toContain('goodput')
    expect(run({ goodput: '40' })).toContain('goodput')
    expect(run({ refGoodput: undefined })).toContain('goodput')
    expect(run({ ttftP95: '8' })).toContain('data.ttftP95')
    expect(bad(fleetRun('fleet:act1', undefined))).toContain('data')
    expect(bad(fleetRun('fleet:nope', runData({ mode: 'nope' })))).toContain('does not fit')
  })
})

describe('codec: help acks', () => {
  test('a packet ack carries via and chars; arm is optional', () => {
    ok(packetAck('packet:lab/kv-block-manager/cow', { via: 'claude', chars: 4200, arm: 'ladder' }))
    ok(packetAck('packet:lesson/t5.l4', { via: 'chatgpt', chars: 0 }))
    ok(packetAck('packet:sim/sim-kv', { via: 'copy', chars: 6000, arm: 'packet' }))
  })

  test('the malformed cases of §3.2 are each refused', () => {
    const ref = 'packet:lesson/t5.l4'
    expect(bad(packetAck(ref, undefined))).toContain('data.via')
    expect(bad(packetAck(ref, { chars: 10 }))).toContain('data.via')
    expect(bad(packetAck(ref, { via: 'gemini', chars: 10 }))).toContain('data.via')
    expect(bad(packetAck(ref, { via: 'claude' }))).toContain('data.chars')
    expect(bad(packetAck(ref, { via: 'claude', chars: -1 }))).toContain('data.chars')
    expect(bad(packetAck(ref, { via: 'claude', chars: 6001 }))).toContain('data.chars')
    expect(bad(packetAck(ref, { via: 'claude', chars: 1.5 }))).toContain('data.chars')
    expect(bad(packetAck(ref, { via: 'claude', chars: '10' }))).toContain('data.chars')
    expect(bad(packetAck(ref, { via: 'claude', chars: 10, arm: 'both' }))).toContain('data.arm')
    expect(bad(packetAck(ref, [1]))).toContain('data')
  })

  test('hint and erratum acks are unchanged: no data, or any object', () => {
    ok(packetAck('hint:lab-a/c1#R2', undefined))
    ok(packetAck('erratum:e1', { via: 'got-it' }))
    ok(packetAck('screen:welcome', { arm: 'ladder' }))
    expect(bad(packetAck('erratum:e1', 'x'))).toContain('data')
  })
})

/* ------------------------------------------------------------------ */
/* Aggregate v3 (§3.4)                                                  */
/* ------------------------------------------------------------------ */

describe('aggregate v3 folds', () => {
  test('incidents[ref]: distinct events, best score and the earliest ok instant', () => {
    const ref = 'inc:daily/2027-05-03'
    const agg = derive([
      incident(ref, incData({ fixed: false, diagnosed: false }), T1, { score: 0, ok: false }),
      incident(ref, incData(), T3, { score: 0.5, ok: true }),
      incident(ref, incData(), T2, { score: 0.8, ok: true }),
    ])
    expect(agg.incidents[ref]).toEqual({ n: 3, best: 0.8, okAt: T2 })
    expect(agg.dailyDays['2027-05-03']).toBe(true)
    expect(agg.facts[ref as 'inc:x']).toBe(true)
  })

  test('a missed incident has no okAt, no day and no fact', () => {
    const ref = 'inc:daily/2027-05-03'
    const agg = derive([incident(ref, incData({ fixed: false }), T1, { score: 0, ok: false })])
    expect(agg.incidents[ref]).toEqual({ n: 1, best: 0 })
    expect(agg.dailyDays).toEqual({})
    expect(agg.facts).toEqual({})
  })

  test('a drill is a fact per fault; a team run is counted but earns no fact and no Daily day', () => {
    const drill = incident('inc:drill/drain-stall', incData({ src: 'drill', date: undefined }), T1, { provenance: 'unseen' })
    const team = incident('inc:team/blue/2027-05-03', incData({ src: 'team' }), T1)
    const agg = derive([drill, team])
    expect(agg.facts).toEqual({ 'inc:drill/drain-stall': true })
    expect(agg.dailyDays).toEqual({})
    expect(agg.incidents['inc:drill/drain-stall']).toEqual({ n: 1, best: 1, okAt: T1 })
    expect(agg.incidents['inc:team/blue/2027-05-03']).toEqual({ n: 1, best: 1, okAt: T1 })
  })

  test('fleetRuns[mode]: best, own, and unseenOk only from an ok run on seeds drawn at run time', () => {
    const practice = fleetRun('fleet:act1', runData({ seeds: 'practice' }), T1, { score: 0.9, ok: true, provenance: 'practice' })
    expect(derive([practice]).fleetRuns.act1).toEqual({ best: 0.9, own: true })
    const miss = fleetRun('fleet:act1', runData(), T1, { score: 0.4, ok: false, provenance: 'unseen' })
    expect(derive([miss]).fleetRuns.act1).toEqual({ best: 0.4, own: true })
    expect(derive([miss]).facts).toEqual({})
    const fresh = fleetRun('fleet:act1', runData(), T2, { score: 0.7, ok: true, provenance: 'unseen' })
    const agg = derive([practice, miss, fresh])
    expect(agg.fleetRuns.act1).toEqual({ best: 0.9, own: true, unseenOk: true })
    expect(agg.facts['fleet:act1']).toBe(true)
    expect(Object.keys(agg.fleetRuns)).toEqual(['act1'])
  })

  test('both kinds mark the streak day, ok or not', () => {
    const agg = derive([
      incident('inc:drill/node-death', incData({ src: 'drill', fault: 'node-death', date: undefined }), T1, { score: 0, ok: false }),
      fleetRun('fleet:engine', runData({ mode: 'engine' }), T2, { score: 0, ok: false }),
    ])
    expect(Object.keys(agg.days).sort()).toEqual(['2026-09-01', '2026-09-02'])
  })

  test('XP: the Daily 10, a drill 5, a run 10 (once per fact), under fleet', () => {
    const agg = derive([
      incident('inc:daily/2027-05-03', incData()),
      incident('inc:daily/2027-05-03', incData(), T2), // the same fact twice pays once
      incident('inc:daily/2027-05-04', incData({ date: '2027-05-04' })),
      incident('inc:drill/drain-stall', incData({ src: 'drill', date: undefined })),
      incident('inc:team/blue/2027-05-03', incData({ src: 'team' })),
      fleetRun('fleet:act1', runData()),
      fleetRun('fleet:daily', runData({ mode: 'daily' })),
    ])
    expect(xpOf(agg)).toBe(10 + 10 + 5 + 10 + 10)
    expect(toProgressData(agg).xp).toBe(45)
  })

  test('the scores of §3.2', () => {
    expect(incidentScore({ fixed: false, burn: 0, expertBurn: 0 })).toBe(0)
    expect(incidentScore({ fixed: true, burn: 0, expertBurn: 5 })).toBe(1) // capped
    expect(incidentScore({ fixed: true, burn: 9, expertBurn: 4 })).toBe(0.5)
    expect(incidentScore({ fixed: true, burn: 0, expertBurn: 0 })).toBe(1)
    expect(incidentScore({ fixed: true, burn: 99, expertBurn: 0 })).toBeCloseTo(0.01, 12)
    expect(incidentOk({ diagnosed: true, fixed: true })).toBe(true)
    expect(incidentOk({ diagnosed: true, fixed: false })).toBe(false)
    expect(incidentOk({ diagnosed: false, fixed: true })).toBe(false)
    expect(fleetRunScore({ goodput: 30, refGoodput: 60 })).toBe(0.5)
    expect(fleetRunScore({ goodput: 90, refGoodput: 60 })).toBe(1)
    expect(fleetRunScore({ goodput: 5, refGoodput: 0 })).toBe(1) // max(1, ref) keeps a zero reference finite
    expect(fleetRunScore({ goodput: 0, refGoodput: 0 })).toBe(0)
    expect(fleetRunOk({ goodput: 37, refGoodput: 40 })).toBe(true) // Act I's rule: within 3
    expect(fleetRunOk({ goodput: 36.9, refGoodput: 40 })).toBe(false)
  })

  test('an own __proto__ id never reaches the prototype', () => {
    const agg = derive([evt('ack', 'packet:lesson/x', T1, { data: { via: 'copy', chars: 1 } })])
    expect(({} as Record<string, unknown>).n).toBeUndefined()
    expect(agg.acks['packet:lesson/x']).toBe(T1)
  })

  test('P6: the new fields do not depend on event order or repeats, over 100 seeds x 40 ops', () => {
    let incidents = 0
    let runs = 0
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, OPS)
      const events = [...d.events.values()]
      const want = stableStringify(derive(events))
      expect(stableStringify(derive(shuffle(ctx.rand, events)))).toBe(want)
      expect(stableStringify(derive([...events, ...shuffle(ctx.rand, events)]))).toBe(want) // repeats collapse
      const agg = derive(events)
      incidents += Object.keys(agg.incidents).length
      runs += Object.keys(agg.fleetRuns).length
    })
    expect(incidents).toBeGreaterThan(0)
    expect(runs).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ */
/* The upgrade chain (§3.1)                                             */
/* ------------------------------------------------------------------ */

/** The Wave 1 fold's view of a ledger: today's derive, less everything v3 added. Wave 1 marked the streak day of incident and fleet-run events and kept every ack, which is what the v3 fold still does. */
function deriveV2(events: LedgerEvent[]): AggregateV2 {
  const agg: Partial<Aggregate> & { v: number } = structuredClone(derive(events))
  delete agg.incidents
  delete agg.dailyDays
  delete agg.fleetRuns
  agg.v = 2
  agg.facts = Object.fromEntries(Object.entries(agg.facts ?? {}).filter(([k]) => !/^(inc|fleet):/.test(k)))
  return agg as AggregateV2
}

/** An aggregate restricted to the v2 fields. */
function v2Fields(a: Aggregate | AggregateV2) {
  const agg: Partial<Aggregate> = structuredClone(a)
  delete agg.v
  delete agg.incidents
  delete agg.dailyDays
  delete agg.fleetRuns
  return { ...agg, facts: Object.fromEntries(Object.entries(agg.facts ?? {}).filter(([k]) => !/^(inc|fleet):/.test(k))) }
}

describe('upgradeAggregate', () => {
  test('upgradeAggregate(derive_v2(L)) equals derive_v3(L) on every v2 field, over the generated ledgers', () => {
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, OPS)
      const events = d.ledger().events
      const v2 = deriveV2(events)
      const up = upgradeAggregate(v2)
      expect(up.v).toBe(3)
      expect(stableStringify(v2Fields(up))).toBe(stableStringify(v2Fields(derive(events))))
      expect(up.incidents).toEqual({})
      expect(up.dailyDays).toEqual({})
      expect(up.fleetRuns).toEqual({})
    })
  })

  test('the full derive replaces the upgrade: the incident and fleet-run maps fill in', () => {
    const events = [incident('inc:daily/2027-05-03', incData()), fleetRun('fleet:act1', runData(), T1, { provenance: 'unseen' })]
    const up = upgradeAggregate(deriveV2(events))
    expect(up.fleetRuns).toEqual({})
    const full = derive(events)
    expect(full.dailyDays['2027-05-03']).toBe(true)
    expect(full.fleetRuns.act1.unseenOk).toBe(true)
    expect(xpOf(up)).toBeLessThan(xpOf(full)) // the first paint lacks the 20 minutes the derive adds
  })

  test('a version-1 aggregate goes through both steps', () => {
    const v2 = deriveV2([evt('complete', 'lesson:t0.l1', T1), evt('quiz', 'lesson:t0.l2', T2, { score: 1, ok: true })])
    const v1 = {
      ...structuredClone(v2),
      v: 1,
      lessons: Object.fromEntries(Object.entries(v2.lessons).map(([k, L]) => [k, { done: L.done, completedAt: L.completedAt, lastAt: L.lastAt, quizBest: L.quizBest }])),
      sims: {},
      labs: {},
    }
    const up = upgradeAggregate(v1 as unknown as Parameters<typeof upgradeAggregate>[0])
    expect(up).toMatchObject({ v: 3, incidents: {}, dailyDays: {}, fleetRuns: {}, plays: {}, proves: {}, itemSec: {} })
    expect(up.lessons['t0.l1']).toMatchObject({ read: true })
    expect(up.lessons['t0.l2'].passedAt).toBe(T2)
  })

  test('the upgrade does not touch its input, and an own __proto__ key survives', () => {
    const v2 = deriveV2([evt('visit', 'lesson:t0.l1', T1)])
    const frozen = structuredClone(v2)
    upgradeAggregate(v2)
    expect(v2).toEqual(frozen)
    const odd = JSON.parse(JSON.stringify(v2).replace('"lessons":{', '"lessons":{"__proto__":{"done":true},')) as AggregateV2
    const up = upgradeAggregate(odd)
    expect(Object.keys(up.lessons)).toContain('__proto__')
    expect(Object.getPrototypeOf(up.lessons)).toBe(Object.prototype)
  })
})

describe('hydrate from a Wave 1 snapshot', () => {
  const wave1Events = (): LedgerEvent[] => [
    evt('complete', 'lesson:t0.l1', T1, { data: { via: 'read' } }),
    evt('quiz', 'lesson:t0.l2', T2, { score: 1, ok: true, data: { n: 1 } }),
    evt('visit', 'lesson:t0.l3', T2),
  ]
  const snapshotV2 = (events: LedgerEvent[]) => ({ schemaVersion: 4, aggregateVersion: 2, writtenAt: T2, tab: 'old', aggregate: deriveV2(events), working: [] })

  test('a v2 snapshot paints its numbers at once, upgraded, and boots the engine at once, not on idle', async () => {
    const events = wave1Events()
    const p = makeProfile({ seed: { events, meta: { schema: { version: 4, at: T1 } } } })
    p.storage.data.set(SNAPSHOT_KEY, JSON.stringify(snapshotV2(events)))
    const tab = startTab(p) // scheduleBoot is a no-op, so anything the engine does is the upgrade's doing
    const s = tab.progress.getState()
    expect(s.lessons['t0.l1']?.status).toBe('read') // no empty first paint
    expect(s.lessons['t0.l2']?.status).toBe('done')
    expect(s.lessons['t0.l3']?.status).toBe('reading')
    expect(s.xp).toBe(xpOf(derive(events))) // nothing the v2 fold priced changes
    expect(s.aggregate).toMatchObject({ v: 3, incidents: {}, dailyDays: {}, fleetRuns: {} })
    expect(s.ledger).toMatchObject({ ready: false, readOnly: false })
    expect(tab.loads()).toBe(1)

    await tab.progress.controls.flush()
    await tab.progress.controls.engine()
    await tick(5)
    expect(tab.progress.getState().ledger.ready).toBe(true)
    expect(stableStringify(tab.progress.getState().aggregate)).toBe(stableStringify(derive(events)))
  })

  test('a v3 snapshot of the same bundle does not boot the engine early; a v3 snapshot with a missing new map is ignored', async () => {
    const p = makeProfile()
    const first = startTab(p)
    first.progress.getState().recordIncident({ ref: 'inc:drill/drain-stall', seed: 1, data: incData({ src: 'drill', date: undefined }) })
    await first.progress.controls.flush()
    const second = startTab(p)
    expect(second.progress.getState().aggregate.incidents['inc:drill/drain-stall']).toMatchObject({ n: 1 })
    expect(second.loads()).toBe(0)

    const broken = { ...snapshotV2(wave1Events()), schemaVersion: 5, aggregateVersion: 3, aggregate: { ...derive(wave1Events()) } as Partial<Aggregate> }
    delete broken.aggregate.incidents
    const q = makeProfile()
    q.storage.data.set(SNAPSHOT_KEY, JSON.stringify(broken))
    const tab = startTab(q)
    expect(tab.progress.getState().lessons).toEqual({})
    tab.progress.getState().recordIncident({ ref: 'inc:drill/drain-stall', seed: 1, data: incData({ src: 'drill', date: undefined }) }) // an action on the empty aggregate does not throw
    expect(tab.progress.getState().aggregate.incidents['inc:drill/drain-stall']).toBeDefined()
  })

  test('a v2 snapshot written by a newer schema still goes read-only', () => {
    const p = makeProfile()
    p.storage.data.set(SNAPSHOT_KEY, JSON.stringify({ ...snapshotV2(wave1Events()), schemaVersion: SCHEMA_VERSION + 1 }))
    const tab = startTab(p)
    expect(tab.progress.getState().ledger).toMatchObject({ readOnly: true, reason: 'snapshot-newer' })
    expect(tab.loads()).toBe(0)
  })

  test('a Wave 1 fixture ledger derives identically on every v2 field', () => {
    // One of each Wave 1 shape, as a Wave 1 tab would have written them.
    const events: LedgerEvent[] = [
      evt('complete', 'lesson:t0.l1', T1, { data: { via: 'read' } }),
      evt('quiz', 'lesson:t0.l2', T1, { score: 1, ok: true, data: { form: 'ticket', n: 3, kcs: ['kc.a'] } }),
      evt('item', 'gen:kv/bytes-per-token', T1, { rev: 'r', provenance: 'unseen', seed: 3, data: { src: 'ticket', form: 'ticket', nsec: 40, kcs: ['kc.a'] } }),
      evt('predict', 'pre:t1.l4#0', T1, { rev: 'p', ok: false, score: 0, data: { value: 1, unit: 'KiB', truth: 4, src: 'pre' } }),
      evt('sim-task', 'sim:sim-kv/a', T1, { data: { v: 2, outcome: true } }),
      evt('lab-check', 'lab:rust-allocator', T2, { provenance: 'unseen', data: { passed: ['boot', 'align'], total: 6, abi: 2, seeds: 'fresh', checks: [{ id: 'boot', status: 'pass', fresh: true }, { id: 'align', status: 'pass', seed: 4 }] } }),
      evt('play', 'play:block-placement', T2, { data: { phase: 'play', turns: 9, survived: 9, ghostSurvived: 9, spec: { fit: 'best', coalesce: 'eager', minSplit: 16, classes: 'pow2' } } }),
      evt('prove', 'prove:rust-allocator', T2, { data: { v: 1, qids: ['q'], self: [1] } }),
      evt('fleet-act', 'fw:engine', T2, { provenance: 'practice' }),
      evt('capstone-step', 'cap:tokenize', T2, { data: { index: 0 } }),
      evt('ack', 'hint:rust-allocator/boot#bottom', T2),
      evt('ack', 'erratum:e1', T2, { data: { via: 'got-it' } }),
      evt('achievement', 'ach:first-quiz', T2),
      evt('complete', 'placement', T3),
      evt('complete', 'boot', T3),
    ]
    const v2 = deriveV2(events)
    const v3 = derive(events)
    expect(stableStringify(v2Fields(v3))).toBe(stableStringify(v2Fields(v2)))
    expect(v3.incidents).toEqual({})
    expect(v3.fleetRuns).toEqual({})
    expect(v3.dailyDays).toEqual({})
    expect(toProgressData(v3)).toEqual(toProgressData(upgradeAggregate(v2)))
  })
})

/* ------------------------------------------------------------------ */
/* The Wave 2 façade actions (§3.3)                                     */
/* ------------------------------------------------------------------ */

describe('façade: recordIncident and recordFleetRun', () => {
  test('recordIncident writes one incident with the seed, the time and a score the rule derives; never skipped', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().recordIncident({ ref: 'inc:daily/2027-05-03', seed: 77, ms: 61_000, data: incData({ burn: 9, expertBurn: 4 }) })
    getState().recordIncident({ ref: 'inc:daily/2027-05-03', seed: 77, data: incData({ burn: 9, expertBurn: 4 }) })
    getState().recordIncident({ ref: 'inc:drill/drain-stall', seed: 5, data: incData({ src: 'drill', date: undefined, diagnosed: true, fixed: false }) })
    expect(getState().aggregate.incidents['inc:daily/2027-05-03']).toEqual({ n: 2, best: 0.5, okAt: expect.any(String) })
    expect(getState().aggregate.dailyDays['2027-05-03']).toBe(true)
    expect(getState().xp).toBe(10) // the Daily once; the failed drill pays nothing
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'incident')
    expect(events).toHaveLength(3)
    expect(events.find((e) => e.ms === 61_000)).toMatchObject({ ref: 'inc:daily/2027-05-03', seed: 77, score: 0.5, ok: true, provenance: 'practice' })
    expect(events.find((e) => e.ref === 'inc:drill/drain-stall')).toMatchObject({ seed: 5, score: 0, ok: false, provenance: 'unseen' })
  })

  test('a drill is unseen, the Daily and a team run are practice; the seed is a uint32', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().recordIncident({ ref: 'inc:drill/node-death', seed: 0xffffffff, data: incData({ src: 'drill', fault: 'node-death', date: undefined }) })
    getState().recordIncident({ ref: 'inc:team/blue/2027-05-03', seed: 3, data: incData({ src: 'team' }) })
    getState().recordIncident({ ref: 'inc:daily/2027-05-03', seed: -1, data: incData() })
    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    const by = (ref: string) => events.find((e) => e.ref === ref) as unknown as { provenance: string; seed: number }
    expect(by('inc:drill/node-death')).toMatchObject({ provenance: 'unseen', seed: 0xffffffff })
    expect(by('inc:team/blue/2027-05-03').provenance).toBe('practice')
    expect(by('inc:daily/2027-05-03').seed).toBe(0xffffffff) // -1 wraps rather than losing the play at the flush
    expect(getState().ledger.readOnly).toBe(false)
  })

  test('over-long probe and component lists and negative burns are clamped, so the codec never refuses the event at flush', async () => {
    const tab = startTab(makeProfile())
    tab.progress.getState().recordIncident({
      ref: 'inc:daily/2027-05-03',
      seed: 1,
      data: incData({ probes: Array.from({ length: 20 }, (_, i) => `p${i}`), components: Array.from({ length: 11 }, () => SHA), burn: -3, expertBurn: Number.NaN, kcs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }),
    })
    await tab.progress.controls.flush()
    const [e] = (await (await tab.engine()).events()).filter((x) => x.kind === 'incident') as unknown as { data: IncidentData }[]
    expect(e.data.probes).toHaveLength(12)
    expect(e.data.components).toHaveLength(8)
    expect(e.data).toMatchObject({ burn: 0, expertBurn: 0 })
    expect(e.data.kcs).toHaveLength(6)
    expect(validateEvent(e).ok).toBe(true)
  })

  test('recordFleetRun: skipped with no own component; otherwise the rule scores it and fresh seeds are unseen', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().recordFleetRun({ data: runData({ components: [] }) })
    expect(getState().aggregate.fleetRuns).toEqual({})
    getState().recordFleetRun({ seed: 9, ms: 5000, data: runData({ goodput: 38, refGoodput: 41 }) }) // within 3: ok
    getState().recordFleetRun({ data: runData({ mode: 'engine', seeds: 'practice', goodput: 10, refGoodput: 40 }) })
    expect(getState().aggregate.fleetRuns.act1).toEqual({ best: 38 / 41, own: true, unseenOk: true })
    expect(getState().aggregate.fleetRuns.engine).toEqual({ best: 0.25, own: true })
    expect(getState().xp).toBe(10) // act1 is ok; the engine run missed
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'fleet-run')
    expect(events).toHaveLength(2)
    expect(events.find((e) => e.ref === 'fleet:act1')).toMatchObject({ seed: 9, ms: 5000, ok: true, provenance: 'unseen' })
    expect(events.find((e) => e.ref === 'fleet:engine')).toMatchObject({ ok: false, provenance: 'practice' })
    expect(getState().ledger.readOnly).toBe(false)
  })

  test('completeFleetWeekAct: the old call is unchanged, and meta adds the seed, the provenance and data', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().completeFleetWeekAct('engine', 0.75)
    getState().completeFleetWeekAct('fleet', 0.5, { seed: 8, provenance: 'unseen', data: { goodput: 20, refGoodput: 40 } })
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'fleet-act')
    const engine = events.find((e) => e.ref === 'fw:engine')!
    expect(engine).toMatchObject({ provenance: 'practice', score: 0.75, ok: true })
    expect(engine).not.toHaveProperty('seed')
    expect(engine).not.toHaveProperty('data')
    expect(events.find((e) => e.ref === 'fw:fleet')).toMatchObject({ provenance: 'unseen', seed: 8, data: { goodput: 20, refGoodput: 40 } })
    expect(getState().fleetWeek.scores).toEqual({ engine: 0.75, fleet: 0.5 })
  })

  test('recordHelp writes one ack per call, never skipped, and keeps the earliest in acks', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const { getState } = tab.progress
    getState().recordHelp('packet:lab/kv-block-manager/cow', { via: 'claude', chars: 4200, arm: 'packet' })
    const first = getState().acks['packet:lab/kv-block-manager/cow']
    p.clock.advance(5)
    getState().recordHelp('packet:lab/kv-block-manager/cow', { via: 'copy', chars: 7000 })
    getState().acknowledge('packet:sim/sim-kv', { via: 'copy', chars: 5 }) // the generic action takes JSON too
    expect(getState().acks['packet:lab/kv-block-manager/cow']).toBe(first)
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'ack')
    expect(events).toHaveLength(3)
    expect(events.filter((e) => e.ref === 'packet:lab/kv-block-manager/cow').map((e) => (e as unknown as { data: object }).data)).toEqual([
      { via: 'claude', chars: 4200, arm: 'packet' },
      { via: 'copy', chars: 6000 }, // over-long reports are clamped to the codec's bound
    ])
    expect(getState().xp).toBe(0)
  })

  test('a read-only tab writes nothing through any Wave 2 action', async () => {
    const p = makeProfile({ seed: { meta: { schema: { version: SCHEMA_VERSION + 1, at: T1 } } } })
    const tab = startTab(p)
    await tab.progress.controls.engine().catch(() => undefined)
    const s = tab.progress.getState()
    s.recordIncident({ ref: 'inc:daily/2027-05-03', seed: 1, data: incData() })
    s.recordFleetRun({ data: runData() })
    s.recordHelp('packet:lesson/x', { via: 'copy', chars: 1 })
    s.removeComponent('scheduler')
    await expect(s.installComponent({ slot: 'scheduler', labId: 'l', version: 1, bytes: new Uint8Array([1]) })).rejects.toThrow('read-only')
    expect((await p.store.readAll()).events).toHaveLength(0)
    expect((await p.store.readAll()).components).toHaveLength(0)
  })
})

describe('the outbox flush keeps every Wave 2 event', () => {
  test('a tab that never reached the engine leaves its events in the outbox; the next load commits all of them', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const s = tab.progress.getState()
    s.recordIncident({ ref: 'inc:daily/2027-05-03', seed: 1, data: incData() })
    s.recordIncident({ ref: 'inc:drill/straggler', seed: 2, data: incData({ src: 'drill', fault: 'straggler', date: undefined, act4: true }) })
    s.recordIncident({ ref: 'inc:team/blue/2027-05-03', seed: 3, data: incData({ src: 'team' }) })
    s.recordFleetRun({ data: runData() })
    s.recordHelp('packet:lab/kv-block-manager/cow', { via: 'claude', chars: 100, arm: 'ladder' })
    s.recordHelp('packet:lesson/t5.l4', { via: 'chatgpt', chars: 100 })
    s.recordHelp('packet:sim/sim-kv', { via: 'copy', chars: 100 })
    s.completeFleetWeekAct('engine', 1, { seed: 4, provenance: 'unseen', data: { goodput: 1 } })
    s.recordItems([
      { kind: 'item', ref: 'gen:sig/name-fault', rev: 'r', score: 1, ok: true, data: { src: 'daily', nsec: 30 } },
      { kind: 'item', ref: 'gen:goodput/knee', rev: 'r', score: 1, ok: true, data: { src: 'lesson', nsec: 30 } },
    ])
    s.setWorking('exp:seed', 42)
    s.setWorking('zoo:config', '{"a":1}')
    s.setWorking('daily:team', 'blue')

    const box = readOutbox(p.storage, tab.tabId)!
    expect(box.events).toHaveLength(10)
    for (const e of box.events) expect(validateEvent(e).ok).toBe(true)
    for (const w of box.working) expect(validateWorkingRecord(w).ok).toBe(true)
    expect(box.working.map((w) => w.key).sort()).toEqual(['daily:team', 'exp:seed', 'zoo:config'])
    const expected = new Set(box.events.map((e) => e.id))

    const next = startTab(p)
    await next.progress.controls.engine()
    const stored = await (await next.engine()).events()
    expect(new Set(stored.map((e) => e.id))).toEqual(expected)
    expect(next.progress.getState().working['exp:seed']).toBe(42)
    expect(next.progress.getState().aggregate.dailyDays['2027-05-03']).toBe(true)
  })

  test('every event the generator writes, Wave 2 shapes included, passes validateEvent', () => {
    const kinds = new Set<string>()
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, OPS)
      for (const e of d.events.values()) {
        expect(validateEvent(e).ok ? '' : `${e.kind} ${e.ref}: ${bad(e)}`).toBe('')
        kinds.add(e.ref.split(/[:/]/)[0] === 'packet' || e.ref.startsWith('inc:') || e.ref.startsWith('fleet:') ? e.ref.split(/[:/]/)[0] : e.kind)
      }
      for (const w of d.working.values()) expect(validateWorkingRecord(w).ok).toBe(true)
    })
    for (const k of ['inc', 'fleet', 'packet']) expect(kinds.has(k)).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Components (§3.3)                                                    */
/* ------------------------------------------------------------------ */

const bytesOf = (...n: number[]) => new Uint8Array(n)

describe('components through the memory store', () => {
  test('W12: module bytes never enter the localStorage outbox, the snapshot or any other key', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    await tab.progress.getState().installComponent({ slot: 'scheduler', labId: 'batching-scheduler', version: 2, bytes: new Uint8Array(200_000).fill(7) })
    tab.progress.getState().recordVisit('boot') // something for the outbox and the snapshot to hold
    await tab.progress.controls.flush()
    await tick(10)
    expect(p.storage.data.size).toBeGreaterThan(0)
    for (const [key, value] of p.storage.data) expect(value.length, key).toBeLessThan(5000)
    expect((await tab.engine().then((e) => e.components()))[0].size).toBe(200_000)
  })

  test('installComponent hashes the bytes, stores them and fills the slot', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const bytes = bytesOf(0, 97, 115, 109, 1, 0, 0, 0)
    const sha256 = await sha256Hex(bytes)
    const r = await tab.progress.getState().installComponent({ slot: 'allocator', labId: 'rust-allocator', version: 2, name: 'my-alloc', abi: 2, bytes })
    expect(r).toEqual({ sha256 })
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/)

    const slots = tab.progress.getState().working['engine:slots'] as unknown as EngineSlots
    expect(slots).toEqual({ allocator: { sha256, labId: 'rust-allocator', version: 2, at: p.clock.nowIso() } })
    const client = await tab.engine()
    expect(await client.components()).toEqual([{ sha256, labId: 'rust-allocator', name: 'my-alloc', size: 8, addedAt: p.clock.nowIso(), abi: 2 }])
    expect(new Uint8Array((await client.componentBytes(sha256))!)).toEqual(bytes)
    expect(await client.componentBytes('00'.repeat(32))).toBeNull()
    await tab.progress.controls.flush()
    expect((await p.store.readAll()).working.find((w) => w.key === 'engine:slots')?.value).toEqual(slots)
  })

  test('installing what the slot already holds is skipped; the same bytes in another slot add a record, not a component', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const { getState } = tab.progress
    const input = { slot: 'scheduler' as const, labId: 'batching-scheduler', version: 1, bytes: bytesOf(1, 2, 3) }
    await getState().installComponent(input)
    const first = (getState().working['engine:slots'] as unknown as EngineSlots).scheduler!
    p.clock.advance(10)
    await getState().installComponent(input) // skipped: the working record keeps its instant
    expect((getState().working['engine:slots'] as unknown as EngineSlots).scheduler).toEqual(first)
    await getState().installComponent({ ...input, slot: 'intake' })
    expect(Object.keys(getState().working['engine:slots'] as object).sort()).toEqual(['intake', 'scheduler'])
    expect(await (await tab.engine()).components()).toHaveLength(1)
    await getState().installComponent({ ...input, bytes: bytesOf(1, 2, 4) }) // new bytes replace the slot's entry
    const slots = getState().working['engine:slots'] as unknown as EngineSlots
    expect(slots.scheduler!.sha256).not.toBe(first.sha256)
    expect(slots.intake!.sha256).toBe(first.sha256)
    expect(await (await tab.engine()).components()).toHaveLength(2) // the old module stays: it is content-addressed
  })

  test('an ArrayBuffer and a Uint8Array view of the same bytes hash alike; the version is at least 1', async () => {
    const tab = startTab(makeProfile())
    const bytes = bytesOf(5, 6, 7)
    const a = await tab.progress.getState().installComponent({ slot: 'tokenizer', labId: 'bpe-tokenizer', version: 0, bytes: bytes.buffer.slice(0) as ArrayBuffer })
    const b = await tab.progress.getState().installComponent({ slot: 'grammar', labId: 'xgrammar-lite', version: 1, bytes })
    expect(a.sha256).toBe(b.sha256)
    const slots = tab.progress.getState().working['engine:slots'] as unknown as EngineSlots
    expect(slots.tokenizer!.version).toBe(1)
    expect((await tab.engine().then((e) => e.components())).length).toBe(1)
  })

  test('removeComponent empties the slot, skips an empty one, and keeps the bytes', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const { getState } = tab.progress
    getState().removeComponent('scheduler') // empty: nothing written
    expect(getState().working['engine:slots']).toBeUndefined()
    const { sha256 } = await getState().installComponent({ slot: 'scheduler', labId: 'batching-scheduler', version: 1, bytes: bytesOf(9) })
    await getState().installComponent({ slot: 'intake', labId: 'mpmc-queue', version: 1, bytes: bytesOf(8) })
    p.clock.advance(1)
    getState().removeComponent('scheduler')
    expect(Object.keys(getState().working['engine:slots'] as object)).toEqual(['intake'])
    const at = p.storage.data.size
    getState().removeComponent('scheduler') // already empty
    expect(p.storage.data.size).toBe(at)
    await tab.progress.controls.flush()
    expect(new Uint8Array((await (await tab.engine()).componentBytes(sha256))!)).toEqual(bytesOf(9))
    getState().removeComponent('intake')
    expect(getState().working['engine:slots']).toEqual({})
  })

  test('a component is idempotent in the store: the same hash twice is one record with its first instant', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const engine = await tab.engine()
    const rec = { sha256: SHA, labId: 'l', size: 3, addedAt: T1, bytes: bytesOf(1, 2, 3).buffer as ArrayBuffer }
    await engine.putComponent(rec)
    await engine.putComponent({ ...rec, addedAt: T2 })
    expect(await engine.components()).toEqual([{ sha256: SHA, labId: 'l', size: 3, addedAt: T1 }])
    // a record that arrived without bytes (an import without them) gets them
    const q = makeProfile({ seed: { components: [{ sha256: SHA2, labId: 'l', size: 1, addedAt: T1 }] } })
    const other = await startTab(q).engine()
    expect(await other.componentBytes(SHA2)).toBeNull()
    await other.putComponent({ sha256: SHA2, labId: 'l', size: 1, addedAt: T2, bytes: bytesOf(4).buffer as ArrayBuffer })
    expect(new Uint8Array((await other.componentBytes(SHA2))!)).toEqual(bytesOf(4))
  })

  test('IndexedDB unavailable: the install lands in the memory fallback and the engine says so', async () => {
    const p = makeProfile()
    class Broken extends MemoryStore {
      override async open(): Promise<never> {
        throw new Error('SecurityError: the operation is insecure')
      }
    }
    const tab = startTab(p, { store: new Broken(), engine: { fallbackStore: () => new MemoryStore() } })
    const { sha256 } = await tab.progress.getState().installComponent({ slot: 'executor', labId: 'toy-executor', version: 1, bytes: bytesOf(1, 1) })
    expect(tab.progress.getState().ledger.backend).toBe('memory') // the existing notice
    const engine = await tab.engine()
    expect(new Uint8Array((await engine.componentBytes(sha256))!)).toEqual(bytesOf(1, 1))
    expect((tab.progress.getState().working['engine:slots'] as unknown as EngineSlots).executor!.sha256).toBe(sha256)
  })

  test('export: bytes only on request; a delta carries the components of slots changed since, bytes included', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const { getState } = tab.progress
    const old = await getState().installComponent({ slot: 'scheduler', labId: 'batching-scheduler', version: 1, bytes: bytesOf(1) })
    p.clock.advance(60)
    const since = p.clock.nowIso()
    const fresh = await getState().installComponent({ slot: 'allocator', labId: 'rust-allocator', version: 1, bytes: bytesOf(2) })
    await tab.progress.controls.flush()
    const engine = await tab.engine()

    const plain = await engine.exportV3()
    expect(plain.components.map((c) => c.sha256).sort()).toEqual([old.sha256, fresh.sha256].sort())
    expect(plain.components.every((c) => c.bytesB64 === undefined)).toBe(true)
    const full = await engine.exportV3({ includeComponentBytes: true })
    expect(full.components.map((c) => c.bytesB64).sort()).toEqual(['AQ==', 'Ag=='])

    const delta = await engine.exportV3({ sinceAt: since })
    expect(delta.components.map((c) => c.sha256)).toEqual([fresh.sha256])
    expect(delta.components[0].bytesB64).toBe('Ag==')
    expect(delta.working.map((w) => w.key)).toEqual(['engine:slots'])
    expect(delta.extras).toEqual({ capstoneDrafts: {} })
    expect(parseImport(serializeExport(delta)).ok).toBe(true)
    // with nothing changed since, there are no components
    p.clock.advance(60)
    expect((await engine.exportV3({ sinceAt: p.clock.nowIso() })).components).toEqual([])
  })

  test('import: a full export and a delta bring the bytes and the slot map to another device', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const a = await tab.progress.getState().installComponent({ slot: 'scheduler', labId: 'batching-scheduler', version: 1, bytes: bytesOf(1, 2) })
    p.clock.advance(60)
    const since = p.clock.nowIso()
    const b = await tab.progress.getState().installComponent({ slot: 'allocator', labId: 'rust-allocator', version: 3, bytes: bytesOf(3, 4) })
    await tab.progress.controls.flush()
    const engine = await tab.engine()

    const phone = startTab(makeProfile({ devicePrefix: 'phone-' }))
    const phoneEngine = await phone.progress.controls.engine()
    const deltaResult = await phoneEngine.importFile(JSON.stringify(await engine.exportV3({ sinceAt: since })), 'merge')
    expect(deltaResult).toMatchObject({ ok: true })
    expect((await phoneEngine.components()).map((c) => c.sha256)).toEqual([b.sha256])
    expect(new Uint8Array((await phoneEngine.componentBytes(b.sha256))!)).toEqual(bytesOf(3, 4))
    expect((phone.progress.getState().working['engine:slots'] as unknown as EngineSlots).allocator).toMatchObject({ sha256: b.sha256, version: 3 })

    const laptop = startTab(makeProfile({ devicePrefix: 'laptop-' }))
    const laptopEngine = await laptop.progress.controls.engine()
    await laptopEngine.importFile(JSON.stringify(await engine.exportV3({ includeComponentBytes: true })), 'replace')
    expect((await laptopEngine.components()).map((c) => c.sha256).sort()).toEqual([a.sha256, b.sha256].sort())
    expect(new Uint8Array((await laptopEngine.componentBytes(a.sha256))!)).toEqual(bytesOf(1, 2))
    expect(Object.keys(laptop.progress.getState().working['engine:slots'] as object).sort()).toEqual(['allocator', 'scheduler'])
  })

  test('slotHashes names the hashes of filled slots, optionally only those filled since', () => {
    const rec = (value: unknown): WorkingRecord => ({ key: 'engine:slots', value: value as WorkingRecord['value'], at: T1, dev: 'd' })
    const slots = { scheduler: slotEntry(SHA, { at: T1 }), allocator: slotEntry(SHA2, { at: T3 }) }
    expect([...slotHashes([rec(slots)])].sort()).toEqual([SHA, SHA2].sort())
    expect([...slotHashes([rec(slots)], T2)]).toEqual([SHA2])
    expect(slotHashes([])).toEqual(new Set())
    expect(slotHashes([rec('junk')])).toEqual(new Set())
  })

  test('the slot map merges last-writer-wins as one record, so the later install or removal stands', () => {
    const a: WorkingRecord = { key: 'engine:slots', value: { scheduler: slotEntry() }, at: T1, dev: 'a' }
    const b: WorkingRecord = { key: 'engine:slots', value: {}, at: T2, dev: 'b' }
    const merged = mergeLedgers({ events: [], working: [a] }, { events: [], working: [b] })
    expect(workingMap(merged.working)['engine:slots']).toEqual({})
    expect(ledgerKey(mergeLedgers({ events: [], working: [b] }, { events: [], working: [a] }))).toBe(ledgerKey(merged))
  })
})

/* ------------------------------------------------------------------ */
/* Round trip and properties (§3.6)                                     */
/* ------------------------------------------------------------------ */

describe('export round trip', () => {
  test('every generated ledger, Wave 2 ops included, survives export -> JSON -> import(replace)', () => {
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

  test('the generator reaches every Wave 2 op at least once over the seeds', () => {
    const seen = new Set<string>()
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, int(ctx.rand, OPS, OPS))
      for (const line of ctx.trace) for (const op of ['incident', 'fleet-run', 'install-component', 'remove-component', 'help']) if (line.includes(` ${op} `) || line.endsWith(` ${op}`)) seen.add(op)
    })
    expect([...seen].sort()).toEqual(['fleet-run', 'help', 'incident', 'install-component', 'remove-component'])
  })
})
