/**
 * SimHost (wave-1.md §10.1, §10.4): where config goes, what the sim reads from the host, the observation
 * bus, prediction grading, phone mode and the laptop queue, and the canvas-mirror check of verify-plays.
 * Lab mode must stay today's URL behaviour; embed and phone modes must never write the URL.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import SimHost from '../../src/components/sims/SimHost'
import { decodeCfg, encodeCfg, useInitialCfg, useSimMachine } from '../../src/components/sims/PlaygroundShell'
import {
  ANNOUNCE_MIN_GAP_MS,
  CFG_WRITE_DELAY_MS,
  LAPTOP_QUEUE_MAX,
  SIM_ALIASES,
  announceDelay,
  checkPrediction,
  createFinishedStore,
  createObservationBus,
  gradePrediction,
  parseLaptopQueue,
  parseNumeric,
  queueForLaptop,
  resolveInlineMode,
  scheduleConfigWrite,
  splitCanonical,
} from '../../src/lib/sims/host'
import type { ConfigSinks } from '../../src/lib/sims/host'
import type { Observation, PredictSpec, SimHostMode } from '../../src/lib/sims/types'
import { WAIVER, checkCanvasMirrors } from '../../scripts/verify-plays'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function sinks() {
  const calls: string[] = []
  const s: ConfigSinks = { url: (c) => calls.push(`url:${JSON.stringify(c)}`), memory: (c) => calls.push(`memory:${JSON.stringify(c)}`) }
  return { calls, s }
}

describe('where a config change goes (§10.1)', () => {
  test('lab: debounced into the URL, 250 ms, and a newer change replaces the pending one', async () => {
    expect(CFG_WRITE_DELAY_MS).toBe(250)
    const { calls, s } = sinks()
    const cancel1 = scheduleConfigWrite('lab', { n: 1 }, s, 20)
    await sleep(5)
    cancel1() // what an effect cleanup does when the config changes again
    scheduleConfigWrite('lab', { n: 2 }, s, 20)
    expect(calls).toEqual([])
    await sleep(40)
    expect(calls).toEqual(['url:{"n":2}'])
  })

  test('lab: an unmount before the delay writes nothing', async () => {
    const { calls, s } = sinks()
    scheduleConfigWrite('lab', { n: 1 }, s, 10)()
    await sleep(25)
    expect(calls).toEqual([])
  })

  test.each<SimHostMode>(['embed', 'phone'])('%s: never touches the URL, however long it waits; memory gets it at once', async (mode) => {
    const { calls, s } = sinks()
    scheduleConfigWrite(mode, { n: 1 }, s, 5)
    scheduleConfigWrite(mode, { n: 2 }, s, 5)
    expect(calls).toEqual(['memory:{"n":1}', 'memory:{"n":2}'])
    await sleep(30)
    expect(calls.some((c) => c.startsWith('url:'))).toBe(false)
  })
})

/** Renders what a sim would read from the shell hooks. */
function Probe() {
  const cfg = useInitialCfg<{ s: string }>()
  const { machine, from } = useSimMachine()
  return createElement('output', null, JSON.stringify({ cfg, machine, from }))
}

const URL_CFG = encodeCfg({ s: 'from-url' })
const html = (el: ReturnType<typeof createElement>, url: string) =>
  renderToString(createElement(MemoryRouter, { initialEntries: [url] }, el))
const probed = (markup: string) => {
  const m = /<output>(.*?)<\/output>/.exec(markup)
  return JSON.parse(m![1].replaceAll('&quot;', '"')) as { cfg: unknown; machine: string | null; from: string | null }
}

