/**
 * verify-bundle — bundle budget gates (PLAN-100X §7.3; docs/specs/ledger-v3.md §12.4, §15).
 *
 * Run after `npm run build`. Gzip-measures every dist/assets/*.js, finds the entry chunk from the
 * module script in dist/index.html, FAILS if it exceeds the entry budget, and prints the 10 largest
 * chunks. It then walks dist/.vite/manifest.json (`build.manifest`) to measure each gated route's
 * closure: the entry chunk, the route's chunk and their static imports, with every CSS file they
 * name. Dynamic imports (the ledger engine, other pages, lazy decoration) are not followed; the on-demand line
 * names them with their own static imports, so a lazy step counts what it really loads.
 * Which modules a route may not import is tests/boot/imports.test.ts's job; this gate measures bytes.
 * Wave 1 (docs/specs/wave-1.md §16.1): /boot and /today are gated at 200 KB with a tighter target, the
 * entry has a 125 KB target after the entry diet (B2), and the play closure, the generator family
 * chunks, the search index and the FSRS + cards + composer figure are reported. A route whose page file does not exist yet is skipped.
 * Wave 3 stretch (docs/specs/wave-3.md §16.1, §17.1) reports the three + R3F chunk against 240 KB and fails the cube's 3D
 * scene chunk above 40 KB (3s-01); which pages may reach three at all is tests/boot/imports.test.ts's job.
 * S5 (docs/specs/s5.md §8.1, S5-15) holds the entry at wave 3's 115.7 KB (S5-D50: +0 B, compared at 0.1 KB precision, and in raw bytes
 * beside it) and prints the v2 lines: the FleetExercise chunk, fleet.worker, the physics tab with the data and claim groups it
 * loads, the claims tab with public/claims.json (S5-D71), and, with the generator families, the step family, which FAILS above its
 * 4 KB (B10), and its calibrated part with the claim groups that part loads.
 * Wave 2 (§22.1) reports the compile bank: each group's chunk and "compile bank data (all groups)" against its
 * 30 KB figure. One check here does fail: no chunk may hold a compile bank file's data (a snippet's source hash or
 * the rustc version line from src/data/rust-items/bank/*.json). Those stay with the scripts and tests; the app
 * loads the manifest, the served groups and the museum's payload that scripts/build-rust-items.ts writes from them.
 *
 *   bun scripts/verify-bundle.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { resolvePlay } from './bundle-plays'
import { CLAIMS } from '../src/data/claims'

const BUDGET_KB = 250
/** Entry target after the entry diet (spec §6.9, §16.1): reported, not gated. */
const ENTRY_TARGET_KB = 125
/** Each generator family chunk, the search index chunk, and FSRS + cards + composer (spec §16.1): reported, not gated. */
const FAMILY_REPORT_KB = 8
const INDEX_REPORT_KB = 20
const LEARNER_REPORT_KB = 6
/** The compile bank's groups together (spec §22.1): reported, not gated. */
const BANK_REPORT_KB = 30
const KB = 1000
/**
 * S5 (s5.md §8.1, S5-D50): the entry at the end of Wave 3 (wave-3.md D72, measured at d31a770, the tree of 9aa27de), in gzip KB at
 * the gate's 0.1 KB precision and in raw bytes. Its gzip moves by tens of bytes when other chunks are renamed, so the gate is the
 * rounded figure, and the raw count (which does not move with a hash) is printed beside it.
 */
const S5_ENTRY_KB = 115.7
const S5_ENTRY_RAW_BYTES = 349_812
/** s5.md §8.1's figures for the chunks S5 may grow, with the room it gave each (reported, not gated). */
const S5_FLEET_EXERCISE_KB = { base: 24.5, room: 3 }
const S5_FLEET_WORKER_KB = { base: 44.2, room: 12 }
const S5_PHYSICS_TAB_KB = 10
/** Stretch 1a (spec §16.1): three + R3F is reported against this (ParticleField's lazy chunk was 242.4 KB); the cube's own scene code is gated. */
const THREE_REPORT_KB = 240
const SCENE_GATE_KB = 40
const SCENE_SRC = 'src/components/play/tiling-cube/Cube3D.tsx'

interface RouteBudget {
  route: string
  src: string
  /** Fails the gate when the closure exceeds it; null reports only. */
  budgetKb: number | null
  /** Reported, not gated. */
  targetKb?: number
  /**
   * A play route loads its play through the registry on demand (wave-2.md §2.3). This is the play component's source
   * path. The route's figure counts the play's chunk and its static imports, so the figure is what a learner
   * downloads to play. Vite may file that chunk as `_Play-<hash>.js` with no `src` key (bundle-plays.ts finds it
   * anyway); a registered play whose chunk is not found fails the gate rather than being left out of the figure.
   */
  playSrc?: string
}

