/**
 * The physics tab on /freshness (docs/specs/s5.md §5.8, §8.3; S5-11), mounted in a small DOM (tests/dom/mini-dom.ts):
 * the fourth tab and its arrow-key order, both states (the negative from tests/fixtures/physics/report-negative.json),
 * the verdicts with `fitStatus`, the parameters as chips with this fit's refit range, the worked examples, `frontier`'s
 * kill, the controls, the findings, the disclosure, the rows that stay v1 and the one attribution line. The audit holds
 * every number on the tab to a claim chip or a report value (the verbatim disclosure is the one exemption, S5-D59).
 * Also S5-D71: the claims tab still lists every claim of `ALL_CLAIMS`, in order, with the physics groups loaded on demand.
 * A real browser (focus ring, reflow at 360 px, a table scrolling in its own region) is e2e/physics-tab.spec.ts and the
 * a11y harness.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import controlsFile from '../../docs/physics/controls.json'
import decisionsFile from '../../docs/physics/decisions.json'
import reportFile from '../../docs/physics/report.json'
import StepCard from '../../src/components/physics/StepCard'
import { groupThousands } from '../../src/lib/physics-format'
import ClaimsTable from '../../src/components/ClaimsTable'
import { ALL_CLAIMS, byId, getClaim } from '../../src/data/claims/all'
import PhysicsTab, { PhysicsView, type PhysicsControls, type PhysicsData, type PhysicsDecisions, type PhysicsReport } from '../../src/pages/changes/PhysicsTab'
import negativeFile from '../fixtures/physics/report-negative.json'
import { installDom, MiniEvent, type DomKit, type MiniElement, type MiniNode } from '../dom/mini-dom'

const root = resolve(import.meta.dir, '../..')
const REAL: PhysicsData = {
  report: reportFile as unknown as PhysicsReport,
  decisions: decisionsFile as unknown as PhysicsDecisions,
  controls: controlsFile as unknown as PhysicsControls,
}
const NEGATIVE: PhysicsData = { ...REAL, report: negativeFile as unknown as PhysicsReport }
const FIT_STATUS = 'adopted by the build on 2026-10-18, unsigned'
const DATASET = 'bench.inferencex.llama70b-2025-10-29'
const ATTRIBUTION =
  "Data: InferenceX by SemiAnalysis, official results as published 2025-10-29. InferenceX™ is a trademark of SemiAnalysis. The fit and its predictions are this course's model, not InferenceX results."

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

/* ------------------------------ the audit ------------------------------ */

interface Num {
  value: number
  decimals: number
}

/** Product names with a space before their digits; a name, not a quantity. */
const NAMES = /RTX 4090/g
const DATE = /\b\d{4}-\d{2}-\d{2}\b/g
const VERSION = /\b\d+\.\d+\.\d+\b/g

/**
 * The quantities in a text: digit runs that are not part of an identifier (H100, G1, p90, FP8, Llama-3.3-70B, 70B, v1),
 * a version (0.10.2), a date (checked on its own) or a product name. `−` or `-` right before one is its sign.
 */
function quantities(text: string): Num[] {
  const t = text.replace(DATE, ' ').replace(NAMES, ' ').replace(VERSION, ' ')
  const out: Num[] = []
  for (const m of t.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const at = m.index ?? 0
    const before = t[at - 1] ?? ' '
    const before2 = t[at - 2] ?? ' '
    const after = t[at + m[0].length] ?? ' '
    const ident = /[A-Za-z_]/.test(before) || (/[-.]/.test(before) && /[A-Za-z0-9]/.test(before2)) || /[A-Za-z_]/.test(after)
    if (ident) continue
    const digits = m[0].replace(/,/g, '')
    const sign = before === '−' || before === '-' ? -1 : 1
    out.push({ value: sign * Number(digits), decimals: digits.includes('.') ? digits.split('.')[1].length : 0 })
  }
  return out
}

const close = (shown: Num, want: number) => Math.abs(shown.value - want) <= 0.5 * 10 ** -shown.decimals + 1e-9 * Math.abs(want)

function lookup(data: PhysicsData, ref: string): unknown {
  const [file, path] = ref.split(':')
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], data[file as keyof PhysicsData])
}

const SKIP = '[data-claim], [data-report], [data-exempt], [data-sim-mirror], [data-stale-of]'

function textNodes(node: MiniNode, out: MiniNode[] = []): MiniNode[] {
  for (const c of node.childNodes) {
    if (c.nodeType === 3) out.push(c)
    else if (c.nodeType === 1 && !(c as MiniElement).matches(SKIP)) textNodes(c, out)
  }
  return out
}

