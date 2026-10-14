/**
 * Lab 08 (xgrammar-lite) as a Forge bundle (docs/specs/wave-3.md §8.2; task 3b-14): its stages agree with labs.ts,
 * grammar.rs and the harness; the reference run is the crate's own `probe`, replayed one frame per grammar step and
 * held to the committed seed-7 reply; every PRIMM item's answer is true of the harness; the faded ladder (R0 to R2,
 * then the packet) passes lint-mentor; and Prove-it has six questions and no v2. There is no DOM in this suite:
 * interaction is checked in a browser.
 *
 * The replies marked RUST below were produced by the private reference solution (and by its first_byte_mask mutant)
 * through the crate's `probe`; they hold the page's recomputation to the Rust harness on seeds beyond the committed one.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { HintLadderView } from '../../src/components/forge/HintLadder'
import { PrimmPanel } from '../../src/components/forge/PrimmPanel'
import ProveIt from '../../src/components/forge/ProveIt'
import { ReferenceRun } from '../../src/components/forge/ReferenceRun'
import { StagePanel } from '../../src/components/forge/StagePanel'
import { findForgeBundle, forgeBundleIds } from '../../src/data/forge'
import bundle from '../../src/data/forge/xgrammar-lite'
import { DISCUSSIONS_LABEL, LADDER, LADDER_CHECK_IDS, LAB_ID } from '../../src/data/forge/xgrammar-lite/ladder'
import {
  GRAMMAR_MASKS,
  MAX_STEPS,
  PRIMM_ITEMS,
  PRIMM_MC_ITEMS,
  PRIMM_STEPS,
  PROBE_SEED,
  RUN_ITEM,
  RUN_SPEC,
  STAGES,
  TOOL_DOCS,
  configOf,
  maskOf,
  probe,
  replyOf,
} from '../../src/data/forge/xgrammar-lite/primm'
import { PROVE_LAB_ID, PROVE_QUESTIONS, followUpRef } from '../../src/data/forge/xgrammar-lite/prove'
import type { NumberPrimm } from '../../src/data/forge/types'
import { kcById } from '../../src/data/kc'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import { hintRef } from '../../src/lib/forge/ladder'
import { followUpRefFor } from '../../src/lib/forge/prove-return'
import { gradeChoice, gradeNumber, itemResponse, observationResponse, primmRef, sameConfig, stageRows } from '../../src/lib/forge/primm'
import { pickQuestions } from '../../src/lib/forge/prove'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { isKnownKind, refMatchesKind } from '../../src/lib/ledger/refs'
import { lintBundle } from '../../scripts/lint-mentor'
import { poolCueFailures } from '../../scripts/item-cues'
import { extractHeadings } from '../../src/pages/lesson/markdown'

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const LIB_RS = read('labs/xgrammar-lite/src/lib.rs')
const GRAMMAR_RS = read('labs/xgrammar-lite/src/grammar.rs')
const CALIBRATION = JSON.parse(read('labs/xgrammar-lite/calibration.json')) as {
  mutants: Record<string, { defaultSeedFails: string[] }>
  probe: { seed: number; reply: string }
}
const lab = FORGE_LABS.find((l) => l.id === 'xgrammar-lite')
if (lab === undefined) throw new Error('lab 08 is missing from labs.ts')
const required = lab.checks.filter((c) => c.optional !== true)

const item = (id: string) => {
  const i = PRIMM_ITEMS.find((x) => x.id === id)
  if (i === undefined) throw new Error(`no item ${id}`)
  return i
}
const choiceOf = (id: string) => {
  const i = item(id)
  if (i.kind !== 'choice') throw new Error(`${id} is not a choice item`)
  return i
}
const numberOf = (id: string): NumberPrimm => {
  const i = item(id)
  if (i.kind === 'choice') throw new Error(`${id} is a choice item`)
  return i
}
/** A Rust comment block as one line of words. */
const flat = (s: string) => s.replace(/\n\s*\/\/\s*/g, ' ')
/** The code spans of a string, in order. */
const spans = (s: string) => [...s.matchAll(/`([^`]*)`/g)].map((m) => m[1])

/* ------------------------------------ the probe, recomputed ------------------------------------ */

// RUST: replies of the private reference solution's `probe <seed>` (labs/_solutions/xgrammar-lite/grammar.rs).
const RUST_REFERENCE: Record<number, string> = {
  0: 'steps=7 complete=true legal_per_step=3,1,2,2,2,3,4 text="{\\"kind\\":\\"answer\\",\\"count\\":56}"',
  1: 'steps=17 complete=true legal_per_step=3,2,3,2,3,4,4,2,1,2,2,2,4,4,12,14,2 text="{\\"kind\\":\\"tool\\",\\"count\\":82}"',
  2: 'steps=9 complete=true legal_per_step=3,1,1,5,3,1,5,5,15 text="{\\"kind\\":\\"tool\\",\\"count\\":36}"',
  7: 'steps=11 complete=true legal_per_step=3,4,3,1,2,1,1,1,1,2,4 text="{\\"kind\\":\\"answer\\",\\"count\\":43}"',
  8: 'steps=7 complete=true legal_per_step=3,2,4,5,4,13,1 text="{\\"kind\\":\\"tool\\",\\"count\\":74}"',
  9: 'steps=13 complete=true legal_per_step=4,3,1,1,2,1,6,2,1,4,11,12,2 text="{\\"kind\\":\\"tool\\",\\"count\\":60}"',
  // a vocabulary with no fragment that starts with u: after `{"kind":"tool","co` no token is legal
  11: 'err no legal token after "{\\"kind\\":\\"tool\\",\\"co"',
}

