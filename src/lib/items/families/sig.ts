/**
 * The `sig` family: signature items, thirty seconds each (docs/specs/wave-2.md §9.6).
 *
 * Three choice variants over the incident world of §9 (world/incident-spec, world/incident-sim): read a
 * telemetry table and name the fault (`name-fault`), pick the probe USE order takes first given what a
 * dashboard already shows (`first-probe`), or read the table and pick the fix that reverts the fault
 * (`fix-for`). Every instance is fed by `generateIncident('sig', hex(seed))`, the same generator the Daily
 * and Act IV draw from, so the options are the incident catalog itself: the four faults, the six probes
 * and the four fixes. Each instance assesses `t7.incident-diagnosis` and the KC of the fault it shows.
 *
 * THE REDUCED RUN. A table variant simulates its incident (`IncidentRun`) on a two-worker fleet whatever
 * the generator drew (a node death needs two, and the table's "workers up" would give the fault away if
 * its denominator changed), warmed up for `SYNTHETIC.onset` minutes instead of 8-12, and reads the six
 * minutes after the alert. `first-probe` needs no run: what the dashboard shows is the fault's expected
 * category (`EXPECTED`) on the probes it names, and the key is the expert's choice (`expertNext`). A seed
 * whose run does not classify as its fault on the five probes the table shows is redrawn under the next
 * key (none of the first 1,000 verification seeds needed it), so the key is always what the table reads.
 *
 * VALIDITY. The option sets are fixed, so a blind reader has nothing to find in them as long as the keys
 * are balanced: the generator spreads the four faults evenly, and the fixes follow the faults. The
 * `first-probe` key is only ever the intake or the KV probe (USE order has nothing else to take first
 * against four faults), so its six options get a random tail each (`SYNTHETIC.tails`), which keeps their
 * lengths and word counts independent of the key. No option has a digit, a colon, a parenthesis, a
 * hedge word or a reason connective, and the two with acronyms are paired with two without, so no
 * binary feature isolates a key (B27, scripts/item-cues.ts).
 *
 * KCS. `make(seed, level, variant)` takes no KC (the 2a contract, types.ts), so the fault, and with it the fault KC
 * an instance carries, is the seed's own. The pools that serve a KC (Today, tickets, placement) redraw the seed
 * until the instance carries the KC they serve, and fall back to authored items when 16 draws do not
 * (src/lib/learner/on-kc.ts), so a fault-KC card never gets another fault's instance.
 *
 * SPEED. A cold table instance costs a simulation: about 2 ms at the median and under 4 ms at p95 on the
 * development host (`budgetMs` 10, where every other family keeps the default 1). The simulations are memoized by seed, so the two table variants, the four levels
 * and the verifier's repeated passes share one run each; tests/items/sig.test.ts times the cold path.
 */

import { KC } from '@/data/kc/ids'
import { finishInstance, resolveVariant, rngFor, type Rng } from '@/lib/items/core'
import { gradeResponse } from '@/lib/items/grade'
import type { AnswerSpec, ChoiceOption, Gen, Instance, Level, Params, PromptPart, SolutionStep, VariantSpec } from '@/lib/items/types'
import { formatNumber } from '@/lib/items/units'
import type { KcId } from '@/lib/kc/types'
import {
  CATEGORY_LABELS,
  EXPECTED,
  FIXES,
  INCIDENT_FAULTS,
  INCIDENT_SLO,
  PROBES,
  PROBE_IDS,
  classify,
  consistentFaults,
  expertNext,
  fixFor,
  generateIncident,
  isStreetlight,
  type Category,
  type FixId,
  type IncidentFault,
  type IncidentSpec,
  type Observation,
  type ProbeId,
  type ProbeReadings,
  WRONG_FIX_MINUTES,
} from '@/lib/world/incident-spec'
import { INCIDENT_SCENARIO, IncidentRun } from '@/lib/world/incident-sim'

