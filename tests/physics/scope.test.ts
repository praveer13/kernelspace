/**
 * Where the physics may run (docs/specs/s5.md §8.4, §8.1, S5-D50; invariants I5 and I6, S5-02).
 *
 *  - Everything under src/lib/world/ is inside the numeric Math ban (verify-determinism), and so is src/lib/fleet-*.ts
 *    from S5 on, so the physics and the engine it sits beside stay bit-identical across browsers.
 *  - The entry chunk, /boot, /today, /daily, the scheduler play and `sig` add 0 B: none of their static import graphs
 *    reaches a file under src/lib/world/physics/. Dynamic `import()` is not followed, matching how the bundle counts.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { scopeOf } from '../../scripts/verify-determinism'

const REPO = resolve(import.meta.dir, '../..')
const PHYSICS = 'src/lib/world/physics/'

/* ------------------------------ the static-import walker ------------------------------ */

const ASSET = /\.(css|svg|png|jpe?g|webp|woff2?|json)$/
// `import type` is erased, so it is not an edge; `import { type X }` still is (the specifier stays), like the bundle's view
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm

/** The files an entry reaches through static imports and re-exports, repo-relative. */
function staticFiles(root: string, entries: readonly string[]): Set<string> {
  const src = join(root, 'src')
  const seen = new Set<string>()
  const resolveSpecifier = (spec: string, from: string): string | null => {
    const base = spec.startsWith('@/') ? join(src, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
    if (base === null) return null
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
      if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate
    }
    throw new Error(`cannot resolve ${spec} from ${relative(root, from)}`)
  }
  const visit = (file: string): void => {
    if (seen.has(file)) return
    seen.add(file)
    for (const m of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      // `?worker&url` and other Vite query imports yield a URL or a string, not the module's graph
      if (ASSET.test(m[1]) || m[1].includes('?')) continue
      const next = resolveSpecifier(m[1], file)
      if (next) visit(next)
    }
  }
  for (const e of entries) visit(join(root, e))
  return new Set([...seen].map((f) => relative(root, f)))
}

/* ------------------------------ scope ------------------------------ */

describe('the determinism scope (verify-determinism\'s scopeOf)', () => {
  test('importing the script runs nothing: scopeOf is a plain export', () => {
    expect(typeof scopeOf).toBe('function')
  })

  test('every file under src/lib/world/physics/ is numeric, so the card has no exp, log, pow, trigonometry, cbrt or hypot', () => {
    for (const f of ['card.ts', 'types.ts', 'engine-v2.ts', 'client.ts', 'box.ts', 'replay.ts', 'fit.ts', 'table.ts', 'consumers.ts', 'decide.ts']) {
      expect(scopeOf(`${PHYSICS}${f}`)).toEqual({ numeric: true })
    }
  })

  test('the physics files that exist are in scope', () => {
    const dir = join(REPO, PHYSICS)
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f))
    expect(files).toContain('card.ts')
    expect(files).toContain('types.ts')
    for (const f of files) expect(scopeOf(`${PHYSICS}${f}`)?.numeric).toBe(true)
  })

  test('src/lib/fleet-*.ts is numeric (S5-D20), and every such file in the repo is', () => {
    const fleet = readdirSync(join(REPO, 'src/lib')).filter((f) => /^fleet-.*\.tsx?$/.test(f))
    expect(fleet).toContain('fleet-model.ts')
    expect(fleet.length).toBeGreaterThan(3)
    for (const f of fleet) expect(scopeOf(`src/lib/${f}`)).toEqual({ numeric: true })
  })

  test('the neighbours keep their scope: the learner planners are lint-only, rng and the UI are out', () => {
    expect(scopeOf('src/lib/learner/composer.ts')).toEqual({ numeric: false })
    expect(scopeOf('src/lib/items/core.ts')).toEqual({ numeric: false })
    expect(scopeOf('src/lib/items/families/step.ts')).toEqual({ numeric: true })
    expect(scopeOf('src/lib/world/fleet-ex/frontier.ts')).toEqual({ numeric: true })
    expect(scopeOf('src/components/fleet-ex/FleetExercise.tsx')).toBeNull()
    expect(scopeOf('src/lib/world/physics/notes.md')).toBeNull()
    expect(scopeOf('src/lib/world/physics/types.d.ts')).toBeNull()
  })
})

