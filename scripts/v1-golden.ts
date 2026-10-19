/**
 * The v1 golden fixture (docs/specs/s5.md §6.6, task S5-01, invariant I1): one sha256 per v1 surface, taken at 9aa27de
 * (wave-3's close), so every S5 PR can prove that the physics the learners already know did not move.
 *
 *   bun scripts/v1-golden.ts --check      recompute every surface and compare with tests/fixtures/fleet/v1-golden.json
 *   bun scripts/v1-golden.ts --write      create the fixture (refuses when it exists; never run in an S5 PR, §9.4 stop rule 3)
 *
 * A surface is a pure function of the repo at the commit: it runs the v1 code (`Engine`, the Acts, the fleet-ex sweeps,
 * the leaderboard harness, the Daily's incident, the `sig` family, the scheduler play, PRIMM's reference run) and the
 * result is hashed as canonical JSON (`stableStringify`: keys sorted, non-finite numbers null). Nothing here reads a
 * clock, a random source or the network; the traces come from the committed `public/traces/` files.
 *
 * `tests/fleet/v1-golden.test.ts` imports `SURFACES`, so the test and `--check` run the same code.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FLEET_EXERCISES } from '../src/lib/world/fleet-ex'
import { PRACTICE_SEED, makeRefScheduler, referenceScheduler, type RouterKind } from '../src/lib/fleet-model'
import {
  evalAct3,
  runAct1,
  runAct2,
  type ActResult,
  type FleetWeekSeeds,
  type ModuleBytes,
} from '../src/lib/fleet-week'
import { drawGradedSeeds, type GradedDraw } from '../src/lib/graded-seed'
import { runCanonicalLabHarness, runFleetBenchmark } from '../src/lib/leaderboard-harness'
import { scoreReferenceBenchmark } from '../src/lib/leaderboard'
import { stableStringify } from '../src/lib/ledger/stable'
import { parseTraceArtifact, type TraceArtifact } from '../src/lib/traces'
import {
  DAILY_EPOCH,
  dailyIncident,
  dailyNumber,
  daysFromCivil,
  parseLocalDate,
  shareString,
} from '../src/lib/world/daily'
import { PROBE_IDS, fixFor, FIX_IDS, type IncidentAction } from '../src/lib/world/incident-spec'
import { replayIncident, runExpert } from '../src/lib/world/incident-sim'
import { genSeeds, HASH_SEEDS } from './verify-generators'
import sig from '../src/lib/items/families/sig'
import { debrief, newSchedSession, runIteration, stageOf, togglePick, type SchedSession } from '../src/components/play/scheduler/session'
import { GREEDY_DRIVER, FCFS_DRIVER, checkSchedBand, parseSchedSource, practiceMinute, SCHED_PRACTICE_MINUTE_SEED } from '../src/lib/world/sched-traces'
import { REFERENCE, SCENE, runTrace, type SchedConfig } from '../src/data/forge/batching-scheduler/primm'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const FIXTURE_PATH = path.join(REPO_ROOT, 'tests/fixtures/fleet/v1-golden.json')
export const FLEET_MODEL_PATH = 'src/lib/fleet-model.ts'

/** The commit the fixture was taken at: wave-3's close, before any S5 code. */
export const BASE_COMMIT = '9aa27de'

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')

/** sha256 of the canonical JSON of a value. */
export const hashValue = (value: unknown): string => sha256Hex(stableStringify(value))

export interface Surface {
  id: string
  /** What the hash covers, in a line: printed by `--check`, kept in the fixture. */
  covers: string
  /** How many items the hash runs over (entropies, seeds, dates). */
  n: number
  /** The surface's value; a pure function of the repo. */
  compute(): Promise<unknown> | unknown
}

/* ------------------------------ inputs ------------------------------ */

