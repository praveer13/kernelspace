import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { BUILD_LINKS, DESTINATIONS, SECONDARY_LINKS, destinationOf } from '../../src/components/nav-links'

/**
 * Wave 1 B26 (wave-1.md §6.9, ledger spec §8.1 / §7.3): four destinations with Today first, the same four in
 * the Navbar and the bottom tabs, and a Navbar, StatusBar and BottomTabs that read only the snapshot-backed
 * store. Dynamic `import()` calls are not followed, matching how the bundle budget counts.
 */
const root = resolve(import.meta.dir, '../..')
const src = join(root, 'src')

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
const ASSET = /\.(css|svg|png|jpe?g|webp|woff2?|json)$/

function resolveSpecifier(spec: string, from: string): string | null {
  const base = spec.startsWith('@/') ? join(src, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (base === null) return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate
  }
  throw new Error(`cannot resolve ${spec} from ${relative(root, from)}`)
}

function staticGraph(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const visit = (file: string) => {
    if (files.has(file)) return
    files.add(file)
    for (const m of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      if (ASSET.test(m[1])) continue
      const next = resolveSpecifier(m[1], file)
      if (next) visit(next)
      else if (!m[1].startsWith('.') && !m[1].startsWith('@/')) packages.add(m[1])
    }
  }
  visit(join(root, entry))
  return { files: [...files].map((f) => relative(root, f)), packages: [...packages] }
}

describe('the four destinations', () => {
  test('Today is first, then Path, Build and Me, each with a route', () => {
    expect(DESTINATIONS.map((d) => d.label)).toEqual(['Today', 'Path', 'Build', 'Me'])
    expect(DESTINATIONS.map((d) => d.to)).toEqual(['/today', '/curriculum', '/forge', '/progress'])
  })

  test('Build lists Forge, Sims, Fleet, Fleet Week, Capstone and Leaderboard', () => {
    expect(BUILD_LINKS.map((l) => l.label)).toEqual(['Forge', 'Sims', 'Fleet', 'Fleet Week', 'Capstone', 'Leaderboard'])
    expect(BUILD_LINKS.map((l) => l.to)).toEqual(['/forge', '/lab', '/fleet', '/week', '/capstone', '/leaderboard'])
  })

  test('the hamburger keeps what the tabs do not reach, and no primary destination twice', () => {
    const primary = new Set(DESTINATIONS.map((d) => d.to))
    expect(SECONDARY_LINKS.filter((l) => primary.has(l.to))).toEqual([])
    // every Build page is one tap away on a phone: the Build tab opens Forge, the rest are in the hamburger
    for (const l of BUILD_LINKS) expect(l.to === '/forge' || SECONDARY_LINKS.some((s) => s.to === l.to)).toBe(true)
    expect(SECONDARY_LINKS.map((l) => l.to)).toContain('/freshness')
    expect(SECONDARY_LINKS.map((l) => l.to)).toContain('/glossary')
  })

  test('a page lights the destination that holds it', () => {
    const cases: [string, string | null][] = [
      ['/today', 'today'],
      ['/freshness', 'today'],
      ['/curriculum', 'path'],
      ['/tracks/t1', 'path'],
      ['/lesson/t1.l4', 'path'],
      ['/glossary', 'path'],
      ['/play/block-placement', 'path'],
      ['/forge', 'build'],
      ['/forge/rust-allocator', 'build'],
      ['/lab', 'build'],
      ['/lab/memory-grid', 'build'],
      ['/fleet', 'build'],
      ['/week', 'build'],
      ['/capstone', 'build'],
      ['/leaderboard', 'build'],
      ['/progress', 'me'],
      ['/', null],
      ['/boot', null],
      ['/nope', null],
    ]
    for (const [path, id] of cases) expect([path, destinationOf(path)]).toEqual([path, id])
  })

  test('a prefix is a path segment, not a string prefix', () => {
    expect(destinationOf('/labyrinth')).toBeNull()
    expect(destinationOf('/fleeting')).toBeNull()
  })
})

describe('the shell reads only the snapshot', () => {
  for (const file of ['src/components/Navbar.tsx', 'src/components/StatusBar.tsx', 'src/components/BottomTabs.tsx']) {
    test(`${file} reaches no ledger engine, no framer-motion, no lessons, no review model`, () => {
      const { files, packages } = staticGraph(file)
      // the façade (progress.ts) reaches ledger/client.ts, a request bridge; the engine behind it is lazy
      const own = readFileSync(join(root, file), 'utf8')
      expect(own).not.toMatch(/getLedgerClient|@\/lib\/ledger\//)
      const forbidden = files.filter(
        (f) =>
          /^src\/lib\/ledger\/(engine|idb-store|codec)\./.test(f) ||
          /^src\/data\/lessons(\/|\.)/.test(f) ||
          /^src\/lib\/learner\/(cards|composer|today|summary|planner)\./.test(f) ||
          /^src\/pages\//.test(f) ||
          /^src\/components\/sims\//.test(f),
      )
      expect(forbidden).toEqual([])
      expect(packages.filter((p) => p === 'framer-motion' || p === 'fuse.js' || p.startsWith('motion-'))).toEqual([])
    })
  }

  test('the Navbar chip names the ring, not an XP rank', () => {
    const navbar = readFileSync(join(src, 'components/Navbar.tsx'), 'utf8')
    expect(navbar).toContain('selectRings')
    expect(navbar).not.toMatch(/rankForXp|nextRank|RANKS/)
  })

  test('Layout renders the bottom tabs, and only below lg', () => {
    const layout = readFileSync(join(src, 'components/Layout.tsx'), 'utf8')
    expect(layout).toContain('<BottomTabs />')
    expect(readFileSync(join(src, 'components/BottomTabs.tsx'), 'utf8')).toContain('lg:hidden')
  })
})

describe('reduced motion on the pages B26 lists', () => {
  // wave-1.md §6.9 asks for a MotionScope on these pages. App.tsx already loads each page that reaches
  // framer-motion through `lazyMotion`, which wraps it in MotionScope; a second wrapper would only nest.
  test('Home, Progress, Glossary, Lab, Changes and FleetWeek are routed through lazyMotion', () => {
    const app = readFileSync(join(src, 'App.tsx'), 'utf8')
    for (const page of ['Home', 'Progress', 'Glossary', 'Lab', 'Changes', 'FleetWeek']) {
      expect(app).toMatch(new RegExp(`const ${page} = lazyMotion\\(`))
    }
  })
})
