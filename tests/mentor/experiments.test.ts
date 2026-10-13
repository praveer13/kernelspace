/**
 * The ladder-or-packet arm (docs/specs/wave-2.md §14.4; task 2c-06): `armFor` is a deterministic, balanced coin per
 * (experiment, unit, exp:seed) with no pattern across checks; `exp:seed` is created once, after the ledger has loaded;
 * and hint and packet acks carry the arm that was shown, which is what analysis reads.
 */
import { describe, expect, test } from 'bun:test'
import { hash32 } from '../../src/lib/rng'
import {
  HINT_EXPERIMENT,
  RANDOMIZED_LABS,
  armFor,
  ensureExpSeed,
  hintArm,
  hintUnit,
  isRandomizedLab,
  newExpSeed,
  readExpSeed,
} from '../../src/lib/learner/experiments'
import type { SeedStore } from '../../src/lib/learner/experiments'
import { hintRef } from '../../src/lib/forge/ladder'
import { makeProfile, startTab } from '../ledger/env'

/** Deterministic uniform [0, 1) from a counter, for the tests (not the code under test). */
const lcg = (seed: number) => {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

describe('armFor', () => {
  test('the same (experiment, unit, seed) always gives the same arm, and it is one of the two', () => {
    for (let seed = 0; seed < 200; seed++) {
      const a = armFor('e', 'rust-allocator/coalesce', seed)
      expect(['ladder', 'packet']).toContain(a)
      expect(armFor('e', 'rust-allocator/coalesce', seed)).toBe(a)
    }
  })

  test('pinned values, so a change to the hash or the formula is a decision, not an accident', () => {
    const got = [0, 1, 2, 3, 4294967295].map((s) => armFor(HINT_EXPERIMENT, hintUnit('kv-block-manager', 'cow'), s))
    expect(got).toEqual(['ladder', 'packet', 'packet', 'ladder', 'packet'])
  })

  test('the experiment, the unit and the seed each change the coin', () => {
    const base = Array.from({ length: 400 }, (_, i) => armFor('e', 'u', i))
    const differs = (f: (i: number) => string) => base.filter((a, i) => a !== f(i)).length
    expect(differs((i) => armFor('f', 'u', i))).toBeGreaterThan(100)
    expect(differs((i) => armFor('e', 'v', i))).toBeGreaterThan(100)
    expect(differs((i) => armFor('e', 'u', i + 1))).toBeGreaterThan(100)
  })

  test('half the learners get each arm for a check, over random seeds', () => {
    const rand = lcg(7)
    for (const unit of ['rust-allocator/coalesce', 'kv-block-manager/cow', 'bpe-tokenizer/merge-order']) {
      let packet = 0
      const n = 4000
      for (let i = 0; i < n; i++) if (armFor(HINT_EXPERIMENT, unit, newExpSeed(rand)) === 'packet') packet++
      expect(Math.abs(packet / n - 0.5)).toBeLessThan(0.04)
    }
  })

  test('a learner’s checks are not tied to each other: two checks agree for half the learners, not for all or none', () => {
    const rand = lcg(11)
    const n = 4000
    let agree = 0
    let packetA = 0
    let packetBgivenA = 0
    for (let i = 0; i < n; i++) {
      const seed = newExpSeed(rand)
      const a = armFor(HINT_EXPERIMENT, 'kv-block-manager/alloc-free', seed)
      const b = armFor(HINT_EXPERIMENT, 'kv-block-manager/cow', seed)
      if (a === b) agree++
      if (a === 'packet') {
        packetA++
        if (b === 'packet') packetBgivenA++
      }
    }
    expect(Math.abs(agree / n - 0.5)).toBeLessThan(0.04)
    expect(Math.abs(packetBgivenA / packetA - 0.5)).toBeLessThan(0.05)
  })

  test('why not hash32 % 2: its low bit is the parity of the odd bytes, so the unit alone would fix the arm', () => {
    // for one unit, the raw low bit takes both values only through the digits of the seed, and across two units
    // the raw bit is the same function of the seed shifted by a constant: perfectly correlated
    const raw = (unit: string, seed: number) => hash32(`${HINT_EXPERIMENT}:${unit}:${seed}`) % 2
    let same = 0
    let diff = 0
    for (let seed = 0; seed < 500; seed++) {
      if (raw('a/x', seed) === raw('a/y', seed)) same++
      else diff++
    }
    expect(same === 500 || diff === 500).toBe(true)
  })
})

describe('hintArm', () => {
  test('labs 01 to 03 are randomized, every other lab keeps the whole ladder with no arm', () => {
    expect(RANDOMIZED_LABS).toEqual(['rust-allocator', 'kv-block-manager', 'bpe-tokenizer'])
    for (const id of RANDOMIZED_LABS) expect(hintArm(id, 'c', 5)).toBe(armFor(HINT_EXPERIMENT, `${id}/c`, 5))
    expect(isRandomizedLab('mpmc-queue')).toBe(false)
    expect(hintArm('mpmc-queue', 'c', 5)).toBeUndefined()
  })
  test('without a seed there is no arm', () => {
    expect(hintArm('rust-allocator', 'c', undefined)).toBeUndefined()
  })
})

describe('the seed', () => {
  test('readExpSeed takes a uint32 and nothing else', () => {
    expect(readExpSeed(0)).toBe(0)
    expect(readExpSeed(4294967295)).toBe(4294967295)
    for (const bad of [-1, 4294967296, 1.5, NaN, '5', null, undefined, {}]) expect(readExpSeed(bad)).toBeUndefined()
  })

  test('newExpSeed spans the uint32 range', () => {
    expect(newExpSeed(() => 0)).toBe(0)
    expect(newExpSeed(() => 0.999999999999)).toBeLessThanOrEqual(4294967295)
    expect(newExpSeed(() => 0.5)).toBe(2147483648)
  })

  const store = (over: Partial<SeedStore> = {}): SeedStore & { writes: number[] } => {
    const s = {
      ledger: { ready: true, readOnly: false },
      working: {} as SeedStore['working'],
      writes: [] as number[],
      setWorking(_key: 'exp:seed', value: number) {
        this.writes.push(value)
        this.working = { 'exp:seed': value }
      },
      ...over,
    }
    return s
  }

  test('created once, only after the ledger has loaded, and never in a read-only tab', () => {
    const s = store()
    ensureExpSeed(s, () => 0.25)
    ensureExpSeed(s, () => 0.75)
    expect(s.writes).toEqual([1073741824])
    const loading = store({ ledger: { ready: false, readOnly: false } })
    ensureExpSeed(loading, () => 0.25)
    expect(loading.writes).toEqual([])
    const ro = store({ ledger: { ready: true, readOnly: true } })
    ensureExpSeed(ro, () => 0.25)
    expect(ro.writes).toEqual([])
  })

  test('a seed that is already there is kept', () => {
    const s = store({ working: { 'exp:seed': 99 } })
    ensureExpSeed(s, () => 0.5)
    expect(s.writes).toEqual([])
  })
})

describe('through the ledger', () => {
  test('exp:seed is written once, survives a reload, and the arm it gives is the same on the second visit', async () => {
    const profile = makeProfile()
    const first = startTab(profile)
    await first.progress.controls.engine()
    ensureExpSeed(first.progress.getState(), lcg(3))
    const seed = readExpSeed(first.progress.getState().working['exp:seed'])
    expect(seed).toBeDefined()
    ensureExpSeed(first.progress.getState(), lcg(4)) // a second component asking: nothing changes
    expect(readExpSeed(first.progress.getState().working['exp:seed'])).toBe(seed!)
    await first.progress.controls.flush()

    const second = startTab(profile)
    await second.progress.controls.engine()
    ensureExpSeed(second.progress.getState(), lcg(5))
    expect(readExpSeed(second.progress.getState().working['exp:seed'])).toBe(seed!)
    expect(hintArm('rust-allocator', 'coalesce', seed)).toBe(hintArm('rust-allocator', 'coalesce', readExpSeed(second.progress.getState().working['exp:seed'])))
  })

  test('recordHelp writes a packet ack with via, chars and arm, and a hint ack carries the arm too', async () => {
    const tab = startTab(makeProfile())
    const engine = await tab.engine()
    const s = tab.progress.getState()
    s.recordHelp('packet:lab/kv-block-manager/cow', { via: 'claude', chars: 4200, arm: 'packet' })
    s.recordHelp('packet:lab/kv-block-manager/cow', { via: 'copy', chars: 4300, arm: 'packet' }) // every use counts, not only the first
    s.recordHelp('packet:lesson/t5.l4', { via: 'chatgpt', chars: 5900 })
    s.acknowledge(hintRef('cow', 'R0', 'kv-block-manager'), { arm: 'ladder' })
    s.acknowledge(hintRef('cow', 'R0', 'kv-block-manager'), { arm: 'packet' }) // an ack already in the ledger is not written again
    await tab.progress.controls.flush()
    const acks = await engine.events({ kinds: ['ack'] })
    const packets = acks.filter((e) => e.ref.startsWith('packet:'))
    expect(packets.map((e) => (e as { data?: unknown }).data)).toEqual(
      expect.arrayContaining([
        { via: 'claude', chars: 4200, arm: 'packet' },
        { via: 'copy', chars: 4300, arm: 'packet' },
        { via: 'chatgpt', chars: 5900 },
      ]),
    )
    expect(packets).toHaveLength(3)
    const hints = acks.filter((e) => e.ref.startsWith('hint:'))
    expect(hints).toHaveLength(1)
    expect((hints[0] as { data?: unknown }).data).toEqual({ arm: 'ladder' })
  })

  test('the packet ack never records content: a longer-than-allowed report is clamped to 6,000 characters', async () => {
    const tab = startTab(makeProfile())
    const engine = await tab.engine()
    tab.progress.getState().recordHelp('packet:sim/sim-kv', { via: 'copy', chars: 99999 })
    await tab.progress.controls.flush()
    const [ack] = (await engine.events({ kinds: ['ack'] })).filter((e) => e.ref.startsWith('packet:'))
    expect((ack as { data?: unknown }).data).toEqual({ via: 'copy', chars: 6000 })
  })
})
