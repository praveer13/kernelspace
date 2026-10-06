/**
 * RooflineSim's outcome tasks, mirror and phone mode (wave-1.md §10.2–10.5, task C7).
 *
 * The pure model is the contract between three things: what the sim reports while a learner runs a task,
 * what phone mode shows as the canonical outcome, and what the task grades. The tests pin that the first
 * two agree, that nothing is graded outside a task's setup, and that the six tasks walk predict → run →
 * explain into a ledger outcome tagged with their KCs. The sim itself is checked by source (it needs a
 * canvas) and by a server render of its markup; the browser pass is in the task notes.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import RooflineSim from '../../src/components/sims/RooflineSim'
import SimMirror from '../../src/components/sims/SimMirror'
import { OutcomeChart } from '../../src/components/sims/PhoneOutcome'
import { ROOFLINE_LEGACY_TASKS, ROOFLINE_TASKS } from '../../src/components/sims/roofline.tasks'
import { ALL_LESSONS } from '../../src/data/lessons'
import {
  SimHostContext,
  announceDelay,
  buildOutcome,
  buildPhoneOutcome,
  completeTask,
  createFinishedStore,
  createObservationBus,
  freshRun,
  gradePrediction,
  reduceRun,
  splitCanonical,
} from '../../src/lib/sims/host'
import type { RunAction, SimHostInternal, TaskRun } from '../../src/lib/sims/host'
import {
  ATTENTION,
  BATCH_STEPS,
  MACHINES,
  PHONE_MODELS,
  PRESETS,
  SETUP,
  announceAttention,
  announceDecode,
  announceKernel,
  announceMachine,
  announceTile,
  attentionAI,
  attentionBytes,
  batchToRidge,
  boundOf,
  decodeAI,
  matmulAI,
  mirrorTable,
  observationsFor,
  ridgeAI,
} from '../../src/lib/sims/models/roofline'
import type { Dtype, MirrorInput, RooflineEvent } from '../../src/lib/sims/models/roofline'
import { buildRegistry, resolveTasks } from '../../src/lib/sims/registry'
import type { Observation, SimTaskDef } from '../../src/lib/sims/types'
import { WAIVER, checkCanvasMirrors } from '../../scripts/verify-plays'
import { makeProfile, startTab } from '../ledger/env'

const ROOT = join(import.meta.dir, '..', '..')
const SIM_SRC = readFileSync(join(ROOT, 'src', 'components', 'sims', 'RooflineSim.tsx'), 'utf8')

const reg = buildRegistry({ '/src/components/sims/roofline.tasks.ts': { ROOFLINE_TASKS, ROOFLINE_LEGACY_TASKS } })
const task = (id: string): SimTaskDef => {
  const t = reg.byId(id)
  if (t === undefined) throw new Error(`no task ${id}`)
  return t
}

const OUTCOME_IDS = ['roof.ridge', 'roof.decode-bound', 'roof.batch-to-ridge', 'roof.tile-ai', 'roof.flash-ai', 'roof.fp8-ridge']

/** What the sim reports when a learner does the task's run, and the canonical key phone mode shows. */
const RUN: Record<string, RooflineEvent> = {
  'roof.ridge': { type: 'machine', preset: 'B200', dtype: 'fp16' },
  'roof.decode-bound': { type: 'plot-decode', preset: 'H100', dtype: 'fp16', batch: 1 },
  'roof.batch-to-ridge': { type: 'batch', preset: 'H100', dtype: 'fp16', batch: 512, decodePlotted: true },
  'roof.tile-ai': { type: 'tile', tile: 128 },
  'roof.flash-ai': { type: 'attention', mode: 'flash' },
  'roof.fp8-ridge': { type: 'machine', preset: 'H100', dtype: 'fp8' },
}

const reported = (id: string): Observation => {
  const t = task(id)
  const o = observationsFor(RUN[id]).find((x) => x.key === t.observe)
  if (o === undefined) throw new Error(`${id}: the run reports nothing for ${t.observe}`)
  return o
}