/* ------------------------------ the walks ------------------------------ */

describe('no first-load surface reaches the physics (I5, S5-D50)', () => {
  const WALKS: readonly (readonly [string, string, string])[] = [
    ['the entry chunk', 'src/main.tsx', 'src/App.tsx'],
    ['/boot', 'src/pages/Boot.tsx', 'src/lib/boot/model.ts'],
    ['/today', 'src/pages/Today.tsx', 'src/lib/progress.ts'],
    ['/daily', 'src/pages/Daily.tsx', 'src/lib/world/daily.ts'],
    ['/play/scheduler', 'src/components/play/scheduler/Play.tsx', 'src/lib/world/sched.ts'],
    ['the sig family', 'src/lib/items/families/sig.ts', 'src/lib/items/core.ts'],
  ]

  for (const [name, entry, sentinel] of WALKS) {
    test(`${name} (${entry}) reaches no file under ${PHYSICS}`, () => {
      const files = staticFiles(REPO, [entry])
      // the walk really walked: it saw the entry and a file the page is known to need
      expect(files.has(entry)).toBe(true)
      expect(files.has(sentinel)).toBe(true)
      expect([...files].filter((f) => f.startsWith(PHYSICS))).toEqual([])
    })
  }

  test('the six walks are the six surfaces the spec names', () => {
    expect(WALKS.map((w) => w[1])).toEqual([
      'src/main.tsx',
      'src/pages/Boot.tsx',
      'src/pages/Today.tsx',
      'src/pages/Daily.tsx',
      'src/components/play/scheduler/Play.tsx',
      'src/lib/items/families/sig.ts',
    ])
  })
})

describe('the walker finds what it should', () => {
  const dirs: string[] = []
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })

  /** A throwaway repo root with `src/` holding the given files. */
  function fakeRoot(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 's5-scope-'))
    dirs.push(root)
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      writeFileSync(join(root, rel), text)
    }
    return root
  }

  const files = {
    'src/lib/world/physics/card.ts': 'export const card = 1\n',
    'src/lib/world/physics/types.ts': 'export interface T { a: 1 }\n',
    'src/lib/a.ts': "import { card } from '@/lib/world/physics/card'\nexport const a = card\n",
    'src/lib/b.ts': "export * from './world/physics/card'\n",
    'src/lib/c.ts': "import type { T } from '@/lib/world/physics/types'\nexport type C = T\n",
    'src/lib/d.ts': "export const d = () => import('./world/physics/card')\n",
    'src/lib/e.ts': "import { a } from './a'\nexport const e = a\n",
    'src/lib/f.ts': "import {\n  card,\n} from './world/physics/card'\nexport const f = card\n",
    'src/lib/g.ts': "import { type T, card } from './world/physics/types'\nexport const g = card\n",
    'src/lib/world/physics/index.ts': 'export {}\n',
    'src/lib/h.ts': "import './world/physics'\n",
  }
  const root = fakeRoot(files)
  const reaches = (entry: string): boolean => [...staticFiles(root, [entry])].some((f) => f.startsWith(PHYSICS))

  test('a static import, a re-export, a multi-line import and a transitive import each reach the physics', () => {
    for (const entry of ['src/lib/a.ts', 'src/lib/b.ts', 'src/lib/e.ts', 'src/lib/f.ts', 'src/lib/g.ts', 'src/lib/h.ts']) {
      expect({ entry, reaches: reaches(entry) }).toEqual({ entry, reaches: true })
    }
  })

  test('a type-only import (erased) and a dynamic import() do not', () => {
    for (const entry of ['src/lib/c.ts', 'src/lib/d.ts']) expect({ entry, reaches: reaches(entry) }).toEqual({ entry, reaches: false })
  })

  test('an unresolvable relative import is an error, not a silent miss', () => {
    const bad = fakeRoot({ 'src/x.ts': "import { y } from './nope'\n" })
    expect(() => staticFiles(bad, ['src/x.ts'])).toThrow('cannot resolve ./nope')
  })
})
