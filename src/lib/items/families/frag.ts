/**
 * The `frag` family: block placement and fragmentation (docs/specs/wave-1.md §5.5).
 *
 * KCs: t1.internal-frag, t1.external-frag, t1.fixed-blocks, t1.placement-policy. Five variants at
 * levels 0-3: internal waste in fixed blocks, the largest request a heap of free runs can serve, the
 * fragmentation metric 1 - largest/total, first-/best-/next-fit on a short trace, and the KV-block
 * waste behind PagedAttention. Pins: t1.l4 fig 1 (2K + 1K + 3K free is 50 % fragmented and cannot
 * serve a 6K request) and the "<4 % vLLM KV waste" chip.
 *
 * Instance construction is integer arithmetic, so the output is identical in every runtime. Lists
 * travel in params as comma-joined strings (params are JSON scalars).
 */

import { claimNumber } from '@/data/claims'
import { claimRef, finishInstance, resolveVariant, rngFor, type Rng } from '../core'
import { gradeResponse } from '../grade'
import type { AnswerSpec, Gen, Instance, Level, Params, PromptPart, RatioRule, SolutionStep, UnitChoice, VariantSpec } from '../types'
import { byteUnitChoices, formatNumber, KIB } from '../units'

const BLOCK_CLAIM = 'production.vllm.block-size'
// The four KC ids of src/data/kc/ids.ts, written out so the chunk need not carry the whole table (tests/items/frag.test.ts pins them to it).
const KC = { internalFrag: 't1.internal-frag', externalFrag: 't1.external-frag', fixedBlocks: 't1.fixed-blocks', placementPolicy: 't1.placement-policy' }

/** Scenario numbers: hypothetical heaps, request sizes and sequence lengths (spec §5.4). */
const SYNTHETIC = {
  levels: [0, 1, 2, 3] as const,
  // the transfer level: pages and KiB instead of bytes, percents instead of slots
  transfer: 3 as const,
  nsec: { internal: 60, largest: 40, metric: 50, fit: 75, kv: 70 },
  // a rule never claims a ratio within this of 1: that is a right answer
  apart: 0.03,
  digits: 3,
  // internal-waste: block sizes in bytes, OS page sizes in bytes (level 3), requests per level
  blocks: [64, 128, 256, 512, 1024, 2048, 4096],
  pages: [2048, 4096, 8192],
  requests: [3, 4, 5, 5],
  span: 5,
  // free runs: units of `align` bytes (level 0 uses tens), run counts per level, how small the others get
  align: 8,
  runMin: 8,
  runMax: 16000,
  kibRunMin: 2,
  kibRunMax: 64,
  usedMin: 1,
  usedMax: 30,
  largestRuns: [3, 4, 5, 5],
  metricRuns: [3, 3, 4, 5],
  largestSpread: 8,
  metricSpread: 4,
  // fit-choice: holes per level, trace length per level, search effort
  holes: [5, 5, 5, 7],
  trace: [3, 3, 4, 5],
  failReqMax: 14,
  holeMin: 3,
  holeMax: 16,
  gapMin: 2,
  gapMax: 6,
  reqMin: 2,
  reqMax: 9,
  tries: 1000,
  // kv-block-waste: the PagedAttention block-size sweep, sequences per level, token lengths
  kvBlocks: [8, 16, 32, 64, 128, 256],
  sequences: [3, 8, 8, 8],
  minTokens: 20,
  maxTokens: 2000,
  // the lesson's examples: fig 1's free runs (KiB between used segments, then in bytes), the 300-token sequence, an eight-sequence mix
  pin: {
    fig1: '4,2,3,1,5,3',
    fig1Frag: 50,
    fig1Bytes: '4096,2048,3072,1024,5120,3072',
    fig1Largest: 3,
    block: 16,
    one: '300',
    oneWaste: 4,
    mix: '330,245,288,412,367,301,190,455',
    mixWaste: 1.371951219512,
  },
  // answer tolerances: counts and sizes are exact, percents are read to the nearest point
  tolRel: 0.01,
  tolAbs: 0.5,
  tolPctAbs: 0.1,
}

