import { describe, expect, test } from 'bun:test'
import {
  BOOT,
  BOOT_CLAIMS,
  DERIVED_NOTES,
  GRADED_STEPS,
  bootInputs,
  bootRev,
  deriveBoot,
  fmt,
  gradeGuess,
  gradeNear,
  guessMatchesAggregate,
  rooflineAt,
  truthFor,
} from '../../src/lib/boot/model'
import { byId } from '../../src/data/claims'

/** Each derived value sits in a band that matches its copy (spec §12.4): a claim update that leaves a band fails here. */
describe('derived numbers (spec §12.4 table)', () => {
  test('weights: params × 2 B ≈ 16 GB', () => {
    expect(BOOT.weightsBytes / 1e9).toBeGreaterThan(15.9)
    expect(BOOT.weightsBytes / 1e9).toBeLessThan(16.2)
    expect(fmt.gb(BOOT.weightsBytes)).toBe('16 GB')
  })

  test('batch-1 decode ≈ 209 tok/s', () => {
    expect(BOOT.decodeTps).toBeGreaterThanOrEqual(205)
    expect(BOOT.decodeTps).toBeLessThanOrEqual(212)
    expect(fmt.tps(BOOT.decodeTps)).toBe('≈209 tok/s')
  })

  test('time to stream the weights once ≈ 4.8 ms, and its inverse is the decode ceiling', () => {
    expect(BOOT.tokenSeconds * 1000).toBeGreaterThanOrEqual(4.7)
    expect(BOOT.tokenSeconds * 1000).toBeLessThanOrEqual(4.9)
    expect(1 / BOOT.tokenSeconds).toBeCloseTo(BOOT.decodeTps, 9)
  })

  test('the math alone would allow ≈ 62,000 tok/s: the number a FLOPS-only guess lands on', () => {
    expect(BOOT.computeCeilingTps).toBeGreaterThanOrEqual(60_000)
    expect(BOOT.computeCeilingTps).toBeLessThanOrEqual(63_000)
    expect(BOOT.computeCeilingTps / BOOT.decodeTps).toBeCloseTo(1 / BOOT.mathBusyBatch1, 6)
  })

  test('math busy at batch 1 ≈ 0.3%', () => {
    expect(BOOT.mathBusyBatch1).toBeGreaterThanOrEqual(0.0032)
    expect(BOOT.mathBusyBatch1).toBeLessThanOrEqual(0.0036)
    expect(fmt.pctSmall(BOOT.mathBusyBatch1)).toBe('≈0.3%')
  })

  test('ridge ≈ 295 FLOP/B', () => {
    expect(BOOT.ridge).toBeGreaterThanOrEqual(290)
    expect(BOOT.ridge).toBeLessThanOrEqual(300)
    expect(fmt.ridge(BOOT.ridge)).toBe('≈295')
  })

  test('KV tokens that fit ≈ 488k', () => {
    expect(BOOT.kvTokens).toBeGreaterThanOrEqual(480_000)
    expect(BOOT.kvTokens).toBeLessThanOrEqual(495_000)
    expect(fmt.kTokens(BOOT.kvTokens)).toBe('≈488k')
  })

  test('KV cache per token reads 128 KiB: the claim in binary units', () => {
    expect(bootInputs().kvPerToken).toBe(131_072)
    expect(fmt.kib(bootInputs().kvPerToken)).toBe('128 KiB')
    expect(fmt.kib(262_144)).toBe('256 KiB')
    expect(fmt.kib(1_048_576)).toBe('1,024 KiB')
    expect(fmt.kib(131_072 + 512)).toBe('128.5 KiB') // a claim that is not a whole number of KiB keeps its half
  })

  test('chats of 4k: 119, "about 120"', () => {
    expect(BOOT.chats).toBeGreaterThanOrEqual(118)
    expect(BOOT.chats).toBeLessThanOrEqual(121)
    expect(fmt.chats(BOOT.kvTokens / 4096)).toBe('about 120')
  })

  test('bytes per step ≈ 80 GB', () => {
    expect(BOOT.stepBytes / 1e9).toBeGreaterThanOrEqual(79)
    expect(BOOT.stepBytes / 1e9).toBeLessThanOrEqual(81)
    expect(fmt.gb(BOOT.stepBytes)).toBe('80 GB')
  })

  test('step time ≈ 24 ms', () => {
    expect(BOOT.stepSeconds * 1000).toBeGreaterThanOrEqual(23)
    expect(BOOT.stepSeconds * 1000).toBeLessThanOrEqual(25)
    expect(fmt.ms(BOOT.stepSeconds)).toBe('≈24 ms')
  })

  test('aggregate ≈ 5,000 tok/s, and each user gets about 42', () => {
    expect(BOOT.aggregateTps).toBeGreaterThanOrEqual(4800)
    expect(BOOT.aggregateTps).toBeLessThanOrEqual(5200)
    expect(fmt.tpsRound(BOOT.aggregateTps)).toBe('≈5,000 tok/s')
    expect(BOOT.perUserTps).toBeGreaterThan(40)
    expect(BOOT.perUserTps).toBeLessThan(44)
    expect(BOOT.perUserTps).toBeLessThan(BOOT.decodeTps)
  })

  test('math idle at that batch ≈ 90%', () => {
    expect(BOOT.mathIdleAtBatch).toBeGreaterThanOrEqual(0.9)
    expect(BOOT.mathIdleAtBatch).toBeLessThanOrEqual(0.93)
    expect(fmt.pctTen(BOOT.mathIdleAtBatch)).toBe('~90%')
  })

  test('the story values to the digit (plan §4.A: 208.6, 119, 4,986)', () => {
    expect(BOOT.decodeTps.toFixed(1)).toBe('208.6')
    expect(BOOT.chats).toBe(119)
    expect(Math.round(BOOT.aggregateTps)).toBe(4986)
    expect((BOOT.mathIdleAtBatch * 100).toFixed(1)).toBe('91.9')
  })

  test('every input is a claim by id, and every note names real claims', () => {
    for (const id of Object.values(BOOT_CLAIMS)) expect(byId[id]).toBeDefined()
    for (const note of Object.values(DERIVED_NOTES)) {
      expect(note.from.length).toBeGreaterThan(0)
      for (const id of note.from) expect(byId[id]).toBeDefined()
    }
    expect(Object.keys(DERIVED_NOTES).sort()).toEqual(Object.keys(BOOT).sort())
  })

  test('moving a claim moves the derived number (nothing is hard-coded)', () => {
    const doubled = deriveBoot({ ...bootInputs(), bandwidth: bootInputs().bandwidth * 2 })
    expect(doubled.decodeTps).toBeCloseTo(BOOT.decodeTps * 2, 6)
    expect(doubled.ridge).toBeCloseTo(BOOT.ridge / 2, 6)
  })
})

