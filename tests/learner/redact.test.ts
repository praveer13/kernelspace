import { describe, expect, test } from 'bun:test'
import { KCS } from '../../src/data/kc'
import {
  DATA_KEYS,
  DONATION_DAY_ZERO,
  DONATION_FORMAT,
  DONATION_TRACKS,
  EVENT_KEYS,
  FIELD_DATA_KEYS,
  FIELD_EVENT_KEYS,
  isDonationText,
  ledgerOfDonation,
  parseDonation,
  redactForPartner,
  summarizeDonation,
} from '../../src/lib/learner/redact'
import type { LedgerEvent, WorkingRecord } from '../../src/lib/ledger/types'
import { Journal, shuffled, simulate } from './ledger-gen'

/** The §20.2 and §15.2 whitelist, written out again here so a change to the constants has to change a test too. */
const SPEC_EVENT_KEYS = ['kind', 'ref', 'score', 'ok', 'conf', 'provenance', 'ms', 'dayOffset']
const SPEC_DATA_KEYS = [
  'src', 'kcs', 'form', 'grp', 'slot', 'of', 'level', 'variant', 'phase', 'reason', 'fault', 'severity', 'diagnosed', 'fixed', 'burn', 'expertBurn', 'streetlight', 'probes', 'arm', 'via',
  // Wave 3 (wave-3.md §15.2)
  'sinceDays', 'formId', 'formSet', 'formSlot', 'track', 'levels', 'metric', 'qid', 'return', 'calls', 'receipts', 'rubric', 'miss', 'value', 'truth',
  // F2's secondary outputs (hint-secondary.ts): a lab run's passed check ids
  'passed',
]

const SECRET_EXPLAIN = 'because my cat walked on the keyboard'
const SECRET_BOOT = 'I want to leave my job at Acme'
const SECRET_CR = 'a free list threads the holes'
const SECRET_DOC = 'pasted config: model_type llama'
const DEVICE = 'dev-secret-7f3a'
const WASM = 'a'.repeat(64)
const COMPONENT = 'b'.repeat(64)
const SEED = 3141592653

/** A ledger with something sensitive in every place a ledger can hold it. */
function sensitive(): { events: LedgerEvent[]; working: WorkingRecord[] } {
  const j = new Journal()
  j.add('visit', 'boot', '2026-09-01')
  j.add('item', 'boot:value', '2026-09-01', { score: 1, ok: true, rev: 'r', provenance: 'practice', data: { src: 'boot', explain: SECRET_BOOT, text: SECRET_BOOT } })
  j.add('complete', 'boot', '2026-09-01', { dev: DEVICE })
  j.add('item', 'gen:frag/first-fit', '2026-09-01', {
    rev: 'r1',
    seed: SEED,
    ms: 1499,
    conf: 'sure',
    provenance: 'unseen',
    wasmSha256: WASM,
    dev: DEVICE,
    data: { src: 'today', grp: 'f0a1-uuid-one', slot: 0, of: 3, level: 2, variant: 'first-fit', reason: 'due', kcs: ['t1.external-frag'], nsec: 40, lessonId: 't1.l4', sinceDays: 9, pick: [2], value: 7, unit: 'KiB', lo: 1, hi: 9, truth: 5, hit: true, miss: 'kv.priced-fp16' },
  })
  j.add('item', 'cr:t1.l3#0', '2026-09-01', { rev: 'r2', ms: 1500, data: { src: 'ticket', form: 'ticket', grp: 'f0a1-uuid-two', ideas: [0, 2], text: SECRET_CR, explain: SECRET_EXPLAIN, kcs: ['t1.l3'] } })
  j.add('quiz', 'lesson:t1.l3', '2026-09-01', { ms: 61_000, data: { grp: 'f0a1-uuid-two', n: 3, form: 'ticket', nonMcqOk: true, kcs: ['t1.l3'] } })
  j.add('sim-task', 'sim:alloc/frag-pct', '2026-09-04', { data: { v: 2, outcome: true, predict: { value: 5 }, actual: 7, explain: SECRET_EXPLAIN } })
  j.add('lab-check', 'lab:rust-allocator', '2026-09-04', {
    wasmSha256: WASM,
    seed: SEED,
    data: { passed: ['boot'], total: 6, abi: 2, seeds: 'fresh', stage: 4, checks: [{ id: 'boot', status: 'pass', seed: SEED, fresh: true }] },
  })
  j.add('incident', 'inc:daily/2026-10-02', '2026-10-02', {
    score: 0.7,
    ok: true,
    provenance: 'practice',
    data: { v: 1, src: 'daily', fault: 'pool-shrink', severity: 2, firstHypothesis: 'drain-stall', hypothesis: 'pool-shrink', probes: ['p1', 'p2', 'p3'], fix: 'grow-pool', diagnosed: true, fixed: true, burn: 11, expertBurn: 6, streetlight: 1, components: [COMPONENT], date: '2026-10-02' },
  })
  j.add('incident', 'inc:team/blue/2026-10-03', '2026-10-03', {
    score: 0,
    ok: false,
    provenance: 'practice',
    data: { v: 1, src: 'team', fault: 'node-death', severity: 1, probes: [], diagnosed: false, fixed: false, burn: 4, expertBurn: 2, streetlight: 0, components: [], date: '2026-10-03' },
  })
  j.add('fleet-run', 'fleet:engine', '2026-10-03', { score: 1, ok: true, provenance: 'unseen', data: { v: 1, mode: 'engine', components: [{ slot: 'scheduler', labId: 'sched', sha256: COMPONENT }], seeds: 'fresh', goodput: 9, refGoodput: 9 } })
  j.add('ack', 'packet:lab/kv-block-manager/cow', '2026-10-03', { data: { via: 'copy', chars: 4321, arm: 'packet' } })
  j.add('complete', 'placement', '2026-10-03')
  j.add('complete', 'lesson:t1.l3', '2026-10-03', { data: { via: 'ticket', grp: 'f0a1-uuid-two' } })
  const working: WorkingRecord[] = [
    { key: 'boot:value', value: { variant: 'job', text: SECRET_BOOT }, at: '2026-09-01T10:00:00.000Z', dev: DEVICE },
    { key: 'boot:week', value: { minutesPerWeek: 180, sessionMinutes: 25, phoneDays: [2], laptopDays: [1], slo: 0.85 }, at: '2026-09-01T10:00:00.000Z', dev: DEVICE },
    { key: 'fw:doc', value: SECRET_DOC, at: '2026-09-01T10:00:00.000Z', dev: DEVICE },
    { key: 'placement:result', value: { v: 1, at: '2026-10-03T08:00:00.000Z', solidKcs: ['t1.external-frag', 't1.l3'], missedKcs: ['t2.x'], misconceptions: [], items: 12 }, at: '2026-10-03T08:00:00.000Z', dev: DEVICE },
    { key: 'engine:slots', value: { scheduler: { sha256: COMPONENT, labId: 'sched', version: 1, at: '2026-10-03T08:00:00.000Z' } }, at: '2026-10-03T08:00:00.000Z', dev: DEVICE },
    { key: 'exp:seed', value: SEED, at: '2026-10-03T08:00:00.000Z', dev: DEVICE },
  ]
  return { events: j.events, working }
}