/** A prediction that is right for the task, from what the model reports. */
const rightPrediction = (id: string) => {
  const o = reported(id)
  return typeof o.value === 'number' ? { value: o.value } : { choice: o.value }
}

describe('the model', () => {
  test('ridges come from the atlas: the H100 near 295, the B200 at 281.25, FP8 and INT4 multiply the ceiling', () => {
    expect(ridgeAI(MACHINES.h100)).toBeCloseTo(295.22, 1)
    expect(ridgeAI(MACHINES.b200)).toBe(281.25)
    expect(ridgeAI(MACHINES.h100, 'fp8')).toBeCloseTo(2 * ridgeAI(MACHINES.h100), 9)
    expect(ridgeAI(MACHINES.h100, 'int4')).toBeCloseTo(4 * ridgeAI(MACHINES.h100), 9)
    expect(PRESETS.map((p) => p.name)).toEqual(['T4', 'RTX 4090', 'A100', 'H100', 'B200', 'TPU7x'])
    for (const p of PRESETS) expect(p.bw * p.peak).toBeGreaterThan(0)
  })

  test('decode intensity is the batch times the precision multiplier, and the first batch step past the ridge is found', () => {
    expect(decodeAI(32, 'fp16')).toBe(32)
    expect(decodeAI(32, 'fp8')).toBe(64)
    expect(batchToRidge(MACHINES.h100, 'fp16')).toBe(512)
    expect(batchToRidge(MACHINES.h100, 'fp8')).toBe(512) // FP8 weights double the intensity, but the ridge doubled too, so the crossing batch does not move
    expect(batchToRidge({ bw: 1, peak: 10 ** 6 }, 'fp16')).toBeNull() // never gets there on the slider
    expect(BATCH_STEPS[BATCH_STEPS.length - 1]).toBe(512)
  })

  test('tiling and attention: T/2 at FP16, and flash moves far fewer bytes for the same FLOPs', () => {
    expect(matmulAI(16)).toBe(8)
    expect(matmulAI(128)).toBe(64)
    expect(attentionAI('naive')).toBe(1)
    expect(attentionAI('flash')).toBe(60)
    const ratio = attentionBytes('naive') / attentionBytes('flash')
    expect(ratio).toBeCloseTo(ATTENTION.context / (3 * ATTENTION.headDim), 6)
    // the sim's round figure is within a factor of 2 of the byte ratio, so a learner can derive it
    expect(Math.abs(Math.log2(attentionAI('flash') / (attentionAI('naive') * ratio)))).toBeLessThan(1)
  })

  test('boundOf puts the ridge itself on the compute side', () => {
    expect(boundOf(1, 295)).toBe('bandwidth')
    expect(boundOf(295, 295)).toBe('compute')
  })
})

