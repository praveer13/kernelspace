import { describe, expect, test } from 'bun:test'
import {
  DATA_KEYS,
  DONATION_DAY_ZERO,
  DONATION_FORMAT,
  EVENT_KEYS,
  isDonationText,
  ledgerOfDonation,
  parseDonation,
  redactForPartner,
  summarizeDonation,
} from '../../src/lib/learner/redact'
import type { LedgerEvent, WorkingRecord } from '../../src/lib/ledger/types'
import { Journal, shuffled, simulate } from './ledger-gen'

/** The §20.2 whitelist, written out again here so a change to the constants has to change a test too. */
const SPEC_EVENT_KEYS = ['kind', 'ref', 'score', 'ok', 'conf', 'provenance', 'ms', 'dayOffset']
const SPEC_DATA_KEYS = ['src', 'kcs', 'form', 'grp', 'slot', 'of', 'level', 'variant', 'phase', 'reason', 'fault', 'severity', 'diagnosed', 'fixed', 'burn', 'expertBurn', 'streetlight', 'probes', 'arm', 'via']

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
    for (const key of ['seed', 'wasmSha256', 'dev', 'rev', 'tz', 'day', 'at', 'id', 'exportedAt', 'device', 'components', 'explain', 'text', 'sinceDays', 'lessonId', 'pick', 'truth', 'date', 'firstHypothesis', 'fix', 'nsec']) {
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
      data: { src: 'today', grp: 1, slot: 0, of: 3, level: 2, variant: 'first-fit', reason: 'due', kcs: ['t1.external-frag'] },
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