const VARIANTS: VariantSpec[] = [
  { id: 'internal-waste', title: 'Waste inside fixed blocks', kcs: [KC.internalFrag, KC.fixedBlocks], levels: SYNTHETIC.levels, nsec: SYNTHETIC.nsec.internal },
  { id: 'largest-fit', title: 'The largest request that fits', kcs: [KC.externalFrag], levels: SYNTHETIC.levels, nsec: SYNTHETIC.nsec.largest },
  { id: 'frag-metric', title: 'The fragmentation metric', kcs: [KC.externalFrag], levels: SYNTHETIC.levels, nsec: SYNTHETIC.nsec.metric },
  { id: 'fit-choice', title: 'First, best and next fit', kcs: [KC.placementPolicy, KC.externalFrag], levels: SYNTHETIC.levels, nsec: SYNTHETIC.nsec.fit },
  { id: 'kv-block-waste', title: 'KV-cache block waste', kcs: [KC.fixedBlocks, KC.internalFrag], levels: SYNTHETIC.levels, nsec: SYNTHETIC.nsec.kv },
]

/* ------------------------------ small helpers ------------------------------ */

const t = (text: string): PromptPart => ({ t: 'text', text })
const v = (value: number, unit?: string): PromptPart => (unit === undefined ? { t: 'value', value } : { t: 'value', value, unit })
const f = (n: number): string => formatNumber(n)
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)
const ceilDiv = (a: number, b: number): number => Math.floor((a + b - 1) / b)
const nums = (s: string): number[] => s.split(',').map(Number)
const enc = (xs: readonly number[]): string => xs.join(',')
const list = (xs: readonly number[], unit: string): string => `${xs.map(f).join(', ')} ${unit}`
const draws = (n: number, one: () => number): number[] => Array.from({ length: n }, one)

/** Blocks, per-request tails and totals when each size is rounded up to whole blocks. */
function tally(block: number, sizes: readonly number[]) {
  const blocks = sizes.map((s) => ceilDiv(s, block))
  const tails = sizes.map((s, i) => blocks[i] * block - s)
  const alloc = sum(blocks) * block
  const need = sum(sizes)
  return { blocks, tails, alloc, need, waste: alloc - need }
}

/** 100 × part ÷ whole, one rounding so every runtime agrees. */
const pct = (part: number, whole: number): number => (part * 100) / whole

/* ------------------------------ placement simulator ------------------------------ */

interface Hole {
  off: number
  size: number
}
interface Placed {
  /** offset, or -1 when no hole was big enough */
  off: number
  /** the hole's size before the split, or the largest hole when the request failed */
  room: number
}
const POLICIES = ['first', 'best', 'next'] as const
type Policy = (typeof POLICIES)[number]
const NAME: Record<Policy, string> = { first: 'First-fit', best: 'Best-fit', next: 'Next-fit' }
const RULE: Record<Policy, string> = {
  first: 'the lowest-addressed hole that is big enough',
  best: 'the smallest hole that is big enough',
  next: 'the first big-enough hole after its last placement, wrapping around',
}

const holesText = (hs: readonly Hole[]): string => hs.map((h) => `${h.off}:${h.size}`).join(',')
const holesOf = (s: string): Hole[] => s.split(',').map((x) => ({ off: Number(x.split(':')[0]), size: Number(x.split(':')[1]) }))

function pick(hs: readonly Hole[], size: number, policy: Policy, rover: number): number {
  if (policy === 'first') return hs.findIndex((h) => h.size >= size)
  if (policy === 'best') {
    let at = -1
    hs.forEach((h, i) => {
      if (h.size >= size && (at < 0 || h.size < hs[at].size)) at = i
    })
    return at
  }
  const start = hs.findIndex((h) => h.off >= rover)
  const from = start < 0 ? hs.length : start
  for (let k = 0; k < hs.length; k++) {
    const i = (from + k) % hs.length
    if (hs[i].size >= size) return i
  }
  return -1
}