describe('the six outcome tasks (§10.2)', () => {
  test('registered as written: outcome kind on sim-roofline, with the contract KCs and the old ids they replace', () => {
    expect(reg.problems).toEqual([])
    const want: Record<string, { kc: string; legacyId: string }> = {
      'roof.ridge': { kc: 't4.ridge-point', legacyId: 't-roof-b200-ridge' },
      'roof.decode-bound': { kc: 't4.bound-classification', legacyId: 't-decode' },
      'roof.batch-to-ridge': { kc: 't4.decode-bandwidth', legacyId: 't-batch' },
      'roof.tile-ai': { kc: 't4.tiling-intensity', legacyId: 't-roof-tile' },
      'roof.flash-ai': { kc: 't4.tiling-intensity', legacyId: 't-roof-flash' },
      'roof.fp8-ridge': { kc: 't4.ridge-point', legacyId: 't-roof-dtype' },
    }
    expect(ROOFLINE_TASKS.map((t) => t.id)).toEqual(OUTCOME_IDS)
    for (const id of OUTCOME_IDS) {
      const t = task(id)
      expect(t.kind).toBe('outcome')
      expect(t.simId).toBe('sim-roofline')
      expect(t.kcs).toEqual([want[id].kc])
      expect(t.legacyId).toBe(want[id].legacyId)
      expect(t.title.length).toBeLessThanOrEqual(80)
      expect(t.note).toBeTruthy()
      expect(t.predict).toBeDefined()
      expect(t.explain?.ideas).toHaveLength(3)
    }
  })

  test('every outcome task has a phone model that exists, and the legacy ids it replaces are gone from the sim', () => {
    for (const id of OUTCOME_IDS) {
      const parts = splitCanonical(task(id).phone?.canonical ?? '')
      expect(parts?.model).toBe('roofline')
      expect(PHONE_MODELS[parts!.name]).toBeInstanceOf(Function)
    }
    for (const t of ROOFLINE_TASKS) {
      expect(SIM_SRC).not.toContain(`id: '${t.legacyId}'`)
      expect(SIM_SRC).not.toContain(`'${t.legacyId}'`)
    }
  })

  test('no hardware number is typed into a prompt: the prompts show what the atlas says', () => {
    expect(task('roof.ridge').predict?.prompt).toContain('2.25 PFLOP/s')
    expect(task('roof.ridge').predict?.prompt).toContain('8 TB/s')
    expect(task('roof.fp8-ridge').predict?.prompt).toContain('989 TFLOP/s')
    expect(task('roof.fp8-ridge').predict?.prompt).toContain('3.35 TB/s')
    const src = readFileSync(join(ROOT, 'src', 'components', 'sims', 'roofline.tasks.ts'), 'utf8')
    expect(src).not.toMatch(/2[,_.]?250|989|3[.,]35|8000|295|281/)
  })

  test('the legacy tasks that stay are registered with their old ids, under the sim, at 0 XP in the registry', () => {
    const ids = ROOFLINE_LEGACY_TASKS.map((t) => t.id)
    expect(ids).toEqual([
      't-cpu-serial',
      't-gpu-map',
      't-gpu-divergence',
      't-roof-occupancy',
      't-roof-coalesce',
      't-roof-bank',
      't-roof-tiers',
      't-roof-pcie',
      't-roof-fleet-router',
      't-roof-fleet-decode',
      't-roof-fleet-paged-attn',
      't-roof-fleet-prefill',
    ])
    for (const t of ROOFLINE_LEGACY_TASKS) {
      expect(t.kind).toBe('legacy')
      expect(t.simId).toBe('sim-roofline')
      expect(SIM_SRC).toContain(`'${t.id}'`) // each is still detected or listed by the sim
    }
  })
})

