/**
 * verify-plays: the canvas-mirror check of docs/specs/wave-1.md §10.5 and the play checks of §11.5.
 *
 * Canvas mirrors. Every file in src/components/sims that renders a `<canvas>` must either render
 * `<SimMirror` or carry the waiver comment on a line of its own:
 *
 *   // a11y-mirror-pending: wave 2
 *
 * The waiver lives in the sim's own file so each task removes its own. A file that renders a mirror and
 * still carries the waiver fails (a stale waiver hides the next regression). The waiver list is printed:
 * Wave 1 exits with six (BatchingSim, ContentionLab, MatrixBench, QuantizerSim, SchedulerLab, WgslSim).
 * Canvases outside src/components/sims are out of scope (the Lab gallery previews sit in an aria-hidden
 * wrapper; Home's two canvases are labelled role="img" previews).
 *
 * Plays. A play in src/data/plays.ts fails without a mirror component (src/components/play/<id>/Mirror.tsx,
 * rendered by its Play.tsx), a debrief (Debrief.tsx, rendered too), KCs that exist in the KC contract
 * (src/data/kc/ids.ts), a lesson that exists, a practice seed in band, or In-production claims that exist
 * (the card's rows and the play's `productionClaims` must name the same ids). Any `<View3D` outside
 * GATE_3D fails. The play's closure (the modules /play/<id> pulls in statically, with its KCs and claims)
 * is printed; `verify:bundle` prints the same route's gzip closure.
 *
 *   bun run verify:plays
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export const WAIVER = '// a11y-mirror-pending: wave 2'

export interface CanvasFinding {
  file: string
  canvases: number
  status: 'mirrored' | 'waived' | 'missing' | 'stale-waiver'
}

/** Source without comments, so a `<canvas>` or `<SimMirror` named in prose or a doc comment counts for nothing. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** One finding per file that renders a canvas. */
export function checkCanvasMirrors(files: readonly { file: string; text: string }[]): CanvasFinding[] {
  const out: CanvasFinding[] = []
  for (const { file, text } of files) {
    const code = stripComments(text)
    const canvases = (code.match(/<canvas[\s>/]/g) ?? []).length
    if (canvases === 0) continue
    const mirrored = /<SimMirror[\s>/]/.test(code)
    const waived = text.split('\n').some((line) => line.trim() === WAIVER)
    const status = mirrored ? (waived ? 'stale-waiver' : 'mirrored') : waived ? 'waived' : 'missing'
    out.push({ file, canvases, status })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Play checks (§11.5)                                                  */
/* ------------------------------------------------------------------ */

/** The only places a 3D view may render (PLAN-100X §5.4.0, the seven-test gate). */
export const GATE_3D: readonly string[] = ['tiling-cube', 'device-mesh']

/** Findings for every `<View3D` in the files: no `id`, or an id outside the gate. */
export function checkView3D(files: readonly { file: string; text: string }[], gate: readonly string[] = GATE_3D): string[] {
  const out: string[] = []
  for (const { file, text } of files) {
    for (const m of stripComments(text).matchAll(/<View3D\b([^>]*)>?/g)) {
      const id = /\bid=(?:"([^"]+)"|'([^']+)'|\{\s*['"]([^'"]+)['"]\s*\})/.exec(m[1])
      const name = id?.[1] ?? id?.[2] ?? id?.[3]
      if (name === undefined) out.push(`${file}: <View3D> without an id: it must be one of ${gate.join(', ')}`)
      else if (!gate.includes(name)) out.push(`${file}: <View3D id="${name}"> is outside GATE_3D (${gate.join(', ')})`)
    }
  }
  return out
}

/** What the checks need to know about one play. */
export interface PlayFacts {
  id: string
  lessonId: string
  kcs: readonly string[]
  /** Claim ids the play's `productionClaims` lists. */
  productionClaims: readonly string[]
  /** Claim ids the In-production card's rows render. */
  cardClaims: readonly string[]
  /** Source of src/components/play/<id>/{Play,Mirror,Debrief}.tsx, or undefined when the file is missing. */
  play: string | undefined
  mirror: string | undefined
  debrief: string | undefined
  /** Whether the practice seed is in band (traces.ts). */
  practiceInBand: boolean
}

export interface PlayWorld {
  kcIds: ReadonlySet<string>
  claimIds: ReadonlySet<string>
  lessonIds: ReadonlySet<string>
}

/** Why a play fails the mechanical half of the seven-test gate (empty = it passes). */
export function checkPlay(p: PlayFacts, w: PlayWorld): string[] {
  const out: string[] = []
  const fail = (m: string) => out.push(`play ${p.id}: ${m}`)
  const renders = (src: string | undefined, tag: string) => src !== undefined && new RegExp(`<${tag}[\\s>/]`).test(stripComments(src))
  if (p.mirror === undefined) fail(`no mirror component (src/components/play/${p.id}/Mirror.tsx)`)
  else if (!renders(p.play, 'Mirror')) fail('Play.tsx never renders <Mirror>')
  if (p.debrief === undefined) fail(`no debrief component (src/components/play/${p.id}/Debrief.tsx)`)
  else if (!renders(p.play, 'Debrief')) fail('Play.tsx never renders <Debrief>')
  if (p.kcs.length === 0) fail('no KCs')
  for (const k of p.kcs) if (!w.kcIds.has(k)) fail(`KC ${k} is not in src/data/kc/ids.ts`)
  if (!w.lessonIds.has(p.lessonId)) fail(`lesson ${p.lessonId} does not exist`)
  if (p.productionClaims.length === 0) fail('no In-production claims')
  for (const c of p.productionClaims) if (!w.claimIds.has(c)) fail(`claim ${c} does not exist`)
  for (const c of p.cardClaims) if (!p.productionClaims.includes(c)) fail(`the In-production card renders ${c}, which productionClaims does not list`)
  for (const c of p.productionClaims) if (!p.cardClaims.includes(c)) fail(`productionClaims lists ${c}, which no In-production row renders`)
  if (!p.practiceInBand) fail('the practice seed is outside the band (traces.ts)')
  return out
}

/* ------------------------------------------------------------------ */
/* The module closure of a route's page                                */
/* ------------------------------------------------------------------ */

const EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx']

/** The file an import specifier names inside src, or null for a package. */
export function resolveImport(from: string, spec: string, srcDir: string): string | null {
  const base = spec.startsWith('@/') ? join(srcDir, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (base === null) return null
  for (const e of ['', ...EXTS]) {
    const f = base + e
    if (existsSync(f) && statSync(f).isFile()) return f
  }
  return null
}

export interface Closure {
  /** Repo-relative paths of the source files reached by static imports, entry first. */
  files: string[]
  /** Packages imported anywhere in it. */
  packages: string[]
  lines: number
}

/** Every file `entry` reaches by static `import` or `export … from` (type-only and dynamic imports are not followed). */
export function closureOf(entry: string, srcDir: string): Closure {
  const seen = new Set<string>()
  const packages = new Set<string>()
  const queue = [entry]
  let lines = 0
  while (queue.length > 0) {
    const f = queue.shift() as string
    if (seen.has(f)) continue
    seen.add(f)
    const text = readFileSync(f, 'utf8')
    lines += text.split('\n').length
    for (const m of stripComments(text).matchAll(/(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) {
      if (m[1]) continue
      const spec = m[2]
      const to = resolveImport(f, spec, srcDir)
      if (to) queue.push(to)
      else if (!spec.startsWith('.') && !spec.startsWith('@/')) packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
    }
  }
  return { files: [...seen].map((f) => relative(dirname(srcDir), f)), packages: [...packages].sort(), lines }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name)
    if (e.isDirectory()) walk(f, out)
    else if (/\.tsx?$/.test(e.name)) out.push(f)
  }
  return out
}

async function checkPlays(failures: string[]): Promise<void> {
  const root = join(import.meta.dir, '..')
  const srcDir = join(root, 'src')
  const { PLAYS, PRODUCTION_ROWS } = await import('../src/data/plays')
  const { KC } = await import('../src/data/kc/ids')
  const { CLAIMS } = await import('../src/data/claims')
  const { PLAY_PRACTICE_SEED, makePlacementTrace, checkPlacementBand } = await import('../src/lib/world/traces')
  const sources = walk(srcDir).map((f) => ({ file: relative(root, f), text: readFileSync(f, 'utf8') }))
  const lessonIds = new Set<string>()
  for (const { file, text } of sources) {
    if (!file.startsWith('src/data/lessons/')) continue
    const m = /^ {2}id: '([^']+)'/m.exec(text)
    if (m) lessonIds.add(m[1])
  }
  const world: PlayWorld = { kcIds: new Set<string>(Object.values(KC)), claimIds: new Set(CLAIMS.map((c) => c.id)), lessonIds }
  const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : undefined)

  console.log(`verify-plays: plays: ${Object.keys(PLAYS).length}`)
  for (const def of Object.values(PLAYS)) {
    const dir = join(srcDir, 'components', 'play', def.id)
    const facts: PlayFacts = {
      id: def.id,
      lessonId: def.lessonId,
      kcs: def.kcs,
      productionClaims: def.productionClaims,
      cardClaims: PRODUCTION_ROWS.map((r) => r.claim),
      play: read(join(dir, 'Play.tsx')),
      mirror: read(join(dir, 'Mirror.tsx')),
      debrief: read(join(dir, 'Debrief.tsx')),
      practiceInBand: def.id !== 'block-placement' || checkPlacementBand(makePlacementTrace(PLAY_PRACTICE_SEED)).inBand,
    }
    failures.push(...checkPlay(facts, world))
    const c = closureOf(join(srcDir, 'pages', 'Play.tsx'), srcDir)
    const own = c.files.filter((f) => f.startsWith(`src/components/play/${def.id}/`) || f === 'src/data/plays.ts' || f === 'src/pages/Play.tsx')
    console.log(`  play ${def.id} (${def.lessonId}, ${def.minutes} min)`)
    console.log(`    mirror ${facts.mirror ? 'yes' : 'NO'}, debrief ${facts.debrief ? 'yes' : 'NO'}`)
    console.log(`    KCs ${def.kcs.join(', ')}`)
    console.log(`    claims ${def.productionClaims.join(', ')}`)
    console.log(`    closure of /play/${def.id}: ${c.files.length} source modules, ${c.lines} lines, ${c.packages.length} packages (static imports from src/pages/Play.tsx)`)
    console.log(`      the play's own: ${own.join(', ')}`)
    console.log(`      packages: ${c.packages.join(', ')}`)
  }

  const bad3d = checkView3D(sources)
  failures.push(...bad3d)
  console.log(`verify-plays: View3D: ${bad3d.length === 0 ? 'none outside GATE_3D' : `${bad3d.length} outside GATE_3D`}`)
}