// RUST: the same, through the first_byte_mask mutant (the mask looks at the first byte of each token only).
const RUST_FIRST_BYTE: Record<number, string> = {
  0: 'err the mask allowed "\\"k" but accept_token rejected it',
  1: 'err no legal token after "{\\"kind\\":\\"tool\\",\\"co"',
  2: 'err the mask allowed "\\"tool\\",\\"c" but accept_token rejected it',
  6: 'steps=10 complete=true legal_per_step=2,11,2,4,3,3,1,13,14,1 text="{\\"kind\\":\\"tool\\",\\"count\\":44}"',
  7: 'err the mask allowed "\\",\\"" but accept_token rejected it',
  8: 'steps=6 complete=true legal_per_step=3,2,4,5,5,16 text="{\\"kind\\":\\"tool\\",\\"count\\":7}"',
}

// RUST: the reference with a vocabulary of the 30 characters of the documents (the 29 of `probe` and u), no fragments.
const RUST_CHARS: Record<number, string> = {
  3: 'steps=25 complete=true legal_per_step=1,1,1,1,2,1,1,1,1,2,1,1,1,1,1,1,1,1,1,2,1,1,1,10,1 text="{\\"kind\\":\\"tool\\",\\"count\\":0}"',
  7: 'steps=26 complete=true legal_per_step=1,1,1,1,2,1,1,1,1,2,1,1,1,1,1,1,1,1,1,2,1,1,1,10,11,1 text="{\\"kind\\":\\"tool\\",\\"count\\":29}"',
}

