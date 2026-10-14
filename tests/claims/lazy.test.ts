import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { byId, CLAIMS, getClaim, type Claim } from '@/data/claims'
import * as everything from '@/data/claims/all'
import { ENGINE_CLAIMS } from '@/data/claims/engines'
import { HARDWARE_CLAIMS } from '@/data/claims/hardware'
import { LAZY_GROUP_HOMES, lazyGroupFor } from '@/data/claims/homes'
import { MOE_CLAIMS } from '@/data/claims/lazy/moe'
import { SERVING3_CLAIMS } from '@/data/claims/lazy/serving3'
import { TILING_CLAIMS } from '@/data/claims/lazy/tiling'
import { TWIN_CLAIMS } from '@/data/claims/lazy/twins'
import { MODEL_CLAIMS } from '@/data/claims/models'
import { PRICE_CLAIMS } from '@/data/claims/prices'
import { PRODUCTION_CLAIMS } from '@/data/claims/production'
import { registerClaims } from '@/data/claims/registry'
import { SERVING_CLAIMS } from '@/data/claims/serving'
import { ZOO_CLAIMS } from '@/data/claims/zoo'

/**
 * Spec wave-3 §4.4 (D19): a lazy claim group registers when its module is imported, the full registry for tooling
 * (`all.ts`) imports every one, and nothing /boot or /today reaches imports a group, so the claims chunk those routes
 * load does not grow. The import walk is the one of tests/boot/imports.test.ts: static imports only, `import()` not followed.
 */
const root = resolve(import.meta.dir, '../..')
const src = join(root, 'src')
const LAZY_DIR = join(src, 'data/claims/lazy')

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

/** Every source file the entries reach through static imports, as absolute paths. */
function staticFiles(entries: string[]): Set<string> {
  const files = new Set<string>()
  const visit = (file: string) => {
    if (files.has(file)) return
    files.add(file)
    for (const m of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      if (ASSET.test(m[1]) || m[1].includes('?')) continue
      const next = resolveSpecifier(m[1], file)
      if (next) visit(next)
    }
  }
  entries.forEach((e) => visit(e.startsWith('/') ? e : join(root, e)))
  return files
}

const lazyFiles = () => (existsSync(LAZY_DIR) ? readdirSync(LAZY_DIR).filter((f) => /\.tsx?$/.test(f)).map((f) => join(LAZY_DIR, f)) : [])
const inLazy = (files: Set<string>) => [...files].filter((f) => f.startsWith(`${LAZY_DIR}/`)).map((f) => relative(root, f))

const fixture = (id: string, value: number | string = 1): Claim => ({
  id,
  label: `fixture ${id}`,
  value,
  kind: 'synthetic',
  verifiedAt: '2026-10-01',
  ttlDays: 90,
})

// The registry is the process's, shared with every other test file, so each test removes what it registered.
const added: string[] = []
afterEach(() => {
  for (const id of added.splice(0)) {
    const at = CLAIMS.findIndex((c) => c.id === id)
    if (at >= 0) CLAIMS.splice(at, 1)
    delete byId[id]
  }
  for (const prefix of Object.keys(LAZY_GROUP_HOMES)) if (prefix.startsWith('fixture.')) delete LAZY_GROUP_HOMES[prefix]
})
const register = (list: Claim[]) => {
  added.push(...list.map((c) => c.id))
  registerClaims(list)
}

