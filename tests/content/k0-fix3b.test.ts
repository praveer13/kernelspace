import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { claimNumber } from '@/data/claims'
import { ALL_LESSONS } from '@/data/lessons'
import pagedWaste from '@/data/errata/2026-11-21-paged-waste-not-the-papers-figure'
import { LESSON_CLAIMS } from '../../scripts/gen-lesson-claims'

/**
 * K0-FIX3B, the second round of k0-repin's last fix.
 *   - t2.l7 gives the paper's sections as the paper numbers them (arXiv 2309.06180v1): §3 "Memory Challenges in LLM
 *     Serving" with §3.1 "Memory Management in Existing Systems", §4.1 "PagedAttention", §4.5 "Scheduling and Preemption",
 *     §4.6 "Distributed Execution", §5 "Implementation".
 *   - The paper's 20.4% to 38.2% (Section 1) is two claims, model.kv.static-utilization-low and -high: the lessons render
 *     them, and the unpublished erratum, static text, gives the same two values.
 */

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}
const text = (id: string) => {
  const l = ALL_LESSONS.find((x) => x.id === id)
  if (!l) throw new Error(`${id} not found`)
  return strings(l).join('\n')
}
const root = new URL('../../', import.meta.url).pathname
const read = (path: string) => readFileSync(`${root}${path}`, 'utf8')

const LOW = claimNumber('model.kv.static-utilization-low')
const HIGH = claimNumber('model.kv.static-utilization-high')

describe("t2.l7 numbers the paper's sections as the paper does", () => {
  const t = text('t2.l7')

  test('the headings follow the paper: §1–3 the problem, §4 PagedAttention, §4.5 scheduling, §5–6 kernel and numbers', () => {
    const headings = t.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.split(':')[0])
    expect(headings).toEqual(['## §1–3', '## §4', '## §4.5', '## §5–6', '## Checkpoint briefing'])
  })

  test("the fix is §4.1, and the distributed bits are §4.6's, as the paper has them", () => {
    expect(t).toContain('The fix, §4.1: partition')
    expect(t).not.toContain('section 3:')
    expect(t).toContain("Also note §4.6's distributed bits")
    expect(t).not.toContain("§5's distributed")
    // §4.6: "vLLM features a single KV cache manager within the centralized scheduler" and "the scheduler broadcasts this
    // control message to the GPU workers"; nothing is replicated per worker.
    expect(t).not.toContain('replicated per worker')
    expect(t).toContain('one KV cache manager in the central scheduler serves every worker')
    expect(t).toContain('the scheduler broadcasts the block tables')
  })

  test('the §3.1 allocator pointer and the §4 headings no longer contradict each other', () => {
    expect(t).toContain('§3.1 is the allocator autopsy')
    expect(t).not.toMatch(/## §3: PagedAttention/)
    expect(t).toContain('feel §4.5 in your bones')
  })
})

describe("the paper's 20.4% to 38.2% is read from its two claims", () => {
  test('both ids are in the lesson snapshot list', () => {
    expect(LESSON_CLAIMS).toContain('model.kv.static-utilization-low')
    expect(LESSON_CLAIMS).toContain('model.kv.static-utilization-high')
  })

  test.each([
    ['t1.l4', 'src/data/lessons/t1/fragmentation.ts', `${LOW}% to ${HIGH}%`],
    ['t2.l7', 'src/data/lessons/t2/exam-pagedattention.ts', `${LOW}% to ${HIGH}%`],
    ['t5.l5', 'src/data/lessons/t5/pagedattention-deep-dive.ts', `${LOW}%–${HIGH}%`],
  ])('%s renders the range from the claims and its source types neither value', (id, file, range) => {
    expect(text(id)).toContain(range)
    const src = read(file)
    expect(src).not.toContain(String(LOW))
    expect(src).not.toContain(String(HIGH))
    expect(src).toContain("claimNumber('model.kv.static-utilization-low')")
    expect(src).toContain("claimNumber('model.kv.static-utilization-high')")
  })

  test("t1.l4's quiz explanation gives the range too", () => {
    expect(text('t1.l4')).toContain(`versus only ${LOW}% to ${HIGH}% of KV cache memory holding token states`)
  })

  test("the unpublished erratum's static text gives the claims' values", () => {
    const e = strings(pagedWaste).join('\n')
    expect(e).toContain(`${LOW}% to ${HIGH}%`)
    for (const m of e.matchAll(/(\d+\.\d)% to (\d+\.\d)%/g)) expect([Number(m[1]), Number(m[2])]).toEqual([LOW, HIGH])
  })
})