describe('the probe the page recomputes is the crate’s', () => {
  test('seed 7 is exactly the reply committed in calibration.json', () => {
    expect(CALIBRATION.probe.seed).toBe(PROBE_SEED)
    expect(replyOf(probe(PROBE_SEED))).toBe(CALIBRATION.probe.reply)
    expect(RUST_REFERENCE[7]).toBe(CALIBRATION.probe.reply)
  })

  test('it agrees with the private reference on other seeds, including a vocabulary that dead-ends', () => {
    for (const [seed, reply] of Object.entries(RUST_REFERENCE)) expect([seed, replyOf(probe(Number(seed)))]).toEqual([seed, reply])
  })

  test('a mask that looks at the first byte of each token fails as the first_byte_mask mutant does', () => {
    for (const [seed, reply] of Object.entries(RUST_FIRST_BYTE)) {
      expect([seed, replyOf(probe(Number(seed), { mask: 'first-byte', vocab: 'mixed' }))]).toEqual([seed, reply])
    }
  })

  test('a vocabulary of single characters writes the document one byte per step', () => {
    for (const [seed, reply] of Object.entries(RUST_CHARS)) {
      expect([seed, replyOf(probe(Number(seed), { mask: 'whole', vocab: 'chars' }))]).toEqual([seed, reply])
    }
  })

  test('the vocabulary is 29 characters and 35 fragments of at most 10 bytes, each cut from a valid document', () => {
    for (let seed = 0; seed < 64; seed++) {
      const { vocab } = probe(seed)
      expect(vocab).toHaveLength(64)
      expect(vocab.slice(0, 29).join('')).toBe('{}":,0123456789tolanswerkindc')
      for (const frag of vocab.slice(29)) {
        expect(frag.length).toBeGreaterThanOrEqual(1)
        expect(frag.length).toBeLessThanOrEqual(10)
        expect(TOOL_DOCS.some((d) => d.includes(frag))).toBe(true)
      }
    }
  })

  test('the language is the 200 documents of lib.rs’s tool schema, written without whitespace', () => {
    expect(LIB_RS).toContain('"kind":{"type":"string","enum":["tool","answer"]}')
    expect(LIB_RS).toContain('"count":{"type":"integer","minimum":0,"maximum":99}')
    expect(TOOL_DOCS).toHaveLength(200)
    expect(new Set(TOOL_DOCS).size).toBe(200)
    expect(Math.min(...TOOL_DOCS.map((d) => d.length))).toBe(25)
    expect(Math.max(...TOOL_DOCS.map((d) => d.length))).toBe(28)
    expect(TOOL_DOCS[0]).toBe('{"kind":"tool","count":0}')
    expect(TOOL_DOCS[199]).toBe('{"kind":"answer","count":99}')
  })

  test('the harness’s six fixed tokens get the mask lib.rs expects, and a first-byte mask gets exactly one wrong', () => {
    const block = /let vocab = \[([\s\S]*?)\];/.exec(LIB_RS)?.[1] ?? ''
    const vocab = [...block.matchAll(/r#"([\s\S]*?)"#|"([^"]*)"/g)].map((m) => m[1] ?? m[2])
    const expected = /let expected = \[([^\]]*)\];/.exec(LIB_RS)?.[1].split(',').map((s) => s.trim() === 'true')
    expect(vocab).toHaveLength(6)
    expect(maskOf('{"kind":', vocab)).toEqual(expected as boolean[])
    const first = maskOf('{"kind":', vocab, 'first-byte')
    const wrong = vocab.filter((_, i) => first[i] !== (expected as boolean[])[i])
    expect(wrong).toEqual(['"tool"}garbage'])
  })

  test('more than a hundred seeds: every legal pick is accepted by the whole-token mask, and a run that ends ends the way its reply says', () => {
    let steps = 0
    for (let seed = 0; seed < 128; seed++) {
      const p = probe(seed)
      for (const s of p.steps) {
        expect(s.wrong).toEqual([])
        if (s.pick >= 0) expect(s.legal).toContain(s.pick)
      }
      steps += p.steps.length
      if (p.end === 'complete') expect(TOOL_DOCS).toContain(p.text)
      expect(['complete', 'empty']).toContain(p.end)
    }
    expect(steps).toBeGreaterThan(0)
  })
})

/* ------------------------------------ the bundle ------------------------------------ */

describe('the bundle', () => {
  test('the registry finds it by directory name, and it default-exports a ForgeBundle for lab 08 that fades at R2', async () => {
    expect(await forgeBundleIds()).toContain('xgrammar-lite')
    expect(await findForgeBundle('xgrammar-lite')).toBe(bundle)
    expect(bundle.labId).toBe('xgrammar-lite')
    expect(LAB_ID).toBe(bundle.labId)
    expect(PROVE_LAB_ID).toBe(bundle.labId)
    expect(bundle.discussionsLabel).toBe('[lab 08]')
    expect(DISCUSSIONS_LABEL).toBe(bundle.discussionsLabel)
    expect(bundle.fade).toBe('r2')
  })

  test('it has no Prove-it v2 (its bridge answers probe only, wave-3.md §7.2) and no walkthrough (a faded ladder has no bottom-out)', () => {
    expect(bundle.prove2).toBeUndefined()
    expect(bundle.walkthrough).toBeUndefined()
    expect(LIB_RS).toContain('(Some("probe"), Some(Ok(seed))) => probe(seed)')
    expect(LIB_RS).not.toContain('Some("schedule")')
  })

  test('the parts are the lab modules’ own', () => {
    expect(bundle.stages).toEqual([...STAGES])
    expect(bundle.primm.items).toEqual([...PRIMM_ITEMS])
    expect(bundle.primm.steps).toEqual([...PRIMM_STEPS])
    expect(bundle.primm.run).toBe(RUN_SPEC)
    expect(bundle.prove).toEqual([...PROVE_QUESTIONS])
    expect(bundle.ladder.map((c) => c.checkId)).toEqual([...LADDER_CHECK_IDS])
  })
})

/* ------------------------------------ stages ------------------------------------ */

describe('stages: labs.ts, grammar.rs and the harness agree', () => {
  test('the four stages are the ones the six required checks carry', () => {
    expect(required.map((c) => c.id)).toEqual([...LADDER_CHECK_IDS])
    expect(STAGES.map((s) => s.n)).toEqual([1, 2, 3, 4])
    expect(STAGES.map((s) => required.filter((c) => c.stage === s.n).map((c) => c.id))).toEqual([
      ['schema_compile'],
      ['valid_acceptance', 'earliest_rejection'],
      ['token_mask'],
      ['mask_overhead', 'compile_cache'],
    ])
    for (const c of required) expect(c.kcs).toEqual([GRAMMAR_MASKS])
  })

  test('stage 1 is the single check schema_compile, the two-minute win, and no stage is over 25 minutes', () => {
    expect(required.filter((c) => c.stage === 1).map((c) => c.id)).toEqual(['schema_compile'])
    expect(STAGES[0].minutes).toBe(2)
    for (const s of STAGES) expect(s.minutes).toBeLessThanOrEqual(25)
  })

  test('lib.rs lists the same stage for each check, and grammar.rs marks each stage', () => {
    for (const c of required) expect(LIB_RS).toMatch(new RegExp(`id: "${c.id}", label: [A-Z_]+, stage: ${c.stage},`))
    for (const s of STAGES) expect(GRAMMAR_RS).toMatch(new RegExp(`STAGE ${s.n} {2}`))
  })

  test('the stage panel counts four stages and offers the next command', () => {
    const html = renderToStaticMarkup(createElement(StagePanel, { bundle, checks: lab.checks, passed: new Set(['schema_compile']) }))
    expect(html).toContain('Build in four stages')
    expect(html).toContain('1/4 green')
    expect(html).toContain('<code>cargo test valid_acceptance</code>')
    const rows = stageRows(STAGES, lab.checks, new Set(['schema_compile', 'valid_acceptance']))
    expect(rows.map((r) => r.green)).toEqual([true, false, false, false])
  })
})

/* ------------------------------------ the reference run ------------------------------------ */

describe('the reference run is the committed probe, one frame per grammar step', () => {
  const run = RUN_SPEC.run(RUN_SPEC.reference)
  const legalPerStep = (/legal_per_step=([\d,]+)/.exec(CALIBRATION.probe.reply)?.[1] ?? '').split(',').map(Number)

  test('there is one frame per step of the committed reply, more than one, and each frame is that step’s mask', () => {
    expect(/steps=(\d+)/.exec(CALIBRATION.probe.reply)?.[1]).toBe(String(legalPerStep.length))
    expect(run.frames).toHaveLength(legalPerStep.length)
    expect(run.frames.length).toBeGreaterThan(1)
    expect(run.total).toBe(legalPerStep.length)
    run.frames.forEach((f, i) => {
      expect(f.op).toBe(i + 1)
      expect(f.cells).toHaveLength(64)
      // a cell is lit for each legal token, and the one that was picked is the darkest
      expect(f.cells.filter((c) => c > 0)).toHaveLength(legalPerStep[i])
      expect(f.cells.filter((c) => c === 100)).toHaveLength(1)
      expect(f.stats.find((s) => s.label === 'legal tokens')?.value).toBe(`${legalPerStep[i]} of 64`)
    })
  })

  test('each frame names its legal tokens for a screen reader, and the last one is Complete', () => {
    const p = probe(PROBE_SEED)
    run.frames.forEach((f, i) => {
      for (const idx of p.steps[i].legal.slice(0, 8)) expect(f.alt).toContain(`#${idx} ${p.vocab[idx]}`)
      expect(f.alt).toContain(`Step ${i + 1} of 11`)
    })
    expect(run.frames[0].alt).toContain('#0 {')
    expect(run.frames[0].alt).toContain('#35 {"kind":')
    expect(run.frames[0].alt).toContain('#48 {"kind":"')
    expect(run.frames.at(-1)?.stats.find((s) => s.label === 'status')?.value).toBe('Complete')
    expect(run.frames.slice(0, -1).every((f) => f.stats.find((s) => s.label === 'status')?.value === 'Prefix')).toBe(true)
  })

  test('step 3 has three legal tokens, the example of the spec’s table, and its names are the two n tokens and "nswer"', () => {
    const p = probe(PROBE_SEED)
    expect(p.steps[2].before).toBe('{"kind":"a')
    expect(p.steps[2].legal.map((i) => p.vocab[i])).toEqual(['n', 'n', 'nswer"'])
  })

  test('the run is a pure function of its config, finished and clean, with the committed text as its summary', () => {
    expect(RUN_SPEC.run(RUN_SPEC.reference)).toEqual(run)
    expect(run.clean).toBe(true)
    expect(run.value).toBe(11)
    expect(run.truth).toBe(MAX_STEPS)
    expect(run.truth).toBeGreaterThanOrEqual(run.value)
    expect(run.summary).toContain('{"kind":"answer","count":43}')
    expect(RUN_SPEC.title(RUN_SPEC.reference)).toBe('Reference: the probe on seed 7, one frame per grammar step')
    expect(sameConfig(RUN_SPEC.reference, configOf(7))).toBe(true)
  })

  test('the strip stays within a phone’s width: stats are short, and no frame has a long unbroken value', () => {
    for (const d of [RUN_SPEC.reference, ...(RUN_SPEC.modify?.dials ?? []).map((x) => x.config)]) {
      for (const f of RUN_SPEC.run(d).frames) {
        for (const s of f.stats) expect(s.value.length).toBeLessThanOrEqual(16)
        expect(f.cells.every((c) => c >= 0 && c <= 100)).toBe(true)
      }
    }
  })

  test('the Run step counts only the reference config, and writes an observation with no KCs', () => {
    expect(RUN_ITEM.id).toBe('lab08.primm.r1')
    const r = observationResponse(RUN_ITEM, run)
    expect(r.ref).toBe('item:lab08.primm.r1')
    expect(r.data).toMatchObject({ kcs: [], value: 11, truth: 40 })
    expect(sameConfig(run.config, RUN_SPEC.reference)).toBe(true)
    for (const d of RUN_SPEC.modify?.dials ?? []) expect(sameConfig(d.config, RUN_SPEC.reference)).toBe(false)
  })

  test('the Modify dials are whole configs: a first-byte mask that fails on step 5, and a vocabulary of characters that finishes on step 26', () => {
    const dials = RUN_SPEC.modify?.dials ?? []
    expect(dials.map((d) => d.id)).toEqual(['first-byte', 'chars'])
    const [first, chars] = dials.map((d) => RUN_SPEC.run(d.config))
    expect([first.value, first.clean]).toEqual([5, false])
    expect(first.summary).toContain('Step 5')
    expect(first.summary).toContain('at byte')
    expect(first.frames.at(-1)?.stats.find((s) => s.label === 'wrongly allowed')?.value).not.toBe('0')
    expect([chars.value, chars.clean]).toEqual([26, true])
    expect(chars.frames[0].cells).toHaveLength(30)
    // the dials' answers are the private reference's (mutant) answers: step 5 in the Rust run, 26 steps for the 26 bytes
    expect(RUST_CHARS[7]).toContain('steps=26')
    expect(RUN_SPEC.modify?.lead).toContain('11 steps')
  })
})

/* ------------------------------------ items ------------------------------------ */

describe('items: ids, refs, tags, whys', () => {
  test('ids are item:lab08.primm.* and unique', () => {
    const ids = PRIMM_ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of [...ids, RUN_ITEM.id]) {
      expect(id.startsWith('lab08.primm.')).toBe(true)
      expect(refMatchesKind('item', primmRef(id))).toBe(true)
    }
    expect(isKnownKind('item')).toBe(true)
  })

  test('the spec shape: 2 predict (an estimate and a choice), 3 investigate and 1 modify, around the run', () => {
    expect(PRIMM_ITEMS).toHaveLength(6)
    expect(PRIMM_ITEMS.filter((i) => i.step === 'predict').map((i) => i.kind).sort()).toEqual(['choice', 'estimate'])
    expect(PRIMM_ITEMS.filter((i) => i.step === 'investigate')).toHaveLength(3)
    expect(PRIMM_ITEMS.filter((i) => i.step === 'modify').map((i) => i.kind)).toEqual(['estimate'])
    expect(bundle.primm.steps.map((s) => s.id)).toEqual(['predict', 'run', 'investigate', 'modify', 'make'])
  })

  test('every item is tagged with the lab’s one KC, which exists, and a nominal time', () => {
    expect(kcById(GRAMMAR_MASKS)?.labs).toContain('xgrammar-lite')
    for (const i of PRIMM_ITEMS) {
      const kcs = i.kind === 'choice' ? i.item.kcs : i.kcs
      expect(kcs).toEqual([GRAMMAR_MASKS])
      expect(i.nsec).toBeGreaterThan(0)
    }
  })

  test('every multiple-choice item has four distinct options, one key and a why for each', () => {
    expect(PRIMM_MC_ITEMS).toHaveLength(4)
    for (const { id, q } of PRIMM_MC_ITEMS) {
      expect(q.options.length).toBe(4)
      expect(new Set(q.options).size).toBe(4)
      expect(q.correct.length).toBe(1)
      expect(q.why?.length).toBe(4)
      for (const w of q.why ?? []) expect(w.trim().length).toBeGreaterThan(40)
      expect(q.explanation?.length).toBeGreaterThan(20)
      expect(q.kcs).toEqual([GRAMMAR_MASKS])
      expect(id.startsWith('lab08.primm.')).toBe(true)
    }
    expect(new Set(PRIMM_MC_ITEMS.map((i) => i.q.correct[0])).size).toBeGreaterThan(1)
  })

  test('the pool passes verify-items’ item-level cue gates on its own, and no key is the strictly longest option', () => {
    const items = PRIMM_MC_ITEMS.map((i) => ({ ref: `lab08 ${i.id}`, q: i.q }))
    expect(poolCueFailures('lab08 PRIMM', items)).toEqual([])
    for (const { q } of items) {
      const lens = q.options.map((o) => o.trim().length)
      const longest = Math.max(...lens)
      expect(lens[q.correct[0]] < longest || lens.filter((l) => l === longest).length > 1).toBe(true)
    }
  })

  test('a choice grades by authored index and says why the pick is wrong', () => {
    const p2 = choiceOf('lab08.primm.p2')
    const ok = gradeChoice(p2, p2.item.q.correct[0])
    expect(ok.ok).toBe(true)
    const wrong = gradeChoice(p2, (p2.item.q.correct[0] + 1) % 4)
    expect(wrong.ok).toBe(false)
    expect(wrong.feedback.length).toBeGreaterThan(40)
    const r = itemResponse({ item: p2, grade: ok, pick: p2.item.q.correct[0] })
    expect(r.ref).toBe('item:lab08.primm.p2')
    expect(r.data).toMatchObject({ src: 'practice', kcs: [GRAMMAR_MASKS] })
  })
})

