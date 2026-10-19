/**
 * The physics tab on /freshness (docs/specs/s5.md §5.8, §8.3; S5-11): what the gate decided for each physics v2 row,
 * read from the generated `docs/physics/report.json`, `decisions.json` and `controls.json` and the lazy claim groups,
 * which load when the tab opens and never earlier (the three files are chunks of their own, fetched beside this one).
 * The tab renders the gate's numbers whichever way it went: when no row is calibrated it reads "why the Fleet's clock
 * stays flat", over the same tables.
 *
 * Every number on it is a claim chip (`data-claim`) or a report value (`data-report`, StepCard's `Val`); the one
 * exemption is the protocol's selection disclosure, quoted verbatim with its prototype figure (S5-D59). Sentences carry
 * their numbers as `{file:path}` and `{#claim}` references that `Tpl` resolves against the files and the registry, so a
 * sentence cannot hold a number of its own. A fitted parameter is shown as this fit's split, with its refit range, never
 * as a hardware fact (S5-D5); the prototype's other forms, H200 and MI300X reach the page in words only.
 * tests/changes/physics-tab.test.ts holds all of it.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ClaimValue } from '@/components/ClaimValue'
import RouteFallback from '@/components/RouteFallback'
import StepCard, { fmtNum, Val } from '@/components/physics/StepCard'
import { byId, staleSince, type Claim } from '@/data/claims'
import type { StepCard as CardTerms } from '@/lib/world/physics/types'

/* ------------------------------ the files' shapes (the parts the tab reads) ------------------------------ */

type ParamKey = 'etaMem' | 'etaFlop' | 'layerUs' | 'seqUs' | 'linkGBs' | 'harnessMs'
interface Config {
  id: string
  tp: number
  conc: number
  isl: number
  osl: number
}
interface ReportPoint extends Config {
  subset: 'F' | 'H'
  measTpot: number
  outTpot: number
  tpotError: number
  runUrl: string
}
interface ReportRow {
  key: string
  status: string
  dropped: (Config & { reasons: string[] })[]
  params: Record<ParamKey, number>
  refit: Record<ParamKey, [number, number]>
  boundFlags: string[]
  gates: Record<string, { ok: boolean; detail: string }>
  stats: Record<'g1' | 'g2' | 'g3', { mean: number; p90: number }>
  r1: { worst: (Config & { error: number; runUrl: string })[] }
  eligible: { tpot: boolean; ttft: boolean }
  box: { tp: number[]; shapes: unknown[] }
  points: ReportPoint[]
}
interface WorkedExample extends Config {
  row: string
  metric: 'tpot' | 'ttft'
  derivation: string
  measuredClaim: string
  runUrl: string
  napkin: CardTerms
  card: CardTerms
  error: Record<'napkin' | 'card' | 'cardPlusHarness' | 'v1', number>
}
export interface PhysicsReport {
  fitStatus: string
  rows: ReportRow[]
  workedExamples: WorkedExample[]
  claimValues: Record<string, number>
}
export interface PhysicsDecisions {
  frontier: { killed: boolean; kill: { rule: string; trips: boolean }[] }
  findings: { nvfp4TpotGain: { tps: number[]; pairs: { fp8: string; nvfp4: string }[]; cited: { fp8: string; nvfp4: string } } }
}
export interface PhysicsControls {
  nim: { groups: { key: string }[] }
  control: { hardware: string; skipped: string | null; gates: Record<string, { ok: boolean }> }[]
}
export interface PhysicsData {
  report: PhysicsReport
  decisions: PhysicsDecisions
  controls: PhysicsControls
}

/* ------------------------------ copy ------------------------------ */

const DATASET = 'bench.inferencex.llama70b-2025-10-29'
const SNAPSHOT_DATE = DATASET.slice(-10)
/** staleSince with a clock at the end of time is the claim's expiry day, whenever the page is read */
const END_OF_TIME = new Date(8.64e15)

