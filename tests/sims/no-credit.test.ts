/**
 * No credit without a prediction (docs/specs/wave-3.md §18.1 B5, §13, D17, D29; task 3c-01). A sim task earns XP and
 * feeds a KC card, a ring or VRK30 only when it is an outcome task: predict, run, explain. This file is the exit gate
 * for the "remaining P2" scope, in four parts:
 *
 *  1. One registry. Every registered task lives in exactly one `*.tasks.ts` file, once, and the registry is the one
 *     `import.meta.glob` over those files.
 *  2. No sim component (or page, or any other component) keeps an inline task array: the `{id, text, xp}` literals of
 *     the pre-registry sims are gone.
 *  3. Every `taskIds` entry of a lesson exercise block resolves to an outcome task on the block's own sim. A link-card
 *     block has no `taskIds` (free-text `tasks`), is exempt, and earns nothing.
 *  4. A legacy completion earns 0 XP and resolves to no KC, so it feeds no card, ring or VRK30; an old completion named
 *     by an outcome task's `legacyId` (a string or a list, D29) shows as finished and pays the same 0.
 *
 * The earning side is read from the real store and the real ledger (the façade's `recordSimTask` and `recordSimOutcome`,
 * the fold, `xpOf`, the KC resolver, `deriveCards`, `selectVrk30`, `selectRings`), with an outcome completion as the
 * positive control, so a gate that stopped discriminating would fail here.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { ExerciseBlock, SimExerciseBlock } from '../../src/data/lessons/types'
import { BOOT_KCS, KCS } from '../../src/data/kc'
import { MINUTES, factMinutes, selectRings, xpBySource, xpOf } from '../../src/lib/economy'
import { kcsOfEvent, buildKcContent, rawKcsOfEvent } from '../../src/lib/kc/resolve'
import { cardsContent, deriveCards } from '../../src/lib/learner/cards'
import { selectVrk30 } from '../../src/lib/learner/vrk'
import type { LedgerEvent } from '../../src/lib/ledger/types'
import { ExerciseView } from '../../src/pages/lesson/exercise'
import { PENDING_TASK_IDS, buildRegistry, planExercise, type Registry } from '../../src/lib/sims/registry'
import type { SimTaskDef } from '../../src/lib/sims/types'
import { makeProfile, startTab } from '../ledger/env'

const ROOT = join(import.meta.dir, '..', '..')
const SRC = join(ROOT, 'src')
const SIMS_DIR = join(SRC, 'components', 'sims')

/** The tasks files, loaded with Bun the way `import.meta.glob` loads them in Vite (as tests/sims/registry.test.ts does). */
const modules: Record<string, Record<string, unknown>> = {}
for (const f of new Bun.Glob('*.tasks.ts').scanSync(SIMS_DIR)) {
  modules[`/src/components/sims/${f}`] = (await import(join(SIMS_DIR, f))) as Record<string, unknown>
}
const reg = buildRegistry(modules)

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const legacyIdsOf = (t: SimTaskDef): string[] => (t.legacyId === undefined ? [] : [t.legacyId].flat())

/* ------------------------------------------------------------------ */
/* 1. One registry                                                      */
/* ------------------------------------------------------------------ */

/** Every task a set of modules declares, with the file and the export it sits in. */
function declared(mods: Readonly<Record<string, Record<string, unknown>>>): { file: string; list: string; id: string }[] {
  const out: { file: string; list: string; id: string }[] = []
  for (const [path, mod] of Object.entries(mods)) {
    const file = path.slice(path.lastIndexOf('/') + 1)
    for (const [list, value] of Object.entries(mod)) {
      if (!Array.isArray(value)) continue
      for (const entry of value as unknown[]) if (isRec(entry) && typeof entry.id === 'string') out.push({ file, list, id: entry.id })
    }
  }
  return out
}

