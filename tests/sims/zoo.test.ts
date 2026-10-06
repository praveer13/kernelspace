/**
 * The Attention Zoo machine (wave-2.md §11.4, task 2b-13): the six outcome tasks' contract ids and KCs, the Run
 * reading and the phone-mode outcome agreeing for each, kv-zoo's preset numbers against the second reader's fixture
 * (tests/fixtures/zoo/second-reader.json, §11.3), the paste box's named errors, the context steps, the chart with
 * its table mirror, and the machine rendering in lab and embed mode.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import KvCacheSim from '../../src/components/sims/KvCacheSim'
import SimHost from '../../src/components/sims/SimHost'
import ZooChart from '../../src/components/sims/ZooChart'
import { ZOO_TASKS } from '../../src/components/sims/kvZoo.tasks'
import { byId } from '../../src/data/claims'
import { KC } from '../../src/data/kc/ids'
import { ZOO_CONTEXTS, ZOO_PRESETS, layerBytes, zooBytes, zooPresetById } from '../../src/lib/kv-zoo'
import { gradePrediction, splitCanonical } from '../../src/lib/sims/host'
import {
  BASELINE_ID,
  CUSTOM_ID,
  DEFAULT_ZOO_STATE,
  PHONE_MODELS,
  READINGS,
  SETUPS,
  ZOO_CONFIG_MAX_CHARS,
  ZOO_CTX_STEPS,
  baselineRatio,
  fmtBytes,
  fmtCtx,
  groupRows,
  normalizeZooConfig,
  pasteStatus,
  prefixReuse,
  readSetup,
  readVsStored,
  setupMismatches,
  zooMirror,
} from '../../src/lib/sims/models/zoo'
import { PENDING_TASK_IDS, buildRegistry } from '../../src/lib/sims/registry'
import type { PredictSpec } from '../../src/lib/sims/types'
import fixture from '../fixtures/zoo/second-reader.json'

const reg = buildRegistry({ '/src/components/sims/kvZoo.tasks.ts': { ZOO_TASKS } })
const preset = (id: string) => {
  const m = zooPresetById(id)
  if (!m) throw new Error(`no preset ${id}`)
  return m
}

/* ------------------------------------------------------------------ */
/* The six contract tasks                                              */
/* ------------------------------------------------------------------ */