describe('the answers are true of the harness', () => {
  test('p1: the estimate is graded against the reference run, 11 steps, and its prompt states the probe’s real parameters', () => {
    const p1 = numberOf('lab08.primm.p1')
    expect(p1.kind).toBe('estimate')
    expect(p1.unit).toBe('steps')
    expect(RUN_SPEC.run(RUN_SPEC.reference).value).toBe(11)
    for (const claim of ['25 to 28 bytes', '64 tokens', '29 single characters', '35 fragments', 'up to 10 bytes']) expect(p1.prompt).toContain(claim)
    expect(LIB_RS).toContain('while owned.len() < 64')
    expect(LIB_RS).toContain('rng.range(2, 10)')
    expect(LIB_RS).toContain('for _ in 0..40')
    expect(gradeNumber(p1, 10, 11).ok).toBe(true)
    expect(gradeNumber(p1, 25, 11).ok).toBe(false)
    expect(p1.explain).toContain('11 steps')
  })

  test('p1: across seeds 0 to 63 the runs that finish take 6 to 17 steps, as the explanation says', () => {
    const done = Array.from({ length: 64 }, (_, s) => probe(s)).filter((p) => p.end === 'complete')
    expect(done).toHaveLength(61)
    expect(Math.min(...done.map((p) => p.steps.length))).toBe(6)
    expect(Math.max(...done.map((p) => p.steps.length))).toBe(17)
    expect(numberOf('lab08.primm.p1').explain).toContain('61 runs that finish take 6 to 17 steps')
  })

  test('p2: after {"kind": a correct mask allows only the token that is a valid ending, and each wrong one breaks at the byte its why names', () => {
    const p2 = choiceOf('lab08.primm.p2')
    const tokens = p2.item.q.options.map((o) => spans(o)[0])
    expect(tokens).toEqual(['"tool","count":100}', '"tool","count":07}', '"answer","count":7}', '"tool",count:7}'])
    const mask = maskOf('{"kind":', tokens)
    expect(mask.map((m, i) => (m ? i : -1)).filter((i) => i >= 0)).toEqual(p2.item.q.correct)
    // the first byte of every token is legal, so a first-byte mask cannot tell them apart
    expect(maskOf('{"kind":', tokens, 'first-byte')).toEqual([true, true, true, true])
    // the last digit, the digit after the zero, the c after the comma
    const breaks = tokens.map((t) => {
      for (let k = 1; k <= t.length; k++) if (!TOOL_DOCS.some((d) => d.startsWith(`{"kind":${t.slice(0, k)}`))) return t[k - 1]
      return ''
    })
    expect(breaks).toEqual(['0', '7', '', 'c'])
  })

  test('i1: no integer from 0 to 100 begins with 101, and the first byte that cannot continue is at offset 8', () => {
    const docs = Array.from({ length: 101 }, (_, n) => `{"id":${n},"tag":"alpha","ok":true}`)
    const text = '{"id":101,"tag":"alpha","ok":true}'
    let at = -1
    for (let k = 1; k <= text.length && at < 0; k++) if (!docs.some((d) => d.startsWith(text.slice(0, k)))) at = k - 1
    expect(at).toBe(8)
    expect('{"id":'.length).toBe(6)
    // the harness computes it the same way for "an integer above the maximum" (lib.rs int_reject_offset), with id_at = 6
    expect(LIB_RS).toContain('let id_at = 6;')
    expect(LIB_RS).toContain('(0..=100).any')
    const i1 = choiceOf('lab08.primm.i1')
    expect(i1.item.q.options[i1.item.q.correct[0]]).toContain('offset 8')
    expect(i1.item.q.q).toContain('from 0 to 100')
    expect(LIB_RS).toContain('"id":{"type":"integer","minimum":0,"maximum":100}')
  })

  test('i1: the offsets the other options name are the offsets of the mistakes (6, 7, 9 are still viable or later)', () => {
    const docs = Array.from({ length: 101 }, (_, n) => `{"id":${n},"tag":"alpha","ok":true}`)
    const text = '{"id":101,"tag":"alpha","ok":true}'
    const viable = (k: number) => docs.some((d) => d.startsWith(text.slice(0, k)))
    expect(viable(7)).toBe(true) // through offset 6, the 1
    expect(viable(8)).toBe(true) // through offset 7, 10
    expect(viable(9)).toBe(false) // through offset 8, 101
    expect(text[9]).toBe(',')
  })

  test('i1: calibration says the early-rejection mutants fail earliest_rejection and nothing else, and the quoted message is the harness’s', () => {
    for (const m of ['int_no_bounds', 'reject_at_token_end', 'non_sticky']) expect(CALIBRATION.mutants[m].defaultSeedFails).toContain('earliest_rejection')
    expect(LIB_RS).toContain('expected rejection at byte {expected}, got {status:?}')
  })

  test('i2: the six fixed tokens, and the one a first-byte mask gets wrong, match the question', () => {
    const i2 = choiceOf('lab08.primm.i2')
    const six = spans(i2.item.q.q.slice(i2.item.q.q.indexOf('offers six tokens')))
    expect(six).toEqual(['"tool"', '"answer","count":', 'null', '"tool","count":7}', '"tool"}garbage', '"to'])
    const whole = maskOf('{"kind":', six)
    const first = maskOf('{"kind":', six, 'first-byte')
    expect(whole).toEqual([true, true, false, true, false, true])
    expect(first).toEqual([true, true, false, true, true, true])
    expect(spans(i2.item.q.options[i2.item.q.correct[0]])[0]).toBe('"tool"}garbage')
    expect(CALIBRATION.mutants.first_byte_mask.defaultSeedFails).toEqual(['token_mask'])
    // a first-byte mask never blocks a token that is valid: it can only admit too much
    expect(first.every((f, i) => f || !whole[i])).toBe(true)
  })

  test('i3: the fixed pair of compile_cache is two different sources of one schema; a source-keyed cache prints entries=2 compiles=2 hits=0 same_rc=false', () => {
    const a = /const TOOL_SCHEMA: &str = r#"([\s\S]*?)"#;/.exec(LIB_RS)?.[1] ?? ''
    const b = /let equivalent = r#"([\s\S]*?)"#;/.exec(LIB_RS)?.[1] ?? ''
    expect(a).not.toBe('')
    expect(b).not.toBe('')
    expect(a).not.toBe(b)
    // schema.rs's parser sorts and dedups enum values; keyword order and whitespace do not survive parsing. `properties` keeps its order.
    const norm = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(norm)
      if (v !== null && typeof v === 'object') {
        const o = v as Record<string, unknown>
        return Object.fromEntries(
          Object.keys(o)
            .sort()
            .map((k) => [k, k === 'enum' || k === 'required' ? [...(o[k] as string[])].sort() : norm(o[k])]),
        )
      }
      return v
    }
    expect(norm(JSON.parse(a))).toEqual(norm(JSON.parse(b)))
    expect(Object.keys(JSON.parse(a).properties)).toEqual(Object.keys(JSON.parse(b).properties))
    // the counters of a cache keyed by the source text, over the check's first two calls
    const bySource = new Map<string, object>()
    let compiles = 0
    let hits = 0
    const get = (src: string) => {
      const found = bySource.get(src)
      if (found) {
        hits++
        return found
      }
      compiles++
      const made = {}
      bySource.set(src, made)
      return made
    }
    const first = get(a)
    const second = get(b)
    const line = `entries=${bySource.size} compiles=${compiles} hits=${hits} same_rc=${first === second}`
    expect(line).toBe('entries=2 compiles=2 hits=0 same_rc=false')
    expect(LIB_RS).toContain('equivalent schema missed: entries={} compiles={} hits={} same_rc={}')
    const i3 = choiceOf('lab08.primm.i3')
    expect(spans(i3.item.q.options[i3.item.q.correct[0]])[0]).toBe(line)
    expect(CALIBRATION.mutants.cache_by_source.defaultSeedFails).toEqual(['compile_cache'])
    expect(CALIBRATION.mutants.no_cache.defaultSeedFails).toEqual(['compile_cache'])
  })

  test('i3: the other three lines are not what a correct cache or the two calibration mutants print, except the no_cache line, which is named', () => {
    const i3 = choiceOf('lab08.primm.i3')
    const lines = i3.item.q.options.map((o) => spans(o)[0])
    expect(lines).toContain('entries=1 compiles=2 hits=0 same_rc=false') // the line of the no_cache mutant, run in the private reference
    expect(lines).toContain('entries=1 compiles=1 hits=1 same_rc=true') // a correct cache: the check would pass, so it prints nothing
    expect(new Set(lines).size).toBe(4)
  })

  test('m1: the prompt quotes the reference’s 11 steps, and each dial’s answer is in the grading band for a sensible guess', () => {
    const m1 = numberOf('lab08.primm.m1')
    expect(m1.kind).toBe('estimate')
    expect(m1.prompt).toContain('step 11')
    const [first, chars] = (RUN_SPEC.modify?.dials ?? []).map((d) => RUN_SPEC.run(d.config).value)
    expect(gradeNumber(m1, 4, first).ok).toBe(true)
    expect(gradeNumber(m1, 11, first).ok).toBe(false)
    expect(gradeNumber(m1, 28, chars).ok).toBe(true)
    expect(gradeNumber(m1, 11, chars).ok).toBe(false)
  })
})

