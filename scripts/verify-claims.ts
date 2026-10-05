/**
 * Claims registry gate (PLAN-100X §5.2 S2): structure, sources, dates and derived formulas.
 * Expiry never fails: stale claims are only listed. `--write` regenerates public/claims.json,
 * and a plain run fails if that file has drifted from the registry.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { CLAIMS, staleSince, type Claim } from '../src/data/claims'

const OUT = 'public/claims.json'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ID = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

const errors: string[] = []
const fail = (id: string, msg: string) => errors.push(`${id}: ${msg}`)

function validDate(s: string): boolean {
  if (!DATE.test(s)) return false
  const t = Date.parse(`${s}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s
}

function validUrl(s: string): boolean {
  try {
    return new URL(s).protocol === 'https:'
  } catch {
    return false
  }
}

/** Independent re-computation of each derived claim, keyed by id. `n` reads a claim it depends on. */
type Reader = (id: string) => number
const DERIVATIONS: Record<string, (n: Reader) => number> = {
  'hw.h100-sxm.bf16-dense': (n) => Math.floor(n('hw.h100-sxm.bf16-sparse') / 2),
  'hw.b200.hbm-capacity': (n) => n('hw.dgx-b200.hbm-total') / 8,
  'hw.b200.hbm-bw': (n) => n('hw.dgx-b200.hbm-bw') / 8,
  'hw.b200.bf16-dense': (n) => (n('hw.hgx-b200.bf16-sparse-system') * 1000) / 8 / 2,
  'hw.b300.hbm-bw': (n) => n('hw.gb300-nvl72.hbm-bw') / 72,
  'model.llama3-8b.head-dim': (n) => n('model.llama3-8b.hidden-size') / n('model.llama3-8b.attn-heads'),
  'model.llama3-70b.head-dim': (n) => n('model.llama3-70b.hidden-size') / n('model.llama3-70b.attn-heads'),
  'model.mixtral-8x7b.head-dim': (n) => n('model.mixtral-8x7b.hidden-size') / n('model.mixtral-8x7b.attn-heads'),
  'model.llama3-8b.params': (n) => {
    const hidden = n('model.llama3-8b.hidden-size')
    const kvDim = n('model.llama3-8b.kv-heads') * n('model.llama3-8b.head-dim')
    const perLayer = 2 * hidden * hidden + 2 * hidden * kvDim + 3 * hidden * n('model.llama3-8b.ffn-size') + 2 * hidden
    const total = 2 * n('model.llama3-8b.vocab') * hidden + n('model.llama3-8b.layers') * perLayer + hidden
    return Math.round(total / 1e7) / 100 // billions, two decimals
  },
  'model.llama3-8b.kv-bytes-per-token': (n) =>
    2 * n('model.llama3-8b.layers') * n('model.llama3-8b.kv-heads') * n('model.llama3-8b.head-dim') * 2,
  'price.act3.b200-node-hourly': (n) => 4 * n('price.b200.median'),
}

const byId = new Map<string, Claim>()
for (const c of CLAIMS) {
  if (byId.has(c.id)) fail(c.id, 'duplicate id')
  byId.set(c.id, c)
}

