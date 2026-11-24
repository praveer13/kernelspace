/**
 * snapshot-refs — the positional refs every lesson defines, with the fingerprint the ledger stores for each
 * (docs/specs/wave-1.md §4.5; Wave 1 stage 0, task K1-1).
 *
 * A stored answer is keyed by its ref (`quiz:t0.l1#2`, `pre:t2.l1#0`, `item:t5.l5.iso.1.break`, ...). Moving a
 * question, reordering an item or rewriting its stem changes what that ref means, and the learner's stored answer
 * then points at something they never answered. This script writes the baseline (`tests/fixtures/ref-revs.json`)
 * that `tests/kc/ref-stability.test.ts` guards: a ref may disappear or change its fingerprint only when
 * `tests/fixtures/ref-allow.json` names it with a one-shot row, so every lesson PR shows the stored answers it
 * re-points. A row looks like `{"ref":"quiz:t0.l1#2","reason":"rewritten","rev":"<the new fingerprint>"}` or
 * `{"ref":"pre:t2.l1#3","reason":"moved","to":"pre:t2.l1#4"}`.
 *
 * The collector reads content directly. It must not go through `buildKcContent`, which indexes only tagged items
 * and would skip an untagged question without saying so. The fingerprints are the ones the writers use:
 * `quizRev`, `prequestionRev`, `diagramPredictRev`, `constructedRev` and `authoredItemRev` from
 * `src/lib/kc/resolve.ts`, `alignRev` for the isomorphism panel's base pairs, and `quizRev` again for an alignment
 * item (the shared player's fingerprint of its question).
 *
 *   bun scripts/snapshot-refs.ts --check   compare the tree with the baseline and the allowlist; exit 1 on a finding
 *   bun scripts/snapshot-refs.ts           write the baseline; refuses to drop or change a ref without --accept
 *   bun scripts/snapshot-refs.ts --accept  rewrite the baseline after review (a wave boundary, not a content PR)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_LESSONS } from '../src/data/lessons'
import type { Lesson } from '../src/data/lessons/types'
import { R_ANCHORS } from '../src/data/placement/anchors'
import type { AuthoredItem } from '../src/lib/items/types'
import {
  authoredItemRev,
  constructedRev,
  diagramPredictRev,
  prequestionRev,
  quizRev,
} from '../src/lib/kc/resolve'
import {
  alignRef,
  alignRev,
  breakItem,
  isActive,
} from '../src/lib/learner/iso'
import { PROTEGE_STEPS, stepItem, stepRef } from '../src/lib/learner/protege'
import { activePredict, diaRef, preRef } from '../src/lib/learner/prequestions'

export interface RefEntry {
  ref: string
  rev: string
}

/** Why a stored answer may be re-pointed. `moved` names the ref that now holds it. */
export type RefReason = 'rewritten' | 'reindexed' | 'moved'

export interface RefAllow {
  ref: string
  reason: RefReason
  /** For `rewritten`: the fingerprint the PR accepts. A later change needs a new row. */
  rev?: string
  /** For `moved` and `reindexed`: the ref that now writes this answer. */
  to?: string
}

export type RefFindingKind = 'changed' | 'missing' | 'stale' | 'unknown' | 'malformed' | 'duplicate'

export interface RefFinding {
  ref: string
  kind: RefFindingKind
  detail: string
}

const REASONS: readonly RefReason[] = ['rewritten', 'reindexed', 'moved']

/**
 * Every positional ref the lessons define, in reading order, each with the fingerprint its writer stores.
 *
 * The counts follow the writers, not a lesson-wide model: a quiz or predict block numbers its own items from 0
 * (`QuizBlock`, `Prequestions`), a code block's alignment items count across the lesson's code blocks from 1
 * (`AlignItem`), a diagram writes a `dia:` ref only when `activePredict` accepts it, and an isomorphism panel writes
 * nothing unless it has a break item (`isActive`). If content reuses a ref, two items would answer to one stored
 * answer, so this throws rather than pick one.
 *
 * Placement anchors are included though the walk does not write item events yet: they are authored stored-answer refs
 * with a fingerprint, and they will. Errata cards (`card:`) and lab twins (`item:lab<NN>.twin.<n>`) are not lesson
 * refs and are outside K1-1; a package that renumbers them snapshots them then.
 */
