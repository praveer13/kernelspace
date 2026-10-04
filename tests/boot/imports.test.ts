import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/**
 * Spec §12.4: Boot must not statically import the lessons, the sims, a chart library, three or the
 * ledger engine. The bundle gate measures size; this test names the cause when someone adds one.
 * Dynamic `import()` calls are not followed, matching how the budget counts.
 */
const root = resolve(import.meta.dir, '../..')
const src = join(root, 'src')

const FORBIDDEN_PATHS = [/^src\/data\/lessons(\/|\.)/, /^src\/components\/sims\//, /^src\/lib\/ledger\/engine\.tsx?$/]
const FORBIDDEN_PACKAGES = [/^recharts$/, /^three($|\/)/, /^@react-three\//, /^d3($|-)/]

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm

function resolveSpecifier(spec: string, from: string): string | null {
  const base = spec.startsWith('@/') ? join(src, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (base === null) return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate
  }
  throw new Error(`cannot resolve ${spec} from ${relative(root, from)}`)
}

function staticGraph(entries: string[]): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const visit = (file: string) => {
    if (files.has(file)) return
    files.add(file)
    for (const m of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      const next = resolveSpecifier(m[1], file)
      if (next) visit(next)
      else if (!m[1].startsWith('.')) packages.add(m[1])
    }
  }
  entries.forEach((e) => visit(join(root, e)))
  return { files, packages }
}

describe('Boot static imports', () => {
  for (const [name, entries] of [
    ['first load (Boot.tsx)', ['src/pages/Boot.tsx']],
    ['later steps (later.ts)', ['src/pages/boot/later.ts']],
  ] as const) {
    test(`${name} reaches no lessons, sims, charts, three or ledger engine`, () => {
      const { files, packages } = staticGraph([...entries])
      expect(files.size).toBeGreaterThan(5)
      const paths = [...files].map((f) => relative(root, f))
      expect(paths.filter((p) => FORBIDDEN_PATHS.some((re) => re.test(p)))).toEqual([])
      expect([...packages].filter((p) => FORBIDDEN_PACKAGES.some((re) => re.test(p)))).toEqual([])
    })
  }

  test('the walker sees through to the ledger façade, and stops at the lazy engine', () => {
    const { files } = staticGraph(['src/pages/Boot.tsx'])
    const paths = [...files].map((f) => relative(root, f))
    expect(paths).toContain('src/lib/progress.ts')
    expect(paths).toContain('src/lib/boot/model.ts')
    expect(paths).not.toContain('src/lib/ledger/engine.ts')
  })

  test('the later steps are only reachable through the dynamic import', () => {
    const { files } = staticGraph(['src/pages/Boot.tsx'])
    const paths = [...files].map((f) => relative(root, f))
    for (const later of ['Roofline', 'Catch', 'Reveal', 'You']) expect(paths).not.toContain(`src/pages/boot/${later}.tsx`)
  })
})
