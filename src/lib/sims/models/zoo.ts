/**
 * The Attention Zoo machine's pure model (W6, docs/specs/wave-2.md §11.4, task 2b-13).
 *
 * KvCacheSim's `zoo` machine, its six outcome tasks (src/components/sims/kvZoo.tasks.ts) and phone mode share this
 * file, so they cannot disagree: the machine draws and reads from it, each task's Run reading comes from `READINGS`
 * at the task's `SETUPS` entry, and `PHONE_MODELS` draws the same reading as a chart and a table without the sim.
 * Every byte comes from `src/lib/kv-zoo.ts` (presets built from the `zoo.*` claims, W4, W13); this file adds the
 * machine's own questions to it: the context steps, how a layer group grows, what a prefix hit can reuse, the
 * baseline ratio and the readings. No React, no DOM, no clock: it runs under `bun test`.
 */

import { layerBytes, parseConfig, zooBytes, zooPresetById } from '@/lib/kv-zoo'
import type { LayerGroup, ZooLayer, ZooModel } from '@/lib/kv-zoo'
import type { CanonicalOutcome } from '@/lib/sims/host'
import { fmtCtx } from '@/lib/sims/models/kv'
import type { MirrorTable } from '@/lib/sims/types'

export { fmtCtx }

/* ------------------------------------------------------------------ */
/* Control ranges and formatting                                       */
/* ------------------------------------------------------------------ */

/** Context steps, 1k to 1M tokens in powers of two (a log axis): eleven stops, the four pins among them. */
export const ZOO_CTX_STEPS: readonly number[] = Array.from({ length: 11 }, (_, i) => 1024 * 2 ** i)

/** The model every other model is compared with: the plain full-attention baseline (the 320 KiB/token model). */
export const BASELINE_ID = 'llama3-70b'

/** The paste box's cap, the same as the `zoo:config` working key's (§3.5). */
export const ZOO_CONFIG_MAX_CHARS = 20_000

export const zooBaseline = (): ZooModel => {
  const p = zooPresetById(BASELINE_ID)
  if (p === undefined) throw new Error(`the zoo has no ${BASELINE_ID} preset`)
  return p
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const

/** Bytes in binary units, three significant figures, whole when exact: 343597383680 is "320 GiB", 1048576 is "1 MiB". */
export function fmtBytes(bytes: number): string {
  let v = bytes
  let i = 0
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024
    i += 1
  }
  const digits = i === 0 || v >= 100 || Number.isInteger(v) ? 0 : v >= 10 ? 1 : 2
  return `${v.toFixed(digits)} ${UNITS[i]}`
}

const round = (x: number, digits: number): number => Math.round(x * 10 ** digits) / 10 ** digits

/** A count with thousands separators ("327,680"). */
export const fmtInt = (n: number): string => n.toLocaleString('en-US')

/* ------------------------------------------------------------------ */
/* State, from a lesson block or a link                                */
/* ------------------------------------------------------------------ */

/** What the zoo machine lets a learner set: a preset (or `custom`, the pasted config) and a context. */
export interface ZooState {
  presetId: string
  ctx: number
}

export const CUSTOM_ID = 'custom'

/** What the machine starts from: the baseline at 128k. */
export const DEFAULT_ZOO_STATE: ZooState = { presetId: BASELINE_ID, ctx: 131072 }

const nearestStep = (v: number): number =>
  ZOO_CTX_STEPS.reduce((best, step) => (Math.abs(step - v) < Math.abs(best - v) ? step : best), ZOO_CTX_STEPS[0])

/**
 * A lesson block's `config` (or a `?cfg=` in lab mode) as a state. Anything that is not a preset id is ignored
 * (a pasted config is the learner's, never a link's), and the context snaps to the nearest step.
 */
export function normalizeZooConfig(cfg: unknown): ZooState {
  if (typeof cfg !== 'object' || cfg === null) return DEFAULT_ZOO_STATE
  const c = cfg as Record<string, unknown>
  const presetId = typeof c.presetId === 'string' && zooPresetById(c.presetId) !== undefined ? c.presetId : DEFAULT_ZOO_STATE.presetId
  const ctx = typeof c.ctx === 'number' && Number.isFinite(c.ctx) ? nearestStep(c.ctx) : DEFAULT_ZOO_STATE.ctx
  return { presetId, ctx }
}

