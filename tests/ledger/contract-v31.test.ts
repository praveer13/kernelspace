/**
 * Ledger contract v3.1 (wave-1.md §3, task B0): schema 4 and aggregate 2, the Wave 1 refs and data shapes
 * at the codec, the aggregate v2 folds, the four lesson states, the upgrade from a Wave 0b snapshot, the
 * Wave 1 façade actions and the delta export. The property suite (fold, codec, engine, facade) runs the
 * same Wave 1 ops from gen.ts, so this file pins the rules those properties lean on.
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { buildExportV3, parseImport, serializeExport, validateEvent, validateWorkingRecord } from '../../src/lib/ledger/codec'
import { AGGREGATE_VERSION, SCHEMA_VERSION } from '../../src/lib/ledger/constants'
import { derive, emptyAggregate, GRADED_KINDS, upgradeAggregate } from '../../src/lib/ledger/fold'
import { checkMessage, checkSnapshot, checkStoreInfo, createGuard } from '../../src/lib/ledger/guard'
import { canonicalEvent } from '../../src/lib/ledger/merge'
import { SNAPSHOT_KEY } from '../../src/lib/ledger/names'
import { readOutbox } from '../../src/lib/ledger/outbox'
import { parseHintRef, refMatchesKind, refTail, parseQuizItemRef, parseSimTaskRef } from '../../src/lib/ledger/refs'
import { stableStringify } from '../../src/lib/ledger/stable'
import type { Aggregate, AggregateV1, EventKind, LedgerEvent, SnapshotV2 } from '../../src/lib/ledger/types'
import { factXp, summary, toProgressData, workingMap, xpOf } from '../../src/lib/ledger/view'
import { dayOf } from '../../src/lib/ledger/time'
import { evt, forSeeds, PLAY, PROPERTY_TIMEOUT_MS, runOps, WAVE1_ITEM_REFS } from './gen'
import { makeProfile, startTab, tick } from './env'
import kvbm from '../../src/data/errata/2026-10-04-dynamo-kvbm-deprecated'
import { changeCardsFor } from '../../src/lib/learner/change-cards'

setDefaultTimeout(PROPERTY_TIMEOUT_MS)

const T1 = '2026-09-01T09:00:00.000Z'
const T2 = '2026-09-02T09:00:00.000Z'
const T3 = '2026-09-03T09:00:00.000Z'

const bad = (e: unknown) => {
  const r = validateEvent(e)
  return r.ok ? null : r.reason
}
const ok = (e: unknown) => expect(bad(e)).toBeNull()

/* ------------------------------------------------------------------ */
/* Versions and the schema guard (§3.1)                                 */
/* ------------------------------------------------------------------ */

describe('versions and the schema guard', () => {
  test('SCHEMA_VERSION 4 and AGGREGATE_VERSION 2', () => {
    expect(SCHEMA_VERSION).toBe(4)
    expect(AGGREGATE_VERSION).toBe(2)
    expect(emptyAggregate().v).toBe(2)
  })

  test('a Wave 0b bundle (schema 3) goes read-only on a v4 snapshot, hello, store or file; a v4 bundle reads v3 data', () => {
    expect(checkSnapshot(3, { schemaVersion: 4 })).toBe('snapshot-newer')
    expect(checkMessage(3, { schemaVersion: 4 })).toBe('newer-schema')
    expect(checkStoreInfo(3, { backend: 'idb', schemaVersion: 4, readOnly: false })).toBe('newer-schema')
    const guard = createGuard(3)
    expect(guard.message({ schemaVersion: SCHEMA_VERSION })).toBe(true)
    expect(guard.reason).toBe('newer-schema')

    expect(checkSnapshot(SCHEMA_VERSION, { schemaVersion: 3 })).toBeNull()
    expect(checkMessage(SCHEMA_VERSION, { schemaVersion: 3 })).toBeNull()
    expect(checkStoreInfo(SCHEMA_VERSION, { backend: 'idb', schemaVersion: 3, readOnly: false })).toBeNull()
  })

  test('the engine of a Wave 0b bundle goes read-only on a database a v4 bundle opened', async () => {
    const p = makeProfile()
    const wave1 = startTab(p)
    wave1.progress.getState().completeLesson('t0.l1', 'read')
    await wave1.progress.controls.flush()
    const old = await startTab(p, { schemaVersion: 3 }).engine()
    expect(old.status()).toMatchObject({ readOnly: true, reason: 'newer-schema' })
  })

  test('exports carry schemaVersion 4; import accepts 1 to 4 and refuses 5; a Wave 0b bundle would refuse v4', () => {
    const file = buildExportV3({ events: [], working: [], device: 'd', exportedAt: T1 })
    expect(file).toMatchObject({ version: 3, schemaVersion: 4 })
    expect(file.schemaVersion).toBeGreaterThan(3) // a bundle at schema 3 compares this with its own and refuses (newer-schema)
    for (const v of [1, 3, 4]) expect(parseImport(JSON.stringify({ ...file, schemaVersion: v })).ok).toBe(true)
    expect(parseImport(JSON.stringify({ ...file, schemaVersion: 5 }))).toMatchObject({ ok: false, error: 'newer-schema' })
  })
})

/* ------------------------------------------------------------------ */
/* Refs (§3.2)                                                          */
/* ------------------------------------------------------------------ */

describe('refs', () => {
  test('item, probe and predict accept every Wave 1 grammar', () => {
    const good = ['gen:kv/bytes-per-token', 'pre:t1.l4#0', 'dia:t1.l3#5', 'cr:t0.l4#0', 'item:r.anchor.e0502-1', 'quiz:t0.l1#2', 'boot:decode-tps', 'card:e1#0']
    for (const kind of ['item', 'probe', 'predict'] as const) for (const ref of good) expect(refMatchesKind(kind, ref)).toBe(true)
  })

  test('malformed Wave 1 item refs are refused', () => {
    for (const ref of ['gen:kv', 'gen:/x', 'gen:kv/', 'gen:', 'pre:t1.l4', 'pre:t1.l4#x', 'pre:#1', 'dia:t1.l3#-1', 'cr:t0.l4#', 'cr:#0', 'item:', 'item', 'hint:lab-a/c#R1']) {
      expect(refMatchesKind('item', ref)).toBe(false)
    }
  })

  test('play, prove, hint and placement', () => {
    expect(refMatchesKind('play', `play:${PLAY}`)).toBe(true)
    expect(refMatchesKind('play', 'play:')).toBe(false)
    expect(refMatchesKind('play', PLAY)).toBe(false)
    expect(refMatchesKind('prove', 'prove:rust-allocator')).toBe(true)
    expect(refMatchesKind('prove', 'prove:')).toBe(false)
    expect(refMatchesKind('ack', 'hint:rust-allocator/coalesce#R2')).toBe(true)
    expect(refMatchesKind('ack', 'hint:rust-allocator/coalesce#bottom')).toBe(true)
    for (const ref of ['hint:', 'hint:lab', 'hint:lab/check', 'hint:lab/check#', 'hint:/check#R1', 'hint:lab/#R1']) expect(refMatchesKind('ack', ref)).toBe(false)
    expect(refMatchesKind('complete', 'placement')).toBe(true)
    expect(refMatchesKind('visit', 'placement')).toBe(false)
    expect(refMatchesKind('quiz', 'placement')).toBe(false)
    expect(refMatchesKind('complete', 'lesson:t0.l1')).toBe(true) // unchanged
  })

  test('parseHintRef and the existing parsers', () => {
    expect(parseHintRef('hint:rust-allocator/coalesce#R2')).toEqual({ labId: 'rust-allocator', checkId: 'coalesce', rung: 'R2' })
    expect(parseHintRef('hint:a/b#bottom')?.rung).toBe('bottom')
    expect(parseHintRef('erratum:x')).toBeNull()
    expect(parseQuizItemRef('quiz:t0.l1#1')).toEqual({ lessonId: 't0.l1', qi: 1 })
    expect(parseSimTaskRef('sim:s/t')).toEqual({ simId: 's', taskId: 't' })
    expect(refTail('play:x', 'play:')).toBe('x')
  })
})

/* ------------------------------------------------------------------ */
/* Codec allow-lists and data shapes (§3.2)                             */
/* ------------------------------------------------------------------ */