/**
 * Routes with their own closure (JS + CSS, gzip).
 * /boot sits at about 165 KB after the entry diet, with steps 3 to 6 split into an on-demand chunk (about 8 KB,
 * printed but not counted). Any growth in the entry chunk or the shared CSS shows here. /today shares the
 * 200 KB budget (its page ships in B18; until src/pages/Today.tsx exists the route is skipped). The play is
 * reported against its 220 KB figure but not gated in Wave 1. Wave 2 (docs/specs/wave-2.md §22.1) gates /daily at
 * 200 KB and reports /play/scheduler (220 KB) and /errors (200 KB). The play pages load their component on demand
 * through the play registry; a play's figure is the page plus that play's chunk (what a learner downloads to play),
 * with the play's own lazy chunks (the scheduler's Compose and card) on the on-demand line. Every play in the
 * registry has a row here (tests/plays/scheduler.test.ts).
 */
const ROUTE_BUDGETS: RouteBudget[] = [
  { route: '/boot', src: 'src/pages/Boot.tsx', budgetKb: 200, targetKb: 165 },
  { route: '/today', src: 'src/pages/Today.tsx', budgetKb: 200 },
  { route: '/daily', src: 'src/pages/Daily.tsx', budgetKb: 200 },
  // Stretch 4 (wave-3.md §16.4, §17.1): Interview mode is reported against a 200 KB figure, not gated. Its item player, the
  // interview library (it reaches the claims registry and the packet helpers) and the generator families load on demand, so
  // the closure is the page and the Daily's flow components.
  { route: '/drills', src: 'src/pages/Drills.tsx', budgetKb: null, targetKb: 200 },
  // Stretch 8 (wave-3.md §16.8, §17.1): the bring-your-own-service capstone is reported against a 200 KB figure, not gated. The
  // fleet session loads when a run starts, and the trace, zoo and atlas readers are the page's own closure.
  { route: '/capstone/service', src: 'src/pages/ServiceCapstone.tsx', budgetKb: null, targetKb: 200 },
  { route: '/play/block-placement', src: 'src/pages/Play.tsx', budgetKb: null, targetKb: 220, playSrc: 'src/components/play/block-placement/Play.tsx' },
  // The scheduler play shares the /play/:playId page; it holds fleet-model.ts, so its chunk is the larger of the two.
  { route: '/play/scheduler', src: 'src/pages/Play.tsx', budgetKb: null, targetKb: 220, playSrc: 'src/components/play/scheduler/Play.tsx' },
  { route: '/errors', src: 'src/pages/Errors.tsx', budgetKb: null, targetKb: 200 },
  // Wave 3 (docs/specs/wave-3.md §2.2, §12.5, §17.1). /me is gated at 200 KB (D20): 3b-06 folded Progress, whose static
  // closure was about 615 KB (all lesson content, framer-motion), into lazy sections (src/pages/me/*), so the closure
  // here is Me.tsx's head; the sections print on the "on demand, not counted" line. App.tsx routes /me with plain
  // `lazy`, because lazyMotion would load src/lib/motion.tsx (framer-motion) beside the page, where this closure
  // does not look (tests/shell/nav.test.ts holds that, and that each motion section scopes itself).
  // The two plays are reported against a 200 KB figure with their play chunks, and skipped until each play exists.
  { route: '/me', src: 'src/pages/Me.tsx', budgetKb: 200 },
  { route: '/play/tiling-cube', src: 'src/pages/Play.tsx', budgetKb: null, targetKb: 200, playSrc: 'src/components/play/tiling-cube/Play.tsx' },
  { route: '/play/eplb', src: 'src/pages/Play.tsx', budgetKb: null, targetKb: 200, playSrc: 'src/components/play/eplb/Play.tsx' },
]

const dist = new URL('../dist/', import.meta.url)
const html = await readFile(new URL('index.html', dist), 'utf8')
const entryMatch = /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/.exec(html)
if (!entryMatch) throw new Error('dist/index.html has no module script; run npm run build first')
const entry = entryMatch[1].split('/').pop()!

const gzipOf = new Map<string, number>()
async function gzipSize(file: string): Promise<number> {
  let size = gzipOf.get(file)
  if (size === undefined) {
    size = gzipSync(await readFile(new URL(file, dist))).length
    gzipOf.set(file, size)
  }
  return size
}