/** Scenario numbers of the reduced run and the wording knobs; the fleet itself is world/incident-sim's INCIDENT_SCENARIO. */
const SYNTHETIC = {
  /** workers in the reduced run: two for every fault, so the denominator of "workers up" is not a cue */
  workers: 2,
  /** minutes of steady traffic before the fault starts (the Daily warms up 8-12) */
  onset: 3,
  /** minutes after the alert the table covers */
  moments: 6,
  /** keys tried before giving up on a seed: a run that does not show its fault is skipped (none of the first 1,000 verification seeds needed a redraw) */
  redraws: 64,
  /** memoized runs kept; a verification pass touches about 1,100 seeds */
  cache: 2048,
  /** nominal seconds */
  nsec: 30,
  /** `hex(seed)` */
  radix: 16,
  /** what each `first-probe` option may add after its text, drawn per option and never from the key */
  tails: ['', ' now', ' first', ' right away', ' before anything else', ' at this point'],
  /** most readings a key why quotes */
  evidence: 3,
}

const t = (text: string): PromptPart => ({ t: 'text', text })

/** Level 3 of the staircase: the transfer surface. */
const TRANSFER: Level = 3 // gen-literal-ok: level 3 of the staircase
const ALL_LEVELS = [0, 1, 2, TRANSFER] as const

/** The KCs: the diagnosis skill, then the KC each fault belongs to (spec §9.6). */
const FAULT_KC: Record<IncidentFault, KcId> = {
  'pool-shrink': KC.kvCapacity,
  'drain-stall': KC.admissionScheduling,
  'node-death': KC.capacityPlanning,
  'tenant-burst': KC.prefillDecodeInterference,
}
const FAMILY_KCS: KcId[] = [KC.incidentDiagnosis, ...INCIDENT_FAULTS.map((f) => FAULT_KC[f])]

const VARIANTS: VariantSpec[] = [
  { id: 'name-fault', title: 'Name the fault from the telemetry', kcs: FAMILY_KCS, levels: ALL_LEVELS, nsec: SYNTHETIC.nsec },
  { id: 'first-probe', title: 'The first probe in USE order', kcs: FAMILY_KCS, levels: ALL_LEVELS, nsec: SYNTHETIC.nsec },
  { id: 'fix-for', title: 'The fix for the fault', kcs: FAMILY_KCS, levels: ALL_LEVELS, nsec: SYNTHETIC.nsec },
]
const spec = (id: string): VariantSpec => VARIANTS.find((x) => x.id === id)!

/* ------------------------------ the fixed option sets ------------------------------ */

/** Short names for the whys. */
const SHORT: Record<IncidentFault, string> = {
  'pool-shrink': 'a pool shrink',
  'drain-stall': 'a drain stall',
  'node-death': 'a node death',
  'tenant-burst': 'a tenant burst',
}

/** What each fault is, as a subject for "would leave ...". */
const SUBJECT: Record<IncidentFault, string> = {
  'pool-shrink': 'A shrunk KV pool',
  'drain-stall': 'A stalled intake drain',
  'node-death': 'A dead worker',
  'tenant-burst': 'A flood of long prompts from one tenant',
}

/** The line a key why opens with. */
const GIST: Record<IncidentFault, string> = {
  'pool-shrink': 'The KV pool is the limit',
  'drain-stall': 'Requests are not leaving the intake',
  'node-death': 'A worker is gone and the survivor carries the whole load',
  'tenant-burst': "One tenant's long prompts stall everyone's decode",
}

/** `name-fault` options, in catalog order. Two names carry an acronym and two do not, so the acronym flag isolates nothing. */
const FAULT_TEXT: Record<IncidentFault, string> = {
  'pool-shrink': 'The KV pool shrank',
  'drain-stall': 'The intake queue stopped draining',
  'node-death': 'A GPU worker died',
  'tenant-burst': 'One tenant is flooding long prompts',
}

/** `fix-for` options, one per fault; the same pairing of acronyms. */
const FIX_TEXT: Record<FixId, string> = {
  'restore-pool': 'Restore the KV memory fraction',
  'restore-drain': 'Restore the intake drain rate',
  'replace-node': 'Replace the dead GPU node',
  'limit-tenant': "Cap the noisy tenant's admissions",
}

