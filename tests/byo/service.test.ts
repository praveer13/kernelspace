/**
 * The bring-your-own-service capstone (docs/specs/wave-3.md §16.8; task 3s-10). A trace through parseTraceArtifact (kind
 * local-derived) or a CSV converted locally, a config through the zoo reader and an atlas row give KV per token, a batching
 * run on a 400-request sample in the fleet worker, and $/Mtok at a dated price. Nothing is uploaded or stored, and the
 * summary downloads as a file.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FLEET_TRAFFIC_PROFILES, parseTraceArtifact, type TraceArtifact } from '../../src/lib/traces'
import { Engine, HEADROOM_TOKENS as ENGINE_HEADROOM, SIM_TICK_SECONDS, makeRefManager, makeRefQueue, makeRefScheduler } from '../../src/lib/fleet-model'
import { createFleetHost } from '../../src/lib/fleet-host'
import type { FleetWorkerLike } from '../../src/lib/fleet-session'
import type { FleetReply, FleetRequest } from '../../src/workers/fleet-protocol'
import { zooBytes, type ZooModel } from '../../src/lib/kv-zoo'
import {
  BLOCK_SIZE,
  ByoError,
  DRAIN_CAP_TICKS,
  HEADROOM_TOKENS,
  MAX_ARRIVAL_TICK,
  NOTES,
  PREFILL_CHUNK,
  PRICE_CLAIMS,
  SAMPLE_SIZE,
  SERVICE_HARDWARE,
  SUMMARY_FILE,
  TICK_SECONDS,
  batchingResult,
  buildSummary,
  costOf,
  csvToTraceArtifact,
  defaultPrice,
  engineOpen,
  fitsPool,
  formatBytes,
  kvAt,
  percentile,
  planPool,
  priceAgeDays,
  readConfig,
  readSettings,
  readTraceFile,
  runBatching,
  sampleShape,
  splitCsvLine,
  summaryText,
  takeSample,
  type SettingsForm,
} from '../../src/lib/byo-service'

const root = join(import.meta.dir, '..', '..')
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8')

/* ----------------------------- fixtures ----------------------------- */

/** Llama-3-8B's attention shape: 32 layers, 8 KV heads of 128. */
const LLAMA = JSON.stringify({ num_hidden_layers: 32, num_attention_heads: 32, num_key_value_heads: 8, head_dim: 128, hidden_size: 4096 })

/** A CSV of n requests, one every 0.5 s, prompts 200-1,000 and outputs 20-100: a function of the row only. */
function makeCsv(n: number, header = 'arrival_s,prompt_tokens,output_tokens'): string {
  const rows = [header]
  for (let i = 0; i < n; i++) rows.push(`${(i * 0.5).toFixed(1)},${200 + ((i * 37) % 9) * 100},${20 + ((i * 11) % 9) * 10}`)
  return rows.join('\n') + '\n'
}

const FORM: SettingsForm = {
  hardwareId: 'h100',
  gpus: '1',
  weightsGb: '16',
  hbmShare: '0.9',
  maxRunning: '64',
  sloMs: '2000',
  priceUsd: '3.49',
  priceDate: '2026-10-04',
}
const TODAY = '2026-10-15'

function settingsOf(over: Partial<SettingsForm> = {}) {
  const r = readSettings({ ...FORM, ...over }, TODAY)
  if (!r.ok) throw new Error(`settings: ${JSON.stringify(r.errors)}`)
  return r.settings
}

/** The real fleet host behind an in-process worker: what fleet.worker.ts does, minus the thread. */
class FakeWorker implements FleetWorkerLike {
  onmessage: FleetWorkerLike['onmessage'] = null
  onerror: FleetWorkerLike['onerror'] = null
  terminated = false
  private readonly host = createFleetHost()
  constructor(private readonly script?: (req: FleetRequest, emit: (r: FleetReply) => void) => void) {
    queueMicrotask(() => this.deliver({ type: 'boot' }))
  }
  private deliver(reply: FleetReply) {
    if (!this.terminated) this.onmessage?.({ data: reply })
  }
  postMessage(msg: FleetRequest) {
    if (this.terminated) return
    setTimeout(() => {
      if (this.script) this.script(msg, (r) => this.deliver(r))
      else void this.host.handle(msg, (r) => this.deliver(r))
    }, 0)
  }
  terminate() {
    this.terminated = true
  }
}

/* ----------------------------- constants ----------------------------- */