const ROW_NAMES: Record<string, string> = {
  'h100-vllm-0-10-2-fp8': 'H100 SXM · vLLM 0.10.2 · FP8',
  'b200-vllm-0-10-2-fp8': 'B200 · vLLM 0.10.2 · FP8',
  'b200-vllm-0-10-2-nvfp4': 'B200 · vLLM 0.10.2 · NVFP4',
}
const rowName = (key: string) => ROW_NAMES[key] ?? key

const PARAMS: [ParamKey, string, string, number, string][] = [
  ['etaMem', 'eta-mem', 'η_m, the share of the datasheet bandwidth reached reading weights and KV', 2, ''],
  ['etaFlop', 'eta-flop', 'η_f, the share of the dense peak reached in long prefills', 2, ''],
  ['layerUs', 'layer-us', 't_layer, a fixed cost per layer per step', 1, ' µs'],
  ['seqUs', 'seq-us', 't_seq, host work per running request per step', 1, ' µs'],
  ['linkGBs', 'link-gbs', 'β, the effective all-reduce bandwidth when the model is split across GPUs', 1, ' GB/s'],
  ['harnessMs', 'harness-ms', "the TTFT residual (fitted, not physics): what the engine's admission-to-first-token window misses; it stays outside the engine", 1, ' ms'],
]

const STATS = [
  ['g1', 'loo-tpot', 'mean TPOT, each fit point predicted by a refit without it'],
  ['g2', 'heldout-tpot', 'mean TPOT on the held-out points, never fitted'],
  ['g3', 'loo-ttft8k', 'median TTFT on the long-prompt fit points, leave-one-out, with the TTFT residual added'],
] as const

const LEFT_OUT =
  "speculative decoding and MTP; MoE routing and expert-parallel all-to-all; CUDA-graph batch buckets; tile and wave quantisation; attention-kernel path changes (sliding window, MLA); clocks and thermals; preemption cost (the box excludes it); prefix caching (the harness ran with it off); disaggregated KV transfer; multi-node serving; any model, precision, engine release or token budget other than the row's"

/** docs/physics/protocol.md §9, verbatim (tests/changes/physics-tab.test.ts compares the two). */
const DISCLOSURE =
  'The card form (layers·t_layer + seqs·t_seq + linkBytes ÷ β + max(memBytes ÷ (η_m·BW), FLOPs ÷ (η_f·F))) was chosen among about ten candidate forms on this same 2025-10-29 snapshot by the S5 design work. Three prototype fits (the "minimal", "faithful" and "learner" designs) had already been scored on this snapshot before this protocol was written, and the gate statistic was chosen after those scores were seen. On rows no design looked at (MI325X and MI355X, vLLM FP8, in the same snapshot) the frozen card form fails G1\'s p90 bar on MI325X (19.1 % in the prototype). The in-sample margins are therefore optimistic. The physical filters, the fit/held-out split and the held-out points were also seen by the prototype fits; G2 is held out from the in-repo fit, not from the choice of form. The nightly out-of-sample control and the frozen-form report on the next snapshot are the prospective tests, and the physics tab prints both.'

const NIM_LABEL: Record<string, string> = { 'h100-tp2': '70B over two H100s', 'h100-tp4': '70B over four H100s', '8b-tp1': '8B on one H100' }

const h3 = 'mt-10 font-mono text-[11px] uppercase tracking-[0.14em] text-text-2'
const h5 = 'mt-5 text-body-sm font-semibold text-text-1'
const prose = 'max-w-3xl text-body leading-relaxed text-text-2'
const mono = 'font-mono text-[11px] text-text-2'
const th = 'p-2 text-left font-medium text-text-3'
const td = 'whitespace-nowrap p-2 text-left align-top'

/* ------------------------------ references: every number comes through here ------------------------------ */

/** A report string (a gate's detail, a rule), printed as the file has it. */
function Txt({ at, s }: { at: string; s: string }) {
  return <span data-report={at}>{s}</span>
}

