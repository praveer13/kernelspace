/**
 * Spec §13 properties that survive Addendum A (no legacy projection, policy or migration):
 * P3 double-import, P5 two-device merge, P6 order-insensitivity (fold.test.ts), P7's pure half,
 * I7 (fold.test.ts) and P8 the 12-month round trip. Seeds x ops: LEDGER_SEEDS x LEDGER_OPS.
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { applyImport, buildExportV3, parseImport, serializeExport } from '../../src/lib/ledger/codec'
import { IMPORT_MAX_BYTES } from '../../src/lib/ledger/constants'
import { derive } from '../../src/lib/ledger/fold'
import { mergeLedgers, type Ledger } from '../../src/lib/ledger/merge'
import { dayOf } from '../../src/lib/ledger/time'
import { toProgressData, workingMap } from '../../src/lib/ledger/view'
import type { LedgerEvent } from '../../src/lib/ledger/types'
import { forSeeds, int, ledgerKey, OPS, pick, runOps, shuffle, syntheticYear, TZS, PROPERTY_TIMEOUT_MS } from './gen'

setDefaultTimeout(PROPERTY_TIMEOUT_MS)

const EXPORTED_AT = '2026-10-04T12:00:00.000Z'

/** Device `from` hands a file to a ledger: build the export, serialise, parse, import with merge. */
function sync(into: Ledger, from: { ledger: () => Ledger; id: string }): Ledger {
  const text = serializeExport(buildExportV3({ ...from.ledger(), device: from.id, exportedAt: EXPORTED_AT }))
  const parsed = parseImport(text)
  if (!parsed.ok) throw new Error(`${parsed.error}: ${parsed.detail}`)
  return applyImport(into, parsed.file, 'merge')
}

/** The same fact re-recorded in another timezone, a few minutes later (the canonical-rule clash). */
function reRecord(e: LedgerEvent, tz: number, minutes: number): LedgerEvent {
  const at = new Date(Date.parse(e.at) + minutes * 60_000).toISOString()
  return { ...e, at, tz, day: dayOf(at, tz) } as LedgerEvent
}

describe('P5 two-device merge', () => {
  test('both directions converge, with conflicts on shared events', () => {
    forSeeds((ctx) => {
      const base = ctx.device()
      runOps(base, 10)
      const [a, b] = [ctx.device(), ctx.device()]
      a.adopt(base.ledger(), base.ms)
      b.adopt(base.ledger(), base.ms)
      runOps(a, OPS)
      runOps(b, OPS)
      for (const e of base.events.values()) {
        if (ctx.rand() < 0.15) b.events.set(e.id, reRecord(e, pick(ctx.rand, TZS), int(ctx.rand, 1, 600)))
      }

      const aGetsB = sync(a.ledger(), b)
      const bGetsA = sync(b.ledger(), a)
      expect(ledgerKey(aGetsB)).toBe(ledgerKey(bGetsA))
      expect(ledgerKey(mergeLedgers(a.ledger(), b.ledger()))).toBe(ledgerKey(aGetsB))

      // The derived view agrees too, and merged XP is at least either side's (facts are a set, never a sum).
      const merged = toProgressData(derive(aGetsB.events), workingMap(aGetsB.working))
      expect(toProgressData(derive(bGetsA.events), workingMap(bGetsA.working))).toEqual(merged)
      expect(merged.xp).toBeGreaterThanOrEqual(toProgressData(derive(a.events.values())).xp)
      expect(merged.xp).toBeGreaterThanOrEqual(toProgressData(derive(b.events.values())).xp)
    })
  })

  test('three devices converge under any pairwise schedule', () => {
    forSeeds((ctx) => {
      const devs = [ctx.device(), ctx.device(), ctx.device()]
      for (const d of devs) runOps(d, OPS)
      const state = devs.map((d) => d.ledger())
      for (let step = 0; step < 6; step++) {
        const [i, j] = shuffle(ctx.rand, [0, 1, 2])
        state[i] = sync(state[i], { ledger: () => state[j], id: devs[j].id })
      }
      // Then one full exchange round: everyone ends with everything.
      for (const i of [0, 1, 2]) for (const j of [0, 1, 2]) if (i !== j) state[i] = sync(state[i], { ledger: () => state[j], id: devs[j].id })
      for (const i of [0, 1, 2]) for (const j of [0, 1, 2]) if (i !== j) state[i] = sync(state[i], { ledger: () => state[j], id: devs[j].id })
      expect(ledgerKey(state[1])).toBe(ledgerKey(state[0]))
      expect(ledgerKey(state[2])).toBe(ledgerKey(state[0]))
    })
  })
})

describe('P3 double-import', () => {
  test('replace twice equals replace once; merge twice equals merge once', () => {
    forSeeds((ctx) => {
      const [a, b] = [ctx.device(), ctx.device()]
      runOps(a, OPS)
      runOps(b, OPS)
      const text = serializeExport(buildExportV3({ ...b.ledger(), device: b.id, exportedAt: EXPORTED_AT }))
      const parsed = parseImport(text)
      if (!parsed.ok) throw new Error(parsed.detail)
      for (const mode of ['merge', 'replace'] as const) {
        const once = applyImport(a.ledger(), parsed.file, mode)
        expect(ledgerKey(applyImport(once, parsed.file, mode))).toBe(ledgerKey(once))
      }
    })
  })
})

describe('P8 12-month round trip', () => {
  for (const profile of ['light', 'heavy'] as const) {
    test(`${profile} year: export -> JSON -> import(replace) comes back identical`, () => {
      const year = syntheticYear(profile === 'light' ? 7 : 8, profile)
      const text = serializeExport(buildExportV3({ ...year, device: 'year', exportedAt: EXPORTED_AT }))
      const bytes = new TextEncoder().encode(text).byteLength
      console.log(`P8 ${profile}: ${year.events.length} events, ${(bytes / 1024 / 1024).toFixed(2)} MB`)
      expect(bytes).toBeLessThan(IMPORT_MAX_BYTES)

      const parsed = parseImport(JSON.stringify(JSON.parse(text)))
      if (!parsed.ok) throw new Error(`${parsed.error}: ${parsed.detail}`)
      const back = applyImport({ events: [], working: [] }, parsed.file, 'replace')
      expect(back.events.length).toBe(year.events.length)
      expect(ledgerKey(back)).toBe(ledgerKey(year))
      expect(derive(back.events)).toEqual(derive(year.events))
      // importing the same year again (merge) changes nothing
      expect(ledgerKey(applyImport(back, parsed.file, 'merge'))).toBe(ledgerKey(back))
    })
  }
})

describe('L1 purity', () => {
  test('the core modules never touch the DOM, storage, IndexedDB or zustand', () => {
    const dir = new URL('../../src/lib/ledger/', import.meta.url)
    const files = ['constants', 'stable', 'time', 'ids', 'refs', 'fold', 'view', 'merge', 'codec', 'changes', 'types']
    const forbidden =
      /\b(window|document|localStorage|sessionStorage|indexedDB|IDBDatabase|BroadcastChannel|navigator|zustand|requestIdleCallback)\b/
    for (const name of [...files, '../economy']) {
      const source = readFileSync(new URL(`${name}.ts`, dir), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/^import type .*$/gm, '')
      expect(`${name}: ${forbidden.exec(source)?.[0] ?? 'clean'}`).toBe(`${name}: clean`)
    }
  })
})