/** Twenty graded-seed entropies: 0x3a12 and 0x3a13 (wave-3's receipt seeds) and the eighteen after them. */
export const ENTROPIES: readonly number[] = Array.from({ length: 20 }, (_, i) => 0x3a12 + i)

/** The six wave-3 fleet exercises, by id and in the order they shipped; S5's v2 exercises are not v1 surfaces. */
export const V1_EXERCISES = ['knee', 'pd-split', 'broken-bench', 'push-luck', 'straggler', 'timing-oracle'] as const

/** Seeds 0-19 for every sweep. */
export const SWEEP_SEEDS: readonly number[] = Array.from({ length: 20 }, (_, i) => i)

/** Thirty Daily dates from `DAILY_EPOCH`, the epoch included. */
export const DAILY_DATES: readonly string[] = (() => {
  const epoch = parseLocalDate(DAILY_EPOCH)
  if (!epoch) throw new Error(`DAILY_EPOCH ${DAILY_EPOCH} is not a date`)
  const day0 = daysFromCivil(epoch)
  return Array.from({ length: 30 }, (_, i) => new Date((day0 + i) * 86_400_000).toISOString().slice(0, 10))
})()

const NO_MODULES: ModuleBytes = { sched: null, mgr: null, queue: null }
const PRACTICE: FleetWeekSeeds = { seed: null, trace: PRACTICE_SEED, faults: 0xfa17, deathPick: 0, deathTick: 400 }

/** The graded draws, made once for the four surfaces that read them (each is a few band simulations). */
let draws: Promise<GradedDraw[]> | null = null
const gradedDraws = (): Promise<GradedDraw[]> => (draws ??= Promise.resolve(ENTROPIES.map((e) => drawGradedSeeds(e))))

const REPO = (rel: string): string => path.join(REPO_ROOT, rel)

async function benchmarkTraces(): Promise<{ burstgpt: TraceArtifact; lmsysShape: TraceArtifact }> {
  const read = async (file: string) => parseTraceArtifact(await Bun.file(REPO(`public/traces/${file}`)).json())
  const [burstgpt, lmsysShape] = await Promise.all([read('burstgpt-v2-busiest-hour.json'), read('lmsys-chat-1m-published-shape.json')])
  return { burstgpt, lmsysShape }
}

/* ------------------------------ surfaces ------------------------------ */

const ACT2_CHOICES = (['rr', 'jsq', 'prefix'] as const satisfies readonly RouterKind[]).flatMap((router) => ([2, 4] as const).map((workers) => ({ workers, router })))

/** A scripted Daily play that diagnoses by the book: every probe in the menu's order, then the named fault's fix. */
const thorough = (fault: Parameters<typeof fixFor>[0]): IncidentAction[] => [
  { kind: 'hypothesis', fault: 'unsure' },
  ...PROBE_IDS.map((probe): IncidentAction => ({ kind: 'probe', probe })),
  { kind: 'hypothesis', fault },
  { kind: 'fix', fix: fixFor(fault) },
]

/** A scripted play that guesses: two probes, the wrong fix (the first in the menu that is not the fault's), then waits. */
const flailing = (fault: Parameters<typeof fixFor>[0]): IncidentAction[] => [
  { kind: 'probe', probe: PROBE_IDS[0] },
  { kind: 'probe', probe: PROBE_IDS[1] },
  { kind: 'fix', fix: FIX_IDS.find((f) => f !== fixFor(fault)) ?? FIX_IDS[0] },
  { kind: 'wait' },
  { kind: 'wait' },
]

async function playGhost(): Promise<SchedSession> {
  const source = await parseSchedSource(
    await Bun.file(REPO('public/traces/burstgpt-v2-busiest-minute.json')).json(),
    await Bun.file(REPO('public/traces/burstgpt-v2-busiest-hour.json')).json(),
  )
  let s = newSchedSession(practiceMinute(source))
  for (let guard = 0; guard < 500; guard++) {
    const st = stageOf(s)
    if (st.kind === 'over') return debrief(s)
    for (const id of referenceScheduler(st.frame.view).admit) s = togglePick(s, id)
    s = runIteration(s)
  }
  throw new Error('the scheduler play did not end')
}

