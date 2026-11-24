/**
 * K0-C46: every https URL inside a lab crate's Rust source points at a route of this app (on the site's own
 * domain) or at an allow-listed external host, and the R10 brief says what its lib.rs says.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { FORGE_LABS } from '../../src/data/labs'

const root = new URL('../../', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

const SITE = read('public/CNAME').trim()
const EXTERNAL_HOSTS = new Set(['doc.rust-lang.org', 'github.com', 'arxiv.org'])

function rustSources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'target' || name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...rustSources(p))
    else if (name.endsWith('.rs') && dir.endsWith('/src')) out.push(p)
  }
  return out
}

/** Route patterns of src/App.tsx as regexes (':param' matches one segment). */
function routes(): RegExp[] {
  const app = read('src/App.tsx')
  return [...app.matchAll(/<Route\s+path="([^"*]+)"/g)].map(
    (m) => new RegExp(`^${m[1].replace(/:[A-Za-z]+/g, '[^/]+')}/?$`),
  )
}

describe('lab source URLs', () => {
  const urls: { file: string; url: string }[] = []
  for (const f of rustSources(join(root, 'labs'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/https?:\/\/[^\s)`'"<>]+/g)) {
      urls.push({ file: f.slice(root.length), url: m[0].replace(/[.,;:]+$/, '') })
    }
  }

  test('the scan finds the allocator kit URL', () => {
    expect(urls.some((u) => u.file.includes('rust-allocator'))).toBe(true)
  })

  test.each(urls)('$file: $url', ({ url }) => {
    const u = new URL(url)
    expect(u.protocol).toBe('https:')
    if (u.hostname === SITE) {
      expect(routes().some((r) => r.test(u.pathname))).toBe(true)
      const m = u.pathname.match(/^\/forge\/([^/]+)$/)
      if (m) expect(FORGE_LABS.some((l) => l.id === m[1])).toBe(true)
    } else {
      expect(EXTERNAL_HOSTS.has(u.hostname)).toBe(true)
    }
  })
})

describe('R10 brief and lib.rs agree', () => {
  const lab = FORGE_LABS.find((l) => l.id === 'rust-zero-r10')!
  const lib = read('labs/rust-zero/r10-atomics/src/lib.rs').replace(/\/\/! ?/g, '').replace(/\s+/g, ' ')
  test('lib.rs says the checks run on one thread and do not verify the Ordering', () => {
    expect(lib).toContain('run on one thread')
    expect(lib).toContain('not which `Ordering` you chose')
  })
  test('the brief says the same, and no longer says the tests inspect orderings', () => {
    const b = lab.brief[0]
    expect(b).toContain('run on one thread')
    expect(b).toContain('name the ordering for each use')
    expect(b).not.toContain('also inspect the ordering choices')
  })
  test('the brief denies that any check sees the Ordering, and never claims one does', () => {
    expect(lab.brief[0]).toMatch(/\bNone of them sees which Ordering\b/)
    // The brief is pinned whole: it is the account of labs/rust-zero/r10-atomics/src/lib.rs:8-10 (checks run
    // on one thread; they verify the value, not which `Ordering` you chose). A sentence added anywhere in it,
    // affirmative or not, fails here and is checked against lib.rs before this string moves with it.
    expect(lab.brief).toEqual([
      "The checks run on one thread: they verify the value each call leaves, and one check asks you to name the ordering for each use. None of them sees which Ordering you pass to an atomic call, and on x86-64 lab 04's stress test may not either. Write the protocol down: Relaxed for an independent ticket, Release to publish, Acquire to observe.",
      'R10 is required readiness for MPMC queue lab 04. Do not start the lock-free queue until compare-exchange failure and success orderings make sense.',
    ])
    // The lab's other text (hook, completion, check labels) never ties a check to the ordering, in any case.
    const affirm = /\b(?:inspect|read|check|see|verif)\w*\b[^.:;]*\border/i
    const rest = [lab.hook, lab.completion.title, lab.completion.next, ...lab.checks.map((c) => c.label)]
    for (const s of rest) expect(s).not.toMatch(affirm)
  })
  test('the allocator completion no longer says vLLM coalesces', () => {
    const next = FORGE_LABS.find((l) => l.id === 'rust-allocator')!.completion.next
    expect(next).not.toContain('block manager coalesces')
    expect(next).toContain('does not need to')
  })
})