/** Serves `reqs` in order under one policy; stops after the first request that fits nowhere. */
function run(holes: readonly Hole[], reqs: readonly number[], policy: Policy): Placed[] {
  const hs = holes.map((h) => ({ ...h }))
  const out: Placed[] = []
  let rover = 0
  for (const size of reqs) {
    const i = pick(hs, size, policy, rover)
    if (i < 0) {
      out.push({ off: -1, room: Math.max(...hs.map((h) => h.size), 0) })
      break
    }
    const { off, size: room } = hs[i]
    out.push({ off, room })
    rover = off + size
    if (room === size) hs.splice(i, 1)
    else hs[i] = { off: off + size, size: room - size }
  }
  return out
}

const offsetsText = (runs: Placed[][], i: number, unit: string): string =>
  POLICIES.map((p, k) => `${NAME[p]} ${runs[k][i] === undefined ? 'has stopped' : runs[k][i].off < 0 ? 'fails' : `offset ${f(runs[k][i].off)} ${unit}`}`).join(', ')

/** The request index each policy first fails at (the trace length when it never does). */
const failAt = (runs: Placed[][], n: number): number[] => runs.map((r) => (r[r.length - 1].off < 0 ? r.length - 1 : n))

/** 'none', the one policy that fails strictly before the others, or null when that is a tie. */
function firstToFail(runs: Placed[][], n: number): Policy | 'none' | null {
  const at = failAt(runs, n)
  const min = Math.min(...at)
  if (min === n) return 'none'
  return at.filter((a) => a === min).length === 1 ? POLICIES[at.indexOf(min)] : null
}

/** A "place" trace is askable when all three policies place the last request, at three different offsets. */
function distinctLast(runs: Placed[][], n: number): boolean {
  if (runs.some((r) => r.length < n || r[n - 1].off < 0)) return false
  const last = runs.map((r) => r[n - 1].off)
  return new Set(last).size === POLICIES.length
}

/* ------------------------------ drawing an instance's params ------------------------------ */

type Draw = (rng: Rng, level: Level) => Params

/** Free runs in units of `unit`, the largest first drawn, the rest no smaller than largest ÷ spread. */
function drawRuns(rng: Rng, n: number, lo: number, hi: number, spread: number): number[] {
  const top = rng.int(lo, hi)
  const least = Math.max(1, Math.floor(top / spread))
  return rng.shuffle([top, ...draws(n - 1, () => rng.int(least, top))])
}

/** Alternating used/free segments, used first, one pair per free run. */
function drawLayout(rng: Rng, free: readonly number[]): number[] {
  return free.flatMap((r) => [rng.int(SYNTHETIC.usedMin, SYNTHETIC.usedMax), r])
}

const drawInternal: Draw = (rng, level) => {
  const page = level === SYNTHETIC.transfer
  const block = rng.pick(page ? SYNTHETIC.pages : SYNTHETIC.blocks)
  const u = level === 0 ? 10 : 1
  const lo = ceilDiv(block, 2 * u)
  const hi = Math.floor((SYNTHETIC.span * block) / u)
  const sizes = draws(SYNTHETIC.requests[level], () => u * rng.int(lo, hi))
  if (tally(block, sizes).waste === 0) sizes[0] += 1
  const ask = page ? 'kib' : level === 2 ? rng.pick(['bytes', 'percent']) : 'bytes'
  return { block, sizes: enc(sizes), ask }
}

/** Free runs: a plain list (bytes) at levels 0-2, or used/free segments at level 3. */
const drawFree =
  (counts: readonly number[], spread: number, metric: boolean): Draw =>
  (rng, level): Params => {
    const kib = metric && level === SYNTHETIC.transfer
    const u = level === 0 ? 10 : SYNTHETIC.align
    const lo = kib ? SYNTHETIC.kibRunMin : ceilDiv(SYNTHETIC.runMin, u)
    const hi = kib ? SYNTHETIC.kibRunMax : Math.floor(SYNTHETIC.runMax / u)
    const runs = drawRuns(rng, counts[level], lo, hi, spread).map((r) => (kib ? r : r * u))
    const unit: Params = metric ? { unit: kib ? 'KiB' : 'B' } : {}
    return level === SYNTHETIC.transfer ? { layout: enc(drawLayout(rng, runs)), ...unit } : { runs: enc(runs), ...unit }
  }