describe('what a sim reads (§10.1)', () => {
  const url = `/lesson/t1.l4?cfg=${URL_CFG}&machine=rust&from=t3.l3`

  test('lab: ?cfg=, ?machine= and ?from= exactly as before', () => {
    const lab = html(createElement(SimHost, { simId: 'sim-allocator', mode: 'lab' }, createElement(Probe)), url)
    expect(probed(lab)).toEqual({ cfg: { s: 'from-url' }, machine: 'rust', from: 't3.l3' })
  })

  test('no SimHost at all behaves as lab', () => {
    expect(probed(html(createElement(Probe), url))).toEqual({ cfg: { s: 'from-url' }, machine: 'rust', from: 't3.l3' })
  })

  test('embed: the props, and the page URL is ignored', () => {
    const el = createElement(
      SimHost,
      { simId: 'sim-allocator', mode: 'embed', machine: 'allocator', config: { s: 'from-props' }, lessonId: 't1.l4' },
      createElement(Probe),
    )
    const out = probed(html(el, url))
    expect(out).toEqual({ cfg: { s: 'from-props' }, machine: 'allocator', from: 't1.l4' })
  })

  test('phone: no simulator is mounted at all (predict, outcome, queue only)', () => {
    const el = createElement(
      SimHost,
      { simId: 'sim-allocator', mode: 'phone', config: { s: 'from-props' } },
      createElement(Probe),
    )
    const markup = html(el, url)
    expect(markup).not.toContain('<output>')
    expect(markup).toContain('data-mode="phone"')
  })

  test('embed with no config reads null, not the URL', () => {
    const el = createElement(SimHost, { simId: 'sim-kv', mode: 'embed' }, createElement(Probe))
    expect(probed(html(el, url))).toEqual({ cfg: null, machine: null, from: null })
  })

  test('the ?cfg= codec round-trips', () => {
    expect(decodeCfg(encodeCfg({ a: [1, 2], b: 'x' }))).toEqual({ a: [1, 2], b: 'x' })
    expect(decodeCfg('not base64 json')).toBeNull()
    expect(decodeCfg(null)).toBeNull()
  })

  test('the /lab ids: canonical and short ids resolve, inherited object keys do not', () => {
    expect(SIM_ALIASES['sim-roofline']).toBe('sim-roofline')
    expect(SIM_ALIASES['kv-calc']).toBe('sim-kv')
    expect(Object.hasOwn(SIM_ALIASES, 'constructor')).toBe(false)
    expect(Object.values(SIM_ALIASES)).toHaveLength(18)
  })
})

describe('observation bus', () => {
  test('delivers in order to every subscriber and stops after unsubscribe', () => {
    const bus = createObservationBus()
    const a: string[] = []
    const b: string[] = []
    const offA = bus.subscribe((o) => a.push(`${o.key}=${o.value}`))
    bus.subscribe((o) => b.push(o.key))
    bus.emit({ key: 'k', value: 1 })
    bus.emit({ key: 'k', value: 'two', unit: 'x', configHash: 'h' })
    offA()
    bus.emit({ key: 'j', value: 3 })
    expect(a).toEqual(['k=1', 'k=two'])
    expect(b).toEqual(['k', 'k', 'j'])
  })

  test('drops what cannot be graded: no key, NaN, Infinity, a non-scalar', () => {
    const bus = createObservationBus()
    const got: Observation[] = []
    bus.subscribe((o) => got.push(o))
    bus.emit({ key: '', value: 1 })
    bus.emit({ key: 'k', value: Number.NaN })
    bus.emit({ key: 'k', value: Infinity })
    bus.emit({ key: 'k', value: {} as unknown as number })
    bus.emit(null as unknown as Observation)
    bus.emit({ key: 'k', value: 0 })
    expect(got).toEqual([{ key: 'k', value: 0 }])
  })

  test('a listener that unsubscribes while being called does not break the others', () => {
    const bus = createObservationBus()
    const seen: number[] = []
    const off = bus.subscribe(() => {
      seen.push(1)
      off()
    })
    bus.subscribe(() => seen.push(2))
    bus.emit({ key: 'k', value: 1 })
    bus.emit({ key: 'k', value: 1 })
    expect(seen).toEqual([1, 2, 2])
  })

  test('the finished store notifies once per task and bumps its version', () => {
    const s = createFinishedStore()
    let n = 0
    s.subscribe(() => n++)
    s.add('a')
    s.add('a')
    s.add('b')
    expect([n, s.version(), s.has('a'), s.has('c')]).toEqual([2, 2, true, false])
  })
})

const NUM: PredictSpec = { kind: 'numeric', prompt: 'p', unit: 'FLOP/B', tolerance: { rel: 0.1 } }
const LOG: PredictSpec = { kind: 'numeric', prompt: 'p', unit: 'FLOP/B', tolerance: { rel: 0.1 }, log: true }
const CHOICE: PredictSpec = { kind: 'choice', prompt: 'p', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }

