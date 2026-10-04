import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import {
  applyImport,
  buildExportV3,
  exportFileName,
  IMPORT_ERROR_MESSAGES,
  mergeComponents,
  mergeExtras,
  OLDER_EXPORT_MESSAGE,
  parseImport,
  previewImport,
  serializeExport,
  validateEvent,
  validateWorkingRecord,
} from '../../src/lib/ledger/codec'
import { IMPORT_MAX_BYTES, SCHEMA_VERSION } from '../../src/lib/ledger/constants'
import { derive } from '../../src/lib/ledger/fold'
import { mergeLedgers, type Ledger } from '../../src/lib/ledger/merge'
import type { LedgerEvent } from '../../src/lib/ledger/types'
import { evt, forSeeds, ledgerKey, runOps, PROPERTY_TIMEOUT_MS } from './gen'

setDefaultTimeout(PROPERTY_TIMEOUT_MS)

const T1 = '2026-09-01T09:00:00.000Z'
const T2 = '2026-09-02T09:00:00.000Z'

const exportOf = (l: Ledger, over: Partial<Parameters<typeof buildExportV3>[0]> = {}) =>
  buildExportV3({ ...l, device: 'dev-a', exportedAt: '2026-10-04T12:00:00.000Z', ...over })

const bad = (e: unknown) => {
  const r = validateEvent(e)
  return r.ok ? null : r.reason
}

describe('prototype-unsafe ids at the import boundary', () => {
  const good = () => evt('quiz', 'lesson:t0.l1', T1, { score: 0.5, ok: false })

  test('events whose ref has a __proto__ segment are refused', () => {
    for (const [kind, ref] of [
      ['visit', 'lesson:__proto__'],
      ['sim-task', 'sim:__proto__/a'],
      ['sim-task', 'sim:s/__proto__'],
      ['lab-check', 'lab:__proto__'],
      ['fleet-act', 'fw:__proto__'],
      ['achievement', 'ach:__proto__'],
    ] as const) {
      expect(validateEvent(evt(kind, ref, T1, kind === 'lab-check' ? { data: { passed: [] } } : {})).ok).toBe(false)
    }
    expect(validateEvent(good()).ok).toBe(true)
  })

  test('working keys with a __proto__ tail are refused', () => {
    for (const key of ['settings:__proto__', 'fw:evidence:__proto__', 'scroll:__proto__', 'sim-config:__proto__']) {
      expect(validateWorkingRecord({ key, value: {}, at: T1, dev: 'd' }).ok).toBe(false)
    }
    expect(validateWorkingRecord({ key: 'settings:theme', value: 'dark', at: T1, dev: 'd' }).ok).toBe(true)
  })

  test('an import carrying them is refused and leaves Object.prototype alone', () => {
    const file = exportOf({ events: [good()], working: [] })
    const text = serializeExport({
      ...file,
      events: [...file.events, evt('sim-task', 'sim:__proto__/a', T1), evt('complete', 'lesson:__proto__', T1)],
    })
    const parsed = parseImport(text)
    expect(parsed.ok).toBe(false)
    expect(parsed.ok || parsed.error).toBe('invalid')
    expect(({} as Record<string, unknown>).done).toBeUndefined()
    expect(() => derive([good()])).not.toThrow()
  })
})

