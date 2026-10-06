/**
 * One task registry (P2, docs/specs/wave-1.md §10.2). Every sim task, outcome-graded or legacy, lives
 * here, discovered from `src/components/sims/*.tasks.ts` with `import.meta.glob`.
 *
 * A tasks module exports arrays; every element is one of:
 * - a `SimTaskDef` (has `kind` and `simId`): taken as written. New outcome tasks (`roofline.tasks.ts`,
 *   `kvCache.tasks.ts`, `allocator.tasks.ts`) are written this way;
 * - a pre-registry `{id, text, xp}` (the files that exist today): becomes `kind: 'legacy'` under the sim
 *   and machine in LEGACY_HOME, keeping its old id. A legacy completion still marks `sims[s].tasks[t]`
 *   and pays 0 XP (§8.4).
 *
 * Ids are unique across the registry. `buildRegistry` collects what is wrong instead of throwing, so one bad
 * file cannot take a lesson down; tests/sims/registry.test.ts requires `problems` to be empty.
 */

import type { SimId } from '@/data/lessons/types'
import type { SimTaskDef } from './types'

export interface Registry {
  /** Every task, in module (path) then declaration order. */
  readonly tasks: readonly SimTaskDef[]
  readonly problems: readonly string[]
  byId(id: string): SimTaskDef | undefined
  /** The sim's tasks for one machine: machine-less tasks always, machine-bound tasks only on their machine. */
  forSim(simId: string, machine?: string | null): readonly SimTaskDef[]
}

/** Where each existing `{id, text, xp}` file belongs. The key is the file name without `.tasks.ts`. */
const LEGACY_HOME: Readonly<Record<string, { simId: SimId; machine?: string }>> = {
  blockTableExplorer: { simId: 'sim-kv', machine: 'blocks' },
  contentionLab: { simId: 'sim-vm', machine: 'contention' },
  contextSwitchLab: { simId: 'sim-batching', machine: 'context-switch' },
  engineExt: { simId: 'sim-engine' },
  frameSim: { simId: 'sim-memory', machine: 'frames' },
  layoutLab: { simId: 'sim-memory', machine: 'layout' },
  matrixBench: { simId: 'sim-memory', machine: 'matrix' },
  pointerLab: { simId: 'sim-memory', machine: 'pointer' },
  rustLab: { simId: 'sim-allocator', machine: 'rust' },
  schedulerLab: { simId: 'sim-batching', machine: 'scheduler' },
}

const MAX_TITLE = 80

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** `/src/components/sims/rustLab.tasks.ts` → `rustLab`. */
const moduleName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.tasks\.ts$/, '')

function legacyDef(raw: Record<string, unknown>, home: { simId: SimId; machine?: string }): SimTaskDef | null {
  if (typeof raw.id !== 'string' || typeof raw.text !== 'string') return null
  const text = raw.text
  const def: SimTaskDef = {
    id: raw.id,
    simId: home.simId,
    kind: 'legacy',
    title: text.length <= MAX_TITLE ? text : `${text.slice(0, MAX_TITLE - 1).trimEnd()}…`,
    setup: text,
    kcs: [],
  }
  if (home.machine !== undefined) def.machine = home.machine
  return def
}

/** Problems with one outcome task, in the words the test prints. */
function outcomeProblems(t: SimTaskDef): string[] {
  const out: string[] = []
  if (t.predict === undefined) out.push('has no predict')
  else if (t.predict.kind === 'numeric') {
    const { abs, rel } = t.predict.tolerance
    if ((abs === undefined || !(abs >= 0)) && (rel === undefined || !(rel >= 0))) out.push('numeric predict has no tolerance')
    if (t.predict.unit.trim() === '') out.push('numeric predict has no unit')
  } else if (t.predict.options.length < 2 || new Set(t.predict.options.map((o) => o.id)).size !== t.predict.options.length) {
    out.push('choice predict needs two or more options with distinct ids')
  }
  if (t.observe === undefined || t.observe === '') out.push('has no observe key')
  if (t.explain === undefined) out.push('has no explain')
  else if (t.explain.ideas.length !== 3 || t.explain.ideas.some((i) => i.trim() === '') || t.explain.model.trim() === '') {
    out.push('explain needs a model answer and three ideas')
  }
  return out
}

/** Build a registry from loaded `*.tasks.ts` modules (path → module namespace). */
export function buildRegistry(modules: Readonly<Record<string, unknown>>): Registry {
  const tasks: SimTaskDef[] = []
  const problems: string[] = []
  const seen = new Set<string>()

  const add = (def: SimTaskDef, where: string) => {
    const bad: string[] = []
    if (seen.has(def.id)) bad.push('duplicate id')
    if (def.title.length === 0 || def.title.length > MAX_TITLE) bad.push(`title must be 1–${MAX_TITLE} characters`)
    if (def.kind === 'outcome') bad.push(...outcomeProblems(def))
    if (bad.length > 0) {
      for (const b of bad) problems.push(`${where}: task ${def.id}: ${b}`)
      if (bad.includes('duplicate id')) return
    }
    seen.add(def.id)
    tasks.push(def)
  }

  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path]
    if (!isRec(mod)) continue
    const name = moduleName(path)
    for (const value of Object.values(mod)) {
      if (!Array.isArray(value)) continue
      for (const raw of value as unknown[]) {
        if (!isRec(raw)) continue
        if ((raw.kind === 'outcome' || raw.kind === 'legacy') && typeof raw.simId === 'string') {
          add(raw as unknown as SimTaskDef, name)
          continue
        }
        const home = LEGACY_HOME[name]
        const def = home === undefined ? null : legacyDef(raw, home)
        if (def === null) problems.push(`${name}: an entry is neither a SimTaskDef nor a legacy task with a home in LEGACY_HOME`)
        else add(def, name)
      }
    }
  }

  const byId = new Map(tasks.map((t) => [t.id, t]))
  return {
    tasks,
    problems,
    byId: (id) => byId.get(id),
    forSim: (simId, machine) => tasks.filter((t) => t.simId === simId && (t.machine === undefined || t.machine === machine)),
  }
}

/**
 * Vite rewrites `import.meta.glob` at build time. Under `bun test` there is no such function, so a test
 * builds its own registry with `buildRegistry` over the modules it loads.
 */
function discover(): Record<string, unknown> {
  try {
    return import.meta.glob('/src/components/sims/*.tasks.ts', { eager: true })
  } catch {
    return {}
  }
}

export const registry: Registry = buildRegistry(discover())

/** The tasks an exercise block or an inline host lists: the ids given (in that order, unknown ids skipped), else all of the sim's. */
export function resolveTasks(
  simId: string,
  machine: string | null | undefined,
  taskIds?: readonly string[],
  from: Registry = registry,
): SimTaskDef[] {
  if (taskIds === undefined) return [...from.forSim(simId, machine)]
  const out: SimTaskDef[] = []
  for (const id of taskIds) {
    const t = from.byId(id)
    if (t !== undefined && t.simId === simId) out.push(t)
  }
  return out
}