const ISO_DATE = /\d{4}-\d{2}-\d{2}/
const CLOCK_TIME = /\d{2}:\d{2}:\d{2}/
const HEX64 = /[0-9a-f]{64}/i

describe('redactForPartner: the whitelist', () => {
  test('the constants are the §20.2 lists', () => {
    expect([...EVENT_KEYS]).toEqual(SPEC_EVENT_KEYS)
    expect([...DATA_KEYS]).toEqual(SPEC_DATA_KEYS)
  })

  test('no free text, hash, seed, device id or calendar date survives', () => {
    const out = JSON.stringify(redactForPartner(sensitive()))
    for (const secret of [SECRET_EXPLAIN, SECRET_BOOT, SECRET_CR, SECRET_DOC, DEVICE, WASM, COMPONENT, String(SEED), 'f0a1-uuid', 'blue', 'kv.priced-fp16', 'grow-pool', 'Acme']) {
      expect(out).not.toContain(secret)
    }
    expect(out).not.toMatch(ISO_DATE)
    expect(out).not.toMatch(CLOCK_TIME)
    expect(out).not.toMatch(HEX64)
    for (const key of ['seed', 'wasmSha256', 'dev', 'rev', 'tz', 'day', 'at', 'id', 'exportedAt', 'device', 'components', 'explain', 'text', 'lessonId', 'pick', 'date', 'firstHypothesis', 'fix', 'nsec']) {
      expect(out).not.toContain(`"${key}":`)
    }
  })

  test('every key of every event and of its data is on the whitelist, and nothing else', () => {
    const d = redactForPartner(sensitive())
    for (const e of d.events) {
      for (const k of Object.keys(e)) expect([...SPEC_EVENT_KEYS, 'data']).toContain(k)
      for (const k of Object.keys(e.data ?? {})) expect(SPEC_DATA_KEYS).toContain(k)
    }
    expect(Object.keys(d).sort()).toEqual(['events', 'format', 'plan', 'version'])
  })

  test('the donation is not a re-labelled export: no schemaVersion, device, working records or extras', () => {
    const d = redactForPartner(sensitive()) as unknown as Record<string, unknown>
    for (const k of ['schemaVersion', 'exportedAt', 'device', 'working', 'components', 'extras']) expect(k in d).toBe(false)
    expect(d.format).toBe(DONATION_FORMAT)
  })

  test('keeps what the selectors need, field by field', () => {
    const d = redactForPartner(sensitive())
    const gen = d.events.find((e) => e.ref === 'gen:frag/first-fit')
    expect(gen).toEqual({
      kind: 'item',
      ref: 'gen:frag/first-fit',
      dayOffset: 0,
      score: 1,
      ok: true,
      conf: 'sure',
      provenance: 'unseen',
      ms: 1000,
      data: { src: 'today', grp: 1, slot: 0, of: 3, level: 2, variant: 'first-fit', reason: 'due', kcs: ['t1.external-frag'], sinceDays: 9, value: 7, truth: 5 },
    })
    const incident = d.events.find((e) => e.ref.startsWith('inc:daily/'))
    expect(incident?.data).toEqual({ src: 'daily', fault: 'pool-shrink', severity: 2, probes: 3, diagnosed: true, fixed: true, burn: 11, expertBurn: 6, streetlight: 1 })
    const ack = d.events.find((e) => e.kind === 'ack')
    expect(ack?.data).toEqual({ via: 'copy', arm: 'packet' })
  })

  test('a whitelisted field holding text, a date or a hash is dropped, not copied', () => {
    const j = new Journal()
    j.add('item', 'gen:frag/v', '2026-09-01', {
      score: 1,
      ok: true,
      rev: 'r',
      provenance: 'practice',
      data: { src: 'today', variant: 'my secret thoughts', phase: '2026-09-01', reason: WASM, form: 'x'.repeat(200), arm: SECRET_EXPLAIN, kcs: ['t1.ok', SECRET_EXPLAIN, WASM, '2026-09-01'], slot: -1, of: Number.NaN, level: 'two', diagnosed: 'yes' },
    })
    const e = redactForPartner({ events: j.events, working: [] }).events[0]
    expect(e.data).toEqual({ src: 'today', kcs: ['t1.ok'] })
  })

  test('ms rounds to whole seconds and is left out when absent or invalid', () => {
    const j = new Journal()
    for (const [i, ms] of [1499, 1500, 0, 59_999].entries()) j.add('item', `gen:frag/v${i}`, '2026-09-01', { score: 1, ok: true, rev: 'r', provenance: 'practice', ms, data: { src: 'today' } })
    j.add('item', 'gen:frag/none', '2026-09-01', { score: 1, ok: true, rev: 'r', provenance: 'practice', data: { src: 'today' } })
    const ms = redactForPartner({ events: j.events, working: [] }).events.map((e) => e.ms)
    expect(ms).toEqual([1000, 2000, 0, 60_000, undefined])
  })

  test('a donation is deterministic and leaves its input untouched', () => {
    const input = sensitive()
    const before = JSON.stringify(input)
    const a = JSON.stringify(redactForPartner(input))
    expect(JSON.stringify(input)).toBe(before)
    expect(JSON.stringify(redactForPartner(input))).toBe(a)
    expect(JSON.stringify(redactForPartner({ events: shuffled(input.events, 5), working: input.working }))).toBe(a)
  })

  test('an empty export gives an empty donation', () => {
    expect(redactForPartner({ events: [], working: [] })).toEqual({ format: DONATION_FORMAT, version: 1, events: [] })
  })
})