/* ------------------------------------------------------------------ */
/* The paste box                                                       */
/* ------------------------------------------------------------------ */

export type PasteStatus =
  | { state: 'empty' }
  | { state: 'ok'; model: ZooModel }
  | { state: 'error'; message: string; field?: string }

/** What a pasted config.json reads as: a model, or the reader's named error (§11.2). */
export function pasteStatus(text: string): PasteStatus {
  if (text.trim() === '') return { state: 'empty' }
  if (text.length > ZOO_CONFIG_MAX_CHARS) {
    return { state: 'error', message: `this config is longer than ${fmtInt(ZOO_CONFIG_MAX_CHARS)} characters: paste only the config.json text` }
  }
  const parsed = parseConfig(text, 'Pasted config')
  return parsed.ok ? { state: 'ok', model: parsed.model } : { state: 'error', message: parsed.error.message, field: parsed.error.field }
}

/* ------------------------------------------------------------------ */
/* What a layer group does                                             */
/* ------------------------------------------------------------------ */

/** What a prefix hit can reuse from this layer's cache: a shared prefix shorter than the cached sequence. */
export type PrefixReuse = 'any-prefix' | 'entry-aligned' | 'window-only' | 'whole-sequence'

export const PREFIX_REUSE_TEXT: Readonly<Record<PrefixReuse, string>> = {
  'any-prefix': 'any prefix',
  'entry-aligned': 'whole entries only',
  'window-only': 'only the last window',
  'whole-sequence': 'only the whole sequence',
}

/**
 * Whether the cache holds something for a shared prefix of the sequence. A log keeps one record per token, so
 * any prefix is there; compressed entries are there for every complete block; a window keeps only the last
 * tokens; a recurrent state summarises everything up to the last token, so it exists only at the end.
 */
export function prefixReuse(layer: ZooLayer): PrefixReuse {
  switch (layer.kind) {
    case 'full':
    case 'mla':
    case 'dsa':
      return 'any-prefix'
    case 'csa':
    case 'hca':
      return 'entry-aligned'
    case 'swa':
      return 'window-only'
    case 'linear':
      return 'whole-sequence'
  }
}

/** How a layer's stored bytes grow with context, in words. */
export function growthText(layer: ZooLayer): string {
  switch (layer.kind) {
    case 'full':
    case 'mla':
      return 'grows with every token'
    case 'dsa':
      return 'grows with every token; a step reads only the top-k'
    case 'csa':
    case 'hca':
      return `one entry per ${layer.ratio} tokens, plus a window`
    case 'swa':
      return `stops growing at ${fmtInt(layer.window + layer.sinks)} tokens`
    case 'linear':
      return 'constant: one fixed-size state'
  }
}

/** The context past which a sliding-window layer stops growing (window plus sinks), or null for other kinds. */
export const plateauTokens = (layer: ZooLayer): number | null => (layer.kind === 'swa' ? layer.window + layer.sinks : null)

const firstOf = (model: ZooModel, kind: ZooLayer['kind']): LayerGroup | undefined => model.groups.find((g) => g.layer.kind === kind)

export interface GroupRow {
  label: string
  kind: ZooLayer['kind']
  count: number
  stored: number
  read: number
  /** Share of the model's stored bytes at this context, in percent. */
  share: number
  growth: string
  reuse: PrefixReuse
}

/** One row per layer group at context t: what all its layers store and read, and how it behaves. */
export function groupRows(model: ZooModel, t: number): GroupRow[] {
  const z = zooBytes(model, t)
  return model.groups.map((g, i) => ({
    label: g.label,
    kind: g.layer.kind,
    count: g.count,
    stored: z.groups[i].stored,
    read: z.groups[i].read,
    share: z.stored === 0 ? 0 : round((z.groups[i].stored / z.stored) * 100, 2),
    growth: growthText(g.layer),
    reuse: prefixReuse(g.layer),
  }))
}

