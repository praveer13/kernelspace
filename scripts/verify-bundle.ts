/**
 * verify-bundle — bundle budget gates (PLAN-100X §7.3; docs/specs/ledger-v3.md §12.4, §15).
 *
 * Run after `npm run build`. Gzip-measures every dist/assets/*.js, finds the entry chunk from the
 * module script in dist/index.html, FAILS if it exceeds the entry budget, and prints the 10 largest
 * chunks. It then walks dist/.vite/manifest.json (`build.manifest`) to measure each gated route's
 * closure: the entry chunk, the route's chunk and their static imports, with every CSS file they
 * name. Dynamic imports (the ledger engine, other pages, lazy decoration) are not followed.
 * Which modules a route may not import is tests/boot/imports.test.ts's job; this gate measures bytes.
 * Wave 1 (docs/specs/wave-1.md §16.1): /boot and /today are gated at 200 KB with a tighter target, the
 * entry has a 125 KB target after the entry diet (B2), and the play closure, the generator family
 * chunks and the search index are reported. A route whose page file does not exist yet is skipped.
 *
 *   bun scripts/verify-bundle.ts
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const BUDGET_KB = 250
/** Entry target after the entry diet (spec §6.9, §16.1): reported, not gated. */
const ENTRY_TARGET_KB = 125
/** Each generator family chunk and the search index chunk (spec §16.1): reported, not gated. */
const FAMILY_REPORT_KB = 8
const INDEX_REPORT_KB = 15
const KB = 1000

interface RouteBudget {
  route: string
  src: string
  /** Fails the gate when the closure exceeds it; null reports only. */
  budgetKb: number | null
  /** Reported, not gated. */
  targetKb?: number
}

/**
 * Routes with their own closure (JS + CSS, gzip).
 * /boot sits at about 165 KB after the entry diet, with steps 3 to 6 split into an on-demand chunk (about 8 KB,
 * printed but not counted). Any growth in the entry chunk or the shared CSS shows here. /today shares the
 * 200 KB budget (its page ships in B18; until src/pages/Today.tsx exists the route is skipped). The play is
 * reported against its 220 KB figure but not gated in Wave 1.
 */
const ROUTE_BUDGETS: RouteBudget[] = [
  { route: '/boot', src: 'src/pages/Boot.tsx', budgetKb: 200, targetKb: 165 },
  { route: '/today', src: 'src/pages/Today.tsx', budgetKb: 200 },
  { route: '/play/block-placement', src: 'src/pages/Play.tsx', budgetKb: null, targetKb: 220 },
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

for (const { route, src, budgetKb, targetKb } of ROUTE_BUDGETS) {
  const key = routeKey(src)
  if (!key && !existsSync(new URL(`../${src}`, import.meta.url))) {
    console.log(`skip ${route}: ${src} does not exist yet`)
    continue
  }
  if (!key) throw new Error(`manifest has no chunk for ${src}; is build.manifest on and ${route} still lazy?`)
  const files: { file: string; gzip: number }[] = []
  for (const { chunk } of closure(['index.html', key])) {
    files.push({ file: chunk.file, gzip: await gzipSize(chunk.file) })
    for (const css of chunk.css ?? []) files.push({ file: css, gzip: await gzipSize(css) })
  }
  // A chunk and its CSS can be listed from two importers; count each file once.
  const unique = [...new Map(files.map((f) => [f.file, f])).values()]
  const totalKb = unique.reduce((sum, f) => sum + f.gzip, 0) / KB

  console.log(`${route} closure (JS + CSS, gzip):`)
  for (const f of unique) console.log(`  ${(f.gzip / KB).toFixed(1).padStart(7)} KB  ${f.file}`)

  // Information only: what the route fetches on demand after first load (not part of the budget).
  const counted = new Set(unique.map((f) => f.file))
  const onDemand: string[] = []
  let onDemandKb = 0
  for (const dyn of manifest[key].dynamicImports ?? []) {
    const chunk = manifest[dyn]
    if (chunk && !counted.has(chunk.file)) {
      const kb = (await gzipSize(chunk.file)) / KB
      onDemandKb += kb
      onDemand.push(`${chunk.file.split('/').pop()} ${kb.toFixed(1)} KB`)
    }
  }
  if (onDemand.length > 0) console.log(`  on demand, not counted: ${onDemand.join(', ')}`)
  if (budgetKb === null) {
    console.log(`info ${route} closure is ${totalKb.toFixed(1)} KB gzip (reported, not gated${targetKb ? `; figure ${targetKb} KB` : ''})`)
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

// Reported only: each generator family chunk (spec §5.1 keeps them outside /today's closure) and the search index.
const chunksFor = (match: (key: string, chunk: ManifestChunk) => boolean) =>
  Object.entries(manifest).filter(([key, chunk]) => match(key, chunk))

const families = chunksFor((key) => key.startsWith('src/lib/items/families/'))
if (families.length === 0) console.log('skip generator families: no src/lib/items/families/* chunks yet')
for (const [key, chunk] of families) {
  const kb = (await gzipSize(chunk.file)) / KB
  console.log(`${kb <= FAMILY_REPORT_KB ? 'ok  ' : 'warn'} family ${key.split('/').pop()} is ${kb.toFixed(1)} KB gzip (report ${FAMILY_REPORT_KB} KB, not gated)`)
}

const indexes = chunksFor((key, chunk) => /search-index/.test(key) || /search-index/.test(chunk.file))
if (indexes.length === 0) console.log('skip search index: no search-index chunk yet')
for (const [, chunk] of indexes) {
  const kb = (await gzipSize(chunk.file)) / KB
  console.log(`${kb <= INDEX_REPORT_KB ? 'ok  ' : 'warn'} search index ${chunk.file.split('/').pop()} is ${kb.toFixed(1)} KB gzip (report ${INDEX_REPORT_KB} KB, not gated)`)
}

if (failed) process.exit(1)