describe('redactForPartner: day offsets', () => {
  test('whole local days since the first event, whatever the order of the input', () => {
    const j = new Journal()
    j.add('visit', 'lesson:t1.l1', '2026-09-04')
    j.add('visit', 'lesson:t1.l2', '2026-09-01')
    j.add('visit', 'lesson:t1.l3', '2026-09-01')
    j.add('visit', 'lesson:t1.l4', '2026-10-02')
    const d = redactForPartner({ events: shuffled(j.events, 3), working: [] })
    expect(d.events.map((e) => [e.ref, e.dayOffset])).toEqual([
      ['lesson:t1.l2', 0],
      ['lesson:t1.l3', 0],
      ['lesson:t1.l1', 3],
      ['lesson:t1.l4', 31],
    ])
  })

  test('the offset follows the local day frozen in the event, not the UTC date of `at`', () => {
    const j = new Journal()
    const a = j.add('visit', 'lesson:t1.l1', '2026-09-01')
    const b = j.add('visit', 'lesson:t1.l2', '2026-09-02')
    // 23:50 UTC on the 1st is already the 2nd at UTC+2
    const late = { ...a, at: '2026-09-01T23:50:00.000Z', tz: 120, day: '2026-09-02' } as typeof a
    const d = redactForPartner({ events: [late, b], working: [] })
    expect(d.events.map((e) => e.dayOffset)).toEqual([0, 0])
  })

  test('refs that name a date become offsets, and a team code goes', () => {
    const d = redactForPartner(sensitive())
    expect(d.events.map((e) => e.ref).filter((r) => r.startsWith('inc:'))).toEqual(['inc:daily/d31', 'inc:team/-/d32'])
  })

  test('grp is re-numbered in order of first appearance and shared across the events of one attempt', () => {
    const d = redactForPartner(sensitive())
    const grp = (ref: string, kind?: string) => d.events.find((e) => e.ref === ref && (kind === undefined || e.kind === kind))?.data?.grp
    expect(grp('gen:frag/first-fit')).toBe(1)
    expect(grp('cr:t1.l3#0')).toBe(2)
    expect(grp('lesson:t1.l3', 'quiz')).toBe(2)
    expect(grp('lesson:t1.l3', 'complete')).toBe(2)
  })
})