function drawHoles(rng: Rng, n: number): Hole[] {
  const holes: Hole[] = []
  let at = rng.int(0, SYNTHETIC.gapMax)
  for (let i = 0; i < n; i++) {
    const size = rng.int(SYNTHETIC.holeMin, SYNTHETIC.holeMax)
    holes.push({ off: at, size })
    at += size + rng.int(SYNTHETIC.gapMin, SYNTHETIC.gapMax)
  }
  return holes
}

const drawFit: Draw = (rng, level) => {
  const place = level < 2 || (level === 2 && rng.int(0, 1) === 0)
  const wanted = rng.pick([...POLICIES, 'none'] as const)
  const policy = rng.pick(POLICIES)
  const unit = level === SYNTHETIC.transfer ? 'KiB' : 'cells'
  const n = SYNTHETIC.trace[level]
  const params = (holes: string, reqs: string): Params => ({ form: place ? 'place' : 'fail', policy: place ? policy : 'none', holes, reqs, unit })
  let spare: Params | undefined
  let spareKey: string | undefined
  for (let i = 0; i < SYNTHETIC.tries; i++) {
    const holes = drawHoles(rng, SYNTHETIC.holes[level])
    const reqs = draws(n, () => rng.int(SYNTHETIC.reqMin, place ? SYNTHETIC.reqMax : SYNTHETIC.failReqMax))
    const runs = POLICIES.map((p) => run(holes, reqs, p))
    const key = place ? (distinctLast(runs, n) ? 'ok' : null) : firstToFail(runs, n)
    if (key === null) continue
    const found = params(holesText(holes), enc(reqs))
    // steer the fail form toward the wanted key so each answer turns up about equally often
    if (place || key === wanted) return found
    // a failing policy is a better answer to keep than 'none', which turns up on its own
    if (spare === undefined || (spareKey === 'none' && key !== 'none')) {
      spare = found
      spareKey = key
    }
  }
  // a thousand draws with no unambiguous trace is out of reach for any seed, but a throw beats a broken item
  if (spare === undefined) throw new RangeError('frag/fit-choice: no unambiguous trace found')
  return spare
}

const drawKv: Draw = (rng, level) => {
  const block = rng.pick(SYNTHETIC.kvBlocks)
  const u = level === 0 ? 10 : 1
  const lens = draws(SYNTHETIC.sequences[level], () => u * rng.int(ceilDiv(SYNTHETIC.minTokens, u), Math.floor(SYNTHETIC.maxTokens / u)))
  if (tally(block, lens).waste === 0) lens[0] += 1
  // slots at level 1 and half of level 2; the rest ask a percent, whose answers are far more varied
  const ask = level === 1 ? 'slots' : level === 2 ? rng.pick(['slots', 'percent']) : 'percent'
  return { block, lens: enc(lens), ask }
}

const DRAW: Record<string, Draw> = {
  'internal-waste': drawInternal,
  'largest-fit': drawFree(SYNTHETIC.largestRuns, SYNTHETIC.largestSpread, false),
  'frag-metric': drawFree(SYNTHETIC.metricRuns, SYNTHETIC.metricSpread, true),
  'fit-choice': drawFit,
  'kv-block-waste': drawKv,
}

/* ------------------------------ describing an instance ------------------------------ */

/** Everything an instance shows and solves, derived from its params alone (so `solution` can rebuild it). */
interface Spec {
  stem: PromptPart[]
  givens: { label: string; value: PromptPart }[]
  answer: AnswerSpec
  claims: string[]
  /** Worked steps; the last one carries the answer. */
  calc: SolutionStep[]
  /** The reason behind the number, shown with the solution only. */
  why?: SolutionStep
}

const step = (text: string, value?: number, unit?: string): SolutionStep =>
  value === undefined ? { text: [t(text)] } : { text: [t(text)], result: unit === undefined ? { value } : { value, unit } }

