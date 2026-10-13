/**
 * verify-plays: the canvas-mirror check of docs/specs/wave-1.md §10.5 (zero-waiver since wave-2.md §12.2) and the play
 * checks of §11.5.
 *
 * Canvas mirrors. Every file in src/components/sims and src/components/telemetry that renders a plotted element (a
 * `<canvas>`, or a telemetry `<Sparkline`) needs a mirror for each one: the element's `aria-describedby` (`describedBy`
 * on a Sparkline) must name the id of a `<SimMirror` in the same file. A file with N canvases needs N mirrored canvases:
 * one `<SimMirror` no longer satisfies a file with two. The Wave 1 waiver comment
 *
 *   // a11y-mirror-pending: wave 2
 *
 * is now an error wherever it appears in those files (a retired waiver hides the next regression), and the run prints
 * "0 waived". Canvases outside those two folders are out of scope (the Lab gallery previews sit in an aria-hidden
 * wrapper; Home's two canvases are labelled role="img" previews).
 *
 * Plays. A play in src/data/plays.ts fails without a mirror component (src/components/play/<id>/Mirror.tsx,
 * rendered by its Play.tsx), a debrief (Debrief.tsx, rendered too), KCs that exist in the KC contract
 * (src/data/kc/ids.ts), a lesson that exists, a practice trace the play can be played on, or In-production
 * claims that exist (the card's rows, read from the play's own entry in PLAY_PRODUCTION_ROWS, and the play's
 * `productionClaims` must name the same ids, and the card needs at least three rows: wave-2.md §8.5). Any
 * `<View3D` outside GATE_3D fails. The play's closure (the modules /play/<id> pulls in statically, with its KCs
 * and claims) is printed; `verify:bundle` prints the same route's gzip closure.
 *
 * Practice trace. Each play has its own check (`practiceBandOf`): block placement's seed must be in its band. The
 * scheduler's practice minute must be playable (rules 1 and 4 of wave-2.md §8.2: the reference serves 70 % of it
 * within the SLO in at most 50 turns). It cannot meet rules 2, 3 and 5 on the pinned BurstGPT source (the busiest
 * minute has no prompt over 692 tokens and 1 to 4 token responses; 2b-01 pinned this in
 * tests/world/sched-traces.test.ts), so those are printed, not failed.
 *
 *   bun run verify:plays
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/** The retired Wave 1 waiver: a scoped file that carries this marker anywhere is an error. */
export const WAIVER = '// a11y-mirror-pending: wave 2'
const WAIVER_MARKER = 'a11y-mirror-pending'

export interface CanvasFinding {
  file: string
  /** Plotted elements in the file: `<canvas` tags and `<Sparkline` uses. */
  canvases: number
  /** How many of them name a `<SimMirror` id of the same file in `aria-describedby` (`describedBy` on a Sparkline). */
  mirrored: number
  /** `mirrored`: every one is; `missing`: some are not; `waiver`: the retired waiver comment is present (an error whatever else is true). */
  status: 'mirrored' | 'missing' | 'waiver'
}

/** Source without comments, so a `<canvas` or `<SimMirror` named in prose or a doc comment counts for nothing. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** The source of the JSX tag that starts at `from` (after `<name`), up to its closing `>`: braces and quotes inside attributes are skipped. */
function tagText(code: string, from: number): string {
  let depth = 0
  let quote = ''
  for (let i = from; i < code.length; i++) {
    const c = code[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return code.slice(from, i)
  }
  return code.slice(from)
}

/** The value of attribute `name` in a tag's text, as written (`mirrorId` for `{mirrorId}`, `m` for `"m"`), or null when it is absent. */
function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)'|\\{\\s*([^}]*?)\\s*\\})`).exec(tag)
  return m ? (m[1] ?? m[2] ?? m[3]) : null
}

/** Every `<name` tag in the code, as its attribute text. */
function tagsOf(code: string, name: string): string[] {
  return [...code.matchAll(new RegExp(`<${name}(?=[\\s>/])`, 'g'))].map((m) => tagText(code, (m.index as number) + m[0].length))
}