/** What the baseline stores at context t divided by what this model stores: how many times smaller than the baseline. */
export const baselineRatio = (model: ZooModel, t: number): number => round(zooBytes(zooBaseline(), t).stored / zooBytes(model, t).stored, 2)

export type ReadVsStored = 'same' | 'reads-less' | 'stored-less'

/** How one step's reads compare with what is stored: equal, reads at most half of stored, or reads above stored. */
export function readVsStored(read: number, stored: number): ReadVsStored {
  if (read > stored) return 'stored-less'
  return read * 2 <= stored ? 'reads-less' : 'same'
}

/* ------------------------------------------------------------------ */
/* The mirror table                                                    */
/* ------------------------------------------------------------------ */

/** The chart's table: both curves at every context step (and the baseline's capacity), and what the cursor says. */
export function zooMirror(model: ZooModel, ctx: number, baseline: ZooModel | null): MirrorTable {
  const at = zooBytes(model, ctx)
  const columns = ['Context', 'Stored', 'Read per step']
  if (baseline !== null) columns.push(`${baseline.name} stored`)
  return {
    caption: `${model.name}: bytes stored and bytes read per decode step, BF16`,
    columns,
    rows: ZOO_CTX_STEPS.map((t) => {
      const z = zooBytes(model, t)
      const row: (string | number)[] = [fmtCtx(t), fmtBytes(z.stored), fmtBytes(z.read)]
      if (baseline !== null) row.push(fmtBytes(zooBytes(baseline, t).stored))
      return row
    }),
    announce: `${model.name} at ${fmtCtx(ctx)}: stores ${fmtBytes(at.stored)}, one step reads ${fmtBytes(at.read)}.`,
  }
}

/* ------------------------------------------------------------------ */
/* Readings and setups                                                 */
/* ------------------------------------------------------------------ */

export interface ZooReading {
  /** The registry task's `observe` key (the task id). */
  key: string
  unit: string
  /** The value the machine reports for this model at this context, or null when the model has nothing to report. */
  read(model: ZooModel, ctx: number): number | string | null
}

/** Reads the first group of a kind, or null. */
const ofKind = <T>(model: ZooModel, kind: ZooLayer['kind'], f: (g: LayerGroup, i: number) => T): T | null => {
  const g = firstOf(model, kind)
  return g === undefined ? null : f(g, model.groups.indexOf(g))
}

const LAST_STEP = ZOO_CTX_STEPS[ZOO_CTX_STEPS.length - 1]
const FIRST_STEP = ZOO_CTX_STEPS[0]

export const READINGS: readonly ZooReading[] = [
  { key: 'zoo.mla-ratio', unit: '×', read: (m, t) => baselineRatio(m, t) },
  { key: 'zoo.swa-flat', unit: 'tokens', read: (m) => ofKind(m, 'swa', (g) => plateauTokens(g.layer)) },
  {
    key: 'zoo.dsa-reads',
    unit: '',
    read: (m, t) => {
      const z = zooBytes(m, t)
      return readVsStored(z.read, z.stored)
    },
  },
  {
    key: 'zoo.linear-state',
    unit: '×',
    read: (m) => ofKind(m, 'linear', (g) => round(layerBytes(g.layer, LAST_STEP).stored / layerBytes(g.layer, FIRST_STEP).stored, 2)),
  },
  {
    key: 'zoo.hybrid-share',
    unit: '%',
    read: (m, t) => ofKind(m, 'mla', (_, i) => groupRows(m, t)[i].share),
  },
  { key: 'zoo.gdn-prefix', unit: '', read: (m) => ofKind(m, 'linear', (g) => (prefixReuse(g.layer) === 'any-prefix' ? 'yes' : 'no')) },
]

/** A setup pins only the controls its reading depends on; the other is free. */
export interface ZooSetup {
  presetId: string
  ctx?: number
}

