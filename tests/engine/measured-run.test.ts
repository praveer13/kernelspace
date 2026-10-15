/**
 * The T0/T4 measured-versus-predicted real-engine run (docs/specs/wave-3.md §16.10, task 3s-13): the arithmetic of the
 * prediction (bytes, a bandwidth you choose, the ceiling), the measurement protocol against a fake generation function and
 * a fake clock, the comparison, the two events it records (a `predict` and an `item` on `item:engine.measured-tps`, src
 * `practice`, provenance `field`) through a real ledger, the section mounted in a small DOM (tests/dom/mini-dom.ts) with
 * the measurement stubbed, and the panel asking before it downloads.
 *
 * No model is ever loaded here: `gen` is a stand-in that spends virtual time per token, and the mounted section takes a
 * stubbed `measure`. What the real model measures on a laptop and a phone is the owner's device run (§16.10).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import MeasuredRun, { DownloadConsent, type MeasuredRunEnv } from '../../src/components/engine/MeasuredRun'
import { claimNumber } from '../../src/data/claims'
import { validateEvent } from '../../src/lib/ledger/codec'
import type { ItemResponse } from '../../src/lib/ledger/types'
import { redactForPartner } from '../../src/lib/learner/redact'
import {
  MAX_GBS,
  MAX_TPS,
  MEASURED_BYTES,
  MEASURED_ITEM_ID,
  MEASURED_KC,
  MEASURED_MODEL_ID,
  MEASURED_REF,
  MEASURE_CONTEXT_TOKENS,
  MEASURE_HI,
  MEASURE_LO,
  MEASURE_PROMPT,
  MEMORY_PRESETS,
  MeasureError,
  OK_FACTOR,
  REAL_WORKLOAD,
  ceilingTps,
  compareRun,
  connectionWarning,
  consentLine,
  gapReading,
  h100CeilingTps,
  kvBytesPerToken,
  measureDecodeTps,
  measuredRunItems,
  parsePositive,
  presetGBs,
  type DecodeMeasurement,
  type RealGenFn,
} from '../../src/lib/real-engine'
import { installDom, MiniEvent, type DomKit, type MiniElement, type Mounted } from '../dom/mini-dom'
import { makeProfile, startTab, tick } from '../ledger/env'

/* ------------------------------ a model that takes time ------------------------------ */

/**
 * A generation function on a virtual clock: a call costs `prefillMs` plus `msPerToken` for each new token, and returns
 * four characters per token (as many as were asked for, or `stopAt` at most).
 */
function fakeModel(opts: { prefillMs: number; msPerToken: number | ((call: number) => number); stopAt?: number }) {
  const clock = { t: 0 }
  const calls: number[] = []
  const gen: RealGenFn = async (_messages, o) => {
    const asked = Number(o.max_new_tokens)
    calls.push(asked)
    const n = Math.min(asked, opts.stopAt ?? asked)
    const per = typeof opts.msPerToken === 'function' ? opts.msPerToken(calls.length) : opts.msPerToken
    clock.t += opts.prefillMs + n * per
    return [{ generated_text: [{ role: 'assistant', content: 'abcd'.repeat(n) }] }]
  }
  return { gen, clock, calls, now: () => clock.t }
}

/* ------------------------------ the arithmetic ------------------------------ */