describe('validateEvent (spec §4.9)', () => {
  const good = () => evt('quiz', 'lesson:t0.l1', T1, { score: 0.5, ok: false })

  test('accepts well-formed events and keeps unknown extra fields', () => {
    const e = { ...good(), futureField: { x: 1 } }
    const r = validateEvent(e)
    expect(r.ok).toBe(true)
    expect(r.ok && (r.value as unknown as { futureField: unknown }).futureField).toEqual({ x: 1 })
  })

  test('rejects broken envelopes', () => {
    expect(bad(null)).toBeTruthy()
    expect(bad({ ...good(), id: '' })).toContain('id')
    expect(bad({ ...good(), id: 'x'.repeat(201) })).toContain('id')
    expect(bad({ ...good(), v: 2 })).toContain('version')
    expect(bad({ ...good(), kind: 'nope' })).toContain('kind')
    expect(bad({ ...good(), ref: 'quiz:t0.l1#0' })).toContain('ref')
    expect(bad({ ...good(), at: '2026-09-01' })).toContain('at')
    expect(bad({ ...good(), at: null })).toContain('at')
    expect(bad({ ...good(), tz: 1.5 })).toContain('tz')
    expect(bad({ ...good(), day: '2026-09-02' })).toContain('day')
    expect(bad({ ...good(), dev: '' })).toContain('dev')
  })

  test('rejects broken graded fields', () => {
    expect(bad({ ...good(), score: 1.1 })).toContain('score')
    expect(bad({ ...good(), score: -0.1 })).toContain('score')
    expect(bad({ ...good(), score: Number.NaN })).toContain('score')
    expect(bad({ ...good(), ok: 'yes' })).toContain('ok')
    expect(bad({ ...good(), provenance: 'legacy' })).toContain('provenance')
    expect(bad({ ...good(), provenance: undefined })).toContain('provenance')
    expect(bad({ ...good(), conf: 'maybe' })).toContain('conf')
    expect(bad({ ...good(), seed: -1 })).toContain('seed')
    expect(bad({ ...good(), wasmSha256: 'ABC' })).toContain('wasmSha256')
  })

  test('kind-specific rules', () => {
    expect(bad(evt('item', 'quiz:t0.l1#0', T1, { data: { src: 'quiz' } }))).toContain('rev')
    expect(bad(evt('item', 'quiz:t0.l1#0', T1, { rev: 'r', data: { src: 'zzz' } }))).toContain('data.src')
    expect(bad(evt('lab-check', 'lab:lab-a', T1, { data: { passed: 'c1' } }))).toContain('passed')
    expect(bad(evt('lab-check', 'lab:lab-a', T1, { data: { passed: ['c1'], total: 4 } }))).toBeNull()
    expect(bad(evt('predict', 'boot:x', T1, { rev: 'r', data: { value: 1 } }))).toContain('data')
    expect(bad(evt('complete', 'lesson:t0.l1', T1))).toBeNull()
    // trace kinds carry no score, so none is demanded
    expect(bad(evt('visit', 'sim:sim-kv', T1))).toBeNull()
  })

  test('legacy-only kinds are gone', () => {
    expect(bad({ ...evt('visit', 'lesson:t0.l1', T1), kind: 'day', ref: 'day:2026-09-01' })).toContain('kind')
    expect(bad({ ...evt('visit', 'lesson:t0.l1', T1), kind: 'scalar', ref: 'scalar:xp' })).toContain('kind')
  })
})

describe('validateWorkingRecord', () => {
  const rec = { key: 'fw:doc', value: 'x', at: T1, dev: 'a' }
  test('accepts the §5 keys and rejects others', () => {
    expect(validateWorkingRecord(rec).ok).toBe(true)
    for (const key of ['scroll:t0.l1', 'sim-config:sim-kv', 'fw:evidence:engine', 'settings:codeLang', 'boot:path', 'boot:install-dismissed']) {
      expect(validateWorkingRecord({ ...rec, key }).ok).toBe(true)
    }
    for (const key of ['scroll:', 'nope', 'boot:other', '']) expect(validateWorkingRecord({ ...rec, key }).ok).toBe(false)
    expect(validateWorkingRecord({ ...rec, value: undefined }).ok).toBe(false)
    expect(validateWorkingRecord({ ...rec, at: 'yesterday' }).ok).toBe(false)
  })
})