describe('roofline', () => {
  test('batch 1 keeps ≈0.3% of the math busy, and the roof flattens at the ridge', () => {
    const one = rooflineAt(1)
    expect(one.busy).toBeCloseTo(BOOT.mathBusyBatch1, 6)
    expect(one.bound).toBe('memory')
    expect(rooflineAt(Math.floor(BOOT.ridge)).bound).toBe('memory')
    expect(rooflineAt(Math.ceil(BOOT.ridge)).bound).toBe('compute')
    expect(rooflineAt(1024).tflops).toBeCloseTo(989, 6)
    expect(rooflineAt(1024).busy).toBe(1)
  })

  test('attainable TFLOPS never falls as the batch grows', () => {
    let prev = 0
    for (let b = 1; b <= 1024; b++) {
      const t = rooflineAt(b).tflops
      expect(t).toBeGreaterThanOrEqual(prev)
      prev = t
    }
  })
})

describe('grading', () => {
  test('guess: within 2× either way is right; the score falls a decade at a time', () => {
    const t = BOOT.decodeTps
    expect(gradeGuess(t, t)).toEqual({ ok: true, score: 1 })
    expect(gradeGuess(t * 2, t).ok).toBe(true)
    expect(gradeGuess(t / 2, t).ok).toBe(true)
    expect(gradeGuess(t * 2.01, t).ok).toBe(false)
    expect(gradeGuess(t / 2.01, t).ok).toBe(false)
    expect(gradeGuess(t * 10, t).score).toBeCloseTo(0, 12)
    expect(gradeGuess(t * 100, t).score).toBe(0)
    expect(gradeGuess(t * Math.sqrt(10), t).score).toBeCloseTo(0.5, 12)
  })

  test('guess: junk is wrong, never NaN', () => {
    for (const v of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const g = gradeGuess(v, BOOT.decodeTps)
      expect(g.ok).toBe(false)
      expect(g.score).toBe(0)
    }
  })

  test('near: ±5% faded example, ±10% ridge and KV tokens', () => {
    expect(gradeNear(BOOT.decodeTps * 1.049, BOOT.decodeTps, 0.05).ok).toBe(true)
    expect(gradeNear(BOOT.decodeTps * 1.051, BOOT.decodeTps, 0.05).ok).toBe(false)
    expect(gradeNear(295, BOOT.ridge, 0.1).ok).toBe(true)
    expect(gradeNear(330, BOOT.ridge, 0.1).ok).toBe(false)
    expect(gradeNear(64e9 / 131072, BOOT.kvTokens, 0.1).ok).toBe(true)
    expect(gradeNear(64 * 1024 ** 3 / 131072, BOOT.kvTokens, 0.1).ok).toBe(true) // a GiB reading is still right
    expect(gradeNear(Number.NaN, BOOT.kvTokens, 0.1)).toEqual({ ok: false, score: 0 })
  })

  test('"right number, wrong reason": a one-user guess near the aggregate', () => {
    expect(guessMatchesAggregate(5000, BOOT.aggregateTps)).toBe(true)
    expect(guessMatchesAggregate(2600, BOOT.aggregateTps)).toBe(true)
    expect(guessMatchesAggregate(209, BOOT.aggregateTps)).toBe(false)
    expect(guessMatchesAggregate(0, BOOT.aggregateTps)).toBe(false)
  })
})

describe('content fingerprints (§4.5)', () => {
  test('stable per step, and distinct across steps', () => {
    expect(bootRev('ridge')).toBe(bootRev('ridge'))
    const revs = new Set(GRADED_STEPS.map((s) => bootRev(s)))
    expect(revs.size).toBe(GRADED_STEPS.length)
  })

  test('changes when the truth moves, ignores noise past three significant figures', () => {
    const base = deriveBoot()
    const nudged = deriveBoot({ ...bootInputs(), bandwidth: bootInputs().bandwidth * 1.0001 })
    const moved = deriveBoot({ ...bootInputs(), bandwidth: bootInputs().bandwidth * 1.5 })
    expect(bootRev('faded-decode', nudged)).toBe(bootRev('faded-decode', base))
    expect(bootRev('faded-decode', moved)).not.toBe(bootRev('faded-decode', base))
  })

  test('each step is graded against its own truth', () => {
    expect(truthFor('guess-1user')).toBe(BOOT.decodeTps)
    expect(truthFor('ridge')).toBe(BOOT.ridge)
    expect(truthFor('kv-tokens')).toBe(BOOT.kvTokens)
    expect(truthFor('why-batching')).toBe(BOOT.aggregateTps)
  })
})