describe('redactForPartner: working records', () => {
  test('the week plan keeps its SLO and nothing else; no working record leaks', () => {
    const d = redactForPartner(sensitive())
    expect(d.plan).toEqual({ slo: 0.85 })
    const text = JSON.stringify(d)
    for (const leak of ['minutesPerWeek', 'sessionMinutes', 'phoneDays', 'laptopDays', 'missedKcs', 'misconceptions', 'scheduler', 'labId', 'sched']) expect(text).not.toContain(leak)
  })

  test('no plan, or a plan without a known SLO, gives no plan', () => {
    const base = { events: new Journal().events, working: [] as WorkingRecord[] }
    expect(redactForPartner(base).plan).toBeUndefined()
    const odd: WorkingRecord = { key: 'boot:week', value: { slo: 0.5 }, at: '2026-09-01T10:00:00.000Z', dev: 'd' }
    expect(redactForPartner({ ...base, working: [odd] }).plan).toBeUndefined()
  })

  test('the last placement carries the solid KCs, as the whitelisted `kcs`', () => {
    const j = new Journal()
    j.add('complete', 'placement', '2026-09-01')
    j.add('complete', 'placement', '2026-09-02')
    const solid: WorkingRecord = { key: 'placement:result', value: { v: 1, solidKcs: ['t1.a', 'has space', WASM] }, at: '2026-09-02T10:00:00.000Z', dev: 'd' }
    const d = redactForPartner({ events: j.events, working: [solid] })
    expect(d.events.map((e) => e.data)).toEqual([undefined, { kcs: ['t1.a'] }])
  })
})

describe('redactForPartner: generated ledgers', () => {
  test('a simulated learner with secrets added leaks no date, clock time, hash or device id', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { events } = simulate(seed, { days: 90 })
      const dressed = events.map((e, i) =>
        i % 7 === 0 ? ({ ...e, dev: DEVICE, wasmSha256: WASM, seed: SEED + i, data: { ...(e as { data?: object }).data, explain: SECRET_EXPLAIN, date: '2026-09-09', components: [COMPONENT] } } as typeof e) : e,
      )
      const text = JSON.stringify(redactForPartner({ events: dressed, working: [] }))
      expect(text).not.toMatch(ISO_DATE)
      expect(text).not.toMatch(CLOCK_TIME)
      expect(text).not.toMatch(HEX64)
      for (const secret of [DEVICE, SECRET_EXPLAIN, 'dev-1']) expect(text).not.toContain(secret)
    }
  })

  test('a donation holds every event, in ledger order', () => {
    const { events } = simulate(7, { days: 60 })
    const d = redactForPartner({ events: shuffled(events, 2), working: [] })
    expect(d.events.map((e) => e.ref)).toEqual(events.map((e) => e.ref))
    expect(d.events.every((e, i) => i === 0 || e.dayOffset >= d.events[i - 1].dayOffset)).toBe(true)
  })
})

describe('summarizeDonation', () => {
  test('counts events, spans and kinds', () => {
    const s = summarizeDonation(redactForPartner(sensitive()))
    expect(s.events).toBe(14)
    expect(s.days).toBe(32)
    expect(s.kinds.slice(0, 2)).toEqual([
      { kind: 'complete', count: 3 },
      { kind: 'item', count: 3 },
    ])
    expect(s.kinds.reduce((n, k) => n + k.count, 0)).toBe(14)
    expect(summarizeDonation(redactForPartner({ events: [], working: [] }))).toEqual({ events: 0, days: 0, kinds: [] })
  })
})

