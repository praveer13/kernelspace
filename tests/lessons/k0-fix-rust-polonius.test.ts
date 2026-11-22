/**
 * K0-FIX-RUST: the Polonius claim cites the release notes that carry its value, and the lessons say what
 * those notes support (no stable release ships Polonius) rather than dating a compile that was not run.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { RUST_LANG_CLAIMS } from '@/data/claims/lazy/rust-lang'

const root = path.resolve(import.meta.dir, '../..')
const claim = RUST_LANG_CLAIMS.find((c) => c.id === 'status.rust.polonius')!
const read = (f: string) => readFileSync(path.join(root, f), 'utf8')

describe('status.rust.polonius', () => {
  test('its source is Rust RELEASES.md at a release tag, and its value names that release', () => {
    const m = /^https:\/\/raw\.githubusercontent\.com\/rust-lang\/rust\/(\d+\.\d+\.\d+)\/RELEASES\.md$/.exec(claim.source?.url ?? '')
    expect(m).not.toBeNull()
    const tag = m![1]
    expect(claim.source?.quote).toStartWith(`Version ${tag} (`)
    expect(claim.value).toContain(`Rust ${tag}`)
    expect(String(claim.value)).toContain('ships Polonius')
  })
  test('the boundary does not repeat the "Holds for" label the claims table puts before it', () => {
    expect(claim.boundary).not.toMatch(/^Holds for/i)
  })
  test('r.l4 and r.l9 read the claim and do not date the E0502 itself', () => {
    for (const f of ['src/data/lessons/r/borrowing-and-slices.ts', 'src/data/lessons/r/practical-lifetimes.ts']) {
      const s = read(f)
      expect(s).toContain("Polonius, accepts it, but ${claimCite('status.rust.polonius')}")
      expect(s).not.toContain("(${claimCite('status.rust.polonius')})")
    }
  })
})