describe('the prediction from bytes and a bandwidth', () => {
  test('a preset is transfer rate x bus width / 8, to one decimal', () => {
    expect(MEMORY_PRESETS.map((p) => [p.id, presetGBs(p)])).toEqual([
      ['lpddr5-64', 51.2],
      ['ddr5-128', 89.6],
      ['lpddr5x-128', 136.5],
      ['gddr6-128', 224],
    ])
  })

  test('the ceiling is bandwidth over bytes: 51.2 GB/s over 400 MB is 128 tok/s', () => {
    expect(MEASURED_BYTES).toBe(400e6)
    expect(ceilingTps(MEASURED_BYTES, 51.2)).toBeCloseTo(128, 9)
    expect(ceilingTps(MEASURED_BYTES, 224)).toBeCloseTo(560, 9)
  })

  test("an H100 SXM's ceiling for the same bytes comes from its HBM claim: 3.35 TB/s over 400 MB is 8,375 tok/s", () => {
    expect(claimNumber('hw.h100-sxm.hbm-bw')).toBe(3.35)
    expect(h100CeilingTps(MEASURED_BYTES)).toBeCloseTo(8375, 6)
  })

  test("the KV cache is a small share of a token's bytes: 2 x 28 x 8 x 128 values, 4 bytes each at most", () => {
    expect(claimNumber('model.qwen3-0-6b.layers') * claimNumber('model.qwen3-0-6b.kv-heads') * claimNumber('model.qwen3-0-6b.head-dim') * 2).toBe(57_344)
    expect(kvBytesPerToken(2)).toBe(114_688)
    expect(kvBytesPerToken(4)).toBe(229_376)
    const share = (MEASURE_CONTEXT_TOKENS * kvBytesPerToken(4)) / MEASURED_BYTES
    expect(share).toBeGreaterThan(0.039)
    expect(share).toBeLessThan(0.041)
  })

  test('typed numbers are positive, finite and within the cap', () => {
    expect(parsePositive('51.2', MAX_GBS)).toBe(51.2)
    expect(parsePositive(' 1,000 ', MAX_GBS)).toBe(1000)
    for (const bad of ['', 'abc', '0', '-5', '1e9', 'NaN', '10001']) expect(parsePositive(bad, MAX_GBS)).toBeNull()
    expect(parsePositive('100000', MAX_TPS)).toBe(100_000)
    expect(parsePositive('100001', MAX_TPS)).toBeNull()
  })
})

describe('consent', () => {
  test('the line names the model, the size, where it goes and that nothing is sent', () => {
    const line = consentLine('Qwen3-0.6B', 400)
    expect(line).toContain('400 MB')
    expect(line).toContain('Qwen3-0.6B')
    expect(line).toContain('nothing is sent anywhere')
    expect(line).toContain('Wi-Fi')
  })

  test('a cellular, data-saver or slow connection is named; an ordinary one, or no report, is not', () => {
    expect(connectionWarning({ type: 'cellular' })).toContain('cellular')
    expect(connectionWarning({ saveData: true })).toContain('data saver')
    expect(connectionWarning({ effectiveType: '3g' })).toContain('3g')
    expect(connectionWarning({ type: 'wifi', effectiveType: '4g', saveData: false })).toBeNull()
    expect(connectionWarning(undefined)).toBeNull()
    expect(connectionWarning({})).toBeNull()
  })
})

/* ------------------------------ the measurement ------------------------------ */

