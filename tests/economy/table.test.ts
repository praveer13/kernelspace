/**
 * The economy table (wave-1.md §8.4, task B7) equals its sources: labs.ts, the capstone STEPS, the Fleet Week
 * acts, the T0–T2 lessons. When one changes, the failure shows the rebuilt value to copy into
 * src/lib/economy-table.ts. The table stays import-free, because it ships in the entry chunk.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS, LESSONS_BY_TRACK } from '../../src/data/lessons'
import { PLAY_IDS, PLAYS } from '../../src/data/plays'
import { STEPS } from '../../src/lib/capstone/steps'
import {
  CAPSTONE_STEP_MINUTES,
  FLEET_ACT_MINUTES,
  FLEET_RUN_MINUTES,
  INCIDENT_MINUTES,
  LABS,
  PLAY_MINUTES,
  RING0_LABS,
  RING0_RACE_LABS,
  RING0_LESSONS,
  RING1_LABS,
  RING1_LESSONS,
  RING1_R_LABS,
  RING2_LAB,
  RING2_LESSONS,
  RING2_R_LABS,
  ROOT_ACTS,
  ROOT_LAB,
  ROOT_LESSONS,
  SPIRAL_LESSONS,
} from '../../src/lib/economy-table'
import { XP, xpBySource } from '../../src/lib/economy'

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

  test('every registered play is priced with its PlayDef.minutes; the scheduler, tiling cube and EPLB are priced before their plays register', () => {
    for (const [id, def] of Object.entries(PLAYS)) expect(PLAY_MINUTES[id]).toBe(def.minutes)
    expect(PLAY_MINUTES['block-placement']).toBe(15)
    // a price may run ahead of its play (2b registers the scheduler; Wave 3 the tiling cube and EPLB), but only theirs
    const ahead = ['scheduler', 'tiling-cube', 'eplb']
    expect(Object.keys(PLAY_MINUTES).filter((id) => !PLAY_IDS.includes(id) && !ahead.includes(id))).toEqual([])
    expect(PLAY_MINUTES.scheduler).toBe(20)
    expect(PLAY_MINUTES['tiling-cube']).toBe(25)
    expect(PLAY_MINUTES.eplb).toBe(15)
  })

  test('incidents and fleet runs are priced: daily 10, drill 5, a run 10 (wave-2.md §3.4)', () => {
    expect(INCIDENT_MINUTES).toEqual({ daily: 10, drill: 5 })
    expect(FLEET_RUN_MINUTES).toBe(10)
  })
})

describe('RING 2 ids', () => {
  test('RING2_LESSONS is every T0–T2 lesson, in curriculum order', () => {
    const ids = (['t0', 't1', 't2'] as const).flatMap((t) => LESSONS_BY_TRACK[t].map((l) => l.id))
    expect(ids).toHaveLength(19)
    expect(RING2_LESSONS).toEqual(ids)
  })

  test('SPIRAL_LESSONS is every lesson whose ticket is a spiral: t2.l7 and the five track-end spirals', () => {
    const spirals = ALL_LESSONS.filter((l) => l.ticket?.form === 'spiral').map((l) => l.id)
    expect([...SPIRAL_LESSONS]).toEqual(spirals)
    expect([...SPIRAL_LESSONS]).toEqual(['t2.l7', 't3.l7', 't4.l7', 't5.l10', 't6.l10', 't7.l5'])
    // T2's spiral is also its exam lesson
    const exams = (['t0', 't1', 't2'] as const).flatMap((t) => LESSONS_BY_TRACK[t].filter((l) => l.exam).map((l) => l.id))
    expect(exams).toEqual(['t2.l7'])
  })

  test('each spiral pays the spiral price and every other ticket the ticket price (wave-2.md §6.2)', () => {
    const fact = (id: string) => `quiz-pass:${id}` as const
    const minutes = (id: string) => xpBySource({ facts: { [fact(id)]: true }, itemSec: {} }).tickets
    for (const id of SPIRAL_LESSONS) expect(minutes(id)).toBe(8)
    for (const id of ['t0.l1', 't3.l6', 't4.l6', 't5.l9', 't6.l9', 't7.l4']) expect(minutes(id)).toBe(3)
  })

  test('the R drills are R1–R5 and the lab is the allocator, all in the table', () => {
    expect([...RING2_R_LABS]).toEqual(['rust-zero-r1', 'rust-zero-r2', 'rust-zero-r3', 'rust-zero-r4', 'rust-zero-r5'])
    expect(RING2_LAB).toBe('rust-allocator')
    for (const id of [...RING2_R_LABS, RING2_LAB]) expect(LABS[id]).toBeDefined()
  })
})

describe('RING 1, RING 0 and ROOT ids (wave-2.md §6.4)', () => {
  const lessonIds = (tracks: readonly ('t3' | 't4' | 't5' | 't6' | 't7')[]) => tracks.flatMap((t) => LESSONS_BY_TRACK[t].map((l) => l.id))

  test('the lesson lists are whole tracks, in curriculum order', () => {
    expect([...RING1_LESSONS]).toEqual(lessonIds(['t3', 't4']))
    expect([...RING0_LESSONS]).toEqual(lessonIds(['t5']))
    expect([...ROOT_LESSONS]).toEqual(lessonIds(['t6', 't7']))
  })

  test('the lab lists are the labs the spec names, all in the table, and the right lab numbers', () => {
    const index = (id: string) => FORGE_LABS.find((l) => l.id === id)?.index
    expect([...RING1_R_LABS].map(index)).toEqual([6, 7, 8, 9, 10])
    expect([...RING1_LABS].map(index)).toEqual([4, 5])
    expect([...RING0_LABS].map(index)).toEqual([2, 3, 6, 7])
    expect(index(ROOT_LAB)).toBe(8)
    for (const id of [...RING1_R_LABS, ...RING1_LABS, ...RING0_LABS, ROOT_LAB]) expect(LABS[id]).toBeDefined()
  })

  test('the labs whose race RING 0 needs are RING 0 labs (the list is empty until 3b-09 ships the race, D25)', () => {
    for (const id of RING0_RACE_LABS) {
      expect(RING0_LABS).toContain(id)
      expect(LABS[id]).toBeDefined()
    }
  })

  test('ROOT_ACTS are Fleet Week acts, and no ring list repeats an id or another ring', () => {
    expect(Object.keys(FLEET_ACT_MINUTES)).toEqual(expect.arrayContaining([...ROOT_ACTS]))
    const every = [...RING2_LESSONS, ...RING1_LESSONS, ...RING0_LESSONS, ...ROOT_LESSONS]
    expect(new Set(every).size).toBe(every.length)
    expect(every).toHaveLength(19 + 14 + 10 + 15)
  })
})

describe('the entry chunk', () => {
  test('economy-table.ts imports nothing, and economy.ts only the table and types', () => {
    expect(read('src/lib/economy-table.ts')).not.toMatch(/^import /m)
    const imports = [...read('src/lib/economy.ts').matchAll(/^import (?:type )?[^]*? from '([^']+)'/gm)].map((m) => m[1])
    expect(imports.sort()).toEqual(['./economy-table', './ledger/types'])
    expect(read('src/lib/economy.ts')).toMatch(/^import type \{ Aggregate, LedgerEvent \} from '\.\/ledger\/types'/m)
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
