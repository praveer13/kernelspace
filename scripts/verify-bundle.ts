/**
 * verify-bundle — bundle budget gates (PLAN-100X §7.3; docs/specs/ledger-v3.md §12.4, §15).
 *
 * Run after `npm run build`. Gzip-measures every dist/assets/*.js, finds the entry chunk from the
 * module script in dist/index.html, FAILS if it exceeds the entry budget, and prints the 10 largest
 * chunks. It then walks dist/.vite/manifest.json (`build.manifest`) to measure each gated route's
 * closure: the entry chunk, the route's chunk and their static imports, with every CSS file they
 * name. Dynamic imports (the ledger engine, other pages, lazy decoration) are not followed.
 * Which modules a route may not import is tests/boot/imports.test.ts's job; this gate measures bytes.
 *
 *   bun scripts/verify-bundle.ts
 */
import { readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const BUDGET_KB = 250
const KB = 1000

/**
 * Routes with their own budget: the JS + CSS closure, gzip.
 * /boot sits at about 198 KB of 200 KB, with steps 3 to 6 split into an on-demand chunk (about 8 KB, printed
 * but not counted; 206 KB with it). Any growth in the entry chunk or the shared CSS trips this gate.
 */
const ROUTE_BUDGETS: { route: string; src: string; budgetKb: number }[] = [{ route: '/boot', src: 'src/pages/Boot.tsx', budgetKb: 200 }]

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

for (const { route, src, budgetKb } of ROUTE_BUDGETS) {
  const key = routeKey(src)
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
}

if (failed) process.exit(1)
