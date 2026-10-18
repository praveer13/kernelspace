import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/**
 * Spec §12.4: Boot must not statically import the lessons, the sims, a chart library, three or the
 * ledger engine. Spec §6.9 (B2): no module in the entry chunk imports framer-motion or fuse.js, and
 * every lazy page that reaches framer-motion runs inside MotionScope. The bundle gate measures size;
 * this test names the cause when someone adds one.
 * Dynamic `import()` calls are not followed, matching how the budget counts.
 */
const root = resolve(import.meta.dir, '../..')
const src = join(root, 'src')

const FORBIDDEN_PATHS = [/^src\/data\/lessons(\/|\.)/, /^src\/components\/sims\//, /^src\/lib\/ledger\/engine\.tsx?$/]
const FORBIDDEN_PACKAGES = [/^recharts$/, /^three($|\/)/, /^@react-three\//, /^d3($|-)/]

const ASSET = /\.(css|svg|png|jpe?g|webp|woff2?|json)$/

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
      // `?worker&url` and other Vite query imports yield a URL or string, not the module's graph
      if (ASSET.test(m[1]) || m[1].includes('?')) continue
      const next = resolveSpecifier(m[1], file)
      if (next) visit(next)
      else if (!m[1].startsWith('.') && !m[1].startsWith('@/')) packages.add(m[1])
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

  // 3c-05 had Boot's last step and /me read the pick from the align and grading module (1.0 KB gzip); it lives in learner/background.ts
  test('the work pick is read without the align and grading module, in Boot\'s last step and on /me', () => {
    for (const entry of ['src/pages/boot/You.tsx', 'src/pages/Me.tsx', 'src/pages/me/Background.tsx']) {
      const paths = [...staticGraph([entry]).files].map((f) => relative(root, f))
      expect(paths).toContain('src/lib/learner/background.ts')
      expect(paths).not.toContain('src/lib/learner/iso.ts')
    }
  })

  test('the later steps are only reachable through the dynamic import', () => {
    const { files } = staticGraph(['src/pages/Boot.tsx'])
    const paths = [...files].map((f) => relative(root, f))
    for (const later of ['Roofline', 'Catch', 'Reveal', 'You']) expect(paths).not.toContain(`src/pages/boot/${later}.tsx`)
  })
})

/**
 * Spec §16.1 (3s-01): the cube's 3D scene is one lazy chunk, three and R3F with it, that View3D imports on a learner's
 * request. So no page's static graph may reach three, R3F or the scene: not /today, /boot, /me, nor /play/tiling-cube with
 * its play (the registry and View3D load their targets with `import()`, which the walker does not follow).
 */
describe('Three stays out of every first load', () => {
  const SCENE = 'src/components/play/tiling-cube/Cube3D.tsx'
  const THREE_PACKAGES = [/^three($|\/)/, /^@react-three\//]
  const PAGES = [
    ['/today', ['src/pages/Today.tsx']],
    ['/boot', ['src/pages/Boot.tsx', 'src/pages/boot/later.ts']],
    ['/me', ['src/pages/Me.tsx']],
    ['/play/tiling-cube (the page)', ['src/pages/Play.tsx']],
    ['/play/tiling-cube (the play)', ['src/components/play/tiling-cube/Play.tsx']],
    ['the entry chunk', ['src/main.tsx']],
  ] as const

  for (const [route, entries] of PAGES) {
    test(`${route} reaches no three, no R3F and not the scene`, () => {
      const { files, packages } = staticGraph([...entries])
      expect(files.size).toBeGreaterThan(3)
      expect([...packages].filter((p) => THREE_PACKAGES.some((re) => re.test(p)))).toEqual([])
      expect([...files].map((f) => relative(root, f))).not.toContain(SCENE)
    })
  }

  test('the walker does see three where it is imported, and the play reaches View3D but only imports the scene', () => {
    const scene = staticGraph([SCENE])
    expect([...scene.packages]).toContain('three')
    expect([...scene.packages]).toContain('@react-three/fiber')
    const play = staticGraph(['src/components/play/tiling-cube/Play.tsx'])
    expect([...play.files].map((f) => relative(root, f))).toContain('src/components/three/View3D.tsx')
    expect(readFileSync(join(root, 'src/components/play/tiling-cube/Play.tsx'), 'utf8')).toContain("import('./Cube3D')")
  })

  test('View3D itself imports neither three nor R3F nor the scene', () => {
    const view = staticGraph(['src/components/three/View3D.tsx'])
    expect([...view.packages].filter((p) => THREE_PACKAGES.some((re) => re.test(p)))).toEqual([])
    expect([...view.files].map((f) => relative(root, f))).not.toContain(SCENE)
  })
})

describe('Entry chunk diet', () => {
  const entry = staticGraph(['src/main.tsx'])
  const entryPaths = [...entry.files].map((f) => relative(root, f))

  test('no entry module imports framer-motion or fuse.js', () => {
    expect([...entry.packages].filter((p) => p === 'framer-motion' || p === 'fuse.js' || p.startsWith('motion-'))).toEqual([])
  })

  test('the walker reaches the shell, and stops at the lazy palette, MotionScope and pages', () => {
    for (const shell of ['src/App.tsx', 'src/components/Layout.tsx', 'src/components/Navbar.tsx', 'src/components/StatusBar.tsx', 'src/components/ProgressRing.tsx', 'src/components/CommandPaletteHost.tsx']) {
      expect(entryPaths).toContain(shell)
    }
    for (const lazy of ['src/components/CommandPalette.tsx', 'src/lib/motion.tsx', 'src/pages/Home.tsx', 'src/pages/Boot.tsx']) {
      expect(entryPaths).not.toContain(lazy)
    }
  })

  test('the lazy palette is where fuse.js lives', () => {
    expect(staticGraph(['src/components/CommandPalette.tsx']).packages.has('fuse.js')).toBe(true)
  })

  test('every lazy page that reaches framer-motion is wrapped in MotionScope; Boot is not one', () => {
    const app = readFileSync(join(src, 'App.tsx'), 'utf8')
    const pages = [...app.matchAll(/const (\w+) = (lazy|lazyMotion)\(\(\) => import\('([^']+)'\)\)/g)]
    expect(pages.length).toBeGreaterThan(10)
    for (const [, name, wrapper, spec] of pages) {
      const reachesMotion = staticGraph([relative(root, resolveSpecifier(spec, join(src, 'App.tsx'))!)]).packages.has('framer-motion')
      if (reachesMotion) expect(`${name}:${wrapper}`).toBe(`${name}:lazyMotion`)
    }
    expect(pages.find((p) => p[1] === 'Boot')?.[2]).toBe('lazy')
  })
})