/** `first-probe` options before their tails: seven words each, 36 to 44 characters, no acronym, digit, colon or hedge word. */
const PROBE_TEXT: Record<ProbeId, string> = {
  intake: "Check the intake queue's depth and drain",
  admission: 'Check the waiting list and the headroom',
  kv: 'Check how many cache blocks remain free',
  workers: 'Check which workers are up and stepping',
  latency: 'Check the latency percentiles by prompt size',
  errors: 'Check requests that were shed or lost',
}

/* ------------------------------ the reduced run ------------------------------ */

/** The table's columns: the moment, then one metric per probe. */
const MOMENT = 'After the alert'
const METRIC: Record<ProbeId, string> = {
  intake: 'Intake queue',
  admission: 'Waiting list',
  kv: 'KV free %',
  workers: 'Workers up',
  latency: 'TTFT / TPOT p95',
  errors: 'Shed',
}

/** The six minutes after the alert: per-worker means, formatted as the table shows them. */
interface Telemetry {
  /** the key `generateIncident` was given: the seed's hex, or the hex and a redraw count */
  key: string
  fault: IncidentFault
  /** rows of [moment, intake, waiting, kv free %, workers up, ttft / tpot, shed] */
  rows: (string | number)[][]
}

const sims = new Map<string, Telemetry>()

const hex = (seed: number): string => seed.toString(SYNTHETIC.radix)

const mean = (xs: (number | null)[]): number => {
  const live = xs.filter((x): x is number => x !== null)
  return live.length === 0 ? 0 : live.reduce((a, b) => a + b, 0) / live.length
}
const round = (x: number, places: number): number => Math.round(x * places) / places
/** A p95 of 0 means no outcome that minute. */
const shown = (x: number, digits?: number): string => (x > 0 ? formatNumber(x, digits) : '–')

/**
 * Runs `incident` reduced and returns its table, or null when its five table probes do not classify as
 * its fault (the run is then not a faithful example of it).
 */
function simulate(key: string, incident: IncidentSpec): Telemetry | null {
  const reduced: IncidentSpec = { ...incident, workers: SYNTHETIC.workers as 2, onsetMinute: SYNTHETIC.onset }
  const run = new IncidentRun(reduced)
  const end = run.alert() + SYNTHETIC.moments
  const get = <P extends ProbeId>(p: P) => run.readings(p, end) as Extract<ProbeReadings, { probe: P }>
  const intake = get('intake')
  const admission = get('admission')
  const kv = get('kv')
  const workers = get('workers')
  const latency = get('latency')
  const errors = get('errors')
  if ([intake, admission, kv, workers, latency].some((r) => classify(r) !== EXPECTED[incident.fault][r.probe])) return null
  const from = latency.ttftP95.length - SYNTHETIC.moments
  const rows: (string | number)[][] = []
  for (let m = 0; m < SYNTHETIC.moments; m++) {
    const i = from + m
    const up = workers.up.filter((series) => series[i]).length
    rows.push([
      `+${m + 1} min`,
      round(mean(intake.depth.map((s) => s[i])), 10),
      round(mean(admission.waiting.map((s) => s[i])), 10),
      Math.round(100 * mean(kv.free.map((s) => s[i]))),
      `${up} of ${SYNTHETIC.workers}`,
      `${shown(latency.ttftP95[i])} / ${shown(latency.tpotP95[i], 2)}`,
      errors.shed[i],
    ])
  }
  return { key, fault: incident.fault, rows }
}

/** The incident a seed draws: the first key from `hex(seed)` whose reduced run shows its fault. */
function incidentFor(seed: number): Telemetry {
  const id = hex(seed)
  const hit = sims.get(id)
  if (hit) return hit
  for (let n = 0; n < SYNTHETIC.redraws; n++) {
    const key = n === 0 ? id : `${id}+${n}`
    const incident = generateIncident('sig', key)
    const tel = simulate(key, incident)
    if (!tel) continue
    if (sims.size >= SYNTHETIC.cache) sims.delete(sims.keys().next().value as string)
    sims.set(id, tel)
    return tel
  }
  throw new RangeError(`sig: no incident for seed ${seed} shows its signature in ${SYNTHETIC.redraws} draws`)
}

/** The cold cost of a table instance, without the memo: for tests/items/sig.test.ts. */
export function coldTelemetry(seed: number): Telemetry {
  sims.delete(hex(seed))
  return incidentFor(seed)
}