describe('what the sim reports (and what it does not)', () => {
  test('the run of each task reports exactly the value its phone model shows as the canonical outcome', () => {
    for (const id of OUTCOME_IDS) {
      const t = task(id)
      const canonical = PHONE_MODELS[splitCanonical(t.phone!.canonical)!.name]()
      expect(reported(id).value).toBe(canonical.actual)
      expect(reported(id).unit).toBe(canonical.unit)
    }
    expect(reported('roof.ridge').value).toBe(281.25)
    expect(reported('roof.decode-bound').value).toBe('bandwidth')
    expect(reported('roof.batch-to-ridge').value).toBe(512)
    expect(reported('roof.tile-ai').value).toBe(64)
    expect(reported('roof.flash-ai').value).toBe(60)
    expect(reported('roof.fp8-ridge').value).toBeCloseTo(590.4, 1)
  })

  test('a run under another setup is the learner’s own experiment: nothing is reported', () => {
    const none: RooflineEvent[] = [
      { type: 'machine', preset: 'H100', dtype: 'fp16' },
      { type: 'machine', preset: 'B200', dtype: 'fp8' }, // the ridge task is graded at FP16
      { type: 'machine', preset: 'B200', dtype: 'int4' },
      { type: 'machine', preset: 'custom', dtype: 'fp16' },
      { type: 'machine', preset: 'H100', dtype: 'int4' },
      { type: 'plot-decode', preset: 'H100', dtype: 'fp8', batch: 1 },
      { type: 'plot-decode', preset: 'A100', dtype: 'fp16', batch: 1 },
      { type: 'plot-decode', preset: 'H100', dtype: 'fp16', batch: 8 }, // not the batch-1 question, and not past the ridge
      { type: 'batch', preset: 'H100', dtype: 'fp16', batch: 256, decodePlotted: true }, // still left of the ridge
      { type: 'batch', preset: 'H100', dtype: 'fp16', batch: 512, decodePlotted: false },
      { type: 'batch', preset: 'B200', dtype: 'fp16', batch: 512, decodePlotted: true },
      { type: 'tile', tile: 112 },
      { type: 'tile', tile: 144 },
      { type: 'attention', mode: 'naive' },
    ]
    for (const e of none) expect(observationsFor(e)).toEqual([])
  })

  test('plotting decode once the batch is already past the ridge reports both answers', () => {
    const keys = observationsFor({ type: 'plot-decode', preset: 'H100', dtype: 'fp16', batch: 512 }).map((o) => o.key)
    expect(keys).toEqual(['roof.batch-to-ridge']) // batch 512 is not the batch-1 question
    expect(observationsFor({ type: 'plot-decode', preset: 'H100', dtype: 'fp16', batch: 1 }).map((o) => o.key)).toEqual(['roof.decode-bound'])
  })

  test('the lessons start every task away from its answer state, so a run is a deliberate act', () => {
    for (const lesson of ALL_LESSONS) {
      for (const b of lesson.blocks) {
        if (b.type !== 'exercise' || b.simId !== 'sim-roofline') continue
        const cfg = (b.config ?? {}) as Record<string, unknown>
        expect(cfg.m === SETUP.ridge.preset && cfg.dtype === SETUP.ridge.dtype).toBe(false)
        expect(cfg.dtype).not.toBe('fp8')
        expect(cfg.tileT).not.toBe(SETUP.tile)
        expect(cfg.attentionMode).not.toBe('flash')
        expect(cfg.batch === undefined || BATCH_STEPS.includes(cfg.batch as number)).toBe(true)
      }
    }
  })
})