describe('export v3 and detection (spec §10.1-10.2, Addendum A1)', () => {
  const ledger: Ledger = {
    events: [evt('complete', 'lesson:t0.l1', T2), evt('visit', 'lesson:t0.l1', T1)],
    working: [{ key: 'fw:doc', value: 'notes', at: T1, dev: 'a' }],
  }

  test('build sorts events by (at, id) and working by key, and serialises deterministically', () => {
    const file = exportOf({ events: [...ledger.events].reverse(), working: ledger.working })
    expect(file.format).toBe('kernelspace-progress')
    expect(file.version).toBe(3)
    expect(file.schemaVersion).toBe(SCHEMA_VERSION)
    expect(file.events.map((e) => e.at)).toEqual([T1, T2])
    expect(serializeExport(file)).toBe(serializeExport(exportOf(ledger)))
    expect(exportFileName('2026-10-04T12:00:00.000Z')).toBe('kernelspace-progress-2026-10-04.json')
  })

  test('round trip through text', () => {
    const parsed = parseImport(serializeExport(exportOf(ledger)))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.format).toEqual({ kind: 'export-v3', schemaVersion: SCHEMA_VERSION })
    expect(ledgerKey({ events: parsed.file.events, working: parsed.file.working })).toBe(ledgerKey(ledger))
  })

  test('an older export is refused with the A1 message', () => {
    const v2 = JSON.stringify({ version: 2, lessons: {}, xp: 0, sims: {} })
    const v1 = JSON.stringify({ version: 1, lessons: {}, xp: 0 })
    const envelope = JSON.stringify({ state: { lessons: {} }, version: 3 })
    for (const text of [v1, v2, envelope]) {
      const r = parseImport(text)
      expect(r).toEqual({ ok: false, error: 'older-export', detail: OLDER_EXPORT_MESSAGE })
    }
    expect(OLDER_EXPORT_MESSAGE).toBe("this export is from an earlier version of kernelspace and can't be imported")
    const olderFormat = JSON.stringify({ ...exportOf(ledger), version: 2 })
    expect(parseImport(olderFormat)).toMatchObject({ ok: false, error: 'older-export' })
  })

  test('refusals: parse, unknown-format, too-large, newer-schema, invalid', () => {
    expect(parseImport('{nope')).toMatchObject({ ok: false, error: 'parse' })
    expect(parseImport('[]')).toMatchObject({ ok: false, error: 'unknown-format' })
    expect(parseImport('{"hello":1}')).toMatchObject({ ok: false, error: 'unknown-format' })
    expect(parseImport(`"${'x'.repeat(IMPORT_MAX_BYTES)}"`)).toMatchObject({ ok: false, error: 'too-large' })

    const file = exportOf(ledger)
    expect(parseImport(JSON.stringify({ ...file, schemaVersion: SCHEMA_VERSION + 1 }))).toMatchObject({ ok: false, error: 'newer-schema' })
    expect(parseImport(JSON.stringify({ ...file, version: 4 }))).toMatchObject({ ok: false, error: 'newer-schema' })
    expect(parseImport(JSON.stringify({ ...file, schemaVersion: 'x' }))).toMatchObject({ ok: false, error: 'invalid' })
    expect(parseImport(JSON.stringify({ ...file, events: 'x' }))).toMatchObject({ ok: false, error: 'invalid' })

    const broken = { ...file, events: [...file.events, { ...file.events[0], id: 'broken', score: 7, kind: 'quiz', ref: 'lesson:t0.l1' }] }
    const r = parseImport(JSON.stringify(broken))
    expect(r).toMatchObject({ ok: false, error: 'invalid' })
    expect(!r.ok && r.detail).toContain('events[2]')
    for (const code of Object.keys(IMPORT_ERROR_MESSAGES)) expect(IMPORT_ERROR_MESSAGES[code as keyof typeof IMPORT_ERROR_MESSAGES].length).toBeGreaterThan(0)
  })

  test('missing optional sections default', () => {
    const file = JSON.parse(serializeExport(exportOf(ledger)))
    delete file.components
    delete file.extras
    const r = parseImport(JSON.stringify(file))
    expect(r.ok && r.file.extras).toEqual({ capstoneDrafts: {} })
    expect(r.ok && r.file.components).toEqual([])
  })

  test('duplicate ids inside a file collapse by the canonical rule', () => {
    const a = evt('complete', 'lesson:t0.l1', T1)
    const clash = { ...a, at: T2, day: '2026-09-02' } as LedgerEvent
    const file = { ...exportOf({ events: [a], working: [] }), events: [clash, a] }
    const r = parseImport(JSON.stringify(file))
    expect(r.ok && r.file.events).toEqual([a])
  })
})

