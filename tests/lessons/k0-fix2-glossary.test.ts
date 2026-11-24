import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PAIRS } from '@/data/glossary'
import primitives from '@/data/lessons/t2/concurrency-primitives'

/**
 * K0-FIX2-GLOSSARY. At phone width the flip card's faces were fixed at 220 px and the longer cards spilled under the next
 * card (e2e/k0-e9-glossary-a11y.spec.ts measures that); the faces now share one grid cell that grows with the longer face.
 * The lock-free twin no longer promises that a stalled producer never stops the consumer: it states the ring t2.l5 teaches.
 * The priority-inversion card says why the engine has no priority to lend.
 */
const pair = (slug: string) => PAIRS.find((p) => p.slug === slug)!

describe('K0-FIX2-GLOSSARY', () => {
  test('the flip card has no fixed height and its faces are not pinned to a fixed box', () => {
    const src = readFileSync(new URL('../../src/pages/Glossary.tsx', import.meta.url), 'utf8')
    const card = src.slice(src.indexOf('function FlipCard'), src.indexOf('export default function Glossary'))
    expect(card).not.toMatch(/[\s'"]h-\[220px\]/)
    expect(card).toContain('min-h-[220px]')
    expect(card.match(/\[grid-area:1\/1\]/g)?.length).toBe(2)
    expect(card).not.toMatch(/absolute inset-0 flex flex-col/)
  })

  test('the lock-free twin states the mechanism t2.l5 teaches', () => {
    expect(JSON.stringify(primitives)).toContain('a ring buffer where producers CAS-claim slots and consumers CAS-advance')
    const p = pair('lock-free-queue')
    expect(p.llmDef).toContain('producers CAS-claim slots and consumers CAS-advance')
    expect(p.osDef).not.toContain('wait-free')
  })

  test('the priority-inversion card says the engine has no lock to lend priority through', () => {
    expect(pair('priority-inversion').why).toContain('the engine has no lock to lend it through, so it evicts a lowest-priority sequence')
  })
})
