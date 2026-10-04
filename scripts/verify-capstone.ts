/** Capstone Zero step 5: the reference passes every check, the known mutants fail. */
import {
  STEP5_CHECKS,
  STEP5_REFERENCE_SOLUTION,
  STEP5_TEMPLATE,
  runStep5Harness,
} from '../src/lib/capstone-checks'

function runChecks(code: string): Map<string, string | null> {
  const results = new Map<string, string | null>()
  let api: Record<string, unknown>
  try {
    api = runStep5Harness(code)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    for (const c of STEP5_CHECKS) results.set(c.id, `harness error: ${msg}`)
    return results
  }
  for (const c of STEP5_CHECKS) {
    try {
      results.set(c.id, c.run(api, code))
    } catch (e) {
      results.set(c.id, e instanceof Error ? e.message : String(e))
    }
  }
  return results
}

function mutate(from: string, to: string): string {
  if (!STEP5_REFERENCE_SOLUTION.includes(from)) throw new Error(`mutant anchor not found: ${from}`)
  return STEP5_REFERENCE_SOLUTION.replace(from, to)
}

const NAIVE_DECODE = `const { model, forwardAll, argmax, EOS_ID, scriptIds } = lib
function decodeCached(promptIds, maxTokens) {
  const ids = [...promptIds]
  const out = []
  let logits = forwardAll(model, ids).logits
  for (let t = 0; t < maxTokens; t++) {
    const biased = [...logits]
    if (t < scriptIds.length) biased[scriptIds[t]] += 1000
    const next = argmax(biased)
    out.push(next)
    if (next === EOS_ID) break
    ids.push(next)
    logits = forwardAll(model, ids).logits
  }
  return out
}
return { decodeCached }`

const APPEND_TWICE_FROM = '    appendKV(cache, step.kv)\n    logits = step.logits\n  }\n  return out'

/** Each mutant must fail overall, and every check in `mustFail` must be among the failures. */
const MUTANTS: { name: string; code: string; mustFail: string[] }[] = [
  {
    // the old "pass on one token" shape: append never written, TODO marker gone
    name: 'append left empty (TODO marker removed)',
    code: STEP5_TEMPLATE.replace('TODO(you)', 'done'),
    mustFail: ['accounting'],
  },
  {
    name: 'append skips the v rows',
    code: mutate('    cache.layers[li].v.push(row.v)\n', ''),
    mustFail: ['accounting'],
  },
  {
    name: 'append stores k twice (v row := k row)',
    code: mutate('cache.layers[li].v.push(row.v)', 'cache.layers[li].v.push(row.k)'),
    mustFail: ['bitwise'],
  },
  {
    name: 'append skips every layer but the first',
    code: mutate('kv.forEach((row, li) => {', 'kv.slice(0, 1).forEach((row, li) => {'),
    mustFail: ['accounting'],
  },
  {
    name: 'append runs twice on the last token',
    code: mutate(APPEND_TWICE_FROM, `    appendKV(cache, step.kv)\n${APPEND_TWICE_FROM}`),
    mustFail: ['accounting'],
  },
  {
    name: 'naive recompute passed off as decodeCached',
    code: NAIVE_DECODE,
    mustFail: ['speedup'],
  },
]

let failed = false
const fail = (msg: string) => {
  failed = true
  console.error(`FAIL ${msg}`)
}

const ref = runChecks(STEP5_REFERENCE_SOLUTION)
for (const [id, msg] of ref) {
  if (msg == null) console.log(`ok   reference passes ${id}`)
  else fail(`reference fails ${id}: ${msg}`)
}

const blank = runChecks(STEP5_TEMPLATE)
if ([...blank.values()].every((m) => m == null)) fail('unedited template passes every check')
else console.log('ok   unedited template is rejected')

for (const m of MUTANTS) {
  const res = runChecks(m.code)
  const failures = [...res].filter(([, msg]) => msg != null)
  if (failures.length === 0) {
    fail(`mutant "${m.name}" passes every check`)
    continue
  }
  const missing = m.mustFail.filter((id) => res.get(id) == null)
  if (missing.length > 0) fail(`mutant "${m.name}" slipped past ${missing.join(', ')}`)
  else console.log(`ok   mutant "${m.name}" rejected by ${failures.map(([id]) => id).join(', ')}`)
}

if (failed) process.exit(1)
console.log('capstone step 5: reference passes, all mutants fail')