describe('predictions (§10.3)', () => {
  test('parseNumeric accepts separators and exponents, rejects prose', () => {
    expect(parseNumeric('1,234.5')).toBe(1234.5)
    expect(parseNumeric(' 295 ')).toBe(295)
    expect(parseNumeric('1e3')).toBe(1000)
    expect(parseNumeric('-0.5')).toBe(-0.5)
    for (const bad of ['', ' ', 'abc', '12 GB', '1.2.3', 'Infinity', '--1', '0x10']) expect(parseNumeric(bad)).toBeNull()
  })

  test('checkPrediction: a number, a positive number for log, or one of the options', () => {
    expect(checkPrediction(NUM, { text: '295' })).toEqual({ value: 295 })
    expect(checkPrediction(NUM, { text: 'x' })).toBeNull()
    expect(checkPrediction(LOG, { text: '0' })).toBeNull()
    expect(checkPrediction(LOG, { text: '-4' })).toBeNull()
    expect(checkPrediction(LOG, { text: '4' })).toEqual({ value: 4 })
    expect(checkPrediction(CHOICE, { choice: 'b' })).toEqual({ choice: 'b' })
    expect(checkPrediction(CHOICE, { choice: 'z' })).toBeNull()
    expect(checkPrediction(CHOICE, { text: 'a' })).toBeNull()
  })

  test('numeric: within the relative or the absolute tolerance, whichever the spec gives', () => {
    expect(gradePrediction(NUM, { value: 100 }, 105)).toMatchObject({ ok: true, score: 1 })
    expect(gradePrediction(NUM, { value: 100 }, 111.2)?.ok).toBe(false)
    const abs: PredictSpec = { kind: 'numeric', prompt: 'p', unit: 'x', tolerance: { abs: 2 } }
    expect(gradePrediction(abs, { value: 10 }, 12)?.ok).toBe(true)
    expect(gradePrediction(abs, { value: 10 }, 12.1)?.ok).toBe(false)
    const both: PredictSpec = { kind: 'numeric', prompt: 'p', unit: 'x', tolerance: { abs: 0.5, rel: 0.1 } }
    expect(gradePrediction(both, { value: 1000 }, 1090)?.ok).toBe(true) // rel is the wider band here
    expect(gradePrediction(both, { value: 0 }, 0.4)?.ok).toBe(true) // abs is
  })

  test('numeric misses score down to 0 at five tolerances out; the score is never above 1 or below 0', () => {
    const g = (p: number) => gradePrediction(NUM, { value: p }, 100)!
    expect(g(120).score).toBeCloseTo(0.75, 5)
    expect(g(150).score).toBe(0)
    expect(g(1e9).score).toBe(0)
    for (const p of [0, 50, 89, 111, 500, -3]) {
      expect(g(p).score).toBeGreaterThanOrEqual(0)
      expect(g(p).score).toBeLessThanOrEqual(1)
    }
  })

  test('log: within a factor of 2 either way; an order of magnitude scores 0; the signed log10 error is kept', () => {
    expect(gradePrediction(LOG, { value: 200 }, 100)).toMatchObject({ ok: true, score: 1, logErr: 0.301 })
    expect(gradePrediction(LOG, { value: 50 }, 100)).toMatchObject({ ok: true, logErr: -0.301 })
    expect(gradePrediction(LOG, { value: 201 }, 100)?.ok).toBe(false)
    expect(gradePrediction(LOG, { value: 1000 }, 100)).toMatchObject({ ok: false, score: 0, logErr: 1 })
    const near = gradePrediction(LOG, { value: 300 }, 100)!
    expect(near.ok).toBe(false)
    expect(near.score).toBeGreaterThan(0.6)
    expect(near.score).toBeLessThan(1)
  })

  test('log with a non-positive side is a miss, not NaN', () => {
    expect(gradePrediction(LOG, { value: 5 }, 0)).toEqual({ ok: false, score: 0 })
    expect(gradePrediction(LOG, { value: 5 }, -2)).toEqual({ ok: false, score: 0 })
  })

  test('numeric accepts a numeric string observation, and refuses what is not a number', () => {
    expect(gradePrediction(NUM, { value: 100 }, '100')?.ok).toBe(true)
    expect(gradePrediction(NUM, { value: 100 }, 'fast')).toBeNull()
    expect(gradePrediction(NUM, { value: 100 }, '')).toBeNull()
    expect(gradePrediction(NUM, { choice: 'a' }, 1)).toBeNull()
  })

  test('choice: equal to the observed option id', () => {
    expect(gradePrediction(CHOICE, { choice: 'a' }, 'a')).toEqual({ ok: true, score: 1 })
    expect(gradePrediction(CHOICE, { choice: 'a' }, 'b')).toEqual({ ok: false, score: 0 })
    expect(gradePrediction(CHOICE, { value: 1 }, 'a')).toBeNull()
  })
})