const numeric = (truth: number, unit: string, pctAnswer: boolean, units?: UnitChoice[]): AnswerSpec => ({
  kind: 'numeric',
  truth,
  unit,
  tolerance: pctAnswer ? { rel: SYNTHETIC.tolRel, abs: SYNTHETIC.tolPctAbs } : { rel: SYNTHETIC.tolRel, abs: SYNTHETIC.tolAbs },
  ...(units ? { units } : {}),
})

/** The four worked steps shared by the block-rounding variants: blocks, allocated, held, wasted. */
function wasteSteps(noun: string, what: string, unit: 'B' | 'slots', block: number, sizes: readonly number[], k: ReturnType<typeof tally>): SolutionStep[] {
  const name = unit === 'B' ? 'bytes' : unit
  return [
    step(`${noun === 'page' ? 'Pages' : 'Blocks'} per ${what}, rounded up: ${k.blocks.map(f).join(', ')}`, sum(k.blocks), `${noun}s`),
    step(`Allocated ${name}: ${f(sum(k.blocks))} ${noun}s × ${f(block)}`, k.alloc, unit),
    step(`Held ${name}: ${list(sizes, unit === 'B' ? 'B' : 'tokens')} added up`, k.need, unit),
    step(`Wasted ${name}: allocated − held`, k.waste, unit),
  ]
}

const percentStep = (k: ReturnType<typeof tally>): SolutionStep => step('Percent wasted: wasted ÷ allocated × 100', pct(k.waste, k.alloc), '%')

/** Internal waste in fixed blocks of bytes (`kv` false) or of KV-cache token slots (`kv` true). */
function describeBlocks(p: Params, kv: boolean): Spec {
  const block = Number(p.block)
  const sizes = nums(String(kv ? p.lens : p.sizes))
  const ask = String(p.ask)
  const k = tally(block, sizes)
  const page = ask === 'kib'
  const unit = kv ? 'slots' : 'B'
  const stock = kv && block === claimNumber(BLOCK_CLAIM)
  const calc = wasteSteps(page ? 'page' : 'block', kv ? 'sequence' : 'request', unit, block, sizes, k)
  let answer: AnswerSpec
  if (ask === 'percent') {
    calc.push(percentStep(k))
    answer = numeric(pct(k.waste, k.alloc), '%', true)
  } else if (page) {
    calc.push(step(`In KiB: wasted bytes ÷ ${f(KIB)}`, k.waste / KIB, 'KiB'))
    answer = numeric(k.waste / KIB, 'KiB', false, byteUnitChoices('KiB', ['B']))
  } else {
    answer = numeric(k.waste, unit, false, kv ? undefined : byteUnitChoices('B', ['KiB']))
  }
  const size = kv ? v(block, 'tokens') : v(page ? block / KIB : block, page ? 'KiB' : 'B')
  const question = ask === 'percent' ? `What percent of the allocated ${kv ? 'token slots sit unused in last blocks' : 'bytes is wasted inside the blocks'}?` : page ? 'How much memory is wasted inside the pages, in KiB?' : kv ? 'How many token slots sit unused in the last blocks?' : 'How many bytes are wasted inside the blocks?'
  const lead = kv ? (stock ? "A paged KV cache stores each sequence in fixed blocks of vLLM's default size, " : 'A hypothetical paged KV cache stores each sequence in fixed blocks of ') : page ? 'An OS hands out memory in whole pages of ' : 'A fixed-block allocator rounds every request up to whole blocks of '
  return {
    stem: [t(lead), stock ? { t: 'claim', claim: BLOCK_CLAIM } : size, t(`. ${question}`)],
    givens: [
      { label: page ? 'Page size' : 'Block size', value: size },
      { label: kv ? 'Sequence lengths' : 'Requests', value: t(list(sizes, kv ? 'tokens' : 'B')) },
    ],
    answer,
    claims: stock ? [claimRef(BLOCK_CLAIM)] : [],
    calc,
    ...(kv
      ? { why: step(`Only a sequence's last block can be partly empty, so each sequence wastes at most ${f(block - 1)} slots, under one block. That caps this batch at ${f(sizes.length * (block - 1))} slots.`) }
      : {}),
  }
}