/* ------------------------------ the table and what it says ------------------------------ */

type Table = Extract<PromptPart, { t: 'table' }>

function tableOf(tel: Telemetry, hide: ProbeId | ''): Table {
  const at = (p: ProbeId): number => 1 + PROBE_IDS.indexOf(p) // after the moment column
  const keep = [0, ...PROBE_IDS.filter((p) => p !== hide).map(at)]
  const names = [MOMENT, ...PROBE_IDS.map((p) => METRIC[p])]
  return {
    t: 'table',
    caption: `Fleet telemetry for the ${SYNTHETIC.moments} minutes after the alert (per-worker means; synthetic fleet, times in engine ticks)`,
    columns: keep.map((i) => names[i]),
    rows: tel.rows.map((r) => keep.map((i) => r[i])),
  }
}

const tableIn = (inst: Instance): Table => inst.prompt.stem.find((p): p is Table => p.t === 'table')!

/** The last row's cell for a probe's column, or undefined when that column is hidden. */
function cell(table: Table, probe: ProbeId): string | undefined {
  const col = table.columns.indexOf(METRIC[probe])
  if (col < 0) return undefined
  const v = table.rows[table.rows.length - 1][col]
  return typeof v === 'number' ? formatNumber(v) : v
}

/** What the last row says about a probe, as a clause; undefined when the column is hidden. */
function reading(table: Table, probe: ProbeId): string | undefined {
  const v = cell(table, probe)
  if (v === undefined) return undefined
  switch (probe) {
    case 'intake':
      return `the intake queue holds ${v} of ${INCIDENT_SCENARIO.intakeCap} per worker`
    case 'admission':
      return `${v} requests wait per worker`
    case 'kv':
      return `${v} % of the KV pool is free`
    case 'workers':
      return `${v} workers are up`
    case 'latency':
      return `TTFT / TPOT p95 reads ${v}`
    case 'errors':
      return `${v} requests were shed in the last minute`
  }
}

/** A name to put mid-sentence: the label as the probe bar shows it, lowercase but for the KV. */
const probeName = (p: ProbeId): string => (p === 'kv' ? PROBES[p].label : PROBES[p].label.toLowerCase())
/** The text with its first letter lowercased, for a sentence that continues it. */
const lcFirst = (x: string): string => x.charAt(0).toLowerCase() + x.slice(1)

const joinList = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** The probes whose columns best show a fault, strongest first. */
const SHOWS: Record<IncidentFault, ProbeId[]> = {
  'pool-shrink': ['kv', 'admission', 'intake', 'workers'],
  'drain-stall': ['intake', 'errors', 'admission', 'kv'],
  'node-death': ['workers', 'admission', 'kv', 'intake'],
  'tenant-burst': ['latency', 'kv', 'admission', 'workers'],
}

/** The visible readings that show `fault`, up to a few of them. */
function evidenceFor(table: Table, fault: IncidentFault): string {
  const clauses = SHOWS[fault].map((p) => reading(table, p)).filter((c): c is string => c !== undefined)
  return joinList(clauses.slice(0, SYNTHETIC.evidence))
}

/** Why `wrong` is not it: the first visible probe where it would read differently from the true fault. */
function ruledOut(table: Table, wrong: IncidentFault, truth: IncidentFault): string {
  const probe = PROBE_IDS.find((p) => cell(table, p) !== undefined && EXPECTED[wrong][p] !== EXPECTED[truth][p])!
  return `${SUBJECT[wrong]} would leave the ${probeName(probe)} probe reading ${CATEGORY_LABELS[EXPECTED[wrong][probe]]}, but ${reading(table, probe)}.`
}

/* ------------------------------ the table variants ------------------------------ */

const alertLine = (): string =>
  `Alert: chat TTFT p95 is over its ${INCIDENT_SLO.ttft}-tick SLO on a ${SYNTHETIC.workers}-worker fleet (TPOT SLO ${INCIDENT_SLO.tpot} ticks per token). Each worker's intake queue holds up to ${INCIDENT_SCENARIO.intakeCap} requests.`