describe('registerClaims', () => {
  test('a registered group is readable through getClaim, byId and CLAIMS', () => {
    const before = CLAIMS.length
    register([fixture('fixture.lazy.one'), fixture('fixture.lazy.two', 2)])
    expect(getClaim('fixture.lazy.two').value).toBe(2)
    expect(byId['fixture.lazy.one']?.label).toBe('fixture fixture.lazy.one')
    expect(CLAIMS.length).toBe(before + 2)
  })

  test('registering the same group again changes nothing', () => {
    const group = [fixture('fixture.lazy.same'), fixture('fixture.lazy.same-b')]
    register(group)
    const size = CLAIMS.length
    const held = getClaim('fixture.lazy.same')
    registerClaims(group)
    registerClaims(group.map((c) => ({ ...c })))
    expect(CLAIMS.length).toBe(size)
    expect(getClaim('fixture.lazy.same')).toBe(held)
  })

  test('the same body written with its keys in another order is the same body', () => {
    const claim: Claim = { ...fixture('fixture.lazy.order'), source: { url: 'https://example.com/a', title: 'A', quote: 'q' } }
    register([claim])
    const size = CLAIMS.length
    registerClaims([{ source: { quote: 'q', title: 'A', url: 'https://example.com/a' }, ttlDays: 90, verifiedAt: '2026-10-01', kind: 'synthetic', value: 1, label: claim.label, id: claim.id }])
    expect(CLAIMS.length).toBe(size)
  })

  test('a duplicate id with a different body throws and keeps the first', () => {
    register([fixture('fixture.lazy.clash', 1)])
    expect(() => registerClaims([fixture('fixture.lazy.clash', 2)])).toThrow(/fixture\.lazy\.clash.*different bodies/)
    expect(getClaim('fixture.lazy.clash').value).toBe(1)
  })

  test('a clash with an eager claim throws too', () => {
    const eager = CLAIMS[0]
    expect(() => registerClaims([{ ...eager, label: `${eager.label} (edited)` }])).toThrow(/different bodies/)
    expect(getClaim(eager.id)).toBe(eager)
  })

  test('a clash in the middle of a group leaves the claims before it registered, as the throw says', () => {
    register([fixture('fixture.lazy.mid-a')])
    expect(() => registerClaims([fixture('fixture.lazy.mid-b'), fixture('fixture.lazy.mid-a', 9)])).toThrow(/mid-a/)
    added.push('fixture.lazy.mid-b')
    expect(getClaim('fixture.lazy.mid-a').value).toBe(1)
  })
})

describe('getClaim on an unknown id', () => {
  test('throws with the id', () => {
    expect(() => getClaim('fixture.nothing.here')).toThrow('unknown claim id: fixture.nothing.here')
  })

  test('points at the homes table, and the table names the group to import', () => {
    expect(() => getClaim('fixture.unregistered')).toThrow(/fixture\.unregistered.*claims\/homes\.ts/)
    LAZY_GROUP_HOMES['fixture.tiling.'] = 'lazy/tiling'
    LAZY_GROUP_HOMES['fixture.tiling.fp8.'] = 'lazy/fp8'
    expect(lazyGroupFor('fixture.tiling.tile-m')).toBe('lazy/tiling')
    expect(lazyGroupFor('fixture.tiling.fp8.scale')).toBe('lazy/fp8')
    expect(lazyGroupFor('fixture.other.x')).toBeUndefined()
  })

  test('an inherited property name is unknown, not a claim', () => {
    expect(() => getClaim('constructor')).toThrow('unknown claim id')
  })
})

