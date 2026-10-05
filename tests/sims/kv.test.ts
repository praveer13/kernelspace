/**
 * KvCacheSim's five outcome tasks and the pure model behind them (wave-1.md §10.2–10.4, task C8): the contract
 * ids and KCs, every number from a claim (W4), the Run reading and the phone-mode outcome agreeing for each task,
 * the t5.l4 and t5.l5 exercise blocks pointing at registry tasks, and the sim rendering in lab and embed mode.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import KvCacheSim from '../../src/components/sims/KvCacheSim'
import SimHost from '../../src/components/sims/SimHost'
import * as blockTasks from '../../src/components/sims/blockTableExplorer.tasks'
import { KV_TASKS } from '../../src/components/sims/kvCache.tasks'
import { atlasRow } from '../../src/data/atlas'
import { byId, claimNumber } from '../../src/data/claims'
import { KC } from '../../src/data/kc/ids'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { ExerciseBlock } from '../../src/data/lessons/types'
import { gradePrediction, splitCanonical } from '../../src/lib/sims/host'
import {
  BLOCK_SIZE,
  DEFAULT_STATE,
  DTYPES,
  GPUS,
  ITL_SLO_MS,
  PAGED_WASTE_PCT,
  PHONE_MODELS,
  PRESETS,
  READINGS,
  SETUPS,
  STATIC_RESERVE_FACTOR,
  STATIC_UTILIZATION_PCT,
  fmtCtx,
  kvModel,
  normalizeConfig,
  readKey,
  setupMismatches,
  stateFromSetup,
  stateOfPreset,
} from '../../src/lib/sims/models/kv'
import { buildRegistry, resolveTasks } from '../../src/lib/sims/registry'
import type { PredictSpec } from '../../src/lib/sims/types'

const ROOT = join(import.meta.dir, '..', '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

const reg = buildRegistry({ '/src/components/sims/kvCache.tasks.ts': { KV_TASKS } })
const calcTasks = KV_TASKS.filter((t) => t.machine === 'calc')

describe('the five contract tasks (§10.2)', () => {
  test('ids, KCs and the old ids they replace match the spec table', () => {
    const table: Record<string, { kc: string; legacyId?: string }> = {
      'kv.bytes-per-token': { kc: KC.kvBytesPerToken },
      'kv.oom-context': { kc: KC.kvCapacity, legacyId: 'kv-oom' },
      'kv.fp8-rescue': { kc: KC.kvBytesPerToken, legacyId: 'kv-rescue' },
      'kv.gqa': { kc: KC.gqaKvHeads },
      'kv.max-batch': { kc: KC.kvCapacity, legacyId: 'kv-batch' },
    }
    expect(KV_TASKS.map((t) => t.id).sort()).toEqual(Object.keys(table).sort())
    for (const t of KV_TASKS) {
      expect(t.kcs).toEqual([table[t.id].kc as never])
      expect(t.legacyId).toBe(table[t.id].legacyId)
      expect(t.simId).toBe('sim-kv')
      expect(t.kind).toBe('outcome')
      expect(t.machine).toBe('calc')
    }
  })

  test('the registry accepts them: each has predict, observe and explain', () => {
    expect(reg.problems).toEqual([])
    expect(reg.tasks).toHaveLength(5)
    for (const t of KV_TASKS) {
      expect(t.predict).toBeDefined()
      expect(t.observe).toBe(t.id)
      expect(t.explain?.ideas).toHaveLength(3)
      expect(t.title.length).toBeLessThanOrEqual(80)
    }
  })

  test('they list on the calculator machine and not on the block-table machine', () => {
    expect(reg.forSim('sim-kv', 'calc').map((t) => t.id).sort()).toEqual(KV_TASKS.map((t) => t.id).sort())
    expect(reg.forSim('sim-kv', 'blocks')).toEqual([])
  })

  test('the task text never gives the answer away', () => {
    for (const t of KV_TASKS) {
      const answer = readKey(t.observe as string, stateFromSetup(SETUPS[t.observe as string]))
      expect(answer).not.toBeNull()
      const shown = [t.title, t.setup, t.predict && 'prompt' in t.predict ? t.predict.prompt : ''].join(' ')
      const digits = Math.round(answer!.value).toLocaleString('en-US').replace(',', ',?')
      expect(new RegExp(`(^|[^\\d.,])${digits}([^\\d]|$)`).test(shown)).toBe(false)
    }
  })
})

describe('every number comes from a claim (W4)', () => {
  test('a preset is its claims, nothing else', () => {
    const claimed = { 'llama3-8b': 'llama3-8b', 'llama3-70b': 'llama3-70b', 'mixtral-8x7b': 'mixtral-8x7b' } as const
    for (const p of PRESETS) {
      const c = claimed[p.id]
      expect(p.layers).toBe(claimNumber(`model.${c}.layers`))
      expect(p.kvHeads).toBe(claimNumber(`model.${c}.kv-heads`))
      expect(p.attnHeads).toBe(claimNumber(`model.${c}.attn-heads`))
      expect(p.headDim).toBe(claimNumber(`model.${c}.head-dim`))
      expect(p.paramsB).toBe(claimNumber(`model.${c}.params`))
    }
    expect(PRESETS.map((p) => p.id)).toEqual(['llama3-8b', 'llama3-70b', 'mixtral-8x7b'])
  })

  test('a card is its atlas row', () => {
    for (const g of GPUS) {
      const row = atlasRow(g.id)
      expect(g.gb).toBe(row.hbmGb as number)
      expect(g.bandwidthGbps).toBe(row.hbmBwGBs as number)
    }
  })

  test('the tuning constants are claims, and the unsourced ones are marked synthetic', () => {
    expect(BLOCK_SIZE).toBe(claimNumber('production.vllm.block-size'))
    expect(PAGED_WASTE_PCT).toBe(claimNumber('synthetic.kv.paged-waste'))
    expect(ITL_SLO_MS).toBe(claimNumber('synthetic.kv.itl-slo'))
    for (const id of ['synthetic.kv.paged-waste', 'synthetic.kv.runtime-base', 'synthetic.kv.runtime-overhead', 'synthetic.kv.itl-slo']) {
      expect(byId[id].kind).toBe('synthetic')
    }
    // the static-reservation share is the paper's measured range, not a made-up figure
    expect(byId['model.kv.static-utilization-low'].source?.url).toContain('2309.06180')
    expect(byId['model.kv.static-utilization-high'].source?.url).toContain('2309.06180')
    expect(STATIC_UTILIZATION_PCT).toBeGreaterThan(claimNumber('model.kv.static-utilization-low'))
    expect(STATIC_UTILIZATION_PCT).toBeLessThan(claimNumber('model.kv.static-utilization-high'))
    expect(STATIC_RESERVE_FACTOR).toBeCloseTo(100 / STATIC_UTILIZATION_PCT, 10)
  })

  test('no model or hardware literal survives in the sim, the model or the tasks', () => {
    // numbers the old file spelled out: preset shapes, parameter counts, per-card memory and bandwidth, the 4% and 29% figures
    const banned = /\b(70\.6|46\.7|12\.9|8\.03|14336|28672|32000|128256|3350|8000|1008|320|448)\b|paramsB: \d|layers: \d|kvHeads: \d|headDim: \d|gb: \d|PAGED_WASTE_PCT = \d/
    for (const rel of ['src/components/sims/KvCacheSim.tsx', 'src/lib/sims/models/kv.ts', 'src/components/sims/kvCache.tasks.ts']) {
      const code = read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect(code.match(banned)?.[0] ?? null).toBeNull()
    }
  })

  test('the derived parameter counts re-compute from the config claims', () => {
    const n = claimNumber
    const tied = (m: string, ffnShare: number, experts = 1) => {
      const hidden = n(`model.${m}.hidden-size`)
      const kvDim = n(`model.${m}.kv-heads`) * n(`model.${m}.head-dim`)
      const perLayer = 2 * hidden * hidden + 2 * hidden * kvDim + ffnShare * 3 * hidden * n(`model.${m}.ffn-size`) + (experts > 1 ? hidden * experts : 0) + 2 * hidden
      return Math.round((2 * n(`model.${m}.vocab`) * hidden + n(`model.${m}.layers`) * perLayer + hidden) / 1e7) / 100
    }
    expect(n('model.llama3-70b.params')).toBe(tied('llama3-70b', 1))
    expect(n('model.mixtral-8x7b.params')).toBe(tied('mixtral-8x7b', 8, 8))
    expect(n('model.mixtral-8x7b.active-params')).toBe(tied('mixtral-8x7b', 2, 8))
  })
})

describe('the model (KV bytes = 2 × layers × KV heads × head dim × bytes × context × batch)', () => {
  const at = (presetId: (typeof PRESETS)[number]['id'], over: object = {}) => kvModel({ ...DEFAULT_STATE, ...stateOfPreset(presetId), ...over })

  test('bytes per token follow the formula from the preset shape', () => {
    for (const p of PRESETS) {
      for (const d of DTYPES) {
        expect(at(p.id, { kvDtype: d.id }).kvPerToken).toBe(2 * p.layers * p.kvHeads * p.headDim * d.bytes)
      }
    }
    expect(at('llama3-8b').kvPerToken / 1024).toBe(128)
    expect(at('llama3-70b').kvPerToken / 1024).toBe(320)
  })

  test('KV scales with context and batch, and FP8 halves it', () => {
    const base = at('llama3-8b', { ctx: 4096, batch: 1, paged: false, prefixShare: 0 })
    const twice = at('llama3-8b', { ctx: 8192, batch: 2, paged: false, prefixShare: 0 })
    expect(twice.kvUsed / base.kvUsed).toBeCloseTo(4, 10)
    expect(at('llama3-8b', { kvDtype: 'fp8' }).kvUsed / at('llama3-8b').kvUsed).toBeCloseTo(0.5, 10)
  })

  test('paging wastes a little, static reservation wastes most of it', () => {
    const paged = at('llama3-8b', { paged: true })
    const fixed = at('llama3-8b', { paged: false })
    expect(paged.kvReserved / paged.kvUsed).toBeCloseTo(1 + PAGED_WASTE_PCT / 100, 10)
    expect(fixed.kvReserved / fixed.kvUsed).toBeCloseTo(STATIC_RESERVE_FACTOR, 10)
    expect(fixed.maxBatch).toBeLessThan(paged.maxBatch)
  })

  test('maxBatch and maxCtx are consistent: one more sequence, or a longer context, would not fit', () => {
    const s = stateFromSetup(SETUPS['kv.max-batch'])
    const fits = (n: number) => !kvModel({ ...s, batch: n, prefixShare: 0 }).oom
    const r = kvModel(s)
    expect(r.maxBatch).toBeGreaterThan(0)
    expect(fits(r.maxBatch)).toBe(true)
    expect(fits(r.maxBatch + 1)).toBe(false)
    const o = stateFromSetup(SETUPS['kv.oom-context'])
    const m = kvModel(o)
    expect(kvModel({ ...o, ctx: m.maxCtx }).oom).toBe(false)
    expect(kvModel({ ...o, ctx: m.maxCtx + 64 }).oom).toBe(true)
  })

  test('a model whose weights do not fit leaves nothing for the cache', () => {
    const r = at('llama3-70b', { weightDtype: 'fp16', gpuId: 'h100', gpuCount: 1 })
    expect(r.oom).toBe(true)
    expect(r.maxBatch).toBe(0)
    expect(r.maxCtx).toBe(0)
  })

  test('the slider labels read in the units lessons use', () => {
    expect(fmtCtx(1024)).toBe('1k')
    expect(fmtCtx(32768)).toBe('32k')
    expect(fmtCtx(131072)).toBe('128k')
    expect(fmtCtx(200000)).toBe('200k')
    expect(fmtCtx(1048576)).toBe('1M')
    expect(fmtCtx(512)).toBe('512')
  })
})

describe('a task\'s answer: Run reads it off the setup, and phone mode draws the same one', () => {
  test('every task has a reading, a setup and a phone model, under one key', () => {
    for (const t of KV_TASKS) {
      expect(READINGS.some((r) => r.key === t.observe)).toBe(true)
      expect(SETUPS[t.observe as string]).toBeDefined()
      const parts = splitCanonical(t.phone?.canonical ?? '')
      expect(parts?.model).toBe('kv')
      expect(PHONE_MODELS[parts?.name ?? '']).toBeDefined()
    }
    expect(READINGS).toHaveLength(5)
    expect(Object.keys(PHONE_MODELS)).toHaveLength(5)
  })

  test('the phone outcome equals the Run reading for the same task', () => {
    for (const t of KV_TASKS) {
      const reading = readKey(t.observe as string, stateFromSetup(SETUPS[t.observe as string]))
      const phone = PHONE_MODELS[splitCanonical(t.phone?.canonical as string)?.name as string]()
      expect(phone.actual).toBe(reading?.value as number)
      expect(phone.unit).toBe(reading?.unit as string)
    }
  })

  test('a phone outcome is a chart with a marked point and a table of the same rows', () => {
    for (const make of Object.values(PHONE_MODELS)) {
      const o = make()
      expect(o.chart.points.length).toBeGreaterThanOrEqual(2)
      expect(o.chart.mark).toBeGreaterThanOrEqual(0)
      expect(o.chart.mark).toBeLessThan(o.chart.points.length)
      expect(o.table.rows.length).toBe(o.chart.points.length)
      for (const row of o.table.rows) expect(row).toHaveLength(o.table.columns.length)
      expect(o.summary.length).toBeGreaterThan(20)
      expect(Number.isFinite(o.actual as number)).toBe(true)
      for (const p of o.chart.points) expect(Number.isFinite(p.y)).toBe(true)
    }
  })

  test('the right answer grades correct and a wrong one does not, so the task can be failed', () => {
    for (const t of KV_TASKS) {
      const spec = t.predict as PredictSpec
      const actual = readKey(t.observe as string, stateFromSetup(SETUPS[t.observe as string]))!.value
      expect(gradePrediction(spec, { value: actual }, actual)?.ok).toBe(true)
      expect(gradePrediction(spec, { value: actual * 8 }, actual)?.ok).toBe(false)
      expect(gradePrediction(spec, { value: actual / 8 }, actual)?.ok).toBe(false)
    }
  })

  test('a hand calculation that skips the runtime scratch and paging still lands inside the tolerance', () => {
    const GB = 1e9
    const bytes = (layers: number, heads: number, dim: number, b: number) => 2 * layers * heads * dim * b
    const p70 = PRESETS[1]
    const fp8 = bytes(p70.layers, p70.kvHeads, p70.headDim, 1)
    const naive = Math.floor((4 * 80 - p70.paramsB) / ((fp8 * 32768) / GB))
    const spec = KV_TASKS.find((t) => t.id === 'kv.fp8-rescue')?.predict as PredictSpec
    const actual = readKey('kv.fp8-rescue', stateFromSetup(SETUPS['kv.fp8-rescue']))!.value
    expect(gradePrediction(spec, { value: naive }, actual)?.ok).toBe(true)
  })

  test('the setups pin what the answer depends on, so a wrong control cannot send a reading', () => {
    const ok = stateFromSetup(SETUPS['kv.fp8-rescue'])
    expect(setupMismatches(ok, SETUPS['kv.fp8-rescue'])).toEqual([])
    const wrong = setupMismatches({ ...ok, kvDtype: 'fp16', gpuCount: 2 }, SETUPS['kv.fp8-rescue'])
    expect(wrong).toEqual(expect.arrayContaining(['KV precision: FP8', 'GPU count: 4']))
    // a preset task does not compare the shape controls; a custom one does
    expect(setupMismatches({ ...ok, layers: 1 }, SETUPS['kv.fp8-rescue'])).toEqual([])
    const custom = stateFromSetup(SETUPS['kv.gqa'])
    expect(setupMismatches({ ...custom, kvHeads: 8 }, SETUPS['kv.gqa'])).toEqual(['KV heads: 32'])
  })

  test('only one setup answers each reading, so the readings of two tasks never both fire on one press', () => {
    const states = KV_TASKS.map((t) => ({ id: t.id, s: stateFromSetup(SETUPS[t.observe as string]) }))
    for (const a of states) {
      const fired = KV_TASKS.filter((t) => setupMismatches(a.s, SETUPS[t.observe as string]).length === 0).map((t) => t.id)
      expect(fired).toContain(a.id)
    }
  })

  test('the explanations quote the model, so they cannot drift from it', () => {
    const t = KV_TASKS.find((x) => x.id === 'kv.bytes-per-token')!
    expect(t.explain?.model).toContain('320 KiB')
    const g = KV_TASKS.find((x) => x.id === 'kv.gqa')!
    expect(g.explain?.model).toContain('4×')
  })
})

describe('config from a lesson block or a link', () => {
  test('nothing, junk and a stale link all open the default calculator', () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_STATE)
    expect(normalizeConfig(null)).toEqual(DEFAULT_STATE)
    expect(normalizeConfig('x')).toEqual(DEFAULT_STATE)
    expect(normalizeConfig({ presetId: 'gpt-9', ctx: 'big', gpuId: 'tpu' })).toEqual(DEFAULT_STATE)
  })

  test('a preset fills in its shape; context and batch snap to a slider stop', () => {
    const s = normalizeConfig({ presetId: 'llama3-70b', ctx: 30000, batch: 3, kvDtype: 'fp8' })
    expect(s).toMatchObject({ presetId: 'llama3-70b', layers: PRESETS[1].layers, ctx: 32768, batch: 2, kvDtype: 'fp8' })
  })

  test('a custom shape is clamped to the slider ranges', () => {
    const s = normalizeConfig({ presetId: 'custom', layers: 4000, kvHeads: 0, headDim: 1 })
    expect(s).toMatchObject({ presetId: 'custom', layers: 128, kvHeads: 1, headDim: 64 })
  })
})

describe('the lessons point at registry tasks', () => {
  const exercises = (lessonId: string) =>
    (ALL_LESSONS.find((l) => l.id === lessonId)?.blocks ?? []).filter((b): b is ExerciseBlock => b.type === 'exercise')

  test('t5.l4 lists the five outcome tasks, all on the calculator, in an order that builds', () => {
    const [block] = exercises('t5.l4')
    expect(block.simId).toBe('sim-kv')
    expect(block.machine).toBe('calc')
    expect(block.taskIds).toEqual(['kv.bytes-per-token', 'kv.gqa', 'kv.oom-context', 'kv.fp8-rescue', 'kv.max-batch'])
    expect(resolveTasks('sim-kv', block.machine, block.taskIds, reg).map((t) => t.id)).toEqual(block.taskIds as string[])
    for (const t of KV_TASKS) expect(t.lessons).toEqual(['t5.l4'])
  })

  test('t5.l5 lists the block-table tasks it always had, now with live completion', () => {
    const [block] = exercises('t5.l5')
    expect(block.machine).toBe('blocks')
    expect(block.taskIds).toEqual(['t-blk-share', 't-blk-cow', 't-blk-preempt', 't-blk-sweep'])
    // the registry knows these from blockTableExplorer.tasks.ts (loaded the way the app loads it)
    const full = buildRegistry({
      '/src/components/sims/blockTableExplorer.tasks.ts': blockTasks,
      '/src/components/sims/kvCache.tasks.ts': { KV_TASKS },
    })
    expect(full.problems).toEqual([])
    expect(resolveTasks('sim-kv', block.machine, block.taskIds, full).map((t) => t.id)).toEqual(block.taskIds as string[])
  })

  test('the exported task list still describes the five tasks (public/lessons-md is generated from it)', () => {
    const [block] = exercises('t5.l4')
    expect(block.tasks).toHaveLength(calcTasks.length)
    for (const line of block.tasks) expect(line.startsWith('Predict')).toBe(true)
  })
})

describe('the sim renders', () => {
  const html = (el: ReturnType<typeof createElement>, url: string) => renderToString(createElement(MemoryRouter, { initialEntries: [url] }, el))

  test('lab mode: the calculator, with its presets from the claims', () => {
    const markup = html(createElement(KvCacheSim), '/lab/sim-kv?machine=calc')
    expect(markup).toContain('KV-Cache Calculator')
    for (const p of PRESETS) expect(markup).toContain(p.name)
    expect(markup).toContain('per-token cost')
  })

  test('lab mode: the block-table machine opens from a t5.l5 link', () => {
    const markup = html(createElement(KvCacheSim), '/lab/sim-kv?from=t5.l5')
    expect(markup).toContain('KV Block-Table Explorer')
  })

  test('embed mode renders inside SimHost without a URL', () => {
    const markup = html(
      createElement(SimHost, { simId: 'sim-kv', mode: 'embed', machine: 'calc', config: { presetId: 'llama3-70b', kvDtype: 'fp8' } }, createElement(KvCacheSim)),
      '/lesson/t5.l4',
    )
    expect(markup).toContain('Llama-3-70B')
  })
})