/* ------------------------------------ the panels, rendered ------------------------------------ */

describe('the generic panels render lab 08', () => {
  const panel = (initial: 'predict' | 'run' | 'investigate' | 'modify' | 'make') =>
    renderToStaticMarkup(createElement(PrimmPanel, { bundle, checks: lab.checks, passed: new Set<string>(), initial, title: lab.title }))

  test('Predict names the lab and shows the estimate and the choice', () => {
    const html = panel('predict')
    expect(html).toContain(`aria-label="${lab.title}, in five steps"`)
    expect(html).toContain('data-item="lab08.primm.p1"')
    expect(html).toContain('data-item="lab08.primm.p2"')
    expect(html).toContain('On seed 7, how many steps does the decode take?')
  })

  test('Investigate shows all three items, and Modify the two dials and its prompt', () => {
    const inv = panel('investigate')
    for (const id of ['i1', 'i2', 'i3']) expect(inv).toContain(`data-item="lab08.primm.${id}"`)
    const mod = panel('modify')
    expect(mod).toContain('Change one thing about the reference run (the exact mask over 64 tokens, 11 steps).')
    expect(mod).toContain('the mask looks at the first byte of each token only')
    expect(mod).toContain('the vocabulary is the 30 single characters, with no fragments')
    expect(mod).toContain('On which step does your changed run end?')
  })

  test('the reference run is titled, labelled a stand-in, and starts on the first step', () => {
    const html = renderToStaticMarkup(createElement(ReferenceRun, { bundle, config: RUN_SPEC.reference }))
    expect(html).toContain('Reference: the probe on seed 7, one frame per grammar step')
    expect(html).toContain('data-reference-run="xgrammar-lite"')
    expect(html).toContain('op 1 / 11')
    expect(html).toContain('Step 1 of 11')
    expect(html).toContain('3 of 64')
    expect(html).toContain('It is not a check')
  })

  test('Prove it shows three of the lab’s six questions and no other lab’s', () => {
    const html = renderToString(createElement(ProveIt, { bundle, history: [], now: 0, seed: 4 })).replaceAll('<!-- -->', '')
    expect(html).toContain('data-prove="active"')
    const qids = [...html.matchAll(/data-qid="([a-z-]+)"/g)].map((m) => m[1])
    expect(qids.length).toBeGreaterThan(0)
    for (const q of qids) expect(PROVE_QUESTIONS.map((p) => p.id)).toContain(q)
    expect(html).not.toContain('allocator')
  })
})