describe('predict → run → explain, end to end', () => {
  const LINE = 'The ridge is peak compute over peak bandwidth so decode sits far to the left of it'
  const play = (t: SimTaskDef, actions: RunAction[], from: TaskRun = freshRun()): TaskRun => actions.reduce((s, a) => reduceRun(t, s, a), from)

  test.each(OUTCOME_IDS)('%s: the right prediction passes, and the outcome carries its KCs', (id) => {
    const t = task(id)
    const o = reported(id)
    const s = play(t, [
      { type: 'commit', prediction: rightPrediction(id), at: 1 },
      { type: 'observe', obs: o },
      { type: 'explain', text: LINE },
      { type: 'finish' },
    ])
    expect(s.phase).toBe('done')
    const out = buildOutcome(t, s)!
    expect(out).toMatchObject({ taskId: id, ok: true, score: 1 })
    expect(out.data.kcs).toEqual(t.kcs)
    expect(out.data.actual).toBe(o.value)
  })

  test.each(OUTCOME_IDS)('%s: a wrong prediction is graded as a miss, not a pass', (id) => {
    const t = task(id)
    const o = reported(id)
    const wrong = typeof o.value === 'number' ? { value: o.value * 10 } : { choice: t.predict!.kind === 'choice' ? t.predict!.options.find((x) => x.id !== o.value)!.id : '' }
    const grade = gradePrediction(t.predict!, wrong, o.value)!
    expect(grade.ok).toBe(false)
    expect(grade.score).toBeLessThan(1)
  })

  test.each(OUTCOME_IDS)('%s: the sim reporting before a prediction is locked completes nothing', (id) => {
    const t = task(id)
    const s = play(t, [{ type: 'observe', obs: reported(id) }, { type: 'explain', text: LINE }, { type: 'finish' }])
    expect(s).toEqual(freshRun())
    expect(buildOutcome(t, s)).toBeNull()
  })

  test('the tolerances are the ones that make sense: calculations are tight, estimates are a factor', () => {
    const tol = (id: string) => (task(id).predict?.kind === 'numeric' ? task(id).predict : undefined)
    expect(gradePrediction(task('roof.ridge').predict!, { value: 281 }, 281.25)!.ok).toBe(true)
    expect(gradePrediction(task('roof.ridge').predict!, { value: 300 }, 281.25)!.ok).toBe(false) // 6.7% off a division
    expect(gradePrediction(task('roof.fp8-ridge').predict!, { value: 295 }, 590.4)!.ok).toBe(false) // forgot the FP8 doubling
    expect(gradePrediction(task('roof.tile-ai').predict!, { value: 32 }, 64)!.ok).toBe(false) // T/4, the FP32 formula
    expect(gradePrediction(task('roof.tile-ai').predict!, { value: 128 }, 64)!.ok).toBe(false) // T, forgetting the element size
    expect(gradePrediction(task('roof.batch-to-ridge').predict!, { value: 300 }, 512)!.ok).toBe(true) // the analytic crossing
    expect(gradePrediction(task('roof.batch-to-ridge').predict!, { value: 256 }, 512)!.ok).toBe(false) // a step short is still bandwidth-bound
    expect(gradePrediction(task('roof.flash-ai').predict!, { value: 85 }, 60)!.ok).toBe(true) // derived from the byte ratio
    expect(gradePrediction(task('roof.flash-ai').predict!, { value: 8 }, 60)!.ok).toBe(false)
    expect(tol('roof.flash-ai')?.log).toBe(true)
  })

  test('a finished cycle reaches the ledger as a sim-task event with the KCs, and completes the task', async () => {
    const id = 'roof.tile-ai'
    const t = task(id)
    const s = play(t, [
      { type: 'commit', prediction: { value: 64 }, conf: 'think', at: 1 },
      { type: 'observe', obs: reported(id) },
      { type: 'explain', text: LINE },
      { type: 'finish' },
    ])
    const tab = startTab(makeProfile())
    expect(completeTask(tab.progress.getState().recordSimOutcome, t, s)).toBe(true)
    expect(tab.progress.getState().aggregate.sims['sim-roofline'].outcomes).toEqual({ [id]: true })
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'sim-task')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ ref: `sim:sim-roofline/${id}`, ok: true, data: { v: 2, outcome: true, actual: 64, kcs: ['t4.tiling-intensity'] } })
  })
})

describe('phone mode shows the canonical outcome (§10.4)', () => {
  test.each(OUTCOME_IDS)('%s: a chart and a table from the model, both well-formed', (id) => {
    const o = PHONE_MODELS[splitCanonical(task(id).phone!.canonical)!.name]()
    expect(o.summary.length).toBeGreaterThan(20)
    expect(o.chart.points.length).toBeGreaterThanOrEqual(2)
    expect(o.chart.mark).toBeGreaterThanOrEqual(0)
    expect(o.chart.mark).toBeLessThan(o.chart.points.length)
    for (const p of o.chart.points) expect(Number.isFinite(p.y) && p.y > 0).toBe(true)
    expect(o.table.rows.length).toBeGreaterThanOrEqual(2)
    for (const r of o.table.rows) expect(r).toHaveLength(o.table.columns.length)
    const svg = renderToString(createElement(OutcomeChart, { outcome: o }))
    expect(svg).toContain('role="img"')
    expect(svg).not.toContain('NaN')
    expect(svg).not.toContain('Infinity')
  })

  test('the marked point is the answer: the ridge, the decode bar, the crossing batch, T = 128, flash and FP8', () => {
    const mark = (name: string) => {
      const o = PHONE_MODELS[name]()
      return o.chart.points[o.chart.mark!]
    }
    expect(mark('b200-ridge').label).toContain('ridge')
    expect(mark('decode-bound').label).toContain('decode')
    expect(mark('batch-to-ridge').x).toBe(512)
    expect(mark('tile-ai').x).toBe(128)
    expect(mark('flash-ai').x).toBe('flash')
    expect(mark('fp8-ridge').x).toBe('fp8')
  })

  test('a prediction is graded and recorded as a phone outcome: ok false, data.phone, KCs kept', () => {
    for (const id of OUTCOME_IDS) {
      const t = task(id)
      const actual = PHONE_MODELS[splitCanonical(t.phone!.canonical)!.name]().actual
      const out = buildPhoneOutcome(t, rightPrediction(id), 'sure', actual)!
      expect(out).toMatchObject({ taskId: id, score: 1, ok: false })
      expect(out.data).toMatchObject({ phone: true, actual, kcs: t.kcs })
    }
  })
})