export function collectRefs(lessons: readonly Lesson[] = ALL_LESSONS, anchors: readonly AuthoredItem[] = R_ANCHORS): RefEntry[] {
  const out: RefEntry[] = []
  const seen = new Set<string>()
  const put = (ref: string, rev: string): void => {
    if (seen.has(ref)) throw new Error(`duplicate ref ${ref}: two items write the same stored answer`)
    seen.add(ref)
    out.push({ ref, rev })
  }

  for (const lesson of lessons) {
    let iso = 0
    let protege = 0
    let align = 0
    lesson.blocks.forEach((b, bi) => {
      if (b.type === 'quiz') {
        b.questions.forEach((q, qi) => put(`quiz:${lesson.id}#${qi}`, quizRev(q)))
      } else if (b.type === 'predict') {
        b.items.forEach((p, pi) => put(preRef(lesson.id, pi), prequestionRev(p)))
      } else if (b.type === 'diagram') {
        const d = activePredict(b)
        if (d) put(diaRef(lesson.id, bi), diagramPredictRev(d))
      } else if (b.type === 'isomorphism') {
        const n = ++iso
        if (isActive(b)) {
          put(alignRef(lesson.id, n), alignRev(b))
          put(`item:${lesson.id}.iso.${n}.break`, authoredItemRev(breakItem(lesson.id, n, b, b.breakItem).item))
        }
      } else if (b.type === 'protege') {
        const n = ++protege
        for (const step of PROTEGE_STEPS) put(stepRef(lesson.id, n, step), authoredItemRev(stepItem(lesson.id, n, b, step).item))
      }
      if (b.type === 'code' && b.align) {
        for (const q of b.align) {
          align += 1
          put(`item:${lesson.id}.align.${align}`, quizRev(q))
        }
      }
    })
    lesson.ticket?.cr?.forEach((c, i) => put(`cr:${lesson.id}#${i}`, constructedRev(c)))
    lesson.ticket?.spiral?.forEach((item) => put(`item:${item.id}`, authoredItemRev(item)))
  }
  for (const anchor of anchors) put(`item:${anchor.id}`, authoredItemRev(anchor))
  return out
}

const duplicates = (list: readonly RefEntry[]): RefFinding[] => {
  const seen = new Set<string>()
  const findings: RefFinding[] = []
  for (const e of list) {
    if (seen.has(e.ref)) findings.push({ ref: e.ref, kind: 'duplicate', detail: 'the same ref appears twice' })
    seen.add(e.ref)
  }
  return findings
}

/**
 * What has to be said before the tree may replace the baseline: a ref that disappeared, a ref whose fingerprint
 * changed, and an allowlist that is malformed, stale or names nothing. An empty result means the guard passes.
 *
 * A row is one-shot: `rewritten` carries the fingerprint the PR accepts, so the same row cannot excuse a later
 * change; `moved` and `reindexed` describe a ref that no longer exists and carry the new ref, which must be a ref this
 * tree writes and the baseline did not have. A ref the tree still writes is `rewritten`: it now holds something else,
 * so there is no move target. A new ref with no row is not a finding (appending content is allowed); the writer
 * appends it to the baseline.
 */
export function compareRefs(
  baseline: readonly RefEntry[],
  current: readonly RefEntry[],
  allow: readonly RefAllow[] = [],
): RefFinding[] {
  const findings = [...duplicates(baseline), ...duplicates(current)]
  const now = new Map(current.map((e) => [e.ref, e.rev]))
  const before = new Map(baseline.map((e) => [e.ref, e.rev]))

  const allowed = new Map<string, RefAllow>()
  const noisy = new Set<string>()
  for (const entry of allow) {
    if (allowed.has(entry.ref)) {
      findings.push({ ref: entry.ref, kind: 'duplicate', detail: 'the allowlist names this ref twice' })
      noisy.add(entry.ref)
      continue
    }
    allowed.set(entry.ref, entry)
    if (!REASONS.includes(entry.reason)) {
      findings.push({ ref: entry.ref, kind: 'malformed', detail: `reason "${String(entry.reason)}" is not one of ${REASONS.join(', ')}` })
      continue
    }
    if (entry.reason === 'rewritten') {
      if (!entry.rev) findings.push({ ref: entry.ref, kind: 'malformed', detail: 'rewritten needs the fingerprint the PR accepts' })
      continue
    }
    if (!entry.to) {
      findings.push({ ref: entry.ref, kind: 'malformed', detail: `${entry.reason} needs the ref that now writes the answer` })
    } else if (!now.has(entry.to)) {
      findings.push({ ref: entry.ref, kind: 'malformed', detail: `points at ${entry.to}, which no item writes` })
    } else if (before.has(entry.to)) {
      findings.push({ ref: entry.ref, kind: 'malformed', detail: `points at ${entry.to}, a ref the baseline already had` })
    }
  }

  for (const [ref, rev] of before) {
    const next = now.get(ref)
    const entry = allowed.get(ref)
    if (next === undefined) {
      if (!entry) findings.push({ ref, kind: 'missing', detail: 'no item writes this ref any more' })
      else if (entry.reason === 'rewritten') {
        findings.push({ ref, kind: 'missing', detail: 'a rewrite keeps its ref; a missing ref is moved or reindexed' })
      }
      continue
    }
    if (next === rev) {
      if (entry && !noisy.has(ref)) findings.push({ ref, kind: 'stale', detail: 'the allowlist excuses a ref that has not changed; remove the entry' })
      continue
    }
    if (!entry) {
      findings.push({ ref, kind: 'changed', detail: `fingerprint changed from ${rev} to ${next}` })
    } else if (entry.reason !== 'rewritten') {
      findings.push({ ref, kind: 'malformed', detail: `${entry.reason} describes a ref that disappeared; this ref still exists, so it is rewritten` })
    } else if (entry.rev === undefined) {
      // the allowlist validation already reported the missing fingerprint
    } else if (entry.rev !== next) {
      findings.push({ ref, kind: 'changed', detail: `fingerprint changed from ${rev} to ${next}; the row accepts ${entry.rev}` })
    }
  }

  for (const ref of allowed.keys()) {
    if (!before.has(ref)) findings.push({ ref, kind: 'unknown', detail: 'the allowlist names no baseline ref; remove the entry' })
  }
  return findings
}

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASELINE = join(ROOT, 'tests/fixtures/ref-revs.json')
const ALLOWLIST = join(ROOT, 'tests/fixtures/ref-allow.json')

