/**
 * verify-bundle — entry-chunk budget gate (PLAN-100X §7.3).
 *
 * Run after `npm run build`. Gzip-measures every dist/assets/*.js, finds the
 * entry chunk from the module script in dist/index.html, FAILS if it exceeds
 * the budget, and prints the 10 largest chunks.
 *
 *   bun scripts/verify-bundle.ts
 */
import { readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const BUDGET_KB = 250
const KB = 1000

const dist = new URL('../dist/', import.meta.url)
const html = await readFile(new URL('index.html', dist), 'utf8')
const entryMatch = /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/.exec(html)
if (!entryMatch) throw new Error('dist/index.html has no module script; run npm run build first')
const entry = entryMatch[1].split('/').pop()!

const sizes: { name: string; gzip: number }[] = []
for (const name of await readdir(new URL('assets/', dist))) {
  if (!name.endsWith('.js')) continue
  const bytes = await readFile(new URL(`assets/${name}`, dist))
  sizes.push({ name, gzip: gzipSync(bytes).length })
}

const entrySize = sizes.find((s) => s.name === entry)
if (!entrySize) throw new Error(`entry chunk ${entry} not found in dist/assets`)

console.log('10 largest chunks (gzip):')
for (const s of [...sizes].sort((a, b) => b.gzip - a.gzip).slice(0, 10)) {
  console.log(`  ${(s.gzip / KB).toFixed(1).padStart(7)} KB  ${s.name}${s.name === entry ? '  <- entry' : ''}`)
}

const entryKb = entrySize.gzip / KB
if (entryKb > BUDGET_KB) {
  console.error(`FAIL entry chunk ${entry} is ${entryKb.toFixed(1)} KB gzip, over the ${BUDGET_KB} KB budget`)
  process.exit(1)
}
console.log(`ok   entry chunk ${entry} is ${entryKb.toFixed(1)} KB gzip (budget ${BUDGET_KB} KB)`)