/** Free runs of a heap, from a plain list or from used/free segments. */
const freeRuns = (p: Params): number[] => (p.layout === undefined ? nums(String(p.runs)) : nums(String(p.layout)).filter((_, i) => i % 2 === 1))

function describeRuns(p: Params, metric: boolean): Spec {
  const runs = freeRuns(p)
  const layout = p.layout === undefined ? undefined : nums(String(p.layout))
  const unit = metric ? String(p.unit) : 'B'
  const total = sum(runs)
  const top = Math.max(...runs)
  const kib = !metric && layout !== undefined
  const where: Pick<Spec, 'stem' | 'givens'> = layout
    ? {
        stem: [t('A heap holds these segments from the low address up. ' + (metric ? 'What percent fragmented is its free memory?' : 'What is the largest single request that can succeed, in KiB?'))],
        givens: [{ label: 'Segments', value: t(layout.map((x, i) => `${i % 2 === 0 ? 'used' : 'free'} ${f(x)}`).join(', ') + ` ${unit}`) }],
      }
    : {
        stem: [t(metric ? 'A heap has these free runs, each walled in by live data. What percent fragmented is its free memory, 1 − largest ÷ total?' : 'A heap has these free runs, each walled in by live data. What is the largest single request that can succeed?')],
        givens: [{ label: 'Free runs', value: t(list(runs, unit)) }],
      }
  if (metric) {
    const share = top / total
    const frag = pct(total - top, total)
    return {
      ...where,
      answer: numeric(frag, '%', true),
      claims: [],
      calc: [
        step(`Total free: ${list(runs, unit)} added up`, total, unit),
        step('Largest free run', top, unit),
        step(`Largest ÷ total = ${formatNumber(share, SYNTHETIC.digits)}`, share),
        step('Fragmentation = 1 − largest ÷ total, as a percent', frag, '%'),
      ],
    }
  }
  return {
    ...where,
    answer: numeric(kib ? top / KIB : top, kib ? 'KiB' : 'B', false, byteUnitChoices(kib ? 'KiB' : 'B', [kib ? 'B' : 'KiB'])),
    claims: [],
    calc: [
      step(`Free runs: ${f(runs.length)}, each walled in by live data`, runs.length, 'runs'),
      step(`Total free: ${list(runs, unit)} added up. one request needs a single run, so the total is not the limit`, total, unit),
      step(`Largest run: ${f(top)} ${unit}${kib ? ', which is ' + f(top / KIB) + ' KiB' : ''}`, kib ? top / KIB : top, kib ? 'KiB' : 'B'),
    ],
  }
}