describe('the full registry (all.ts)', () => {
  test('imports every file under lazy/', () => {
    const reached = staticFiles(['src/data/claims/all.ts'])
    for (const file of lazyFiles()) expect(reached.has(file)).toBe(true)
  })

  test('is the eager registry, live, so a group that registers on import shows in it', () => {
    expect(everything.CLAIMS).toBe(CLAIMS)
    expect(everything.byId).toBe(byId)
    expect(everything.getClaim).toBe(getClaim)
    expect(everything.registerClaims).toBe(registerClaims)
    expect(everything.lazyGroupFor).toBe(lazyGroupFor)
    register([fixture('fixture.lazy.live')])
    expect(everything.CLAIMS.some((c) => c.id === 'fixture.lazy.live')).toBe(true)
  })

  test('every claim outside the eager groups is homed in LAZY_GROUP_HOMES, at a file that exists', () => {
    const eager = new Set([...HARDWARE_CLAIMS, ...MODEL_CLAIMS, ...PRICE_CLAIMS, ...PRODUCTION_CLAIMS, ...ENGINE_CLAIMS, ...SERVING_CLAIMS, ...ZOO_CLAIMS].map((c) => c.id))
    for (const claim of CLAIMS) {
      if (eager.has(claim.id)) continue
      const home = lazyGroupFor(claim.id)
      expect(`${claim.id}: ${home}`).not.toBe(`${claim.id}: undefined`)
      expect(existsSync(join(src, 'data/claims', `${home}.ts`))).toBe(true)
    }
    for (const home of Object.values(LAZY_GROUP_HOMES)) expect(existsSync(join(src, 'data/claims', `${home}.ts`))).toBe(true)
  })

  test('ALL_CLAIMS is the registry in one order: the eager groups as CLAIMS lists them, then the lazy groups as all.ts imports them', () => {
    const ids = (list: readonly Claim[]) => list.map((c) => c.id)
    const eager = [...HARDWARE_CLAIMS, ...MODEL_CLAIMS, ...PRICE_CLAIMS, ...PRODUCTION_CLAIMS, ...ENGINE_CLAIMS, ...SERVING_CLAIMS, ...ZOO_CLAIMS]
    const held = new Set(ids(eager))
    // a claim an earlier group holds is skipped, as registerClaims skips it
    const lazy = ids([...MOE_CLAIMS, ...SERVING3_CLAIMS, ...TILING_CLAIMS, ...TWIN_CLAIMS]).filter((id, i, all) => all.indexOf(id) === i && !held.has(id))
    expect(ids(everything.ALL_CLAIMS.slice(0, eager.length))).toEqual(ids(CLAIMS.slice(0, eager.length)))
    expect(ids(everything.ALL_CLAIMS.slice(eager.length))).toEqual(lazy)
    // a group imported by all.ts but left out of ALL_CLAIMS registers into CLAIMS, so the two sets differ
    expect(new Set(ids(everything.ALL_CLAIMS))).toEqual(new Set(ids(CLAIMS).filter((id) => !id.startsWith('fixture.'))))
  })
})

describe('the lazy boundary', () => {
  test('the walker finds a group imported by a file, and reads a missing import as an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lazy-walk-'))
    try {
      mkdirSync(join(dir, 'lazy'))
      writeFileSync(join(dir, 'lazy/group.ts'), 'export const G = 1\n')
      writeFileSync(join(dir, 'page.ts'), "import { G } from './lazy/group'\nexport const x = G\n")
      writeFileSync(join(dir, 'broken.ts'), "import './nowhere'\n")
      const reached = [...staticFiles([join(dir, 'page.ts')])]
      expect(reached).toContain(join(dir, 'lazy/group.ts'))
      expect(() => staticFiles([join(dir, 'broken.ts')])).toThrow(/cannot resolve/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  for (const entry of ['src/pages/Boot.tsx', 'src/pages/boot/later.ts', 'src/pages/Today.tsx', 'src/data/plays.ts']) {
    test(`${entry} reaches no lazy group, and not the full registry that imports them`, () => {
      const files = staticFiles([entry])
      expect(files.size).toBeGreaterThan(3)
      expect(inLazy(files)).toEqual([])
      expect([...files].map((f) => relative(root, f))).not.toContain('src/data/claims/all.ts')
    })
  }

  test('the registration and homes modules are outside the eager closure too, so the claims chunk does not grow', () => {
    for (const entry of ['src/pages/Boot.tsx', 'src/pages/Today.tsx']) {
      const reached = [...staticFiles([entry])].map((f) => relative(root, f))
      expect(reached).not.toContain('src/data/claims/registry.ts')
      expect(reached).not.toContain('src/data/claims/homes.ts')
    }
  })

  test('the routes load the eager registry, so the walk is looking at the right graph', () => {
    for (const entry of ['src/pages/Boot.tsx', 'src/pages/Today.tsx']) {
      expect([...staticFiles([entry])].map((f) => relative(root, f))).toContain('src/data/claims/index.ts')
    }
  })
})
