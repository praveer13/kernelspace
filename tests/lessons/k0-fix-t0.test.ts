/**
 * K0-FIX-T0: the t0 lane's fix round. The simulator figures the lessons quote are recomputed here from the
 * simulators' own model constants, so a sentence and its model cannot drift apart.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import rowCol from '@/data/lessons/t0/row-vs-column'
import aosSoa from '@/data/lessons/t0/aos-vs-soa'
import runtime from '@/data/lessons/t0/your-runtime'
import flame from '@/data/lessons/t0/flame-graphs'
import { LAYOUT_TASKS } from '@/components/sims/layoutLab.tasks'
import { T0_KCS } from '@/data/kc/t0'
import l3Erratum from '@/data/errata/2026-11-21-t0-l3-row-column-measured-times'
import l4Erratum from '@/data/errata/2026-11-22-t0-l4-false-sharing-padding-range'
import l5Erratum from '@/data/errata/2026-11-21-t0-l5-big-kernel-lock-and-python-scheduler'

const root = join(import.meta.dir, '../..')
const src = (p: string): string => readFileSync(join(root, p), 'utf8')
const num = (text: string, re: RegExp): number => {
  const m = text.match(re)
  if (!m) throw new Error(`no match for ${re}`)
  return Number(m[1])
}

describe('t0.l3: the simulator figures are the model at its defaults', () => {
  const bench = src('src/components/sims/MatrixBench.tsx')
  const dramNs = num(bench, /name: 'DRAM', capKb: Infinity, ns: ([\d.]+)/)
  const prefetch = num(bench, /if \(prefetch\) ns \*= ([\d.]+)/)
  const tlbNs = num(bench, /ns \+= doubles \* ([\d.]+)/)
  test('the defaults are an 8192 matrix with the prefetcher on', () => {
    expect(bench).toContain('useState<number>(8192)')
    expect(bench).toContain('useState<boolean>(true)')
  })
  const n = 8192
  const rowS = ((n * n) / 8) * dramNs * prefetch * 1e-9
  const colS = n * n * (dramNs + tlbNs) * 1e-9
  const text = JSON.stringify(rowCol)

  test('the lesson states the model times and gap', () => {
    expect(text).toContain(`about ${rowS.toFixed(1)} seconds and ${Math.round(colS)} seconds, an ${Math.round(colS / rowS)}-fold gap`)
    expect(text).not.toContain('8 seconds')
  })
  test('the erratum after states the same model times', () => {
    expect(l3Erratum.after).toContain(`about ${rowS.toFixed(1)} s and ${Math.round(colS)} s`)
    expect(l3Erratum.after).not.toContain('8 s')
  })
  test('the ratio is not oversold, and the Python tab run is reported', () => {
    expect(text).not.toContain('the ratio is the part to trust')
    expect(text).not.toContain('the 20× loop')
    expect(text).toContain('the Python tab below')
  })
})

describe('t0.l4: false sharing and padding', () => {
  const lab = src('src/components/sims/LayoutLab.tsx')
  const m = lab.match(/padded \? ([\d.]+) : ([\d.]+)\) \* j/)
  if (!m) throw new Error('LayoutLab model constants not found')
  const ratio = Math.round(Number(m[2]) / Number(m[1]))
  const lesson = aosSoa as unknown as { blocks: { type: string; tasks?: string[]; note?: string }[] }
  const exercise = lesson.blocks.find((b) => b.type === 'exercise')!
  const padTask = LAYOUT_TASKS.find((t) => t.id === 't-layout-pad')!

  test('the sim task and the lesson task call the simulator a model and give its ratio beside the measured one', () => {
    for (const t of [padTask.text, exercise.tasks![3]]) {
      expect(t).toContain(`the simulator is a model and shows about ${ratio}×`)
      expect(t).toContain('5–8×')
    }
    expect(exercise.note).toContain(`about ${ratio} times`)
  })
  test('false sharing is not stated as always slower, and no unsourced growth claim is left', () => {
    const text = JSON.stringify(aosSoa)
    expect(text).not.toContain('worse as cores and sockets are added')
    expect(text).not.toContain('worse with more cores or sockets')
    expect(text).not.toContain('more on bigger machines')
    expect(text).toContain('where cores share a cache')
  })
  test('the erratum source resolves to the false-sharing measurements', () => {
    expect(l4Erratum.source.url).toBe('https://akkadia.org/drepper/cpumemory.pdf')
  })
})

describe('t0.l5: the big kernel lock is taught here, in course words', () => {
  const text = JSON.stringify(runtime)
  test('the trade-off is stated in this lesson', () => {
    expect(text).toContain('only one CPU runs kernel code at a time')
  })
  test('no t0 lesson says tier, and the ticket points at no other lesson', () => {
    for (const f of ['why-systems', 'memory-hierarchy', 'row-vs-column', 'aos-vs-soa', 'your-runtime', 'flame-graphs']) {
      expect(src(`src/data/lessons/t0/${f}.ts`)).not.toMatch(/\btier\b/)
    }
    const ticket = (runtime as unknown as { ticket: { cr: { prompt: string }[] } }).ticket.cr[0].prompt
    expect(ticket).toBe('Explain why CPython has a GIL, and name the operating-system trade-off it matches.')
  })
  test('the erratum says the first lesson names it and this lesson teaches it', () => {
    expect(l5Erratum.after).not.toContain('taught in the first lesson')
    expect(l5Erratum.after).toContain('named in the first lesson of the track')
  })
})

describe('t0.l6: wording', () => {
  test('the wait-bars can-statement names the straggler', () => {
    expect(T0_KCS.find((k) => k.id === 't0.wait-bars')!.can).toBe(
      'You can read wait bars in a wall-clock profile (CPU profiles hide parked threads) and find the straggler.',
    )
  })
  test('the tool changes; the grammar does not', () => {
    expect(JSON.stringify(flame)).toContain("The tool changes; the grammar doesn't.")
  })
})