export const SURFACES: readonly Surface[] = [
  {
    id: 'graded-seeds',
    covers: 'drawGradedSeeds on 20 entropies (0x3a12-0x3a25): the seeds, the band outcome and the draw count',
    n: ENTROPIES.length,
    compute: async () => (await gradedDraws()).map((d, i) => ({ entropy: ENTROPIES[i], ...d })),
  },
  {
    id: 'act1',
    covers: 'runAct1 with no modules on the practice scenario and on 20 graded seeds: the whole ActResult (metrics, values, verdict)',
    n: ENTROPIES.length + 1,
    compute: async () => {
      const out: { entropy: number | null; result: ActResult }[] = [{ entropy: null, result: await runAct1(NO_MODULES, PRACTICE) }]
      for (const [i, d] of (await gradedDraws()).entries()) out.push({ entropy: ENTROPIES[i], result: await runAct1(NO_MODULES, d.seeds) })
      return out
    },
  },
  {
    id: 'act2',
    covers: 'runAct2 for every worker count x router on the practice scenario and on 20 graded seeds: the whole ActResult',
    n: (ENTROPIES.length + 1) * ACT2_CHOICES.length,
    compute: async () => {
      const cases: { entropy: number | null; seeds: FleetWeekSeeds }[] = [
        { entropy: null, seeds: PRACTICE },
        ...(await gradedDraws()).map((d, i) => ({ entropy: ENTROPIES[i], seeds: d.seeds })),
      ]
      const out: { entropy: number | null; choice: (typeof ACT2_CHOICES)[number]; result: ActResult }[] = []
      for (const c of cases) for (const choice of ACT2_CHOICES) out.push({ entropy: c.entropy, choice, result: await runAct2(NO_MODULES, choice, c.seeds) })
      return out
    },
  },
  {
    id: 'act3',
    covers: 'evalAct3 on the practice scenario and on 20 graded seeds: every hardware option priced, the best value, the receipt values',
    n: ENTROPIES.length + 1,
    compute: async () => [
      { entropy: null, eval: evalAct3(PRACTICE) },
      ...(await gradedDraws()).map((d, i) => ({ entropy: ENTROPIES[i], eval: evalAct3(d.seeds) })),
    ],
  },
  ...V1_EXERCISES.map(
    (id): Surface => ({
      id: `fleet-ex:${id}`,
      covers: `the ${id} exercise on seeds 0-19: sweep, truth, band, scene${id === 'timing-oracle' ? ' and ask' : ''}`,
      n: SWEEP_SEEDS.length,
      compute: () =>
        SWEEP_SEEDS.map((seed) => {
          const def = FLEET_EXERCISES[id]
          const results = def.sweep(seed)
          return { seed, results, truth: def.truth(results), band: def.band(results), scene: def.scene(seed), ask: def.ask?.(seed) ?? null }
        }),
    }),
  ),
  {
    id: 'leaderboard-reference',
    covers: 'scoreReferenceBenchmark on the committed BurstGPT and LMSYS-shape traces, and the Fleet leg (runFleetBenchmark) it scores: ticks, stats, goodput',
    n: 1,
    compute: async () => {
      const { burstgpt, lmsysShape } = await benchmarkTraces()
      const { fleet, total } = runFleetBenchmark(makeRefScheduler(), burstgpt)
      return {
        scores: scoreReferenceBenchmark(burstgpt, lmsysShape),
        fleet: { total, done: fleet.done, ticks: fleet.tick, stats: fleet.stats(), goodput: fleet.goodput(total), ttftP95: fleet.ttftP95() },
      }
    },
  },
  {
    id: 'leaderboard-lab',
    covers: 'runCanonicalLabHarness with the JS reference scheduler (the lab leg without the Rust lab): checks, the seven scenarios, scores',
    n: 1,
    compute: async () => {
      const { burstgpt, lmsysShape } = await benchmarkTraces()
      return runCanonicalLabHarness(() => makeRefScheduler(), burstgpt, lmsysShape)
    },
  },
  {
    id: 'daily',
    covers: 'the 30 Daily dates from DAILY_EPOCH: the incident, the expert run (burn, probes, steps), two scripted plays\' outcomes, the share strings',
    n: DAILY_DATES.length,
    compute: () =>
      DAILY_DATES.map((date) => {
        const spec = dailyIncident(date)
        const n = dailyNumber(date)
        const expert = runExpert(spec)
        return {
          date,
          n,
          spec,
          expert,
          thorough: replayIncident(spec, thorough(spec.fault)),
          flailing: replayIncident(spec, flailing(spec.fault)),
          share: shareString(n, expert.outcome.probes.length, expert.outcome.burn),
          shareOnMyEngine: shareString(n, expert.outcome.probes.length, expert.outcome.burn, true),
        }
      }),
  },
  {
    id: 'sig',
    covers: 'the sig family on the seeds of its own hash fixture (verify-generators\' HASH_SEEDS from base 0x68617368), every variant at every level: params, prompt (the telemetry tables) and answer',
    n: HASH_SEEDS,
    compute: () => {
      const seeds = genSeeds(HASH_SEEDS, 0x68617368) // verify-generators.ts HASH_SEED_BASE (not exported)
      return sig.variants.map((v) => ({
        variant: v.id,
        instances: v.levels.flatMap((level) =>
          seeds.map((seed) => {
            const i = sig.make(seed, level, v.id)
            return { level, seed, params: i.params, prompt: i.prompt, answer: i.answer }
          }),
        ),
      }))
    },
  },
  {
    id: 'scheduler-play',
    covers: 'the scheduler play\'s practice minute (seed 150): the trace, the five band rules with the ghost, FCFS and greedy runs, and the reference played to the debrief',
    n: 1,
    compute: async () => {
      const source = await parseSchedSource(
        await Bun.file(REPO('public/traces/burstgpt-v2-busiest-minute.json')).json(),
        await Bun.file(REPO('public/traces/burstgpt-v2-busiest-hour.json')).json(),
      )
      const trace = practiceMinute(source)
      const played = await playGhost()
      return {
        seed: SCHED_PRACTICE_MINUTE_SEED,
        trace,
        band: checkSchedBand(trace),
        drivers: [GREEDY_DRIVER.name, FCFS_DRIVER.name],
        debrief: { provenance: played.provenance, line: played.line, summary: played.summary },
      }
    },
  },
  {
    id: 'primm',
    covers: 'PRIMM\'s reference run, runTrace(REFERENCE) (recomputed: REFERENCE_RUN is not exported), and the run of every order x headroom x report on its seed',
    n: 1,
    compute: () => {
      const grid: SchedConfig[] = (['sjf', 'fcfs'] as const).flatMap((order) =>
        ([0, 16, 48] as const).flatMap((headroom) => (['met', 'forced'] as const).map((report) => ({ ...REFERENCE, order, headroom, report }))),
      )
      return { scene: SCENE, reference: runTrace(REFERENCE), grid: grid.map(runTrace) }
    },
  },
]

