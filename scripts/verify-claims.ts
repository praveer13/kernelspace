/**
 * Claims registry gate (PLAN-100X §5.2 S2): structure, sources, dates and derived formulas.
 * A pinned claim's source url must contain pin.ref, and a status claim about engine settings must be pinned.
 * The Attention Zoo's config claims (`zoo.*` from Hugging Face, spec §11.2) pin a full revision sha, point their
 * url at that revision's config.json and quote a JSON line that parses to the claim's value; so does any later claim
 * that pins a Hugging Face config.json (the DeepSeek-V3 expert counts, spec wave-3 §4.4).
 * Expiry never fails: stale claims are only listed. `--write` regenerates public/claims.json,
 * and a plain run fails if that file has drifted from the registry. `--online` also re-reads each such
 * config.json at its pinned revision and finds the quote in it exactly once (the one network step; bare runs stay offline).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { ALL_CLAIMS, pinProblems, staleSince, type Claim } from '../src/data/claims/all'

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

/** Mixtral-8x7B in billions: dense GQA attention and a router in every layer, plus `routed` experts' feed-forward weights. */
function mixtralParams(n: Reader, routed: number): number {
  const hidden = n('model.mixtral-8x7b.hidden-size')
  const kvDim = n('model.mixtral-8x7b.kv-heads') * n('model.mixtral-8x7b.head-dim')
  const experts = n('model.mixtral-8x7b.experts')
  const perLayer = 2 * hidden * hidden + 2 * hidden * kvDim + routed * 3 * hidden * n('model.mixtral-8x7b.ffn-size') + hidden * experts + 2 * hidden
  const total = 2 * n('model.mixtral-8x7b.vocab') * hidden + n('model.mixtral-8x7b.layers') * perLayer + hidden
  return Math.round(total / 1e7) / 100
}
const DERIVATIONS: Record<string, (n: Reader) => number> = {
  'hw.h100-sxm.bf16-dense': (n) => Math.floor(n('hw.h100-sxm.bf16-sparse') / 2),
  'hw.h100-sxm.fp8-dense': (n) => Math.floor(n('hw.h100-sxm.fp8-sparse') / 2),
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
  'model.llama3-70b.params': (n) => {
    const hidden = n('model.llama3-70b.hidden-size')
    const kvDim = n('model.llama3-70b.kv-heads') * n('model.llama3-70b.head-dim')
    const perLayer = 2 * hidden * hidden + 2 * hidden * kvDim + 3 * hidden * n('model.llama3-70b.ffn-size') + 2 * hidden
    const total = 2 * n('model.llama3-70b.vocab') * hidden + n('model.llama3-70b.layers') * perLayer + hidden
    return Math.round(total / 1e7) / 100
  },
  'model.mixtral-8x7b.params': (n) => mixtralParams(n, n('model.mixtral-8x7b.experts')),
  'model.mixtral-8x7b.active-params': (n) => mixtralParams(n, n('model.mixtral-8x7b.experts-per-token')),
  'model.kv.static-utilization': (n) => (n('model.kv.static-utilization-low') + n('model.kv.static-utilization-high')) / 2,
  'model.llama3-8b.kv-bytes-per-token': (n) =>
    2 * n('model.llama3-8b.layers') * n('model.llama3-8b.kv-heads') * n('model.llama3-8b.head-dim') * 2,
  'price.act3.b200-node-hourly': (n) => 4 * n('price.b200.median'),
  'zoo.llama3-70b.head-dim': (n) => n('zoo.llama3-70b.hidden-size') / n('zoo.llama3-70b.attn-heads'),
  'zoo.llama3-70b.kv-bytes-per-token': (n) =>
    2 * n('zoo.llama3-70b.layers') * n('zoo.llama3-70b.kv-heads') * n('zoo.llama3-70b.head-dim') * 2,
}

const SHA = /^[0-9a-f]{40}$/
const HF_CONFIG = /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/raw\/([^/]+)\/config\.json$/
/** `key`, `parent.key`, or either followed by how an array's contents give the value: (length), (member) or (count of <json literal>). */
const ZOO_ROW = /^([A-Za-z0-9_.]+)(?: \((length|member|count of (.+))\))?$/

/** Whether a claim is read from a Hugging Face config.json: every zoo claim, and any other claim that pins one by its url (Wave 3's DeepSeek-V3 expert counts; Wave 1's unpinned `model.*` configs stay as they are). */
function readsHfConfig(c: Claim): boolean {
  return c.id.startsWith('zoo.') || (c.pin !== undefined && c.source !== undefined && HF_CONFIG.test(c.source.url))
}

