/**
 * claims-coverage — S2's "100% of chips cited" as a ratchet (Wave 1 stage 0, task K3-2).
 *
 * Two measures over the lessons:
 *   - every statline chip names a claim (`StatChipData.claim`), else it is uncited;
 *   - every sentence of lesson prose (`md`) that holds a year 2015-2029, a version string, a dollar price or a number with
 *     a hardware or throughput unit is uncited unless it holds a `[[c:<id>]]` token.
 *
 * The committed baseline (`scripts/baselines/claims-coverage.json`) lists today's uncited items by a stable key. The test
 * fails on a new uncited item and on a baseline entry that is now cited (or gone), so the file can only shrink. `--update`
 * refuses to add a line: only removals are written.
 *
 *   bun scripts/claims-coverage.ts           the report (per track, then the findings)
 *   bun scripts/claims-coverage.ts --check   exit 1 on a finding
 *   bun scripts/claims-coverage.ts --update  rewrite the baseline with removals only; refuses additions
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_LESSONS } from '../src/data/lessons'
import { rev32 } from '../src/lib/ledger/stable'

export interface UncitedChip {
  lesson: string
  label: string
  value: string
}

export interface UncitedSentence {
  lesson: string
  hash: string
  facts: string[]
  sample: string
}

export interface Coverage {
  chips: UncitedChip[]
  sentences: UncitedSentence[]
  /** Total chips, by track: the denominator of S2's chip measure. */
  chipsTotal: Record<string, number>
  /** Total fact-bearing sentences, by track. */
  sentencesTotal: Record<string, number>
}

export interface Baseline {
  chips: UncitedChip[]
  sentences: UncitedSentence[]
}

export interface Findings {
  newChips: UncitedChip[]
  newSentences: UncitedSentence[]
  staleChips: UncitedChip[]
  staleSentences: UncitedSentence[]
}

const FACT_PATTERNS: readonly [string, RegExp][] = [
  ['year', /\b20(?:1[5-9]|2[0-9])\b/],
  ['version', /\bv\d+(?:\.\d+)+/],
  ['price', /\$\s?\d/],
  [
    'unit',
    /\b\d[\d,]*(?:\.\d+)?\s?(?:per\s)?(?:%|ns|µs|us|ms|s|KB|KiB|MB|MiB|GB|GiB|TB|TiB|FLOPs?|TFLOPs?|GFLOPs?|tok\/s|tokens?\/s|TB\/s|GB\/s|kW|MW|W|GPU-hours?|\/Mtok)\b/,
  ],
]

/** The kinds of fact a sentence holds. */
export const factsIn = (sentence: string): string[] => FACT_PATTERNS.filter(([, re]) => re.test(sentence)).map(([k]) => k)

/** A claim token in the sentence means the fact is cited. */
const CITED = /\[\[c:[a-z0-9._-]+(?:\|pin)?\]\]/