/** The fault options with their whys against `table`. */
function faultAnswer(table: Table, fault: IncidentFault): AnswerSpec {
  const options: ChoiceOption[] = INCIDENT_FAULTS.map((f) => ({
    id: f,
    text: FAULT_TEXT[f],
    why: f === fault ? `${GIST[f]}: ${evidenceFor(table, f)}.` : ruledOut(table, f, fault),
    ...(f === fault ? {} : { miss: `sig.named-${f}` }),
  }))
  return { kind: 'choice', options, correct: [fault] }
}

/** The fix options: each reverts one fault, and a wrong fix costs minutes. */
function fixAnswer(table: Table, fault: IncidentFault): AnswerSpec {
  const right = fixFor(fault)
  const options: ChoiceOption[] = (Object.keys(FIXES) as FixId[]).map((id) => {
    const reverts = FIXES[id].fault
    return {
      id,
      text: FIX_TEXT[id],
      why:
        id === right
          ? `This table shows ${SHORT[fault]}: ${evidenceFor(table, fault)}. ${FIX_TEXT[id]} reverts exactly that.`
          : `That reverts ${SHORT[reverts]}, which this table does not show. ${ruledOut(table, reverts, fault)} A wrong fix costs ${WRONG_FIX_MINUTES} incident minutes and changes nothing.`,
      ...(id === right ? {} : { miss: `sig.fixed-${reverts}` }),
    }
  })
  return { kind: 'choice', options, correct: [right] }
}

/** What a column's last row reads as, in the table's own terms: it shows shed requests, not the lost ones, and not the split by prompt length. */
function lookOf(table: Table, probe: ProbeId, fault: IncidentFault): string {
  if (probe === 'errors') return cell(table, probe) === '0' ? CATEGORY_LABELS.none : CATEGORY_LABELS.shed
  const c = EXPECTED[fault][probe]
  return c === 'tpot-up' ? 'TPOT up' : CATEGORY_LABELS[c]
}

/** The steps both table variants share: one reading per visible column, then the fault. */
function readSteps(table: Table, fault: IncidentFault): SolutionStep[] {
  const out: SolutionStep[] = PROBE_IDS.flatMap((p) => {
    const r = reading(table, p)
    return r === undefined ? [] : [{ text: [t(`${PROBES[p].label}: ${r}, which reads ${lookOf(table, p, fault)}.`)] }]
  })
  out.push({ text: [t(`Only ${SHORT[fault]} reads that way on every column you can see: ${lcFirst(FAULT_TEXT[fault])}.`)] })
  return out
}

/* ------------------------------ the first-probe variant ------------------------------ */

/** What a dashboard says when a probe reads a category, in a sentence. */
const SYMPTOM: Partial<Record<ProbeId, Partial<Record<Category, string>>>> = {
  intake: { normal: 'the intake queue is short' },
  admission: { long: "the scheduler's waiting list is long" },
  workers: { 'all-up': 'every worker is up and stepping' },
  latency: { 'ttft-up': 'TTFT p95 has tripled and TPOT is flat' },
  errors: { none: 'no request has been shed or lost' },
}
const symptomText = (o: Observation): string => SYMPTOM[o.probe]?.[o.category] ?? `the ${probeName(o.probe)} probe reads ${CATEGORY_LABELS[o.category]}`

/**
 * The glances that leave a fault undecided and a probe worth taking: every single reading, and every pair,
 * of that fault's expected categories after which the expert still has to probe.
 */
function glancesOf(fault: IncidentFault, size: 1 | 2): Observation[][] {
  const seen: Observation[] = PROBE_IDS.map((probe) => ({ probe, category: EXPECTED[fault][probe] }))
  const sets: Observation[][] = size === 1 ? seen.map((o) => [o]) : seen.flatMap((a, i) => seen.slice(i + 1).map((b) => [a, b]))
  return sets.filter((s) => expertNext(s).kind === 'probe')
}
const GLANCES: Record<IncidentFault, Observation[][][]> = Object.fromEntries(INCIDENT_FAULTS.map((f) => [f, [glancesOf(f, 1), glancesOf(f, 2)]])) as Record<IncidentFault, Observation[][][]>