describe('the DOM mirror (§10.5)', () => {
  const input: MirrorInput = {
    preset: 'H100',
    bw: MACHINES.h100.bw,
    peak: MACHINES.h100.peak,
    dtype: 'fp16',
    guideAI: 1,
    plotted: [{ label: 'decode @ 70B', ai: 1, attained: 3015 }],
    probes: [{ label: 'matmul tile T=16', ai: 8, attained: 26_800 }],
  }

  test('the table lists the ridge, the roof series, the guide, the plotted kernels and the probe points', () => {
    const t = mirrorTable(input)
    expect(t.columns).toEqual(['series or point', 'intensity (FLOP/B)', 'attainable', 'bound by'])
    const names = t.rows.map((r) => String(r[0]))
    expect(names[0]).toBe('ridge')
    expect(names.filter((n) => n.startsWith('roof at')).length).toBeGreaterThanOrEqual(8)
    expect(names).toContain('guide')
    expect(names).toContain('decode @ 70B')
    expect(names).toContain('matmul tile T=16')
    for (const r of t.rows) expect(r).toHaveLength(t.columns.length)
    expect(t.caption).toContain('H100')
    expect(t.caption).toContain('295')
    expect(t.rows[0][1]).toBe('295')
    expect(t.rows.find((r) => r[0] === 'decode @ 70B')?.[3]).toBe('bandwidth')
  })

  test('the roof rows follow min(peak, AI × bandwidth): the low end is bandwidth-bound, the high end compute-bound', () => {
    const rows = mirrorTable(input).rows.filter((r) => String(r[0]).startsWith('roof at'))
    expect(rows[0][3]).toBe('bandwidth')
    expect(rows[rows.length - 1][3]).toBe('compute')
  })

  test('a precision change moves the ridge in the table; an announcement appears only when there is a discrete result', () => {
    expect(mirrorTable({ ...input, dtype: 'fp8' }).rows[0][1]).toBe('590')
    expect(mirrorTable(input).announce).toBeUndefined()
    expect(mirrorTable({ ...input, announce: '' }).announce).toBeUndefined()
    expect(mirrorTable({ ...input, announce: 'decode at batch 1 is bandwidth-bound' }).announce).toBe('decode at batch 1 is bandwidth-bound')
  })

  test('announcements are short discrete sentences in the spec’s shape, never per-frame values', () => {
    expect(announceDecode(MACHINES.h100, 'fp16', 32)).toBe('decode at batch 32 is bandwidth-bound: 32.0 FLOP/B, ridge 295')
    expect(announceDecode(MACHINES.h100, 'fp16', 512)).toBe('decode at batch 512 is compute-bound: 512 FLOP/B, ridge 295')
    expect(announceKernel('prefill @ 70B', 400, ridgeAI(MACHINES.h100))).toBe('prefill @ 70B is compute-bound: 400 FLOP/B, ridge 295')
    expect(announceMachine('B200', MACHINES.b200, 'fp16')).toBe('B200 at FP16 ×1: ridge 281 FLOP/B')
    expect(announceTile(128)).toBe('tile 128 reaches 64.0 FLOP/B')
    expect(announceAttention('flash')).toBe('flash attention at 60.0 FLOP/B')
    for (const s of [announceDecode(MACHINES.h100, 'fp16', 1), announceTile(16), announceAttention('naive')]) expect(s.length).toBeLessThan(90)
  })

  test('the live region speaks at most once a second: a burst of announcements is spaced by announceDelay', () => {
    // the same scheduling SimMirror's hook uses: each text waits announceDelay(lastSpokenAt, now), the newest wins
    const events = [0, 120, 340, 600, 1300, 1450]
    let lastAt: number | null = null
    const spoken: number[] = []
    let pending: { at: number } | null = null
    for (const now of events) {
      if (pending !== null && pending.at <= now) {
        spoken.push(pending.at)
        lastAt = pending.at
        pending = null
      }
      pending = { at: now + announceDelay(lastAt, now) } // a newer text replaces the pending one
    }
    spoken.push(pending!.at)
    expect(spoken.length).toBeLessThan(events.length)
    for (let i = 1; i < spoken.length; i++) expect(spoken[i] - spoken[i - 1]).toBeGreaterThanOrEqual(1000)
  })

  test('SimMirror renders that table behind a toggle, with the canvas pointing at it', () => {
    const html = renderToString(createElement(SimMirror, { id: 'roof-mirror', table: mirrorTable(input) }))
    expect(html).toMatch(/<div id="roof-mirror" class="sr-only"><table/)
    expect(html).toContain('Show data table')
    expect(html).toContain('decode @ 70B')
  })
})