describe('codec', () => {
  const item = (ref: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => evt('item', ref, T1, { rev: 'r', data, ...extra })

  test('every new item src is accepted; an unknown one is not', () => {
    for (const src of ['quiz', 'boot', 'card', 'cold', 'today', 'ticket', 'testout', 'placement', 'pre', 'diagram', 'practice']) ok(item('gen:kv/x', { src }))
    expect(bad(item('gen:kv/x', { src: 'nope' }))).toContain('data.src')
    expect(bad(item('gen:kv/x', {}))).toContain('data.src')
  })

  test('predict accepts src boot, lesson, pre, diagram and placement', () => {
    for (const src of ['boot', 'lesson', 'pre', 'diagram', 'placement']) ok(evt('predict', 'pre:t1.l4#0', T1, { rev: 'r', data: { value: 1, unit: 'KiB', truth: 2, src } }))
    expect(bad(evt('predict', 'pre:t1.l4#0', T1, { rev: 'r', data: { value: 1, unit: 'KiB', truth: 2, src: 'ticket' } }))).toContain('data.src')
  })

  test('item fields: kcs at most 6 strings, nsec within [0, 600], lo <= hi; the rest is kept unvalidated', () => {
    ok(item('gen:kv/x', { src: 'today', kcs: ['a', 'b', 'c', 'd', 'e', 'f'], nsec: 600, lo: 2, hi: 2 }))
    ok(item('gen:kv/x', { src: 'today', nsec: 0 }))
    expect(bad(item('gen:kv/x', { src: 'today', kcs: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }))).toContain('kcs')
    expect(bad(item('gen:kv/x', { src: 'today', kcs: [1] }))).toContain('kcs')
    expect(bad(item('gen:kv/x', { src: 'today', kcs: 'a' }))).toContain('kcs')
    expect(bad(item('gen:kv/x', { src: 'today', nsec: 601 }))).toContain('nsec')
    expect(bad(item('gen:kv/x', { src: 'today', nsec: -1 }))).toContain('nsec')
    expect(bad(item('gen:kv/x', { src: 'today', nsec: '5' }))).toContain('nsec')
    expect(bad(item('gen:kv/x', { src: 'today', lo: 9, hi: 3 }))).toContain('lo')
    expect(bad(evt('predict', 'pre:t1.l4#0', T1, { rev: 'r', data: { value: 1, unit: 'x', truth: 2, src: 'pre', lo: 9, hi: 3 } }))).toContain('lo')
    // forward compatibility: fields a newer writer adds are kept, and the same object comes back
    const future = item('gen:kv/x', { src: 'today', picks: ['a'], level: 9, variant: 'v', unit: 'u', truth: 1, miss: 'm', ideas: [1], slot: 0, of: 3, form: 'ticket', reason: 'someday', brandNew: { a: 1 } })
    const r = validateEvent(future)
    expect(r.ok && r.value).toBe(future)
  })

  test('play: phase play or compose plus numeric turns, survived and ghostSurvived', () => {
    const play = (data: unknown) => evt('play', `play:${PLAY}`, T1, { data })
    ok(play({ phase: 'play', turns: 9, survived: 7, ghostSurvived: 8 }))
    ok(play({ phase: 'compose', turns: 2, survived: 9, ghostSurvived: 9, spec: { fit: 'best' }, equivalent: true, divergenceOp: 4, skipped: false, kcs: ['x'] }))
    for (const data of [undefined, {}, { phase: 'duel', turns: 1, survived: 1, ghostSurvived: 1 }, { phase: 'play', turns: '9', survived: 7, ghostSurvived: 8 }, { phase: 'play', turns: 9, survived: 7 }]) {
      expect(bad(play(data))).not.toBeNull()
    }
  })

  test('prove: qids and self of equal length', () => {
    const prove = (data: unknown) => evt('prove', 'prove:rust-allocator', T1, { data })
    ok(prove({ v: 1, qids: ['a', 'b', 'c'], self: [1, 0, 1] }))
    ok(prove({ qids: [], self: [] }))
    for (const data of [undefined, { qids: ['a'] }, { qids: ['a', 'b'], self: [1] }, { qids: [1], self: [1] }, { qids: ['a'], self: ['1'] }]) {
      expect(bad(prove(data))).not.toBeNull()
    }
  })

  test('lab-check: abi 1 or 2, checks with id and status, seeds fresh or default', () => {
    const lab = (extra: Record<string, unknown>) => evt('lab-check', 'lab:rust-allocator', T1, { data: { passed: ['c1'], total: 6, ...extra } })
    ok(lab({}))
    ok(lab({ abi: 1 }))
    ok(lab({ abi: 2, seeds: 'fresh', stage: 2, checks: [{ id: 'c1', status: 'pass', seed: 5, fresh: true }, { id: 'c2', status: 'fail' }, { id: 'c3', status: 'trap' }, { id: 'c4', status: 'timeout' }] }))
    ok(lab({ seeds: 'default' }))
    expect(bad(lab({ abi: 3 }))).toContain('abi')
    expect(bad(lab({ abi: '2' }))).toContain('abi')
    expect(bad(lab({ seeds: 'stale' }))).toContain('seeds')
    expect(bad(lab({ checks: [{ id: 'c1', status: 'ok' }] }))).toContain('checks')
    expect(bad(lab({ checks: [{ status: 'pass' }] }))).toContain('checks')
    expect(bad(lab({ checks: 'c1' }))).toContain('checks')
  })

  test('sim-task outcome data, quiz form data and complete via data pass untouched', () => {
    ok(evt('sim-task', 'sim:sim-kv/a', T1, { data: { v: 2, outcome: true, predict: { value: 1, unit: 'x' }, actual: 2, explain: 'e' } }))
    ok(evt('quiz', 'lesson:t0.l1', T1, { score: 1, ok: true, data: { grp: 'g', n: 3, form: 'spiral', nonMcqOk: true, kcs: ['a'] } }))
    ok(evt('complete', 'lesson:t0.l1', T1, { data: { via: 'testout', grp: 'g' } }))
    ok(evt('complete', 'placement', T1))
    ok(evt('ack', 'hint:rust-allocator/coalesce#bottom', T1))
  })

  test('the four working keys are accepted, with any JSON value; unknown keys are not', () => {
    for (const key of ['placement:result', 'queue:laptop', 'handoff:last', 'today:prefs', 'boot:week']) {
      expect(validateWorkingRecord({ key, value: { a: [1, null] }, at: T1, dev: 'd' }).ok).toBe(true)
    }
    for (const key of ['placement:results', 'queue:', 'today', 'handoff:first']) expect(validateWorkingRecord({ key, value: 1, at: T1, dev: 'd' }).ok).toBe(false)
  })

  test('every Wave 1 shape the generator writes round-trips through export, parse and merge-import', () => {
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, 40)
      const ledger = d.ledger()
      const parsed = parseImport(serializeExport(buildExportV3({ ...ledger, device: d.id, exportedAt: T3 })))
      if (!parsed.ok) throw new Error(`${parsed.error}: ${parsed.detail}`)
      expect(stableStringify(parsed.file.events)).toBe(stableStringify([...ledger.events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1))))
      expect(parsed.file.working.length).toBe(ledger.working.length)
    }, 30)
  })

  test('the generator covers every Wave 1 shape within the property seeds', () => {
    const seen = new Set<string>()
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, 40)
      for (const e of d.events.values()) {
        const data = (e as { data?: Record<string, unknown> }).data ?? {}
        seen.add(`${e.kind} ${e.ref.split(/[:#]/)[0]}`)
        if (typeof data.src === 'string') seen.add(`src ${data.src}`)
        if (typeof data.form === 'string') seen.add(`form ${data.form}`)
        if (typeof data.via === 'string') seen.add(`via ${data.via}`)
        if (data.outcome === true) seen.add('sim outcome')
        if (data.abi === 2) seen.add('lab abi 2')
        if (typeof data.phase === 'string') seen.add(`phase ${data.phase}`)
        if (e.kind === 'ack' && e.ref.endsWith('#bottom')) seen.add('hint bottom')
      }
      for (const w of d.working.keys()) seen.add(`working ${w}`)
    })
    for (const want of [
      'item gen',
      'item pre',
      'item dia',
      'item cr',
      'item item',
      'predict pre',
      'predict dia',
      'predict item',
      'play play',
      'prove prove',
      'complete placement',
      'ack hint',
      'hint bottom',
      'sim outcome',
      'lab abi 2',
      'src today',
      'src testout',
      'src ticket',
      'src placement',
      'src practice',
      'src pre',
      'src diagram',
      'form ticket',
      'form spiral',
      'form testout',
      'via read',
      'via ticket',
      'via testout',
      'phase play',
      'phase compose',
      'working placement:result',
      'working queue:laptop',
      'working handoff:last',
      'working today:prefs',
      'working boot:week',
    ]) {
      expect(seen.has(want) ? want : `missing: ${want}`).toBe(want)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Aggregate v2 folds (§3.4)                                            */
/* ------------------------------------------------------------------ */

describe('aggregate v2', () => {
  test('passedAt is the earliest ok quiz; passVia its form, the smaller form winning an equal instant', () => {
    const agg = derive([
      evt('quiz', 'lesson:t2.l7', T3, { score: 1, ok: true, data: { form: 'testout' } }),
      evt('quiz', 'lesson:t2.l7', T2, { score: 0.5, ok: false, data: { form: 'spiral' } }),
      evt('quiz', 'lesson:t2.l7', T2, { score: 0.9, ok: true, data: { form: 'ticket' } }),
      evt('quiz', 'lesson:t2.l7', T2, { score: 0.9, ok: true, data: { form: 'spiral' } }),
    ])
    expect(agg.lessons['t2.l7'].passedAt).toBe(T2)
    expect(agg.lessons['t2.l7'].passVia).toBe('spiral')
    expect(derive([evt('quiz', 'lesson:x', T1, { score: 1, ok: true })]).lessons.x.passVia).toBe('checkpoint')
    expect(derive([evt('quiz', 'lesson:x', T1, { score: 1, ok: true, data: { form: 'weird' } })]).lessons.x.passVia).toBe('checkpoint')
    expect(derive([evt('quiz', 'lesson:x', T1, { score: 0.2, ok: false })]).lessons.x.passedAt).toBeUndefined()
  })

  test('read: a complete with via read or no via; a ticket or testout complete is not read', () => {
    const read = (data?: Record<string, unknown>) => derive([evt('complete', 'lesson:x', T1, data ? { data } : {})]).lessons.x.read
    expect(read()).toBe(true)
    expect(read({ via: 'read' })).toBe(true)
    expect(read({})).toBe(true)
    expect(read({ via: 'ticket' })).toBeUndefined()
    expect(read({ via: 'testout', grp: 'g' })).toBeUndefined()
  })

  test('the four lesson states (§8.3)', () => {
    const status = (events: LedgerEvent[]) => toProgressData(derive(events)).lessons.x?.status
    expect(status([])).toBeUndefined() // unstarted: no record
    expect(status([evt('visit', 'lesson:x', T1)])).toBe('reading')
    expect(status([evt('visit', 'lesson:x', T1), evt('quiz', 'lesson:x', T2, { score: 0.4, ok: false })])).toBe('reading')
    expect(status([evt('complete', 'lesson:x', T1)])).toBe('read')
    expect(status([evt('complete', 'lesson:x', T1, { data: { via: 'read' } })])).toBe('read')
    expect(status([evt('quiz', 'lesson:x', T1, { score: 1, ok: true })])).toBe('done') // a checkpoint pass needs no complete
    expect(status([evt('complete', 'lesson:x', T1), evt('quiz', 'lesson:x', T2, { score: 1, ok: true, data: { form: 'ticket' } })])).toBe('done')
    expect(status([evt('quiz', 'lesson:x', T1, { score: 1, ok: true, data: { form: 'ticket' } }), evt('complete', 'lesson:x', T1, { data: { via: 'ticket' } })])).toBe('done')
  })

  test('completedAt: the pass time, else the reading time of a read lesson, so a reader still gets change cards', () => {
    const at = (events: LedgerEvent[]) => toProgressData(derive(events)).lessons.x?.completedAt
    expect(at([evt('complete', 'lesson:x', T1)])).toBe(T1)
    expect(at([evt('complete', 'lesson:x', T1), evt('quiz', 'lesson:x', T2, { score: 1, ok: true })])).toBe(T2)
    expect(at([evt('visit', 'lesson:x', T1)])).toBeUndefined()
  })

  test('sims[s].outcomes: only an ok outcome-graded task; legacy tasks still count as done tasks', () => {
    const outcome = (ok: boolean, data: Record<string, unknown> = { v: 2, outcome: true }) => evt('sim-task', 'sim:sim-kv/a', T1, { score: ok ? 1 : 0, ok, data })
    expect(derive([outcome(true)]).sims['sim-kv'].outcomes).toEqual({ a: true })
    expect(derive([outcome(false)]).sims['sim-kv'].outcomes).toEqual({})
    expect(derive([outcome(true, { v: 2 })]).sims['sim-kv'].outcomes).toEqual({}) // no data.outcome: legacy
    const legacy = derive([evt('sim-task', 'sim:sim-kv/b', T1)])
    expect(legacy.sims['sim-kv']).toEqual({ visits: 0, tasks: { b: true }, outcomes: {} })
    expect(derive([outcome(true)]).facts).toMatchObject({ 'simo:sim-kv/a': true, 'sim:sim-kv/a': true })
    expect(derive([outcome(false)]).facts['simo:sim-kv/a']).toBeUndefined()
  })

  test('labs[l].unseen: unseen runs credit passing checks drawn fresh, or reported without a seed', () => {
    const run = (provenance: string, checks: unknown, passed = ['c1', 'c2', 'c3']) =>
      derive([evt('lab-check', 'lab:lab-a', T1, { provenance, data: { passed, total: 4, abi: 2, checks } })]).labs['lab-a'].unseen
    const checks = [
      { id: 'c1', status: 'pass', seed: 7, fresh: true },
      { id: 'c2', status: 'pass', seed: 8 }, // default seed: not drawn at grade time
      { id: 'c3', status: 'pass' }, // no seed
      { id: 'c4', status: 'fail', seed: 9, fresh: true },
    ]
    expect(run('unseen', checks)).toEqual({ c1: true, c3: true })
    expect(run('lab-green', checks)).toEqual({}) // only `unseen` runs
    expect(run('assisted', checks)).toEqual({})
    expect(run('unseen', undefined)).toEqual({}) // a v1 run
    expect(run('unseen', 'garbage')).toEqual({})
    expect(run('unseen', [null, 3, { status: 'pass' }, { id: 5, status: 'pass' }])).toEqual({})
  })

  test('labs[l].assistedUntil: the latest bottom-out + 24 h; other rungs and labs do not count', () => {
    const agg = derive([
      evt('ack', 'hint:lab-a/c1#R1', T3),
      evt('ack', 'hint:lab-a/c1#bottom', T1),
      evt('ack', 'hint:lab-a/c2#bottom', T2),
      evt('ack', 'hint:lab-b/c1#R2', T3),
    ])
    expect(agg.labs['lab-a'].assistedUntil).toBe('2026-09-03T09:00:00.000Z')
    expect(agg.labs['lab-b']).toBeUndefined()
    expect(agg.acks['hint:lab-a/c1#bottom']).toBe(T1)
    expect(xpOf(agg)).toBe(0)
  })

  test('labc facts: the first pass of a required check in any run, v1 runs included', () => {
    const agg = derive([
      evt('lab-check', 'lab:lab-a', T1, { score: 0.5, ok: false, data: { passed: ['c1'], total: 4 } }), // a v1 run
      evt('lab-check', 'lab:lab-a', T2, { score: 0.5, ok: false, data: { passed: ['c1', 'c2'], total: 4, abi: 2 } }),
    ])
    expect(Object.keys(agg.facts).filter((f) => f.startsWith('labc:')).sort()).toEqual(['labc:lab-a/c1', 'labc:lab-a/c2'])
  })

  test('plays[id]: done on an ok play, composed on an ok compose, best over all results', () => {
    const play = (phase: string, ok: boolean, score: number) => evt('play', `play:${PLAY}`, T1, { ok, score, data: { phase, turns: 1, survived: 1, ghostSurvived: 1 } })
    expect(derive([play('play', true, 0.6)]).plays[PLAY]).toEqual({ best: 0.6, done: true })
    expect(derive([play('play', false, 0.9)]).plays[PLAY]).toEqual({ best: 0.9 })
    const both = derive([play('play', true, 0.5), play('compose', true, 1), play('compose', false, 0.2)])
    expect(both.plays[PLAY]).toEqual({ best: 1, done: true, composed: true })
    expect(derive([play('compose', true, 1)]).facts[`play:${PLAY}`]).toBeUndefined() // only a debriefed play pays
    expect(derive([play('play', true, 1)]).facts[`play:${PLAY}`]).toBe(true)
  })

  test('proves[lab]: the earliest ok prove, one fact', () => {
    const prove = (at: string, ok: boolean) => evt('prove', 'prove:rust-allocator', at, { ok, score: ok ? 1 : 0, data: { v: 1, qids: ['a'], self: [1] } })
    const agg = derive([prove(T3, true), prove(T2, true), prove(T1, false)])
    expect(agg.proves).toEqual({ 'rust-allocator': T2 })
    expect(agg.facts['prove:rust-allocator']).toBe(true)
    expect(derive([prove(T1, false)]).proves).toEqual({})
  })

  test('itemSec[day]: whole nominal seconds of distinct graded items, 30 when unstated, clamped to [0, 600]', () => {
    const item = (nsec: unknown, day: string, kind: 'item' | 'probe' = 'item') => evt(kind, 'gen:kv/x', `${day}T09:00:00.000Z`, { rev: 'r', data: { src: 'today', ...(nsec === undefined ? {} : { nsec }) } })
    const agg = derive([
      item(45, '2026-09-01'),
      item(undefined, '2026-09-01'),
      item(2000, '2026-09-01', 'probe'),
      item(-5, '2026-09-01'),
      item(12.4, '2026-09-02'),
      evt('predict', 'pre:t1.l4#0', '2026-09-02T09:00:00.000Z', { rev: 'r', data: { value: 1, unit: 'x', truth: 1, src: 'pre', nsec: 20 } }),
    ])
    expect(agg.itemSec).toEqual({ '2026-09-01': 45 + 30 + 600 + 0, '2026-09-02': 12 + 20 })
    const copy = evt('item', 'gen:kv/x', T1, { rev: 'r', data: { src: 'today', nsec: 50 } })
    expect(derive([copy, copy]).itemSec[copy.day]).toBe(50) // repeats collapse
  })

  test('itemSec sums to the same number in any order, even with fractional nsec', () => {
    const events = Array.from({ length: 40 }, (_, i) => evt('item', 'gen:kv/x', T1, { rev: 'r', data: { src: 'today', nsec: 0.1 * i + 0.37 } }))
    const forward = derive(events).itemSec[events[0].day]
    expect(derive([...events].reverse()).itemSec[events[0].day]).toBe(forward)
    expect(Number.isInteger(forward)).toBe(true)
  })

  test('facts: simo, labc, play, prove, boot and placement; XP v1 pays nothing for them', () => {
    const agg = derive([
      evt('complete', 'boot', T1),
      evt('complete', 'placement', T1),
      evt('sim-task', 'sim:sim-kv/a', T1, { data: { v: 2, outcome: true } }),
      evt('lab-check', 'lab:lab-a', T1, { score: 0.25, ok: false, data: { passed: ['c1'], total: 4 } }),
      evt('play', `play:${PLAY}`, T1, { data: { phase: 'play', turns: 1, survived: 1, ghostSurvived: 1 } }),
      evt('prove', 'prove:lab-a', T1, { data: { qids: ['q'], self: [1] } }),
    ])
    expect(Object.keys(agg.facts).sort()).toEqual(['boot', 'labc:lab-a/c1', 'placement', 'play:block-placement', 'prove:lab-a', 'sim:sim-kv/a', 'simo:sim-kv/a'])
    expect(agg.completions).toEqual({ boot: T1, placement: T1 })
    expect(factXp('boot')).toBe(0)
    expect(factXp('placement')).toBe(0)
    for (const f of ['simo:s/t', 'labc:l/c', 'play:p', 'prove:l']) expect(factXp(f)).toBe(0)
    expect(xpOf(agg)).toBe(factXp('sim:sim-kv/a')) // only the v1 fact pays: XP stays v1 until B7
  })

  test('summary counts passed lessons only', () => {
    const agg = derive([evt('complete', 'lesson:a', T1), evt('quiz', 'lesson:b', T1, { score: 1, ok: true })])
    expect(summary(agg).lessonsDone).toBe(1)
  })

  test('P6 and I7 hold for the Wave 1 ops (the fold and optimistic-agreement properties run the same generator)', () => {
    expect([...GRADED_KINDS]).toContain('play')
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, 40)
      const events = d.ledger().events
      const forward = stableStringify(derive(events))
      expect(stableStringify(derive([...events].reverse()))).toBe(forward)
      expect(stableStringify(derive([...events, ...events]))).toBe(forward)
    }, 30)
  })
})