describe('measureDecodeTps', () => {
  test('prefill and the round trip cancel: 25 ms per token behind a 900 ms prefill is 40 tok/s', async () => {
    const m = fakeModel({ prefillMs: 900, msPerToken: 25 })
    const r = await measureDecodeTps(m.gen, { now: m.now })
    expect(r.tokPerSec).toBe(40)
    expect(r.rounds).toEqual([40, 40, 40])
    expect(r.tokens).toBe(MEASURE_HI - MEASURE_LO)
  })

  test('one untimed warm-up, then the short and the long run of each round, on one prompt', async () => {
    const m = fakeModel({ prefillMs: 100, msPerToken: 10 })
    const seen: string[] = []
    const spy: RealGenFn = async (messages, o) => {
      seen.push(messages.map((x) => x.content).join('|'))
      expect(o.do_sample).toBe(false)
      return m.gen(messages, o)
    }
    const progress: Array<[number, number]> = []
    await measureDecodeTps(spy, { now: m.now, onProgress: (d, t) => progress.push([d, t]) })
    expect(m.calls).toEqual([2, 8, 40, 8, 40, 8, 40])
    expect(new Set(seen)).toEqual(new Set([MEASURE_PROMPT]))
    expect(MEASURE_PROMPT).toBe(REAL_WORKLOAD[2].prompt)
    expect(progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]])
  })

  test('the median of the rounds decides, so one slow round does not', async () => {
    // calls: 1 warm-up, then (8, 40) pairs; the second pair runs four times slower per token
    const m = fakeModel({ prefillMs: 50, msPerToken: (call) => (call === 4 || call === 5 ? 100 : 25) })
    const r = await measureDecodeTps(m.gen, { now: m.now })
    expect(r.rounds).toEqual([40, 10, 40])
    expect(r.tokPerSec).toBe(40)
  })

  test('an even number of rounds takes the mean of the middle two, to one decimal', async () => {
    const m = fakeModel({ prefillMs: 0, msPerToken: (call) => (call <= 3 ? 25 : 12.5) })
    const r = await measureDecodeTps(m.gen, { now: m.now, rounds: 2 })
    expect(r.rounds).toEqual([40, 80])
    expect(r.tokPerSec).toBe(60)
  })

  test('an answer that ends before the long length is refused, not timed', async () => {
    const m = fakeModel({ prefillMs: 100, msPerToken: 20, stopAt: 9 })
    await expect(measureDecodeTps(m.gen, { now: m.now })).rejects.toThrow(MeasureError)
    await expect(measureDecodeTps(m.gen, { now: m.now })).rejects.toThrow(/stopped before the timed length/)
  })

  test('a clock that cannot tell the two runs apart is refused', async () => {
    const m = fakeModel({ prefillMs: 100, msPerToken: 0 })
    await expect(measureDecodeTps(m.gen, { now: m.now })).rejects.toThrow(/clock cannot separate/)
  })

  test("a generation that rejects is the caller's to handle: nothing is swallowed", async () => {
    const boom: RealGenFn = async () => {
      throw new Error('out of memory')
    }
    await expect(measureDecodeTps(boom)).rejects.toThrow('out of memory')
  })
})

/* ------------------------------ the comparison ------------------------------ */

describe('compareRun', () => {
  test('within a factor of two is right; the score falls with the log error', () => {
    const near = compareRun({ predicted: 60, bandwidthGBs: 51.2, measured: 40 })
    expect(near.ok).toBe(true)
    expect(near.ratio).toBeCloseTo(40 / 60, 12)
    expect(near.logErr).toBeCloseTo(Math.log10(1.5), 12)
    expect(near.score).toBeCloseTo(1 - Math.log10(1.5), 12)
    const edge = compareRun({ predicted: 80, bandwidthGBs: 51.2, measured: 40 })
    expect(edge.ok).toBe(true)
    expect(OK_FACTOR).toBe(2)
    const far = compareRun({ predicted: 128, bandwidthGBs: 51.2, measured: 40 })
    expect(far.ok).toBe(false)
    expect(far.score).toBeCloseTo(1 - Math.log10(3.2), 12)
    expect(compareRun({ predicted: 4000, bandwidthGBs: 51.2, measured: 40 }).score).toBe(0)
  })

  test('the ceiling, the bandwidth the measurement implies and the share of the chosen one', () => {
    const c = compareRun({ predicted: 100, bandwidthGBs: 51.2, measured: 40 })
    expect(c.bytes).toBe(MEASURED_BYTES)
    expect(c.ceiling).toBeCloseTo(128, 9)
    expect(c.effectiveGBs).toBeCloseTo(16, 9)
    expect(c.utilisation).toBeCloseTo(16 / 51.2, 9)
  })

  test('the reading says what a low share and a share above one each mean', () => {
    const low = compareRun({ predicted: 100, bandwidthGBs: 51.2, measured: 40 })
    expect(gapReading(low, 'webgpu')).toContain('31%')
    expect(gapReading(low, 'webgpu')).toContain('WebGPU')
    expect(gapReading(low, 'wasm')).toContain('wasm CPU')
    expect(gapReading(low, null)).toContain('software')
    const high = compareRun({ predicted: 100, bandwidthGBs: 10, measured: 40 })
    expect(high.utilisation).toBeGreaterThan(1)
    expect(gapReading(high, 'wasm')).toContain('more than the 10 GB/s you chose')
  })
})