describe('constants copied from the engine stay equal to it', () => {
  test('tick, headroom, prefill chunk', () => {
    expect(TICK_SECONDS).toBe(SIM_TICK_SECONDS)
    expect(HEADROOM_TOKENS).toBe(ENGINE_HEADROOM)
    expect(new Set(FLEET_TRAFFIC_PROFILES.map((p) => p.config.prefillChunk))).toEqual(new Set([PREFILL_CHUNK]))
    expect(new Set(FLEET_TRAFFIC_PROFILES.map((p) => p.config.blockSize))).toEqual(new Set([BLOCK_SIZE]))
    expect(SAMPLE_SIZE).toBe(400)
  })
})

/* ------------------------------ the trace ------------------------------ */

describe('a CSV converts locally into a local-derived artifact that parseTraceArtifact reads', () => {
  test('seconds to ticks, moved to start at 0, sorted, and the artifact survives the parser again', async () => {
    const csv = 'Arrival_S, Prompt_Tokens ,output_tokens,extra\n10.0,300,40,x\n9.0,500,60,y\n10.0,100,5,z\n'
    const a = await csvToTraceArtifact('my.csv', csv)
    expect(a.kind).toBe('local-derived')
    expect(a.name).toBe('my.csv')
    // 9.0 s is the first; 10.0 s is 1 s = 20 ticks later; equal arrivals keep the file's order
    expect(a.requests).toEqual([
      { t: 0, p: 500, o: 60 },
      { t: 20, p: 300, o: 40 },
      { t: 20, p: 100, o: 5 },
    ])
    expect(a.requestCount).toBe(3)
    expect(await parseTraceArtifact(JSON.parse(JSON.stringify(a)))).toEqual(a)
  })

  test('milliseconds and ticks, BOM, CRLF, quoted cells and blank lines', async () => {
    const ms = await csvToTraceArtifact('ms.csv', '﻿"arrival_ms","input_tokens","completion_tokens"\r\n\r\n"1000","10","2"\r\n1100,20,3\r\n')
    expect(ms.requests).toEqual([{ t: 0, p: 10, o: 2 }, { t: 2, p: 20, o: 3 }])
    const ticks = await csvToTraceArtifact('t.csv', 't,p,o\n5,1,1\n7,2,2\n')
    expect(ticks.requests).toEqual([{ t: 0, p: 1, o: 1 }, { t: 2, p: 2, o: 2 }])
    expect(splitCsvLine('a,"b,c","d ""e"""')).toEqual(['a', 'b,c', 'd "e"'])
  })

  test('every problem is a sentence naming the line or the header', async () => {
    const bad = async (name: string, text: string) => {
      const e = await csvToTraceArtifact(name, text).then(() => null, (x: unknown) => x)
      expect(e).toBeInstanceOf(ByoError)
      return (e as Error).message
    }
    expect(await bad('a.csv', '')).toContain('empty')
    expect(await bad('a.csv', 'arrival_s,prompt_tokens,output_tokens\n')).toContain('no requests')
    expect(await bad('a.csv', 'prompt_tokens,output_tokens\n1,1\n')).toContain('one arrival column')
    expect(await bad('a.csv', 'arrival_s,t,p,o\n1,1,1,1\n')).toContain('more than one arrival column')
    expect(await bad('a.csv', 'arrival_s,p\n1,1\n')).toContain('output column')
    expect(await bad('a.csv', 'arrival_s,p,o\n0,5,5\n1,5.5,5\n')).toContain('line 3: p must be a whole number')
    expect(await bad('a.csv', 'arrival_s,p,o\n0,5,0\n')).toContain('line 2: o must be a whole number of at least 1')
    expect(await bad('a.csv', 'arrival_s,p,o\n-1,5,5\n')).toContain('line 2: arrival_s must be a number of at least 0')
    expect(await bad('a.csv', 'arrival_s,p,o\nsoon,5,5\n')).toContain('"soon"')
  })

  test('a span past the parser\'s 10,000,000 ticks is refused at the first CSV line past it, before the parser numbers it by sorted index', async () => {
    // the parser's own refusal, for the record: it names the request's index after sorting
    const raw = { schemaVersion: 1, id: 'x', name: 'x', kind: 'local-derived', source: 's', sourceRevision: 'r', license: 'l', attribution: 'a', note: 'n', sampling: {}, requestCount: 2, requestSha256: '0'.repeat(64) }
    await expect(parseTraceArtifact({ ...raw, requests: [{ t: 0, p: 1, o: 1 }, { t: MAX_ARRIVAL_TICK + 1, p: 1, o: 1 }] })).rejects.toThrow('trace request 1 has invalid arrival tick')
    expect(MAX_ARRIVAL_TICK).toBe(10_000_000)

    // the file is out of order, so the late row is line 3 in the file and index 1 after the sort; the learner gets line 3
    const rows = 'arrival_s,prompt_tokens,output_tokens\n300000,5,5\n0,5,5\n500000.05,5,5\n'
    const e = (await csvToTraceArtifact('long.csv', rows).then(() => null, (x: unknown) => x)) as Error
    expect(e).toBeInstanceOf(ByoError)
    expect(e.message).toStartWith('line 4: this request arrives 500,000 s after the earliest one')
    expect(e.message).toContain('at most 10,000,000 ticks (500,000 s, about 5.8 days)')
    expect(e.message).toContain('this file spans 500,000 s')
    expect(e.message).not.toContain('trace request')

    // the first line in file order that is past the limit is the one named
    const two = await csvToTraceArtifact('two.csv', 't,p,o\n0,5,5\n10000002,5,5\n10000001,5,5\n').then(() => null, (x: unknown) => x as Error)
    expect((two as Error).message).toStartWith('line 3: ')
  })

  test('exactly 10,000,000 ticks is read; one more is not, in each arrival unit', async () => {
    const ok = await csvToTraceArtifact('edge.csv', 't,p,o\n5,1,1\n10000005,1,1\n')
    expect(ok.requests.map((r) => r.t)).toEqual([0, MAX_ARRIVAL_TICK])
    await expect(csvToTraceArtifact('edge.csv', 't,p,o\n5,1,1\n10000006,1,1\n')).rejects.toThrow('line 3')
    // 500,000 s is 10,000,000 ticks; 500,000.05 s is one more
    expect((await csvToTraceArtifact('s.csv', 'arrival_s,p,o\n0,1,1\n500000,1,1\n')).requests[1].t).toBe(MAX_ARRIVAL_TICK)
    await expect(csvToTraceArtifact('s.csv', 'arrival_s,p,o\n0,1,1\n500000.05,1,1\n')).rejects.toThrow('line 3')
    expect((await csvToTraceArtifact('ms.csv', 'arrival_ms,p,o\n0,1,1\n500000000,1,1\n')).requests[1].t).toBe(MAX_ARRIVAL_TICK)
    await expect(csvToTraceArtifact('ms.csv', 'arrival_ms,p,o\n0,1,1\n500000050,1,1\n')).rejects.toThrow('line 3')
  })

  test('50,000 rows is the parser\'s limit, said before the parser says it', async () => {
    const big = 't,p,o\n' + '0,1,1\n'.repeat(50_001)
    await expect(csvToTraceArtifact('big.csv', big)).rejects.toThrow('more than 50,000')
    const edge = await csvToTraceArtifact('edge.csv', 't,p,o\n' + '0,1,1\n'.repeat(50_000))
    expect(edge.requestCount).toBe(50_000)
  })
})