const sizes: { name: string; gzip: number }[] = []
for (const name of await readdir(new URL('assets/', dist))) {
  if (!name.endsWith('.js')) continue
  sizes.push({ name, gzip: await gzipSize(`assets/${name}`) })
}

const entrySize = sizes.find((s) => s.name === entry)
if (!entrySize) throw new Error(`entry chunk ${entry} not found in dist/assets`)

console.log('10 largest chunks (gzip):')
for (const s of [...sizes].sort((a, b) => b.gzip - a.gzip).slice(0, 10)) {
  console.log(`  ${(s.gzip / KB).toFixed(1).padStart(7)} KB  ${s.name}${s.name === entry ? '  <- entry' : ''}`)
}

let failed = false

const entryKb = entrySize.gzip / KB
if (entryKb > BUDGET_KB) {
  console.error(`FAIL entry chunk ${entry} is ${entryKb.toFixed(1)} KB gzip, over the ${BUDGET_KB} KB budget`)
  failed = true
} else {
  console.log(`ok   entry chunk ${entry} is ${entryKb.toFixed(1)} KB gzip (budget ${BUDGET_KB} KB)`)
}
console.log(`${entryKb <= ENTRY_TARGET_KB ? 'ok  ' : 'warn'} entry chunk target ${ENTRY_TARGET_KB} KB (not gated): ${entryKb.toFixed(1)} KB`)

// S5-D50: the entry adds 0 B. The gate is the rounded figure; the raw count is printed beside it, since it moves only when the code does.
{
  const raw = (await readFile(new URL(`assets/${entry}`, dist))).length
  const rounded = Number(entryKb.toFixed(1))
  const rawDelta = raw - S5_ENTRY_RAW_BYTES
  const rawNote = `${raw.toLocaleString('en-US')} raw bytes against ${S5_ENTRY_RAW_BYTES.toLocaleString('en-US')} (${rawDelta >= 0 ? '+' : ''}${rawDelta} B)`
  if (rounded > S5_ENTRY_KB) {
    console.error(`FAIL entry chunk ${entry} is ${rounded.toFixed(1)} KB gzip, over S5's ${S5_ENTRY_KB} KB (S5-D50: +0 B; ${rawNote})`)
    failed = true
  } else {
    console.log(`ok   entry chunk is ${rounded.toFixed(1)} KB gzip against S5's ${S5_ENTRY_KB} KB at 0.1 KB precision (S5-D50: +0 B); ${rawNote}`)
    if (rawDelta !== 0) console.log(`warn entry chunk raw size differs from the Wave 3 count by ${rawDelta} B (its gzip still rounds to ${S5_ENTRY_KB} KB; wave-3.md D72 allows no growth)`)
  }
}

interface ManifestChunk {
  file: string
  name?: string
  isDynamicEntry?: boolean
  src?: string
  imports?: string[]
  dynamicImports?: string[]
  css?: string[]
}

const manifest = JSON.parse(await readFile(new URL('.vite/manifest.json', dist), 'utf8')) as Record<string, ManifestChunk>

/** Every chunk reachable from `roots` by static `imports`, in visit order. */
function closure(roots: string[]): { key: string; chunk: ManifestChunk }[] {
  const seen = new Set<string>()
  const out: { key: string; chunk: ManifestChunk }[] = []
  const visit = (key: string) => {
    if (seen.has(key)) return
    seen.add(key)
    const chunk = manifest[key]
    if (!chunk) throw new Error(`manifest has no chunk ${key}`)
    out.push({ key, chunk })
    for (const dep of chunk.imports ?? []) visit(dep)
  }
  for (const root of roots) visit(root)
  return out
}

/**
 * The manifest key of a lazy route's chunk. It is normally the source path, but when another chunk
 * imports modules the route chunk holds (Boot's on-demand steps do), Vite files it under `_<file>`
 * and drops `src`, so fall back to the dynamic-entry chunk with the page's name.
 */
function routeKey(src: string): string | undefined {
  if (manifest[src]) return src
  const name = src.split('/').pop()!.replace(/\.[^.]+$/, '')
  return Object.keys(manifest).find((k) => manifest[k].isDynamicEntry && manifest[k].name === name)
}

/** Each route's closure files, for the shared-chunk report after the loop. */
const closureFiles = new Map<string, Set<string>>()

