/**
 * K4 Boot: the story's numbers (docs/specs/ledger-v3.md §12.4; PLAN-100X §4.A).
 *
 * Every figure is a claim from `src/data/claims` or [derived] from claims here. The two scenario
 * constants (2 bytes per BF16 weight, chats of 4,096 tokens) are labelled as such in the UI and are
 * not claims. `tests/boot/model.test.ts` holds each derived value inside a band that matches its
 * copy, so a claim update that moves a number out of its band fails CI instead of drifting silently.
 *
 * Pure: no DOM, no store. The page and the tests both import it.
 */

import { getClaim, claimNumber } from '@/data/claims'
import { rev32 } from '@/lib/ledger/stable'

/** The five claims the story rests on (spec §12.4). */
export const BOOT_CLAIMS = {
  bandwidth: 'hw.h100-sxm.hbm-bw',
  capacity: 'hw.h100-sxm.hbm-capacity',
  flops: 'hw.h100-sxm.bf16-dense',
  params: 'model.llama3-8b.params',
  kvPerToken: 'model.llama3-8b.kv-bytes-per-token',
} as const

/** Scenario constants: labelled in the UI, deliberately not claims. */
export const BYTES_PER_WEIGHT = 2
export const CHAT_TOKENS = 4096

/** The claims' numbers in base units. */
export interface BootInputs {
  /** bytes per second */
  bandwidth: number
  /** bytes */
  capacity: number
  /** FLOP per second */
  flops: number
  /** parameters */
  params: number
  /** bytes of KV cache per token of one sequence */
  kvPerToken: number
}

export function bootInputs(): BootInputs {
  return {
    bandwidth: claimNumber(BOOT_CLAIMS.bandwidth, 1e12),
    capacity: claimNumber(BOOT_CLAIMS.capacity, 1e9),
    flops: claimNumber(BOOT_CLAIMS.flops, 1e12),
    params: claimNumber(BOOT_CLAIMS.params, 1e9),
    kvPerToken: claimNumber(BOOT_CLAIMS.kvPerToken),
  }
}

export interface BootModel {
  /** params × 2 B */
  weightsBytes: number
  /** weights ÷ bandwidth: the time to stream every weight once, seconds */
  tokenSeconds: number
  /** bandwidth ÷ weights: tokens per second for one user */
  decodeTps: number
  /** flops ÷ (2 · params): what the math alone would allow, the number a FLOPS-only guess lands on */
  computeCeilingTps: number
  /** 2·params·tok/s ÷ flops, as a fraction of peak, at batch 1 */
  mathBusyBatch1: number
  /** flops ÷ bandwidth, FLOP per byte */
  ridge: number
  /** (capacity − weights) ÷ KV bytes per token */
  kvTokens: number
  /** whole chats of CHAT_TOKENS that fit */
  chats: number
  /** weights + chats × CHAT_TOKENS × KV bytes per token: what one decode step reads */
  stepBytes: number
  /** stepBytes ÷ bandwidth, seconds */
  stepSeconds: number
  /** chats ÷ step time, tokens per second across all users */
  aggregateTps: number
  /** aggregateTps ÷ chats: what each of those users gets */
  perUserTps: number
  /** 1 − 2·params·aggregate ÷ flops: the share of the math idle at that batch */
  mathIdleAtBatch: number
}

export function deriveBoot(i: BootInputs = bootInputs()): BootModel {
  const weightsBytes = i.params * BYTES_PER_WEIGHT
  const tokenSeconds = weightsBytes / i.bandwidth
  const decodeTps = i.bandwidth / weightsBytes
  const computeCeilingTps = i.flops / (2 * i.params)
  const mathBusyBatch1 = (2 * i.params * decodeTps) / i.flops
  const ridge = i.flops / i.bandwidth
  const kvTokens = (i.capacity - weightsBytes) / i.kvPerToken
  const chats = Math.floor(kvTokens / CHAT_TOKENS)
  const stepBytes = weightsBytes + chats * CHAT_TOKENS * i.kvPerToken
  const stepSeconds = stepBytes / i.bandwidth
  const aggregateTps = chats / stepSeconds
  return {
    weightsBytes,
    tokenSeconds,
    decodeTps,
    computeCeilingTps,
    mathBusyBatch1,
    ridge,
    kvTokens,
    chats,
    stepBytes,
    stepSeconds,
    aggregateTps,
    perUserTps: aggregateTps / chats,
    mathIdleAtBatch: 1 - (2 * i.params * aggregateTps) / i.flops,
  }
}