/** Every problem with the tab's numbers; empty when each is a chip, a report value or the exempt disclosure. */
function audit(tab: MiniElement, data: PhysicsData): string[] {
  const problems: string[] = []
  for (const el of tab.querySelectorAll('[data-claim]')) {
    const claim = getClaim(el.getAttribute('data-claim')!)
    const scale = Number(el.getAttribute('data-scale') ?? 1)
    const shown = quantities(el.textContent)
    if (shown.length !== 1 || !close(shown[0], (claim.value as number) * scale)) problems.push(`chip ${claim.id} reads "${el.textContent}", the claim is ${claim.value}`)
  }
  for (const el of tab.querySelectorAll('[data-report]')) {
    const ref = el.getAttribute('data-report')!
    const v = lookup(data, ref)
    if (typeof v === 'string') {
      // a report string's whole numbers carry thousands separators on the page; without them it is the file's string
      if (el.textContent.replace(/(?<=\d),(?=\d{3}(?!\d))/g, '') !== v) problems.push(`${ref} reads "${el.textContent}", the file has "${v}"`)
    } else if (typeof v === 'number') {
      const scale = Number(el.getAttribute('data-scale') ?? 1)
      const shown = quantities(el.textContent)
      if (shown.length !== 1 || !close(shown[0], v * scale)) problems.push(`${ref} reads "${el.textContent}", the file has ${v} (× ${scale})`)
    } else problems.push(`${ref} resolves to nothing`)
  }
  const expiry = tab.querySelectorAll('[data-stale-of]')
  for (const el of expiry) if (el.textContent !== '2027-04-16') problems.push(`stale since reads ${el.textContent}`)
  for (const node of textNodes(tab)) {
    const text = node.textContent
    for (const d of text.match(DATE) ?? []) if (d !== '2025-10-29') problems.push(`a date outside a claim or report value: ${d} in "${text}"`)
    const loose = quantities(text)
    if (loose.length > 0) problems.push(`a number outside a chip or report value: "${text}"`)
  }
  return problems
}

/**
 * The problems with a tab's point counts: each row's two tables must hold as many points as the row's sentence
 * and summary say (`nFit`, `nHeldOut`), and `kept` is the two together.
 */