/* ------------------------------ the recording ------------------------------ */

describe('the recording', () => {
  const cmp = compareRun({ predicted: 70, bandwidthGBs: 51.2, measured: 40 })

  test('a predict and an item on item:engine.measured-tps, src practice, provenance field, weight 0', () => {
    expect(MEASURED_REF).toBe('item:engine.measured-tps')
    expect(MEASURED_ITEM_ID).toBe('engine.measured-tps')
    const [predict, item] = measuredRunItems(cmp)
    expect(predict.kind).toBe('predict')
    expect(item.kind).toBe('item')
    for (const e of [predict, item]) {
      expect(e).toMatchObject({ ref: MEASURED_REF, provenance: 'field', ok: true })
      expect(e.score).toBeCloseTo(cmp.score, 12)
      expect(e.data).toEqual({ src: 'practice', value: 70, unit: 'tok/s', truth: 40, kcs: [MEASURED_KC] })
    }
    expect(predict.rev).toBe(item.rev)
    expect(MEASURED_KC).toBe('t4.decode-bandwidth')
  })

  test('the rev changes with the model or the tolerance, so a re-scoped item reads as a new one', () => {
    expect(measuredRunItems(cmp)[0].rev).toMatch(/^[0-9a-z]+$/)
    expect(MEASURED_MODEL_ID).toBe('onnx-community/Qwen3-0.6B-ONNX')
  })

  test('the ledger accepts and keeps both events, and a donation drops the numbers', async () => {
    const profile = makeProfile()
    const tab = startTab(profile)
    tab.progress.getState().recordItems(measuredRunItems(cmp))
    await tick(20)
    const events = await (await tab.engine()).events({ refPrefix: 'item:engine.' })
    expect(events.map((e) => e.kind).sort()).toEqual(['item', 'predict'])
    for (const e of events) {
      expect(validateEvent(e).ok).toBe(true)
      expect(e.ref).toBe('item:engine.measured-tps')
      if (e.kind !== 'item' && e.kind !== 'predict') throw new Error('expected an item or a predict event')
      expect(e.provenance).toBe('field')
      expect(e.data).toMatchObject({ src: 'practice', value: 70, truth: 40, unit: 'tok/s' })
    }
    const donated = redactForPartner({ events, working: [] })
    expect(JSON.stringify(donated.events)).not.toMatch(/\b70\b|\b40\b/)
    expect(donated.events.map((e) => e.ref)).toEqual(['item:engine.measured-tps', 'item:engine.measured-tps'])
  })

  test('a field event earns no credit: the competence and retention weights read 0', async () => {
    const { creditOf } = await import('../../src/lib/learner/provenance')
    expect(creditOf('field')).toBe(0)
  })
})

/* ------------------------------ the section, mounted ------------------------------ */