/** A claim chip; `scale` and `digits` print the claim's value in the unit the sentence uses. */
function Chip({ id, scale = 1, digits, unit, prefix = '' }: { id: string; scale?: number; digits?: number; unit?: string; prefix?: string }) {
  const format = (c: Claim) => {
    const v = (c.value as number) * scale
    const u = unit ?? (c.unit === undefined || c.unit === 'ratio' ? '' : c.unit === '×' ? '×' : ` ${c.unit}`)
    return prefix + (digits === undefined ? v.toLocaleString('en-US') : fmtNum(v, digits)) + u
  }
  return (
    <span data-claim={id} data-scale={scale}>
      <ClaimValue id={id} format={format} className="text-accent" />
    </span>
  )
}

function lookup(data: PhysicsData, ref: string): unknown {
  const [file, path] = ref.split(':')
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], data[file as keyof PhysicsData])
}

/**
 * A sentence with references: `{report:rows.0.nFit}` is a report value (`|digits|unit|scale` optional, digits 0 by
 * default) or a report string; `{#claim.id}` is a chip (`|digits|unit|scale|prefix`).
 */
function Tpl({ d, t }: { d: PhysicsData; t: string }) {
  return (
    <>
      {t.split(/\{([^{}]+)\}/).map((part, j) => {
        if (j % 2 === 0) return part
        const [ref, digits, unit, scale, prefix] = part.split('|')
        const n = digits ? Number(digits) : undefined
        if (Number.isNaN(n)) throw new Error(`physics tab: "${part}" has no digit count`)
        if (ref.startsWith('#')) return <Chip key={j} id={ref.slice(1)} digits={n} unit={unit || undefined} scale={scale ? Number(scale) : 1} prefix={prefix} />
        const v = lookup(d, ref)
        return typeof v === 'number' ? <Val key={j} at={ref} v={v} digits={n ?? 0} unit={unit} scale={scale ? Number(scale) : 1} /> : <Txt key={j} at={ref} s={String(v)} />
      })}
    </>
  )
}

/** The claim when the registry holds it at the value the report reproduces; otherwise the report's own number. */
const held = (report: PhysicsReport, id: string) => byId[id] !== undefined && report.claimValues[id] === byId[id].value

const cfg = (at: string) => `TP {${at}.tp} · {${at}.conc} users · {${at}.isl}/{${at}.osl} tokens`

function RunLink({ at, id, url }: { at: string; id: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-info underline underline-offset-2">
      <Txt at={at} s={id} />
      <span className="sr-only"> (its benchmark run)</span>
    </a>
  )
}

/** A table that scrolls inside its own region, so the page never scrolls sideways. */
function Scroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} data-scroll-region className="mt-3 overflow-x-auto rounded-md border border-line">
      <table className={`w-full min-w-[34rem] ${mono}`}>
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  )
}

const Head = ({ cols }: { cols: string[] }) => (
  <thead>
    <tr className="border-b border-line">
      {cols.map((c) => (
        <th key={c} scope="col" className={th}>
          {c}
        </th>
      ))}
    </tr>
  </thead>
)

/* ------------------------------ one row ------------------------------ */