for (const { route, src, budgetKb, targetKb, playSrc } of ROUTE_BUDGETS) {
  const key = routeKey(src)
  if (!key && !existsSync(new URL(`../${src}`, import.meta.url))) {
    console.log(`skip ${route}: ${src} does not exist yet`)
    continue
  }
  if (!key) throw new Error(`manifest has no chunk for ${src}; is build.manifest on and ${route} still lazy?`)
  const files: { file: string; gzip: number }[] = []
  const roots = ['index.html', key]
  let playKey: string | undefined
  if (playSrc) {
    // A play whose file does not exist yet is skipped before any chunk lookup (bundle-plays.ts): the by-name fallback
    // would hand it the scheduler's hoisted `_Play-*` chunk and report that figure under this route.
    const found = resolvePlay(
      manifest,
      route,
      playSrc,
      key,
      ROUTE_BUDGETS.flatMap((r) => (r.playSrc ? [r.playSrc] : [])),
      (p) => existsSync(new URL(`../${p}`, import.meta.url)),
    )
    if ('skip' in found) {
      console.log(found.skip)
      continue
    }
    playKey = found.key
    if (!playKey) throw new Error(`no chunk for the play ${playSrc} in the manifest, so ${route}'s figure would leave the play out; see scripts/bundle-plays.ts`)
    roots.push(playKey)
    console.log(`play ${route}: ${playSrc} is ${manifest[playKey].file}`)
  }
  for (const { chunk } of closure(roots)) {
    files.push({ file: chunk.file, gzip: await gzipSize(chunk.file) })
    for (const css of chunk.css ?? []) files.push({ file: css, gzip: await gzipSize(css) })
  }
  // A chunk and its CSS can be listed from two importers; count each file once.
  const unique = [...new Map(files.map((f) => [f.file, f])).values()]
  const totalKb = unique.reduce((sum, f) => sum + f.gzip, 0) / KB
  closureFiles.set(route, new Set(unique.map((f) => f.file)))

  console.log(`${route} closure (JS + CSS, gzip):`)
  for (const f of unique) console.log(`  ${(f.gzip / KB).toFixed(1).padStart(7)} KB  ${f.file}`)

  // Information only: what the route fetches on demand after first load (not part of the budget). Each on-demand chunk
  // brings its own static imports (Boot's last step imports the Background card, which a shared chunk may hold), so the
  // list follows them: a file is named once, under the first chunk that reaches it, and never when the closure above
  // already counts it.
  const counted = new Set(unique.map((f) => f.file))
  const onDemand: string[] = []
  let onDemandKb = 0
  const dynamicRoots = [...(manifest[key].dynamicImports ?? []), ...(playKey ? (manifest[playKey].dynamicImports ?? []) : [])]
  for (const dyn of dynamicRoots) {
    if (!manifest[dyn]) continue
    const parts: string[] = []
    let chunkKb = 0
    for (const { chunk } of closure([dyn])) {
      for (const file of [chunk.file, ...(chunk.css ?? [])]) {
        if (counted.has(file)) continue
        counted.add(file)
        const kb = (await gzipSize(file)) / KB
        chunkKb += kb
        parts.push(`${file.split('/').pop()} ${kb.toFixed(1)} KB`)
      }
    }
    if (parts.length === 0) continue
    onDemandKb += chunkKb
    onDemand.push(parts.length === 1 ? parts[0] : `${parts[0]} (with its static imports ${parts.slice(1).join(', ')}: ${chunkKb.toFixed(1)} KB)`)
  }
  if (onDemand.length > 0) console.log(`  on demand, not counted: ${onDemand.join(', ')}`)
  if (budgetKb === null) {
    // A reported route over its figure says `warn` (still not a failure); under it, or with no figure, `info`.
    const over = targetKb !== undefined && totalKb > targetKb
    console.log(`${over ? 'warn' : 'info'} ${route} closure is ${totalKb.toFixed(1)} KB gzip (reported, not gated${targetKb ? `; figure ${targetKb} KB` : ''})`)
    continue
  }
  if (totalKb > budgetKb) {
    console.error(`FAIL ${route} closure is ${totalKb.toFixed(1)} KB gzip, over the ${budgetKb} KB budget`)
    failed = true
  } else {
    console.log(`ok   ${route} closure is ${totalKb.toFixed(1)} KB gzip (budget ${budgetKb} KB)`)
    // Soft: the full flow, first load plus on-demand chunks. Never fails; it keeps the split visible.
    if (onDemandKb > 0 && totalKb + onDemandKb > budgetKb) {
      console.log(`warn ${route} full flow with on-demand chunks is ${(totalKb + onDemandKb).toFixed(1)} KB gzip (not gated)`)
    }
  }
  if (targetKb !== undefined) {
    console.log(`${totalKb <= targetKb ? 'ok  ' : 'warn'} ${route} target ${targetKb} KB (not gated): ${totalKb.toFixed(1)} KB`)
  }
}