describe('phone mode (§10.4)', () => {
  test('phone below 640 px or on a coarse pointer, unless today:prefs.phoneMode is false', () => {
    expect(resolveInlineMode(true, undefined)).toBe('phone')
    expect(resolveInlineMode(true, {})).toBe('phone')
    expect(resolveInlineMode(true, { phoneMode: true })).toBe('phone')
    expect(resolveInlineMode(true, { phoneMode: false })).toBe('embed')
    expect(resolveInlineMode(false, { phoneMode: true })).toBe('embed')
    expect(resolveInlineMode(false, null)).toBe('embed')
    expect(resolveInlineMode(true, 'phoneMode')).toBe('phone')
  })

  test('the laptop queue: newest 20, a repeated task moves to the end, junk is dropped', () => {
    const item = (n: number) => ({ simId: 'sim-kv', taskId: `t${n}`, at: `2026-10-05T09:${String(n).padStart(2, '0')}:00.000Z` })
    let q: unknown = undefined
    for (let n = 0; n < 25; n++) q = queueForLaptop(q, item(n))
    const list = q as ReturnType<typeof parseLaptopQueue>
    expect(LAPTOP_QUEUE_MAX).toBe(20)
    expect(list).toHaveLength(20)
    expect(list[0].taskId).toBe('t5') // the oldest five dropped
    expect(list[19].taskId).toBe('t24')
    const again = queueForLaptop(list, { ...item(10), at: '2026-10-06T00:00:00.000Z' })
    expect(again).toHaveLength(20)
    expect(again[19]).toMatchObject({ taskId: 't10', at: '2026-10-06T00:00:00.000Z' })
    expect(again.filter((x) => x.taskId === 't10')).toHaveLength(1)
    expect(parseLaptopQueue([{ simId: 1 }, null, 'x', item(1)])).toEqual([item(1)])
    expect(parseLaptopQueue('nope')).toEqual([])
  })

  test('phone.canonical is <model>.<name>', () => {
    expect(splitCanonical('roofline.b200-ridge')).toEqual({ model: 'roofline', name: 'b200-ridge' })
    expect(splitCanonical('kv.a.b')).toEqual({ model: 'kv', name: 'a.b' })
    for (const bad of ['', 'roofline', '.x', 'x.']) expect(splitCanonical(bad)).toBeNull()
  })
})

describe('mirror announcements (§10.5)', () => {
  test('at most one per second: the first is immediate, a later one waits out the gap', () => {
    expect(ANNOUNCE_MIN_GAP_MS).toBe(1000)
    expect(announceDelay(null, 5_000)).toBe(0)
    expect(announceDelay(5_000, 5_300)).toBe(700)
    expect(announceDelay(5_000, 6_000)).toBe(0)
    expect(announceDelay(5_000, 9_000)).toBe(0)
  })
})

describe('verify-plays: the canvas-mirror check (§10.5)', () => {
  const file = (name: string, text: string) => ({ file: name, text })
  const status = (text: string) => checkCanvasMirrors([file('S.tsx', text)])[0]?.status

  test('a canvas with a mirror passes, with the waiver passes as waived, with neither fails', () => {
    expect(status('<canvas ref={r} />\n<SimMirror id="m" table={t} />')).toBe('mirrored')
    expect(status(`${WAIVER}\nconst a = <canvas className="x" />`)).toBe('waived')
    expect(status('const a = <canvas />')).toBe('missing')
  })

  test('a mirror plus the waiver is a stale waiver', () => {
    expect(status(`${WAIVER}\n<canvas />\n<SimMirror id="m" table={t} />`)).toBe('stale-waiver')
  })

  test('a file with no canvas is not listed; counts every canvas', () => {
    expect(checkCanvasMirrors([file('A.tsx', 'const x = 1')])).toEqual([])
    expect(checkCanvasMirrors([file('B.tsx', `${WAIVER}\n<canvas ref={a} />\n<canvas\n  ref={b}\n/>`)])[0].canvases).toBe(2)
  })

  test('<canvas and <SimMirror named in a comment count for nothing', () => {
    expect(status('/** draws on a <canvas> */\n// <SimMirror here later\nconst x = 1')).toBeUndefined()
    expect(status('// <SimMirror is coming\nconst a = <canvas />')).toBe('missing')
    expect(status('const a = <canvas />\n// a11y-mirror-pending: wave 2 (a note, not the waiver line)\n')).toBe('missing')
  })

  test('the waiver must be a line of its own, not inside a block comment line with other text', () => {
    expect(status(`/* ${WAIVER} */\n<canvas />`)).toBe('missing')
    expect(status(`  ${WAIVER}  \n<canvas />`)).toBe('waived')
  })
})