function rowCounts(tab: MiniElement, report: PhysicsReport): string[] {
  const problems: string[] = []
  const say = (el: MiniElement | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').replace(/,/g, '')
  for (const row of report.rows) {
    const section = tab.querySelector(`[data-row="${row.key}"]`)!
    const tables = section.querySelectorAll('details')
    const [fit, held] = tables
    const rowsIn = (d: MiniElement) => d.querySelectorAll('tbody tr').length
    const f = row.points.filter((p) => p.subset === 'F').length
    const h = row.points.filter((p) => p.subset === 'H').length
    if (f !== row.nFit) problems.push(`${row.key}: nFit says ${row.nFit}, the points have ${f} fit`)
    if (h !== row.nHeldOut) problems.push(`${row.key}: nHeldOut says ${row.nHeldOut}, the points have ${h} held out`)
    if (rowsIn(fit) !== f) problems.push(`${row.key}: the leave-one-out table has ${rowsIn(fit)} rows for ${f} fit points`)
    if (rowsIn(held) !== h) problems.push(`${row.key}: the held-out table has ${rowsIn(held)} rows for ${h} held-out points`)
    if (!say(fit.querySelector('summary')).includes(`the ${f} fit points`)) problems.push(`${row.key}: the leave-one-out summary does not say ${f}`)
    if (!say(held.querySelector('summary')).includes(`the ${h} points never fitted`)) problems.push(`${row.key}: the held-out summary does not say ${h}`)
    if (!say(section).includes(`${f} fit the card and ${h} are held out`)) problems.push(`${row.key}: the row's sentence does not say ${f} and ${h}`)
    const kept = row.kept
    if (kept !== f + h) problems.push(`${row.key}: kept says ${kept}, fit and held out make ${f + h}`)
  }
  return problems
}

const tabOf = (m: { container: MiniElement }) => m.container.querySelector('[data-physics-tab]')!
const textOf = (el: MiniElement | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

/* ------------------------------ the page's fourth tab ------------------------------ */

describe('the tab on /freshness', () => {
  test('is the fourth, after claims; the arrow keys walk errata, field notes, claims, physics and wrap, and the panel loads lazily', async () => {
    // The errata index lists its files with Vite's import.meta.glob, which bun lacks, so the page gets a stand-in errata tab:
    // this test is about the tab list. Not a mock of the index: DoneCard's import('@/data/errata') fails under bun and is
    // swallowed (tests/forge/panels.test.ts mounts it), and bun keeps that failed module, which mock.module cannot replace,
    // so a run that takes that file first would fail here (CI did). Nothing else loads ErrataTab.
    mock.module(join(root, 'src/pages/changes/ErrataTab.tsx'), () => ({ default: () => createElement('p', { 'data-errata-stub': '' }, 'errata') }))
    const { default: Changes } = await import('../../src/pages/Changes')
    const m = await dom.mount(createElement(MemoryRouter, { initialEntries: ['/freshness?tab=claims'] }, createElement(Changes)))
    const tabs = () => m.container.querySelectorAll('[role="tab"]')
    expect(tabs().map((t) => t.textContent)).toEqual(['Errata', 'Field Notes', 'Claims', 'Physics'])
    expect(tabs().map((t) => t.id)).toEqual(['changes-tab-errata', 'changes-tab-field-notes', 'changes-tab-claims', 'changes-tab-physics'])
    const press = async (key: string) => {
      const el = dom.document.activeElement as unknown as MiniElement
      await dom.act(() => el.dispatchEvent(new MiniEvent('keydown', { bubbles: true, cancelable: true, key })))
    }
    const selected = () => tabs().find((t) => t.getAttribute('aria-selected') === 'true')!.id
    const claimsTab = tabs()[2]
    await dom.act(() => claimsTab.focus())
    expect(claimsTab.getAttribute('tabindex')).toBe('0')

    await press('ArrowRight')
    expect(selected()).toBe('changes-tab-physics')
    expect((dom.document.activeElement as unknown as MiniElement).id).toBe('changes-tab-physics')
    expect(tabs().map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '0'])
    expect(m.container.querySelector('[role="tabpanel"]')!.id).toBe('changes-panel-physics')
    await dom.until(() => m.container.querySelector('[data-physics-tab]') !== null, 15000)
    expect(m.container.querySelector('[data-physics-tab]')!.getAttribute('data-physics-tab')).toBe('positive')

    await press('ArrowRight')
    expect(selected()).toBe('changes-tab-errata')
    expect((dom.document.activeElement as unknown as MiniElement).id).toBe('changes-tab-errata')
    expect(m.container.querySelector('[role="tabpanel"]')!.id).toBe('changes-panel-errata')
    expect(m.container.querySelector('[data-errata-stub]')).not.toBeNull()
    await press('ArrowLeft')
    expect(selected()).toBe('changes-tab-physics')
    await press('ArrowLeft')
    expect(selected()).toBe('changes-tab-claims')
    await m.unmount()
  })
})

/* ------------------------------ the positive state ------------------------------ */

describe('the positive state (docs/physics/report.json)', () => {
  let m: Awaited<ReturnType<DomKit['mount']>>
  let tab: MiniElement
  beforeAll(async () => {
    // the default export loads the three files and the two claim groups itself
    m = await dom.mount(createElement(PhysicsTab))
    await dom.until(() => m.container.querySelector('[data-physics-tab]') !== null, 15000)
    tab = tabOf(m)
  })
  afterAll(() => m.unmount())

  test('every number on the tab is a claim chip or a report value; the verbatim disclosure is the one exemption', () => {
    expect(tab.getAttribute('data-physics-tab')).toBe('positive')
    expect(audit(tab, REAL)).toEqual([])
    // the audit saw a real page
    expect(tab.querySelectorAll('[data-claim]').length).toBeGreaterThan(40)
    expect(tab.querySelectorAll('[data-report]').length).toBeGreaterThan(400)
    const exempt = tab.querySelectorAll('[data-exempt]')
    expect(exempt).toHaveLength(1)
    expect(exempt[0].getAttribute('data-exempt')).toBe('prototype')
  })

  test('each row: its verdict with fitStatus, its gates, and the gate statistics as chips', () => {
    const rows = tab.querySelectorAll('[data-row]')
    expect(rows.map((r) => r.getAttribute('data-row'))).toEqual(REAL.report.rows.map((r) => r.key))
    for (const row of rows) {
      const verdict = row.querySelector('[data-verdict]')!
      expect(verdict.getAttribute('data-verdict')).toBe('calibrated')
      expect(textOf(verdict)).toBe(`verdict: calibrated · TPOT eligible, TTFT eligible · ${FIT_STATUS}`)
      for (const g of ['G1', 'G2', 'G3', 'G4', 'G5']) expect(textOf(row)).toContain(`${g} passes`)
      const key = row.getAttribute('data-row')
      for (const s of ['loo-tpot', 'heldout-tpot', 'loo-ttft8k']) {
        for (const stat of ['mean', 'p90']) expect(row.querySelector(`[data-claim="phys.${key}.${s}-${stat}"]`)).not.toBeNull()
      }
    }
    expect(textOf(rows[0])).toContain('TPOT LOO over F: n 25, mean 5.0 % (≤ 10.0 %), p90 11.3 % (≤ 15.0 %)')
  })

  test('every parameter is a chip with this fit\'s refit range, and the split is not taught as fact', () => {
    for (const row of REAL.report.rows) {
      const section = tab.querySelector(`[data-row="${row.key}"]`)!
      for (const p of ['eta-mem', 'eta-flop', 'layer-us', 'seq-us', 'link-gbs', 'harness-ms']) {
        const chip = section.querySelector(`[data-claim="phys.${row.key}.${p}"]`)
        expect(chip).not.toBeNull()
        expect(textOf(chip!.parentNode as MiniElement)).toContain("this fit's refit range")
      }
      for (const k of ['etaMem', 'etaFlop', 'layerUs', 'seqUs', 'linkGBs', 'harnessMs']) {
        expect(section.querySelector(`[data-report="report:rows.${REAL.report.rows.indexOf(row)}.refit.${k}.0"]`)).not.toBeNull()
        expect(section.querySelector(`[data-report="report:rows.${REAL.report.rows.indexOf(row)}.refit.${k}.1"]`)).not.toBeNull()
      }
      expect(textOf(section)).toContain('other equally good forms split it differently')
    }
    expect(textOf(tab.querySelector('[data-row="h100-vllm-0-10-2-fp8"]'))).toContain('η_m, the share of the datasheet bandwidth reached reading weights and KV: 0.89 (this fit\'s refit range 0.87–0.91)')
  })

  test('the leave-one-out and held-out tables list every point with its run link, in a region that scrolls', () => {
    for (const [i, row] of REAL.report.rows.entries()) {
      const section = tab.querySelector(`[data-row="${row.key}"]`)!
      const regions = section.querySelectorAll('details [data-scroll-region]')
      expect(regions).toHaveLength(2)
      for (const r of regions) {
        expect(r.getAttribute('role')).toBe('region')
        expect(r.getAttribute('tabindex')).toBe('0')
      }
      const links = (region: MiniElement) => region.querySelectorAll('tbody a').map((a) => a.getAttribute('href'))
      expect(links(regions[0])).toEqual(row.points.filter((p) => p.subset === 'F').map((p) => p.runUrl))
      expect(links(regions[1])).toEqual(row.points.filter((p) => p.subset === 'H').map((p) => p.runUrl))
      expect(regions[0].querySelectorAll('tbody tr')).toHaveLength(REAL.report.rows[i].nFit)
      // the worst points, with their runs
      expect(section.querySelectorAll(`[data-report^="report:rows.${i}.r1.worst."][data-report$=".id"]`)).toHaveLength(row.r1.worst.length)
    }
  })

  test('the report strings with numbers (gate details, dropped points\' reasons) print the thousands separators, every value unchanged', () => {
    const h100 = tab.querySelector('[data-row="h100-vllm-0-10-2-fp8"]')!
    expect(textOf(h100)).toContain('dropped 41507: KV: 64 × (1,024 + 8,192) = 589,824 > 448,303; TTFT: median 8.47 s ≥ 3 s')
    expect(textOf(h100)).toContain('G5 passes: n_F 25 (≥ 20), TPs 3 (≥ 2), concurrencies 3 (≥ 3), shapes 3 (≥ 2), 8,192/1,024 present')
    // an id and a status are not quantities: a five-digit run id stays as written
    expect(textOf(h100.querySelector('[data-report="report:rows.0.dropped.0.id"]'))).toBe('41507')
    expect(textOf(h100.querySelector('[data-report="report:rows.0.status"]'))).toBe('calibrated')
    // the text the page prints reads back to the file's string with the separators taken out
    expect(groupThousands('KV: 64 × (1024 + 8192) = 589824 > 448303')).toBe('KV: 64 × (1,024 + 8,192) = 589,824 > 448,303')
    expect(groupThousands('adopted by the build on 2026-10-18, unsigned')).toBe('adopted by the build on 2026-10-18, unsigned')
    expect(groupThousands('p90 11.3 % of 12345.678, 999, 0.10.2')).toBe('p90 11.3 % of 12345.678, 999, 0.10.2')
    expect(audit(tab, REAL)).toEqual([])
  })

  test("the tables size themselves: the five-column point tables keep a minimum width, the worked examples' small tables have none, a row summary is 44 px", () => {
    for (const r of tab.querySelectorAll('details [data-scroll-region]')) expect(r.querySelector('table')!.className).toContain('min-w-[34rem]')
    const small = tab.querySelectorAll('[data-example] [data-scroll-region]')
    expect(small).toHaveLength(REAL.report.workedExamples.length)
    for (const r of small) {
      expect(r.querySelector('table')!.className).not.toContain('min-w-')
      expect(r.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(4)
    }
    const summaries = tab.querySelectorAll('details > summary')
    expect(summaries).toHaveLength(REAL.report.rows.length * 2)
    for (const s of summaries) expect(s.className).toContain('min-h-11')
  })

  test('every row says how many points each table has, and each table has that many', () => {
    expect(rowCounts(tab, REAL.report)).toEqual([])
  })

  test('the box: TP options, sequences, budget and shapes from the report', () => {
    const nvfp4 = tab.querySelector('[data-row="b200-vllm-0-10-2-nvfp4"]')!
    expect(textOf(nvfp4)).toContain('calibrated only inside it: TP 1, 2, 4; up to 64 sequences; a budget of 8,192 tokens per step; prompt/output shapes 1,024/1,024, 1,024/8,192, 8,192/1,024')
  })

  test("the worked examples are report.json's (napkin, card, measured, v1), example B at −9.1 % with the TTFT residual", () => {
    const a = tab.querySelector('[data-example="41187"]')!
    const b = tab.querySelector('[data-example="40518"]')!
    const at = (el: MiniElement, ref: string) => textOf(el.querySelector(`[data-report="${ref}"]`))
    expect(at(a, 'report:workedExamples.0.napkinMs')).toBe('5.33 ms')
    expect(at(a, 'report:workedExamples.0.error.napkin')).toBe('−54.7 %')
    expect(at(a, 'report:workedExamples.0.cardMs')).toBe('12.09 ms')
    expect(at(a, 'report:workedExamples.0.error.card')).toBe('+2.7 %')
    expect(at(a, 'report:workedExamples.0.v1Ms')).toBe('50.00 ms')
    expect(textOf(a.querySelector('[data-claim="bench.ix-l70.h100-vllm-0-10-2-fp8.tp4.1024-1024.c4.tpot"]'))).toBe('11.78 ms')
    expect(at(b, 'report:workedExamples.1.cardPlusHarnessMs')).toBe('594.61 ms')
    expect(at(b, 'report:workedExamples.1.error.cardPlusHarness')).toBe('−9.1 %')
    expect(at(b, 'report:workedExamples.1.error.card')).toBe('−17.1 %')
    expect(textOf(b.querySelector('[data-claim="bench.ix-l70.b200-vllm-0-10-2-fp8.tp1.8192-1024.c4.ttft-median"]'))).toBe('654.02 ms')
    expect(textOf(a)).not.toContain('TTFT residual')
    for (const el of [a, b]) expect(el.querySelectorAll('[data-step-card]')).toHaveLength(1)
  })

  test("frontier's kill, with rule 1's figures and the rules that pass, from decisions.json", () => {
    const fr = tab.querySelector('[data-frontier]')!
    expect(fr.getAttribute('data-frontier')).toBe('killed')
    expect(textOf(fr)).toContain('is not built: kill rule 1: 4 distinct answer codes survive H1, H2 and the width rule (at least 6); 7 (row, answer) classes.')
    const rules = fr.nextSibling as MiniElement
    expect(rules.querySelectorAll('li').map(textOf)).toEqual([
      'rule 1 trips: 4 distinct answer codes survive H1, H2 and the width rule (at least 6); 7 (row, answer) classes',
      'rule 1b passes: the largest answer share under flattened sampling is 28.6 % (at most 29.0 %)',
      'rule 2 passes: the best scene-blind guesser finishes within 10 rounds 13.7 % (at most 14.0 %) and within 30 39.4 % (at most 40.0 %)',
      'rule 3 passes: the reader finishes within 10 rounds 100.0 % (above 90.0 %); right on 1,444 of 1,444 class scenes',
    ])
  })

  test('the controls: MI325X fails G1 at a p90 of 17.0 %, MI355X passes; the NIM panel; each a claim', () => {
    const mi325 = tab.querySelector('[data-control="mi325x"]')!
    expect(textOf(mi325.querySelector('[data-claim="phys.control.mi325x.loo-tpot-p90"]'))).toBe('17.0 %')
    expect(textOf(mi325.querySelector('[data-claim="phys.control.mi325x.loo-tpot-mean"]'))).toBe('8.3 %')
    expect(textOf(mi325)).toContain('G1 fails (TPOT LOO over F: n 36, mean 8.3 % (≤ 10.0 %), p90 17.0 % (≤ 15.0 %))')
    expect(textOf(tab.querySelector('[data-control="mi355x"]'))).toContain('G1 passes')
    for (const k of ['h100-tp2', 'h100-tp4', '8b-tp1']) expect(tab.querySelector(`[data-claim="phys.nim.${k}.itl-mean"]`)).not.toBeNull()
  })

  test('the findings, each a phys.finding claim: 2,715 of 2,715 scenes, the NVFP4 gain, TP 2 → 8', () => {
    const text = textOf(tab)
    expect(text).toContain('B200 is cheaper per output token than H100 in 2,715 of 2,715 measured FP8 frontier scenes (100 %), by 1.13× to 12.74×')
    expect(text).toContain('FP8 → NVFP4 cuts the weight bytes 1.78× but B200\'s measured TPOT only 1.01× to 1.32× at TP 1, 2, 4, over 43 configurations (16.34 → 13.07 ms at TP 1, 4 users: points 40624 → 40085)')
    expect(text).toContain('TP 2 → TP 8 is 4.0× on the datasheet bound and 1.91× measured (17.41 → 9.11 ms: points 42017 → 41625)')
    for (const id of ['phys.finding.b200-cheaper-per-token', 'phys.finding.nvfp4-tpot-gain', 'phys.finding.tp2-to-tp8', 'price.h100.median', 'price.b200.median']) {
      expect(tab.querySelector(`[data-claim="${id}"]`)).not.toBeNull()
    }
  })

  test("the selection disclosure is the protocol's, verbatim, labelled 'in the prototype', with the in-repo control chip beside it", () => {
    const protocol = readFileSync(join(root, 'docs/physics/protocol.md'), 'utf8')
    const quote = protocol.split('## 9. Selection disclosure')[1].split('\n').find((l) => l.startsWith('> '))!.slice(2)
    const block = tab.querySelector('[data-exempt="prototype"]')!
    expect(textOf(block.querySelector('p'))).toBe(quote)
    expect(textOf(block)).toContain('in the prototype')
    const beside = block.nextSibling as MiniElement
    expect(textOf(beside)).toBe('In this repo the same control reads 17.0 % on MI325X.')
    expect(beside.querySelector('[data-claim="phys.control.mi325x.loo-tpot-p90"]')).not.toBeNull()
  })

  test('the snapshot is stale since 2027-04-16, the rows that stay v1 carry no figures, and the attribution is one line', () => {
    const text = textOf(tab)
    expect(text).toContain('snapshot: vLLM 0.10.2 · InferenceX 2025-10-29 (165 points selected), stale since 2027-04-16 · physics id v2-1o8xgqi')
    const v1 = tab.querySelectorAll('li').find((li) => textOf(li).startsWith('H200'))!
    expect(textOf(v1)).toContain('H200 · vLLM 0.10.2 · FP8 and MI300X · vLLM 0.10.1 ROCm · FP8: reachable, not opened.')
    expect(quantities(textOf(v1))).toEqual([])
    expect(textOf(tab.querySelectorAll('h3').find((h) => textOf(h) === 'What the card leaves out')!.nextSibling as MiniElement)).toContain('speculative decoding and MTP')
    const attribution = tab.querySelectorAll('[data-attribution]')
    expect(attribution).toHaveLength(1)
    expect(textOf(attribution[0])).toBe(ATTRIBUTION)
    expect(attribution[0].querySelector('a')!.getAttribute('href')).toBe('https://inferencex.semianalysis.com')
  })
})

/* ------------------------------ the negative state ------------------------------ */

describe('the negative state (tests/fixtures/physics/report-negative.json)', () => {
  test("reads 'why the Fleet's clock stays flat' over the same tables, every row failed, no fit claim shown as its value", async () => {
    const m = await dom.mount(createElement(PhysicsView, NEGATIVE))
    const tab = tabOf(m)
    expect(tab.getAttribute('data-physics-tab')).toBe('negative')
    expect(textOf(tab.querySelector('h2'))).toBe("Why the Fleet's clock stays flat")
    expect(textOf(tab)).toContain("so the Fleet keeps v1's flat 50 ms tick")
    const rows = tab.querySelectorAll('[data-row]')
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(textOf(row.querySelector('[data-verdict="failed"]'))).toBe(`verdict: failed · TPOT not eligible, TTFT not eligible · ${FIT_STATUS}`)
      expect(textOf(row)).toContain('G1 fails')
      expect(row.querySelectorAll('[data-claim^="phys."]')).toHaveLength(0)
      expect(row.querySelectorAll('details [data-scroll-region]')).toHaveLength(2)
    }
    expect(textOf(rows[0])).toContain('TPOT LOO over F: n 25, mean 12.4 % (≤ 10.0 %), p90 21.2 % (≤ 15.0 %)')
    expect(textOf(rows[0])).toContain('mean error 12.4 %, p90 21.2 %')
    expect(audit(tab, NEGATIVE)).toEqual([])
    expect(textOf(tab.querySelector('[data-attribution]'))).toBe(ATTRIBUTION)
    await m.unmount()
  })

  test("each row's counts are its points': the fixture's tables hold as many points as nFit and nHeldOut say (S5-11)", async () => {
    const m = await dom.mount(createElement(PhysicsView, NEGATIVE))
    const tab = tabOf(m)
    expect(rowCounts(tab, NEGATIVE.report)).toEqual([])
    const first = tab.querySelector('[data-row]')!
    expect(textOf(first)).toContain('Leave-one-out: the 25 fit points')
    expect(first.querySelectorAll('details')[0].querySelectorAll('tbody tr')).toHaveLength(25)
    expect(first.querySelectorAll('details')[1].querySelectorAll('tbody tr')).toHaveLength(17)
    // the check can fail: a row that says more points than it has is named
    const trimmed = { ...NEGATIVE.report, rows: NEGATIVE.report.rows.map((r, i) => (i === 0 ? { ...r, points: r.points.slice(0, 5) } : r)) }
    expect(rowCounts(tab, trimmed).length).toBeGreaterThan(0)
    await m.unmount()
  })

  test('the audit catches a stray number, a chip off its claim and a report value off its file', async () => {
    const m = await dom.mount(createElement(PhysicsView, NEGATIVE))
    const tab = tabOf(m)
    const p = dom.document.createElement('p')
    p.textContent = 'the fixed cost is 5.79 ms'
    tab.appendChild(p)
    const val = tab.querySelector('[data-report="report:workedExamples.0.v1Ms"]')!
    val.textContent = '40 ms'
    const chip = tab.querySelector('[data-claim="phys.finding.tp2-to-tp8"] button')!
    const was = chip.textContent
    chip.textContent = '2.10×'
    const problems = audit(tab, NEGATIVE)
    expect(problems.some((x) => x.includes('5.79 ms'))).toBe(true)
    expect(problems.some((x) => x.startsWith('report:workedExamples.0.v1Ms reads "40 ms"'))).toBe(true)
    expect(problems.some((x) => x.startsWith('chip phys.finding.tp2-to-tp8 reads "2.10×"'))).toBe(true)
    p.remove()
    val.textContent = '50 ms'
    chip.textContent = was
    await m.unmount()
  })
})

/* ------------------------------ StepCard ------------------------------ */

describe('StepCard', () => {
  test("draws each card's step as a bar described by a SimMirror table of the same terms", async () => {
    const ex = REAL.report.workedExamples[0]
    const at = 'report:workedExamples.0'
    const m = await dom.mount(
      createElement(StepCard, {
        id: 'mirror-a',
        caption: 'Example A',
        columns: [
          { label: 'datasheet bound', card: ex.napkin, at: `${at}.napkin` },
          { label: "this fit's card", card: ex.card, at: `${at}.card` },
        ],
      }),
    )
    const bars = m.container.querySelectorAll('[role="img"]')
    expect(bars).toHaveLength(2)
    for (const bar of bars) expect(bar.getAttribute('aria-describedby')).toBe('mirror-a')
    expect(bars.map((b) => b.getAttribute('aria-label'))).toEqual(['datasheet bound: 5.333 ms, memory-bound; fixed 0.000 ms, link 0.000 ms, memory 5.333 ms', "this fit's card: 12.090 ms, memory-bound; fixed 6.024 ms, link 0.074 ms, memory 5.992 ms"])
    const mirror = m.container.querySelector('[data-sim-mirror]')!
    expect(mirror.querySelector('#mirror-a')).not.toBeNull()
    const cells = mirror.querySelectorAll('tbody tr').map((tr) => [...tr.querySelectorAll('th'), ...tr.querySelectorAll('td')].map(textOf))
    const shown = (col: string, key: string) => textOf(m.container.querySelector(`[data-report="${at}.${col}.${key}"]`))
    expect(cells).toEqual([
      ...['fixedS', 'linkS', 'memS', 'flopS'].map((k, i) => [['fixed', 'link', 'memory', 'compute'][i], shown('napkin', k), shown('card', k)]),
      ['step', shown('napkin', 'stepS'), shown('card', 'stepS')],
      ['bound', 'memory', 'memory'],
    ])
    expect(shown('card', 'fixedS')).toBe('6.024 ms')
    // the legend: each term's name carries a swatch in the colour its segment of the bar has
    for (const bar of bars) {
      const legend = (bar.nextSibling as MiniElement).querySelectorAll('dt')
      expect(legend.map(textOf)).toEqual(['fixed', 'link', 'memory', 'compute'])
      const tones = legend.map((dt) => dt.querySelector('[aria-hidden="true"]')!.className.split(' ').find((c) => c.startsWith('bg-')))
      expect(tones).toEqual(['bg-text-3', 'bg-info', 'bg-accent', 'bg-amber'])
      for (const seg of bar.querySelectorAll('span')) expect(tones).toContain(seg.className)
    }
    await m.unmount()
  })
})

/* ------------------------------ what loads when ------------------------------ */

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm

/** Every file the entries reach by static imports, JSON included (`import()` is not followed). */
function staticFiles(entries: string[]): Set<string> {
  const files = new Set<string>()
  const visit = (file: string) => {
    if (files.has(file)) return
    files.add(file)
    if (!/\.tsx?$/.test(file)) return
    for (const m of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      const spec = m[1]
      const base = spec.startsWith('@/') ? join(root, 'src', spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(file), spec) : null
      if (base === null || /\.(css|svg|png|woff2?)$/.test(spec) || spec.includes('?')) continue
      const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find((c) => existsSync(c) && /\.(tsx?|json)$/.test(c))
      if (!hit) throw new Error(`cannot resolve ${spec} from ${relative(root, file)}`)
      visit(hit)
    }
  }
  entries.forEach((e) => visit(join(root, e)))
  return new Set([...files].map((f) => relative(root, f)))
}

const PHYSICS_ONLY = ['docs/physics/report.json', 'docs/physics/decisions.json', 'docs/physics/controls.json', 'src/data/claims/lazy/physics.ts', 'src/data/claims/lazy/ix-points.ts']

describe('what loads when', () => {
  test('the entry, /freshness and the claims tab reach neither the physics files nor the tab; the tab reaches them by import() only', () => {
    for (const entry of ['src/main.tsx', 'src/pages/Changes.tsx', 'src/components/ClaimsTable.tsx']) {
      const reached = staticFiles([entry])
      expect(reached.size).toBeGreaterThan(entry === 'src/main.tsx' ? 20 : 5)
      for (const f of [...PHYSICS_ONLY, 'src/pages/changes/PhysicsTab.tsx', 'src/data/claims/all.ts']) expect(`${entry}: ${reached.has(f)}`).toBe(`${entry}: false`)
    }
    const tabFiles = staticFiles(['src/pages/changes/PhysicsTab.tsx'])
    for (const f of PHYSICS_ONLY) expect(tabFiles.has(f)).toBe(false)
    const tabSource = readFileSync(join(root, 'src/pages/changes/PhysicsTab.tsx'), 'utf8')
    for (const f of PHYSICS_ONLY.slice(0, 3)) expect(tabSource).toContain(`import('../../../${f}')`)
    expect(tabSource).toContain("import('@/data/claims/lazy/physics')")
    expect(tabSource).toContain("import('@/data/claims/lazy/ix-points')")
    expect(readFileSync(join(root, 'src/pages/Changes.tsx'), 'utf8')).toContain("lazy(() => import('@/pages/changes/PhysicsTab'))")
  })
})

/* ------------------------------ the claims tab (S5-D71) ------------------------------ */

describe('the claims tab loads the physics groups on demand and still lists every claim', () => {
  test('the mounted table lists ALL_CLAIMS, id for id and in order, once the two groups land', async () => {
    const m = await dom.mount(createElement(MemoryRouter, { initialEntries: ['/freshness?tab=claims'] }, createElement(ClaimsTable)))
    const ids = () => m.container.querySelectorAll('tbody tr').map((tr) => tr.id)
    await dom.until(() => ids().length === ALL_CLAIMS.length, 15000)
    expect(ids()).toEqual(ALL_CLAIMS.map((c) => c.id))
    // the physics groups are in it: the fit, the findings, the controls and the measured points
    for (const id of ['phys.h100-vllm-0-10-2-fp8.eta-mem', 'phys.finding.tp2-to-tp8', 'phys.control.mi325x.loo-tpot-p90', 'bench.ix-l70.h100-vllm-0-10-2-fp8.tp4.1024-1024.c4.tpot', DATASET]) {
      expect(byId[id]).toBeDefined()
      expect(ids()).toContain(id)
    }
    expect(textOf(m.container.querySelector('[role="status"]'))).toBe('')
    await m.unmount()
  })
})