// Stretch 1a (spec §16.1): the cube's 3D scene. Its own chunk (Cube3D.tsx, the scene code without the engine) FAILS above
// 40 KB. The three + R3F chunk is the JS the scene reaches by static imports that neither the entry nor the play's
// closure already holds (Home's ParticleField shares it), and is reported against 240 KB. The play's closure above
// never contains either: View3D imports the scene on a request, which tests/boot/imports.test.ts holds.
if (!existsSync(new URL(`../${SCENE_SRC}`, import.meta.url))) {
  console.log(`skip 3D scene: ${SCENE_SRC} does not exist yet`)
} else {
  const sceneKey = routeKey(SCENE_SRC)
  if (!sceneKey) throw new Error(`manifest has no chunk for ${SCENE_SRC}; is it still imported lazily (View3D) and is build.manifest on?`)
  const sceneFile = manifest[sceneKey].file
  const held = closureFiles.get('/play/tiling-cube') ?? new Set(closure(['index.html']).map((c) => c.chunk.file))
  const vendor = closure([sceneKey]).filter(({ key, chunk }) => key !== sceneKey && !held.has(chunk.file))
  let vendorBytes = 0
  for (const { chunk } of vendor) vendorBytes += await gzipSize(chunk.file)
  const vendorKb = vendorBytes / KB
  const vendorNames = vendor.map(({ chunk }) => chunk.file.split('/').pop()).join(', ')
  console.log(`${vendorKb <= THREE_REPORT_KB ? 'ok  ' : 'warn'} three + R3F chunk ${vendorNames || '(none: inlined in the scene chunk)'} is ${vendorKb.toFixed(1)} KB gzip (figure ${THREE_REPORT_KB} KB, not gated)`)
  const sceneKb = (await gzipSize(sceneFile)) / KB
  if (sceneKb > SCENE_GATE_KB) {
    console.error(`FAIL the cube's 3D scene chunk ${sceneFile.split('/').pop()} is ${sceneKb.toFixed(1)} KB gzip, over the ${SCENE_GATE_KB} KB budget (is three inlined in it, or has it grown?)`)
    failed = true
  } else {
    console.log(`ok   the cube's 3D scene chunk ${sceneFile.split('/').pop()} is ${sceneKb.toFixed(1)} KB gzip (budget ${SCENE_GATE_KB} KB)`)
  }
}

// Reported only: the claims registry's chunk (wave-3.md D19, §4.4), which /boot and /today share. The manifest files it
// under no source path, so it is the JS chunk in both closures that holds the most of the registry's claim ids (at least half of them). Wave 3 adds
// no claim to it (its claims are lazy groups), so the figure should stay at its Wave 2 size, 17.1 to 17.4 KB.
{
  const both = [...(closureFiles.get('/boot') ?? [])].filter((f) => f.endsWith('.js') && closureFiles.get('/today')?.has(f))
  const held: { file: string; ids: number }[] = []
  for (const file of both) {
    const text = await readFile(new URL(file, dist), 'utf8')
    held.push({ file, ids: CLAIMS.filter((c) => text.includes(c.id)).length })
  }
  const claims = held.sort((a, b) => b.ids - a.ids)[0]
  if (!claims || claims.ids < CLAIMS.length / 2) console.log('skip claims chunk: /boot and /today share no chunk holding the claims registry')
  else console.log(`info claims chunk ${claims.file.split('/').pop()} is ${((await gzipSize(claims.file)) / KB).toFixed(1)} KB gzip, shared by /boot and /today (reported, not gated)`)
}

// Reported only: each generator family chunk (spec §5.1 keeps them outside /today's closure) and the search index.
const chunksFor = (match: (key: string, chunk: ManifestChunk) => boolean) =>
  Object.entries(manifest).filter(([key, chunk]) => match(key, chunk))

