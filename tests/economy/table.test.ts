/**
 * The economy table (wave-1.md §8.4, task B7) equals its sources: labs.ts, the capstone STEPS, the Fleet Week
 * acts, the T0–T2 lessons. When one changes, the failure shows the rebuilt value to copy into
 * src/lib/economy-table.ts. The table stays import-free, because it ships in the entry chunk.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { FORGE_LABS } from '../../src/data/labs'
import { LESSONS_BY_TRACK } from '../../src/data/lessons'
import { PLAY_IDS } from '../../src/data/plays'
import { STEPS } from '../../src/lib/capstone/steps'
import {
  CAPSTONE_STEP_MINUTES,
  FLEET_ACT_MINUTES,
  LABS,
  PLAY_MINUTES,
  RING2_LAB,
  RING2_LESSONS,
  RING2_R_LABS,
  SPIRAL_LESSONS,
} from '../../src/lib/economy-table'
import { XP } from '../../src/lib/economy'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('labs', () => {
  test('the table equals labs.ts: every lab, its minutes, its required check ids in order', () => {
    const expected = Object.fromEntries(
      FORGE_LABS.map((l) => [l.id, { minutes: l.minutes, checks: l.checks.filter((c) => !c.optional).map((c) => c.id) }]),
    )
    expect(LABS).toEqual(expected)
  })

  test('lab 01 is 90 ÷ 6 = 15 a check; optional checks are not in the table', () => {
    expect(LABS['rust-allocator'].minutes / LABS['rust-allocator'].checks.length).toBe(15)
    expect(LABS['kv-block-manager'].checks).not.toContain('adapter_unified_paging')
    for (const lab of Object.values(LABS)) expect(lab.checks.length).toBeGreaterThan(0)
  })

  test('the 18 labs are worth about 1,300 nominal minutes (PLAN §1)', () => {
    const total = Object.values(LABS).reduce((sum, l) => sum + l.minutes, 0)
    expect(Object.keys(LABS)).toHaveLength(18)
    expect(total).toBeGreaterThan(1250)
    expect(total).toBeLessThan(1400)
  })
})

describe('capstone, acts, plays', () => {
  test('CAPSTONE_STEP_MINUTES equals the capstone STEPS (src/lib/capstone/steps.ts)', () => {
    expect(CAPSTONE_STEP_MINUTES).toEqual(Object.fromEntries(STEPS.map((s) => [s.id, s.minutes])))
  })

  test('FLEET_ACT_MINUTES covers exactly the Fleet Week acts; the incident is 20, the rest 30', () => {
    const src = read('src/pages/FleetWeek.tsx')
    const block = src.slice(src.indexOf('const ACTS = ['), src.indexOf(']', src.indexOf('const ACTS = [')))
    const ids = [...block.matchAll(/\{ id: '([^']+)'/g)].map((m) => m[1])
    expect(Object.keys(FLEET_ACT_MINUTES).sort()).toEqual([...ids].sort())
    expect(FLEET_ACT_MINUTES).toEqual({ engine: 30, fleet: 30, business: 30, incident: 20 })
  })

  test('block placement is 15 minutes, and PLAY_MINUTES covers exactly the plays /play/:playId serves', () => {
    expect(PLAY_MINUTES).toEqual({ 'block-placement': 15 })
    expect(Object.keys(PLAY_MINUTES).sort()).toEqual([...PLAY_IDS].sort())
  })
})

describe('RING 2 ids', () => {
  test('RING2_LESSONS is every T0–T2 lesson, in curriculum order', () => {
    const ids = (['t0', 't1', 't2'] as const).flatMap((t) => LESSONS_BY_TRACK[t].map((l) => l.id))
    expect(ids).toHaveLength(19)
    expect(RING2_LESSONS).toEqual(ids)
  })

  test('SPIRAL_LESSONS is the exam lessons of T0–T2 (t2.l7)', () => {
    const exams = (['t0', 't1', 't2'] as const).flatMap((t) => LESSONS_BY_TRACK[t].filter((l) => l.exam).map((l) => l.id))
    expect([...SPIRAL_LESSONS]).toEqual(exams)
    expect([...SPIRAL_LESSONS]).toEqual(['t2.l7'])
  })

  test('the R drills are R1–R5 and the lab is the allocator, all in the table', () => {
    expect([...RING2_R_LABS]).toEqual(['rust-zero-r1', 'rust-zero-r2', 'rust-zero-r3', 'rust-zero-r4', 'rust-zero-r5'])
    expect(RING2_LAB).toBe('rust-allocator')
    for (const id of [...RING2_R_LABS, RING2_LAB]) expect(LABS[id]).toBeDefined()
  })
})

describe('the entry chunk', () => {
  test('economy-table.ts imports nothing, and economy.ts only the table and types', () => {
    expect(read('src/lib/economy-table.ts')).not.toMatch(/^import /m)
    const imports = [...read('src/lib/economy.ts').matchAll(/^import (?:type )?[^]*? from '([^']+)'/gm)].map((m) => m[1])
    expect(imports.sort()).toEqual(['./economy-table', './ledger/types'])
    expect(read('src/lib/economy.ts')).toMatch(/^import type \{ Aggregate \} from '\.\/ledger\/types'/m)
  })

  test('the table is small enough to ship in the entry chunk (under 8 KB of source)', () => {
    expect(read('src/lib/economy-table.ts').length).toBeLessThan(8 * 1024)
  })
})

describe('the XP export', () => {
  test('keeps its keys, with v2 nominal values', () => {
    expect(XP).toEqual({ lesson: 0, quiz: 3, exercise: 0, capstoneStep: 20, lab: 90, fleetWeekAct: 30 })
    expect(Object.keys(XP)).toEqual(['lesson', 'quiz', 'exercise', 'capstoneStep', 'lab', 'fleetWeekAct'])
  })
})