/* ------------------------------------------------------------------ */
/* Wave 0b data under v3.1 (§3.4, §8.7)                                 */
/* ------------------------------------------------------------------ */

/** What Wave 0b wrote: one click-complete lesson, one checkpoint pass, a sim task, a lab run, a Boot step. */
function wave0bLedger(): LedgerEvent[] {
  return [
    evt('visit', 'lesson:t0.l1', T1),
    evt('complete', 'lesson:t0.l1', T1), // the click: no `via`
    evt('visit', 'lesson:t0.l2', T1),
    evt('item', 'quiz:t0.l2#0', T2, { rev: 'a', score: 1, ok: true, data: { src: 'quiz', pick: [1], grp: 'g', lessonId: 't0.l2' } }),
    evt('quiz', 'lesson:t0.l2', T2, { score: 1, ok: true, data: { grp: 'g', n: 1 } }), // the checkpoint pass: no `form`, no complete
    evt('visit', 'lesson:t0.l3', T2),
    evt('sim-task', 'sim:sim-kv/a', T2), // no data.outcome: legacy
    evt('lab-check', 'lab:lab-a', T2, { score: 0.5, ok: false, provenance: 'lab-green', data: { passed: ['c1', 'c2'], total: 4 } }), // no abi: a v1 run
    evt('predict', 'boot:decode-tps', T1, { rev: 'b', score: 1, ok: true, data: { value: 10, unit: 'tok/s', truth: 10, src: 'boot' } }),
  ]
}