describe('a JSON trace goes through parseTraceArtifact and must be local-derived', () => {
  test('a local-derived artifact is read; a recorded one, a tampered one and a non-trace are not', async () => {
    const local = await csvToTraceArtifact('mine.csv', makeCsv(10))
    expect(await readTraceFile('mine.json', JSON.stringify(local))).toEqual(local)

    const shipped = read('public/traces/kimi-conversation.json')
    // the shipped artifact is a valid trace, so the refusal is about its kind and nothing else
    const shippedArtifact: TraceArtifact = await parseTraceArtifact(JSON.parse(shipped))
    expect(shippedArtifact.kind).toBe('recorded')
    await expect(readTraceFile('kimi.json', shipped)).rejects.toThrow('"recorded"')

    const tampered = { ...local, requests: local.requests.map((r, i) => (i === 0 ? { ...r, p: r.p + 1 } : r)) }
    await expect(readTraceFile('t.json', JSON.stringify(tampered))).rejects.toThrow('checksum mismatch')
    await expect(readTraceFile('t.json', '{"rows":[]}')).rejects.toThrow('not a trace artifact')
    await expect(readTraceFile('t.json', 'nope')).rejects.toThrow('not JSON')
    await expect(readTraceFile('t.txt', '{}')).rejects.toThrow('.json trace or a .csv')
  })
})