describe('the section, with the measurement stubbed', () => {
  let dom: DomKit
  beforeAll(async () => {
    dom = await installDom()
  })
  afterAll(() => dom.uninstall())

  const stubGen: RealGenFn = async () => []
  const q = (page: Mounted, sel: string) => page.container.querySelector(sel) as MiniElement
  const type = (el: MiniElement, value: string) =>
    dom.act(() => {
      el.value = value
      el.dispatchEvent(new MiniEvent('input', { bubbles: true }))
    })

  interface Rig {
    env: MeasuredRunEnv
    recorded: ItemResponse[][]
    measured: number
    busy: boolean[]
  }
  function rig(result: DecodeMeasurement | Error): Rig {
    const r: Rig = { recorded: [], measured: 0, busy: [], env: { measure: async () => ({ tokPerSec: 0, rounds: [], tokens: 0 }), record: () => {} } }
    r.env = {
      measure: async (_gen, onProgress) => {
        r.measured++
        onProgress(0, 3)
        onProgress(1, 3)
        if (result instanceof Error) throw result
        return result
      },
      record: (items) => void r.recorded.push(items),
    }
    return r
  }
  const open = (r: Rig, over: Partial<Parameters<typeof MeasuredRun>[0]> = {}) =>
    dom.mount(createElement(MeasuredRun, { gen: stubGen, device: 'webgpu', isMeasuredModel: true, env: r.env, onBusyChange: (b: boolean) => void r.busy.push(b), ...over }))
  async function lockAt(page: Mounted, bandwidth: string, predicted: string) {
    await type(q(page, '[data-bandwidth]'), bandwidth)
    await type(q(page, '[data-prediction]'), predicted)
    await dom.press(q(page, '[data-lock]'))
  }

  test('says whose device it is, and shows the bytes and the two inputs before anything is locked', async () => {
    const r = rig({ tokPerSec: 40, rounds: [40, 40, 40], tokens: 32 })
    const page = await open(r)
    expect(q(page, '[data-your-device]').textContent.trim()).toBe('your device, not an H100')
    expect(page.container.textContent).toContain('about 400 MB')
    expect(q(page, '[data-lock]').disabled).toBe(true)
    expect(q(page, '[data-run]')).toBeNull()
    expect(page.container.textContent).not.toContain('ceiling')
    await page.unmount()
  })

  test('a preset fills the bandwidth, the stepper moves it, and lock needs both numbers', async () => {
    const page = await open(rig({ tokPerSec: 40, rounds: [], tokens: 32 }))
    await dom.press(q(page, '[data-preset="lpddr5-64"]'))
    expect((q(page, '[data-bandwidth]') as MiniElement).value).toBe('51.2')
    expect(q(page, '[data-preset="lpddr5-64"]').getAttribute('aria-pressed')).toBe('true')
    expect(q(page, '[data-lock]').disabled).toBe(true)
    await dom.press(page.container.querySelector('[aria-label="raise the bandwidth by 5 GB/s"]') as MiniElement)
    expect(q(page, '[data-bandwidth]').value).toBe('56.2')
    await dom.press(page.container.querySelector('[aria-label="lower the bandwidth by 5 GB/s"]') as MiniElement)
    expect(q(page, '[data-bandwidth]').value).toBe('51.2')
    await type(q(page, '[data-prediction]'), 'fast')
    expect(q(page, '[data-lock]').disabled).toBe(true)
    expect(page.container.textContent).toContain('Enter a number from 0 to 100,000.')
    await type(q(page, '[data-prediction]'), '90')
    expect(q(page, '[data-lock]').disabled).toBe(false)
    await page.unmount()
  })

  test('lock, run, and the measured value sits beside the predicted one, recorded once as a predict and an item', async () => {
    const r = rig({ tokPerSec: 40, rounds: [41, 40, 39], tokens: 32 })
    const page = await open(r)
    await lockAt(page, '51.2', '70')
    expect(q(page, '[data-locked]').textContent).toContain('Locked: 70 tok/s at 51.2 GB/s.')
    expect(q(page, '[data-bandwidth]').disabled).toBe(true)
    expect(q(page, '[data-prediction]').disabled).toBe(true)
    expect(r.recorded).toHaveLength(0)

    await dom.press(q(page, '[data-run]'))
    await dom.until(() => q(page, '[data-comparison]') !== null)
    expect(r.measured).toBe(1)
    expect(r.busy).toEqual([true, false])

    const verdict = q(page, '[data-verdict]').textContent
    expect(verdict).toContain('You predicted 70 tok/s; this device measured 40 tok/s (0.57')
    expect(verdict).toContain('Within 2×')
    const text = q(page, '[data-comparison]').textContent
    expect(text).toContain('ceiling: 51.2 GB/s ÷ 400 MB')
    expect(text).toContain('128 tok/s')
    expect(text).toContain('16 GB/s (31% of the one you chose)')
    expect(text).toContain('8,375 tok/s')
    expect(text).toContain('Your device, not an H100')
    expect(q(page, '[data-recorded]').textContent).toContain('this device only')

    expect(r.recorded).toHaveLength(1)
    const [predict, item] = r.recorded[0]
    expect([predict.kind, item.kind]).toEqual(['predict', 'item'])
    expect(predict.data).toMatchObject({ src: 'practice', value: 70, truth: 40, unit: 'tok/s' })
    expect(item).toMatchObject({ ref: 'item:engine.measured-tps', provenance: 'field' })
    await page.unmount()
  })

  test('a prediction outside a factor of two says which way it missed', async () => {
    const page = await open(rig({ tokPerSec: 12, rounds: [], tokens: 32 }))
    await lockAt(page, '224', '400')
    await dom.press(q(page, '[data-run]'))
    await dom.until(() => q(page, '[data-comparison]') !== null)
    expect(q(page, '[data-verdict]').textContent).toContain('Outside 2×: the device was slower than you expected.')
    await page.unmount()

    const fast = await open(rig({ tokPerSec: 300, rounds: [], tokens: 32 }))
    await lockAt(fast, '51.2', '40')
    await dom.press(q(fast, '[data-run]'))
    await dom.until(() => q(fast, '[data-comparison]') !== null)
    expect(q(fast, '[data-verdict]').textContent).toContain('the device was faster than you expected')
    expect(q(fast, '[data-comparison]').textContent).toContain('more than the 51.2 GB/s you chose')
    await fast.unmount()
  })

  test('a failed measurement says so, records nothing and keeps the locked prediction for another run', async () => {
    const r = rig(new MeasureError('The model stopped before the timed length, so its tokens cannot be counted. Run it again.'))
    const page = await open(r)
    await lockAt(page, '51.2', '90')
    await dom.press(q(page, '[data-run]'))
    await dom.until(() => q(page, '[data-measure-error]') !== null)
    expect(q(page, '[data-measure-error]').textContent).toContain('stopped before the timed length')
    expect(r.recorded).toHaveLength(0)
    expect(q(page, '[data-locked]').textContent).toContain('90 tok/s')
    expect(q(page, '[data-run]').disabled).toBe(false)
    expect(r.busy).toEqual([true, false])
    await page.unmount()
  })

  test('without the model, or with another model, or while another run holds the slot, the run waits and says why', async () => {
    const r = rig({ tokPerSec: 40, rounds: [], tokens: 32 })
    const noModel = await open(r, { gen: null })
    await lockAt(noModel, '51.2', '90')
    expect(q(noModel, '[data-run]').disabled).toBe(true)
    expect(noModel.container.textContent).toContain('The model is not loaded.')
    await noModel.unmount()

    const other = await open(r, { isMeasuredModel: false })
    await lockAt(other, '51.2', '90')
    expect(q(other, '[data-run]').disabled).toBe(true)
    expect(other.container.textContent).toContain('The run measures Qwen3-0.6B.')
    await other.unmount()

    const busy = await open(r, { busy: true })
    await lockAt(busy, '51.2', '90')
    expect(q(busy, '[data-run]').disabled).toBe(true)
    expect(busy.container.textContent).toContain('Another run is using the generation slot.')
    await busy.unmount()
    expect(r.measured).toBe(0)
  })

  test('predict again reopens the inputs, and a second run records a second pair', async () => {
    const r = rig({ tokPerSec: 40, rounds: [], tokens: 32 })
    const page = await open(r)
    await lockAt(page, '51.2', '90')
    await dom.press(q(page, '[data-run]'))
    await dom.until(() => q(page, '[data-comparison]') !== null)
    await dom.press(q(page, '[data-again]'))
    expect(q(page, '[data-comparison]')).toBeNull()
    expect(q(page, '[data-prediction]').disabled).toBe(false)
    expect(q(page, '[data-prediction]').value).toBe('')
    expect(q(page, '[data-bandwidth]').value).toBe('51.2')
    await type(q(page, '[data-prediction]'), '45')
    await dom.press(q(page, '[data-lock]'))
    await dom.press(q(page, '[data-run]'))
    await dom.until(() => q(page, '[data-comparison]') !== null)
    expect(r.recorded).toHaveLength(2)
    expect(r.recorded[1][0].data).toMatchObject({ value: 45, truth: 40 })
    await page.unmount()
  })

  test('a measurement that lands after the section left is dropped, not recorded', async () => {
    const r = rig({ tokPerSec: 40, rounds: [], tokens: 32 })
    let release: () => void = () => {}
    r.env.measure = () => new Promise((resolve) => (release = () => resolve({ tokPerSec: 40, rounds: [], tokens: 32 })))
    const page = await open(r)
    await lockAt(page, '51.2', '90')
    await dom.press(q(page, '[data-run]'))
    await page.unmount()
    await dom.act(async () => {
      release()
      await new Promise((res) => setTimeout(res, 10))
    })
    expect(r.recorded).toHaveLength(0)
  })
})