describe('a Wave 0b fixture ledger', () => {
  test('reads as read, done and reading; legacy sim and v1 lab runs earn no Wave 1 credit', () => {
    const agg = derive(wave0bLedger())
    const data = toProgressData(agg)
    expect(data.lessons['t0.l1']).toMatchObject({ status: 'read', completedAt: T1 })
    expect(data.lessons['t0.l2']).toMatchObject({ status: 'done', completedAt: T2 })
    expect(data.lessons['t0.l3'].status).toBe('reading')
    expect(agg.lessons['t0.l2'].passVia).toBe('checkpoint')
    expect(agg.sims['sim-kv'].outcomes).toEqual({})
    expect(agg.labs['lab-a'].unseen).toEqual({})
    expect(data.sims['sim-kv'].tasksDone).toEqual(['a']) // shown as seen
    expect(data.xp).toBe(xpOf(agg)) // XP is still v1
  })
})

describe('change cards', () => {
  test('a lesson that was only read keeps its reading time, so its learner still gets the cards (§3.4)', () => {
    const before = '2026-09-28T10:00:00.000Z'
    const view = toProgressData(derive([evt('complete', 'lesson:t6.l3', before)]))
    expect(view.lessons['t6.l3'].status).toBe('read')
    expect(changeCardsFor(view.lessons, {}, [kvbm]).map((c) => c.lessonIds)).toEqual([['t6.l3']])
    const visitOnly = toProgressData(derive([evt('visit', 'lesson:t6.l3', before)]))
    expect(changeCardsFor(visitOnly.lessons, {}, [kvbm])).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* upgradeAggregate (§3.1)                                              */
/* ------------------------------------------------------------------ */

/** The Wave 0b fold, frozen here as the oracle for "v1 fields never change meaning". */
function deriveV1(events: LedgerEvent[]): AggregateV1 {
  const byId = new Map<string, LedgerEvent>()
  for (const e of events) {
    const prev = byId.get(e.id)
    byId.set(e.id, prev ? canonicalEvent(prev, e) : e)
  }
  const min = (a: string | undefined, b: string) => (a !== undefined && a <= b ? a : b)
  const max = (a: string | undefined, b: string) => (a !== undefined && a >= b ? a : b)
  const agg: AggregateV1 = { v: 1, events: 0, lessons: {}, sims: {}, labs: {}, fleetWeek: { acts: {}, scores: {} }, capstone: { steps: {}, step: 0 }, facts: {}, days: {}, achievements: {}, acks: {}, completions: {} }
  const lesson = (id: string) => (agg.lessons[id] ??= {})
  const sim = (id: string) => (agg.sims[id] ??= { visits: 0, tasks: {} })
  const lab = (id: string) => (agg.labs[id] ??= { checks: {} })
  for (const e of byId.values()) {
    agg.events += 1
    const tail = (p: string) => (e.ref.startsWith(p) && e.ref.length > p.length ? e.ref.slice(p.length) : null)
    const data = ((e as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>
    const passed = Array.isArray(data.passed) ? (data.passed as string[]) : []
    switch (e.kind) {
      case 'visit': {
        const l = tail('lesson:')
        if (l !== null) lesson(l).lastAt = max(lesson(l).lastAt, e.at)
        else if (tail('sim:') !== null) sim(tail('sim:')!).visits += 1
        break
      }
      case 'complete': {
        const l = tail('lesson:')
        if (l !== null) {
          const L = lesson(l)
          L.done = true
          L.completedAt = min(L.completedAt, e.at)
          L.lastAt = max(L.lastAt, e.at)
          agg.facts[`lesson:${l}`] = true
        } else agg.completions[e.ref] = min(agg.completions[e.ref], e.at)
        break
      }
      case 'exercise': {
        const l = tail('lesson:')
        if (l === null) break
        lesson(l).exercise = true
        lesson(l).lastAt = max(lesson(l).lastAt, e.at)
        agg.facts[`exercise:${l}`] = true
        break
      }
      case 'quiz': {
        const l = tail('lesson:')
        if (l === null) break
        const L = lesson(l)
        L.quizBest = Math.max(L.quizBest ?? 0, e.score)
        L.lastAt = max(L.lastAt, e.at)
        if (e.ok) agg.facts[`quiz-pass:${l}`] = true
        break
      }
      case 'item':
      case 'probe': {
        const q = parseQuizItemRef(e.ref)
        if (q) lesson(q.lessonId).lastAt = max(lesson(q.lessonId).lastAt, e.at)
        break
      }
      case 'sim-task': {
        const t = parseSimTaskRef(e.ref)
        if (!t) break
        sim(t.simId).tasks[t.taskId] = true
        agg.facts[`sim:${t.simId}/${t.taskId}`] = true
        break
      }
      case 'lab-check': {
        const l = tail('lab:')
        if (l === null) break
        const L = lab(l)
        for (const c of passed) L.checks[c] = true
        if (typeof data.total === 'number') L.total = Math.max(L.total ?? 0, data.total)
        if (e.ok) {
          L.done = true
          L.completedAt = min(L.completedAt, e.at)
          agg.facts[`lab:${l}`] = true
        }
        break
      }
      case 'fleet-act': {
        const a = tail('fw:')
        if (a === null) break
        agg.fleetWeek.scores[a] = Math.max(agg.fleetWeek.scores[a] ?? e.score, e.score)
        if (e.ok) {
          agg.fleetWeek.acts[a] = true
          agg.facts[`fw:${a}`] = true
        }
        break
      }
      case 'capstone-step': {
        const s = tail('cap:')
        if (s === null) break
        agg.capstone.steps[s] = true
        if (typeof data.index === 'number') agg.capstone.step = Math.max(agg.capstone.step, data.index + 1)
        agg.facts[`cap:${s}`] = true
        break
      }
      case 'achievement': {
        const a = tail('ach:')
        if (a !== null) agg.achievements[a] = min(agg.achievements[a], e.at)
        break
      }
      case 'ack':
        agg.acks[e.ref] = min(agg.acks[e.ref], e.at)
        break
      default:
        break
    }
    if (GRADED_KINDS.has(e.kind) && !(e.kind === 'lab-check' && passed.length === 0)) agg.days[e.day] = true
  }
  return agg
}

const V1_FACT = /^(lesson|quiz-pass|exercise|sim|lab|fw|cap):/

/** An aggregate with only what v1 knew, so a v1 fold and a v2 fold compare. */
function v1Fields(a: Aggregate | AggregateV1) {
  const labs: Record<string, unknown> = {}
  for (const [id, { checks, done, completedAt, total }] of Object.entries(a.labs)) {
    // a lab entry only a hint ack created holds no v1 data: v1 never had it
    if (Object.keys(checks).length > 0 || done || completedAt !== undefined || total !== undefined) labs[id] = { checks, done, completedAt, total }
  }
  return {
    events: a.events,
    lessons: Object.fromEntries(Object.entries(a.lessons).map(([id, { done, completedAt, lastAt, quizBest, exercise }]) => [id, { done, completedAt, lastAt, quizBest, exercise }])),
    sims: Object.fromEntries(Object.entries(a.sims).map(([id, { visits, tasks }]) => [id, { visits, tasks }])),
    labs,
    fleetWeek: a.fleetWeek,
    capstone: a.capstone,
    facts: Object.fromEntries(Object.entries(a.facts).filter(([k]) => V1_FACT.test(k))),
    days: a.days,
    achievements: a.achievements,
    acks: a.acks,
    completions: a.completions,
  }
}

describe('upgradeAggregate', () => {
  test('upgradeAggregate(derive_v1(L)) equals derive_v2(L) on every v1 field, over the generated ledgers', () => {
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, 40)
      const events = d.ledger().events
      const v1 = deriveV1(events)
      const upgraded = upgradeAggregate(v1)
      expect(upgraded.v).toBe(2)
      expect(stableStringify(v1Fields(upgraded))).toBe(stableStringify(v1Fields(derive(events))))
      expect(stableStringify(v1Fields(v1))).toBe(stableStringify(v1Fields(derive(events))))
    })
  })

  test('the new fields come empty, read is inferred from the click, and a pass keeps an upper-bound instant', () => {
    const v1 = deriveV1(wave0bLedger())
    const up = upgradeAggregate(v1)
    expect(up).toMatchObject({ v: 2, plays: {}, proves: {}, itemSec: {} })
    expect(up.sims['sim-kv'].outcomes).toEqual({})
    expect(up.labs['lab-a'].unseen).toEqual({})
    expect(up.lessons['t0.l1']).toMatchObject({ read: true })
    expect(up.lessons['t0.l1'].passedAt).toBeUndefined()
    expect(up.lessons['t0.l2'].passedAt).toBe(T2) // lastAt: the exact instant arrives with the engine's derive
    expect(toProgressData(up).lessons['t0.l1'].status).toBe('read')
    expect(toProgressData(up).lessons['t0.l2'].status).toBe('done')
    expect(toProgressData(up).lessons['t0.l3'].status).toBe('reading')
  })

  test('the upgrade does not touch its input', () => {
    const v1 = deriveV1(wave0bLedger())
    const frozen = structuredClone(v1)
    upgradeAggregate(v1)
    expect(v1).toEqual(frozen)
  })

  test('an own __proto__ id in a v1 aggregate survives as an ordinary key', () => {
    const v1 = JSON.parse('{"v":1,"events":0,"lessons":{"__proto__":{"done":true,"completedAt":"2026-09-01T09:00:00.000Z"}},"sims":{"__proto__":{"visits":1,"tasks":{}}},"labs":{"__proto__":{"checks":{}}},"fleetWeek":{"acts":{},"scores":{}},"capstone":{"steps":{},"step":0},"facts":{},"days":{},"achievements":{},"acks":{},"completions":{}}') as AggregateV1
    const up = upgradeAggregate(v1)
    expect(Object.keys(up.lessons)).toEqual(['__proto__'])
    expect(Object.keys(up.sims)).toEqual(['__proto__'])
    expect(Object.keys(up.labs)).toEqual(['__proto__'])
    expect(({} as Record<string, unknown>).read).toBeUndefined()
    expect(Object.getPrototypeOf(up.lessons)).toBe(Object.prototype)
  })
})

/* ------------------------------------------------------------------ */
/* Hydrate: no empty first paint (§3.1)                                 */
/* ------------------------------------------------------------------ */

describe('hydrate from a Wave 0b snapshot', () => {
  const snapshotV1 = (events: LedgerEvent[]) => ({ schemaVersion: 3, aggregateVersion: 1, writtenAt: T2, tab: 'old', aggregate: deriveV1(events), working: [] })

  test('a version-1 snapshot paints its numbers at once and boots the engine at once, not on idle', async () => {
    const events = wave0bLedger()
    const p = makeProfile({ seed: { events, meta: { schema: { version: 3, at: T1 } } } })
    p.storage.data.set(SNAPSHOT_KEY, JSON.stringify(snapshotV1(events)))
    const tab = startTab(p) // scheduleBoot is a no-op here, so anything the engine does is the upgrade's doing
    const s = tab.progress.getState()
    expect(s.lessons['t0.l1']?.status).toBe('read')
    expect(s.lessons['t0.l2']?.status).toBe('done')
    expect(s.lessons['t0.l3']?.status).toBe('reading')
    expect(s.xp).toBe(xpOf(derive(events)))
    expect(s.aggregate.v).toBe(2)
    expect(s.ledger).toMatchObject({ ready: false, readOnly: false })
    expect(tab.loads()).toBe(1) // booted without waiting for idle

    await tab.progress.controls.flush()
    await tab.progress.controls.engine()
    await tick(5)
    expect(tab.progress.getState().ledger.ready).toBe(true)
    expect(stableStringify(tab.progress.getState().aggregate)).toBe(stableStringify(derive(events))) // the exact derive replaced the upgrade
    expect(tab.progress.getState().lessons['t0.l2']?.completedAt).toBe(T2)
  })

  test('a v2 snapshot does not boot the engine early; a snapshot of an unknown aggregate version is ignored', async () => {
    const p = makeProfile()
    const first = startTab(p)
    first.progress.getState().completeLesson('t0.l1', 'read')
    await first.progress.controls.flush()
    const second = startTab(p)
    expect(second.progress.getState().lessons['t0.l1']?.status).toBe('read')
    expect(second.loads()).toBe(0) // the idle boot is what starts the engine, as before
    const raw = JSON.stringify({ ...snapshotV1(wave0bLedger()), aggregateVersion: 99, aggregate: { ...snapshotV1(wave0bLedger()).aggregate, v: 99 } })
    const q = makeProfile()
    q.storage.data.set(SNAPSHOT_KEY, raw)
    expect(startTab(q).progress.getState().lessons).toEqual({})
  })

  test('a v2 snapshot with malformed new maps is ignored rather than crashing an action', () => {
    const agg = { ...derive(wave0bLedger()) } as Partial<Aggregate>
    delete agg.plays
    const p = makeProfile()
    p.storage.data.set(SNAPSHOT_KEY, JSON.stringify({ schemaVersion: 4, aggregateVersion: 2, aggregate: agg, working: [] }))
    const tab = startTab(p)
    expect(tab.progress.getState().lessons).toEqual({})
    tab.progress.getState().recordProve({ labId: 'lab-a', score: 1, ok: true, data: { v: 1, qids: ['a'], self: [1] } })
    expect(tab.progress.getState().aggregate.proves['lab-a']).toBeDefined()
  })

  test('a v1 snapshot written by a newer schema still goes read-only', () => {
    const p = makeProfile()
    p.storage.data.set(SNAPSHOT_KEY, JSON.stringify({ ...snapshotV1(wave0bLedger()), schemaVersion: SCHEMA_VERSION + 1 }))
    const tab = startTab(p)
    expect(tab.progress.getState().ledger).toMatchObject({ readOnly: true, reason: 'snapshot-newer' })
    expect(tab.loads()).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* Façade actions (§3.3)                                                */
/* ------------------------------------------------------------------ */

const response = (n: number, ok: boolean, extra: Record<string, unknown> = {}) => ({
  ref: `gen:frag/v${n}` as const,
  rev: `r${n}`,
  score: ok ? 1 : 0,
  ok,
  data: { src: 'ticket' as const, kcs: ['kc.a', 'kc.b'], nsec: 40 },
  ...extra,
})

const kinds = async (tab: ReturnType<typeof startTab>) => (await (await tab.engine()).events()).map((e) => e.kind)

describe('façade: the Wave 1 actions', () => {
  test('recordTicket: n items, one quiz summary and, on a pass, one complete with via; a pass makes the lesson done', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().recordTicket({ lessonId: 't1.l2', form: 'ticket', seed: 77, ms: 5000, ok: true, nonMcqOk: true, responses: [response(0, true), response(1, true), response(2, false)] })
    expect(getState().lessons['t1.l2']).toMatchObject({ status: 'done' })
    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    expect(events.map((e) => e.kind).sort()).toEqual(['complete', 'item', 'item', 'item', 'quiz'])

    const items = events.filter((e) => e.kind === 'item')
    expect(items.map((e) => e.ref).sort()).toEqual(['gen:frag/v0', 'gen:frag/v1', 'gen:frag/v2'])
    const grp = (items[0] as { data: { grp: string } }).data.grp
    for (const e of items) {
      expect(e).toMatchObject({ provenance: 'practice', data: { src: 'ticket', form: 'ticket', grp, of: 3, kcs: ['kc.a', 'kc.b'], nsec: 40, lessonId: 't1.l2' } })
      expect(typeof (e as { data: { slot: number } }).data.slot).toBe('number')
    }
    expect(items.map((e) => (e as { data: { slot: number } }).data.slot).sort()).toEqual([0, 1, 2])
    const quiz = events.find((e) => e.kind === 'quiz')
    expect(quiz).toMatchObject({ ref: 'lesson:t1.l2', ok: true, seed: 77, ms: 5000, data: { grp, n: 3, form: 'ticket', nonMcqOk: true, kcs: ['kc.a', 'kc.b'] } })
    expect((quiz as { score: number }).score).toBeCloseTo(2 / 3)
    expect(events.find((e) => e.kind === 'complete')).toMatchObject({ ref: 'lesson:t1.l2', data: { via: 'ticket', grp } })
    expect(getState().aggregate.lessons['t1.l2'].passVia).toBe('ticket')
  })

  test('recordTicket: a test-out passes via testout and stamps src testout; a miss writes evidence but completes nothing', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().recordTicket({ lessonId: 't1.l3', form: 'testout', seed: 1, ok: true, nonMcqOk: true, responses: [response(0, true, { data: { src: 'testout' } })] })
    expect(getState().aggregate.lessons['t1.l3'].passVia).toBe('testout')
    getState().recordTicket({ lessonId: 't1.l4', form: 'spiral', seed: 2, ok: false, nonMcqOk: false, responses: [response(0, false), response(1, true)] })
    expect(getState().lessons['t1.l4']?.status).toBe('reading') // a miss: evidence only
    expect(getState().aggregate.lessons['t1.l4'].passedAt).toBeUndefined()
    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    expect(events.filter((e) => e.kind === 'complete').map((e) => (e as { data: { via: string } }).data.via)).toEqual(['testout'])
    expect(events.filter((e) => e.kind === 'item' && e.ref === 'gen:frag/v0' && (e as { data: { form: string } }).data.form === 'testout')).toHaveLength(1)
    // never skipped: a second miss and a second pass both write
    const before = events.length
    getState().recordTicket({ lessonId: 't1.l4', form: 'spiral', seed: 3, ok: false, nonMcqOk: false, responses: [response(0, false)] })
    getState().recordTicket({ lessonId: 't1.l3', form: 'testout', seed: 4, ok: true, nonMcqOk: true, responses: [response(0, true)] })
    await tab.progress.controls.flush()
    expect((await (await tab.engine()).events()).length).toBe(before + 2 + 3)
    getState().recordTicket({ lessonId: 't1.l4', form: 'ticket', seed: 5, ok: true, nonMcqOk: true, responses: [] }) // nothing to record
    await tab.progress.controls.flush()
    expect((await (await tab.engine()).events()).length).toBe(before + 2 + 3)
  })

  test('recordTicket keeps at most 6 KCs per item, so the codec never refuses the event at flush', async () => {
    const tab = startTab(makeProfile())
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    tab.progress.getState().recordTicket({ lessonId: 't1.l2', form: 'ticket', seed: 1, ok: true, nonMcqOk: true, responses: [response(0, true, { data: { src: 'ticket', kcs: many } })] })
    tab.progress.getState().recordQuizAttempt({ lessonId: 't1.l2', seed: 1, responses: [{ qi: 0, rev: 'r', pick: [0], ok: true, kcs: many }] })
    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    expect(events.filter((e) => e.kind === 'item')).toHaveLength(2) // both survived validation
    for (const e of events.filter((x) => x.kind === 'item')) expect((e as { data: { kcs: string[] } }).data.kcs).toHaveLength(6)
    expect(tab.progress.getState().ledger.readOnly).toBe(false)
  })

  test('recordQuizAttempt: data.kcs on each item from the question', async () => {
    const tab = startTab(makeProfile())
    tab.progress.getState().recordQuizAttempt({ lessonId: 't0.l1', seed: 1, responses: [{ qi: 0, rev: 'a', pick: [0], ok: true, kcs: ['kc.x'] }, { qi: 1, rev: 'b', pick: [1], ok: false }] })
    await tab.progress.controls.flush()
    const items = (await (await tab.engine()).events()).filter((e) => e.kind === 'item') as unknown as { ref: string; data: { kcs?: string[] } }[]
    expect(items.find((e) => e.ref === 'quiz:t0.l1#0')?.data.kcs).toEqual(['kc.x'])
    expect(items.find((e) => e.ref === 'quiz:t0.l1#1')?.data.kcs).toBeUndefined()
  })

  test('completeLesson(id, read): once, and never after a read or a pass', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().completeLesson('t3.l1', 'read')
    expect(getState().lessons['t3.l1']?.status).toBe('read')
    expect(getState().lessons['t3.l1']?.completedAt).toBeDefined()
    getState().completeLesson('t3.l1', 'read')
    getState().markLessonStatus('t3.l1', 'done') // the old click is also a no-op once it is read
    getState().markLessonStatus('t3.l1', 'read')
    getState().recordQuizScore('t3.l1', 1)
    expect(getState().lessons['t3.l1']?.status).toBe('done')
    getState().completeLesson('t3.l1', 'read') // passed: skip
    getState().markLessonStatus('t3.l1', 'done')
    await tab.progress.controls.flush()
    expect(await kinds(tab)).toEqual(expect.arrayContaining(['complete', 'quiz']))
    expect((await kinds(tab)).filter((k) => k === 'complete')).toHaveLength(1)
    const complete = (await (await tab.engine()).events()).find((e) => e.kind === 'complete')
    expect(complete).toMatchObject({ ref: 'lesson:t3.l1', data: { via: 'read' } })
  })

  test('recordSimOutcome: not twice once ok; a miss does not block the retry', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    const outcome = (ok: boolean) => ({ taskId: 'a', score: ok ? 1 : 0, ok, data: { v: 2 as const, outcome: true as const, predict: { value: 4, unit: 'GB' }, actual: ok ? 4 : 40 } })
    getState().recordSimOutcome('sim-kv', outcome(false))
    expect(getState().aggregate.sims['sim-kv'].outcomes).toEqual({})
    getState().recordSimOutcome('sim-kv', outcome(true))
    expect(getState().aggregate.sims['sim-kv'].outcomes).toEqual({ a: true })
    getState().recordSimOutcome('sim-kv', outcome(true)) // skip
    getState().recordSimOutcome('sim-kv', outcome(false)) // skip: an ok outcome already counts
    getState().recordSimOutcome('sim-kv', { ...outcome(true), taskId: 'b' })
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'sim-task')
    expect(events.map((e) => e.ref).sort()).toEqual(['sim:sim-kv/a', 'sim:sim-kv/a', 'sim:sim-kv/b'])
    expect(events[0]).toMatchObject({ data: { v: 2, outcome: true } })
    expect(getState().sims['sim-kv'].tasksDone).toEqual(['a', 'b'])
  })

  test('recordLabRun: v2 detail and provenance on the event; ok is cumulative like recordLabResult', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    const run = (passed: string[]) => ({
      labId: 'lab-b',
      passed,
      total: 2,
      abi: 2 as const,
      seeds: 'fresh' as const,
      provenance: 'unseen' as const,
      checks: ['c1', 'c2'].map((id) => ({ id, status: passed.includes(id) ? ('pass' as const) : ('fail' as const), seed: 3, fresh: true })),
      stage: 1,
      wasmSha256: 'ab'.repeat(32),
    })
    getState().recordLabRun(run(['c1']))
    expect(getState().labs['lab-b']).toMatchObject({ done: false, checksDone: ['c1'] })
    getState().recordLabRun(run(['c2']))
    expect(getState().labs['lab-b'].done).toBe(true) // c1 earlier, c2 now
    expect(getState().aggregate.labs['lab-b'].unseen).toEqual({ c1: true, c2: true })
    getState().recordLabRun(run([])) // never skipped
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'lab-check')
    expect(events).toHaveLength(3)
    expect(events.map((e) => e.ok).sort()).toEqual([false, true, true].sort())
    const first = events.find((e) => (e as { data: { passed: string[] } }).data.passed[0] === 'c1')
    expect(first).toMatchObject({ provenance: 'unseen', wasmSha256: 'ab'.repeat(32), data: { total: 2, abi: 2, seeds: 'fresh', stage: 1 } })
    // recordLabResult (v1) is unchanged: no abi, lab-green by default
    getState().recordLabResult('lab-a', ['c1'], 4)
    await tab.progress.controls.flush()
    const v1 = (await (await tab.engine()).events()).find((e) => e.kind === 'lab-check' && e.ref === 'lab:lab-a')
    expect(v1).toMatchObject({ provenance: 'lab-green', data: { passed: ['c1'], total: 4 } })
    expect((v1 as { data: object }).data).not.toHaveProperty('abi')
  })

  test('recordPlay and recordProve write one event each, never skipped', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    const play = { playId: PLAY, score: 0.75, ok: true, seed: 12, provenance: 'practice' as const, ms: 9000, data: { phase: 'play' as const, turns: 8, survived: 6, ghostSurvived: 7 } }
    getState().recordPlay(play)
    getState().recordPlay(play)
    getState().recordProve({ labId: 'lab-a', score: 1, ok: true, data: { v: 1, qids: ['a', 'b'], self: [1, 1] } })
    getState().recordProve({ labId: 'lab-a', score: 0.5, ok: false, data: { v: 1, qids: ['a', 'b'], self: [1, 0] } })
    expect(getState().aggregate.plays[PLAY]).toEqual({ best: 0.75, done: true })
    expect(getState().aggregate.proves['lab-a']).toBeDefined()
    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    expect(events.filter((e) => e.kind === 'play')).toHaveLength(2)
    expect(events.filter((e) => e.kind === 'prove')).toHaveLength(2)
    expect(events.find((e) => e.kind === 'play')).toMatchObject({ ref: `play:${PLAY}`, seed: 12, ms: 9000, provenance: 'practice', data: { phase: 'play', turns: 8 } })
    expect(events.find((e) => e.kind === 'prove')).toMatchObject({ ref: 'prove:lab-a', provenance: 'practice' })
  })

  test('completePlacement: complete placement plus the working result; a second walk replaces the result', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const { getState } = tab.progress
    getState().completePlacement({ at: T1, tracks: { t0: 2 } })
    expect(getState().completions.placement).toBeDefined()
    expect(getState().working['placement:result']).toEqual({ at: T1, tracks: { t0: 2 } })
    p.clock.advance(5)
    getState().completePlacement({ at: T2, tracks: { t0: 3 } })
    expect(getState().working['placement:result']).toEqual({ at: T2, tracks: { t0: 3 } })
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'complete')
    expect(events).toHaveLength(2) // never skipped
    expect(getState().completions.placement).toBe(events.map((e) => e.at).sort()[0]) // the earliest stays
    expect(getState().aggregate.facts.placement).toBe(true)
    // it reaches another tab (working keys broadcast) and survives a reload
    const other = startTab(p)
    await other.progress.controls.engine()
    expect(other.progress.getState().working['placement:result']).toEqual({ at: T2, tracks: { t0: 3 } })
  })

  test('a read-only tab writes nothing through any new action', async () => {
    const p = makeProfile({ seed: { meta: { schema: { version: SCHEMA_VERSION + 1, at: T1 } } } })
    const tab = startTab(p)
    await tab.progress.controls.engine().catch(() => undefined)
    const s = tab.progress.getState()
    s.recordTicket({ lessonId: 'x', form: 'ticket', seed: 1, ok: true, nonMcqOk: true, responses: [response(0, true)] })
    s.completeLesson('x', 'read')
    s.completePlacement({ a: 1 })
    s.recordProve({ labId: 'l', score: 1, ok: true, data: { v: 1, qids: [], self: [] } })
    expect((await p.store.readAll()).events).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/* The outbox keeps every new shape (§3.6, W9)                          */
/* ------------------------------------------------------------------ */

describe('the outbox flush keeps every Wave 1 event', () => {
  test('a tab that never reached the engine leaves its events in the outbox; the next load commits all of them', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const s = tab.progress.getState()
    s.recordTicket({ lessonId: 't1.l2', form: 'ticket', seed: 1, ok: true, nonMcqOk: true, responses: [response(0, true), response(1, true)] })
    s.recordTicket({ lessonId: 't1.l3', form: 'testout', seed: 2, ok: true, nonMcqOk: true, responses: [response(0, true, { data: { src: 'testout' } })] })
    s.completeLesson('t1.l4', 'read')
    s.recordSimOutcome('sim-kv', { taskId: 'a', score: 1, ok: true, data: { v: 2, outcome: true, predict: { value: 1, unit: 'x' }, actual: 1 } })
    s.recordLabRun({ labId: 'lab-a', passed: ['c1'], total: 4, abi: 2, seeds: 'fresh', provenance: 'unseen', checks: [{ id: 'c1', status: 'pass', seed: 1, fresh: true }] })
    s.recordPlay({ playId: PLAY, score: 1, ok: true, seed: 1, provenance: 'unseen', data: { phase: 'compose', turns: 1, survived: 1, ghostSurvived: 1, equivalent: true } })
    s.recordProve({ labId: 'lab-a', score: 1, ok: true, data: { v: 1, qids: ['q'], self: [1] } })
    s.completePlacement({ at: T1 })
    s.acknowledge('hint:lab-a/c1#bottom')
    s.recordItems(
      WAVE1_ITEM_REFS.map((ref, i) => ({ kind: i % 2 ? ('probe' as const) : ('item' as const), ref: ref as `item:${string}`, rev: 'r', score: 1, ok: true, data: { src: 'today' as const, nsec: 30, kcs: ['kc.a'] } })),
    )
    s.recordItems([{ kind: 'predict', ref: 'pre:t1.l4#0', rev: 'p', score: 1, ok: true, data: { value: 1, unit: 'x', truth: 1, src: 'pre' } }])
    s.setWorking('queue:laptop', [])
    s.setWorking('handoff:last', { at: T1, events: 1 })
    s.setWorking('today:prefs', { phoneMode: true })

    const box = readOutbox(p.storage, tab.tabId)!
    expect(box.events).toHaveLength(21) // 4 + 3 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 6 + 1
    for (const e of box.events) expect(validateEvent(e).ok).toBe(true)
    for (const w of box.working) expect(validateWorkingRecord(w).ok).toBe(true)
    const expected = new Set(box.events.map((e) => e.id))

    const next = startTab(p) // the first tab never got to flush; its outbox is adopted at boot (validated like an import)
    await next.progress.controls.engine()
    const stored = await (await next.engine()).events()
    expect(new Set(stored.map((e) => e.id))).toEqual(expected)
    expect(next.progress.getState().working['placement:result']).toEqual({ at: T1 })
    expect(Object.keys(next.progress.getState().working).sort()).toEqual(['handoff:last', 'placement:result', 'queue:laptop', 'today:prefs'])
    expect(next.progress.getState().lessons['t1.l4']?.status).toBe('read')
    expect(next.progress.getState().lessons['t1.l2']?.status).toBe('done')
  })

  test('every event the generator writes passes validateEvent', async () => {
    let n = 0
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, 40)
      for (const e of d.events.values()) {
        expect(validateEvent(e).ok ? '' : `${e.kind} ${e.ref}: ${bad(e)}`).toBe('')
        n += 1
      }
    }, 100)
    expect(n).toBeGreaterThan(1000)
  })
})

