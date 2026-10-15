/**
 * The two field labs on /forge (docs/specs/wave-3.md §16.5, task 3s-07):
 *  - the commands are pinned claims: each carries {repo, ref}, a source url at that ref, a date, and every flag in it was
 *    looked up at the pin (the list below is what was found on 2026-10-14); the BurstGPT file is the one the Fleet's
 *    trace records, by hash and by release;
 *  - the prediction is worked from claims by hand (the arithmetic is in the comments, written before the code was run
 *    against it) and the cost is the budget at the dated H100 median, [derived];
 *  - a reading the learner types is one `item:field.<lab>.<metric>` event, src `practice`, provenance `field`, no KCs,
 *    which the ledger codec accepts, no selector credits, and a donation strips of its value and its truth;
 *  - the page shows all of it, writes only through `recordItems`, and talks to no network; /forge loads it lazily.
 * The lab's commands themselves have not been run on a GPU by an agent (owner step); these tests prove what a laptop can.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import FieldLabs, { FIELD_LABS, showNumber, showRow } from '../../src/components/forge/FieldLabs'
import { byId, claimNumber, getClaim, pinProblems, staleSince } from '../../src/data/claims'
import { LAZY_GROUP_HOMES, lazyGroupFor } from '../../src/data/claims/homes'
import { BURSTGPT_FILE, BURSTGPT_PIN, BURSTGPT_SHA256, FIELD_CLAIMS, FIELD_COMMANDS, FIELD_MODEL } from '../../src/data/claims/lazy/field'
import { VLLM_PIN } from '../../src/data/claims/engines'
import burstgptReplay, { NUM_PROMPTS, burstgptRows } from '../../src/data/field-labs/burstgpt-replay'
import decodeKv, { MAX_MODEL_LEN, UTILIZATION, decodeKvRows } from '../../src/data/field-labs/decode-kv'
import {
  BOOT_CLAIM_IDS,
  BYTES_PER_WEIGHT,
  CHAT_TOKENS,
  MAX_GPU_HOURS,
  PRICE_CLAIM,
  costCents,
  dollars,
  fieldRef,
  fieldResponse,
  fieldInputs,
  fieldRev,
  gradeWithin2x,
  labClaimIds,
  parseReading,
  predictedRow,
  verdictFor,
  type FieldLab,
} from '../../src/data/field-labs/types'
import * as boot from '../../src/lib/boot/model'
import { validateEvent } from '../../src/lib/ledger/codec'
import type { ItemResponse } from '../../src/lib/ledger/types'
import { creditOf } from '../../src/lib/learner/provenance'
import { redactForPartner } from '../../src/lib/learner/redact'
import { useProgress } from '../../src/lib/progress'
import { installDom, MiniEvent, type DomKit, type MiniElement } from '../dom/mini-dom'
import { Journal } from '../learner/ledger-gen'

const root = resolve(import.meta.dir, '../..')
const rowOf = (rows: { id: string; value: number }[], id: string) => rows.find((r) => r.id === id)!.value

/* ------------------------------ the pinned commands ------------------------------ */

/** Every flag the five commands use, as found in vLLM v0.31.0's source on 2026-10-14 (config fields for `serve`, argparse names for `bench serve`). */
const FLAGS_AT_PIN = new Set([
  '--dtype', // vllm/config/model.py: dtype
  '--max-model-len', // vllm/config/model.py: max_model_len
  '--gpu-memory-utilization', // vllm/config/cache.py: gpu_memory_utilization (default 0.92)
  '--model', // vllm/benchmarks/serve.py
  '--dataset-name', // vllm/benchmarks/datasets/datasets.py (choices include random and burstgpt)
  '--dataset-path', // datasets.py
  '--num-prompts', // datasets.py
  '--seed', // datasets.py (default 0)
  '--input-len', // serve.py (maps to the random dataset's length)
  '--output-len', // serve.py
  '--max-concurrency', // serve.py
  '--request-rate', // serve.py (default inf)
  '--ignore-eos', // serve.py
])
const flagsOf = (cmd: string) => cmd.split(/\s+/).filter((w) => w.startsWith('--'))
const valueOf = (cmd: string, flag: string) => cmd.split(/\s+/)[cmd.split(/\s+/).indexOf(flag) + 1]
const trace = JSON.parse(readFileSync(join(root, 'public/traces/burstgpt-v2-busiest-hour.json'), 'utf8')) as {
  sourceSha256: string
  sourceRevision: string
  source: string
  requestCount: number
}

