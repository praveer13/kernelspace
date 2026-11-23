import { describe, expect, test } from 'bun:test'
import { PAIRS } from '@/data/glossary'
import { MODEL_CLAIMS } from '@/data/claims/models'
import scheduling from '@/data/lessons/t2/scheduling'
import dynamo from '@/data/lessons/t3/dynamo-case-study'

/**
 * K0-FIX-GLOSSARY. Three glossary cards said what their lessons' graded answers do not: priority inversion without the
 * medium-priority party t2.l4 keys on, a lock-free twin "that no side blocks on" beside t3.l6's key that a bounded push
 * fails or waits, and the Orca reservation sentence credited to every Orca figure when only Orca (Max) reserves the
 * maximum. Each test ties the card to the lesson or claim that holds the fact.
 */
const pair = (slug: string) => PAIRS.find((p) => p.slug === slug)!
type Q = { q: string; options: string[]; correct: number[] }
const quiz = (l: unknown): Q[] => {
  const out: Q[] = []
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (typeof o.q === 'string' && Array.isArray(o.options) && Array.isArray(o.correct)) out.push(o as unknown as Q)
      Object.values(o).forEach(walk)
    }
  }
  walk(l)
  return out
}

describe('K0-FIX-GLOSSARY: glossary cards agree with the graded answers', () => {
  test('priority inversion names the medium-priority work that t2.l4 keys on', () => {
    const q = quiz(scheduling).find((x) => x.q.startsWith('Priority inversion is best described'))!
    expect(q.options[q.correct[0]!]).toContain('medium-priority threads preempting the holder')
    const p = pair('priority-inversion')
    expect(p.osDef).toContain('medium-priority work keeps the holder off the CPU')
    expect(p.why).toContain('medium work that keeps the holder from running')
  })

  test('the lock-free twin states no queue nothing holds and does not deny the bounded push t3.l6 keys', () => {
    const q = quiz(dynamo).find((x) => x.q.includes('Which response is backpressure'))!
    expect(q.options[q.correct[0]!]).toContain('push fail or wait')
    const p = pair('lock-free-queue')
    const text = `${p.llm} ${p.llmDef} ${p.why}`
    expect(text).not.toMatch(/no side blocks|prefill.{0,20}decode/i)
    expect(p.syn).not.toContain('dynamo')
    // K0-FIX2-GLOSSARY: a producer that stalls between claiming a slot and publishing it holds up the consumer of a
    // claim-then-publish ring, so the twin states t2.l5's mechanism and no progress promise.
    expect(p.llmDef).not.toMatch(/never stops|stalled/)
    expect(p.llmDef).toContain('producers CAS-claim slots and consumers CAS-advance')
    expect(p.why).toContain('a full bounded ring still refuses the push')
  })

  test('the max-context reservation sentence names Orca (Max), the variant the claim says reserves the maximum', () => {
    const low = MODEL_CLAIMS.find((c) => c.id === 'model.kv.static-utilization-low')!
    expect(low.label).toContain('Orca (Max) in Figure 2')
    expect(low.boundary).toContain('This end is Orca (Max), which reserves the model\'s maximum sequence length')
    const p = pair('external-fragmentation')
    expect(p.why).toContain('Reserving each request’s maximum context')
    expect(p.why).toContain('(Orca (Max) in the paper’s Figure 2)')
    expect(p.why).not.toContain('Orca figures')
  })
})