describe('the six contract tasks (§11.4)', () => {
  const TABLE: Record<string, { kc: string; kind: 'numeric' | 'choice' }> = {
    'zoo.mla-ratio': { kc: KC.attentionVariants, kind: 'numeric' },
    'zoo.swa-flat': { kc: KC.attentionVariants, kind: 'numeric' },
    'zoo.dsa-reads': { kc: KC.kvReadsVsCapacity, kind: 'choice' },
    'zoo.linear-state': { kc: KC.attentionVariants, kind: 'numeric' },
    'zoo.hybrid-share': { kc: KC.attentionVariants, kind: 'numeric' },
    'zoo.gdn-prefix': { kc: KC.kvReadsVsCapacity, kind: 'choice' },
  }

  test('ids, KCs and prediction kinds match the spec table, on the zoo machine of sim-kv', () => {
    expect(ZOO_TASKS.map((t) => t.id).sort()).toEqual(Object.keys(TABLE).sort())
    for (const t of ZOO_TASKS) {
      expect(t.kcs).toEqual([TABLE[t.id].kc as never])
      expect(t.predict?.kind).toBe(TABLE[t.id].kind)
      expect(t.simId).toBe('sim-kv')
      expect(t.machine).toBe('zoo')
      expect(t.kind).toBe('outcome')
      expect(t.legacyId).toBeUndefined()
    }
  })

  test('numeric predictions are log-scored (§11.4), choices have distinct options', () => {
    for (const t of ZOO_TASKS) {
      const p = t.predict as PredictSpec
      if (p.kind === 'numeric') {
        expect(p.log, t.id).toBe(true)
        expect(p.unit.length).toBeGreaterThan(0)
      } else {
        expect(new Set(p.options.map((o) => o.id)).size).toBe(p.options.length)
        expect(p.options.length).toBeGreaterThanOrEqual(2)
      }
    }
  })

  test('the registry accepts them, and lists them on the zoo machine only', () => {
    expect(reg.problems).toEqual([])
    expect(reg.tasks).toHaveLength(6)
    for (const t of ZOO_TASKS) {
      expect(t.observe).toBe(t.id)
      expect(t.explain?.ideas).toHaveLength(3)
      expect(t.title.length).toBeLessThanOrEqual(80)
      expect(t.lessons).toEqual(['t5.l4'])
    }
    expect(reg.forSim('sim-kv', 'zoo').map((t) => t.id).sort()).toEqual(Object.keys(TABLE).sort())
    expect(reg.forSim('sim-kv', 'calc')).toEqual([])
    expect(reg.forSim('sim-kv', 'blocks')).toEqual([])
  })

  test('the six ids left PENDING_TASK_IDS, because they are registered now', () => {
    expect(PENDING_TASK_IDS).toEqual([])
    for (const id of Object.keys(TABLE)) expect(reg.byId(id)?.id).toBe(id)
  })

  test('the task text never gives the answer away', () => {
    for (const t of ZOO_TASKS) {
      const answer = readSetup(t.observe as string)?.value
      expect(answer).toBeDefined()
      if (typeof answer !== 'number' || answer < 10) continue
      const shown = [t.title, t.setup, t.predict && 'prompt' in t.predict ? t.predict.prompt : ''].join(' ')
      const spelled = [String(answer), Math.round(answer).toLocaleString('en-US')]
      for (const s of spelled) expect(new RegExp(`(^|[^\\d.,])${s.replace('.', '\\.')}([^\\d]|$)`).test(shown), `${t.id}: ${s}`).toBe(false)
    }
  })

  test('the explanations quote the model, so they cannot drift from it', () => {
    const text = (id: string) => ZOO_TASKS.find((t) => t.id === id)?.explain?.model ?? ''
    expect(text('zoo.mla-ratio')).toContain('327,680')
    expect(text('zoo.mla-ratio')).toContain('70,272')
    expect(text('zoo.mla-ratio')).toContain(`${baselineRatio(preset('deepseek-v3'), 1024)}×`)
    expect(text('zoo.hybrid-share')).toContain(`${readSetup('zoo.hybrid-share')?.value}%`)
    expect(text('zoo.linear-state')).toContain('1 MiB')
    expect(text('zoo.swa-flat')).toContain('128 tokens')
  })
})

/* ------------------------------------------------------------------ */
/* Run readings and the phone model agree                              */
/* ------------------------------------------------------------------ */