describe('merge or replace (spec §10.3)', () => {
  test('merge unions; replace swaps events and working for the file\'s', () => {
    const local: Ledger = { events: [evt('visit', 'lesson:t0.l1', T1)], working: [{ key: 'fw:doc', value: 'local', at: T1, dev: 'a' }] }
    const file = exportOf({ events: [evt('visit', 'lesson:t0.l2', T2)], working: [{ key: 'boot:path', value: 'full-ramp', at: T2, dev: 'b' }] })
    expect(applyImport(local, file, 'merge').events).toHaveLength(2)
    expect(applyImport(local, file, 'merge').working.map((r) => r.key)).toEqual(['boot:path', 'fw:doc'])
    const replaced = applyImport(local, file, 'replace')
    expect(replaced.events).toEqual(file.events)
    expect(replaced.working).toEqual(file.working)
  })

  test('extras: drafts fill missing steps, flags OR, personal best keeps the higher goodput of one benchmark', () => {
    const local = {
      capstoneDrafts: { 'kernelspace:capstone:draft:s1': 'mine' },
      capstoneFlags: { hints: true },
      leaderboardPersonal: { benchmarkVersion: 'v1', overallGoodput: 10 },
    }
    const file = {
      capstoneDrafts: { 'kernelspace:capstone:draft:s1': 'theirs', 'kernelspace:capstone:draft:s2': 'new' },
      capstoneFlags: { hints: false, optimizer: true },
      leaderboardPersonal: { benchmarkVersion: 'v1', overallGoodput: 12 },
    }
    expect(mergeExtras(local, file)).toEqual({
      capstoneDrafts: { 'kernelspace:capstone:draft:s1': 'mine', 'kernelspace:capstone:draft:s2': 'new' },
      capstoneFlags: { hints: true, optimizer: true },
      leaderboardPersonal: { benchmarkVersion: 'v1', overallGoodput: 12 },
    })
    expect(mergeExtras({ ...local, leaderboardPersonal: { benchmarkVersion: 'v1', overallGoodput: 50 } }, file).leaderboardPersonal).toEqual({ benchmarkVersion: 'v1', overallGoodput: 50 })
    expect(mergeExtras(local, { ...file, leaderboardPersonal: { benchmarkVersion: 'v2', overallGoodput: 99 } }).leaderboardPersonal).toEqual(local.leaderboardPersonal)
    expect(mergeExtras({ capstoneDrafts: {} }, file).leaderboardPersonal).toEqual(file.leaderboardPersonal)
    expect(mergeExtras({ capstoneDrafts: {} }, { capstoneDrafts: {} })).toEqual({ capstoneDrafts: {} })
  })

  test('components union by hash', () => {
    const c = (sha: string, labId: string) => ({ sha256: sha.repeat(64), labId, size: 1, addedAt: T1 })
    const merged = mergeComponents([c('b', 'x'), c('a', 'x')], [c('a', 'x'), c('c', 'y')])
    expect(merged.map((m) => m.sha256[0])).toEqual(['a', 'b', 'c'])
  })
})