/* ------------------------------------------------------------------ */
/* exportV3({sinceAt}) (§3.1, §6.6)                                     */
/* ------------------------------------------------------------------ */

describe('exportV3({ sinceAt })', () => {
  test('buildExportV3: only events and working records at or after the bound; no components or extras', () => {
    const events = [evt('visit', 'lesson:a', T1), evt('visit', 'lesson:b', T2), evt('visit', 'lesson:c', T3)]
    const working = [
      { key: 'today:prefs' as const, value: 1, at: T1, dev: 'd' },
      { key: 'handoff:last' as const, value: 2, at: T3, dev: 'd' },
    ]
    const component = { sha256: 'ab'.repeat(32), labId: 'l', size: 1, addedAt: T1 }
    const full = buildExportV3({ events, working, device: 'd', exportedAt: T3, components: [component], extras: { capstoneDrafts: { s1: 'x' } } })
    expect(full.events).toHaveLength(3)
    expect(full.components).toHaveLength(1)
    const delta = buildExportV3({ events, working, device: 'd', exportedAt: T3, components: [component], extras: { capstoneDrafts: { s1: 'x' } }, sinceAt: T2 })
    expect(delta.events.map((e) => e.ref)).toEqual(['lesson:b', 'lesson:c']) // inclusive
    expect(delta.working.map((w) => w.key)).toEqual(['handoff:last'])
    expect(delta.components).toEqual([])
    expect(delta.extras).toEqual({ capstoneDrafts: {} })
    expect(delta).toMatchObject({ format: 'kernelspace-progress', version: 3, schemaVersion: 4 })
    expect(parseImport(serializeExport(delta)).ok).toBe(true) // still a complete export v3
    expect(buildExportV3({ events, working, device: 'd', exportedAt: T3, sinceAt: '2030-01-01T00:00:00.000Z' }).events).toEqual([])
  })

  test('the engine: a delta holds what changed since, merges into another device, and is not a backup', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const { getState } = tab.progress
    getState().completeLesson('t0.l1', 'read')
    p.clock.advance(60)
    const since = p.clock.nowIso()
    getState().recordProve({ labId: 'lab-a', score: 1, ok: true, data: { v: 1, qids: ['q'], self: [1] } })
    getState().setWorking('today:prefs', { phoneMode: true })
    await tab.progress.controls.flush()
    const engine = await tab.engine()

    const delta = await engine.exportV3({ sinceAt: since })
    expect(delta.events.map((e) => e.kind)).toEqual(['prove'])
    expect(delta.working.map((w) => w.key)).toEqual(['today:prefs'])
    expect(engine.status().lastExportAt).toBeUndefined() // a handoff does not quiet the backup nudge
    const full = await engine.exportV3()
    expect(full.events).toHaveLength(2)
    expect(engine.status().lastExportAt).toBeDefined()

    const other = startTab(makeProfile({ devicePrefix: 'other-' }))
    const target = await other.progress.controls.engine()
    const result = await target.importFile(JSON.stringify(delta), 'merge')
    expect(result).toMatchObject({ ok: true, added: 1 })
    expect(other.progress.getState().aggregate.proves['lab-a']).toBeDefined()
    expect(other.progress.getState().working['today:prefs']).toEqual({ phoneMode: true })
    expect(await engine.exportV3({ includeComponentBytes: true, sinceAt: since })).toMatchObject({ components: [] })
  })
})

