import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PLATFORMS_CLAIMS } from '@/data/claims/lazy/platforms'
import dynamoTcp from '@/data/errata/2026-11-21-dynamo-tcp-default'
import { ALL_LESSONS } from '@/data/lessons'
import { claimCite, claimNumber } from '@/data/lessons/claims'

// K0-FIX-T3: the t3 lane's fix round. t3.l6 reads the Chromium and Android figures from their claims, the Dynamo
// erratum says what the README at the pinned tag says about etcd, t3.l5 says what wasmtime runs, and the t3.l2 slab
// listing shows the Drop its comment speaks of.

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}

function lesson(id: string) {
  const l = ALL_LESSONS.find((x) => x.id === id)
  if (!l) throw new Error(`${id} not found`)
  return l
}

const root = new URL('../../', import.meta.url).pathname
const claim = (id: string) => {
  const c = PLATFORMS_CLAIMS.find((x) => x.id === id)
  if (!c) throw new Error(id)
  return c
}

describe('t3.l6 reads the Chromium and Android figures from their claims', () => {
  const src = readFileSync(`${root}src/data/lessons/t3/dynamo-case-study.ts`, 'utf8')
  const text = strings(lesson('t3.l6').blocks).join('\n')
  const share = claimNumber('status.chromium.memory-safety-share')
  const sample = claimNumber('status.chromium.memory-safety-sample')

  test('the module types none of the three figures', () => {
    expect(src).toContain("from '../claims'")
    expect(src).not.toMatch(/\b70%/)
    expect(src).not.toMatch(/\b912\b/)
    expect(src).not.toMatch(/below 20%/)
  })

  test('the chip and the paragraph carry the claims’ values', () => {
    expect(text).toContain(`${share}%`)
    expect(text).toContain(`${claimCite('status.android.memory-safety-share')}%`)
    expect(text).toContain(`${sample} high or critical`)
  })

  test('912 is the whole sample, not the memory-unsafe count', () => {
    expect(text).not.toMatch(/memory unsafety \(\d+ bugs since/)
  })

  test('the sample claim quotes the page and says whose it is', () => {
    const c = claim('status.chromium.memory-safety-sample')
    expect(c.source?.url).toBe(claim('status.chromium.memory-safety-share').source?.url)
    expect(c.source?.quote).toContain(`${c.value} high or critical severity security bugs`)
  })
})

describe('the Dynamo TCP erratum says what the README says about etcd', () => {
  test('etcd is not called an earlier option, and Dynamo is not said to have moved from it', () => {
    expect(dynamoTcp.why).not.toContain('moved from')
    const why2 = dynamoTcp.items?.[0]?.why[2] ?? ''
    expect(why2).not.toContain('earlier discovery option')
    expect(why2).toContain('Slurm')
  })
})

describe('t3.l5 names what wasmtime runs', () => {
  const text = strings(lesson('t3.l5').blocks).join('\n')
  test('the clause has its own object, not the interfaces before it', () => {
    expect(text).not.toContain('**wasmtime** runs them')
    expect(text).toContain('**wasmtime** runs Wasm modules and components')
  })
  test('preview 1 is named as wasi.dev names WASI 0.1', () => {
    expect(text).toContain('POSIX-inspired')
    expect(text).not.toContain('POSIX-like call list')
  })
})

describe('t3.l2 slab listing shows its Drop', () => {
  const l = lesson('t3.l2')
  const slab = l.blocks.find((b) => b.type === 'code' && b.filename.startsWith('unsafe_slab.rs'))
  if (!slab || slab.type !== 'code') throw new Error('unsafe_slab.rs listing not found')
  test('the comment does not promise an unmap the listing lacks', () => {
    expect(slab.code).toContain('impl Drop for Mapping')
    expect(slab.code).not.toContain('dropping it unmaps.')
  })
  test('a 100 MiB clone is not said to pollute half the cache', () => {
    expect(strings(l.blocks).join('\n')).not.toContain('half your cache')
  })
})