describe('previewImport (spec §10.5)', () => {
  const local: Ledger = {
    events: [evt('complete', 'lesson:t0.l1', T2, { dev: 'dev-a' }), evt('visit', 'lesson:t0.l3', T2, { dev: 'dev-a' })],
    working: [{ key: 'fw:doc', value: 'local', at: T2, dev: 'dev-a' }],
  }
  const fileLedger: Ledger = {
    events: [local.events[0], evt('complete', 'lesson:t0.l2', T1), evt('quiz', 'lesson:t0.l2', T1, { score: 1, ok: true })],
    working: [{ key: 'fw:doc', value: 'older', at: T1, dev: 'dev-b' }],
  }
  const text = serializeExport(exportOf(fileLedger))

  test('merge counts only new events and reports before and after', () => {
    const p = previewImport(text, 'merge', local)
    if ('error' in p) throw new Error(p.error)
    expect(p.fileEvents).toBe(3)
    expect(p.newEvents).toBe(2)
    expect(p.workingChanges).toBe(0) // the local doc is newer
    expect(p.before).toEqual({ lessonsDone: 1, xp: 100, activeDays: 0, labsDone: 0, events: 2 })
    expect(p.after).toEqual({ lessonsDone: 2, xp: 240, activeDays: 1, labsDone: 0, events: 4 })
    expect(p.warnings).toEqual(['file has no events newer than 2026-09-02'])
  })

  test('replace counts every file event, and warns about what it drops', () => {
    const p = previewImport(text, 'replace', { ...local, device: 'dev-a' })
    if ('error' in p) throw new Error(p.error)
    expect(p.newEvents).toBe(3)
    expect(p.workingChanges).toBe(1)
    expect(p.after.events).toBe(3)
    expect(p.warnings).toContain('replace drops 1 events made on this device')
    expect(p.warnings).toContain('file has no events newer than 2026-09-02')
  })

  test('errors come back instead of throwing', () => {
    expect(previewImport('nope', 'merge', local)).toMatchObject({ error: 'parse' })
    expect(previewImport(JSON.stringify({ version: 2, lessons: {}, xp: 0 }), 'merge', local)).toMatchObject({ error: 'older-export' })
  })

  test('importing into an empty ledger adds everything', () => {
    const p = previewImport(text, 'merge', { events: [], working: [] })
    if ('error' in p) throw new Error(p.error)
    expect(p.newEvents).toBe(3)
    expect(p.before.events).toBe(0)
  })
})

describe('codec properties', () => {
  const importText = (current: Ledger, text: string, mode: 'merge' | 'replace'): Ledger => {
    const parsed = parseImport(text)
    if (!parsed.ok) throw new Error(parsed.detail)
    return applyImport(current, parsed.file, mode)
  }

  test('P3 double-import converges (merge and replace)', () => {
    forSeeds((ctx) => {
      const [a, b] = [ctx.device(), ctx.device()]
      runOps(a, 40)
      runOps(b, 40)
      const text = serializeExport(exportOf(b.ledger(), { device: b.id }))
      const L = a.ledger()
      const once = importText(L, text, 'merge')
      expect(ledgerKey(importText(once, text, 'merge'))).toBe(ledgerKey(once))
      const replaced = importText(L, text, 'replace')
      expect(ledgerKey(importText(replaced, text, 'replace'))).toBe(ledgerKey(replaced))
      // a device importing its own export changes nothing
      expect(ledgerKey(importText(b.ledger(), text, 'merge'))).toBe(ledgerKey(b.ledger()))
    })
  })

  test('export is order-insensitive and derives to the same aggregate', () => {
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, 40)
      const l = d.ledger()
      const parsed = parseImport(serializeExport(exportOf(l)))
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(derive(parsed.file.events)).toEqual(derive(l.events))
      expect(parsed.file.working.length).toBe(l.working.length)
      expect(mergeLedgers({ events: parsed.file.events, working: parsed.file.working }, l)).toEqual(
        mergeLedgers(l, { events: parsed.file.events, working: parsed.file.working }),
      )
    })
  })
})