describe("a task's answer: Run reads it off the setup, and phone mode draws the same one", () => {
  test('every task has a reading, a setup and a phone model, under one key', () => {
    for (const t of ZOO_TASKS) {
      expect(READINGS.some((r) => r.key === t.observe)).toBe(true)
      expect(SETUPS[t.observe as string]).toBeDefined()
      const parts = splitCanonical(t.phone?.canonical ?? '')
      expect(parts?.model).toBe('zoo')
      expect(PHONE_MODELS[parts?.name ?? '']).toBeDefined()
      expect(`zoo.${parts?.name}`).toBe(t.id)
    }
    expect(READINGS).toHaveLength(6)
    expect(Object.keys(PHONE_MODELS)).toHaveLength(6)
  })

  test('the phone outcome equals the Run reading for the same task', () => {
    for (const t of ZOO_TASKS) {
      const reading = readSetup(t.observe as string)
      const phone = PHONE_MODELS[splitCanonical(t.phone?.canonical as string)?.name as string]()
      expect(phone.actual).toBe(reading?.value as number | string)
    }
  })

  test('a phone outcome is a chart with a marked point and a table of the same rows', () => {
    for (const make of Object.values(PHONE_MODELS)) {
      const o = make()
      expect(o.chart.points.length).toBeGreaterThanOrEqual(2)
      expect(o.chart.mark).toBeGreaterThanOrEqual(0)
      expect(o.chart.mark).toBeLessThan(o.chart.points.length)
      expect(o.table.rows.length).toBeGreaterThanOrEqual(2)
      for (const row of o.table.rows) expect(row).toHaveLength(o.table.columns.length)
      expect(o.summary.length).toBeGreaterThan(20)
      for (const p of o.chart.points) expect(Number.isFinite(p.y)).toBe(true)
    }
    // the bar charts have one bar per table row
    for (const name of ['mla-ratio', 'dsa-reads', 'hybrid-share', 'gdn-prefix']) {
      const o = PHONE_MODELS[name]()
      expect(o.chart.kind).toBe('bars')
    }
    const swa = PHONE_MODELS['swa-flat']()
    expect(swa.chart.points).toHaveLength(swa.table.rows.length)
    expect(swa.chart.logX).toBe(true)
  })

  test('the right answer grades correct and a wrong one does not, so the task can be failed', () => {
    for (const t of ZOO_TASKS) {
      const spec = t.predict as PredictSpec
      const actual = readSetup(t.observe as string)!.value
      if (spec.kind === 'choice') {
        expect(gradePrediction(spec, { choice: String(actual) }, actual)?.ok, t.id).toBe(true)
        const other = spec.options.find((o) => o.id !== actual)!
        expect(gradePrediction(spec, { choice: other.id }, actual)?.ok, t.id).toBe(false)
      } else {
        const a = actual as number
        expect(gradePrediction(spec, { value: a }, a)?.ok, t.id).toBe(true)
        expect(gradePrediction(spec, { value: a * 8 }, a)?.ok, t.id).toBe(false)
        expect(gradePrediction(spec, { value: a / 8 }, a)?.ok, t.id).toBe(false)
      }
    }
  })

  test('the answers are the arithmetic of the presets, worked by hand', () => {
    const llama = zooBytes(preset('llama3-70b'), 1).stored
    const v3 = zooBytes(preset('deepseek-v3'), 1).stored
    expect(readSetup('zoo.mla-ratio')?.value).toBe(Math.round((llama / v3) * 100) / 100)
    expect(llama / v3).toBeGreaterThan(4.6)
    expect(llama / v3).toBeLessThan(4.7)
    // gpt-oss: the window (128) and no sink tokens
    expect(readSetup('zoo.swa-flat')?.value).toBe(128)
    // DeepSeek-V3.2 at 128k: reads are several times smaller than stored, because the indexer's keys are read in full
    const z = zooBytes(preset('deepseek-v3-2'), 131072)
    expect(z.read * 4).toBeLessThan(z.stored)
    expect(readSetup('zoo.dsa-reads')?.value).toBe('reads-less')
    // a linear layer's state does not depend on the context
    expect(readSetup('zoo.linear-state')?.value).toBe(1)
    // Kimi Linear at 128k: 7 MLA layers · 1,152 B · 131,072 against 20 KDA layers · 1 MiB
    const mla = 7 * 1152 * 131072
    const kda = 20 * 1024 * 1024
    expect(readSetup('zoo.hybrid-share')?.value).toBe(Math.round((mla / (mla + kda)) * 10000) / 100)
    expect(readSetup('zoo.gdn-prefix')?.value).toBe('no')
  })

  test('a hand calculation lands inside the log tolerance (a factor of two)', () => {
    const spec = (id: string) => ZOO_TASKS.find((t) => t.id === id)?.predict as PredictSpec
    // 80 layers · 2 · 8 · 128 · 2 B against 61 layers · 576 · 2 B
    const naive = (80 * 4096) / (61 * 1152)
    expect(gradePrediction(spec('zoo.mla-ratio'), { value: naive }, readSetup('zoo.mla-ratio')!.value as number)?.ok).toBe(true)
    // "a typical 4,096-token window" is a factor of 32 off gpt-oss's 128 and fails
    expect(gradePrediction(spec('zoo.swa-flat'), { value: 4096 }, 128)?.ok).toBe(false)
    // thinking "7 of 27 layers" is 26%, which is a factor of nearly four off 98%; "nearly all" lands inside a factor of two
    const share = readSetup('zoo.hybrid-share')!.value as number
    expect(gradePrediction(spec('zoo.hybrid-share'), { value: (7 / 27) * 100 }, share)?.ok).toBe(false)
    expect(gradePrediction(spec('zoo.hybrid-share'), { value: 95 }, share)?.ok).toBe(true)
  })

  test('the setups pin what the answer depends on, so a wrong control cannot send a reading', () => {
    const ok = { presetId: 'deepseek-v3-2', ctx: 131072 }
    expect(setupMismatches(ok, SETUPS['zoo.dsa-reads'])).toEqual([])
    expect(setupMismatches({ presetId: 'deepseek-v3-2', ctx: 1024 }, SETUPS['zoo.dsa-reads'])).toEqual(['context: 128k'])
    expect(setupMismatches({ presetId: 'llama3-70b', ctx: 1024 }, SETUPS['zoo.dsa-reads'])).toEqual(['model: DeepSeek-V3.2', 'context: 128k'])
    expect(setupMismatches({ presetId: CUSTOM_ID, ctx: 131072 }, SETUPS['zoo.mla-ratio'])).toEqual(['model: DeepSeek-V3'])
    // a free context is not compared
    expect(setupMismatches({ presetId: 'deepseek-v3', ctx: 1024 }, SETUPS['zoo.mla-ratio'])).toEqual([])
  })

  test('each setup fires its own reading on Run, and the one overlap is Kimi Linear firing two', () => {
    const fired = (presetId: string, ctx: number) =>
      ZOO_TASKS.filter((t) => setupMismatches({ presetId, ctx }, SETUPS[t.observe as string]).length === 0).map((t) => t.id)
    for (const t of ZOO_TASKS) {
      const s = SETUPS[t.observe as string]
      const out = fired(s.presetId, s.ctx ?? DEFAULT_ZOO_STATE.ctx)
      const expected = s.presetId === 'kimi-linear' && (s.ctx ?? DEFAULT_ZOO_STATE.ctx) === 131072 ? ['zoo.hybrid-share', 'zoo.linear-state'] : [t.id]
      expect([...out].sort(), t.id).toEqual(expected)
    }
  })

  test('every setup names a preset, and its model reports a value', () => {
    for (const [key, s] of Object.entries(SETUPS)) {
      expect(zooPresetById(s.presetId), key).toBeDefined()
      expect(readSetup(key), key).not.toBeNull()
    }
    expect(readSetup('zoo.nope')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* kv-zoo against the second reader (§11.3)                            */
/* ------------------------------------------------------------------ */

describe("kv-zoo's preset numbers against the second reader's fixture", () => {
  interface FixtureContext {
    stored: number
    readMain: number
    readIndexer: number
    readTotal: number
  }
  interface FixtureModel {
    repo: string
    revision: string
    bytesPerToken: number
    constantBytes: number
    fields: Record<string, number>
    contexts: Record<string, FixtureContext>
  }
  const models = fixture.models as unknown as FixtureModel[]
  const IDS = ['llama3-70b', 'deepseek-v3', 'gpt-oss-120b', 'qwen3-5-397b', 'kimi-linear', 'deepseek-v3-2', 'deepseek-v4-pro']
  /** The preset a fixture model describes, found by the claim pin it was built from. */
  const presetOf = (f: FixtureModel) => {
    const id = ZOO_PRESETS.find((p) => p.claimIds.some((c) => byId[c].pin?.repo === f.repo))?.id
    if (!id) throw new Error(`no preset for ${f.repo}`)
    return preset(id)
  }

  test('the fixture covers the seven presets at the four contexts the model pins', () => {
    expect(models.map((f) => presetOf(f).id)).toEqual(IDS)
    expect(fixture.contexts).toEqual([...ZOO_CONTEXTS])
    expect(IDS).toEqual(ZOO_PRESETS.map((p) => p.id))
  })

  test('both read the same revision of every config', () => {
    for (const f of models) {
      const p = presetOf(f)
      const pinned = p.claimIds.map((c) => byId[c].pin).filter((x) => x !== undefined)
      expect(pinned.length, p.id).toBeGreaterThan(0)
      for (const pin of pinned) expect(pin?.ref, p.id).toBe(f.revision)
    }
  })

  /** Qwen3.5's linear state, priced at four bytes by the fixture and at the KV dtype by kv-zoo (see below); zero for the rest. */
  const dtypeShift = (f: FixtureModel): number =>
    f.fields.stateBytesPerLinearLayerAtBf16 === undefined
      ? 0
      : f.fields.linear_layers * (f.fields.stateBytesPerLinearLayerAtBf16 - f.fields.stateBytesPerLinearLayer)

  test('bytes read per decode step equal the fixture exactly for six presets, and Qwen3.5 by its state dtype', () => {
    for (const f of models) {
      const p = presetOf(f)
      for (const t of fixture.contexts) expect(zooBytes(p, t).read, `${p.id} at ${t}`).toBe(f.contexts[String(t)].readTotal + dtypeShift(f))
    }
  })

  test('bytes stored equal the fixture exactly for the four presets with no convention to settle', () => {
    for (const f of models) {
      const p = presetOf(f)
      if (!['llama3-70b', 'deepseek-v3', 'gpt-oss-120b', 'kimi-linear'].includes(p.id)) continue
      for (const t of fixture.contexts) expect(zooBytes(p, t).stored, `${p.id} at ${t}`).toBe(f.contexts[String(t)].stored)
    }
  })

  // Two conventions differ, and both are the fixture's own named fields rather than a tolerance.
  //  1. The fixture's `stored` leaves out a sparse indexer's keys and lists what the indexer reads as `readIndexer`.
  //     kv-zoo stores those keys, because a step cannot read what is not stored (read <= stored): its capacity is
  //     the fixture's `stored + readIndexer`. This is DeepSeek-V3.2 and DeepSeek-V4-Pro.
  //  2. Qwen3.5's config names its linear state float32 (`mamba_ssm_dtype`); the fixture prices that state at four
  //     bytes, kv-zoo at the KV dtype (BF16, two). The fixture gives the BF16 state beside it
  //     (`stateBytesPerLinearLayerAtBf16`), which is what kv-zoo holds.
  test('bytes stored equal the fixture plus its two named conventions, exactly', () => {
    for (const f of models) {
      const p = presetOf(f)
      for (const t of fixture.contexts) {
        const c = f.contexts[String(t)]
        expect(zooBytes(p, t).stored, `${p.id} at ${t}`).toBe(c.stored + c.readIndexer + dtypeShift(f))
      }
    }
  })

  test('only DeepSeek-V3.2, DeepSeek-V4-Pro and Qwen3.5 differ from the fixture without a convention, and each by its named field', () => {
    const differs = models
      .filter((f) => {
        const p = presetOf(f)
        return fixture.contexts.some((t) => zooBytes(p, t).stored !== f.contexts[String(t)].stored)
      })
      .map((f) => presetOf(f).id)
    expect(differs).toEqual(['qwen3-5-397b', 'deepseek-v3-2', 'deepseek-v4-pro'])
  })

  test('bytes per token agree where a model has no constant part or indexer', () => {
    for (const f of models) {
      const p = presetOf(f)
      if (f.constantBytes !== 0 || f.contexts['1024'].readIndexer !== 0) continue
      expect(zooBytes(p, 1).stored, p.id).toBe(f.bytesPerToken)
    }
  })

  test('the machine shows the fixture numbers: its table mirror at each pinned context', () => {
    for (const f of models) {
      const p = presetOf(f)
      if (f.contexts['1024'].readIndexer !== 0 || f.fields.stateBytesPerLinearLayerAtBf16 !== undefined) continue
      const table = zooMirror(p, DEFAULT_ZOO_STATE.ctx, null)
      for (const t of fixture.contexts) {
        const row = table.rows[ZOO_CTX_STEPS.indexOf(t)]
        expect(row[0]).toBe(fmtCtx(t))
        expect(row[1]).toBe(fmtBytes(f.contexts[String(t)].stored))
        expect(row[2]).toBe(fmtBytes(f.contexts[String(t)].readTotal))
      }
    }
  })
})

/* ------------------------------------------------------------------ */
/* The model: steps, groups, the paste box                             */
/* ------------------------------------------------------------------ */

describe('the zoo machine model', () => {
  test('context steps run from 1k to 1M in powers of two, and include the four pins', () => {
    expect(ZOO_CTX_STEPS[0]).toBe(1024)
    expect(ZOO_CTX_STEPS[ZOO_CTX_STEPS.length - 1]).toBe(1048576)
    for (let i = 1; i < ZOO_CTX_STEPS.length; i++) expect(ZOO_CTX_STEPS[i]).toBe(ZOO_CTX_STEPS[i - 1] * 2)
    for (const t of ZOO_CONTEXTS) expect(ZOO_CTX_STEPS).toContain(t)
    expect(ZOO_CTX_STEPS.map(fmtCtx)).toEqual(['1k', '2k', '4k', '8k', '16k', '32k', '64k', '128k', '256k', '512k', '1M'])
  })

  test('bytes are formatted in binary units', () => {
    expect(fmtBytes(327680)).toBe('320 KiB')
    expect(fmtBytes(343597383680)).toBe('320 GiB')
    expect(fmtBytes(1024 * 1024)).toBe('1 MiB')
    expect(fmtBytes(1.5 * 1024 * 1024)).toBe('1.50 MiB')
    expect(fmtBytes(0)).toBe('0 B')
  })

  test('a config from a lesson block or a link snaps to a step, and ignores anything else', () => {
    expect(normalizeZooConfig(undefined)).toEqual(DEFAULT_ZOO_STATE)
    expect(normalizeZooConfig('x')).toEqual(DEFAULT_ZOO_STATE)
    expect(normalizeZooConfig({ presetId: 'gpt-9', ctx: 'big' })).toEqual(DEFAULT_ZOO_STATE)
    expect(normalizeZooConfig({ presetId: CUSTOM_ID })).toEqual(DEFAULT_ZOO_STATE)
    expect(normalizeZooConfig({ presetId: 'kimi-linear', ctx: 100000 })).toEqual({ presetId: 'kimi-linear', ctx: 131072 })
    expect(DEFAULT_ZOO_STATE.presetId).toBe(BASELINE_ID)
  })

  test("a group's rows add up to the model, and the shares to a hundred percent", () => {
    for (const p of ZOO_PRESETS) {
      for (const t of ZOO_CTX_STEPS) {
        const z = zooBytes(p, t)
        const rows = groupRows(p, t)
        expect(rows.reduce((n, r) => n + r.stored, 0)).toBe(z.stored)
        expect(rows.reduce((n, r) => n + r.read, 0)).toBe(z.read)
        expect(Math.abs(rows.reduce((n, r) => n + r.share, 0) - 100)).toBeLessThan(0.1)
      }
    }
  })

  test('what a prefix hit can reuse, by layer kind', () => {
    const kinds = Object.fromEntries(ZOO_PRESETS.flatMap((p) => p.groups.map((g) => [g.layer.kind, prefixReuse(g.layer)] as const)))
    expect(kinds).toEqual({
      full: 'any-prefix',
      mla: 'any-prefix',
      swa: 'window-only',
      linear: 'whole-sequence',
      dsa: 'any-prefix',
      hca: 'entry-aligned',
      csa: 'entry-aligned',
    })
    expect(layerBytes({ kind: 'linear', heads: 1, keyDim: 2, valueDim: 3 }, 1).stored).toBe(layerBytes({ kind: 'linear', heads: 1, keyDim: 2, valueDim: 3 }, 1 << 20).stored)
  })

  test('reads against stored', () => {
    expect(readVsStored(10, 10)).toBe('same')
    expect(readVsStored(6, 10)).toBe('same')
    expect(readVsStored(5, 10)).toBe('reads-less')
    expect(readVsStored(11, 10)).toBe('stored-less')
  })

  test('the baseline against itself is one, and MLA is the same ratio at every context', () => {
    for (const t of ZOO_CTX_STEPS) {
      expect(baselineRatio(preset(BASELINE_ID), t)).toBe(1)
      expect(baselineRatio(preset('deepseek-v3'), t)).toBe(baselineRatio(preset('deepseek-v3'), 1024))
    }
  })

  test('the paste box: empty, a readable config, and the reader\'s named errors', () => {
    expect(pasteStatus('   ').state).toBe('empty')
    const ok = pasteStatus('{"num_hidden_layers": 32, "num_key_value_heads": 8, "num_attention_heads": 32, "hidden_size": 4096}')
    expect(ok.state).toBe('ok')
    if (ok.state === 'ok') expect(zooBytes(ok.model, 1).stored).toBe(32 * 2 * 8 * 128 * 2)
    const junk = pasteStatus('not json')
    expect(junk).toMatchObject({ state: 'error' })
    const missing = pasteStatus('{"num_hidden_layers": 32}')
    expect(missing).toMatchObject({ state: 'error', field: 'num_attention_heads' })
    if (missing.state === 'error') expect(missing.message).toContain('num_attention_heads')
    const unknown = pasteStatus('{"num_hidden_layers": 2, "num_attention_heads": 4, "hidden_size": 8, "layer_types": ["full_attention", "mamba"]}')
    expect(unknown).toMatchObject({ state: 'error', field: 'mamba' })
    if (unknown.state === 'error') expect(unknown.message).toBe('this config has a layer type the zoo cannot read yet: mamba')
    const long = pasteStatus(' '.repeat(ZOO_CONFIG_MAX_CHARS) + '{}')
    expect(long.state).toBe('error')
  })

  test("a pasted config is the same as the preset it quotes: Llama-3-70B's own shape reads to 327,680 B/token", () => {
    const parsed = pasteStatus('{"num_hidden_layers": 80, "num_key_value_heads": 8, "num_attention_heads": 64, "hidden_size": 8192}')
    expect(parsed.state).toBe('ok')
    if (parsed.state === 'ok') expect(zooBytes(parsed.model, 1).stored).toBe(zooBytes(preset(BASELINE_ID), 1).stored)
  })
})

/* ------------------------------------------------------------------ */
/* The chart and the machine render                                    */
/* ------------------------------------------------------------------ */

describe('the chart', () => {
  const html = (model: string, ctx = 131072) =>
    renderToString(createElement(ZooChart, { model: preset(model), baseline: model === BASELINE_ID ? null : preset(BASELINE_ID), ctx }))

  test('two SVG curves, an image role pointing at its table mirror, and no canvas', () => {
    const markup = html('deepseek-v3-2')
    expect(markup).toContain('<svg')
    expect(markup).not.toContain('<canvas')
    expect(markup).toContain('role="img"')
    expect((markup.match(/<polyline/g) ?? []).length).toBe(3) // stored, read and the baseline's capacity
    const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(describedBy).toBeDefined()
    expect(markup).toContain(`id="${describedBy}"`)
  })

  test('the mirror table lists both curves at every context step', () => {
    const markup = html('deepseek-v3-2')
    for (const t of ZOO_CTX_STEPS) expect(markup).toContain(`>${fmtCtx(t)}</th>`)
    const z = zooBytes(preset('deepseek-v3-2'), 131072)
    expect(markup).toContain(fmtBytes(z.stored))
    expect(markup).toContain(fmtBytes(z.read))
    expect(markup).toContain('Read per step')
  })

  test('the baseline draws no reference curve of its own, and says when the curves coincide', () => {
    const markup = html(BASELINE_ID)
    expect((markup.match(/<polyline/g) ?? []).length).toBe(2)
    expect(markup).toContain('coincide')
    expect(html('deepseek-v3-2')).not.toContain('coincide')
  })

  test('the table mirror announces the selected context', () => {
    const t = zooMirror(preset('deepseek-v3-2'), 131072, null)
    expect(t.announce).toContain('128k')
    expect(t.columns).toEqual(['Context', 'Stored', 'Read per step'])
  })
})

describe('the machine renders', () => {
  const html = (el: ReturnType<typeof createElement>, url: string) => renderToString(createElement(MemoryRouter, { initialEntries: [url] }, el))

  test('lab mode: the zoo machine with its presets, paste box, stepper and layer table', () => {
    const markup = html(createElement(KvCacheSim), '/lab/sim-kv?machine=zoo')
    expect(markup).toContain('Attention Zoo')
    for (const p of ZOO_PRESETS) expect(markup).toContain(p.name)
    expect(markup).toContain('paste config.json')
    expect(markup).toContain('aria-label="shorter context"')
    expect(markup).toContain('aria-label="longer context"')
    expect(markup).toContain('aria-label="context length"')
    expect(markup).toContain('Layer groups')
    expect(markup).toContain('Show data table')
  })

  test('the toggle offers the three machines, and the calculator and block tables are as they were', () => {
    const zoo = html(createElement(KvCacheSim), '/lab/sim-kv?machine=zoo')
    for (const label of ['KV calculator', 'block tables', 'attention zoo']) expect(zoo).toContain(label)
    const calc = html(createElement(KvCacheSim), '/lab/sim-kv?machine=calc')
    expect(calc).toContain('KV-Cache Calculator')
    expect(calc).toContain('per-token cost')
    expect(calc).not.toContain('Layer groups')
    expect(html(createElement(KvCacheSim), '/lab/sim-kv?from=t5.l5')).toContain('KV Block-Table Explorer')
  })

  test('embed mode on the zoo machine renders inside SimHost without a URL, from the block config', () => {
    const markup = html(
      createElement(SimHost, { simId: 'sim-kv', mode: 'embed', machine: 'zoo', config: { presetId: 'kimi-linear', ctx: 131072 } }, createElement(KvCacheSim)),
      '/lesson/t5.l4',
    )
    expect(markup).toMatch(/Kimi Linear(<!-- -->)? @ (<!-- -->)?128k/)
  })
})