/* ------------------------------------ the ladder ------------------------------------ */

const h2s = new Map<string, Set<string>>()
for (const l of ALL_LESSONS) h2s.set(l.id, new Set(extractHeadings(l.blocks).filter((h) => h.level === 2).map((h) => h.id)))

const ISO = '2026-10-14T09:00:00.000Z'
const row = (id: string, status: CheckResult['status'] = 'fail', extra: Partial<CheckResult> = {}): CheckResult => ({ id, label: id, status, msg: `${id} says no`, ...extra })
const report = (checks: CheckResult[]): LabRunReport => ({ lab: 'xgrammar-lite', reference: false, abi: 2, version: 2, checks, seeds: 'fresh', ms: 5 })

describe('the ladder', () => {
  test('lint-mentor finds nothing: six required checks, R0 to R2 each, every limit held', () => {
    expect(lintBundle(bundle, { required: required.map((c) => c.id), libRs: LIB_RS, h2s })).toEqual([])
    expect(bundle.ladder).toHaveLength(6)
    expect(Object.keys(LADDER).sort()).toEqual([...LADDER_CHECK_IDS].sort())
  })

  test('no rung is written past R2: a faded bundle’s ladder has no R3 or R4', () => {
    for (const c of bundle.ladder) {
      expect('r3' in c).toBe(false)
      expect('r4' in c).toBe(false)
      expect(c.r2.text).toContain('lib.rs')
      expect(c.r2.fn).toBe(`check_${c.checkId}`)
      expect(LIB_RS).toMatch(new RegExp(`pub fn ${c.r2.fn}\\(`))
      expect(c.r1.link.lessonId === 't6.l8' || c.r1.link.lessonId === 'r.l7').toBe(true)
    }
  })

  test('each rung’s facts are true of the harness', () => {
    const idea = (id: string, n: number) => LADDER[id].r0.ideas[n]
    // valid_acceptance: five fixed fragments, six random documents, five escapes
    expect(idea('valid_acceptance', 0)).toContain('five fragments')
    expect(idea('valid_acceptance', 0)).toContain('six random')
    expect(LIB_RS).toContain('for round in 0..6')
    expect(LIB_RS).toMatch(/const ESCAPES: \[&str; 5\]/)
    expect((LIB_RS.match(/let tokens: &\[&\[u8\]\] = &\[([\s\S]*?)\];/)?.[1].match(/br#?"|b"/g) ?? []).length).toBe(5)
    // earliest_rejection: eleven kinds of corruption, sticky, global offsets
    expect(idea('earliest_rejection', 0)).toContain('eleven ways')
    expect(LIB_RS).toContain('kind % 11')
    expect(LIB_RS).toContain('for round in 0..11')
    expect(LIB_RS).toContain('rejection was not sticky')
    // token_mask: six fixed tokens, four rounds of 24, 200 documents, the matcher must not change
    expect(idea('token_mask', 0)).toContain('six fixed tokens')
    expect(idea('token_mask', 0)).toContain('four random')
    expect(idea('token_mask', 0)).toContain('24 random tokens')
    expect(LIB_RS).toContain('for round in 0..4')
    expect(LIB_RS).toContain('for i in 0..24')
    expect(idea('token_mask', 1)).toContain('200 documents')
    expect(LIB_RS).toContain('token_mask changed the matcher it was called on')
    // mask_overhead: 512 tokens, 40 masks, 10 ms natively, shape only in the browser
    expect(idea('mask_overhead', 0)).toContain('512')
    expect(LIB_RS).toContain('(0..512)')
    expect(LIB_RS).toContain('let rounds = 40u128')
    expect(LIB_RS).toContain('per_mask_us > 10_000')
    expect(idea('mask_overhead', 1)).toContain('10 ms')
    expect(LADDER.mask_overhead.r2.text).toContain('40 masks')
    // schema_compile: 5 to 128 states
    expect(idea('schema_compile', 1)).toContain('under 5 or over 128')
    expect(LIB_RS).toContain('grammar.state_count() < 5 || grammar.state_count() > 128')
    // compile_cache: entries, compilations and hits after the fixed pair
    expect(LIB_RS).toContain('|| cache.len() != 1')
    expect(LIB_RS).toContain('|| cache.compilations() != 1')
    expect(LIB_RS).toContain('|| cache.hits() != 1')
  })

  test('R1 of earliest_rejection: a maximum of 100 rejects the third digit of 101', () => {
    expect(LADDER.earliest_rejection.r1.text).toContain('third digit of 101')
  })

  test('the card for a red check shows R0 to R2 and the ask-a-human link, never an R3', () => {
    const acks = Object.fromEntries((['R0', 'R1', 'R2'] as const).map((r) => [hintRef('token_mask', r, LAB_ID), ISO]))
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(HintLadderView, { bundle, reports: [report([row('token_mask', 'fail', { msg: 'after "{" the token is legal but the mask says illegal' })])], acks, onAck: () => {}, now: () => 0 }),
      ),
    )
    expect(html).toContain('data-check="token_mask"')
    expect(html).toContain(LADDER.token_mask.r0.prompt)
    expect(html).toContain('The sampler picks whole tokens, so test whole tokens.')
    expect(html).toContain('href="/lesson/t6.l8#the-token-mask-is-not-a-string-mask"')
    expect(html).toContain(LADDER.token_mask.r2.text)
    expect(html).not.toContain('R3')
    expect(html).not.toContain('Bottom-out')
    expect(hintRef('token_mask', 'R1', bundle.labId)).toBe('hint:xgrammar-lite/token_mask#R1')
    const href = /href="(https:\/\/github\.com\/[^"]*discussions\/new[^"]*)"/.exec(html)?.[1]
    expect(href).toBeDefined()
    expect(new URL((href ?? '').replace(/&amp;/g, '&')).searchParams.get('title')).toStartWith('[lab 08] token_mask:')
  })
})

/* ------------------------------------ Prove it ------------------------------------ */

describe('Prove it v1', () => {
  test('six questions with unique ids, three ideas each, and a model answer the prompt does not contain', () => {
    expect(PROVE_QUESTIONS).toHaveLength(6)
    expect(new Set(PROVE_QUESTIONS.map((q) => q.id)).size).toBe(6)
    for (const q of PROVE_QUESTIONS) {
      expect(q.prompt.endsWith('?')).toBe(true)
      expect(q.model.length).toBeGreaterThan(120)
      expect(q.ideas).toHaveLength(3)
      expect(new Set(q.ideas).size).toBe(3)
      expect(q.prompt).not.toContain(q.model)
      expect(q.kcs).toEqual([GRAMMAR_MASKS])
    }
  })

  test('the facts in the model answers are true of the lab', () => {
    const q = (id: string) => PROVE_QUESTIONS.find((p) => p.id === id)!
    expect(q('integer-bounds').model).toContain('100 begins with it')
    expect(q('integer-bounds').prompt).toContain('maximum of 100')
    expect(q('stack-of-frames').model).toContain('array of up to four items')
    expect(LIB_RS).toContain('"maxItems": 4')
    expect(q('cache-key').model).toContain('sorted the enum values')
    expect(GRAMMAR_RS).toContain('HashMap<Schema, Rc<CompiledGrammar>>')
    expect(q('clone-cost').model).toContain('`Rc`')
    expect(flat(GRAMMAR_RS)).toContain('Clone the small stack, not the compiled grammar behind the Rc')
    expect(q('global-offset').model).toContain('plus 2')
    expect(flat(GRAMMAR_RS)).toContain('record its offset from the start of the document, not of the token')
  })

  test('the draw takes three of the lab’s questions, and the second attempt gets exactly the other three', () => {
    const first = pickQuestions([], 3, bundle.prove)
    expect(first).toHaveLength(3)
    for (const p of first) expect(PROVE_QUESTIONS).toContain(p)
    const second = pickQuestions([{ at: ISO, qids: first.map((p) => p.id) }], 3, bundle.prove)
    expect(second).toHaveLength(3)
    expect(new Set([...first, ...second].map((p) => p.id)).size).toBe(6)
  })

  test('the 30-day follow-up is a lab 08 item ref the ledger accepts, and the return card builds the same ref', () => {
    for (const q of PROVE_QUESTIONS) {
      expect(followUpRef(q.id)).toBe(`item:lab08.prove.${q.id}`)
      expect(followUpRefFor('xgrammar-lite', q.id)).toBe(followUpRef(q.id))
      expect(refMatchesKind('item', followUpRef(q.id))).toBe(true)
    }
  })
})