describe('reading a donation back', () => {
  test('parseDonation accepts what redactForPartner wrote, as text', () => {
    const d = redactForPartner(sensitive())
    const text = JSON.stringify(d)
    expect(isDonationText(text)).toBe(true)
    const parsed = parseDonation(text)
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.donation).toEqual(d)
  })

  test('isDonationText is false for a full export, a non-file and broken JSON', () => {
    expect(isDonationText('{"format":"kernelspace-progress","version":3}')).toBe(false)
    expect(isDonationText('[]')).toBe(false)
    expect(isDonationText('{nope')).toBe(false)
  })

  test('parseDonation refuses what is not a donation and what is damaged', () => {
    expect(parseDonation('{nope')).toEqual({ ok: false, error: "this file isn't valid JSON" })
    expect(parseDonation('{"format":"x"}').ok).toBe(false)
    expect(parseDonation(`{"format":"${DONATION_FORMAT}","version":2,"events":[]}`)).toMatchObject({ ok: false })
    expect(parseDonation(`{"format":"${DONATION_FORMAT}","version":1}`)).toMatchObject({ ok: false })
    expect(parseDonation(`{"format":"${DONATION_FORMAT}","version":1,"events":[{"kind":"item","ref":"x"}]}`)).toMatchObject({ ok: false })
    expect(parseDonation(`{"format":"${DONATION_FORMAT}","version":1,"events":[{"kind":"item","ref":"x","dayOffset":1.5}]}`)).toMatchObject({ ok: false })
  })

  test('a hand-edited donation cannot smuggle a field past the reader', () => {
    const text = JSON.stringify({
      format: DONATION_FORMAT,
      version: 1,
      exportedAt: '2026-10-07T12:00:00.000Z',
      events: [{ kind: 'item', ref: 'gen:frag/v', dayOffset: 0, seed: 7, dev: DEVICE, data: { src: 'today', explain: SECRET_EXPLAIN, kcs: ['t1.a'] } }],
    })
    const parsed = parseDonation(text)
    expect(parsed.ok).toBe(true)
    const out = JSON.stringify(parsed.ok && parsed.donation)
    for (const secret of ['exportedAt', 'seed', DEVICE, SECRET_EXPLAIN]) expect(out).not.toContain(secret)
    expect(parsed.ok && parsed.donation.events[0].data).toEqual({ src: 'today', kcs: ['t1.a'] })
  })

  test('ledgerOfDonation gives synthetic ids, days and instants in file order', () => {
    const { events } = ledgerOfDonation(redactForPartner(sensitive()))
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length)
    expect(events.map((e) => e.ref)).toEqual(redactForPartner(sensitive()).events.map((e) => e.ref))
    expect(events[0].day).toBe(DONATION_DAY_ZERO)
    for (let i = 1; i < events.length; i++) {
      expect(events[i].at >= events[i - 1].at).toBe(true)
      expect(events[i].id > events[i - 1].id).toBe(true)
    }
    expect(events.every((e) => e.dev === 'donor' && e.tz === 0)).toBe(true)
    expect(events.map((e) => e.day)).not.toContain('2026-09-01')
  })

  test('within a day an event starts after the answer times before it, and never spills into the next day', () => {
    const j = new Journal()
    j.add('item', 'gen:frag/a', '2026-09-01', { score: 1, ok: true, rev: 'r', provenance: 'practice', ms: 30_000, data: { src: 'today', grp: 'x' } })
    j.add('item', 'gen:frag/b', '2026-09-01', { score: 1, ok: true, rev: 'r', provenance: 'practice', ms: 20_000, data: { src: 'today', grp: 'x' } })
    j.add('item', 'gen:frag/c', '2026-09-01', { score: 1, ok: true, rev: 'r', provenance: 'practice', ms: 10_000_000_000, data: { src: 'today', grp: 'x' } })
    j.add('item', 'gen:frag/d', '2026-09-01', { score: 1, ok: true, rev: 'r', provenance: 'practice', data: { src: 'today', grp: 'x' } })
    j.add('visit', 'lesson:t1.l1', '2026-09-02')
    const { events } = ledgerOfDonation(redactForPartner({ events: j.events, working: [] }))
    const t = events.map((e) => Date.parse(e.at))
    expect([t[1] - t[0], t[2] - t[1]]).toEqual([30_000, 20_000])
    expect(events[3].day).toBe(DONATION_DAY_ZERO)
    expect(events[4].day).toBe('2000-01-02')
    expect(t[4]).toBeGreaterThan(t[3])
    expect(events[3].at.slice(0, 10)).toBe(DONATION_DAY_ZERO)
    expect((events[0] as { data?: { grp?: string } }).data?.grp).toBe('g1')
  })

  test('the plan and the placement come back', () => {
    const l = ledgerOfDonation(redactForPartner(sensitive()))
    expect(l.plan).toEqual({ slo: 0.85 })
    expect(l.placement).toEqual({ solidKcs: ['t1.external-frag', 't1.l3'] })
    const none = ledgerOfDonation(redactForPartner({ events: [], working: [] }))
    expect(none).toEqual({ events: [], plan: null, placement: null })
  })
})

/* ------------------------------------------------------------------ */
/* Wave 3 (wave-3.md §15.2, task 3c-03)                                */
/* ------------------------------------------------------------------ */

/** One event of every Wave 3 shape the donation keeps from, each carrying a secret beside the fields it keeps. */
function wave3(): { events: LedgerEvent[]; working: WorkingRecord[] } {
  const j = new Journal()
  j.add('visit', 'boot', '2026-09-01')
  j.add('item', 'gen:kv/capacity', '2026-09-02', {
    score: 1, ok: true, rev: 'r', seed: SEED, provenance: 'unseen', ms: 4000,
    data: { src: 'form', formId: 'B', formSet: 1, formSlot: 7, track: 't5', kcs: ['t5.kv-capacity'], value: 42.5, truth: 40, unit: 'GiB', lo: 30, hi: 50 },
  })
  j.add('probe', 'gen:kv/capacity', '2026-10-05', {
    score: 0, ok: false, rev: 'r', seed: SEED + 1, provenance: 'unseen',
    data: { src: 'today', reason: 'probe', sinceDays: 33.4, kcs: ['t5.kv-capacity'], value: 3, truth: 4, miss: 'confuse.t5.block-tables' },
  })
  j.add('play', 'play:tiling-cube', '2026-09-20', {
    score: 0.5, ok: true, provenance: 'practice',
    data: { phase: 'play', levels: [{ id: 'l1', ok: true, logErr: 0.31, view: '2d' }, { id: 'l2', ok: false, logErr: 1.2 }, { id: WASM, ok: true }, 'junk'], metric: { name: 'imbalance', mine: 1.25, ghost: 1.1, lowerIsBetter: true } },
  })
  j.add('prove', 'prove:kv-block-manager', '2026-09-21', {
    score: 1, ok: true, provenance: 'proved', wasmSha256: WASM,
    data: { v: 2, qid: 'free-after', kcs: ['t5.kv-capacity'], answer: [3, 1, 2], actual: [3, 1, 2], calls: 4, return: true },
  })
  j.add('fleet-act', 'fw:business', '2026-09-22', {
    score: 1, ok: true, provenance: 'unseen',
    data: { receipts: { cited: 5, verified: 4, uncited: 2 }, rubric: { capacity: 3, slo: 2, cost: 1, failure: 0 }, runs: ['abcd1234', 'ffff0000'], explain: SECRET_EXPLAIN },
  })
  const working: WorkingRecord[] = [
    { key: 'profile:background', value: 'jvm', at: '2026-09-01T10:00:00.000Z', dev: DEVICE },
    { key: 'fw:runs', value: [{ id: 'abcd1234', act: 'business', job: { slot: 'x', sha256: COMPONENT }, entropy: 7, values: { goodput: 3 }, at: '2026-09-22T10:00:00.000Z' }], at: '2026-09-22T10:00:00.000Z', dev: DEVICE },
  ]
  return { events: j.events, working }
}