/** One finding per file that renders a plotted element or carries the retired waiver. */
export function checkCanvasMirrors(files: readonly { file: string; text: string }[]): CanvasFinding[] {
  const out: CanvasFinding[] = []
  for (const { file, text } of files) {
    const code = stripComments(text)
    const mirrorIds = new Set(tagsOf(code, 'SimMirror').flatMap((t) => attrOf(t, 'id') ?? []))
    const plotted = [
      ...tagsOf(code, 'canvas').map((t) => attrOf(t, 'aria-describedby')),
      ...tagsOf(code, 'Sparkline').map((t) => attrOf(t, 'describedBy')),
    ]
    const waived = text.includes(WAIVER_MARKER)
    if (plotted.length === 0 && !waived) continue
    const mirrored = plotted.filter((id) => id !== null && mirrorIds.has(id)).length
    const status = waived ? 'waiver' : mirrored === plotted.length ? 'mirrored' : 'missing'
    out.push({ file, canvases: plotted.length, mirrored, status })
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
  /** Whether the play's practice trace passes its band check (`practiceBandOf`). */
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
  if (p.cardClaims.length < 3) fail(`the In-production card has ${p.cardClaims.length} rows and needs at least three (wave-2.md §8.5)`)
  if (!p.practiceInBand) fail('the practice trace is outside the band (practiceBandOf in scripts/verify-plays.ts)')
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

/** The practice-band check of one play: whether it passes, and the line that says why. */
export interface PracticeBand {
  inBand: boolean
  note: string
}

/** Runs a play's practice-band check, or returns null for a play that has none (a new play must bring its own). */
export async function practiceBandOf(id: string, root: string): Promise<PracticeBand | null> {
  if (id === 'block-placement') {
    const { PLAY_PRACTICE_SEED, makePlacementTrace, checkPlacementBand } = await import('../src/lib/world/traces')
    const band = checkPlacementBand(makePlacementTrace(PLAY_PRACTICE_SEED))
    return { inBand: band.inBand, note: `practice seed ${PLAY_PRACTICE_SEED} ${band.inBand ? 'is in band' : 'is outside the band'}` }
  }
  if (id === 'scheduler') {
    const { checkSchedBand, parseSchedSource, practiceMinute } = await import('../src/lib/world/sched-traces')
    const dir = join(root, 'public', 'traces')
    const source = await parseSchedSource(
      JSON.parse(readFileSync(join(dir, 'burstgpt-v2-busiest-minute.json'), 'utf8')),
      JSON.parse(readFileSync(join(dir, 'burstgpt-v2-busiest-hour.json'), 'utf8')),
    )
    const band = checkSchedBand(practiceMinute(source))
    const playable = band.rules[0] && band.rules[3]
    const missed = band.rules.flatMap((ok, i) => (ok ? [] : [i + 1]))
    const note =
      `practice minute: the reference serves ${band.ghost.met} of ${band.ghost.total} within the SLO in ${band.ghost.turns} turns (rules 1 and 4 ${playable ? 'hold' : 'FAIL'}); ` +
      (missed.length === 0 ? 'in band on all five rules' : `outside the §8.2 band on rule${missed.length === 1 ? '' : 's'} ${missed.join(', ')} (${band.violations.join('; ')})`)
    return { inBand: playable, note }
  }
  return null
}

async function checkPlays(failures: string[]): Promise<void> {
  const root = join(import.meta.dir, '..')
  const srcDir = join(root, 'src')
  const { PLAYS, PLAY_PRODUCTION_ROWS } = await import('../src/data/plays')
  const { KC } = await import('../src/data/kc/ids')
  const { CLAIMS } = await import('../src/data/claims')
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
    const band = await practiceBandOf(def.id, root)
    if (band === null) failures.push(`play ${def.id}: no practice-band check (add it to practiceBandOf in scripts/verify-plays.ts)`)
    const rows = PLAY_PRODUCTION_ROWS[def.id]
    if (rows === undefined) failures.push(`play ${def.id}: no In-production rows (add it to PLAY_PRODUCTION_ROWS in src/data/plays.ts)`)
    const facts: PlayFacts = {
      id: def.id,
      lessonId: def.lessonId,
      kcs: def.kcs,
      productionClaims: def.productionClaims,
      cardClaims: (rows ?? []).map((r) => r.claim),
      play: read(join(dir, 'Play.tsx')),
      mirror: read(join(dir, 'Mirror.tsx')),
      debrief: read(join(dir, 'Debrief.tsx')),
      practiceInBand: band?.inBand ?? false,
    }
    failures.push(...checkPlay(facts, world))
    // The page loads each play through the registry on demand, so the play's closure starts at the play itself.
    const c = closureOf(join(dir, 'Play.tsx'), srcDir)
    const own = c.files.filter((f) => f.startsWith(`src/components/play/${def.id}/`) || f === 'src/data/plays.ts')
    console.log(`  play ${def.id} (${def.lessonId}, ${def.minutes} min)`)
    console.log(`    mirror ${facts.mirror ? 'yes' : 'NO'}, debrief ${facts.debrief ? 'yes' : 'NO'}`)
    console.log(`    KCs ${def.kcs.join(', ')}`)
    console.log(`    claims ${def.productionClaims.join(', ')} (${facts.cardClaims.length} card rows)`)
    console.log(`    ${band?.note ?? 'no practice-band check'}`)
    console.log(`    closure of /play/${def.id}: ${c.files.length} source modules, ${c.lines} lines, ${c.packages.length} packages (static imports from the play's Play.tsx)`)
    console.log(`      the play's own: ${own.join(', ')}`)
    console.log(`      packages: ${c.packages.join(', ')}`)
  }

  const bad3d = checkView3D(sources)
  failures.push(...bad3d)
  console.log(`verify-plays: View3D: ${bad3d.length === 0 ? 'none outside GATE_3D' : `${bad3d.length} outside GATE_3D`}`)
}

/** The folders whose plotted elements need a mirror (wave-2.md §12.2). */
export const MIRROR_SCOPE: readonly string[] = ['src/components/sims', 'src/components/telemetry']

async function main(): Promise<void> {
  const root = join(import.meta.dir, '..')
  const files = MIRROR_SCOPE.flatMap((d) => walk(join(root, d)))
    .filter((f) => f.endsWith('.tsx'))
    .sort()
    .map((f) => ({ file: relative(root, f), text: readFileSync(f, 'utf8') }))
  const findings = checkCanvasMirrors(files)
  const failures: string[] = []

  for (const f of findings) {
    if (f.status === 'waiver') failures.push(`${f.file}: carries the retired waiver "${WAIVER}"; give every canvas a <SimMirror> and remove the comment`)
    else if (f.status === 'missing') failures.push(`${f.file}: ${f.mirrored} of ${f.canvases} plotted elements name a <SimMirror> id in aria-describedby; each canvas needs its own mirror`)
  }

  const waived = findings.filter((f) => f.status === 'waiver')
  const mirrored = findings.filter((f) => f.status === 'mirrored')
  const elements = findings.reduce((n, f) => n + f.canvases, 0)
  console.log(`verify-plays: canvas mirrors: ${findings.length} files render a canvas or sparkline (${elements} elements); ${mirrored.length} mirrored, ${waived.length} waived`)
  for (const f of findings) console.log(`  ${f.status === 'mirrored' ? 'mirrored' : f.status === 'waiver' ? 'waived  ' : 'MISSING '}  ${f.file} (${f.mirrored}/${f.canvases})`)

  await checkPlays(failures)

  if (failures.length > 0) {
    for (const m of failures) console.error(`verify-plays: ${m}`)
    process.exit(1)
  }
  console.log('verify-plays: ok')
}

if (import.meta.main) await main()