function describeFit(p: Params): Spec {
  const holes = holesOf(String(p.holes))
  const reqs = nums(String(p.reqs))
  const unit = String(p.unit)
  const place = p.form === 'place'
  const asked = String(p.policy) as Policy
  const n = reqs.length
  const runs = POLICIES.map((pol) => run(holes, reqs, pol))
  const calc = reqs.map((size, i) => step(`Request ${i + 1}, ${f(size)} ${unit}: ${offsetsText(runs, i, unit)}`))
  const holeList = holes.map((h) => `offset ${f(h.off)} (${f(h.size)} ${unit})`).join(', ')
  const stem = [
    t(
      `A heap has free holes at ${holeList}; everything else is in use. Requests of ${list(reqs, unit)} arrive in that order. Each goes at the start of the hole its policy picks; the rest of that hole stays free. Next-fit searches on from where its last placement ended, starting at offset 0. `,
    ),
  ]
  const givens = [
    { label: 'Free holes', value: t(holeList) },
    { label: 'Requests', value: t(list(reqs, unit)) },
  ]
  if (place) {
    const at = runs.map((r) => r[n - 1])
    const options = POLICIES.map((pol, k) => ({
      id: pol,
      text: `Offset ${f(at[k].off)} ${unit}`,
      why:
        pol === asked
          ? `${NAME[pol]} takes ${RULE[pol]}: here the hole at offset ${f(at[k].off)}, ${f(at[k].room)} ${unit} big.`
          : `That is where ${NAME[pol]} puts request ${n}: it takes ${RULE[pol]}.`,
      ...(pol === asked ? {} : { miss: `frag.applied-${pol}-fit` }),
    }))
    return {
      stem: [...stem, t(`At which offset does ${NAME[asked].toLowerCase()} place request ${n}?`)],
      givens,
      answer: { kind: 'choice', options, correct: [asked] },
      claims: [],
      calc,
      why: step(options[POLICIES.indexOf(asked)].why),
    }
  }
  const key = firstToFail(runs, n)
  const at = failAt(runs, n)
  const options = [...POLICIES, 'none' as const].map((pol, k) => {
    const isKey = pol === key
    if (pol === 'none') {
      return {
        id: pol,
        text: 'No policy fails',
        why: isKey ? `Every rule places all ${f(n)} requests.` : `${NAME[key as Policy]} fails at request ${f(at[POLICIES.indexOf(key as Policy)] + 1)}.`,
        ...(isKey ? {} : { miss: 'frag.assumed-no-failure' }),
      }
    }
    const kfail = at[k]
    const fate = kfail < n ? `fails at request ${f(kfail + 1)}` : `places every request`
    return {
      id: pol,
      text: `${NAME[pol]} fails first`,
      why: isKey
        ? `${NAME[pol]} fails first: request ${f(kfail + 1)} needs ${f(reqs[kfail])} ${unit} and the largest hole is ${f(runs[k][kfail].room)}.`
        : `${NAME[pol]} ${fate}.`,
      ...(isKey ? {} : { miss: 'frag.policy-mixup' }),
    }
  })
  return {
    stem: [...stem, t('Which policy is the first to meet a request that fits in no hole? Each policy leaves a different heap behind.')],
    givens,
    answer: { kind: 'choice', options, correct: [key as string] },
    claims: [],
    calc,
    why: step(options.find((o) => o.id === key)!.why),
  }
}

const DESCRIBE: Record<string, (p: Params) => Spec> = {
  'internal-waste': (p) => describeBlocks(p, false),
  'largest-fit': (p) => describeRuns(p, false),
  'frag-metric': (p) => describeRuns(p, true),
  'fit-choice': describeFit,
  'kv-block-waste': (p) => describeBlocks(p, true),
}

/* ------------------------------ building and solving ------------------------------ */

function build(variant: string, level: Level, seed: number, params: Params): Instance {
  const spec = VARIANTS.find((x) => x.id === variant)!
  const d = DESCRIBE[variant](params)
  let worked: SolutionStep[] | undefined
  if (level < 2) {
    worked = d.calc.slice(0, -1)
    // level 1 blanks one middle step: the learner supplies its result
    if (level === 1) {
      const at = Math.floor(worked.length / 2)
      worked = worked.map((s, i) => (i === at ? { text: s.text, blank: true } : s))
    }
  }
  return finishInstance(gen, {
    variant,
    seed,
    level,
    params,
    kcs: [...spec.kcs],
    nsec: spec.nsec,
    prompt: { stem: d.stem, givens: d.givens, ...(worked && worked.length > 0 ? { worked } : {}) },
    answer: d.answer,
    claims: d.claims,
  })
}

function make(seed: number, level: Level, variant?: string): Instance {
  const spec = resolveVariant(gen, seed, level, variant)
  return build(spec.id, level, seed, DRAW[spec.id](rngFor(gen.id, spec.id, level, seed), level))
}

function solution(inst: Instance): SolutionStep[] {
  const d = DESCRIBE[inst.variant](inst.params)
  return d.why ? [...d.calc, d.why] : d.calc
}

/* ------------------------------ ratio rules ------------------------------ */

/** A ratio close to 1 is indistinguishable from a right answer, so no rule may claim it. */
const apart = (rho: number): number | null => (Number.isFinite(rho) && Math.abs(rho - 1) > SYNTHETIC.apart ? rho : null)