async function main(): Promise<void> {
  const dir = join(import.meta.dir, '..', 'src', 'components', 'sims')
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .sort()
    .map((f) => ({ file: `src/components/sims/${f}`, text: readFileSync(join(dir, f), 'utf8') }))
  const findings = checkCanvasMirrors(files)
  const failures: string[] = []

  for (const f of findings) {
    if (f.status === 'missing') failures.push(`${f.file}: renders <canvas> with no <SimMirror> and no "${WAIVER}" comment`)
    if (f.status === 'stale-waiver') failures.push(`${f.file}: renders <SimMirror> but still carries "${WAIVER}"; remove the waiver`)
  }

  const waived = findings.filter((f) => f.status === 'waived')
  const mirrored = findings.filter((f) => f.status === 'mirrored')
  console.log(`verify-plays: canvas mirrors: ${findings.length} sims render a canvas; ${mirrored.length} mirrored, ${waived.length} waived`)
  for (const f of mirrored) console.log(`  mirrored  ${f.file}`)
  for (const f of waived) console.log(`  waived    ${f.file}`)

  await checkPlays(failures)

  if (failures.length > 0) {
    for (const m of failures) console.error(`verify-plays: ${m}`)
    process.exit(1)
  }
  console.log('verify-plays: ok')
}

if (import.meta.main) await main()