/* ------------------------------ the question before the download ------------------------------ */

describe('the consent', () => {
  let dom: DomKit
  beforeAll(async () => {
    dom = await installDom()
  })
  afterAll(() => dom.uninstall())

  const q = (page: Mounted, sel: string) => page.container.querySelector(sel) as MiniElement
  const ask = (over: Partial<Parameters<typeof DownloadConsent>[0]> = {}) => {
    const calls: string[] = []
    const props = { name: 'Qwen3-0.6B', mb: 400, warning: null, onConfirm: () => void calls.push('yes'), onDecline: () => void calls.push('no'), ...over }
    return { calls, el: createElement(DownloadConsent, props) }
  }

  test('names the model and its size, takes focus on the yes, and fetches nothing by itself', async () => {
    const { calls, el } = ask()
    const page = await dom.mount(el)
    const text = q(page, '[data-consent]').textContent
    expect(text).toContain('Download Qwen3-0.6B?')
    expect(text).toContain('about 400 MB')
    expect(text).toContain('nothing is sent anywhere')
    expect(q(page, '[data-consent-yes]').textContent).toContain('download ~400 MB')
    expect(dom.document.activeElement).toBe(q(page, '[data-consent-yes]'))
    expect(calls).toEqual([])
    await page.unmount()
  })

  test('yes and not now each do their one thing', async () => {
    const yes = ask()
    const a = await dom.mount(yes.el)
    await dom.press(q(a, '[data-consent-yes]'))
    expect(yes.calls).toEqual(['yes'])
    await a.unmount()
    const no = ask()
    const b = await dom.mount(no.el)
    await dom.press(q(b, '[data-consent-no]'))
    expect(no.calls).toEqual(['no'])
    await b.unmount()
  })

  test('on a cellular connection the yes says anyway, and the page names why', async () => {
    const { el } = ask({ warning: connectionWarning({ type: 'cellular' }) })
    const page = await dom.mount(el)
    expect(q(page, '[data-consent]').textContent).toContain('Your browser reports a cellular connection.')
    expect(q(page, '[data-consent-yes]').textContent).toContain('anyway')
    await page.unmount()
  })

  test('the smaller model asks about its own size', async () => {
    const { el } = ask({ name: 'SmolLM2-135M', mb: 90 })
    const page = await dom.mount(el)
    expect(q(page, '[data-consent]').textContent).toContain('SmolLM2-135M downloads about 90 MB')
    await page.unmount()
  })
})
