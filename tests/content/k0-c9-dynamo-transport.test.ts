import { describe, expect, test } from 'bun:test'
import { PLATFORMS_CLAIMS } from '@/data/claims/lazy/platforms'
import { PAIRS } from '@/data/glossary'
import { ALL_LESSONS } from '@/data/lessons'

// K0-C9: Dynamo's components talk over TCP by default and NATS is optional. No lesson, chip or glossary pair names
// NATS as Dynamo's default. The sites other tasks owned (K0-C10 zero-copy, K0-C11 async-io, K0-C8a production-stack,
// K0-C12 glossary) have all been rewritten, so the list of pending sentences is empty and every sentence is held (K0-FIX-T3).

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}

const PENDING: string[] = []

const OPTIONAL = /optional|not require|does not require/i

function sites(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = []
  for (const l of ALL_LESSONS) for (const t of strings([l.hook, l.title, l.blocks])) out.push({ where: l.id, text: t })
  for (const p of PAIRS) for (const t of strings(p)) out.push({ where: `glossary:${p.id}`, text: t })
  return out
}

describe('no lesson or glossary pair names NATS as Dynamo’s default', () => {
  test('every sentence with NATS says it is optional, or is a listed site another task owns', () => {
    const bad = sites().filter(({ text }) => /\bNATS\b/.test(text) && !OPTIONAL.test(text) && !PENDING.some((p) => text.includes(p)))
    expect(bad.map((b) => `${b.where}: ${b.text.slice(0, 120)}`)).toEqual([])
  })
})

describe('t3.l6 states the TCP default', () => {
  const lesson = ALL_LESSONS.find((l) => l.id === 't3.l6')
  if (!lesson) throw new Error('t3.l6 not found')
  const all = strings(lesson.blocks).join('\n')
  test('the hook leads with the TCP request plane, not NATS', () => {
    expect(lesson.hook).toContain('TCP request plane')
    expect(lesson.hook).not.toContain('NATS')
  })
  test('the body says TCP is the default and NATS is optional', () => {
    expect(all).toMatch(/plain TCP by default/)
    expect(all).toMatch(/NATS is an optional backend/)
  })
  test('the 70% chip is labelled as Chromium’s, with no Microsoft attribution', () => {
    expect(all).toContain('Chromium severe bugs')
    expect(all).not.toContain('\nC/C++ CVEs\n')
    expect(all).not.toContain('Microsoft/Google')
    expect(all).not.toContain('70%-of-CVEs')
  })
  test('Kubernetes integration is not credited to Python', () => {
    expect(all).not.toContain('K8s integration')
    expect(all).toContain('Kubernetes operator is written in Go')
    expect(all).toContain('NIXL')
  })
})

const getClaim = (id: string) => {
  const c = PLATFORMS_CLAIMS.find((x) => x.id === id)
  if (!c) throw new Error(id)
  return c
}

describe('the claims behind it', () => {
  test('transport claim is pinned at the tag it was read at', () => {
    const c = getClaim('status.dynamo.transport')
    expect(c.pin?.ref).toMatch(/^v\d/)
    expect(c.source?.url).toContain(c.pin?.ref ?? '')
    expect(c.source?.quote).toContain('TCP')
  })
  test('Chromium and Android figures say whose they are', () => {
    expect(getClaim('status.chromium.memory-safety-share').boundary).toContain('Chromium only')
    expect(getClaim('status.android.memory-safety-share').source?.url).toContain('blog.google')
  })
})
