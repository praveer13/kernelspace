/**
 * XP pays `cap:<step>` the step's nominal minutes (spec wave-1 §8.4), so the
 * generated economy table must carry exactly the minutes in capstone/steps.ts.
 * The table arrives with B7 (src/lib/economy-table.ts); until this branch has
 * it, only the STEPS side is checked.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { STEPS } from '../../src/lib/capstone/steps'

const TABLE = new URL('../../src/lib/economy-table.ts', import.meta.url)
const STEP_IDS = ['tokenize', 'embed', 'forward', 'decode', 'kv-cache', 'batch', 'measure']

/** Every object reachable from the table's exports (depth ≤ 3) whose keys are exactly the step ids. */
function capstoneMinuteTables(mod: Record<string, unknown>): Record<string, unknown>[] {
  const want = [...STEP_IDS].sort().join()
  const found: Record<string, unknown>[] = []
  const walk = (v: unknown, depth: number) => {
    if (depth > 3 || v == null || typeof v !== 'object') return
    if (Object.keys(v).sort().join() === want) found.push(v as Record<string, unknown>)
    for (const child of Object.values(v)) walk(child, depth + 1)
  }
  walk(mod, 0)
  return found
}

describe('capstone step minutes', () => {
  test('seven steps, the ids the ledger records, whole positive minutes', () => {
    expect(STEPS.map((s) => s.id)).toEqual(STEP_IDS)
    for (const s of STEPS) {
      expect(Number.isInteger(s.minutes)).toBe(true)
      expect(s.minutes).toBeGreaterThan(0)
    }
    // the hero promises "~4h"
    const total = STEPS.reduce((a, s) => a + s.minutes, 0)
    expect(Math.abs(total - 240)).toBeLessThanOrEqual(30)
  })

  test.skipIf(!existsSync(TABLE))('equal the economy table', async () => {
    const mod = (await import(TABLE.href)) as Record<string, unknown>
    const tables = capstoneMinuteTables(mod)
    expect(tables.length).toBeGreaterThan(0)
    const minutes = Object.fromEntries(STEPS.map((s) => [s.id, s.minutes]))
    for (const t of tables) expect(t).toEqual(minutes)
  })
})