describe('the sample is the first 400 requests, moved to start at tick 0', () => {
  test('400 of 1,000; all of 30; a first arrival that is not 0 is moved', async () => {
    const big = await csvToTraceArtifact('big.csv', makeCsv(1000))
    const s = takeSample(big)
    expect(s).toHaveLength(400)
    expect(s[0].t).toBe(0)
    expect(s[399]).toEqual(big.requests[399])
    expect(takeSample(await csvToTraceArtifact('s.csv', makeCsv(30)))).toHaveLength(30)

    const shifted = { ...big, requests: big.requests.map((r) => ({ ...r, t: r.t + 500 })) }
    expect(takeSample(shifted)[0].t).toBe(0)
    expect(takeSample(shifted)[399].t).toBe(big.requests[399].t)
  })

  test('the shape: nearest-rank percentiles of the final context', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10)
    expect(percentile([], 0.5)).toBe(0)
    const shape = sampleShape([{ t: 0, p: 100, o: 10 }, { t: 4, p: 200, o: 20 }, { t: 9, p: 400, o: 40 }])
    expect(shape).toEqual({ requests: 3, spanTicks: 9, promptMedian: 200, outputMedian: 20, contextP50: 220, contextP95: 440, contextMax: 440 })
  })
})

/* ------------------------------- the model ------------------------------- */

describe('KV per token comes from the zoo reader', () => {
  test('Llama-3-8B shape: 2 (K and V) × 8 heads × 128 × 2 bytes × 32 layers = 131,072 bytes a token, at any context', () => {
    const model = readConfig(LLAMA, 'llama')
    for (const t of [1, 300, 12_345]) {
      const kv = kvAt(model, t)
      expect(kv.bytesPerToken).toBe(2 * 8 * 128 * 2 * 32)
      expect(kv.storedBytes).toBe(zooBytes(model, t).stored)
    }
  })

  test('a sliding-window model stores less per token as the context grows (the page reads two contexts for that)', () => {
    const swa: ZooModel = {
      id: 'x',
      name: 'x',
      note: '',
      claimIds: [],
      groups: [{ count: 10, label: 'swa', layer: { kind: 'swa', kvHeads: 8, headDim: 64, window: 128, sinks: 0 } }],
    }
    const small = kvAt(swa, 100)
    const big = kvAt(swa, 10_000)
    // below the window every token is stored: 2 × 8 × 64 × 2 bytes × 10 layers = 20,480 a token; past it the cache stops growing
    expect(small.bytesPerToken).toBe(20_480)
    expect(big.storedBytes).toBe(20_480 * 128)
    expect(big.bytesPerToken).toBeCloseTo((20_480 * 128) / 10_000, 9)
    expect(big.bytesPerToken).toBeLessThan(small.bytesPerToken)
  })

  test('a config the reader cannot read is the reader\'s own sentence', () => {
    expect(() => readConfig('not json', 'c')).toThrow(ByoError)
    expect(() => readConfig('not json', 'c')).toThrow('not JSON')
    expect(() => readConfig('{"num_hidden_layers":4}', 'c')).toThrow('needs')
    expect(() => kvAt(readConfig(LLAMA, 'l'), 0)).toThrow(RangeError)
  })
})

/* ---------------------- hardware, settings and the price ---------------------- */

