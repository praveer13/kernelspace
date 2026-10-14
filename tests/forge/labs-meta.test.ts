/**
 * Labs 04-08 metadata (docs/specs/wave-3.md §8.1; task 3a-10): every check carries the stage its crate's `list` reply
 * gives, the KCs of the §8.1 table and an expectation; the KCs name the lab back; the five TODO files carry STAGE
 * markers and a header that says which check catches which mistake.
 *
 * The crates' `list` replies are built from `CHECKS` in each lib.rs, and `calibration.json` is keyed by the same
 * ids in the same order, so the committed sources are what labs.ts is held to here. `verify:labs` compares the
 * built modules' own replies; this test keeps the gate that needs no wasm toolchain.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { FORGE_LABS, type ForgeLab } from '../../src/data/labs'
import { KC_GRAPH, kcById } from '../../src/data/kc'

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')

/** The §8.1 table: lab → check → [stage, KCs]. */
const TABLE: Record<string, Record<string, [number, string[]]>> = {
  'mpmc-queue': {
    fifo: [1, ['t2.mutex-atomics']],
    backpressure: [2, ['t2.mutex-atomics']],
    wraparound: [3, ['t2.aba']],
    slot_conservation: [3, ['t2.aba']],
    model_gauntlet: [4, ['t2.mutex-atomics', 't2.aba']],
    burst_model: [4, ['t2.mutex-atomics']],
  },
  'toy-executor': {
    block_on: [1, ['t3.futures-state-machines']],
    fifo_poll: [2, ['t3.wakers-executor']],
    ping_pong: [3, ['t3.wakers-executor']],
    nested_spawn: [3, ['t3.wakers-executor']],
    many_tasks: [4, ['t3.wakers-executor']],
    pending_repoll: [2, ['t3.futures-state-machines', 't3.wakers-executor']],
  },
  'batching-scheduler': {
    runs_clean: [1, ['t5.continuous-batching']],
    burst: [2, ['t5.continuous-batching']],
    slo_light: [2, ['t5.admission-headroom']],
    overload_seeded: [4, ['t5.admission-headroom']],
    convoy: [3, ['t5.sched-order']],
    starvation: [3, ['t5.sched-order']],
    goodput_score: [4, ['t5.batching-throughput']],
  },
  'radix-cache': {
    exact_match: [1, ['t5.prefix-cache-keys']],
    longest_prefix: [2, ['t5.prefix-cache-keys']],
    eviction_order: [3, ['t5.radix-eviction']],
    cow_divergence: [3, ['t5.block-refcounts']],
    block_conservation: [4, ['t5.block-refcounts']],
    chat_hit_rate: [4, ['t5.prefix-cache-keys', 't5.radix-eviction']],
  },
  'xgrammar-lite': {
    schema_compile: [1, ['t6.grammar-masks']],
    valid_acceptance: [2, ['t6.grammar-masks']],
    earliest_rejection: [2, ['t6.grammar-masks']],
    token_mask: [3, ['t6.grammar-masks']],
    mask_overhead: [4, ['t6.grammar-masks']],
    compile_cache: [4, ['t6.grammar-masks']],
  },
}

const labOf = (id: string): ForgeLab => {
  const lab = FORGE_LABS.find((l) => l.id === id)
  if (lab === undefined) throw new Error(`lab ${id} is missing from labs.ts`)
  return lab
}
const crateOf = (lab: ForgeLab) => `labs/${lab.crateDir ?? lab.id}`

/** `CHECKS` of a crate's lib.rs, in `list` order: the rows the module's reply is built from. */
function listRows(lab: ForgeLab): { id: string; stage: number; seeded: boolean }[] {
  const src = read(`${crateOf(lab)}/src/lib.rs`)
  return [...src.matchAll(/CheckDef \{ id: "(\w+)", label: \w+, stage: (\d+), seeded: (true|false)/g)].map((m) => ({
    id: m[1] as string,
    stage: Number(m[2]),
    seeded: m[3] === 'true',
  }))
}

describe('labs 04-08 metadata (spec §8.1)', () => {
  for (const [labId, rows] of Object.entries(TABLE)) {
    describe(labId, () => {
      const lab = labOf(labId)

      test('every check has the table\'s stage and KCs, and an expectation', () => {
        expect(lab.checks.map((c) => c.id).sort()).toEqual(Object.keys(rows).sort())
        for (const c of lab.checks) {
          const [stage, kcs] = rows[c.id] as [number, string[]]
          expect({ id: c.id, stage: c.stage, kcs: [...(c.kcs ?? [])].sort() }).toEqual({ id: c.id, stage, kcs: [...kcs].sort() })
          expect((c.expectation ?? '').length).toBeGreaterThan(20)
        }
      })

      test('labs.ts holds the crate\'s list order, stages and the committed calibration list', () => {
        const rowsInCrate = listRows(lab)
        expect(rowsInCrate.length).toBe(lab.checks.length)
        expect(lab.checks.map((c) => ({ id: c.id, stage: c.stage }))).toEqual(rowsInCrate.map((r) => ({ id: r.id, stage: r.stage })))
        const cal = JSON.parse(read(`${crateOf(lab)}/calibration.json`)) as { lab: string; checks: Record<string, { seeded: boolean }> }
        expect(cal.lab).toBe(lab.id)
        expect(Object.keys(cal.checks)).toEqual(lab.checks.map((c) => c.id))
        expect(Object.values(cal.checks).map((c) => c.seeded)).toEqual(rowsInCrate.map((r) => r.seeded))
      })

      test('stage 1 exists and stages climb from 1 without a gap', () => {
        const stages = [...new Set(lab.checks.map((c) => c.stage ?? 0))].sort((a, b) => a - b)
        expect(stages[0]).toBe(1)
        expect(stages).toEqual(stages.map((_, i) => i + 1))
      })

      test('each tagged KC names the lab, and every KC naming the lab is tagged by a check', () => {
        const tagged = new Set(lab.checks.flatMap((c) => c.kcs ?? []))
        for (const id of tagged) expect({ id, labs: kcById(id)?.labs ?? [] }).toEqual({ id, labs: expect.arrayContaining([lab.id]) })
        const naming = KC_GRAPH.kcs.filter((k) => (k.labs ?? []).includes(lab.id)).map((k) => k.id)
        expect(naming.sort()).toEqual([...tagged].sort())
      })

      test('the TODO file carries a STAGE marker for every stage and a header naming every check', () => {
        const src = read(`${crateOf(lab)}/${lab.editFile}`)
        const header = src.split('\n').filter((l) => l.startsWith('//!')).join('\n')
        for (const stage of new Set(lab.checks.map((c) => c.stage))) expect(src).toContain(`STAGE ${stage}`)
        expect(header).toContain('Which check catches which mistake')
        for (const c of lab.checks) expect({ id: c.id, inHeader: header.includes(c.id) }).toEqual({ id: c.id, inHeader: true })
      })
    })
  }

  test('only lab 06\'s seeded overload is optional', () => {
    const optional = Object.keys(TABLE).flatMap((id) => labOf(id).checks.filter((c) => c.optional === true).map((c) => `${id}/${c.id}`))
    expect(optional).toEqual(['batching-scheduler/overload_seeded'])
  })
})
