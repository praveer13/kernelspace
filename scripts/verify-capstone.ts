/**
 * Capstone Zero: every step's solution passes its checks and its template does
 * not; step 5's reference passes and its known mutants fail (PLAN-100X §5.5 F7).
 * Runs through runStepJob, the same function the sandbox worker runs (§14.1).
 */
import { MIN_SPEEDUP, STEP5_HINTS, STEP5_REFERENCE_SOLUTION, STEP5_TEMPLATE } from '../src/lib/capstone-checks'
import { STEPS, runStepJob } from '../src/lib/capstone/steps'

const STEP5 = 'kv-cache'

function runChecks(stepId: string, code: string): Map<string, string | null> {
  const reply = runStepJob(stepId, code)
  const step = STEPS.find((s) => s.id === stepId)!
  const results = new Map<string, string | null>()
  for (const c of step.checks) {
    const r = reply.results[c.id]
    results.set(c.id, reply.error != null ? `harness error: ${reply.error}` : r == null ? 'no result' : r.pass ? null : r.msg)
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

/** Consecutive normalized tokens that count as copying a reference line. */
const RUN = 4

let failed = false
const fail = (msg: string) => {
  failed = true
  console.error(`FAIL ${msg}`)
}

// steps 1-4, 6, 7: the shown solution passes, the unedited template does not
for (const step of STEPS) {
  if (!step.solution) continue
  const sol = runChecks(step.id, step.solution)
  const bad = [...sol].filter(([, msg]) => msg != null)
  if (bad.length > 0) fail(`step ${step.id}: solution fails ${bad.map(([id, msg]) => `${id} (${msg})`).join(', ')}`)
  else console.log(`ok   step ${step.id}: solution passes ${sol.size} checks`)
  const tpl = runChecks(step.id, step.template)
  if ([...tpl.values()].every((m) => m == null)) fail(`step ${step.id}: unedited template passes every check`)
  else console.log(`ok   step ${step.id}: unedited template is rejected`)
}

const ref = runChecks(STEP5, STEP5_REFERENCE_SOLUTION)
for (const [id, msg] of ref) {
  if (msg == null) console.log(`ok   reference passes ${id}`)
  else fail(`reference fails ${id}: ${msg}`)
}

const speedup = runStepJob(STEP5, STEP5_REFERENCE_SOLUTION).metrics.speedup
if (speedup == null || speedup < MIN_SPEEDUP) fail(`reference speedup metric is ${speedup}, want >= ${MIN_SPEEDUP}`)
else console.log(`ok   reference reports its own speedup (${speedup.toFixed(1)}x)`)

const blank = runChecks(STEP5, STEP5_TEMPLATE)
if ([...blank.values()].every((m) => m == null)) fail('unedited template passes every check')
else console.log('ok   unedited template is rejected')

for (const m of MUTANTS) {
  const res = runChecks(STEP5, m.code)
  const failures = [...res].filter(([, msg]) => msg != null)
  if (failures.length === 0) {
    fail(`mutant "${m.name}" passes every check`)
    continue
  }
  const missing = m.mustFail.filter((id) => res.get(id) == null)
  if (missing.length > 0) fail(`mutant "${m.name}" slipped past ${missing.join(', ')}`)
  else console.log(`ok   mutant "${m.name}" rejected by ${failures.map(([id]) => id).join(', ')}`)
}

/** Lowercase, non-alphanumerics to spaces, whitespace collapsed, split into tokens. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

// only the lines the learner has to write; the template's own scaffolding may be named freely
const templateLines = new Set(STEP5_TEMPLATE.split('\n'))
const refTokenLines = STEP5_REFERENCE_SOLUTION.split('\n')
  .filter((l) => !templateLines.has(l))
  .map(tokens)
  .filter((t) => t.length >= RUN)

STEP5_HINTS.forEach((hint, i) => {
  const rung = i + 1
  const hintText = ` ${tokens(hint).join(' ')} `
  const problems: string[] = []
  for (const line of refTokenLines) {
    for (let s = 0; s + RUN <= line.length; s++) {
      const run = line.slice(s, s + RUN).join(' ')
      if (hintText.includes(` ${run} `)) problems.push(`repeats "${run}"`)
    }
  }
  const lower = hint.toLowerCase()
  if (lower.includes('push') && (lower.includes('kv[') || /\.[kv]\b/.test(lower)))
    problems.push('pairs "push" with kv[ or .k/.v member access')
  if (problems.length > 0) fail(`hint rung ${rung} reproduces the reference: ${problems.join('; ')}`)
  else console.log(`ok   hint rung ${rung} does not reproduce the reference`)
})

if (failed) process.exit(1)
console.log('capstone: every solution passes; step 5 reference passes, all mutants fail')
