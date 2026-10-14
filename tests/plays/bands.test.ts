import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { practiceBandOf } from '../../scripts/verify-plays'
import { PLAY_IDS } from '../../src/data/plays'
import { band as placementBand } from '../../src/lib/world/bands/block-placement'
import { band as schedulerBand, schedBandResult } from '../../src/lib/world/bands/scheduler'
import type { BandRead } from '../../src/lib/world/bands/types'
import { checkSchedBand, parseSchedSource, practiceMinute, type SchedBandCheck } from '../../src/lib/world/sched-traces'

/**
 * Practice bands by module (docs/specs/wave-3.md §4.2, task 3a-05). Each play's band is src/lib/world/bands/<id>.ts,
 * `band(read)`, and reads trace files only through the `read(repoPath)` loader it is given.
 */
const ROOT = resolve(import.meta.dir, '../..')

/** A loader that serves the committed files from memory and records what was asked for: a band that reached for node:fs would not show up here. */
function loader() {
  const asked: string[] = []
  const read: BandRead = async (repoPath) => {
    asked.push(repoPath)
    return readFileSync(join(ROOT, repoPath), 'utf8')
  }
  return { read, asked }
}

const realBand = async (): Promise<SchedBandCheck> => {
  const { read } = loader()
  const source = await parseSchedSource(
    JSON.parse(await read('public/traces/burstgpt-v2-busiest-minute.json')),
    JSON.parse(await read('public/traces/burstgpt-v2-busiest-hour.json')),
  )
  return checkSchedBand(practiceMinute(source))
}

describe('the band modules', () => {
  test('block placement is in band, and takes no loader because it reads no file', async () => {
    const r = await placementBand()
    expect(r.ok).toBe(true)
    expect(r.detail).toContain('is in band')
  })

  test('the scheduler reads its two traces through the loader, and is in band on all five rules', async () => {
    const { read, asked } = loader()
    const r = await schedulerBand(read)
    expect(r.ok).toBe(true)
    expect(r.detail).toContain('in band on all five rules')
    expect(asked.sort()).toEqual(['public/traces/burstgpt-v2-busiest-hour.json', 'public/traces/burstgpt-v2-busiest-minute.json'])
  })

  test('a loader that fails fails the band: nothing else supplies the traces', async () => {
    const read: BandRead = async (p) => {
      throw new Error(`no ${p}`)
    }
    await expect(schedulerBand(read)).rejects.toThrow('no public/traces/')
  })
})

describe('schedBandResult: all five §8.2 rules gate ok', () => {
  test('the real practice minute maps to ok with today’s note', async () => {
    const real = await realBand()
    const r = schedBandResult(real)
    expect(r.ok).toBe(true)
    expect(r.detail).toContain('in band on all five rules')
    expect(r.detail).toContain(`the reference serves ${real.ghost.met} of ${real.ghost.total} within the SLO`)
  })

  // The pinned minute passes all five, so a weakened rule cannot show up there: each case misses one rule only.
  test.each([
    [2, 1],
    [3, 2],
    [5, 4],
  ])('a result that misses only rule %i is out of band, and the note names it', async (rule, i) => {
    const real = await realBand()
    const rules = real.rules.map((ok, j) => (j === i ? false : ok)) as SchedBandCheck['rules']
    const violations = [`rule ${rule} fails`]
    for (const inBand of [false, true]) {
      const r = schedBandResult({ ...real, rules, violations, inBand })
      expect(r.ok).toBe(false)
      expect(r.detail).toContain(`outside the §8.2 band on rule ${rule} (rule ${rule} fails)`)
    }
  })

  test('rules 1 and 4 alone do not carry it, and several misses are all named', async () => {
    const real = await realBand()
    const r = schedBandResult({ ...real, rules: [true, false, false, true, false], violations: ['b', 'c', 'e'], inBand: false })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('rules 2, 3, 5 (b; c; e)')
    expect(schedBandResult({ ...real, rules: [true, true, true, true, true], violations: [], inBand: false }).ok).toBe(false)
  })
})

describe('practiceBandOf', () => {
  test('every registered play has a band module and is in band', async () => {
    for (const id of PLAY_IDS) {
      const r = await practiceBandOf(id, ROOT)
      expect(r).not.toBeNull()
      expect(r?.inBand).toBe(true)
      expect(r?.note.length).toBeGreaterThan(0)
    }
  })

  test('a play with no module, and an id that is not a module name, give null', async () => {
    for (const id of ['not-a-play', 'types', '', '__proto__', '../traces', 'scheduler.ts']) expect(await practiceBandOf(id, ROOT)).toBeNull()
  })
})