describe('RooflineSim itself', () => {
  test('the file’s waiver is replaced by a mirror: verify-plays sees it mirrored, and the canvas is described by it', () => {
    expect(SIM_SRC).not.toContain(WAIVER)
    expect(SIM_SRC).toContain('<SimMirror')
    expect(SIM_SRC).toContain('aria-describedby={mirrorId}')
    const [finding] = checkCanvasMirrors([{ file: 'RooflineSim.tsx', text: SIM_SRC }])
    expect(finding.status).toBe('mirrored')
  })

  test('migrated to SimHost: it reads the machine and config through the shell hooks, never the router', () => {
    expect(SIM_SRC).not.toMatch(/\b(useSearchParams|setSearchParams)\b/)
    expect(SIM_SRC).toContain('useSimMachine()')
    expect(SIM_SRC).toContain('useInitialCfg<')
    expect(SIM_SRC).toContain('useObserve()')
  })

  test('announcements come from handlers, never from the animation loop', () => {
    const draw = SIM_SRC.slice(SIM_SRC.indexOf('const draw = (now: number)'), SIM_SRC.indexOf('raf = requestAnimationFrame(draw)\n    return () => {'))
    expect(draw.length).toBeGreaterThan(1000)
    expect(draw).not.toContain('setAnnounce')
    expect(draw).not.toContain('observe(')
    expect(SIM_SRC.match(/setAnnounce\(/g)!.length).toBeGreaterThanOrEqual(6)
  })

  const host = (mode: 'lab' | 'embed'): SimHostInternal => ({
    simId: 'sim-roofline',
    mode,
    machine: 'roofline',
    initialConfig: { m: 'H100', dtype: 'fp8', batch: 4 },
    writeConfig: () => {},
    selectMachine: () => {},
    observe: () => {},
    bus: createObservationBus(),
    finished: createFinishedStore(),
  })
  const render = (h: SimHostInternal) =>
    renderToString(createElement(MemoryRouter, { initialEntries: ['/lesson/t4.l3'] }, createElement(SimHostContext.Provider, { value: h }, createElement(RooflineSim))))

  test('inline, it renders the chart with its mirror and starts from the lesson’s config', () => {
    const html = render(host('embed'))
    expect(html).toContain('<canvas')
    expect(html).toContain('role="img"')
    expect(html).toMatch(/aria-describedby="[^"]+"/)
    expect(html).toContain('data-sim-mirror')
    expect(html).toContain('Show data table')
    expect(html).toContain('Roofline for H100 at FP8 ×2')
    expect(html).toContain('ridge 590 FLOP/B')
  })

  test('the mirror table is in the markup for the chart to describe', () => {
    const html = render(host('embed'))
    const id = html.match(/<canvas[^>]*aria-describedby="([^"]+)"/)![1]
    expect(html).toContain(`id="${id}"`)
    expect(html).toContain('roof at 2^-6')
    expect(html).toContain('matmul tile T=16')
  })

  test('a config for another preset or dtype is honoured; unknown values fall back', () => {
    const html = renderToString(
      createElement(
        MemoryRouter,
        { initialEntries: ['/lesson/t4.l6'] },
        createElement(SimHostContext.Provider, { value: { ...host('embed'), initialConfig: { m: 'B200', dtype: 'nope', tileT: 999 } } }, createElement(RooflineSim)),
      ),
    )
    expect(html).toContain('Roofline for B200 at FP16 ×1')
    expect(html).toContain('matmul tile T=16')
  })
})

