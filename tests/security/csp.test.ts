import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CSP } from '../../vite.config'

/**
 * The build-time meta CSP (docs/specs/wave-1.md §14.2). `CSP` is the string vite.config.ts injects into
 * index.html, so these tests read the real policy, not a copy. The 1c review measured giscus's client adding
 * <link href="https://giscus.app/default.css"> after consent and the policy blocking it.
 */

const directives = (policy: string): Map<string, string[]> => {
  const out = new Map<string, string[]>()
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/)
    if (name) out.set(name, sources)
  }
  return out
}

/** Whether a source list admits `url`: an exact origin or a `*.` host wildcard (the only forms this policy uses). */
const admits = (sources: readonly string[], url: string): boolean => {
  const u = new URL(url)
  return sources.some((src) => {
    if (src.startsWith("'")) return false
    const m = /^(https?:)\/\/(\*\.)?([^/]+)$/.exec(src)
    if (!m) return src === 'https:' && u.protocol === 'https:'
    if (m[1] !== u.protocol) return false
    return m[2] ? u.hostname.endsWith(`.${m[3]}`) : u.host === m[3]
  })
}

const policy = directives(CSP)
const get = (name: string): string[] => policy.get(name) ?? []

describe('the build-time CSP', () => {
  test('style-src admits the giscus stylesheet, which giscus adds after consent', () => {
    expect(admits(get('style-src'), 'https://giscus.app/default.css')).toBe(true)
    // what it already allowed stays allowed
    expect(get('style-src')).toEqual(expect.arrayContaining(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']))
    // and nothing else third-party arrived with it
    expect(get('style-src').filter((s) => s.startsWith('https:'))).toEqual(['https://fonts.googleapis.com', 'https://giscus.app'])
  })

  test('script-src, frame-src and connect-src are unchanged', () => {
    expect(get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'", 'https://giscus.app'])
    expect(get('frame-src')).toEqual(["'self'", 'https://giscus.app'])
    expect(get('connect-src')).toEqual(["'self'", 'https://cdn.jsdelivr.net', 'https://huggingface.co', 'https://*.huggingface.co', 'https://*.hf.co'])
    expect(admits(get('connect-src'), 'https://giscus.app/api/discussions')).toBe(false)
  })

  test('the policy never allows eval or an object', () => {
    expect(CSP).not.toContain("'unsafe-eval'")
    expect(get('object-src')).toEqual(["'none'"])
  })

  test('§14.2 prints the same policy the build injects', () => {
    const spec = readFileSync(resolve(import.meta.dir, '../../docs/specs/wave-1.md'), 'utf8')
    const block = /### 14\.2 Meta CSP[\s\S]*?```\n([\s\S]*?)```/.exec(spec)
    expect(block).not.toBeNull()
    const printed = (block as RegExpExecArray)[1].replace(/\s*\n\s*/g, ' ').trim().replace(/;$/, '')
    expect(directives(printed)).toEqual(policy)
  })
})
