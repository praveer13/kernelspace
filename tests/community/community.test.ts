import { afterEach, describe, expect, test } from 'bun:test'
import {
  GISCUS_CATEGORY,
  GISCUS_PREF_KEY,
  giscusAttributes,
  readAlwaysLoad,
  writeAlwaysLoad,
} from '../../src/data/community'

describe('giscusAttributes (§14.3, owner answer O2)', () => {
  test('lessons map to Announcements by a specific lesson:<id> term', () => {
    const a = giscusAttributes('lesson', 'T1.L4')
    expect(a).not.toBeNull()
    expect(a!['data-repo']).toBe('praveer13/kernelspace')
    expect(a!['data-repo-id']).toBe('R_kgDOTc8vQw')
    expect(a!['data-category-id']).toBe('DIC_kwDOTc8vQ84DHETD')
    expect(a!['data-mapping']).toBe('specific')
    expect(a!['data-term']).toBe('lesson:T1.L4')
    expect(a!['data-strict']).toBe('1')
    expect(a!['data-reactions-enabled']).toBe('0')
    expect(a!['data-loading']).toBe('lazy')
  })

  test('labs map to Q&A by a specific lab:<id> term', () => {
    const a = giscusAttributes('lab', '01')
    expect(a!['data-category-id']).toBe('DIC_kwDOTc8vQ84DHETF')
    expect(a!['data-term']).toBe('lab:01')
  })

  test('empty ids hide the discussion', () => {
    const filled = { repo: 'a/b', repoId: 'R', categories: GISCUS_CATEGORY }
    expect(giscusAttributes('lesson', 'x', { ...filled, repoId: '' })).toBeNull()
    expect(giscusAttributes('lesson', 'x', { ...filled, repo: '' })).toBeNull()
    const blank = { lesson: { name: '', id: '' }, lab: GISCUS_CATEGORY.lab }
    expect(giscusAttributes('lesson', 'x', { ...filled, categories: blank })).toBeNull()
    expect(giscusAttributes('lab', 'x', { ...filled, categories: blank })).not.toBeNull()
    expect(giscusAttributes('lesson', '')).toBeNull()
  })
})

describe('always-load preference', () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  afterEach(() => {
    if (real) Object.defineProperty(globalThis, 'localStorage', real)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  })

  test('round-trips through ks:giscus', () => {
    const m = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
        removeItem: (k: string) => void m.delete(k),
      },
    })
    expect(readAlwaysLoad()).toBe(false)
    writeAlwaysLoad(true)
    expect(m.get(GISCUS_PREF_KEY)).toBe('1')
    expect(readAlwaysLoad()).toBe(true)
    writeAlwaysLoad(false)
    expect(m.has(GISCUS_PREF_KEY)).toBe(false)
    expect(readAlwaysLoad()).toBe(false)
  })

  test('survives a localStorage that throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    expect(readAlwaysLoad()).toBe(false)
    expect(() => writeAlwaysLoad(true)).not.toThrow()
  })
})