describe('the commands are pinned claims', () => {
  test('every field claim is pinned, sourced at its pin, dated, and lives in the field group', () => {
    expect(FIELD_CLAIMS.length).toBe(11)
    for (const c of FIELD_CLAIMS) {
      expect(c.id.startsWith('field.')).toBe(true)
      expect(c.pin, c.id).toBeDefined()
      expect(pinProblems(c), c.id).toEqual([])
      expect(c.source!.url, c.id).toContain(c.pin!.ref)
      expect(c.verifiedAt, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(lazyGroupFor(c.id), c.id).toBe('lazy/field')
      expect(byId[c.id], c.id).toBe(c)
    }
    expect(LAZY_GROUP_HOMES['field.']).toBe('lazy/field')
  })

  test('vLLM claims pin the release the In-production claims use; the BurstGPT ones pin its v2.0 release', () => {
    for (const c of FIELD_CLAIMS) {
      const expected = c.id.startsWith('field.burstgpt.fetch') || c.id.includes('mean-') ? BURSTGPT_PIN : VLLM_PIN
      expect(c.pin, c.id).toEqual(expected)
    }
    expect(VLLM_PIN).toEqual({ repo: 'vllm-project/vllm', ref: 'v0.31.0' })
  })

  test('commands carry a 60-day TTL, so the labs show "stale since" when the engine moves', () => {
    for (const id of ['field.decode-kv.serve', 'field.decode-kv.bench', 'field.burstgpt.fetch', 'field.burstgpt.serve', 'field.burstgpt.bench']) {
      const c = getClaim(id)
      expect(c.kind).toBe('status')
      expect(c.ttlDays).toBe(60)
      // verified 2026-10-14 + 60 days = 2026-12-13
      expect(staleSince(c, new Date('2026-12-13T00:00:00Z'))).toBeNull()
      expect(staleSince(c, new Date('2026-12-14T00:00:00Z'))).toBe('2026-12-13')
    }
  })

  test('every flag in the vLLM commands was found at the pin', () => {
    for (const cmd of [FIELD_COMMANDS.decodeServe, FIELD_COMMANDS.decodeBench, FIELD_COMMANDS.burstServe, FIELD_COMMANDS.burstBench]) {
      expect(flagsOf(cmd).length).toBeGreaterThan(2)
      for (const flag of flagsOf(cmd)) expect(FLAGS_AT_PIN.has(flag), `${flag} in ${cmd}`).toBe(true)
    }
  })

  test('the claim value is the command, character for character, and the four vLLM commands name one model', () => {
    expect(getClaim('field.decode-kv.serve').value).toBe(FIELD_COMMANDS.decodeServe)
    expect(getClaim('field.decode-kv.bench').value).toBe(FIELD_COMMANDS.decodeBench)
    expect(getClaim('field.burstgpt.fetch').value).toBe(FIELD_COMMANDS.burstFetch)
    expect(getClaim('field.burstgpt.serve').value).toBe(FIELD_COMMANDS.burstServe)
    expect(getClaim('field.burstgpt.bench').value).toBe(FIELD_COMMANDS.burstBench)
    expect(FIELD_MODEL).toBe('NousResearch/Meta-Llama-3-8B')
    expect(FIELD_COMMANDS.decodeServe).toContain(`serve ${FIELD_MODEL}`)
    expect(valueOf(FIELD_COMMANDS.decodeBench, '--model')).toBe(FIELD_MODEL)
    expect(valueOf(FIELD_COMMANDS.burstBench, '--model')).toBe(FIELD_MODEL)
    // the model the commands serve is the one the Boot numbers describe (the mirror models.ts quotes)
    expect(getClaim('model.llama3-8b.layers').source!.url).toContain(FIELD_MODEL)
  })

  test('the lab constants are the commands\' flags, not a second copy', () => {
    expect(Number(valueOf(FIELD_COMMANDS.decodeServe, '--max-model-len'))).toBe(MAX_MODEL_LEN)
    expect(Number(valueOf(FIELD_COMMANDS.decodeServe, '--gpu-memory-utilization'))).toBe(UTILIZATION)
    expect(Number(valueOf(FIELD_COMMANDS.burstBench, '--num-prompts'))).toBe(NUM_PROMPTS)
    // one user: a request at a time, and a 128-token prompt plus 256 generated tokens fits the 4,096-token server
    expect(valueOf(FIELD_COMMANDS.decodeBench, '--max-concurrency')).toBe('1')
    expect(Number(valueOf(FIELD_COMMANDS.decodeBench, '--input-len')) + Number(valueOf(FIELD_COMMANDS.decodeBench, '--output-len'))).toBeLessThanOrEqual(MAX_MODEL_LEN)
    // Boot's chat is the server's request length, so the log counts the chats Boot counted
    expect(MAX_MODEL_LEN).toBe(4096)
    // the BurstGPT run is the saturating one (the flag's default, written out) with every response at its recorded length
    expect(valueOf(FIELD_COMMANDS.burstBench, '--request-rate')).toBe('inf')
    expect(flagsOf(FIELD_COMMANDS.burstBench)).toContain('--ignore-eos')
    expect(valueOf(FIELD_COMMANDS.burstBench, '--dataset-name')).toBe('burstgpt')
  })

  test('the BurstGPT file is the one the Fleet\'s recorded hour is cut from: same release, same file, same hash, same count', () => {
    expect(BURSTGPT_SHA256).toBe(trace.sourceSha256)
    expect(BURSTGPT_PIN.ref).toBe(trace.sourceRevision)
    expect(trace.source).toBe(`https://github.com/${BURSTGPT_PIN.repo}/releases/download/${BURSTGPT_PIN.ref}/${BURSTGPT_FILE}`)
    expect(NUM_PROMPTS).toBe(trace.requestCount)
    const fetchCmd = String(getClaim('field.burstgpt.fetch').value)
    expect(fetchCmd).toContain(trace.source)
    expect(fetchCmd).toContain(`${trace.sourceSha256}  ${BURSTGPT_FILE}`)
    expect(fetchCmd).toContain('sha256sum -c')
    expect(valueOf(FIELD_COMMANDS.burstBench, '--dataset-path')).toBe(BURSTGPT_FILE)
  })

  test('each reading names a claim that pins the line of output', () => {
    for (const lab of FIELD_LABS) {
      for (const m of lab.metrics) {
        const c = getClaim(m.entry.reads)
        expect(c.pin?.repo, m.entry.reads).toBe(VLLM_PIN.repo)
        expect(c.source!.quote, m.entry.reads).toBeTruthy()
        expect(lab.steps.some((s) => s.reads === m.entry.reads), `${lab.id}/${m.id} is read in a step`).toBe(true)
      }
    }
  })

  test('the vLLM docs\' own BurstGPT file differs from the pinned one, and the claim says so', () => {
    const c = getClaim('field.burstgpt.bench')
    expect(c.source!.quote).toContain('v1.1/BurstGPT_without_fails_2.csv')
    expect(c.discrepancy).toContain('v2.0')
    expect(c.discrepancy).toContain(BURSTGPT_FILE)
  })

  test('the loader claim says the CLI never reads time, and the lab says it too', () => {
    expect(getClaim('field.burstgpt.loader').boundary).toContain('Timestamp column is never read')
    expect(burstgptReplay.limits.join(' ')).toContain('Token lengths, not arrival times')
  })
})

/* ------------------------------ the prediction and the cost ------------------------------ */

describe('the prediction is Boot\'s arithmetic on the pinned server (worked by hand)', () => {
  const rows = decodeKvRows()
  // inputs: 8.03 B parameters (model.llama3-8b.params), 3.35 TB/s, 80 GB, 131,072 B of KV per token
  test('weights: 8.03e9 × 2 B = 16.06 GB, and one user\'s decode ceiling is 3.35e12 ÷ 16.06e9 = 208.59 tok/s (Boot\'s own number)', () => {
    expect(rowOf(rows, 'weights')).toBeCloseTo(16.06, 6)
    expect(rowOf(rows, 'decode-tps')).toBeCloseTo(208.5928, 3)
    expect(rowOf(rows, 'decode-tps')).toBeCloseTo(boot.BOOT.decodeTps, 9)
  })

  test('the KV bytes a step reads are 0.21 % beside the weights, so the weights alone set the speed: (128 + 256 ÷ 2) × 131,072 ÷ 16.06e9', () => {
    // 256 tokens × 131,072 B = 33,554,432 B; ÷ 16.06e9 B = 0.0020893 = 0.2089 %
    expect(rowOf(rows, 'kv-share')).toBeCloseTo(0.20893, 4)
  })

  test('the cache: 0.90 × 80 GB − 16.06 GB = 55.94 GB, ÷ 131,072 B = 426,788 tokens, ÷ 4,096 = 104.2 requests', () => {
    expect(rowOf(rows, 'kv-budget')).toBeCloseTo(55.94, 6)
    expect(rowOf(rows, 'kv-tokens')).toBeCloseTo(426788.33, 1)
    expect(rowOf(rows, 'concurrency')).toBeCloseTo(104.196, 2)
  })

  test('Boot counted 119 chats with all 80 GB; the server keeps 10 % back and so holds fewer', () => {
    // (80e9 − 16.06e9) ÷ 131,072 = 487,823 tokens ÷ 4,096 = 119.1, rounded down
    expect(rowOf(rows, 'boot-chats')).toBe(119)
    expect(rowOf(rows, 'concurrency')).toBeLessThan(rowOf(rows, 'boot-chats'))
  })

  test('every row names claims that exist, and the headline rows are the metrics\' predictions', () => {
    for (const lab of FIELD_LABS) {
      for (const r of lab.rows) for (const id of r.from) expect(getClaim(id).id, `${lab.id}/${r.id}`).toBe(id)
      for (const m of lab.metrics) expect(predictedRow(lab, m).id).toBe(m.predicted)
    }
  })
})

describe('the BurstGPT ceiling (worked by hand)', () => {
  const rows = burstgptRows()
  // means of the kept rows: 660.7 request and 218.8 response tokens; 8.03 B parameters; 989 TFLOPS; 3.35 TB/s; 131,072 B per KV token
  test('FLOPs behind an output token: 2 × 8.03e9 × (1 + 660.7 ÷ 218.8) = 64.56 GFLOP, so the math allows 989e12 ÷ 64.56e9 = 15,320 tok/s', () => {
    expect(rowOf(rows, 'flop-per-token')).toBeCloseTo(64.5556, 3)
    expect(rowOf(rows, 'compute-ceiling')).toBeCloseTo(15320.12, 1)
  })

  test('480 prompts at once fit under max_num_seqs (1,024), so the batch is 480', () => {
    expect(claimNumber('production.vllm.max-num-seqs')).toBe(1024)
    expect(rowOf(rows, 'batch')).toBe(480)
  })

  test('HBM bytes behind an output token: 16.06e9 ÷ 480 + (660.7 + 109.4 + 3.02) × 131,072 = 134.8 MB, so memory allows 3.35e12 ÷ 134.79e6 = 24,853 tok/s', () => {
    expect(rowOf(rows, 'bytes-per-token')).toBeCloseTo(134.7927, 2)
    expect(rowOf(rows, 'memory-ceiling')).toBeCloseTo(24852.98, 0)
  })

  test('the ceiling is the lower wall, the math, because 480 requests are far above the ridge of about 295', () => {
    expect(rowOf(rows, 'ceiling')).toBe(Math.min(rowOf(rows, 'compute-ceiling'), rowOf(rows, 'memory-ceiling')))
    expect(rowOf(rows, 'ceiling')).toBeCloseTo(15320.12, 1)
    expect(rowOf(rows, 'batch')).toBeGreaterThan(boot.BOOT.ridge)
  })
})

describe('the labs read Boot\'s inputs without importing Boot (a shared module would cost /boot a chunk)', () => {
  test('the five claims, the two scenario constants and the 2× rule are Boot\'s own', () => {
    expect(BOOT_CLAIM_IDS).toEqual(boot.BOOT_CLAIMS)
    expect(BYTES_PER_WEIGHT).toBe(boot.BYTES_PER_WEIGHT)
    expect(CHAT_TOKENS).toBe(boot.CHAT_TOKENS)
    expect(fieldInputs()).toEqual(boot.bootInputs())
    for (const [value, truth] of [[100, 208.6], [104.3, 208.6], [417.2, 208.6], [418, 208.6], [0, 5], [-1, 5], [Number.NaN, 5], [1e-9, 5], [5, 5]]) {
      expect(gradeWithin2x(value, truth), `${value} vs ${truth}`).toEqual(boot.gradeGuess(value, truth))
    }
  })

  test('so no lab file imports Boot\'s model, its page or its chips', () => {
    for (const file of ['src/components/forge/FieldLabs.tsx', 'src/data/field-labs/types.ts', 'src/data/field-labs/decode-kv.ts', 'src/data/field-labs/burstgpt-replay.ts']) {
      const reached = [...staticFiles(file)].map((f) => relative(root, f))
      expect(reached.filter((f) => f.startsWith('src/lib/boot/') || f.startsWith('src/pages/')), file).toEqual([])
    }
  })

  test('the blurb\'s two figures are Boot\'s own, rounded the way Boot rounds them', () => {
    expect(decodeKv.blurb).toContain(boot.fmt.tps(boot.BOOT.decodeTps).replace(' tok/s', '') + ' tok/s')
    expect(decodeKv.blurb).toContain(boot.fmt.chats(boot.BOOT.chats))
  })
})

describe('the cost is the budget at the dated H100 median, derived', () => {
  test('1.5 GPU-hours at 3.49 USD/GPU-hr is 5.235, shown as $5.24: the spec\'s "about $5"', () => {
    expect(claimNumber(PRICE_CLAIM)).toBe(3.49)
    expect(getClaim(PRICE_CLAIM).kind).toBe('price')
    expect(MAX_GPU_HOURS).toBe(1.5)
    expect(costCents(1.5)).toBe(524)
    expect(dollars(costCents())).toBe('$5.24')
    expect(costCents(1)).toBe(349)
    expect(costCents(0)).toBe(0)
  })

  test('neither lab budgets more than 1.5 GPU-hours', () => {
    for (const lab of FIELD_LABS) {
      expect(lab.gpuHours).toBeGreaterThan(0)
      expect(lab.gpuHours).toBeLessThanOrEqual(1.5)
    }
  })

  test('the labs are the two the spec names, in the order of their lessons, and neither has been run by anyone yet', () => {
    expect(FIELD_LABS.map((l) => l.id)).toEqual(['decode-kv', 'burstgpt-replay'])
    expect(FIELD_LABS.map((l) => l.after.lesson)).toEqual(['t5.l4', 't5.l7'])
    for (const lab of FIELD_LABS) expect(lab.ranBy).toBeNull()
  })
})

/* ------------------------------ verdicts ------------------------------ */

describe('a reading is judged by the lab\'s own wording, and graded by Boot\'s 2× rule', () => {
  const tps = decodeKv.metrics[0]
  const concurrency = decodeKv.metrics[1]
  const predicted = rowOf(decodeKvRows(), 'decode-tps')

  test('a ceiling: under half is below, up to 5 % over is near, beyond is above', () => {
    expect(verdictFor(tps, predicted * 0.49, predicted).band).toBe('below')
    expect(verdictFor(tps, predicted * 0.5, predicted).band).toBe('near')
    expect(verdictFor(tps, predicted * 1.05, predicted).band).toBe('near')
    expect(verdictFor(tps, predicted * 1.06, predicted).band).toBe('above')
  })

  test('an estimate: 10 % either way is near', () => {
    const p = rowOf(decodeKvRows(), 'concurrency')
    expect(verdictFor(concurrency, p * 0.89, p).band).toBe('below')
    expect(verdictFor(concurrency, p * 0.9, p).band).toBe('near')
    expect(verdictFor(concurrency, p * 1.1, p).band).toBe('near')
    expect(verdictFor(concurrency, p * 1.11, p).band).toBe('above')
  })

  test('ok is Boot\'s rule, within 2× either way, and the score falls off a decade at a time', () => {
    expect(verdictFor(tps, predicted * 0.5, predicted).ok).toBe(true)
    expect(verdictFor(tps, predicted * 0.49, predicted).ok).toBe(false)
    expect(verdictFor(tps, predicted * 2, predicted).ok).toBe(true)
    expect(verdictFor(tps, predicted * 2.01, predicted).ok).toBe(false)
    expect(verdictFor(tps, predicted, predicted).score).toBe(1)
    expect(verdictFor(tps, predicted / 10, predicted).score).toBeCloseTo(0, 9)
  })

  test('the sentence leads with the ratio and then says where to look', () => {
    const v = verdictFor(tps, predicted * 0.7, predicted)
    expect(v.text.startsWith('Your decode speed is 0.70× the prediction.')).toBe(true)
    expect(v.text).toContain(tps.near)
    expect(verdictFor(tps, predicted * 0.1, predicted).text).toContain('0.10×')
    expect(verdictFor(tps, predicted * 0.01, predicted).text).toContain('0.010×')
  })

  test('TPOT becomes tokens per second: 1000 ÷ ms', () => {
    expect(tps.entry.toValue(5)).toBe(200)
    expect(tps.entry.toValue(8)).toBe(125)
    expect(concurrency.entry.toValue(104.2)).toBe(104.2)
  })

  test('typed numbers: separators are fine, zero, negatives, text and nothing are not', () => {
    expect(parseReading('7.1')).toBe(7.1)
    expect(parseReading(' 15,321.5 ')).toBe(15321.5)
    expect(parseReading('1 234')).toBe(1234)
    expect(parseReading('.5')).toBe(0.5)
    for (const bad of ['', ' ', '0', '-3', 'abc', '12ms', 'Infinity', '1e999', '4..2']) expect(parseReading(bad), bad).toBeNull()
  })

  test('numbers are printed with enough digits to check by hand', () => {
    expect(showNumber(15320.12)).toBe('15,320')
    expect(showNumber(208.59)).toBe('208.6')
    expect(showNumber(104.196)).toBe('104.2')
    expect(showNumber(0.20893)).toBe('0.21')
    expect(showRow({ id: 'x', label: 'x', value: 208.59, unit: 'tok/s', formula: '', from: [] })).toBe('≈208.6 tok/s')
  })
})

/* ------------------------------ the ledger event ------------------------------ */

const lab = (id: string): FieldLab => FIELD_LABS.find((l) => l.id === id)!

describe('a reading is one item event on item:field.<lab>.<metric>, src practice, provenance field', () => {
  test('refs: item:field.decode-kv.tps, .concurrency and item:field.burstgpt-replay.out-tps', () => {
    expect(fieldRef('decode-kv', 'tps')).toBe('item:field.decode-kv.tps')
    const refs = FIELD_LABS.flatMap((l) => l.metrics.map((m) => fieldResponse(l, m, 10).ref))
    expect(refs).toEqual(['item:field.decode-kv.tps', 'item:field.decode-kv.concurrency', 'item:field.burstgpt-replay.out-tps'])
  })

  test('the event carries the recorded value, the prediction it was judged against, and no KC', () => {
    const e = fieldResponse(lab('decode-kv'), decodeKv.metrics[0], 7.5)
    expect(e.kind).toBe('item')
    expect(e.provenance).toBe('field')
    expect(e.data).toEqual({ src: 'practice', value: 1000 / 7.5, truth: boot.BOOT.decodeTps, unit: 'tok/s', nsec: 0 })
    expect(e.ok).toBe(true)
    // 133.3 ÷ 208.6 = 0.639; the score is 1 − |log10 0.639| = 0.806
    expect(e.score).toBeCloseTo(0.806, 3)
    expect(e).not.toHaveProperty('conf')
    expect((e.data as { kcs?: string[] }).kcs).toBeUndefined()
  })

  test('the rev changes with the prediction and with a claim it reads', () => {
    const l = lab('decode-kv')
    const m = l.metrics[0]
    const rev = fieldRev(l, m)
    expect(fieldRev(l, m)).toBe(rev)
    expect(fieldRev(l, l.metrics[1])).not.toBe(rev)
    expect(fieldRev({ ...l, rows: l.rows.map((r) => (r.id === 'decode-tps' ? { ...r, value: r.value * 1.2 } : r)) }, m)).not.toBe(rev)
    expect(labClaimIds(l)).toContain('field.decode-kv.tpot')
    expect(labClaimIds(l)).toContain(PRICE_CLAIM)
    expect(new Set(labClaimIds(l)).size).toBe(labClaimIds(l).length)
  })

  const journal = (e: ItemResponse) => new Journal().add(e.kind, e.ref, '2026-09-01', { score: e.score, ok: e.ok, rev: e.rev, provenance: e.provenance, data: e.data })

  test('the codec accepts it as an item event', () => {
    for (const l of FIELD_LABS) {
      for (const m of l.metrics) {
        const ev = journal(fieldResponse(l, m, 10))
        const checked = validateEvent(ev)
        expect(checked.ok, checked.ok ? '' : checked.reason).toBe(true)
      }
    }
  })

  test('no selector credits it: provenance field weighs 0', () => {
    expect(creditOf('field')).toBe(0)
  })

  test('a donation keeps the event\'s ref and kind but neither value nor truth, and nothing of the reading\'s unit', () => {
    const l = lab('burstgpt-replay')
    const ev = journal(fieldResponse(l, l.metrics[0], 8123.45))
    const donated = redactForPartner({ events: [ev], working: [] })
    expect(donated.events).toHaveLength(1)
    const d = donated.events[0]
    expect(d.ref).toBe('item:field.burstgpt-replay.out-tps')
    const text = JSON.stringify(d)
    expect(text).not.toContain('8123')
    expect(text).not.toContain(String(predictedRow(l, l.metrics[0]).value).slice(0, 6))
    expect(d.data ?? {}).not.toHaveProperty('value')
    expect(d.data ?? {}).not.toHaveProperty('truth')
    expect(d.data ?? {}).not.toHaveProperty('unit')
  })

  test('the same numbers on a non-field event would have been kept, so the drop is the provenance', () => {
    const l = lab('burstgpt-replay')
    const e = fieldResponse(l, l.metrics[0], 8123.45)
    const ev = journal({ ...e, provenance: 'practice' })
    const d = redactForPartner({ events: [ev], working: [] }).events[0]
    expect(d.data).toMatchObject({ value: 8123.45 })
  })
})

/* ------------------------------ the page ------------------------------ */

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

function spyOnWrites() {
  const writes: ItemResponse[] = []
  const original = useProgress.getState().recordItems
  useProgress.setState({ recordItems: ((items: ItemResponse[]) => void writes.push(...items)) as never })
  return { writes, restore: () => useProgress.setState({ recordItems: original }) }
}

const mountLabs = () => dom.mount(createElement(MemoryRouter, { initialEntries: ['/forge'] }, createElement(FieldLabs)))
const card = (root: MiniElement, id: string) => root.querySelector(`[data-field-lab="${id}"]`)!
const type = (el: MiniElement, value: string) =>
  dom.act(() => {
    el.value = value
    el.dispatchEvent(new MiniEvent('input', { bubbles: true }))
  })
const submitButton = (form: MiniElement) => form.querySelectorAll('button').find((b) => b.textContent.trim() === 'Record this reading')!

describe('the page', () => {
  test('both labs: the lesson they follow, the cost, the prediction and the pinned commands exactly as the claims have them', async () => {
    const page = await mountLabs()
    const root = page.container
    expect(root.querySelector('h2')!.textContent).toBe('Check the paper against a real server')
    expect(root.querySelectorAll('[data-field-lab]').map((c) => c.getAttribute('data-field-lab'))).toEqual(['decode-kv', 'burstgpt-replay'])
    for (const l of FIELD_LABS) {
      const c = card(root, l.id)
      expect(c.querySelector('[data-budget] [data-cost]')!.textContent).toBe('$5.24')
      expect(c.querySelector('[data-budget]')!.textContent).toContain('[derived]')
      expect(c.querySelector('a')!.getAttribute('href')).toBe(`/lesson/${l.after.lesson}`)
      expect(c.textContent).toContain(`after ${l.after.lesson}`)
      // every prediction row is shown with its value and its [derived] mark
      for (const row of l.rows) {
        const el = c.querySelector(`[data-row="${row.id}"]`)!
        expect(el.textContent).toContain(showRow(row))
        expect(el.textContent).toContain('[derived]')
        expect(el.textContent).toContain(row.formula)
        // the claims it reads sit in a native disclosure, each as a labelled claim chip
        const from = el.querySelector('[data-from]')!
        expect(from.querySelector('summary')!.textContent).toBe(`from ${row.from.length} claim${row.from.length === 1 ? '' : 's'}`)
        expect(from.querySelectorAll('li').length).toBe(row.from.length)
        for (const id of row.from) expect(from.textContent).toContain(getClaim(id).label)
      }
      // the commands, in order, as typed, each with its pin and its check date
      const steps = c.querySelectorAll('[data-step]')
      expect(steps.map((s) => s.getAttribute('data-claim'))).toEqual(l.steps.map((s) => s.claim))
      steps.forEach((s, i) => {
        const claim = getClaim(l.steps[i].claim)
        expect(s.querySelector('[data-command]')!.textContent).toBe(String(claim.value))
        expect(s.querySelector('[data-pin]')!.textContent).toBe(`pinned at ${claim.pin!.repo}@${claim.pin!.ref}`)
        expect(s.textContent).toContain(`checked ${claim.verifiedAt}`)
        expect(s.querySelector('a')!.getAttribute('rel')).toContain('noopener')
        expect(s.querySelector('a')!.getAttribute('href')).toBe(claim.source!.url)
      })
      // nobody has run the commands: the page says so
      expect(c.querySelector('[data-unrun]')!.textContent).toContain('Not run on a GPU yet')
    }
    await page.unmount()
  })

  test('the lesson chip follows the learner\'s progress and locks nothing', async () => {
    const original = useProgress.getState().lessons
    try {
      useProgress.setState({ lessons: { 't5.l4': { status: 'done' } } as never })
      const page = await mountLabs()
      const states = page.container.querySelectorAll('[data-lesson-state]').map((e) => e.textContent)
      expect(states).toEqual(['finished', 'not finished; nothing is locked'])
      // both labs are fully shown either way
      expect(page.container.querySelectorAll('[data-command]').length).toBe(decodeKv.steps.length + burstgptReplay.steps.length)
      await page.unmount()
    } finally {
      useProgress.setState({ lessons: original })
    }
  })

  test('a reading is checked against the prediction and recorded once, as item:field.decode-kv.tps', async () => {
    const spy = spyOnWrites()
    try {
      const page = await mountLabs()
      const form = card(page.container, 'decode-kv').querySelector('[data-reading="tps"]')!
      await type(form.querySelector('input')!, '7.5')
      await dom.press(submitButton(form))
      expect(spy.writes).toHaveLength(1)
      const w = spy.writes[0]
      expect(w.ref).toBe('item:field.decode-kv.tps')
      expect(w.provenance).toBe('field')
      expect(w.data).toMatchObject({ src: 'practice', value: 1000 / 7.5, truth: boot.BOOT.decodeTps, unit: 'tok/s' })
      const verdict = form.querySelector('[data-verdict]')!
      expect(verdict.textContent).toContain('7.5 ms is 133.3 tok/s.')
      expect(verdict.textContent).toContain('0.64× the prediction')
      expect(form.querySelector('[data-recorded]')!.textContent).toContain('item:field.decode-kv.tps')
      expect(form.querySelector('[data-recorded]')!.textContent).toContain('left out of any donation')
      // the verdict sits in a live region
      expect(form.querySelector('[data-verdict-region]')!.getAttribute('aria-live')).toBe('polite')
      await page.unmount()
    } finally {
      spy.restore()
    }
  })

  test('a reading that is not a number records nothing and says what is wanted; editing clears an old verdict', async () => {
    const spy = spyOnWrites()
    try {
      const page = await mountLabs()
      const form = card(page.container, 'burstgpt-replay').querySelector('[data-reading="out-tps"]')!
      const input = form.querySelector('input')!
      await type(input, 'fast')
      await dom.press(submitButton(form))
      expect(spy.writes).toHaveLength(0)
      expect(form.querySelector('[data-verdict-region]')!.textContent).toContain('is not one')
      expect(input.getAttribute('aria-invalid')).toBe('true')
      await type(input, '9,100')
      await dom.press(submitButton(form))
      expect(spy.writes).toHaveLength(1)
      expect(spy.writes[0].ref).toBe('item:field.burstgpt-replay.out-tps')
      expect(spy.writes[0].data).toMatchObject({ value: 9100 })
      expect(form.querySelector('[data-verdict]')).not.toBeNull()
      await type(input, '9')
      expect(form.querySelector('[data-verdict]')).toBeNull()
      await page.unmount()
    } finally {
      spy.restore()
    }
  })

  test('when the ledger refuses the write the page says nothing was recorded', async () => {
    const original = useProgress.getState().recordItems
    useProgress.setState({
      recordItems: (() => {
        throw new Error('the ledger is read-only')
      }) as never,
    })
    try {
      const page = await mountLabs()
      const form = card(page.container, 'decode-kv').querySelector('[data-reading="concurrency"]')!
      await type(form.querySelector('input')!, '104')
      await dom.press(submitButton(form))
      expect(form.querySelector('[data-verdict-region]')!.textContent).toContain('nothing was recorded')
      expect(form.querySelector('[data-recorded]')).toBeNull()
      await page.unmount()
    } finally {
      useProgress.setState({ recordItems: original })
    }
  })

  test('every field has a visible label, and every status line is a live region', async () => {
    const page = await mountLabs()
    for (const input of page.container.querySelectorAll('input')) {
      const label = page.container.querySelector(`label[for="${input.getAttribute('id')}"]`)
      expect(label?.textContent.length ?? 0).toBeGreaterThan(3)
    }
    expect(page.container.querySelectorAll('[data-verdict-region]').length).toBe(3)
    await page.unmount()
  })
})

/* ------------------------------ the boundary ------------------------------ */

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
function staticFiles(entry: string): Set<string> {
  const src = join(root, 'src')
  const files = new Set<string>()
  const visit = (file: string) => {
    if (files.has(file)) return
    files.add(file)
    for (const m of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      if (/\.(css|svg|png|jpe?g|webp|woff2?|json)$/.test(m[1]) || m[1].includes('?')) continue
      const base = m[1].startsWith('@/') ? join(src, m[1].slice(2)) : m[1].startsWith('.') ? resolve(dirname(file), m[1]) : null
      if (base === null) continue
      const found = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find((c) => existsSync(c) && /\.(ts|tsx)$/.test(c))
      if (found) visit(found)
    }
  }
  visit(join(root, entry))
  return files
}

describe('nothing else leaves the device, and nothing else loads', () => {
  const sources = ['src/components/forge/FieldLabs.tsx', 'src/data/field-labs/types.ts', 'src/data/field-labs/decode-kv.ts', 'src/data/field-labs/burstgpt-replay.ts']

  test('the page and the lab modules make no network call and open no channel', () => {
    for (const file of sources) {
      const text = readFileSync(join(root, file), 'utf8')
      for (const needle of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'BroadcastChannel', 'postMessage', 'new Worker', 'localStorage', 'indexedDB']) {
        expect(text.includes(needle), `${file} contains ${needle}`).toBe(false)
      }
      // the one browser API the page uses is the clipboard, to copy a command out
      const apis = [...text.matchAll(/navigator\.(\w+)/g)].map((m) => m[1])
      expect(apis.every((a) => a === 'clipboard'), `${file}: ${apis.join(',')}`).toBe(true)
    }
  })

  test('the only write is the façade\'s recordItems', () => {
    const text = readFileSync(join(root, 'src/components/forge/FieldLabs.tsx'), 'utf8')
    const actions = [...text.matchAll(/useProgress\(\(s\) => s\.(\w+)\)/g)].map((m) => m[1])
    expect(actions.sort()).toEqual(['lessons', 'recordItems'])
  })

  test('/forge reaches the field labs only through import(): not its labs, not its claims, not its component', () => {
    const forge = [...staticFiles('src/pages/Forge.tsx')].map((f) => relative(root, f))
    expect(forge).toContain('src/pages/Forge.tsx')
    for (const f of forge) {
      expect(f.startsWith('src/data/field-labs/'), f).toBe(false)
      expect(f.startsWith('src/data/claims/lazy/'), f).toBe(false)
      expect(f).not.toBe('src/components/forge/FieldLabs.tsx')
      expect(f).not.toBe('src/data/claims/all.ts')
    }
    expect(readFileSync(join(root, 'src/pages/Forge.tsx'), 'utf8')).toContain("lazy(() => import('@/components/forge/FieldLabs'))")
  })

  test('Boot and Today never reach the field claims or the labs (the eager claims chunk does not grow, D19)', () => {
    for (const entry of ['src/pages/Boot.tsx', 'src/pages/Today.tsx', 'src/data/plays.ts', 'src/pages/Daily.tsx', 'src/pages/Me.tsx']) {
      for (const f of [...staticFiles(entry)].map((x) => relative(root, x))) {
        expect(f.startsWith('src/data/field-labs/'), `${entry} -> ${f}`).toBe(false)
        expect(f, `${entry} -> ${f}`).not.toBe('src/data/claims/lazy/field.ts')
        expect(f, `${entry} -> ${f}`).not.toBe('src/components/forge/FieldLabs.tsx')
      }
    }
  })

  test('the labs add no multiple-choice item, so the PRIMM pool and every blind-strategy limit are untouched', () => {
    for (const file of sources) {
      const text = readFileSync(join(root, file), 'utf8')
      expect(text, file).not.toMatch(/correct:\s*\[/)
      expect(text, file).not.toContain('QuizQuestion')
    }
  })
})
