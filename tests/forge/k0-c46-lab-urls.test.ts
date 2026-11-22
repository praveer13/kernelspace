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
    const b = lab.brief[0]
    expect(b).toMatch(/\b(?:do not|does not|None of them) sees? which Ordering\b/)
    // Any sentence where a check inspects, reads, checks, sees or verifies the Ordering must carry a negation.
    const affirm = /\b(?:[Ii]nspect|[Rr]ead|[Cc]heck|[Ss]ee|[Vv]erif)\w*\b[^.:;]*?\b(?:which|the|your) Ordering\b/
    for (const s of b.split(/(?<=[.:;])\s+/)) {
      if (affirm.test(s)) expect(s).toMatch(/\b(?:not|None|no|never|cannot)\b/)
    }
  })
  test('the allocator completion no longer says vLLM coalesces', () => {
    const next = FORGE_LABS.find((l) => l.id === 'rust-allocator')!.completion.next
    expect(next).not.toContain('block manager coalesces')
    expect(next).toContain('does not need to')
  })
})
