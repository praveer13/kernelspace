/**
 * The Forge registry and bundle contract (docs/specs/wave-2.md §13.1): every `src/data/forge/<labId>/index.ts` is
 * found without a list, loads lazily, and obeys the `ForgeBundle` shape against labs.ts, lab 01's lib.rs and the lessons.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { findForgeBundle, forgeBundleIds, loadAllForgeBundles, loadForgeBundle } from '../../src/data/forge'
import lab01 from '../../src/data/forge/rust-allocator'
import { LADDER, LADDER_CHECK_IDS, referenceScript } from '../../src/data/forge/rust-allocator/ladder'
import { PRIMM_ITEMS, PRIMM_MC_ITEMS, PRIMM_STEPS, STAGES } from '../../src/data/forge/rust-allocator/primm'
import { PROVE_QUESTIONS } from '../../src/data/forge/rust-allocator/prove'
import type { ForgeBundle } from '../../src/data/forge/types'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import { extractHeadings } from '../../src/pages/lesson/markdown'
import { lintBundle } from '../../scripts/lint-mentor'
import type { LintDeps } from '../../scripts/lint-mentor'

const FORGE_DIR = new URL('../../src/data/forge/', import.meta.url)
const ROOT = new URL('../../', import.meta.url).pathname

const h2s = new Map<string, Set<string>>()
for (const l of ALL_LESSONS) h2s.set(l.id, new Set(extractHeadings(l.blocks).filter((h) => h.level === 2).map((h) => h.id)))

async function depsOf(bundle: ForgeBundle): Promise<LintDeps> {
  const lab = FORGE_LABS.find((l) => l.id === bundle.labId)!
  return {
    required: lab.checks.filter((c) => c.optional !== true).map((c) => c.id),
    libRs: await Bun.file(`${ROOT}labs/${lab.crateDir ?? lab.id}/src/lib.rs`).text(),
    h2s,
  }
}

describe('discovery', () => {
  test('finds every lab directory under src/data/forge, without a list, sorted', async () => {
    const dirs = readdirSync(FORGE_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    expect(dirs).toContain('rust-allocator')
    expect(await forgeBundleIds()).toEqual(dirs)
  })

  test('a lab loads once, and the same promise answers the second call', async () => {
    const a = loadForgeBundle('rust-allocator')
    expect(loadForgeBundle('rust-allocator')).toBe(a)
    expect(await a).toBe(lab01)
  })

  test('an unknown lab throws from load and is undefined from find', async () => {
    await expect(loadForgeBundle('no-such-lab')).rejects.toThrow('no forge bundle for lab: no-such-lab')
    expect(await findForgeBundle('no-such-lab')).toBeUndefined()
    expect(await findForgeBundle('rust-allocator')).toBe(lab01)
    // a failed load does not stick
    await expect(loadForgeBundle('no-such-lab')).rejects.toThrow()
  })

  test('loadAllForgeBundles returns one bundle per directory, each named for its directory', async () => {
    const all = await loadAllForgeBundles()
    expect(all.map((b) => b.labId)).toEqual(await forgeBundleIds())
  })
})

describe('every bundle obeys the contract', () => {
  test('the lab exists in labs.ts and every stage number is one a required check carries', async () => {
    for (const b of await loadAllForgeBundles()) {
      const lab = FORGE_LABS.find((l) => l.id === b.labId)
      expect(lab).toBeDefined()
      const required = lab!.checks.filter((c) => c.optional !== true)
      const stagesOfChecks = [...new Set(required.map((c) => c.stage))].sort((a, b) => a! - b!)
      expect(b.stages.map((s) => s.n)).toEqual(b.stages.map((_, i) => i + 1))
      expect(b.stages.map((s) => s.n)).toEqual(stagesOfChecks as number[])
      for (const s of b.stages) expect(s.minutes).toBeLessThanOrEqual(25)
    }
  })

  test('PRIMM walks the five steps, with items for the three that take answers and a run that is a pure function of its config', async () => {
    for (const b of await loadAllForgeBundles()) {
      expect(b.primm.steps.map((s) => s.id)).toEqual(['predict', 'run', 'investigate', 'modify', 'make'])
      for (const step of ['predict', 'investigate', 'modify'] as const) expect(b.primm.items.some((i) => i.step === step)).toBe(true)
      const ids = b.primm.items.map((i) => i.id)
      expect(new Set(ids).size).toBe(ids.length)
      const { run } = b.primm
      expect(run.item.id).not.toBe('')
      expect(run.title(run.reference)).not.toBe('')
      const a = run.run(run.reference)
      const again = run.run(run.reference)
      expect(a).toEqual(again)
      expect(a.frames.length).toBeGreaterThan(1)
      expect(a.frames[0].cells.length).toBeGreaterThan(0)
      expect(a.truth).toBeGreaterThanOrEqual(a.value)
      if (run.baseline !== undefined) expect(run.run(run.baseline).frames.length).toBeGreaterThan(1)
    }
  })

  test('Prove-it has at least six questions with distinct ids', async () => {
    for (const b of await loadAllForgeBundles()) {
      expect(b.prove.length).toBeGreaterThanOrEqual(6)
      expect(new Set(b.prove.map((q) => q.id)).size).toBe(b.prove.length)
    }
  })

  test('the Ask-a-human label reads "[lab NN]" and a ladder, where there is one, passes lint-mentor', async () => {
    for (const b of await loadAllForgeBundles()) {
      expect(b.discussionsLabel).toMatch(/^\[lab \d\d\]$/)
      if (b.ladder.length > 0) expect(lintBundle(b, await depsOf(b))).toEqual([])
    }
  })
})

describe('lab 01 as a bundle: the same data, no behaviour change', () => {
  test('it is the lab the module names, with the labels Wave 1 shipped', () => {
    expect(lab01.labId).toBe('rust-allocator')
    expect(lab01.discussionsLabel).toBe('[lab 01]')
  })

  test('each part is the lab module’s own, element for element', () => {
    expect(lab01.stages).toEqual([...STAGES])
    expect(lab01.primm.items).toEqual([...PRIMM_ITEMS])
    expect(lab01.primm.steps).toEqual([...PRIMM_STEPS])
    expect(lab01.prove).toEqual([...PROVE_QUESTIONS])
    expect(lab01.ladder.map((c) => c.checkId)).toEqual([...LADDER_CHECK_IDS])
    for (const c of lab01.ladder) expect(c).toBe(LADDER[c.checkId])
  })

  test('PRIMM_MC_ITEMS is still what primm.ts exports, and it is the bundle’s choice items', () => {
    expect(PRIMM_MC_ITEMS.length).toBeGreaterThan(0)
    expect(PRIMM_MC_ITEMS).toEqual(lab01.primm.items.flatMap((i) => (i.kind === 'choice' ? [i.item] : [])))
  })

  test('the walkthrough takes the drained trace as lines, and falls back to the check’s script without one', () => {
    expect(lab01.walkthrough?.('coalesce', [])).toEqual(referenceScript('coalesce'))
    const traced = lab01.walkthrough?.('boot', ['alloc(16, 1) -> 0', 'alloc(16, 1) -> 0'])
    expect(traced?.source).toBe('trace')
    expect(traced?.divergedAt).not.toBeNull()
  })
})