describe('hardware and a dated price', () => {
  test('the chips on offer carry a capacity; B300 and TPU7x do not', () => {
    const ids = SERVICE_HARDWARE.map((r) => r.id)
    expect(ids).toContain('h100')
    expect(ids).not.toContain('b300')
    expect(ids).not.toContain('tpu7x')
    for (const r of SERVICE_HARDWARE) expect(r.hbmGb).toBeGreaterThan(0)
  })

  test('H100 and B200 default to the atlas\'s dated medians; the others have none', () => {
    const h = defaultPrice('h100', new Date('2026-10-15T00:00:00Z'))
    expect(h).toEqual({ usdPerGpuHour: 3.49, asOf: '2026-10-04', claimId: 'price.h100.median', staleSince: null })
    expect(defaultPrice('b200', new Date('2026-10-15T00:00:00Z'))?.usdPerGpuHour).toBe(7.01)
    // verified 2026-10-04 + 90 days
    expect(defaultPrice('h100', new Date('2027-01-10T00:00:00Z'))?.staleSince).toBe('2027-01-02')
    expect(defaultPrice('a100-80', new Date('2026-10-15T00:00:00Z'))).toBeNull()
    for (const id of Object.keys(PRICE_CLAIMS)) expect(SERVICE_HARDWARE.map((r) => r.id)).toContain(id)
  })

  test('price age counts calendar days and refuses dates that do not exist', () => {
    expect(priceAgeDays('2026-10-04', '2026-10-15')).toBe(11)
    expect(priceAgeDays('2026-02-30', '2026-10-15')).toBeNull()
    expect(priceAgeDays('10/04/2026', '2026-10-15')).toBeNull()
    expect(priceAgeDays('2026-10-16', '2026-10-15')).toBe(-1)
  })

  test('the form reads whole, and each wrong field says what is wrong', () => {
    const s = settingsOf()
    expect(s.hardware.id).toBe('h100')
    expect(s.sloTicks).toBe(40)
    expect(readSettings({ ...FORM, sloMs: '2001' }, TODAY)).toMatchObject({ ok: true, settings: { sloTicks: 41 } })
    const bad = readSettings({ hardwareId: 'b300', gpus: '0', weightsGb: '', hbmShare: '1.5', maxRunning: '1.5', sloMs: '10', priceUsd: '-1', priceDate: '2026-10-16' }, TODAY)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['gpus', 'hardwareId', 'hbmShare', 'maxRunning', 'priceDate', 'priceUsd', 'sloMs', 'weightsGb'])
    const badDate = readSettings({ ...FORM, priceDate: 'yesterday' }, TODAY)
    expect(badDate.ok).toBe(false)
  })
})

describe('the pool', () => {
  const sample = Array.from({ length: 50 }, (_, i) => ({ t: i * 10, p: 300 + (i % 5) * 100, o: 40 + (i % 3) * 20 }))

  test('H100, 16 GB of weights, 90 % of 80 GB: 56 GB of cache, 26,702 blocks of 16 tokens at 131,072 bytes a token', () => {
    // 0.9 × 80e9 − 16e9 = 56e9 bytes; one block is 16 × 131,072 = 2,097,152 bytes; 56e9 / 2,097,152 = 26,702.88
    const plan = planPool(sample, settingsOf(), 131_072)
    expect(plan.kvBudgetBytes).toBe(56e9)
    expect(plan.blocksCapacity).toBe(26_702)
    expect(plan.tooLong).toBe(0)
    expect(plan.kept).toHaveLength(50)
  })

  test('the opened pool is capped at what the whole sample could ever hold, and the run does not change', () => {
    const plan = planPool(sample, settingsOf(), 131_072)
    const sum = sample.reduce((n, r) => n + r.p + r.o + HEADROOM_TOKENS, 0)
    expect(plan.blocks).toBe(Math.ceil(sum / BLOCK_SIZE) + sample.length)
    expect(plan.blocks).toBeLessThan(plan.blocksCapacity)
    expect(plan.poolCapped).toBe(true)
    expect(plan.poolTokens).toBe(plan.blocks * BLOCK_SIZE)
  })

  test('weights that leave no cache, and a pool no request fits, are named', () => {
    expect(() => planPool(sample, settingsOf({ weightsGb: '72' }), 131_072)).toThrow('leave no room')
    expect(() => planPool(sample, settingsOf({ weightsGb: '71.99' }), 131_072)).toThrow('no request of the sample fits')
    expect(() => planPool(sample, settingsOf({ weightsGb: '71.99' }), 131_072)).toThrow(ByoError)
  })

  test('a request that cannot fit alone is counted, not run', () => {
    // the cache holds 427,232 tokens (26,702 blocks); two requests are longer than that
    const mixed = [...sample, { t: 600, p: 500_000, o: 10 }, { t: 610, p: 100, o: 500_000 }]
    const plan = planPool(mixed, settingsOf(), 131_072)
    expect(plan.blocksCapacity * BLOCK_SIZE).toBeLessThan(500_000)
    expect(plan.tooLong).toBe(2)
    expect(plan.kept).toHaveLength(50)
    expect(fitsPool({ t: 0, p: 1, o: 1 }, HEADROOM_TOKENS + 1)).toBe(true)
    expect(fitsPool({ t: 0, p: 1, o: 1 }, HEADROOM_TOKENS)).toBe(false)
    expect(fitsPool({ t: 0, p: 100, o: 100 }, 200)).toBe(true)
    expect(fitsPool({ t: 0, p: 100, o: 101 }, 200)).toBe(false)
  })
})