/** `intake:normal+workers:all-up`: the glance as it travels in params. */
const packGlance = (g: readonly Observation[]): string => g.map((o) => `${o.probe}:${o.category}`).join('+')
function unpackGlance(s: string): Observation[] {
  return s.split('+').map((part) => {
    const [probe, category] = part.split(':')
    return { probe: probe as ProbeId, category: category as Category }
  })
}

const namesOf = (faults: readonly IncidentFault[]): string => joinList(faults.map((f) => SHORT[f]))

/** Where the suspects part ways on a probe, as clauses: "full, shedding for a drain stall; normal for a pool shrink and a node death". */
function splitText(probe: ProbeId, suspects: readonly IncidentFault[]): string {
  const groups = new Map<Category, IncidentFault[]>()
  for (const f of suspects) groups.set(EXPECTED[f][probe], [...(groups.get(EXPECTED[f][probe]) ?? []), f])
  return [...groups].map(([c, fs]) => `${CATEGORY_LABELS[c]} for ${namesOf(fs)}`).join('; ')
}

/** The probe the expert takes after `glance`; every glance in GLANCES leaves one. */
function firstProbe(glance: readonly Observation[]): ProbeId {
  const move = expertNext(glance)
  if (move.kind !== 'probe') throw new RangeError('sig: a glance that leaves no probe to take')
  return move.probe
}

function probeAnswer(glance: readonly Observation[], pads: string): AnswerSpec {
  const suspects = consistentFaults(glance)
  const key = firstProbe(glance)
  const read = new Set(glance.map((o) => o.probe))
  const options: ChoiceOption[] = PROBE_IDS.map((p, i) => {
    const text = `${PROBE_TEXT[p]}${SYNTHETIC.tails[Number(pads[i])]}`
    if (p === key) return { id: p, text, why: `Still possible: ${namesOf(suspects)}. The ${probeName(p)} probe reads ${splitText(p, suspects)}, and it is the first probe down the pipeline that tells them apart.` }
    if (read.has(p)) return { id: p, text, why: `You already have that reading: it is where the glance came from, so another ${PROBES[p].cost} incident minutes on the ${probeName(p)} probe show nothing new.`, miss: 'sig.reread-probe' }
    if (isStreetlight(p, glance)) {
      const same = CATEGORY_LABELS[EXPECTED[suspects[0]][p]]
      return { id: p, text, why: `Every suspect still in play (${namesOf(suspects)}) reads ${same} on the ${probeName(p)} probe, so it cannot tell them apart: looking there is the streetlight.`, miss: 'sig.streetlight' }
    }
    return { id: p, text, why: `It does tell the suspects apart (${splitText(p, suspects)}), but the ${probeName(key)} probe does too and sits earlier down the pipeline, and USE order takes the earliest one that separates them.`, miss: 'sig.skipped-use-order' }
  })
  return { kind: 'choice', options, correct: [key] }
}

function probeSteps(glance: readonly Observation[]): SolutionStep[] {
  const suspects = consistentFaults(glance)
  const key = firstProbe(glance)
  const idle = PROBE_IDS.filter((p) => !glance.some((o) => o.probe === p) && isStreetlight(p, glance))
  const steps: SolutionStep[] = [{ text: [{ t: 'text', text: `Still possible after what the dashboard shows: ${namesOf(suspects)}.` }] }]
  if (idle.length > 0) steps.push({ text: [{ t: 'text', text: `Skip ${joinList(idle.map(probeName))}: every suspect reads the same there, so it cannot tell them apart.` }] })
  steps.push({ text: [{ t: 'text', text: `Down the pipeline, the first probe left that tells them apart is ${probeName(key)}: ${splitText(key, suspects)}.` }] })
  return steps
}

/* ------------------------------ building an instance ------------------------------ */

/** Worked steps for the low levels: every step but the last, with one in the middle blanked at level 1 (as frag does). */
function workedFor(level: Level, calc: SolutionStep[]): SolutionStep[] | undefined {
  if (level >= 2) return undefined // gen-literal-ok: levels 0 and 1 are the worked ones
  const worked = calc.slice(0, -1)
  if (worked.length === 0) return undefined
  if (level === 1) {
    const at = Math.floor(worked.length / 2)
    return worked.map((s, i) => (i === at ? { text: s.text, blank: true } : s))
  }
  return worked
}