/** Per-request tails for the two block-rounding variants; null for the others. */
function tails(inst: Instance) {
  const p = inst.params
  if (inst.variant === 'internal-waste') return tally(Number(p.block), nums(String(p.sizes)))
  if (inst.variant === 'kv-block-waste') return tally(Number(p.block), nums(String(p.lens)))
  return null
}

const isPercent = (inst: Instance): boolean => inst.answer.kind === 'numeric' && inst.answer.unit === '%'

const RATIO_RULES: RatioRule[] = [
  {
    id: 'frag.counted-full-blocks',
    ratio: (inst) => {
      const k = tails(inst)
      return k ? apart((k.tails.filter((x) => x > 0).length * Number(inst.params.block)) / k.waste) : null
    },
    message: 'You counted each partly filled block as wasted. Only its unused part is waste.',
  },
  {
    id: 'frag.forgot-last-partial',
    // 1 − 1/n when the n tails are equal: the last request's tail is missing from the sum
    ratio: (inst) => {
      const k = tails(inst)
      return k && k.tails.length > 1 ? apart(1 - k.tails[k.tails.length - 1] / k.waste) : null
    },
    message: "You left out the last request's partly filled block. It wastes space too.",
  },
  {
    id: 'frag.used-total-free',
    ratio: (inst) => {
      if (inst.variant !== 'largest-fit') return null
      const runs = freeRuns(inst.params)
      return apart(sum(runs) / Math.max(...runs))
    },
    message: 'You gave the total free memory. A request needs one contiguous run, so the largest run is the limit.',
  },
  {
    id: 'frag.inverted-metric',
    ratio: (inst) => {
      if (inst.variant !== 'frag-metric') return null
      const runs = freeRuns(inst.params)
      const top = Math.max(...runs)
      return apart(top / (sum(runs) - top))
    },
    message: 'You gave largest ÷ total. Fragmentation is 1 − that.',
  },
  {
    id: 'frag.percent-vs-fraction',
    ratio: (inst) => (isPercent(inst) ? 1 / 100 : null),
    message: 'You gave a fraction; multiply by 100 for a percent.',
  },
]

/* ------------------------------ pins ------------------------------ */

const pins = [
  {
    name: 'fig 1: 2K + 1K + 3K free is 50 % fragmented',
    source: 't1.l4 fig 1',
    make: () => build('frag-metric', SYNTHETIC.transfer, 1, { layout: SYNTHETIC.pin.fig1, unit: 'KiB' }),
    truth: SYNTHETIC.pin.fig1Frag,
  },
  {
    name: 'fig 1: malloc(6K) fails, 3K is the largest run',
    source: 't1.l4 fig 1',
    make: () => build('largest-fit', SYNTHETIC.transfer, 1, { layout: SYNTHETIC.pin.fig1Bytes }),
    truth: SYNTHETIC.pin.fig1Largest,
  },
  {
    name: '300 tokens in 16-token blocks waste 4 slots',
    source: 't1.l4 text',
    make: () => build('kv-block-waste', 2, 1, { block: SYNTHETIC.pin.block, lens: SYNTHETIC.pin.one, ask: 'slots' }),
    truth: SYNTHETIC.pin.oneWaste,
  },
  {
    name: '<4 % vLLM KV waste, 16-token blocks',
    source: 't1.l4 chip',
    make: () => build('kv-block-waste', SYNTHETIC.transfer, 1, { block: SYNTHETIC.pin.block, lens: SYNTHETIC.pin.mix, ask: 'percent' }),
    truth: SYNTHETIC.pin.mixWaste,
  },
] satisfies Gen['pins']

const gen: Gen = {
  id: 'frag',
  version: 1,
  title: 'Block placement and fragmentation',
  kcs: [...new Set(VARIANTS.flatMap((x) => x.kcs))],
  variants: VARIANTS,
  ratioRules: RATIO_RULES,
  make,
  grade: (inst, response) => gradeResponse(inst, response, RATIO_RULES),
  solution,
  pins,
}

export default gen
