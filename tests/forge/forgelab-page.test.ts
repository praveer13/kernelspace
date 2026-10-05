/**
 * The wiring of ForgeLab v2 and the Forge index (docs/specs/wave-1.md §12.3, §13, §14.3; task C17). The pages
 * need a DOM, which bun test does not have, so this reads their source for the contracts that must not drift;
 * the rendered behaviour is checked in the browser (axe at 360 and 1280 px, a real wasm through every provenance).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = join(import.meta.dir, '../../src')
const read = (p: string) => readFileSync(join(src, p), 'utf8')
const page = read('pages/ForgeLab.tsx')
const index = read('pages/Forge.tsx')

describe('ForgeLab writes what the run earned, and a reference module nothing', () => {
  test('a run is graded on fresh seeds and written through recordLabRun with the provenance creditFor gave', () => {
    expect(page).toContain("seeds: 'fresh'")
    expect(page).toContain('creditFor(report')
    expect(page).toContain('recordLabRun(toLabRun(report, credit, required')
    expect(page).not.toContain('recordLabResult')
  })

  test('the write sits behind `credit !== null`, which is what a reference build gets', () => {
    const guard = page.indexOf('if (credit !== null)')
    const write = page.indexOf('recordLabRun(toLabRun(')
    expect(guard).toBeGreaterThan(0)
    expect(write).toBeGreaterThan(guard)
    // and nothing writes to the ledger before the guard
    expect(page.slice(0, guard)).not.toMatch(/recordLabRun\(|recordItems\(|unlockAchievement\(/)
  })

  test('the completion panel and the achievement are never shown for a credit of none', () => {
    expect(page).toContain('requiredReportPassed && run.credit !== null')
  })

  test('the credit sentence is shown under every result', () => {
    expect(page).toContain('<CreditLine note={run.note} />')
  })
})

describe('what ForgeLab mounts', () => {
  test('lab 01 mounts the walk (with the drop zone in Make), the hint ladder and Prove it', () => {
    expect(page).toContain("import('@/components/forge/PrimmPanel')")
    expect(page).toContain("import('@/components/forge/HintLadder')")
    expect(page).toContain("import('@/components/forge/ProveIt')")
    expect(page).toContain('<HintLadder reports={reports} />')
    expect(page).toMatch(/<ProveIt unlocked=\{done \|\| requiredReportPassed\} \/>/)
    expect(page).toMatch(/<PrimmPanel[\s\S]*\{doing\}[\s\S]*<\/PrimmPanel>/)
  })

  test('the walk is a lazy chunk whose fallback is the same drop-zone content', () => {
    expect(page).toContain('<Suspense fallback={doing}>')
  })

  test('every lab mounts the discussion as a lab thread', () => {
    expect(page).toContain("import Discussion from '@/components/community/Discussion'")
    expect(page).toContain('<Discussion kind="lab" id={lab.id} />')
  })

  test('the per-check row shows the panic text and the trace', () => {
    expect(page).toContain('panic text and trace')
    expect(page).toContain('Panic text of ${row.id}')
    expect(page).toContain('Trace of ${row.id}')
  })

  test('the page is keyed by lab, so a run never carries across labs', () => {
    expect(page).toContain('<LabPage key={lab.id} lab={lab} />')
  })
})

describe('XP labels come from labXp', () => {
  test('ForgeLab and the Forge index print labXp, not the flat XP.lab', () => {
    for (const text of [page, index]) {
      expect(text).toContain("import { labXp } from '@/lib/economy'")
      expect(text).toContain('labXp(lab.id)')
      expect(text).not.toMatch(/XP\.lab\b/)
    }
  })
})

describe('reduced motion', () => {
  // App.tsx loads each page that reaches framer-motion through `lazyMotion`, which wraps it in MotionScope;
  // a second wrapper inside the page would only nest. Both pages import framer-motion, so both must be routed that way.
  test('Forge and ForgeLab are routed through lazyMotion', () => {
    const app = read('App.tsx')
    for (const name of ['Forge', 'ForgeLab']) expect(app).toMatch(new RegExp(`const ${name} = lazyMotion\\(`))
    expect(page).toContain("from 'framer-motion'")
    expect(index).toContain("from 'framer-motion'")
  })

  test('the spinner only turns when motion is allowed', () => {
    expect(page).toContain('motion-safe:animate-spin')
  })
})