// A family that imports lazy claim groups statically (rollout's serving3) loads them with it, so its line names each group's
// chunk and gzip; so does a family part's line (step's calibrated part: physics, ix-points and tiling, s5.md §8.1). A group's chunk is its own manifest entry when something
// imports it dynamically; otherwise Rollup merged it into a shared chunk named after it (the tiling family's code may share
// the name), and it is the one of those holding at least half of its ids, the most of them.
const LAZY_GROUPS = new URL('../src/data/claims/lazy/', import.meta.url)
const groupOf = new Map<string, string>()
for (const f of readdirSync(LAZY_GROUPS).filter((x) => x.endsWith('.ts')).sort()) {
  const name = f.replace(/\.ts$/, '')
  let file = manifest[`src/data/claims/lazy/${f}`]?.file
  if (!file) {
    const mod = (await import(new URL(f, LAZY_GROUPS).href)) as Record<string, unknown>
    const ids = ((Object.entries(mod).find(([k]) => k.endsWith('_CLAIMS'))?.[1] ?? []) as { id: string }[]).map((c) => c.id)
    let most = ids.length / 2
    for (const [, c] of chunksFor((key, c) => key.startsWith('_') && c.name === name)) {
      const text = await readFile(new URL(c.file, dist), 'utf8')
      const held = ids.filter((id) => text.includes(id)).length
      if (held >= most) [most, file] = [held, c.file]
    }
  }
  if (file) groupOf.set(file, name)
}
async function staticGroups(chunk: ManifestChunk): Promise<string[]> {
  const out: string[] = []
  for (const file of (chunk.imports ?? []).map((k) => manifest[k]?.file)) {
    const name = file && groupOf.get(file)
    if (name) out.push(`${name} ${((await gzipSize(file)) / KB).toFixed(1)} KB`)
  }
  return out
}
/** A family whose spec gates its chunk (s5.md §8.1 and B10: `step` ≤ 4 KB gzip): it FAILS above the figure. */
const FAMILY_GATE_KB: Record<string, number> = { 'step.ts': 4 }
const PART_PREFIX = 'src/lib/items/families/lazy/'

// A family part (families/lazy/<name>.ts, which on-demand.ts's `familyPart` loads when a variant that reads it is drawn) is no
// family: it is not in /today's family fetch, so it is printed on its own line with the claim groups it brings.
const families = chunksFor((key) => key.startsWith('src/lib/items/families/') && !key.startsWith(PART_PREFIX))
if (families.length === 0) console.log('skip generator families: no src/lib/items/families/* chunks yet')
for (const [key, chunk] of families) {
  const kb = (await gzipSize(chunk.file)) / KB
  const name = key.split('/').pop()!
  const gate = FAMILY_GATE_KB[name]
  const groups = await staticGroups(chunk)
  const beside = groups.length > 0 ? `; static claim groups ${groups.join(', ')} gzip` : ''
  if (gate === undefined) console.log(`${kb <= FAMILY_REPORT_KB ? 'ok  ' : 'warn'} family ${name} is ${kb.toFixed(1)} KB gzip (report ${FAMILY_REPORT_KB} KB, not gated)${beside}`)
  else if (kb > gate) {
    console.error(`FAIL family ${name} is ${kb.toFixed(1)} KB gzip, over its ${gate} KB budget (s5.md §8.1, B10)${beside}`)
    failed = true
  } else console.log(`ok   family ${name} is ${kb.toFixed(1)} KB gzip (budget ${gate} KB)${beside}`)
}
// A gated family Rollup merged into another chunk has no manifest entry of its own, and the loop above would print nothing for
// it and pass (S5-D78): its budget cannot be measured, so it FAILS.
for (const name of Object.keys(FAMILY_GATE_KB)) {
  const key = `src/lib/items/families/${name}`
  if (!existsSync(new URL(`../${key}`, import.meta.url)) || families.some(([k]) => k === key)) continue
  console.error(`FAIL family ${name} has no chunk of its own in the manifest, so its ${FAMILY_GATE_KB[name]} KB budget cannot be measured (s5.md §8.1, B10, S5-D78)`)
  failed = true
}
for (const [key, chunk] of chunksFor((key) => key.startsWith(PART_PREFIX))) {
  const kb = (await gzipSize(chunk.file)) / KB
  const groups = await staticGroups(chunk)
  const beside = groups.length > 0 ? `; with its static claim groups ${groups.join(', ')} gzip` : ''
  console.log(`info family part ${key.slice(PART_PREFIX.length)} is ${kb.toFixed(1)} KB gzip, loaded only when a variant that reads it is drawn (reported, not gated)${beside}`)
}

