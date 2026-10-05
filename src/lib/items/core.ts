/**
 * The generator framework's core (docs/specs/wave-1.md §5.1, §5.4): seeds, the per-instance rng,
 * variant choice, the instance builder and the fingerprint.
 *
 * Everything here is integer arithmetic over the shared splitmix32, so the same
 * (family, version, seed, level, variant) builds a deep-equal `Instance` in Bun, Chrome, Firefox
 * and Safari. verify-determinism lints this file: no Math.random, Date, performance.now or
 * crypto.getRandomValues. Grading (`grade.ts`) and the staircase (`staircase.ts`) may use logs.
 */

import { getClaim } from '@/data/claims'
import { rev32 } from '@/lib/ledger/stable'
import { hash32, splitmix32u } from '@/lib/rng'
import type { Gen, Instance, Level, PromptPart, SolutionStep, VariantSpec } from './types'
import { formatNumber } from './units'

const TWO_32 = 4294967296

/**
 * The seed of item `i` of a session or ticket whose base seed is `base`. The base drives every item
 * seed, and each item seed is drawn fresh at serve time: that is what makes a served item `unseen`.
 */
export function seedFor(base: number, i: number): number {
  return splitmix32u(base ^ Math.imul(i + 1, 0x9e3779b9))()
}

/** A seeded stream for building one instance. Every draw is integer-derived and reproducible. */
export interface Rng {
  /** The next raw uint32. */
  u32(): number
  /** An integer in [lo, hi], both ends included. */
  int(lo: number, hi: number): number
  /** One element, uniformly. */
  pick<T>(xs: readonly T[]): T
  /** A shuffled copy (Fisher–Yates). */
  shuffle<T>(xs: readonly T[]): T[]
  /** `k` distinct elements, in a random order. */
  sample<T>(xs: readonly T[], k: number): T[]
}

export function makeRng(seed: number): Rng {
  const next = splitmix32u(seed)
  const int = (lo: number, hi: number): number => {
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) throw new RangeError(`rng.int(${lo}, ${hi})`)
    // a double product of a uint32 and a small span is exact enough to be identical in every engine
    return lo + Math.floor((next() / TWO_32) * (hi - lo + 1))
  }
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const out = xs.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i)
      const t = out[i]
      out[i] = out[j]
      out[j] = t
    }
    return out
  }
  return {
    u32: next,
    int,
    pick: <T>(xs: readonly T[]): T => {
      if (xs.length === 0) throw new RangeError('rng.pick of an empty list')
      return xs[int(0, xs.length - 1)]
    },
    shuffle,
    sample: <T>(xs: readonly T[], k: number): T[] => {
      if (k > xs.length) throw new RangeError(`rng.sample(${k}) of ${xs.length}`)
      return shuffle(xs).slice(0, k)
    },
  }
}

/**
 * The stream for one (family, variant, level, seed). The variant and level are mixed in, so the same
 * seed at two levels or in two variants draws unrelated numbers.
 */
export function rngFor(family: string, variant: string, level: Level, seed: number): Rng {
  return makeRng((seed ^ hash32(`${family}/${variant}`) ^ Math.imul(level + 1, 0x85ebca6b)) | 0)
}

/**
 * The variant to build. An explicit one must exist and offer `level`; otherwise the seed picks among
 * the variants that offer it, so a ticket's seed alone decides which variant a learner meets.
 */
export function resolveVariant(gen: Pick<Gen, 'id' | 'variants'>, seed: number, level: Level, variant?: string): VariantSpec {
  if (variant !== undefined) {
    const v = gen.variants.find((x) => x.id === variant)
    if (!v) throw new RangeError(`${gen.id}: unknown variant "${variant}"`)
    if (!v.levels.includes(level)) throw new RangeError(`${gen.id}/${variant}: no level ${level}`)
    return v
  }
  const offered = gen.variants.filter((x) => x.levels.includes(level))
  if (offered.length === 0) throw new RangeError(`${gen.id}: no variant offers level ${level}`)
  return offered[splitmix32u((seed ^ 0x5bd1e995 ^ Math.imul(level + 1, 0x27d4eb2f)) | 0)() % offered.length]
}

/** `id@verifiedAt` for a claim an instance used, so a claim update changes the fingerprint. */
export function claimRef(id: string): string {
  return `${id}@${getClaim(id).verifiedAt}`
}

/** The fingerprint of an instance: `rev32(stableStringify({family, version, variant, level, params, claims}))`. */
export function instanceRev(i: Pick<Instance, 'family' | 'version' | 'variant' | 'level' | 'params' | 'claims'>): string {
  const { family, version, variant, level, params, claims } = i
  return rev32({ family, version, variant, level, params, claims })
}

/** What a family's `make` supplies; `finishInstance` adds the family, version, sorted claims and rev. */
export type InstanceDraft = Omit<Instance, 'family' | 'version' | 'rev' | 'claims'> & { claims?: readonly string[] }

/**
 * Completes an instance. Params must be JSON-safe numbers, strings and booleans: a NaN would
 * serialise as null and silently change what the fingerprint and the replay see.
 */
export function finishInstance(gen: Pick<Gen, 'id' | 'version'>, draft: InstanceDraft): Instance {
  for (const [k, v] of Object.entries(draft.params)) {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new RangeError(`${gen.id}/${draft.variant}: param ${k} is not finite`)
  }
  const claims = [...new Set(draft.claims ?? [])].sort()
  const inst: Omit<Instance, 'rev'> = { ...draft, family: gen.id, version: gen.version, claims }
  return { ...inst, rev: instanceRev(inst) }
}

/** One prompt run as the text a learner (or a screen reader) gets. */
export function partText(p: PromptPart): string {
  switch (p.t) {
    case 'text':
      return p.text
    case 'value':
      return `${formatNumber(p.value, p.digits)}${p.unit ? ` ${p.unit}` : ''}`
    case 'claim': {
      // resolves the id, so a lint over the text also catches a claim that does not exist
      const { value, unit } = getClaim(p.claim)
      const shown = typeof value === 'number' ? formatNumber(value * (p.scale ?? 1)) : value
      const u = p.unit ?? unit
      return u ? `${shown} ${u}` : shown
    }
    case 'code':
      return p.code
  }
}

export function partsText(parts: readonly PromptPart[]): string {
  return parts.map(partText).join('')
}

/** Every string an instance shows: stem, givens, worked steps, options and their whys. Used by lints. */
export function instanceText(inst: Instance, solution?: readonly SolutionStep[]): string[] {
  const out: string[] = [partsText(inst.prompt.stem)]
  for (const g of inst.prompt.givens ?? []) out.push(g.label, partText(g.value))
  for (const s of inst.prompt.worked ?? []) out.push(partsText(s.text))
  for (const s of solution ?? []) out.push(partsText(s.text))
  if (inst.answer.kind === 'choice') for (const o of inst.answer.options) out.push(o.text, o.why)
  else out.push(inst.answer.unit)
  return out
}