/** The setups of the six outcome tasks (the single source for the machine's Run check, the task text and phone mode). */
export const SETUPS: Readonly<Record<string, ZooSetup>> = {
  // DeepSeek-V3 against the baseline: the ratio is the same at every context, so none is pinned.
  'zoo.mla-ratio': { presetId: 'deepseek-v3' },
  'zoo.swa-flat': { presetId: 'gpt-oss-120b' },
  'zoo.dsa-reads': { presetId: 'deepseek-v3-2', ctx: 131072 },
  'zoo.linear-state': { presetId: 'kimi-linear' },
  'zoo.hybrid-share': { presetId: 'kimi-linear', ctx: 131072 },
  'zoo.gdn-prefix': { presetId: 'qwen3-5-397b' },
}

const presetName = (id: string): string => (id === CUSTOM_ID ? 'pasted config' : (zooPresetById(id)?.name ?? id))

/** The controls that differ from a setup, as "model: Kimi Linear" (what the learner must change before Run reads that task). */
export function setupMismatches(state: ZooState, setup: ZooSetup): string[] {
  const out: string[] = []
  if (state.presetId !== setup.presetId) out.push(`model: ${presetName(setup.presetId)}`)
  if (setup.ctx !== undefined && state.ctx !== setup.ctx) out.push(`context: ${fmtCtx(setup.ctx)}`)
  return out
}

/** The model a setup describes. */
export function modelOfSetup(setup: ZooSetup): ZooModel {
  const m = zooPresetById(setup.presetId)
  if (m === undefined) throw new Error(`the zoo has no ${setup.presetId} preset`)
  return m
}

/** The context a setup describes (free contexts take the default). */
export const ctxOfSetup = (setup: ZooSetup): number => setup.ctx ?? DEFAULT_ZOO_STATE.ctx

/** The key's value for a setup, or null for an unknown key or a model with nothing to report. */
export function readSetup(key: string): { value: number | string; unit: string } | null {
  const reading = READINGS.find((r) => r.key === key)
  const setup = SETUPS[key]
  if (reading === undefined || setup === undefined) return null
  const value = reading.read(modelOfSetup(setup), ctxOfSetup(setup))
  return value === null ? null : { value, unit: reading.unit }
}

/* ------------------------------------------------------------------ */
/* Phone mode: the canonical outcome per task                          */
/* ------------------------------------------------------------------ */

const need = (key: string): { value: number | string; unit: string } => {
  const r = readSetup(key)
  if (r === null) throw new Error(`no reading for ${key}`)
  return r
}

const preset = (id: string): ZooModel => {
  const m = zooPresetById(id)
  if (m === undefined) throw new Error(`the zoo has no ${id} preset`)
  return m
}

const kib = (bytes: number): number => round(bytes / 1024, 1)

function mlaRatio(): CanonicalOutcome {
  const key = 'zoo.mla-ratio'
  const setup = SETUPS[key]
  const t = ctxOfSetup(setup)
  const ids = [BASELINE_ID, setup.presetId]
  const rows = ids.map((id) => ({ m: preset(id), perToken: zooBytes(preset(id), 1).stored }))
  const actual = need(key).value as number
  return {
    actual,
    unit: '×',
    summary: `${rows[0].m.name} stores ${fmtInt(rows[0].perToken)} bytes for every token and ${rows[1].m.name} ${fmtInt(rows[1].perToken)}: ${actual}× less, from one latent per token.`,
    chart: {
      kind: 'bars',
      xLabel: 'model (BF16 KV)',
      yLabel: 'KiB per token',
      points: rows.map((r) => ({ x: r.m.id, y: kib(r.perToken), label: r.m.name.replace('Llama-3-', 'L3 ').replace('DeepSeek-', 'DS ') })),
      mark: 1,
    },
    table: {
      caption: `KV bytes per token, summed over layers (at ${fmtCtx(t)} the same ratio holds)`,
      columns: ['Model', 'Layer kind', 'Bytes per token', 'Baseline ÷ model'],
      rows: rows.map((r) => [r.m.name, r.m.groups[0].label, r.perToken, round(rows[0].perToken / r.perToken, 2)]),
    },
  }
}