for (const c of CLAIMS) {
  if (!ID.test(c.id)) fail(c.id, 'id must be dotted lowercase, e.g. hw.h100-sxm.hbm-bw')
  if (!c.label.trim()) fail(c.id, 'missing label')
  if (typeof c.value === 'number' ? !Number.isFinite(c.value) : !c.value.trim()) fail(c.id, 'bad value')
  if (!validDate(c.verifiedAt)) fail(c.id, `bad verifiedAt "${c.verifiedAt}" (want a real YYYY-MM-DD)`)
  else if (Date.parse(`${c.verifiedAt}T00:00:00Z`) > Date.now() + 86_400_000) fail(c.id, 'verifiedAt is in the future')
  if (!Number.isInteger(c.ttlDays) || c.ttlDays <= 0) fail(c.id, `ttlDays missing or not a positive integer: ${c.ttlDays}`)

  const needsSource = c.kind !== 'derived' && c.kind !== 'synthetic'
  if (needsSource) {
    if (!c.source) fail(c.id, `kind ${c.kind} needs a source`)
    else {
      if (!validUrl(c.source.url)) fail(c.id, `source.url is not an https URL: ${c.source.url}`)
      if (!c.source.title.trim()) fail(c.id, 'source.title is empty')
      // a spec or a price is only as good as the words it was read from
      if ((c.kind === 'spec' || c.kind === 'price') && !c.source.quote?.trim()) fail(c.id, `kind ${c.kind} needs source.quote (the source's own words)`)
    }
  }
  if (c.kind === 'synthetic' && c.source) fail(c.id, 'synthetic claims must not carry a source')
  if (c.kind === 'derived') {
    if (!c.derived) fail(c.id, 'derived claim needs derived.from and derived.formula')
    else {
      if (!c.derived.formula.trim() || c.derived.from.length === 0) fail(c.id, 'derived needs a formula and at least one input')
      for (const dep of c.derived.from) if (!byId.has(dep)) fail(c.id, `derived.from names unknown claim ${dep}`)
    }
  } else if (c.derived) fail(c.id, `only derived claims carry derived (kind is ${c.kind})`)
}

// Derived formulas must reproduce, and must read exactly the inputs they declare.
const unreproduced: string[] = []
for (const c of CLAIMS) {
  if (c.kind !== 'derived' || !c.derived) continue
  const derive = DERIVATIONS[c.id]
  if (!derive) {
    unreproduced.push(c.id)
    continue
  }
  const read = new Set<string>()
  const n: Reader = (id) => {
    const dep = byId.get(id)
    if (!dep || typeof dep.value !== 'number') throw new Error(`${id} is not a numeric claim`)
    read.add(id)
    return dep.value
  }
  let got: number
  try {
    got = derive(n)
  } catch (e) {
    fail(c.id, `derivation threw: ${e instanceof Error ? e.message : String(e)}`)
    continue
  }
  if (typeof c.value !== 'number' || Math.abs(got - c.value) > 1e-9 * Math.max(1, Math.abs(got))) {
    fail(c.id, `drift: registry says ${c.value}, formula "${c.derived.formula}" gives ${got}`)
  }
  const declared = [...c.derived.from].sort().join(',')
  if ([...read].sort().join(',') !== declared) fail(c.id, `derived.from (${declared}) differs from the inputs the formula reads (${[...read].sort().join(',')})`)
}
for (const id of Object.keys(DERIVATIONS)) if (!byId.has(id)) fail(id, 'DERIVATIONS entry has no claim')

// public/claims.json mirrors the registry so non-bundled consumers (llms.txt, the freshness issue) can read it.
const json = `${JSON.stringify({ claims: CLAIMS }, null, 2)}\n`
if (process.argv.includes('--write')) {
  if (errors.length === 0) {
    writeFileSync(OUT, json)
    console.log(`wrote ${OUT} (${CLAIMS.length} claims)`)
  }
} else if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== json) {
  fail(OUT, 'out of date; run: bun scripts/verify-claims.ts --write')
}

if (unreproduced.length > 0) console.log(`note: no reproducer for derived claim(s): ${unreproduced.join(', ')}`)
const stale = CLAIMS.filter((c) => staleSince(c) !== null)
if (stale.length > 0) console.log(`stale (informational): ${stale.map((c) => `${c.id} since ${staleSince(c)}`).join('; ')}`)

if (errors.length > 0) {
  console.error(`verify-claims: ${errors.length} problem(s)`)
  for (const e of errors) console.error(`  ${e}`)
  process.exit(1)
}
const kinds = new Map<string, number>()
for (const c of CLAIMS) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1)
console.log(`verify-claims: ok, ${CLAIMS.length} claims (${[...kinds].map(([k, v]) => `${v} ${k}`).join(', ')})`)