/* --------------------------- the batching run --------------------------- */

async function pipeline(csvRows: number, over: Partial<SettingsForm> = {}, configText: string = LLAMA) {
  const artifact = await csvToTraceArtifact('mine.csv', makeCsv(csvRows))
  const sample = takeSample(artifact)
  const shape = sampleShape(sample)
  const model = readConfig(configText, 'llama')
  const settings = settingsOf(over)
  const p50 = kvAt(model, shape.contextP50)
  const p95 = kvAt(model, shape.contextP95)
  const plan = planPool(sample, settings, p50.bytesPerToken)
  return { artifact, sample, shape, model, settings, p50, p95, plan }
}

describe('the batching run in the fleet worker', () => {
  test('a 400-request sample drains, delivers every token, and equals a direct run of the same engine', async () => {
    const { sample, settings, plan } = await pipeline(600)
    expect(sample).toHaveLength(400)
    const progress: number[] = []
    const snap = await runBatching(plan, settings, { spawn: () => new FakeWorker(), onProgress: (done) => progress.push(done) })
    const result = batchingResult(snap, plan)
    expect(snap.mode).toBe('engine')
    expect(snap.total).toBe(400)
    expect(result.finished).toBe(true)
    expect(result.completed).toBe(400)
    expect(result.inputTokens).toBe(sample.reduce((n, r) => n + r.p, 0))
    expect(result.outputTokens).toBe(sample.reduce((n, r) => n + r.o, 0))
    expect(result.shed).toBe(0)
    expect(progress.at(-1)).toBe(400)

    // the same engine, built by hand, one tick at a time: the worker's run is the engine's run
    const open = engineOpen(plan, settings)
    const e = new Engine(open.cfg.engine, open.traffic, makeRefScheduler(), makeRefManager(open.cfg.engine.numBlocks, BLOCK_SIZE), {
      intake: makeRefQueue(open.cfg.intakeCap),
      drainPerTick: open.cfg.drainPerTick,
    })
    while (!e.done) e.step()
    expect(e.tick).toBe(result.ticks)
    expect(e.stats().completed).toBe(result.completed)
    expect(e.stats().sloMet).toBe(result.sloMet)
    expect(e.ttftP95() * TICK_SECONDS * 1000).toBeCloseTo(result.ttftP95Ms, 1)
  })

  test('a pool bigger than the sample could ever fill runs exactly as the capped one does', async () => {
    const { settings, plan } = await pipeline(200)
    const bigger = { ...plan, blocks: plan.blocks * 10 }
    const a = batchingResult(await runBatching(plan, settings, { spawn: () => new FakeWorker() }), plan)
    const b = batchingResult(await runBatching(bigger, settings, { spawn: () => new FakeWorker() }), plan)
    expect(b).toEqual(a)
  })

  test('a tight pool still drains: requests that fit alone finish, however slowly', async () => {
    // 40 GB of weights leaves 32 GB: 15,258 blocks of 2,097,152 bytes at 131,072 bytes a token
    const { settings, plan } = await pipeline(400, { weightsGb: '40' })
    const loose = await pipeline(400)
    expect(plan.blocksCapacity).toBeLessThan(loose.plan.blocksCapacity)
    const tight = { ...plan, blocks: 150, kept: plan.kept.filter((r) => fitsPool(r, 150 * BLOCK_SIZE)) }
    expect(tight.kept.length).toBe(plan.kept.length)
    const r = batchingResult(await runBatching(tight, settings, { spawn: () => new FakeWorker() }), { kept: tight.kept, tooLong: 0 })
    expect(r.finished).toBe(true)
    expect(r.completed).toBe(tight.kept.length)
    // 150 blocks hold 2,400 tokens: a handful of requests at a time, so requests wait for a block
    expect(r.queueP95Ms).toBeGreaterThan(0)
  })

  test('a request exactly the size of the pool finishes; one token over is not run', async () => {
    const fit = [{ t: 0, p: 100, o: 60 }]
    const plan = { blocks: 10, kept: fit }
    const r = batchingResult(await runBatching(plan, { maxRunning: 4, sloTicks: 40 }, { spawn: () => new FakeWorker() }), { kept: fit, tooLong: 0 })
    expect(r.finished).toBe(true)
    expect(r.completed).toBe(1)
    // 10 blocks × 16 = 160 tokens = 100 + 60
    expect(fitsPool(fit[0], 160)).toBe(true)
    expect(fitsPool({ t: 0, p: 100, o: 61 }, 160)).toBe(false)
  })

  test('the tick cap stops a run that never drains and says so', async () => {
    const canned = (tick: number): FleetReply =>
      ({
        type: 'step',
        id: 0,
        snapshot: {
          mode: 'engine',
          tick,
          mine: { met: 0, done: 0, p95: 0, tpotP95: 0, queueP95: 0, inputTokens: 0, outputTokens: 0, autoPreempts: 0, capMisses: 0, shed: 0, waiting: 1, running: 0 },
          reference: { met: 0, done: 0, p95: 0 },
          dump: { numBlocks: 10, blockSize: 16, free: 10, refs: new Map(), seqs: new Map() },
          violations: [],
          divergence: null,
          done: false,
          total: 1,
        },
      }) as FleetReply
    let ticks = 0
    const stuck = () =>
      new FakeWorker((req, emit) => {
        if (req.cmd === 'open') emit({ type: 'ready', id: req.id, total: 1 })
        else {
          ticks += 100_000
          emit({ ...canned(ticks), id: req.id } as FleetReply)
        }
      })
    const plan = { blocks: 10, kept: [{ t: 0, p: 10, o: 10 }] }
    const snap = await runBatching(plan, { maxRunning: 4, sloTicks: 40 }, { spawn: stuck })
    expect(snap.done).toBe(false)
    expect(snap.tick).toBeGreaterThanOrEqual(DRAIN_CAP_TICKS)
    expect(snap.tick).toBeLessThan(DRAIN_CAP_TICKS + 100_001)
    expect(batchingResult(snap, { kept: plan.kept, tooLong: 0 }).finished).toBe(false)
  })

  test('a cancelled run rejects with an AbortError and stops the worker', async () => {
    const { settings, plan } = await pipeline(100)
    let worker: FakeWorker | undefined
    const ctl = new AbortController()
    ctl.abort()
    const e = await runBatching(plan, settings, { spawn: () => (worker = new FakeWorker()), signal: ctl.signal }).then(() => null, (x: unknown) => x)
    expect((e as Error).name).toBe('AbortError')
    expect(worker?.terminated).toBe(true)
  })
})