/* ------------------------------------------------------------------ */
/* Derived invariants                                                   */
/* ------------------------------------------------------------------ */

describe('invariants', () => {
  test('graded kinds still carry the streak day; non-graded Wave 1 events do not mark it', () => {
    const agg = derive([
      evt('complete', 'placement', T1),
      evt('ack', 'hint:lab-a/c1#bottom', T1),
      evt('prove', 'prove:lab-a', T2, { data: { qids: ['q'], self: [1] } }),
    ])
    expect(Object.keys(agg.days)).toEqual(['2026-09-02'])
  })

  test('day stays frozen: the generated events carry dayOf(at, tz)', () => {
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, 40)
      for (const e of d.events.values()) expect(e.day).toBe(dayOf(e.at, e.tz))
    }, 10)
  })

  test('every kind has a ref rule (no Wave 1 kind was left without a grammar)', () => {
    const all: EventKind[] = ['item', 'probe', 'predict', 'quiz', 'sim-task', 'lab-check', 'fleet-act', 'capstone-step', 'play', 'incident', 'fleet-run', 'prove', 'visit', 'complete', 'exercise', 'achievement', 'ack']
    for (const k of all) expect(typeof refMatchesKind(k, 'x')).toBe('boolean')
  })

  test('SnapshotV2 carries aggregateVersion as a plain number', () => {
    const snap: SnapshotV2 = { schemaVersion: 4, aggregateVersion: 2, writtenAt: T1, tab: 't', aggregate: emptyAggregate(), working: [] }
    expect(workingMap([])).toEqual({})
    expect(snap.aggregateVersion).toBe(AGGREGATE_VERSION)
  })
})