/** A claim read from a Hugging Face config: pinned to a sha, sourced at that sha, and its quote parses to its value. */
function zooProblems(c: Claim): string[] {
  if (!readsHfConfig(c) || !c.source || !validUrl(c.source.url) || new URL(c.source.url).hostname !== 'huggingface.co') return []
  const out: string[] = []
  const hf = HF_CONFIG.exec(c.source.url)
  if (!c.pin) out.push('a zoo claim read from Hugging Face needs pin {repo, ref = revision sha}')
  else if (!SHA.test(c.pin.ref)) out.push(`pin.ref "${c.pin.ref}" must be a full 40-character revision sha`)
  if (!hf) out.push(`source.url must be https://huggingface.co/<repo>/raw/<sha>/config.json: ${c.source.url}`)
  else if (c.pin && (hf[1] !== c.pin.repo || hf[2] !== c.pin.ref)) out.push(`source.url names ${hf[1]}@${hf[2]}, not the pin ${c.pin.repo}@${c.pin.ref}`)
  const { quote, row } = c.source
  const spec = ZOO_ROW.exec(row ?? '')
  if (!quote?.trim() || !spec) return [...out, `needs a quote and a row like "parent.key" or "key (count of 1)", got row ${JSON.stringify(row)}`]
  let members: Record<string, unknown>
  try {
    members = JSON.parse(`{${quote.trim().replace(/,$/, '')}}`)
  } catch {
    return [...out, 'source.quote is not one or more JSON members ("key": value) copied from the file']
  }
  const key = spec[1].split('.').pop() as string
  const found = members[key]
  if (found === undefined) return [...out, `source.quote has no "${key}" member`]
  if (Array.isArray(found)) {
    let got: number | undefined
    if (spec[2] === 'length') got = found.length
    else if (spec[3] !== undefined) {
      try {
        const literal: unknown = JSON.parse(spec[3])
        got = found.filter((x) => x === literal).length
      } catch {
        return [...out, `row names a count of ${spec[3]}, which is not a JSON literal`]
      }
    } else if (spec[2] === 'member') {
      if (!found.includes(c.value)) out.push(`${JSON.stringify(c.value)} is not a member of the quoted ${key} list`)
      return out
    } else return [...out, `"${key}" is a list: say (length), (member) or (count of x) in row`]
    if (got !== c.value) out.push(`the quoted ${key} list gives ${got} (${spec[2]}), the claim says ${JSON.stringify(c.value)}`)
  } else if (spec[2]) out.push(`row says (${spec[2]}) but the quoted "${key}" is not a list`)
  else if (found !== c.value) out.push(`the quote says "${key}": ${JSON.stringify(found)}, the claim says ${JSON.stringify(c.value)}`)
  return out
}

const byId = new Map<string, Claim>()
for (const c of ALL_CLAIMS) {
  if (byId.has(c.id)) fail(c.id, 'duplicate id')
  byId.set(c.id, c)
}

for (const c of ALL_CLAIMS) {
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
  // a fact tied to one release carries its ref, and its source url must point at it (W13)
  for (const p of pinProblems(c)) fail(c.id, p)
  for (const p of zooProblems(c)) fail(c.id, p)
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
for (const c of ALL_CLAIMS) {
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

// --online: each Hugging Face config.json (the zoo's and the DeepSeek-V3 expert counts'), read again at its pinned revision, contains the quote exactly once.
if (process.argv.includes('--online') && errors.length === 0) {
  const files = new Map<string, string>()
  for (const c of ALL_CLAIMS) {
    if (!readsHfConfig(c) || !c.source || !HF_CONFIG.test(c.source.url)) continue
    let text = files.get(c.source.url)
    if (text === undefined) {
      const res = await fetch(c.source.url)
      if (!res.ok) {
        fail(c.id, `HTTP ${res.status} reading ${c.source.url}`)
        continue
      }
      text = (await res.text()).replace(/\s+/g, ' ')
      files.set(c.source.url, text)
    }
    const times = text.split((c.source.quote ?? '').replace(/\s+/g, ' ')).length - 1
    if (times !== 1) fail(c.id, `the quote appears ${times} times in ${c.source.url} (want exactly 1)`)
  }
  console.log(`online: read ${files.size} config.json files at their pinned revisions`)
}

// public/claims.json mirrors the registry, in ALL_CLAIMS's fixed order, so non-bundled consumers (llms.txt, the freshness issue) can read it.
const json = `${JSON.stringify({ claims: ALL_CLAIMS }, null, 2)}\n`
if (process.argv.includes('--write')) {
  if (errors.length === 0) {
    writeFileSync(OUT, json)
    console.log(`wrote ${OUT} (${ALL_CLAIMS.length} claims)`)
  }
} else if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== json) {
  fail(OUT, 'out of date; run: bun scripts/verify-claims.ts --write')
}

if (unreproduced.length > 0) console.log(`note: no reproducer for derived claim(s): ${unreproduced.join(', ')}`)
const stale = ALL_CLAIMS.filter((c) => staleSince(c) !== null)
if (stale.length > 0) console.log(`stale (informational): ${stale.map((c) => `${c.id} since ${staleSince(c)}`).join('; ')}`)

if (errors.length > 0) {
  console.error(`verify-claims: ${errors.length} problem(s)`)
  for (const e of errors) console.error(`  ${e}`)
  process.exit(1)
}
const kinds = new Map<string, number>()
for (const c of ALL_CLAIMS) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1)
console.log(`verify-claims: ok, ${ALL_CLAIMS.length} claims (${[...kinds].map(([k, v]) => `${v} ${k}`).join(', ')})`)