/* -------------------------------- the price -------------------------------- */

describe('$/Mtok at a dated price', () => {
  test('an hour of eight H100s at $3.49 is $27.92; over 1,000,000 tokens that is $27.92 per Mtok', () => {
    // 72,000 ticks × 0.05 s = 3,600 s = 1 h; 8 GPUs × 1 h × $3.49 = $27.92
    const c = costOf({ ticks: 72_000, inputTokens: 600_000, outputTokens: 400_000 }, { gpus: 8, priceUsd: 3.49, priceDate: '2026-10-04' })
    expect(c.gpuHours).toBeCloseTo(8, 9)
    expect(c.dollars).toBeCloseTo(27.92, 9)
    expect(c.perMtok).toBeCloseTo(27.92, 9)
    expect(c.perMtokOutput).toBeCloseTo(69.8, 9)
    expect(c.priceDate).toBe('2026-10-04')
  })

  test('nothing delivered is no price, not zero or infinity', () => {
    const c = costOf({ ticks: 100, inputTokens: 0, outputTokens: 0 }, { gpus: 1, priceUsd: 2, priceDate: '2026-10-04' })
    expect(c.perMtok).toBeNull()
    expect(c.perMtokOutput).toBeNull()
  })
})

/* ------------------------------ the summary ------------------------------ */