// S5 (s5.md §8.1, S5-15): the v2 lines. Reported, not gated, except the entry above. A chunk S5 would grow is printed with its Wave 3 figure
// and the room §8.1 gave it; Level 2 (the v2 exercise contract, `frontier`) is not built (S5-D69), so the two have nothing to hold yet.
{
  const kbOf = async (file: string) => (await gzipSize(file)) / KB
  const fleetKey = 'src/components/fleet-ex/FleetExercise.tsx'
  if (!manifest[fleetKey]) console.log(`skip FleetExercise chunk: no ${fleetKey} in the manifest`)
  else {
    const kb = await kbOf(manifest[fleetKey].file)
    const top = S5_FLEET_EXERCISE_KB.base + S5_FLEET_EXERCISE_KB.room
    console.log(`${kb <= top ? 'ok  ' : 'warn'} FleetExercise chunk ${manifest[fleetKey].file.split('/').pop()} is ${kb.toFixed(1)} KB gzip (Wave 3 ${S5_FLEET_EXERCISE_KB.base} KB, room +${S5_FLEET_EXERCISE_KB.room} KB for v2 metadata; not gated)`)
  }
  const worker = sizes.find((s) => /^fleet\.worker-/.test(s.name))
  if (!worker) console.log('skip fleet.worker: no fleet.worker chunk in dist/assets')
  else {
    const kb = worker.gzip / KB
    const top = S5_FLEET_WORKER_KB.base + S5_FLEET_WORKER_KB.room
    console.log(`${kb <= top ? 'ok  ' : 'warn'} fleet.worker ${worker.name} is ${kb.toFixed(1)} KB gzip (Wave 3 ${S5_FLEET_WORKER_KB.base} KB, room +${S5_FLEET_WORKER_KB.room} KB for EngineV2 and the card; not gated)`)
  }

  // The physics tab: its own lazy chunk, and what it loads on top (report.json, decisions.json, controls.json and the two claim groups).
  const tabKey = 'src/pages/changes/PhysicsTab.tsx'
  if (!manifest[tabKey]) console.log(`skip physics tab: no ${tabKey} in the manifest`)
  else {
    const tab = manifest[tabKey]
    const kb = await kbOf(tab.file)
    console.log(`${kb <= S5_PHYSICS_TAB_KB ? 'ok  ' : 'warn'} physics tab ${tab.file.split('/').pop()} is ${kb.toFixed(1)} KB gzip (figure ${S5_PHYSICS_TAB_KB} KB; not gated)`)
    const loads: string[] = []
    for (const dyn of tab.dynamicImports ?? []) {
      const chunk = manifest[dyn]
      if (chunk) loads.push(`${dyn.split('/').pop()!.replace(/\.(json|ts)$/, '')} ${((await gzipSize(chunk.file)) / KB).toFixed(1)} KB`)
    }
    if (loads.length > 0) console.log(`info physics tab loads on demand, outside its chunk: ${loads.join(', ')} gzip`)
  }

  // S5-D71: the claims tab loads the two physics groups on demand, so its own chunk stays small; public/claims.json (the served
  // registry, every claim listed) is the file that grew.
  const claimsKey = 'src/components/ClaimsTable.tsx'
  if (!manifest[claimsKey]) console.log(`skip claims tab: no ${claimsKey} in the manifest`)
  else {
    const table = manifest[claimsKey]
    const kb = await kbOf(table.file)
    const held = new Set(closure(['index.html']).map((c) => c.chunk.file))
    let beyond = 0
    for (const { chunk } of closure([claimsKey])) if (!held.has(chunk.file)) beyond += await gzipSize(chunk.file)
    const groups: string[] = []
    for (const dyn of table.dynamicImports ?? []) {
      const chunk = manifest[dyn]
      if (chunk) groups.push(`${dyn.split('/').pop()!.replace(/\.ts$/, '')} ${((await gzipSize(chunk.file)) / KB).toFixed(1)} KB`)
    }
    console.log(`info claims tab ${table.file.split('/').pop()} is ${kb.toFixed(1)} KB gzip, ${(beyond / KB).toFixed(1)} KB with the static imports the entry does not hold; on demand: ${groups.join(', ') || 'none'} gzip (reported, not gated; S5-D71)`)
  }
  const claimsJson = new URL('../public/claims.json', import.meta.url)
  if (!existsSync(claimsJson)) console.log('skip public/claims.json: file does not exist')
  else console.log(`info public/claims.json is ${readFileSync(claimsJson).length.toLocaleString('en-US')} B (reported, not gated; S5-D71)`)
}

// Reported only: the compile bank (spec §22.1). Each group is one chunk the compile family loads when an item draws
// from it (src/data/rust-items/groups.ts); the manifest the family draws with sits inside the family chunk above.
const GROUP_PREFIX = 'src/data/rust-items/served/'
const groups = chunksFor((key) => key.startsWith(GROUP_PREFIX))
if (groups.length === 0) console.log('skip compile bank: no src/data/rust-items/served/* chunks')
else {
  let bankKb = 0
  for (const [key, chunk] of groups) {
    const kb = (await gzipSize(chunk.file)) / KB
    bankKb += kb
    console.log(`info compile bank group ${key.slice(GROUP_PREFIX.length).replace(/\.ts$/, '')} is ${kb.toFixed(1)} KB gzip (${chunk.file.split('/').pop()})`)
  }
  console.log(
    `${bankKb <= BANK_REPORT_KB ? 'ok  ' : 'warn'} compile bank data (all groups) is ${bankKb.toFixed(1)} KB gzip in ${groups.length} chunks (figure ${BANK_REPORT_KB} KB, not gated; a learner loads only the groups their items draw from)`,
  )
}

