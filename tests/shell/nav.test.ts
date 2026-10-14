import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
    expect(DESTINATIONS.map((d) => d.to)).toEqual(['/today', '/curriculum', '/forge', '/me'])
  })

  test('Build lists Forge, Sims, Fleet, Fleet Daily, Fleet Week, Capstone and Leaderboard', () => {
    expect(BUILD_LINKS.map((l) => l.label)).toEqual(['Forge', 'Sims', 'Fleet', 'Fleet Daily', 'Fleet Week', 'Capstone', 'Leaderboard'])
    expect(BUILD_LINKS.map((l) => l.to)).toEqual(['/forge', '/lab', '/fleet', '/daily', '/week', '/capstone', '/leaderboard'])
  })

  test('the hamburger keeps what the tabs do not reach, and no primary destination twice', () => {
    const primary = new Set(DESTINATIONS.map((d) => d.to))
    expect(SECONDARY_LINKS.filter((l) => primary.has(l.to))).toEqual([])
    // every Build page is one tap away on a phone: the Build tab opens Forge, the rest are in the hamburger
    for (const l of BUILD_LINKS) expect(l.to === '/forge' || SECONDARY_LINKS.some((s) => s.to === l.to)).toBe(true)
    expect(SECONDARY_LINKS.map((l) => l.to)).toContain('/freshness')
    expect(SECONDARY_LINKS.map((l) => l.to)).toContain('/glossary')
    // Path gains Errors (wave-2.md §2.2): the Path tab opens the curriculum, so the Error Museum is a hamburger link
    expect(SECONDARY_LINKS.map((l) => l.to)).toContain('/errors')
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
      ['/play/scheduler', 'path'],
      ['/errors', 'path'],
      ['/forge', 'build'],
      ['/forge/rust-allocator', 'build'],
      ['/lab', 'build'],
      ['/lab/memory-grid', 'build'],
      ['/fleet', 'build'],
      ['/daily', 'build'],
      ['/week', 'build'],
      ['/capstone', 'build'],
      ['/leaderboard', 'build'],
      ['/me', 'me'],
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

describe('the command palette page list', () => {
  // STATIC_ITEMS is not exported (a component file exports components only), so the test reads the source.
  const palette = readFileSync(join(src, 'components/CommandPalette.tsx'), 'utf8')
  const block = palette.slice(palette.indexOf('const STATIC_ITEMS'), palette.indexOf('...TRACKS.map'))
  const pages = [...block.matchAll(/group: 'Pages'[^}]*?to: '([^']+)'/g)].map((m) => m[1])

  test('lists Today, Boot, Fleet Daily and the Error Museum, with Wave 1\'s pages', () => {
    for (const to of ['/today', '/boot', '/daily', '/errors', '/', '/curriculum', '/forge', '/fleet', '/week', '/me']) {
      expect(pages).toContain(to)
    }
  })

  test('every Build link and the Errors link has a palette row, and no row is listed twice', () => {
    for (const l of [...BUILD_LINKS, { to: '/errors' }]) expect(pages).toContain(l.to)
    expect(new Set(pages).size).toBe(pages.length)
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

  test('Curriculum shows the ring from the ledger, and no page computes a rank from XP', () => {
    const curriculum = readFileSync(join(src, 'pages/Curriculum.tsx'), 'utf8')
    expect(curriculum).toContain('selectRings(')
    const callers = (readdirSync(src, { recursive: true }) as string[])
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => join(src, f))
      .filter((f) => /rankForXp|nextRank|\bRANKS\b/.test(readFileSync(f, 'utf8')))
    expect(callers.map((f) => f.slice(src.length + 1))).toEqual([])
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
  // Me is the exception (wave-3.md §12.5, 3b-06): see the next describe.
  test('Home, Glossary, Lab, Changes and FleetWeek are routed through lazyMotion', () => {
    const app = readFileSync(join(src, 'App.tsx'), 'utf8')
    for (const page of ['Home', 'Glossary', 'Lab', 'Changes', 'FleetWeek']) {
      expect(app).toMatch(new RegExp(`const ${page} = lazyMotion\\(`))
    }
  })
})

describe('/me is plain lazy, and its motion sections scope themselves (wave-3.md §12.5, 3b-06)', () => {
  const meDir = join(src, 'pages/me')
  const sections = readdirSync(meDir).filter((f) => f.endsWith('.tsx'))

  test('App.tsx routes /me with plain lazy, never lazyMotion', () => {
    // lazyMotion loads src/lib/motion.tsx, and so framer-motion, beside the page, where verify-bundle's closure does not look
    const app = readFileSync(join(src, 'App.tsx'), 'utf8')
    expect(app).toMatch(/const Me = lazy\(\(\) => import\('@\/pages\/Me'\)\)/)
    expect(app).not.toMatch(/const Me = lazyMotion\(/)
  })

  test('Progress.tsx is gone and nothing imports it', () => {
    expect(existsSync(join(src, 'pages/Progress.tsx'))).toBe(false)
    const importers = (readdirSync(src, { recursive: true }) as string[])
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /from '(@\/pages\/Progress|(\.\.?\/)+(pages\/)?Progress)'/.test(readFileSync(join(src, f), 'utf8')))
    expect(importers).toEqual([])
    expect(sections).toEqual(expect.arrayContaining(['DataOwnership.tsx', 'Journey.tsx']))
  })

  test("Me.tsx's static closure reaches neither framer-motion, src/lib/motion nor lesson content, and lazy-loads its sections", () => {
    const graph = staticGraph('src/pages/Me.tsx')
    expect(graph.packages).not.toContain('framer-motion')
    expect(graph.files).not.toContain('src/lib/motion.tsx')
    expect(graph.files.filter((f) => f.startsWith('src/data/lessons'))).toEqual([])
    const me = readFileSync(join(src, 'pages/Me.tsx'), 'utf8')
    for (const name of ['Journey', 'DataOwnership']) expect(me).toContain(`const ${name} = lazy(() => import('@/pages/me/${name}'))`)
  })

  test('no /me module reaches src/data/lessons, the 394 KB gzip chunk Progress pulled for one count', () => {
    for (const entry of ['src/pages/Me.tsx', ...sections.map((f) => `src/pages/me/${f}`)]) {
      expect(staticGraph(entry).files.filter((f) => f.startsWith('src/data/lessons'))).toEqual([])
    }
  })

  test('every /me section that imports framer-motion renders inside MotionScope', () => {
    for (const f of sections) {
      const text = readFileSync(join(meDir, f), 'utf8')
      if (!/from 'framer-motion'/.test(text)) continue
      expect(text, f).toContain("import { MotionScope } from '@/lib/motion'")
      expect(text, f).toMatch(/<MotionScope>[\s\S]*<\/MotionScope>/)
    }
    // the sections that exist today use framer-motion, so the check above is not vacuous
    expect(readFileSync(join(meDir, 'Journey.tsx'), 'utf8')).toContain("from 'framer-motion'")
    expect(readFileSync(join(meDir, 'DataOwnership.tsx'), 'utf8')).toContain("from 'framer-motion'")
  })
})