function finish(variant: string, level: Level, seed: number, params: Params, fault: IncidentFault, stem: PromptPart[], answer: AnswerSpec, calc: SolutionStep[]): Instance {
  const worked = workedFor(level, calc)
  return finishInstance(gen, {
    variant,
    seed,
    level,
    params,
    kcs: [KC.incidentDiagnosis, FAULT_KC[fault]],
    prompt: { stem, ...(worked ? { worked } : {}) },
    answer,
    claims: [],
    nsec: spec(variant).nsec,
  })
}

/** The probe whose column a transfer-level table leaves out: any, whatever the fault, and always leaving the faults separable. */
const hideFor = (level: Level, r: Rng): ProbeId | '' => (level === TRANSFER ? r.pick(PROBE_IDS) : '')

function makeTable(variant: 'name-fault' | 'fix-for', level: Level, seed: number, r: Rng): Instance {
  const tel = incidentFor(seed)
  const hide = hideFor(level, r)
  const table = tableOf(tel, hide)
  const params: Params = { key: tel.key, fault: tel.fault, hide }
  const ask = variant === 'name-fault' ? 'Which fault is it?' : 'Which fix reverts it?'
  const stem = [t(`${alertLine()} `), table, t(` ${ask}`)]
  const read = readSteps(table, tel.fault)
  if (variant === 'name-fault') return finish(variant, level, seed, params, tel.fault, stem, faultAnswer(table, tel.fault), read)
  const calc = [...read, { text: [t(`Its fix: ${lcFirst(FIX_TEXT[fixFor(tel.fault)])}.`)] }]
  return finish(variant, level, seed, params, tel.fault, stem, fixAnswer(table, tel.fault), calc)
}

function makeProbe(level: Level, seed: number, r: Rng): Instance {
  const key = hex(seed)
  const incident = generateIncident('sig', key)
  const pool = GLANCES[incident.fault][level === TRANSFER ? 1 : 0]
  const glance = r.pick(pool)
  const pads = PROBE_IDS.map(() => r.int(0, SYNTHETIC.tails.length - 1)).join('')
  const params: Params = { key, fault: incident.fault, glance: packGlance(glance), pads }
  const known = glance.length === 1 ? 'the dashboard shows' : 'the dashboard shows two things'
  const stem = [
    t(
      `Alert: chat TTFT p95 is over its ${INCIDENT_SLO.ttft}-tick SLO on a ${SYNTHETIC.workers}-worker fleet (a synthetic scenario). You have taken no probes yet, and ${known}: ${glance.map(symptomText).join(', and ')}. Work in USE order down the pipeline (intake, admission, KV cache, workers, latency, errors), skipping any probe that cannot tell the suspects still in play apart. Which probe do you take first?`,
    ),
  ]
  return finish('first-probe', level, seed, params, incident.fault, stem, probeAnswer(glance, pads), probeSteps(glance))
}

function make(seed: number, level: Level, variant?: string): Instance {
  const vs = resolveVariant(gen, seed, level, variant)
  const r = rngFor(gen.id, vs.id, level, seed)
  return vs.id === 'first-probe' ? makeProbe(level, seed, r) : makeTable(vs.id as 'name-fault' | 'fix-for', level, seed, r)
}

/** The solution is rebuilt from what the instance shows, so it never needs the run. */
function solution(inst: Instance): SolutionStep[] {
  const fault = inst.params.fault as IncidentFault
  if (inst.variant === 'first-probe') return probeSteps(unpackGlance(String(inst.params.glance)))
  const read = readSteps(tableIn(inst), fault)
  return inst.variant === 'name-fault' ? read : [...read, { text: [t(`Its fix: ${lcFirst(FIX_TEXT[fixFor(fault)])}.`)] }]
}

const gen: Gen = {
  id: 'sig',
  version: 1,
  title: 'Signature items: name the fault, the first probe, the fix',
  kcs: FAMILY_KCS,
  variants: VARIANTS,
  ratioRules: [],
  make,
  grade: (inst, response) => gradeResponse(inst, response),
  solution,
  pins: [],
  budgetMs: 10, // gen-literal-ok: a table instance runs a small engine scenario (spec §9.6)
}

export default gen