/** Ids declared more than once, anywhere (two files, or twice in one), with where. */
function declaredTwice(rows: readonly { file: string; list: string; id: string }[]): string[] {
  const seen = new Map<string, string[]>()
  for (const r of rows) seen.set(r.id, [...(seen.get(r.id) ?? []), `${r.file}:${r.list}`])
  return [...seen].filter(([, where]) => where.length > 1).map(([id, where]) => `${id} in ${where.join(' and ')}`)
}

describe('every registered task lives in exactly one tasks file', () => {
  const rows = declared(modules)

  test('the registry builds without a problem and holds the 117 tasks: 38 outcome and 79 legacy (spec §13)', () => {
    expect(reg.problems).toEqual([])
    expect(reg.tasks).toHaveLength(117)
    expect(reg.tasks.filter((t) => t.kind === 'outcome')).toHaveLength(38)
    expect(reg.tasks.filter((t) => t.kind === 'legacy')).toHaveLength(79)
  })

  test('no id is declared in two files, or twice in one, and the registry holds exactly the declared ids', () => {
    expect(declaredTwice(rows)).toEqual([])
    expect(rows).toHaveLength(reg.tasks.length)
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(reg.tasks.map((t) => t.id)))
  })

  test('every tasks file contributes tasks, and an id is declared in one file only', () => {
    const perFile = new Map<string, number>()
    for (const r of rows) perFile.set(r.file, (perFile.get(r.file) ?? 0) + 1)
    expect(perFile.size).toBe(Object.keys(modules).length)
    for (const [file, n] of perFile) expect(n, file).toBeGreaterThan(0)
  })

  test('the check sees a task declared in two files, and one declared twice in a file', () => {
    const a = { id: 't-x', text: 'x', xp: 60 }
    const two = declared({ '/src/components/sims/a.tasks.ts': { A: [a] }, '/src/components/sims/b.tasks.ts': { B: [a] } })
    expect(declaredTwice(two)).toEqual(['t-x in a.tasks.ts:A and b.tasks.ts:B'])
    expect(declaredTwice(declared({ '/src/components/sims/a.tasks.ts': { A: [a, a] } }))).toEqual(['t-x in a.tasks.ts:A and a.tasks.ts:A'])
    expect(declaredTwice(declared({ '/src/components/sims/a.tasks.ts': { A: [a], HOME: { simId: 'sim-vm' } } }))).toEqual([])
  })

  /** Every file under `dir`, recursively, as paths relative to src. */
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [relative(SRC, join(dir, e.name))]))
  const srcFiles = walk(SRC)

  test('there is one discovery: a single glob over src/components/sims, and no tasks file anywhere else', () => {
    expect(srcFiles.filter((f) => f.endsWith('.tasks.ts') && !f.startsWith(join('components', 'sims') + '/'))).toEqual([])
    const globbing = srcFiles.filter((f) => /\.(ts|tsx)$/.test(f) && /import\.meta\.glob\(\s*['"`][^'"`]*\.tasks\.ts/.test(readFileSync(join(SRC, f), 'utf8')))
    expect(globbing).toEqual([join('lib', 'sims', 'registry.ts')])
  })

  test('no second registry is built: buildRegistry is called by the registry module alone', () => {
    const users = srcFiles.filter((f) => /\.(ts|tsx)$/.test(f) && /\bbuildRegistry\(/.test(readFileSync(join(SRC, f), 'utf8')))
    expect(users).toEqual([join('lib', 'sims', 'registry.ts')])
  })
})

/* ------------------------------------------------------------------ */
/* 2. No inline task arrays                                             */
/* ------------------------------------------------------------------ */

/**
 * Task literals written in a source file: a pre-registry `{ id: …, text: …, xp: 60 }` (any key order, any spacing) or
 * a registry entry written by hand, `{ …, kind: 'legacy' | 'outcome', simId: … }`. Comments are blanked first so a
 * doc comment that shows the shape does not count, and strings are kept: the id and the text are strings.
 */
function taskLiterals(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length)).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
  const objects = code.match(/\{[^{}]*\}/g) ?? []
  return objects.filter(
    (o) =>
      (/\bid\s*:\s*['"`]/.test(o) && /\btext\s*:/.test(o) && /\bxp\s*:\s*\d/.test(o)) ||
      (/\bkind\s*:\s*['"`](legacy|outcome)['"`]/.test(o) && /\bsimId\s*:/.test(o)),
  )
}

describe('no sim component holds an inline task array', () => {
  const rows = declared(modules)
  const files = new Bun.Glob('**/*.{ts,tsx}')
  const scanned = ['components', 'pages'].flatMap((dir) =>
    [...files.scanSync(join(SRC, dir))].filter((f) => !f.endsWith('.tasks.ts')).map((f) => join(SRC, dir, f)),
  )

  test('the sims directory is scanned, with its twenty-odd components and hosts', () => {
    expect(scanned.filter((f) => f.startsWith(SIMS_DIR) && f.endsWith('.tsx')).length).toBeGreaterThanOrEqual(15)
  })

  test('no component or page writes a task literal: the lists are imported from tasks files', () => {
    const offenders = scanned.flatMap((f) => taskLiterals(readFileSync(f, 'utf8')).map((o) => `${relative(ROOT, f)}: ${o.replace(/\s+/g, ' ').slice(0, 80)}`))
    expect(offenders).toEqual([])
  })

  test('the scanner finds a legacy literal, a hand-written registry entry and a multi-line literal, and not a comment or a lesson-free object', () => {
    expect(taskLiterals("const T = [{ id: 't-a', text: 'Do a thing', xp: 60 }]")).toHaveLength(1)
    expect(taskLiterals("const T = [\n  {\n    xp: 60,\n    text: `Do a thing`,\n    id: 't-a',\n  },\n]")).toHaveLength(1)
    expect(taskLiterals("const T = [{ id: 'x.y', kind: 'outcome', simId: 'sim-kv', title: 't' }]")).toHaveLength(1)
    expect(taskLiterals("const T = [{ id: 'x', kind: 'legacy', simId: 'sim-kv' }]")).toHaveLength(1)
    expect(taskLiterals("/* { id: 't-a', text: 'x', xp: 60 } */\n// { id: 't-b', text: 'y', xp: 60 }\nconst x = { id: 'vector-add', label: 'Vector add' }")).toEqual([])
    expect(taskLiterals("const toast = { key: 1, text: task.text, xp: task.xp }")).toEqual([])
  })

  test('every file that holds legacy tasks is imported by a sim component, which renders that list and writes none', () => {
    const sources = scanned.filter((f) => f.startsWith(SIMS_DIR) && f.endsWith('.tsx')).map((f) => readFileSync(f, 'utf8'))
    const legacyFiles = [...new Set(reg.tasks.filter((t) => t.kind === 'legacy').map((t) => rows.find((r) => r.id === t.id)!.file))]
    expect(legacyFiles.length).toBeGreaterThanOrEqual(10)
    for (const file of legacyFiles) {
      const name = file.replace(/\.ts$/, '')
      expect(sources.some((src) => src.includes(`/${name}'`)), `${file} is imported by a component`).toBe(true)
    }
  })
})

/* ------------------------------------------------------------------ */
/* 3. Lesson exercise blocks                                            */
/* ------------------------------------------------------------------ */

/** What is wrong with a sim exercise block that lists `taskIds`: an id that does not resolve to an outcome task on the block's sim. */
function taskIdProblems(b: SimExerciseBlock, r: Registry, pending: readonly string[] = PENDING_TASK_IDS): string[] {
  if (b.taskIds === undefined) return []
  const out: string[] = []
  if (b.taskIds.length === 0) out.push('lists no task')
  if (new Set(b.taskIds).size !== b.taskIds.length) out.push('lists a task twice')
  for (const id of b.taskIds) {
    const t = r.byId(id)
    if (pending.includes(id)) out.push(`${id} is pending, not registered`)
    else if (t === undefined) out.push(`${id} is not registered`)
    else if (t.kind !== 'outcome') out.push(`${id} is a ${t.kind} task, which earns nothing`)
    else if (t.simId !== b.simId) out.push(`${id} belongs to ${t.simId}, not ${b.simId}`)
  }
  return out
}

describe('every taskIds entry of a lesson exercise block resolves to an outcome task', () => {
  const blocks = ALL_LESSONS.flatMap((l) =>
    l.blocks.flatMap((b, i) => (b.type === 'exercise' && 'simId' in b ? [{ lesson: l.id, i, b }] : [])),
  )
  const inline = blocks.filter((x) => x.b.taskIds !== undefined)
  const cards = blocks.filter((x) => x.b.taskIds === undefined)

  test('the tree has both kinds of block to check, and the counts are printed', () => {
    console.log(`exercise blocks: ${blocks.length} (${inline.length} inline with taskIds, ${cards.length} link cards, exempt)`)
    expect(inline.length).toBeGreaterThanOrEqual(10)
    expect(cards.length).toBeGreaterThan(0)
  })

  test('no pending id is excused: the list is empty, so every entry has to be registered', () => {
    expect(PENDING_TASK_IDS).toEqual([])
  })

  for (const { lesson, i, b } of inline) {
    test(`${lesson} block #${i} (${b.simId}): ${b.taskIds!.length} task ids, all outcome tasks of ${b.simId}`, () => {
      expect(taskIdProblems(b, reg)).toEqual([])
      for (const id of b.taskIds!) {
        const t = reg.byId(id) as SimTaskDef
        expect(t.kcs.length, `${id} names its KCs`).toBeGreaterThan(0)
        expect(t.predict, `${id} asks for a prediction`).toBeDefined()
      }
      expect(planExercise(b.simId, b.machine, b.taskIds, reg)).toEqual({ show: 'inline', taskIds: b.taskIds })
    })
  }

  test('the check names a legacy id, a pending id, an unknown id, another sim’s id and an empty list', () => {
    const block = (taskIds: string[], simId: SimExerciseBlock['simId'] = 'sim-roofline'): SimExerciseBlock => ({ type: 'exercise', simId, title: 'x', tasks: [], taskIds })
    expect(taskIdProblems(block(['roof.ridge']), reg)).toEqual([])
    expect(taskIdProblems(block(['t-sched-fifo'], 'sim-batching'), reg)).toEqual(['t-sched-fifo is a legacy task, which earns nothing'])
    expect(taskIdProblems(block(['roof.nope']), reg)).toEqual(['roof.nope is not registered'])
    expect(taskIdProblems(block(['roof.ridge']), reg, ['roof.ridge'])).toEqual(['roof.ridge is pending, not registered'])
    expect(taskIdProblems(block(['kv.gqa']), reg)).toEqual(['kv.gqa belongs to sim-kv, not sim-roofline'])
    expect(taskIdProblems(block([]), reg)).toEqual(['lists no task'])
    expect(taskIdProblems(block(['roof.ridge', 'roof.ridge']), reg)).toEqual(['lists a task twice'])
    // a link-card block has no taskIds and nothing to resolve
    expect(taskIdProblems({ type: 'exercise', simId: 'sim-roofline', title: 'x', tasks: ['Open it'] }, reg)).toEqual([])
  })

  test('a link-card block has no taskIds, plans the card, and renders nothing a learner can complete', () => {
    for (const { lesson, i, b } of cards) {
      expect('taskIds' in b, `${lesson} #${i}`).toBe(false)
      expect(b.tasks.length, `${lesson} #${i} shows its free-text tasks`).toBeGreaterThan(0)
      expect(planExercise(b.simId, b.machine, b.taskIds, reg)).toEqual({ show: 'card' })
      const html = renderToStaticMarkup(
        createElement(MemoryRouter, null, createElement(ExerciseView, { block: b as ExerciseBlock, trackColor: '#fff', lessonId: lesson, tasks: reg })),
      )
      expect(html, `${lesson} #${i}`).toContain('Guided tasks')
      expect(html).not.toContain('data-inline=')
      // squares, not checkboxes: no input, and the one button is the note's toggle (aria-expanded), not a completion
      expect(html).not.toMatch(/<input\b|role="checkbox"/)
      for (const button of html.match(/<button\b[^>]*>/g) ?? []) expect(button).toContain('aria-expanded')
    }
  })

  test('a link card writes nothing: no component marks an exercise done, and an exercise fact pays 0', () => {
    const users = [...new Bun.Glob('**/*.{ts,tsx}').scanSync(SRC)].filter((f) => /\bmarkExerciseDone\b/.test(readFileSync(join(SRC, f), 'utf8')))
    expect(users).toEqual([join('lib', 'progress.ts')])
    for (const { lesson } of cards) expect(factMinutes(`exercise:${lesson}`)).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* 4. Legacy completions earn nothing                                   */
/* ------------------------------------------------------------------ */

type Stored = LedgerEvent & { provenance?: string; ok?: boolean; data?: { kcs?: string[]; outcome?: boolean } }

describe('a legacy completion earns 0 XP and resolves to no KC', () => {
  const legacy = reg.tasks.filter((t) => t.kind === 'legacy')
  const outcome = reg.tasks.filter((t) => t.kind === 'outcome')
  const kcContent = buildKcContent({ lessons: ALL_LESSONS })
  const cards = cardsContent({ kcs: KCS, lessons: ALL_LESSONS, bootKcs: BOOT_KCS, resolve: (e) => kcsOfEvent(e, kcContent) })

  /** A fresh learner, with `act` applied to the real store; the events and aggregate are read back from the ledger. */
  async function learner(act: (s: ReturnType<ReturnType<typeof startTab>['progress']['getState']>) => void) {
    const tab = startTab(makeProfile())
    act(tab.progress.getState())
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()) as Stored[]
    return { tab, events, state: tab.progress.getState(), agg: tab.progress.getState().aggregate }
  }

  const empty = learner(() => {})
  const everyLegacy = learner((s) => {
    for (const t of legacy) s.recordSimTask(t.simId, t.id)
  })

  test('there are legacy tasks to record, and each has no KC and no predict of its own', () => {
    expect(legacy).toHaveLength(79)
    for (const t of legacy) {
      expect(t.kcs, t.id).toEqual([])
      expect(t.predict, t.id).toBeUndefined()
    }
  })

  test('all 79 completions, recorded through the store: 0 XP in every source, no outcome, only the display fact', async () => {
    const { events, state, agg } = await everyLegacy
    expect(events).toHaveLength(79)
    expect(events.every((e) => e.kind === 'sim-task' && e.provenance === 'practice')).toBe(true)
    expect(events.every((e) => e.data?.outcome === undefined && e.data?.kcs === undefined)).toBe(true)
    expect(state.xp).toBe(0)
    expect(xpOf(agg)).toBe(0)
    expect(Object.values(xpBySource(agg)).every((v) => v === 0)).toBe(true)
    expect(Object.keys(agg.facts).every((f) => f.startsWith('sim:'))).toBe(true)
    for (const t of legacy) {
      expect(factMinutes(`sim:${t.simId}/${t.id}`), t.id).toBe(0)
      expect(Object.hasOwn(agg.sims[t.simId].outcomes, t.id), `${t.id} is not an outcome`).toBe(false)
      expect(agg.sims[t.simId].tasks[t.id], `${t.id} shows as finished`).toBe(true)
    }
  })

  test('none of the 79 resolves to a KC, by any of the resolver’s rules', async () => {
    const { events } = await everyLegacy
    for (const e of events) {
      expect(rawKcsOfEvent(e, kcContent), e.ref).toEqual([])
      expect(kcsOfEvent(e, kcContent), e.ref).toEqual([])
      expect(cards.resolve(e), e.ref).toEqual([])
    }
  })

  test('so they feed no card, no ring and no VRK30: the learner model reads the ledger as if they were not there', async () => {
    const { events, agg } = await everyLegacy
    const base = await empty
    const day = events[0].day
    expect(Object.keys(deriveCards(events, cards, day).cards)).toEqual([])
    const vrk = selectVrk30(events, cards, day)
    expect(vrk.checked).toEqual([])
    expect(vrk.retained).toEqual([])
    expect(selectRings(agg)).toEqual(selectRings(base.agg))
    expect(selectRings(agg).earned).toEqual(['RING 3'])
  })

  test('the control: an outcome completion pays the outcome minutes, carries its KCs and resolves to them', async () => {
    const task = reg.byId('roof.ridge') as SimTaskDef
    const { events, state, agg } = await learner((s) =>
      s.recordSimOutcome(task.simId, { taskId: task.id, score: 1, ok: true, data: { v: 2, outcome: true, predict: { value: 590 }, actual: 590.4, kcs: [...task.kcs] } }),
    )
    expect(events).toHaveLength(1)
    expect(state.xp).toBe(MINUTES.simOutcome)
    expect(xpOf(agg)).toBeGreaterThan(0)
    expect(agg.sims[task.simId].outcomes[task.id]).toBe(true)
    expect(task.kcs.length).toBeGreaterThan(0)
    expect(kcsOfEvent(events[0], kcContent)).toEqual(expect.arrayContaining([...task.kcs]))
  })

  test('every outcome task names KCs for its completions to resolve to, and no legacy task does', () => {
    expect(outcome).toHaveLength(38)
    for (const t of outcome) expect(t.kcs.length, t.id).toBeGreaterThan(0)
    expect(reg.tasks.filter((t) => t.kcs.length > 0)).toHaveLength(outcome.length)
  })
})

describe('legacyId may be a string or a list (D29)', () => {
  const replaced = reg.tasks.filter((t) => t.legacyId !== undefined)
  const oldIds = replaced.flatMap((t) => legacyIdsOf(t).map((old) => ({ task: t, old })))

  test('a string names one old id, a list names several, and the list is read whole', () => {
    expect(replaced.length).toBeGreaterThan(0)
    expect(replaced.some((t) => typeof t.legacyId === 'string')).toBe(true)
    const lists = replaced.filter((t) => Array.isArray(t.legacyId))
    expect(lists.map((t) => [t.id, legacyIdsOf(t)])).toEqual([['alloc.fixed-block-waste', ['t-paged', 't-quiz']]])
    expect(legacyIdsOf({ legacyId: 'a' } as SimTaskDef)).toEqual(['a'])
    expect(legacyIdsOf({ legacyId: ['a', 'b'] } as SimTaskDef)).toEqual(['a', 'b'])
    expect(legacyIdsOf({} as SimTaskDef)).toEqual([])
  })

  test('each old id is claimed by one outcome task and is no longer a registered task', () => {
    const ids = oldIds.map((x) => x.old)
    expect(new Set(ids).size).toBe(ids.length)
    for (const { task, old } of oldIds) {
      expect(task.kind, task.id).toBe('outcome')
      expect(reg.byId(old), `${old} left the registry`).toBeUndefined()
    }
  })

  test('an old completion of any of them shows, pays 0 XP, resolves to no KC and does not credit the new task', async () => {
    const tab = startTab(makeProfile())
    for (const { task, old } of oldIds) tab.progress.getState().recordSimTask(task.simId, old)
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()) as Stored[]
    const { sims, xp, aggregate } = tab.progress.getState()
    const kcContent = buildKcContent({ lessons: ALL_LESSONS })
    expect(events).toHaveLength(oldIds.length)
    expect(xp).toBe(0)
    expect(xpOf(aggregate)).toBe(0)
    for (const e of events) expect(kcsOfEvent(e, kcContent), e.ref).toEqual([])
    for (const { task, old } of oldIds) {
      // TaskPanel's "you finished the old click-through" reads exactly this
      expect(sims[task.simId].tasksDone, `${old} shows`).toContain(old)
      expect(aggregate.sims[task.simId].outcomes[task.id], `${task.id} is not done`).toBeUndefined()
    }
    // both of alloc.fixed-block-waste's old ids show
    expect(sims['sim-allocator'].tasksDone).toEqual(expect.arrayContaining(['t-paged', 't-quiz']))
  })
})