/* ------------------------------ the fixture ------------------------------ */

export interface GoldenFixture {
  header: string
  base: string
  fleetModel: { path: string; sha256: string }
  surfaces: Record<string, { sha256: string; n: number; covers: string }>
}

export const FIXTURE_HEADER =
  `The v1 golden fixture (docs/specs/s5.md section 6.6, S5-01): one sha256 per v1 surface, taken at ${BASE_COMMIT} (wave-3's close). ` +
  'It is NEVER regenerated in an S5 PR: a changed hash means v1 moved, and that blocks the merge with no exception (section 9.4, stop rule 3). ' +
  'Fix the code that moved, not the hash. `bun scripts/v1-golden.ts --check` and tests/fleet/v1-golden.test.ts recompute every surface; ' +
  '`--write` only creates a missing file.'

export async function readFixture(): Promise<GoldenFixture> {
  return (await Bun.file(FIXTURE_PATH).json()) as GoldenFixture
}

export async function fleetModelSha(): Promise<string> {
  return sha256Hex(new Uint8Array(await Bun.file(REPO(FLEET_MODEL_PATH)).arrayBuffer()))
}

/** Compute one surface: its hash and how long it took. */
export async function runSurface(s: Surface): Promise<{ sha256: string; ms: number }> {
  const t0 = performance.now()
  const sha256 = hashValue(await s.compute())
  return { sha256, ms: performance.now() - t0 }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const write = args.has('--write')
  if (write === args.has('--check') || args.size !== 1) {
    console.error('usage: bun scripts/v1-golden.ts --check | --write')
    process.exit(2)
  }
  if (write && existsSync(FIXTURE_PATH)) {
    console.error(`${FIXTURE_PATH} exists. The fixture is never regenerated in an S5 PR (spec §9.4); delete it by hand only to re-take it at a new base.`)
    process.exit(2)
  }

  const t0 = performance.now()
  const surfaces: GoldenFixture['surfaces'] = {}
  const fixture = write ? null : await readFixture()
  const problems: string[] = []
  for (const s of SURFACES) {
    const { sha256, ms } = await runSurface(s)
    surfaces[s.id] = { sha256, n: s.n, covers: s.covers }
    const want = fixture?.surfaces[s.id]?.sha256
    const verdict = fixture === null ? 'taken' : want === sha256 ? 'ok' : 'DRIFT'
    if (fixture && want !== sha256) problems.push(`${s.id}: ${want ?? '(no row)'} -> ${sha256}`)
    console.log(`${verdict.padEnd(5)} ${s.id.padEnd(24)} ${sha256.slice(0, 16)}  ${(ms / 1000).toFixed(2).padStart(6)} s`)
  }
  const model = await fleetModelSha()
  if (fixture) {
    if (fixture.fleetModel.sha256 !== model) problems.push(`${FLEET_MODEL_PATH}: ${fixture.fleetModel.sha256} -> ${model}`)
    for (const id of Object.keys(fixture.surfaces)) if (!SURFACES.some((s) => s.id === id)) problems.push(`${id}: a fixture row with no surface`)
  }
  console.log(`${fixture && fixture.fleetModel.sha256 === model ? 'ok   ' : fixture ? 'DRIFT' : 'taken'} ${FLEET_MODEL_PATH.padEnd(24)} ${model.slice(0, 16)}`)
  const seconds = (performance.now() - t0) / 1000
  console.log(`total ${seconds.toFixed(1)} s over ${SURFACES.length} surfaces`)

  if (write) {
    const doc: GoldenFixture = { header: FIXTURE_HEADER, base: BASE_COMMIT, fleetModel: { path: FLEET_MODEL_PATH, sha256: model }, surfaces }
    await Bun.write(FIXTURE_PATH, `${JSON.stringify(doc, null, 2)}\n`)
    console.log(`wrote ${path.relative(REPO_ROOT, FIXTURE_PATH)}`)
    return
  }
  if (problems.length > 0) {
    console.error(`v1 moved:\n  ${problems.join('\n  ')}\nA changed v1 hash blocks the merge (spec §9.4); fix the code, never the fixture.`)
    process.exit(1)
  }
  if (seconds >= 60) {
    console.error(`the check took ${seconds.toFixed(1)} s; the budget is 60 s`)
    process.exit(1)
  }
  console.log('OK: every v1 surface and fleet-model.ts match the fixture')
}

if (import.meta.main) await main()