const SWA_CTXS: readonly number[] = [16, 32, 64, 128, 256, 512, 1024]

function swaFlat(): CanonicalOutcome {
  const key = 'zoo.swa-flat'
  const m = modelOfSetup(SETUPS[key])
  const g = firstOf(m, 'swa') as LayerGroup
  const actual = need(key).value as number
  const rows = SWA_CTXS.map((t) => ({ t, stored: g.count * layerBytes(g.layer, t).stored }))
  const mark = rows.findIndex((r) => r.t === actual)
  return {
    actual,
    unit: 'tokens',
    summary: `${m.name}'s ${g.count} sliding-window layers hold ${fmtBytes(rows[mark].stored)} at ${fmtInt(actual)} tokens and the same at every longer context.`,
    chart: {
      kind: 'line',
      xLabel: 'context (tokens)',
      yLabel: 'KiB, window layers',
      points: rows.map((r) => ({ x: r.t, y: kib(r.stored), label: String(r.t) })),
      mark: mark < 0 ? undefined : mark,
      logX: true,
    },
    table: {
      caption: `${m.name}: bytes stored by its ${g.count} sliding-window layers`,
      columns: ['Context', 'Stored', 'Still growing'],
      rows: rows.map((r) => [fmtInt(r.t), fmtBytes(r.stored), r.t < actual ? 'yes' : 'no']),
    },
  }
}

function dsaReads(): CanonicalOutcome {
  const key = 'zoo.dsa-reads'
  const setup = SETUPS[key]
  const t = ctxOfSetup(setup)
  const v3 = zooBytes(preset('deepseek-v3'), t)
  const v32 = zooBytes(modelOfSetup(setup), t)
  const gib = (b: number): number => round(b / 1024 ** 3, 2)
  const points = [
    { x: 'v3-held', y: gib(v3.stored), label: 'V3 stored = read' },
    { x: 'v32-stored', y: gib(v32.stored), label: 'V3.2 stored' },
    { x: 'v32-read', y: gib(v32.read), label: 'V3.2 read' },
  ]
  const verdict = need(key).value as string
  return {
    actual: verdict,
    summary: `At ${fmtCtx(t)} ${modelOfSetup(setup).name} stores ${fmtBytes(v32.stored)} and one step reads ${fmtBytes(v32.read)}: ${round(v32.stored / v32.read, 1)}× less than it stores.`,
    chart: { kind: 'bars', xLabel: `bytes at ${fmtCtx(t)}`, yLabel: 'GiB', points, mark: 2 },
    table: {
      caption: `Stored against read per decode step at ${fmtCtx(t)}, BF16`,
      columns: ['Model', 'Stored', 'Read per step', 'Stored ÷ read'],
      rows: [
        [preset('deepseek-v3').name, fmtBytes(v3.stored), fmtBytes(v3.read), round(v3.stored / v3.read, 1)],
        [modelOfSetup(setup).name, fmtBytes(v32.stored), fmtBytes(v32.read), round(v32.stored / v32.read, 1)],
      ],
    },
  }
}

const LINEAR_CTXS: readonly number[] = [1024, 8192, 65536, 1048576]

function linearState(): CanonicalOutcome {
  const key = 'zoo.linear-state'
  const m = modelOfSetup(SETUPS[key])
  const lin = firstOf(m, 'linear') as LayerGroup
  const att = m.groups.find((g) => g.layer.kind === 'mla' || g.layer.kind === 'full')
  const actual = need(key).value as number
  const rows = LINEAR_CTXS.map((t) => ({
    t,
    state: layerBytes(lin.layer, t).stored,
    log: att === undefined ? 0 : layerBytes(att.layer, t).stored,
  }))
  return {
    actual,
    unit: '×',
    summary: `One ${lin.label} layer of ${m.name} holds ${fmtBytes(rows[0].state)} at 1k tokens and ${fmtBytes(rows[rows.length - 1].state)} at 1M: ${actual}×.`,
    chart: {
      kind: 'line',
      xLabel: 'context (tokens)',
      yLabel: 'MiB, one linear layer',
      points: rows.map((r) => ({ x: r.t, y: round(r.state / 1024 ** 2, 2), label: fmtCtx(r.t) })),
      mark: rows.length - 1,
      logX: true,
    },
    table: {
      caption: `${m.name}: one linear layer's state${att === undefined ? '' : ` beside one ${att.label} layer's cache`}`,
      columns: att === undefined ? ['Context', 'Linear state'] : ['Context', 'Linear state', `${att.label} cache`],
      rows: rows.map((r) => (att === undefined ? [fmtCtx(r.t), fmtBytes(r.state)] : [fmtCtx(r.t), fmtBytes(r.state), fmtBytes(r.log)])),
    },
  }
}