/** The sentences of one markdown text: no fenced blocks, no inline code, no heading lines. */
export function sentencesOf(md: string): string[] {
  const out: string[] = []
  let fenced = false
  for (const line of md.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced
      continue
    }
    if (fenced || /^\s*#{1,6}\s/.test(line)) continue
    const prose = line.replace(/`[^`]*`/g, ' ')
    for (const sentence of prose.split(/(?<=[.!?])\s+/)) {
      const text = sentence.replace(/\s+/g, ' ').trim()
      if (text.length > 8) out.push(text)
    }
  }
  return out
}

const key = (lesson: string, id: string): string => `${lesson}|${id}`

/** Every uncited chip and fact-bearing uncited sentence, with the S2 denominators per track. */
export function scanCoverage(): Coverage {
  const chips: UncitedChip[] = []
  const sentences: UncitedSentence[] = []
  const chipsTotal: Record<string, number> = {}
  const sentencesTotal: Record<string, number> = {}
  for (const lesson of ALL_LESSONS) {
    const track = lesson.trackId
    for (const block of lesson.blocks) {
      if (block.type === 'statline') {
        for (const chip of block.stats) {
          chipsTotal[track] = (chipsTotal[track] ?? 0) + 1
          if (!chip.claim) chips.push({ lesson: lesson.id, label: chip.label, value: chip.value })
        }
      }
      const md = (block as { md?: unknown }).md
      if (typeof md !== 'string') continue
      for (const sentence of sentencesOf(md)) {
        const facts = factsIn(sentence)
        if (facts.length === 0) continue
        sentencesTotal[track] = (sentencesTotal[track] ?? 0) + 1
        if (CITED.test(sentence)) continue
        sentences.push({
          lesson: lesson.id,
          hash: rev32(sentence.toLowerCase()),
          facts,
          sample: sentence.length > 140 ? `${sentence.slice(0, 137)}…` : sentence,
        })
      }
    }
  }
  return { chips, sentences, chipsTotal, sentencesTotal }
}

export const BASELINE = join(import.meta.dir, 'baselines/claims-coverage.json')

export const readBaseline = (path = BASELINE): Baseline => {
  if (!existsSync(path)) return { chips: [], sentences: [] }
  return JSON.parse(readFileSync(path, 'utf8')) as Baseline
}

/** New uncited items and baseline entries that no longer are (cited, or gone). */
export function findings(baseline: Baseline, coverage: Coverage = scanCoverage()): Findings {
  const currentChips = new Set(coverage.chips.map((c) => key(c.lesson, c.label)))
  const currentSentences = new Set(coverage.sentences.map((s) => key(s.lesson, s.hash)))
  const baseChips = new Set(baseline.chips.map((c) => key(c.lesson, c.label)))
  const baseSentences = new Set(baseline.sentences.map((s) => key(s.lesson, s.hash)))
  return {
    newChips: coverage.chips.filter((c) => !baseChips.has(key(c.lesson, c.label))),
    newSentences: coverage.sentences.filter((s) => !baseSentences.has(key(s.lesson, s.hash))),
    staleChips: baseline.chips.filter((c) => !currentChips.has(key(c.lesson, c.label))),
    staleSentences: baseline.sentences.filter((s) => !currentSentences.has(key(s.lesson, s.hash))),
  }
}

export const isEmpty = (f: Findings): boolean =>
  f.newChips.length === 0 && f.newSentences.length === 0 && f.staleChips.length === 0 && f.staleSentences.length === 0

const pct = (cited: number, total: number): string => (total === 0 ? 'n/a' : `${((cited / total) * 100).toFixed(1)} %`)

/** The S2 report: chips cited and fact-bearing sentences cited, per track. */
export function formatReport(coverage: Coverage = scanCoverage()): string {
  const lines = ['S2 coverage (cited / total)']
  const tracks = [...new Set(ALL_LESSONS.map((l) => l.trackId))]
  for (const track of tracks) {
    const uc = coverage.chips.filter((c) => c.lesson.startsWith(`${track}.`)).length
    const us = coverage.sentences.filter((s) => s.lesson.startsWith(`${track}.`)).length
    const ct = coverage.chipsTotal[track] ?? 0
    const st = coverage.sentencesTotal[track] ?? 0
    lines.push(`  ${track.toUpperCase().padEnd(3)} chips ${ct - uc}/${ct} ${pct(ct - uc, ct)} · dated sentences ${st - us}/${st} ${pct(st - us, st)}`)
  }
  return lines.join('\n')
}

const printFindings = (f: Findings): void => {
  for (const c of f.newChips) console.error(`  new chip      ${c.lesson} ${c.label} = ${c.value}`)
  for (const s of f.staleChips) console.error(`  stale chip    ${s.lesson} ${s.label} (now cited or gone; remove its baseline line)`)
  for (const s of f.newSentences) console.error(`  new sentence  ${s.lesson}#${s.hash} ${s.facts.join(',')}  "${s.sample}"`)
  for (const s of f.staleSentences) console.error(`  stale sentence ${s.lesson}#${s.hash} (now cited or gone; remove its baseline line)`)
}

const main = (): number => {
  const args = process.argv.slice(2)
  const mode = args[0] ?? ''
  if (!['', '--check', '--update'].includes(mode) || args.length > 1) {
    console.error('usage: bun scripts/claims-coverage.ts [--check | --update]')
    return 2
  }
  const coverage = scanCoverage()
  if (mode === '--update') {
    const first = !existsSync(BASELINE)
    const before = readBaseline()
    const f = findings(before, coverage)
    if (!first && f.newChips.length + f.newSentences.length > 0) {
      printFindings(f)
      console.error('the baseline may only shrink: cite the new item, or shrink it without a baseline line')
      return 1
    }
    const next: Baseline = {
      chips: coverage.chips.sort((a, b) => key(a.lesson, a.label).localeCompare(key(b.lesson, b.label))),
      sentences: coverage.sentences.sort((a, b) => key(a.lesson, a.hash).localeCompare(key(b.lesson, b.hash))),
    }
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`wrote ${next.chips.length} chips and ${next.sentences.length} sentences (${f.staleChips.length + f.staleSentences.length} stale removed)`)
    return 0
  }
  console.log(formatReport(coverage))
  const f = findings(readBaseline(), coverage)
  if (isEmpty(f)) {
    console.log(`coverage: ok, ${coverage.chips.length} uncited chips and ${coverage.sentences.length} uncited dated sentences are baselined`)
    return 0
  }
  printFindings(f)
  console.error('coverage: a new uncited item fails; a baselined item that is now cited fails until its line is removed')
  return 1
}

if (import.meta.main) process.exit(main())
