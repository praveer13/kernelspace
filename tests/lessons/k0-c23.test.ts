import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lessonById } from '@/data/lessons'
import { claimNumber } from '@/data/lessons/claims'

// The lesson's own trace: four requests need 8, 12, 20 and 40 decode steps; E, F, G and H wait.
const LENGTHS = [8, 12, 20, 40]
const NAMES = ['A', 'B', 'C', 'D']
const WAITING = ['E', 'F', 'G', 'H']

/** Recompute fig 1's continuous-batching rows: each time a slot frees, the next waiting request joins on the next step. */
function continuousRows() {
  const finish = [...LENGTHS].sort((a, b) => a - b)
  const running = [...NAMES]
  const rows: { label: string; sub: string }[] = [{ label: 'it 1–8', sub: running.join(' ') }]
  const done = [...NAMES.map((n, i) => ({ n, at: LENGTHS[i] }))].sort((a, b) => a.at - b.at)
  for (let i = 0; i < 3; i++) {
    const { n } = done[i]
    running.splice(running.indexOf(n), 1)
    running.push(WAITING[i])
    rows.push({ label: `it ${finish[i] + 1}`, sub: `${running.slice(0, -1).join(' ')} + ${WAITING[i]}` })
  }
  return rows
}

function staticSub() {
  const parts = NAMES.slice(0, 3).map((n, i) => (i === 0 ? `${n} idle from step ${LENGTHS[i]}` : `${n} from ${LENGTHS[i]}`))
  return parts.join(', ')
}

const lesson = lessonById('t5.l7')!
const dia = lesson.blocks.find((b) => b.type === 'diagram')
const nodes = dia?.type === 'diagram' ? dia.nodes : []
const node = (id: string) => nodes.find((n) => n.id === id)
const lessonText = readFileSync(join(import.meta.dir, '../../src/data/lessons/t5/continuous-batching.ts'), 'utf8')

describe('K0-C23: t5.l7 figure 1 follows the 8/12/20/40 trace', () => {
  test('the lesson states the trace the model uses', () => {
    expect(lessonText).toContain('8/12/20/40 decode steps')
  })
  test('the continuous nodes equal a recompute from the trace', () => {
    const rows = continuousRows()
    expect(rows.map((r) => r.label)).toEqual(['it 1–8', 'it 9', 'it 13', 'it 21'])
    ;['c1', 'c2', 'c3', 'c4'].forEach((id, i) => {
      expect(node(id)?.label).toBe(rows[i].label)
      expect(node(id)?.sub).toBe(rows[i].sub)
    })
  })
  test('the static node says when each of A, B and C goes idle', () => {
    expect(node('s1')?.sub).toBe(staticSub())
  })
  test('only A has left at step 9', () => {
    const step = dia?.type === 'diagram' ? dia.steps[1].caption : ''
    expect(step).toContain('Step 9: A has gone')
    expect(step).not.toContain('A, B, C are gone')
  })
})

describe('K0-C23: where the numbers belong', () => {
  test('no 24x in the lesson as the paper\'s, and no unsourced 2-8x as a measurement', () => {
    expect(lessonText).not.toMatch(/24\s*×|24x/)
    expect(lessonText).not.toContain('real deployments')
    expect(lessonText).toContain('goodput gain (course estimate)')
  })
  test('the paper range is read from the claims', () => {
    expect(claimNumber('serving.pagedattention.throughput-gain-low')).toBeLessThan(claimNumber('serving.pagedattention.throughput-gain-high'))
    expect(lessonText).toContain("claimNumber('serving.pagedattention.throughput-gain-low')")
  })
  test('the preemption warning says the newest is evicted and that this protects long requests', () => {
    expect(lessonText).toContain('preempts the most recently admitted request, which protects long-running requests')
    expect(lessonText).not.toContain('preempt the youngest (default) and long requests can starve')
  })
})