function hybridShare(): CanonicalOutcome {
  const key = 'zoo.hybrid-share'
  const setup = SETUPS[key]
  const m = modelOfSetup(setup)
  const t = ctxOfSetup(setup)
  const rows = groupRows(m, t)
  const mark = rows.findIndex((r) => r.kind === 'mla')
  const actual = need(key).value as number
  return {
    actual,
    unit: '%',
    summary: `At ${fmtCtx(t)} the ${rows[mark].count} MLA layers of ${m.name} hold ${actual}% of its KV bytes; the ${rows.filter((_, i) => i !== mark).map((r) => `${r.count} ${r.label}`).join(' and ')} layers hold the rest.`,
    chart: {
      kind: 'bars',
      xLabel: `layer group at ${fmtCtx(t)}`,
      yLabel: '% of stored bytes',
      points: rows.map((r) => ({ x: r.kind, y: r.share, label: `${r.label} ×${r.count}` })),
      mark,
    },
    table: {
      caption: `${m.name}: stored bytes by layer group at ${fmtCtx(t)}`,
      columns: ['Layer group', 'Layers', 'Stored', 'Share'],
      rows: rows.map((r) => [r.label, r.count, fmtBytes(r.stored), `${r.share}%`]),
    },
  }
}

function gdnPrefix(): CanonicalOutcome {
  const key = 'zoo.gdn-prefix'
  const setup = SETUPS[key]
  const m = modelOfSetup(setup)
  const total = ctxOfSetup(setup)
  const shared = total / 2
  const rows = m.groups.map((g) => ({ g, reuse: prefixReuse(g.layer) }))
  const reusable = (r: PrefixReuse): number => (r === 'any-prefix' ? shared : 0)
  const actual = need(key).value as string
  const lin = rows.findIndex((r) => r.reuse === 'whole-sequence')
  return {
    actual,
    summary: `A request that shares the first ${fmtInt(shared)} of ${fmtInt(total)} cached tokens finds that half in the ${rows.filter((r) => r.reuse === 'any-prefix').map((r) => r.g.label).join(' and ')} layers, but not in the ${rows[lin].g.label} layers: their state exists only after the last token.`,
    chart: {
      kind: 'bars',
      xLabel: 'layer group',
      yLabel: 'shared tokens reusable',
      points: rows.map((r) => ({ x: r.g.layer.kind, y: reusable(r.reuse), label: `${r.g.label} ×${r.g.count}` })),
      mark: lin,
    },
    table: {
      caption: `${m.name}: serving a hit on the first ${fmtInt(shared)} of ${fmtInt(total)} cached tokens`,
      columns: ['Layer group', 'Layers', 'What the cache holds', 'Shared half reusable'],
      rows: rows.map((r) => [r.g.label, r.g.count, growthText(r.g.layer), reusable(r.reuse) > 0 ? 'yes' : 'no, recompute']),
    },
  }
}

/** `phone.canonical` is `zoo.<name>`: one entry per outcome task. */
export const PHONE_MODELS: Readonly<Record<string, () => CanonicalOutcome>> = {
  'mla-ratio': mlaRatio,
  'swa-flat': swaFlat,
  'dsa-reads': dsaReads,
  'linear-state': linearState,
  'hybrid-share': hybridShare,
  'gdn-prefix': gdnPrefix,
}