describe('the summary downloads as a file', () => {
  async function summary() {
    const p = await pipeline(300)
    const snap = await runBatching(p.plan, p.settings, { spawn: () => new FakeWorker() })
    const batching = batchingResult(snap, p.plan)
    const cost = costOf(batching, p.settings)
    return { p, batching, cost, input: { trace: p.artifact, shape: p.shape, model: p.model, p50: p.p50, p95: p.p95, settings: p.settings, plan: p.plan, batching, cost } }
  }

  test('a JSON file with KV per token, the run, the dated price and the notes, and the same inputs write the same bytes', async () => {
    const { input, cost } = await summary()
    const text = summaryText(input)
    expect(SUMMARY_FILE).toBe('service-capstone-summary.json')
    const parsed = JSON.parse(text)
    expect(parsed.kind).toBe('kernelspace.service-capstone')
    expect(parsed.trace.kind).toBe('local-derived')
    expect(parsed.trace.sampledRequests).toBe(300)
    expect(parsed.kvPerToken.atContextP50.bytesPerToken).toBe(131_072)
    expect(parsed.batching.completed).toBe(300)
    expect(parsed.cost.priceDate).toBe('2026-10-04')
    expect(parsed.cost.usdPerGpuHour).toBe(3.49)
    expect(parsed.cost.perMtok).toBeCloseTo(cost.perMtok as number, 3)
    expect(parsed.notes).toEqual([...NOTES])
    expect(text.endsWith('\n')).toBe(true)
    // no clock, no id: a second run writes the same bytes
    const again = await summary()
    expect(summaryText(again.input)).toBe(text)
    expect(buildSummary(input).model.layers).toBe(32)
  })

  test('the file holds no request rows and no config text: the sample is named by its checksum', async () => {
    const { input } = await summary()
    const text = summaryText(input)
    expect(text).not.toContain('"requests"')
    expect(text).not.toContain('num_hidden_layers')
    expect(text).toContain(input.trace.requestSha256)
    expect(text.length).toBeLessThan(4000)
  })

  test('formatBytes in binary units', () => {
    expect(formatBytes(131_072)).toBe('128 KiB')
    expect(formatBytes(56e9)).toBe('52.2 GiB')
    expect(formatBytes(512)).toBe('512 B')
  })
})

/* ---------------------- nothing is uploaded or stored ---------------------- */

describe('nothing is uploaded or stored', () => {
  const FORBIDDEN = [/\bfetch\s*\(/, /localStorage/, /sessionStorage/, /indexedDB/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /document\.cookie/, /navigator\.storage/]
  const LEDGER = [/@\/lib\/progress/, /@\/lib\/ledger/, /useProgress/, /from '\.\/progress'/]

  // the page is held to it by a mounted run with every one of these trapped (tests/byo/service-dom.test.ts); the library
  // has no page to mount, so its source is read
  for (const file of ['src/lib/byo-service.ts']) {
    test(`${file} calls no network or storage API and reaches no ledger`, () => {
      const text = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      for (const re of [...FORBIDDEN, ...LEDGER]) expect(text, `${file} ${re}`).not.toMatch(re)
    })
  }

  test('the whole pipeline, run with the network and storage APIs trapped, touches none of them', async () => {
    const g = globalThis as Record<string, unknown>
    const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB']
    const saved = names.map((n) => [n, Object.getOwnPropertyDescriptor(g, n)] as const)
    const touched: string[] = []
    for (const n of names) {
      Object.defineProperty(g, n, {
        configurable: true,
        get: () => {
          touched.push(n)
          return undefined
        },
      })
    }
    try {
      const p = await pipeline(120)
      const snap = await runBatching(p.plan, p.settings, { spawn: () => new FakeWorker() })
      const batching = batchingResult(snap, p.plan)
      summaryText({ trace: p.artifact, shape: p.shape, model: p.model, p50: p.p50, p95: p.p95, settings: p.settings, plan: p.plan, batching, cost: costOf(batching, p.settings) })
    } finally {
      for (const [n, d] of saved) {
        if (d) Object.defineProperty(g, n, d)
        else delete g[n]
      }
    }
    expect(touched).toEqual([])
  })
})

/* ------------------------- wiring: route, pages, budget ------------------------- */

describe('wiring', () => {
  test('/capstone/service is a plain lazy route, prerendered, and reported (not gated) against 200 KB', () => {
    const app = read('src/App.tsx')
    expect(app).toMatch(/const ServiceCapstone = lazy\(\(\) => import\('@\/pages\/ServiceCapstone'\)\)/)
    expect(app).toMatch(/<Route path="\/capstone\/service" element=\{<ServiceCapstone \/>\} \/>/)
    expect(read('scripts/prepare-pages.mjs')).toContain("'capstone/service'")
    const bundle = read('scripts/verify-bundle.ts')
    expect(bundle).toMatch(/\{ route: '\/capstone\/service', src: 'src\/pages\/ServiceCapstone\.tsx', budgetKb: null, targetKb: 200 \}/)
  })

  // the download through a Blob is tested on the mounted page (tests/byo/service-dom.test.ts); this one is a bundle fact
  test('the page reaches no framer-motion', () => {
    expect(read('src/pages/ServiceCapstone.tsx')).not.toContain('framer-motion')
  })
})