describe('redactForPartner: the Wave 3 fields (§15.2)', () => {
  const byRef = (d: ReturnType<typeof redactForPartner>, ref: string) => d.events.find((e) => e.ref === ref)

  test('a form item keeps its identity with its track, the numbers and the KC; the unit and interval go', () => {
    const e = d3().events.find((x) => x.data?.src === 'form')
    expect(e?.data).toEqual({ src: 'form', formId: 'B', formSet: 1, formSlot: 7, track: 't5', kcs: ['t5.kv-capacity'], value: 42.5, truth: 40 })
  })

  test('the track is kept only on a form item and only as one of the KC graph\'s tracks', () => {
    // the fixed list is the graph's tracks, so the donation need not load the graph to check one
    expect(new Set(DONATION_TRACKS)).toEqual(new Set(KCS.map((k) => k.track)))
    const j = new Journal()
    const form = (track: unknown) => j.add('item', 'gen:sig/name-fault', '2026-09-01', { score: 1, ok: true, rev: 'r', provenance: 'unseen', data: { src: 'form', formId: 'A', formSet: 0, formSlot: 2, track, kcs: ['t7.incident-diagnosis', 't5.prefill-decode-interference'] } })
    for (const t of DONATION_TRACKS) form(t)
    for (const t of ['t8', 'T5', ' t5', 't5.kv-capacity', SECRET_EXPLAIN, 5, ['t5'], null]) form(t)
    j.add('item', 'gen:kv/a', '2026-09-01', { score: 1, ok: true, rev: 'r', provenance: 'unseen', data: { src: 'today', track: 't5' } })
    const kept = redactForPartner({ events: j.events, working: [] }).events.map((e) => e.data?.track)
    expect(kept).toEqual([...DONATION_TRACKS, ...Array<undefined>(9).fill(undefined)])
    // a hand-edited donation is held to the same rule
    const edited = JSON.stringify({ format: DONATION_FORMAT, version: 1, events: [{ kind: 'item', ref: 'gen:kv/a', dayOffset: 0, data: { src: 'form', track: 't5' } }, { kind: 'item', ref: 'gen:kv/a', dayOffset: 0, data: { src: 'form', track: SECRET_EXPLAIN } }, { kind: 'item', ref: 'gen:kv/a', dayOffset: 0, data: { src: 'today', track: 't5' } }] })
    const parsed = parseDonation(edited)
    expect(parsed.ok && parsed.donation.events.map((e) => e.data)).toEqual([{ src: 'form', track: 't5' }, { src: 'form' }, { src: 'today' }])
  })

  test('a lab run keeps the check ids it passed, check-id-shaped and on a lab-check only; its seeds, hashes and per-check detail go', () => {
    const run = sensitive().events.find((e) => e.kind === 'lab-check')
    const kept = redactForPartner({ events: run ? [run] : [], working: [] }).events[0]
    expect(kept.data).toEqual({ passed: ['boot'] })
    expect(JSON.stringify(kept)).not.toContain('"checks"')
    const j = new Journal()
    const lab = (passed: unknown) => j.add('lab-check', 'lab:rust-allocator', '2026-09-01', { score: 0, ok: false, provenance: 'lab-green', data: { passed, total: 6 } })
    lab(['boot', 'no_overlap', 'boot'])
    lab([])
    lab(['Boot', 'no-overlap', '2026-09-01', 'a'.repeat(32), 'x'.repeat(49), SECRET_EXPLAIN, 7, null, 'align'])
    lab(Array.from({ length: 40 }, (_, i) => `c${i}`))
    lab('boot')
    j.add('item', 'gen:kv/a', '2026-09-01', { score: 1, ok: true, rev: 'r', provenance: 'unseen', data: { src: 'today', passed: ['boot'] } })
    const out = redactForPartner({ events: j.events, working: [] }).events.map((e) => e.data?.passed)
    expect(out).toEqual([['boot', 'no_overlap'], [], ['align'], Array.from({ length: 32 }, (_, i) => `c${i}`), undefined, undefined])
    // a hand-edited donation is held to the same rule
    const edited = JSON.stringify({ format: DONATION_FORMAT, version: 1, events: [{ kind: 'lab-check', ref: 'lab:rust-allocator', dayOffset: 0, data: { passed: ['boot', SECRET_EXPLAIN] } }, { kind: 'item', ref: 'gen:kv/a', dayOffset: 0, data: { passed: ['boot'] } }] })
    const parsed = parseDonation(edited)
    expect(parsed.ok && parsed.donation.events.map((e) => e.data)).toEqual([{ passed: ['boot'] }, undefined])
  })

  test('sinceDays is kept (rounded to whole days), so cold checks and ROOT read their gap on a donation', () => {
    const probe = d3().events.find((e) => e.kind === 'probe')
    expect(probe?.data?.sinceDays).toBe(33)
    expect(probe?.data?.reason).toBe('probe')
  })

  test('a play keeps each level id, ok and view, and the metric name, mine and ghost; logErr and lowerIsBetter go', () => {
    const e = byRef(d3(), 'play:tiling-cube')
    expect(e?.data).toEqual({
      phase: 'play',
      levels: [{ id: 'l1', ok: true, view: '2d' }, { id: 'l2', ok: false }],
      metric: { name: 'imbalance', mine: 1.25, ghost: 1.1 },
    })
  })

  test('a Prove-it v2 attempt keeps qid, return, calls and kcs, and never the answer or what the module replied', () => {
    const e = byRef(d3(), 'prove:kv-block-manager')
    expect(e?.provenance).toBe('proved')
    expect(e?.data).toEqual({ qid: 'free-after', kcs: ['t5.kv-capacity'], calls: 4, return: true })
    const text = JSON.stringify(e)
    for (const key of ['answer', 'actual', 'wasmSha256']) expect(text).not.toContain(`"${key}"`)
    expect(text).not.toContain(WASM)
  })

  test('a Fleet Week act keeps its receipt counts and rubric; the run ids and free text go', () => {
    const e = byRef(d3(), 'fw:business')
    expect(e?.data).toEqual({ receipts: { cited: 5, verified: 4, uncited: 2 }, rubric: { capacity: 3, slo: 2, cost: 1, failure: 0 } })
    expect(JSON.stringify(e)).not.toContain('abcd1234')
  })

  test('only a confuse.<kcId> miss survives, and every other miss id is still dropped', () => {
    expect(d3().events.find((e) => e.kind === 'probe')?.data?.miss).toBe('confuse.t5.block-tables')
    // the Wave 1 assertion: a misconception id is not donated (the id sits on the item of `sensitive()`)
    const text = JSON.stringify(redactForPartner(sensitive()))
    expect(text).not.toContain('kv.priced-fp16')
    expect(text).not.toContain('"miss"')
    const j = new Journal()
    const misses = ['kv.priced-fp16', 'confuse.', 'confuse.has space', 'confuse.t5', 'xconfuse.t5.block-tables', 'confuse.t5.block-tables.2026-09-01', `confuse.t5.${'a'.repeat(70)}`, 'confuse.t5.block-tables']
    for (const [i, miss] of misses.entries()) {
      j.add('item', `gen:kv/v${i}`, '2026-09-01', { score: 0, ok: false, rev: 'r', provenance: 'unseen', data: { src: 'today', miss } })
    }
    const kept = redactForPartner({ events: j.events, working: [] }).events.map((e) => e.data?.miss)
    expect(kept).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'confuse.t5.block-tables'])
  })

  test('a field item keeps neither value nor truth; the same numbers on a non-field event are kept', () => {
    const j = new Journal()
    const data = { src: 'practice', kcs: ['t4.roofline'], value: 812.5, truth: 790.1 }
    j.add('item', 'item:field.decode-kv.tps', '2026-09-01', { score: 0.989, ok: true, rev: 'r', provenance: 'field', data })
    j.add('predict', 'item:engine.measured-tps', '2026-09-02', { score: 0.989, ok: true, rev: 'r', provenance: 'field', data })
    j.add('item', 'item:t4.l2.q1', '2026-09-03', { score: 0.989, ok: true, rev: 'r', provenance: 'practice', data })
    j.add('item', 'item:t4.l2.q2', '2026-09-04', { score: 0.989, ok: true, rev: 'r', data })
    const d = redactForPartner({ events: j.events, working: [] })
    expect(d.events.map((e) => e.data)).toEqual([
      { src: 'practice' },
      { src: 'practice' },
      { src: 'practice', kcs: ['t4.roofline'], value: 812.5, truth: 790.1 },
      { src: 'practice', kcs: ['t4.roofline'], value: 812.5, truth: 790.1 },
    ])
    expect(JSON.stringify(d.events.slice(0, 2))).not.toMatch(/812|790|989/)
    expect(d.events.map((e) => e.score)).toEqual([undefined, undefined, 0.989, 0.989])
  })

  test('a field event keeps one bit: its kind, ref, day, provenance, ok and src, and no score, time, confidence or other data', () => {
    expect(FIELD_EVENT_KEYS).toEqual(['kind', 'ref', 'ok', 'provenance', 'dayOffset'])
    expect(FIELD_DATA_KEYS).toEqual(['src'])
    const j = new Journal()
    // every field the whitelist keeps on other events, put on a field one
    const data = {
      src: 'practice', kcs: ['t4.roofline'], grp: 'g-1', slot: 1, of: 3, level: 2, variant: 'v', sinceDays: 4, miss: 'confuse.t5.block-tables',
      metric: { name: 'tps', mine: 812.5, ghost: 790.1 }, levels: [{ id: 'l1', ok: true }], probes: [1, 2, 3], burn: 812.5, value: 812.5, truth: 790.1,
    }
    j.add('item', 'item:field.decode-kv.tps', '2026-09-01', { score: 0.989, ok: false, conf: 'sure', ms: 812_000, rev: 'r', provenance: 'field', data })
    const [e] = redactForPartner({ events: j.events, working: [] }).events
    expect(e).toEqual({ kind: 'item', ref: 'item:field.decode-kv.tps', dayOffset: 0, ok: false, provenance: 'field', data: { src: 'practice' } })
  })

  test('value and truth are numbers only: text, NaN and Infinity are dropped', () => {
    const j = new Journal()
    j.add('item', 'gen:kv/a', '2026-09-01', { score: 1, ok: true, rev: 'r', provenance: 'unseen', data: { src: 'today', value: '12 GiB', truth: Number.NaN } })
    j.add('item', 'gen:kv/b', '2026-09-01', { score: 1, ok: true, rev: 'r', provenance: 'unseen', data: { src: 'today', value: Number.POSITIVE_INFINITY, truth: [1] } })
    expect(redactForPartner({ events: j.events, working: [] }).events.map((e) => e.data)).toEqual([{ src: 'today' }, { src: 'today' }])
  })

  test('a Wave 3 field of the wrong shape is dropped, not copied', () => {
    const j = new Journal()
    j.add('item', 'gen:kv/a', '2026-09-01', {
      score: 1, ok: true, rev: 'r', provenance: 'unseen',
      data: {
        src: 'form', formId: 'D', formSet: 3, formSlot: 12, track: 't9', sinceDays: -2, qid: SECRET_EXPLAIN, return: false, calls: 13,
        receipts: { cited: 1.5, verified: 0, uncited: 0 }, rubric: { capacity: 4, slo: 0, cost: 0, failure: 0 }, metric: { name: 'imbalance', mine: -1, ghost: 1 }, levels: [{ id: '2026-09-01', ok: true }, { id: 'l1', ok: 'yes' }],
      },
    })
    expect(redactForPartner({ events: j.events, working: [] }).events[0].data).toEqual({ src: 'form' })
  })

  test('the background and the run records never reach a donation, and a learner who picked one donates the same file', () => {
    const w = wave3()
    const text = JSON.stringify(redactForPartner(w))
    for (const leak of ['jvm', 'profile:background', 'fw:runs', 'abcd1234', COMPONENT, DEVICE]) expect(text).not.toContain(leak)
    const other = { events: w.events, working: w.working.map((r) => (r.key === 'profile:background' ? { ...r, value: 'sre' } : r)) }
    const bare = { events: w.events, working: [] as WorkingRecord[] }
    expect(JSON.stringify(redactForPartner(other))).toBe(JSON.stringify(redactForPartner(w)))
    expect(JSON.stringify(redactForPartner(bare))).toBe(JSON.stringify(redactForPartner(w)))
  })

  test('the Wave 3 events still leak no date, clock time, hash, seed or device id', () => {
    const text = JSON.stringify(d3())
    expect(text).not.toMatch(ISO_DATE)
    expect(text).not.toMatch(CLOCK_TIME)
    expect(text).not.toMatch(HEX64)
    for (const secret of [String(SEED), String(SEED + 1), SECRET_EXPLAIN, 'GiB', 'logErr']) expect(text).not.toContain(secret)
  })

  test('parseDonation reads the Wave 3 fields back, and holds a hand-edited file to the same shapes', () => {
    const d = d3()
    const parsed = parseDonation(JSON.stringify(d))
    expect(parsed.ok && parsed.donation).toEqual(d)
    const edited = JSON.stringify({
      format: DONATION_FORMAT,
      version: 1,
      events: [
        { kind: 'item', ref: 'gen:kv/a', dayOffset: 0, provenance: 'field', data: { src: 'practice', value: 5, truth: 6, miss: 'confuse.t5.block-tables' } },
        { kind: 'item', ref: 'gen:kv/b', dayOffset: 0, provenance: 'unseen', data: { src: 'today', value: 5, truth: 6, miss: 'kv.priced-fp16', qid: SECRET_EXPLAIN, receipts: { cited: -1, verified: 0, uncited: 0 } } },
      ],
    })
    const out = parseDonation(edited)
    expect(out.ok && out.donation.events.map((e) => e.data)).toEqual([
      { src: 'practice' },
      { src: 'today', value: 5, truth: 6 },
    ])
    const scored = JSON.stringify({
      format: DONATION_FORMAT,
      version: 1,
      events: [{ kind: 'item', ref: 'item:field.decode-kv.tps', dayOffset: 0, score: 0.989, ok: true, ms: 9000, conf: 'sure', provenance: 'field', data: { src: 'practice', kcs: ['t4.roofline'] } }],
    })
    const back = parseDonation(scored)
    expect(back.ok && back.donation.events).toEqual([{ kind: 'item', ref: 'item:field.decode-kv.tps', dayOffset: 0, ok: true, provenance: 'field', data: { src: 'practice' } }])
  })

  test('the Wave 3 fields come back on the synthetic ledger the selectors read', () => {
    const { events } = ledgerOfDonation(d3())
    const data = (ref: string) => (events.find((e) => e.ref === ref) as unknown as { data: Record<string, unknown> }).data
    expect(data('fw:business').receipts).toEqual({ cited: 5, verified: 4, uncited: 2 })
    expect(data('prove:kv-block-manager').qid).toBe('free-after')
    expect(data('play:tiling-cube').levels).toHaveLength(2)
  })
})

/** The Wave 3 fixture, donated. */
function d3() {
  return redactForPartner(wave3())
}
