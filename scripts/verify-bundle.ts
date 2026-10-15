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

const families = chunksFor((key) => key.startsWith('src/lib/items/families/'))
if (families.length === 0) console.log('skip generator families: no src/lib/items/families/* chunks yet')
for (const [key, chunk] of families) {
  const kb = (await gzipSize(chunk.file)) / KB
  console.log(`${kb <= FAMILY_REPORT_KB ? 'ok  ' : 'warn'} family ${key.split('/').pop()} is ${kb.toFixed(1)} KB gzip (report ${FAMILY_REPORT_KB} KB, not gated)`)
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