// Gated: no chunk holds a compile bank file's data. A bank's source hashes and rustc version line are distinctive, so
// finding one in a chunk means a bank file (or the scripts' loader, src/data/rust-items/index.ts) was bundled.
const BANK_DIR = new URL('../src/data/rust-items/bank/', import.meta.url)
const bankMarks = new Set<string>()
for (const name of existsSync(BANK_DIR) ? readdirSync(BANK_DIR).filter((n) => n.endsWith('.json')) : []) {
  const bank = JSON.parse(readFileSync(new URL(name, BANK_DIR), 'utf8')) as { rustc?: string; snippets?: Record<string, { hash?: string }> }
  if (bank.rustc) bankMarks.add(bank.rustc)
  for (const s of Object.values(bank.snippets ?? {})) if (s.hash) bankMarks.add(s.hash)
}
const leaks: string[] = []
for (const { name } of sizes) {
  const text = await readFile(new URL(`assets/${name}`, dist), 'utf8')
  const hits = [...bankMarks].filter((m) => text.includes(m))
  if (hits.length > 0) leaks.push(`${name} (${hits.length} mark(s), e.g. ${hits[0].slice(0, 24)}…)`)
}
if (leaks.length > 0) {
  console.error(`FAIL compile bank data in the bundle: ${leaks.join(', ')}; the app loads src/data/rust-items/manifest.json and served/*, never bank/*.json or src/data/rust-items/index.ts`)
  failed = true
} else {
  console.log(`ok   no chunk holds compile bank data (${bankMarks.size} source hashes and rustc version lines checked)`)
}

const indexes = chunksFor((key, chunk) => /search-index/.test(key) || /search-index/.test(chunk.file))
if (indexes.length === 0) console.log('skip search index: no search-index chunk yet')
for (const [, chunk] of indexes) {
  const kb = (await gzipSize(chunk.file)) / KB
  console.log(`${kb <= INDEX_REPORT_KB ? 'ok  ' : 'warn'} search index ${chunk.file.split('/').pop()} is ${kb.toFixed(1)} KB gzip (report ${INDEX_REPORT_KB} KB, not gated)`)
}

// Reported only: FSRS + cards + composer (spec §16.1, "inside /today"). Vite folds those modules into shared
// chunks the manifest does not name, so the figure comes from bundling the three files on their own with
// everything else they import left external (the ledger fold, the item core, rng, calibration, reentry), minified
// and gzipped chunk by chunk. It is the code the three modules own, and it moves with them, not with their neighbours.
const LEARNER_SRC = ['fsrs', 'cards', 'composer'].map((n) => `src/lib/learner/${n}.ts`)
const learnerFiles = LEARNER_SRC.map((f) => new URL(`../${f}`, import.meta.url).pathname)
if (learnerFiles.some((f) => !existsSync(f))) {
  console.log('skip FSRS + cards + composer: a module does not exist yet')
} else {
  const built = await Bun.build({
    entrypoints: learnerFiles,
    target: 'browser',
    format: 'esm',
    minify: true,
    splitting: true,
    plugins: [
      {
        name: 'own-code-only',
        setup(build) {
          build.onResolve({ filter: /.*/ }, async (args) => {
            if (!args.importer) return undefined
            const alias = args.path.startsWith('@/') ? new URL(`../src/${args.path.slice(2)}`, import.meta.url).pathname : args.path
            const resolved = alias.startsWith('.') ? new URL(alias, `file://${args.importer}`).pathname : alias
            const hit = learnerFiles.some((f) => resolved === f || resolved === f.replace(/\.ts$/, ''))
            return hit ? undefined : { path: args.path, external: true }
          })
        },
      },
    ],
  })
  if (!built.success) throw new Error(`bundling FSRS + cards + composer failed: ${built.logs.join('\n')}`)
  let learnerBytes = 0
  for (const out of built.outputs) learnerBytes += gzipSync(new Uint8Array(await out.arrayBuffer())).length
  const kb = learnerBytes / KB
  console.log(`${kb <= LEARNER_REPORT_KB ? 'ok  ' : 'warn'} FSRS + cards + composer is ${kb.toFixed(1)} KB gzip, own code (report ${LEARNER_REPORT_KB} KB, not gated)`)
}

if (failed) process.exit(1)