export const BOOT = deriveBoot()

/* ---------------- Derived-number provenance (the [derived] chips) ---------------- */

export type DerivedKey = keyof BootModel

export interface DerivedNote {
  formula: string
  /** Claim ids the formula reads. */
  from: string[]
  /** Scenario constants it also reads, in words. */
  scenario?: string
}

const SCEN_BYTES = '2 bytes per BF16 weight'
const SCEN_CHATS = 'chats of 4,096 tokens'
const C = BOOT_CLAIMS

export const DERIVED_NOTES: Record<DerivedKey, DerivedNote> = {
  weightsBytes: { formula: 'parameters × 2 B', from: [C.params], scenario: SCEN_BYTES },
  tokenSeconds: { formula: 'weight bytes ÷ HBM bandwidth', from: [C.bandwidth, C.params], scenario: SCEN_BYTES },
  decodeTps: { formula: 'HBM bandwidth ÷ weight bytes', from: [C.bandwidth, C.params], scenario: SCEN_BYTES },
  computeCeilingTps: { formula: 'BF16 FLOPS ÷ (2 · parameters)', from: [C.flops, C.params] },
  mathBusyBatch1: {
    formula: '2 · parameters · tok/s ÷ BF16 FLOPS',
    from: [C.params, C.flops, C.bandwidth],
    scenario: SCEN_BYTES,
  },
  ridge: { formula: 'BF16 FLOPS ÷ HBM bandwidth', from: [C.flops, C.bandwidth] },
  kvTokens: {
    formula: '(HBM capacity − weight bytes) ÷ KV bytes per token',
    from: [C.capacity, C.params, C.kvPerToken],
    scenario: SCEN_BYTES,
  },
  chats: { formula: 'KV tokens that fit ÷ 4,096, rounded down', from: [C.capacity, C.params, C.kvPerToken], scenario: SCEN_CHATS },
  stepBytes: {
    formula: 'weight bytes + chats × 4,096 × KV bytes per token',
    from: [C.params, C.kvPerToken, C.capacity],
    scenario: `${SCEN_BYTES}; ${SCEN_CHATS}`,
  },
  stepSeconds: {
    formula: 'bytes read per step ÷ HBM bandwidth',
    from: [C.bandwidth, C.params, C.kvPerToken, C.capacity],
    scenario: `${SCEN_BYTES}; ${SCEN_CHATS}`,
  },
  aggregateTps: {
    formula: 'chats ÷ step time',
    from: [C.bandwidth, C.params, C.kvPerToken, C.capacity],
    scenario: `${SCEN_BYTES}; ${SCEN_CHATS}`,
  },
  perUserTps: {
    formula: 'aggregate tok/s ÷ chats',
    from: [C.bandwidth, C.params, C.kvPerToken, C.capacity],
    scenario: `${SCEN_BYTES}; ${SCEN_CHATS}`,
  },
  mathIdleAtBatch: {
    formula: '1 − 2 · parameters · aggregate tok/s ÷ BF16 FLOPS',
    from: [C.params, C.flops, C.bandwidth, C.kvPerToken, C.capacity],
    scenario: `${SCEN_BYTES}; ${SCEN_CHATS}`,
  },
}

/* ---------------- Roofline (step 3) ---------------- */

/** Batch sizes drawn on the roofline and listed in its table. */
export const ROOFLINE_BATCHES = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024] as const
export const MAX_BATCH = 1024

export interface RooflinePoint {
  batch: number
  /** Attainable TFLOPS: min(peak, batch × bandwidth), since one weight byte is reused by `batch` tokens. */
  tflops: number
  /** Share of peak math in use, 0..1. */
  busy: number
  bound: 'memory' | 'compute'
}

/**
 * Weights-only roofline for decode: a BF16 weight is 2 bytes and each token does 2 FLOPs on it, so a
 * batch of `b` tokens does `b` FLOP per byte read. KV traffic is left out on purpose; step 4 adds it.
 */
export function rooflineAt(batch: number, i: BootInputs = bootInputs()): RooflinePoint {
  const b = Math.max(1, batch)
  const mem = (b * i.bandwidth) / 1e12
  const peak = i.flops / 1e12
  return { batch: b, tflops: Math.min(peak, mem), busy: Math.min(1, mem / peak), bound: mem < peak ? 'memory' : 'compute' }
}

/* ---------------- Grading ---------------- */