interface BaselineFile {
  version: 1
  refs: RefEntry[]
}

const readBaseline = (): BaselineFile => {
  if (!existsSync(BASELINE)) {
    throw new Error(`no baseline at ${BASELINE}; run bun scripts/snapshot-refs.ts once to write it`)
  }
  return JSON.parse(readFileSync(BASELINE, 'utf8')) as BaselineFile
}

const readAllow = (): RefAllow[] => {
  if (!existsSync(ALLOWLIST)) return []
  return JSON.parse(readFileSync(ALLOWLIST, 'utf8')) as RefAllow[]
}

/** One entry per line, so a PR's baseline diff shows exactly the refs it adds. */
export const serialize = (refs: readonly RefEntry[]): string => {
  const body = refs.map((e) => `    ${JSON.stringify(e)}`).join(',\n')
  return `{\n  "version": 1,\n  "refs": [\n${body}\n  ]\n}\n`
}

const print = (findings: readonly RefFinding[]): void => {
  for (const f of findings) console.error(`  ${f.kind.padEnd(9)} ${f.ref}  ${f.detail}`)
}

const main = (): number => {
  const args = process.argv.slice(2)
  const known = new Set(['--check', '--accept'])
  const unknown = args.filter((a) => !known.has(a))
  if (unknown.length > 0) {
    console.error(`usage: bun scripts/snapshot-refs.ts [--check | --accept]\nunknown: ${unknown.join(' ')}`)
    return 2
  }
  if (args.includes('--check') && args.includes('--accept')) {
    console.error('--check only compares; --accept rewrites the baseline. Pass one.')
    return 2
  }
  const current = collectRefs()
  const baseline = readBaseline()
  const added = current.filter((e) => !baseline.refs.some((b) => b.ref === e.ref))

  if (args.includes('--check')) {
    const findings = compareRefs(baseline.refs, current, readAllow())
    if (findings.length > 0) {
      console.error(`${findings.length} ref finding${findings.length === 1 ? '' : 's'} against ${baseline.refs.length} baseline refs:`)
      print(findings)
      console.error('A changed or missing ref needs a one-shot row in tests/fixtures/ref-allow.json.')
      return 1
    }
    if (added.length > 0) {
      console.log(`${added.length} new ref${added.length === 1 ? '' : 's'} not in the baseline (allowed; run without --check to add them, once there are no findings):`)
      for (const e of added) console.log(`  + ${e.ref}`)
    }
    console.log(`${current.length} refs match the baseline (${baseline.refs.length} baseline, ${added.length} new)`)
    return 0
  }

  const findings = compareRefs(baseline.refs, current)
  if (findings.length > 0 && !args.includes('--accept')) {
    console.error('the baseline would lose or change refs:')
    print(findings)
    console.error('review them, then rerun with --accept (a wave boundary, not a content PR).')
    return 1
  }
  if (findings.length > 0) {
    console.error(`rewriting the baseline with ${findings.length} change${findings.length === 1 ? '' : 's'}:`)
    print(findings)
  }
  writeFileSync(BASELINE, serialize(current))
  console.log(`wrote ${current.length} refs to tests/fixtures/ref-revs.json (${added.length} new)`)
  return 0
}

if (import.meta.main) {
  try {
    process.exit(main())
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
}