function RowSection({ d, row, i }: { d: PhysicsData; row: ReportRow; i: number }) {
  const at = `report:rows.${i}`
  const calibrated = row.status === 'calibrated'
  const claim = (name: string) => `phys.${row.key}.${name}`
  const chipOr = (id: string, path: string, digits: number, unit: string, scale: number) =>
    calibrated && held(d.report, id) ? `{#${id}|${digits}|${unit}}` : `{${path}|${digits}|${unit}|${scale}}`
  const table = (subset: 'F' | 'H', title: string, label: string) => (
    <details className="mt-1">
      <summary className="cursor-pointer py-2 text-body-sm text-text-1">
        <Tpl d={d} t={title} />
      </summary>
      <Scroll label={`${rowName(row.key)}: ${label}`}>
        <Head cols={['point (run)', 'configuration', 'measured TPOT', subset === 'F' ? 'predicted without it' : 'predicted', 'error']} />
        <tbody>
          {row.points.map((p, j) => {
            if (p.subset !== subset) return null
            const pt = `${at}.points.${j}`
            return (
              <tr key={p.id} className="border-b border-line/60">
                <th scope="row" className={`${td} font-normal`}>
                  <RunLink at={`${pt}.id`} id={p.id} url={p.runUrl} />
                </th>
                {[cfg(pt), `{${pt}.measTpot|2| ms|1000}`, `{${pt}.outTpot|2| ms|1000}`, `{${pt}.tpotError|1| %|100}`].map((t) => (
                  <td key={t} className={td}>
                    <Tpl d={d} t={t} />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </Scroll>
    </details>
  )
  return (
    <section aria-labelledby={`physics-${row.key}`} data-row={row.key} className="rounded-xl border border-line bg-surface-1 p-4 sm:p-6">
      <h4 id={`physics-${row.key}`} className="text-lg font-semibold text-text-1">
        {rowName(row.key)}
      </h4>
      <p className="mt-2 font-mono text-[12px] text-text-2" data-verdict={row.status}>
        verdict:{' '}
        <strong className={calibrated ? 'text-accent' : 'text-amber'}>
          <Txt at={`${at}.status`} s={row.status} />
        </strong>{' '}
        · TPOT {row.eligible.tpot ? '' : 'not '}eligible, TTFT {row.eligible.ttft ? '' : 'not '}eligible · <Txt at="report:fitStatus" s={d.report.fitStatus} />
      </p>
      <p className="mt-2 text-body-sm text-text-2">
        <Tpl d={d} t={`{${at}.selected} published points selected, {${at}.kept} kept after the protocol's filters: {${at}.nFit} fit the card and {${at}.nHeldOut} are held out.`} />
      </p>
      <ul className={`mt-3 space-y-1 ${mono}`}>
        {Object.entries(row.gates).map(([g, gate]) => (
          <li key={g}>
            <span className={gate.ok ? 'text-accent' : 'text-amber'}>
              {g} {gate.ok ? 'passes' : 'fails'}
            </span>
            : <Txt at={`${at}.gates.${g}.detail`} s={gate.detail} />
          </li>
        ))}
      </ul>

      <h5 className={h5}>How well the card predicts</h5>
      <ul className="mt-2 space-y-1 text-body-sm text-text-2">
        {STATS.map(([s, name, what]) => (
          <li key={s}>
            <Tpl d={d} t={`${what}: mean error ${chipOr(claim(`${name}-mean`), `${at}.stats.${s}.mean`, 1, ' %', 100)}, p90 ${chipOr(claim(`${name}-p90`), `${at}.stats.${s}.p90`, 1, ' %', 100)}`} />
          </li>
        ))}
      </ul>

      <h5 className={h5}>This fit's parameters</h5>
      <p className="mt-1 text-body-sm text-text-3">
        This fit's split of one snapshot, not hardware facts: other equally good forms split it differently, so the course grades none of them.
        Each range is where the leave-one-out refits put it.
      </p>
      <ul className="mt-2 space-y-1.5 text-body-sm text-text-2">
        {PARAMS.map(([key, name, meaning, digits, unit]) => (
          <li key={key}>
            <Tpl
              d={d}
              t={`${meaning}: ${chipOr(claim(name), `${at}.params.${key}`, digits, unit, 1)} (this fit's refit range {${at}.refit.${key}.0|${digits}}–{${at}.refit.${key}.1|${digits}|${unit}})`}
            />
          </li>
        ))}
      </ul>
      {row.boundFlags.length > 0 && (
        <p className="mt-2 text-body-sm text-amber">
          At a bound of the fit: <Tpl d={d} t={row.boundFlags.map((_, j) => `{${at}.boundFlags.${j}}`).join(', ')} />
        </p>
      )}

      <h5 className={h5}>The box</h5>
      <p className="mt-1 text-body-sm text-text-2">
        <Tpl
          d={d}
          t={`The engine runs this row calibrated only inside it: TP ${row.box.tp.map((_, j) => `{${at}.box.tp.${j}}`).join(', ')}; up to {${at}.box.maxNumSeqs} sequences; a budget of {${at}.box.batchTokens} tokens per step; prompt/output shapes ${row.box.shapes.map((_, j) => `{${at}.box.shapes.${j}.isl}/{${at}.box.shapes.${j}.osl}`).join(', ')}. Outside it the engine refuses calibrated mode.`}
        />
      </p>
      <ul className={`mt-2 space-y-0.5 ${mono}`}>
        {row.dropped.map((x, j) => (
          <li key={x.id}>
            <Tpl d={d} t={`dropped {${at}.dropped.${j}.id}: ${x.reasons.map((_, k) => `{${at}.dropped.${j}.reasons.${k}}`).join('; ')}`} />
          </li>
        ))}
      </ul>

      <h5 className={h5}>Worst points</h5>
      <ul className={`mt-1 space-y-0.5 ${mono}`}>
        {row.r1.worst.map((w, j) => (
          <li key={w.id}>
            <RunLink at={`${at}.r1.worst.${j}.id`} id={w.id} url={w.runUrl} /> · <Tpl d={d} t={`${cfg(`${at}.r1.worst.${j}`)} · error {${at}.r1.worst.${j}.error|1| %|100}`} />
          </li>
        ))}
      </ul>

      <div className="mt-4">
        {table('F', `Leave-one-out: the {${at}.nFit} fit points`, 'leave-one-out over the fit points')}
        {table('H', `Held out: the {${at}.nHeldOut} points never fitted`, 'held-out points')}
      </div>
    </section>
  )
}

/* ------------------------------ the worked examples ------------------------------ */

function Example({ d, ex, i }: { d: PhysicsData; ex: WorkedExample; i: number }) {
  const at = `report:workedExamples.${i}`
  const ttft = ex.metric === 'ttft'
  const letter = String.fromCharCode(65 + i)
  const lines: [string, string, keyof WorkedExample['error']][] = [
    ['datasheet bound (napkin)', 'napkinMs', 'napkin'],
    ["this fit's card", 'cardMs', 'card'],
    ...(ttft ? [['card + the fitted TTFT residual', 'cardPlusHarnessMs', 'cardPlusHarness'] as [string, string, 'cardPlusHarness']] : []),
    ["v1's flat ticks", 'v1Ms', 'v1'],
  ]
  return (
    <article className="rounded-xl border border-line bg-surface-1 p-4 sm:p-6" data-example={ex.id}>
      <h4 className="text-body font-semibold text-text-1">
        Example {letter}: {ttft ? 'a prefill step' : 'a decode step'}, {rowName(ex.row)}
      </h4>
      <p className={`mt-1 ${mono}`}>
        <Tpl d={d} t={cfg(at)} /> · point <RunLink at={`${at}.id`} id={ex.id} url={ex.runUrl} />
      </p>
      <p className="mt-2 font-mono text-[11px] text-text-3">
        <Txt at={`${at}.derivation`} s={ex.derivation} />
      </p>
      <div className="mt-4">
        <StepCard
          id={`step-card-${ex.id}`}
          caption={`Example ${letter}, the step's terms: the datasheet bound beside this fit's card`}
          columns={[
            { label: 'datasheet bound', card: ex.napkin, at: `${at}.napkin` },
            { label: "this fit's card", card: ex.card, at: `${at}.card` },
          ]}
        />
      </div>
      <Scroll label={`Example ${letter}: predictions beside the measured value`}>
        <Head cols={[ttft ? 'median TTFT' : 'mean TPOT', 'value', 'error']} />
        <tbody>
          {lines.map(([label, ms, err]) => (
            <tr key={err} className="border-b border-line/60">
              <th scope="row" className={`${td} font-normal text-text-1`}>
                {label}
              </th>
              <td className={td}>
                <Tpl d={d} t={`{${at}.${ms}|2| ms}`} />
              </td>
              <td className={td}>
                <Val at={`${at}.error.${err}`} v={ex.error[err]} scale={100} digits={1} unit=" %" sign />
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row" className={`${td} font-normal text-text-1`}>
              measured
            </th>
            <td className={td}>
              <Tpl d={d} t={byId[ex.measuredClaim] ? `{#${ex.measuredClaim}|2| ms|1000}` : `{${at}.measuredMs|2| ms}`} />
            </td>
            <td className={td}>InferenceX</td>
          </tr>
        </tbody>
      </Scroll>
    </article>
  )
}

/* ------------------------------ the page ------------------------------ */

export function PhysicsView(d: PhysicsData) {
  const { report, decisions, controls } = d
  const positive = report.rows.some((r) => r.status === 'calibrated')
  const dataset = byId[DATASET]
  const fr = decisions.frontier
  const gain = decisions.findings.nvfp4TpotGain
  const cited = gain.pairs.findIndex((p) => p.fp8 === gain.cited.fp8 && p.nvfp4 === gain.cited.nvfp4)
  const g = 'decisions:findings.'
  const t = (text: string) => <Tpl d={d} t={text} />

  return (
    <div data-physics-tab={positive ? 'positive' : 'negative'}>
      <h2 className="text-2xl font-semibold tracking-tight text-text-1">
        {positive ? 'Physics v2: what one engine step costs, and how well the card predicts it' : "Why the Fleet's clock stays flat"}
      </h2>
      <p className={`mt-3 ${prose}`}>
        {positive
          ? "The Fleet's v1 clock is flat: every iteration takes the same tick, whatever it carries. Physics v2 prices each step with one card, step = layers·t_layer + seqs·t_seq + link bytes ÷ β + max(bytes ÷ (η_m·BW), FLOPs ÷ (η_f·F)), with chip and model inputs from claims and five parameters per row fitted to one published sweep. A gate written before the fit ran decides each row. Only the card's predictions are validated; its split into terms is this fit's, not a hardware fact."
          : t("No row passed the gate written before the fit ran, so the Fleet keeps v1's flat {report:workedExamples.0.v1Ms|0| ms} tick. The same tables a passing verdict would show say how far each row missed.")}
      </p>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        snapshot: vLLM 0.10.2 · InferenceX {SNAPSHOT_DATE}
        {dataset && (
          <>
            {' '}
            ({t(`{#${DATASET}|| points selected}`)}), stale since <span data-stale-of={DATASET}>{staleSince(dataset, END_OF_TIME)}</span>
          </>
        )}{' '}
        · physics id {t('{report:physId}')}
      </p>
      <p className="mt-2 font-mono text-[11px] text-text-3" data-attribution>
        Data:{' '}
        <a href="https://inferencex.semianalysis.com" target="_blank" rel="noreferrer" className="text-info underline underline-offset-2">
          InferenceX
        </a>{' '}
        by SemiAnalysis, official results as published {SNAPSHOT_DATE}. InferenceX™ is a trademark of SemiAnalysis. The fit and its predictions are this
        course's model, not InferenceX results.
      </p>

      <h3 className={h3}>The rows</h3>
      <div className="mt-4 space-y-6">
        {report.rows.map((row, i) => (
          <RowSection key={row.key} d={d} row={row} i={i} />
        ))}
      </div>

      <h3 className={h3}>Worked examples</h3>
      <p className={`mt-2 ${prose}`}>
        One published point each, through the datasheet bound (full bandwidth and peak, no fixed cost), this fit's card and v1's flat ticks, beside what
        InferenceX measured.
      </p>
      <div className="mt-4 space-y-6">
        {report.workedExamples.map((ex, i) => (
          <Example key={ex.id} d={d} ex={ex} i={i} />
        ))}
      </div>

      <h3 className={h3}>The graded engine exercise</h3>
      <p className={`mt-2 ${prose}`} data-frontier={fr.killed ? 'killed' : 'kept'}>
        {fr.killed
          ? t('frontier, the one graded engine exercise this physics was for (pick the configuration with the most output per GPU that still meets a per-user speed floor), is not built: {decisions:frontier.rule}. Nothing in the Fleet runs on v2.')
          : 'frontier passed every kill rule the decision tables check.'}
      </p>
      <ul className={`mt-2 space-y-1 ${mono}`}>
        {fr.kill.map((k, j) => (
          <li key={k.rule}>
            {t(`rule {decisions:frontier.kill.${j}.rule} ${k.trips ? 'trips' : 'passes'}: {decisions:frontier.kill.${j}.detail}`)}
          </li>
        ))}
      </ul>

      <h3 className={h3}>Findings (measured values)</h3>
      <ul className={`mt-2 list-disc space-y-2 pl-5 ${prose}`}>
        <li>
          {t(
            `At the median on-demand prices the course cites ({#price.h100.median|| H100||$}, {#price.b200.median|| B200||$} per GPU-hour), B200 is cheaper per output token than H100 in {${g}b200CheaperPerToken.b200Cheaper} of {${g}b200CheaperPerToken.scenes} measured FP8 frontier scenes ({#phys.finding.b200-cheaper-per-token}), by {${g}b200CheaperPerToken.minAdvantage|2|×} to {${g}b200CheaperPerToken.maxAdvantage|2|×}.`,
          )}
        </li>
        <li>
          {t(
            `FP8 → NVFP4 cuts the weight bytes {${g}nvfp4TpotGain.weightBytesRatio|2|×} but B200's measured TPOT only {${g}nvfp4TpotGain.min|2|×} to {#phys.finding.nvfp4-tpot-gain} at TP ${gain.tps.map((_, j) => `{${g}nvfp4TpotGain.tps.${j}}`).join(', ')}, over {${g}nvfp4TpotGain.n} configurations` +
              (cited < 0
                ? ''
                : ` ({${g}nvfp4TpotGain.cited.fp8Ms|2} → {${g}nvfp4TpotGain.cited.nvfp4Ms|2| ms} at TP {${g}nvfp4TpotGain.pairs.${cited}.tp}, {${g}nvfp4TpotGain.pairs.${cited}.conc} users: points {${g}nvfp4TpotGain.cited.fp8} → {${g}nvfp4TpotGain.cited.nvfp4})`) +
              '. Some per-step cost does not scale with weight bytes.',
          )}
        </li>
        <li>
          {t(
            `On H100 with {${g}tp2ToTp8.conc} users and {${g}tp2ToTp8.isl}/{${g}tp2ToTp8.osl} tokens, TP {${g}tp2ToTp8.from.tp} → TP {${g}tp2ToTp8.to.tp} is {${g}tp2ToTp8.napkin|1|×} on the datasheet bound and {#phys.finding.tp2-to-tp8} measured ({${g}tp2ToTp8.from.ms|2} → {${g}tp2ToTp8.to.ms|2| ms}: points {${g}tp2ToTp8.from.id} → {${g}tp2ToTp8.to.id}). Something per step does not divide by TP; how much of it is fixed cost is this fit's split.`,
          )}
        </li>
      </ul>

      <h3 className={h3}>How the form was chosen</h3>
      <p className={`mt-2 ${prose}`}>The gate protocol's selection disclosure, verbatim; its one figure is from the prototype, not this repo:</p>
      <blockquote data-exempt="prototype" className="mt-3 max-w-3xl border-l-2 border-line pl-4 text-body-sm leading-relaxed text-text-3">
        <p>{DISCLOSURE}</p>
        <footer className="mt-1 font-mono text-[11px]">docs/physics/protocol.md, in the prototype</footer>
      </blockquote>
      {byId['phys.control.mi325x.loo-tpot-p90'] && (
        <p className={`mt-2 ${prose}`}>{t('In this repo the same control reads {#phys.control.mi325x.loo-tpot-p90|1} on MI325X.')}</p>
      )}

      <h3 className={h3}>Controls (printed, never gated)</h3>
      <ul className={`mt-2 list-disc space-y-2 pl-5 ${prose}`}>
        {controls.control.map((c, j) =>
          c.skipped === null && byId[`phys.control.${c.hardware}.loo-tpot-p90`] ? (
            <li key={c.hardware} data-control={c.hardware}>
              {t(
                `${c.hardware.toUpperCase()} · vLLM · FP8, rows no design looked at, the card's form refitted on its {controls:control.${j}.nFit} fit points: leave-one-out mean {#phys.control.${c.hardware}.loo-tpot-mean|1}, p90 {#phys.control.${c.hardware}.loo-tpot-p90|1}; G1 ${c.gates.G1.ok ? 'passes' : 'fails'} ({controls:control.${j}.gates.G1.detail}).`,
              )}
            </li>
          ) : null,
        )}
        <li>
          {t(
            "NVIDIA's NIM benchmark (another harness and engine, backend unstated), replayed with the H100 row's parameters, mean error in inter-token latency: " +
              controls.nim.groups
                .filter((x) => byId[`phys.nim.${x.key}.itl-mean`])
                .map((x) => `${NIM_LABEL[x.key] ?? x.key} {#phys.nim.${x.key}.itl-mean|1} over {controls:nim.groups.${controls.nim.groups.indexOf(x)}.n} configurations`)
                .join('; ') +
              ". That is transfer error, not the gate's.",
          )}
        </li>
      </ul>

      <h3 className={h3}>What the card leaves out</h3>
      <p className={`mt-2 ${prose}`}>{LEFT_OUT}.</p>

      <h3 className={h3}>The rows that stay v1</h3>
      <ul className={`mt-2 list-disc space-y-1 pl-5 ${prose}`}>
        <li>
          H200 · vLLM 0.10.2 · FP8 and MI300X · vLLM 0.10.1 ROCm · FP8: reachable, not opened. The same sweep has their points, but the course has no claims,
          atlas row or lesson for them; opening one is claims and a dated protocol amendment.
        </li>
        <li>GB200, A100, B300, RTX 4090, T4 and TPU7x: not calibrated, v1 only (no single-replica points on this harness, or no capacity or compute claims).</li>
        <li>Every other model, precision, engine release, token budget or shape, and anything outside a row's box: v1 only.</li>
      </ul>
    </div>
  )
}

async function loadPhysicsData(): Promise<PhysicsData> {
  const [report, decisions, controls] = await Promise.all([
    import('../../../docs/physics/report.json'),
    import('../../../docs/physics/decisions.json'),
    import('../../../docs/physics/controls.json'),
    // the claim groups register on import (claims/homes.ts); the chips read them
    import('@/data/claims/lazy/physics'),
    import('@/data/claims/lazy/ix-points'),
  ])
  return {
    report: report.default as unknown as PhysicsReport,
    decisions: decisions.default as unknown as PhysicsDecisions,
    controls: controls.default as unknown as PhysicsControls,
  }
}

export default function PhysicsTab() {
  const [data, setData] = useState<PhysicsData | 'failed' | null>(null)
  useEffect(() => {
    let live = true
    loadPhysicsData().then(
      (x) => live && setData(x),
      () => live && setData('failed'),
    )
    return () => {
      live = false
    }
  }, [])
  if (data === 'failed') return <p role="alert" className="font-mono text-body-sm text-amber">The physics report did not load; reload the page to try again.</p>
  if (data === null) return <RouteFallback label="loading the physics report" />
  return <PhysicsView {...data} />
}