describe('the T4 exercise blocks (§10.2: taskIds and config)', () => {
  const blocks = ALL_LESSONS.flatMap((l) => l.blocks.flatMap((b) => (b.type === 'exercise' && b.simId === 'sim-roofline' ? [{ lesson: l.id, b }] : [])))

  test('all five T4 roofline exercises name registry tasks and a config', () => {
    expect(blocks.map((x) => x.lesson).sort()).toEqual(['t4.l1', 't4.l2', 't4.l3', 't4.l4', 't4.l6'])
    for (const { lesson, b } of blocks) {
      expect(b.taskIds?.length, lesson).toBeGreaterThan(0)
      expect(b.config, lesson).toBeTypeOf('object')
      expect(resolveTasks(b.simId, b.machine, b.taskIds, reg).map((t) => t.id)).toEqual(b.taskIds!)
    }
  })

  test('the six outcome tasks sit in the lessons that teach them, once each', () => {
    const where = (id: string) => blocks.filter((x) => x.b.taskIds?.includes(id)).map((x) => x.lesson)
    expect(where('roof.ridge')).toEqual(['t4.l3'])
    expect(where('roof.decode-bound')).toEqual(['t4.l3'])
    expect(where('roof.batch-to-ridge')).toEqual(['t4.l3'])
    expect(where('roof.fp8-ridge')).toEqual(['t4.l3'])
    expect(where('roof.tile-ai')).toEqual(['t4.l6'])
    expect(where('roof.flash-ai')).toEqual(['t4.l6'])
    for (const t of ROOFLINE_TASKS) expect(t.lessons).toEqual(where(t.id))
  })

  test('every legacy task of the sim that a lesson teaches is listed by it', () => {
    for (const t of ROOFLINE_LEGACY_TASKS) {
      for (const lesson of t.lessons ?? []) expect(blocks.find((x) => x.lesson === lesson)?.b.taskIds, `${lesson} lists ${t.id}`).toContain(t.id)
    }
  })

  test('a config only sets what the sim reads, with values it accepts', () => {
    const known = new Set(['m', 'bw', 'peak', 'batch', 'dtype', 'guide', 'warps', 'registers', 'accessPattern', 'bankConflict', 'bankPadding', 'workingSetKb', 'memoryPath', 'pcieMode', 'tileT', 'attentionMode', 'serialRan', 'mapRan'])
    for (const { lesson, b } of blocks) {
      const cfg = b.config as Record<string, unknown>
      for (const k of Object.keys(cfg)) expect(known.has(k), `${lesson}: ${k}`).toBe(true)
      expect(PRESETS.some((p) => p.name === cfg.m), lesson).toBe(true)
      if (cfg.dtype !== undefined) expect((['fp16', 'fp8', 'int4'] as Dtype[]).includes(cfg.dtype as Dtype)).toBe(true)
    }
  })

  test('the markdown task list says what the registry tasks ask, without giving the answers', () => {
    const l3 = blocks.find((x) => x.lesson === 't4.l3')!.b.tasks.join('\n')
    const l6 = blocks.find((x) => x.lesson === 't4.l6')!.b.tasks.join('\n')
    expect(l3).toMatch(/Predict the B200/)
    expect(l6).toMatch(/Predict the arithmetic intensity of a 128 × 128/)
    for (const answer of ['281', '295', '590', '= 64']) {
      expect(l3).not.toContain(answer)
      expect(l6).not.toContain(answer)
    }
  })
})