/** Step 1: right if within 2× either way; the score falls off a decade at a time. */
export function gradeGuess(value: number, truth: number): { ok: boolean; score: number } {
  if (!(value > 0) || !Number.isFinite(value)) return { ok: false, score: 0 }
  const r = value / truth
  return { ok: Math.abs(Math.log2(r)) <= 1, score: Math.max(0, 1 - Math.abs(Math.log10(r))) }
}

/** Steps 2–4: right if within ±`tolerance` (a fraction) of the truth; no partial score. */
export function gradeNear(value: number, truth: number, tolerance: number): { ok: boolean; score: number } {
  const ok = Number.isFinite(value) && Math.abs(value - truth) <= tolerance * truth
  return { ok, score: ok ? 1 : 0 }
}

/** Tolerances from the spec: ±5% (faded example), ±10% (ridge, KV tokens). */
export const TOLERANCE = { faded: 0.05, ridge: 0.1, kvTokens: 0.1 } as const

/** Step 5: the guess was in the right range for the *aggregate* number, which is the wrong reason. */
export const guessMatchesAggregate = (guess: number, aggregateTps: number): boolean =>
  guess > 0 && Math.abs(Math.log2(guess / aggregateTps)) <= 1

/* ---------------- Content fingerprints (spec §4.5) ---------------- */

export type BootStep = 'guess-1user' | 'faded-decode' | 'ridge' | 'kv-tokens' | 'why-batching'

/** Graded steps in order. Their refs are `boot:<step>`. */
export const GRADED_STEPS: readonly BootStep[] = ['guess-1user', 'faded-decode', 'ridge', 'kv-tokens', 'why-batching']

const CLAIMS_BY_STEP: Record<BootStep, string[]> = {
  'guess-1user': [C.bandwidth, C.params],
  'faded-decode': [C.bandwidth, C.params],
  ridge: [C.flops, C.bandwidth],
  'kv-tokens': [C.capacity, C.params, C.kvPerToken],
  'why-batching': [C.bandwidth, C.params, C.capacity, C.kvPerToken],
}

const sig3 = (n: number): number => Number(n.toPrecision(3))

/** The answer each step is graded against. */
export function truthFor(step: BootStep, m: BootModel = BOOT): number {
  switch (step) {
    case 'guess-1user':
    case 'faded-decode':
      return m.decodeTps
    case 'ridge':
      return m.ridge
    case 'kv-tokens':
      return m.kvTokens
    case 'why-batching':
      return m.aggregateTps
  }
}

/** `rev32({step, truth to 3 significant figures, claims as id@verifiedAt})`: it changes when the numbers behind a step do. */
export function bootRev(step: BootStep, m: BootModel = BOOT): string {
  return rev32({
    step,
    truth: sig3(truthFor(step, m)),
    claims: CLAIMS_BY_STEP[step].map((id) => `${id}@${getClaim(id).verifiedAt}`),
  })
}

/* ---------------- Formatting (the copy bands the tests hold) ---------------- */

const groups = (n: number): string => Math.round(n).toLocaleString('en-US')

export const fmt = {
  /** 16.06 GB → "16 GB" */
  gb: (bytes: number): string => `${Math.round(bytes / 1e9)} GB`,
  /** 131,072 B → "128 KiB": the KV-cache-per-token claim in binary units, one decimal at most */
  kib: (bytes: number): string => `${Number((bytes / 1024).toFixed(1)).toLocaleString('en-US')} KiB`,
  /** 208.6 → "≈209 tok/s" */
  tps: (v: number): string => `≈${groups(v)} tok/s`,
  /** 0.0034 → "≈0.3%" */
  pctSmall: (f: number): string => `≈${(f * 100).toFixed(1)}%`,
  /** 295.2 → "≈295" */
  ridge: (v: number): string => `≈${groups(v)}`,
  /** 487,823 → "≈488k" */
  kTokens: (v: number): string => `≈${Math.round(v / 1000)}k`,
  /** 119.1 → "about 120" (the story rounds to the nearest ten) */
  chats: (n: number): string => `about ${Math.round(n / 10) * 10}`,
  /** 0.0239 s → "≈24 ms" */
  ms: (seconds: number): string => `≈${Math.round(seconds * 1000)} ms`,
  /** 4,986 → "≈5,000 tok/s" (nearest 100) */
  tpsRound: (v: number): string => `≈${(Math.round(v / 100) * 100).toLocaleString('en-US')} tok/s`,
  /** 0.919 → "~90%" (nearest ten) */
  pctTen: (f: number): string => `~${Math.round(f * 10) * 10}%`,
}
