/**
 * The task registry (wave-1.md §10.2): it discovers every `*.tasks.ts`, keeps the existing tasks as
 * legacy entries under their old ids, and refuses an outcome task that cannot run predict → run → explain.
 * `import.meta.glob` is Vite's, so the tests load the same files with Bun.Glob and call `buildRegistry`.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_LESSONS } from '../../src/data/lessons'
import { KC } from '../../src/data/kc/ids'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { ExerciseView } from '../../src/pages/lesson/exercise'
import type { SimExerciseBlock } from '../../src/data/lessons/types'
import { PENDING_TASK_IDS, buildRegistry, planExercise, registry, resolveTasks } from '../../src/lib/sims/registry'
import type { SimTaskDef } from '../../src/lib/sims/types'

const ROOT = join(import.meta.dir, '..', '..')
const SIMS_DIR = join(ROOT, 'src', 'components', 'sims')

async function loadTaskModules(): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const f of new Bun.Glob('*.tasks.ts').scanSync(SIMS_DIR)) {
    out[`/src/components/sims/${f}`] = (await import(join(SIMS_DIR, f))) as Record<string, unknown>
  }
  return out
}

const modules = await loadTaskModules()
const reg = buildRegistry(modules)

/** A well-formed outcome task to break one field at a time. */
const outcome = (over: Partial<SimTaskDef> = {}): SimTaskDef => ({
  id: 'x.task',
  simId: 'sim-roofline',
  kind: 'outcome',
  title: 'Find the ridge',
  setup: 'Pick B200 and read the ridge.',
  kcs: [],
  predict: { kind: 'numeric', prompt: 'Ridge?', unit: 'FLOP/B', tolerance: { rel: 0.1 } },
  observe: 'roof.ridge',
  explain: { prompt: 'Why?', model: 'Because.', ideas: ['a', 'b', 'c'] },
  ...over,
})

/** An outcome task's id, `<prefix>.<name>`; a legacy id has no dot. */
const DOTTED = /^[a-z][a-z0-9-]*\./

/** The prefixes a registry's outcome tasks declare, each with the sims it is used on. */
const prefixesOf = (r: Pick<ReturnType<typeof buildRegistry>, 'tasks'>): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>()
  for (const t of r.tasks) {
    if (t.kind !== 'outcome') continue
    const prefix = t.id.slice(0, t.id.indexOf('.'))
    out.set(prefix, (out.get(prefix) ?? new Set()).add(t.simId))
  }
  return out
}

/** Whether a sim's source talks to the router itself instead of going through the shell's SimHost-aware hooks. */
const readsUrlItself = (src: string): boolean => /\b(useSearchParams|setSearchParams)\b/.test(src)

const problemsOf = (...tasks: SimTaskDef[]) => buildRegistry({ '/src/components/sims/x.tasks.ts': { T: tasks } }).problems

describe('discovery', () => {
  test('production code globs *.tasks.ts in src/components/sims', () => {
    const src = readFileSync(join(ROOT, 'src', 'lib', 'sims', 'registry.ts'), 'utf8')
    expect(src).toContain("import.meta.glob('/src/components/sims/*.tasks.ts'")
  })

  test('every tasks file contributes, and nothing is wrong with what they contribute', () => {
    expect(Object.keys(modules).length).toBeGreaterThanOrEqual(10)
    expect(reg.problems).toEqual([])
    const total = Object.values(modules).reduce(
      (n, mod) => n + Object.values(mod).reduce((m, v) => m + (Array.isArray(v) ? v.length : 0), 0),
      0,
    )
    expect(reg.tasks.length).toBe(total)
  })

  test('outside Vite the built-in registry is empty rather than a crash', () => {
    expect(registry.tasks).toEqual([])
  })
})

describe('legacy tasks keep their ids and pay as before', () => {
  const legacy = reg.tasks.filter((t) => t.kind === 'legacy')

  test('the existing ids are all there, under a sim, as legacy', () => {
    const ids = legacy.map((t) => t.id)
    for (const id of ['t-sched-fifo', 't-rust-move', 't-ctx-cliff', 't-lock-aba', 't-layout-aos', 't-eng-gqa', 't-frame-trace']) {
      expect(ids).toContain(id)
    }
    // the click-through ids an outcome task replaced (legacyId) are no longer registered: the task panel reads
    // an earlier completion from the progress store, not from the registry (wave-3.md §13)
    const replaced = reg.tasks.flatMap((t) => (t.legacyId === undefined ? [] : [t.legacyId].flat()))
    const roofline = ['t-cpu-serial', 't-gpu-map', 't-gpu-divergence', 't-roof-occupancy', 't-roof-coalesce', 't-roof-bank', 't-roof-tiers', 't-roof-pcie']
    const fleet = ['t-roof-fleet-router', 't-roof-fleet-decode', 't-roof-fleet-paged-attn', 't-roof-fleet-prefill']
    for (const id of ['t-frag', 't-coalesce', 't-paged', 't-quiz', 't-trace-lab', 't-double-free', 't-blk-share', 't-blk-cow', 't-blk-preempt', 't-blk-sweep', ...roofline, ...fleet]) {
      expect(replaced, id).toContain(id)
      expect(ids, id).not.toContain(id)
    }
    // outcome tasks arrive under dotted ids, `<prefix>.<name>`, and every other task is legacy. The prefixes are the ones the
    // tasks files declare (wave-3.md §4.2), so a new family adds its file and not a line here.
    for (const t of reg.tasks) expect(t.kind === 'outcome', t.id).toBe(DOTTED.test(t.id))
    for (const t of reg.tasks) if (t.kind === 'outcome') expect(t.id, 'the prefix is lower-case words').toMatch(/^[a-z][a-z0-9-]*\.[a-z0-9-]+$/)
    expect(legacy.length + reg.tasks.filter((t) => t.kind === 'outcome').length).toBe(reg.tasks.length)
    for (const t of legacy) {
      expect(t.predict).toBeUndefined()
      expect(t.kcs).toEqual([])
    }
  })

  test('machine-bound tasks show only on their machine; sim-wide tasks on every machine', () => {
    const sched = reg.forSim('sim-batching', 'scheduler').map((t) => t.id)
    expect(sched).toContain('t-sched-fifo')
    expect(sched).not.toContain('t-ctx-cliff')
    expect(reg.forSim('sim-batching', 'context-switch').map((t) => t.id)).toContain('t-ctx-cliff')
    expect(reg.forSim('sim-batching').map((t) => t.id)).toEqual([]) // default machine: its tasks are inline for now
    expect(reg.forSim('sim-engine').map((t) => t.id)).toContain('t-eng-gqa') // machine-less
    expect(reg.forSim('sim-engine', 'executor').map((t) => t.id)).toContain('t-eng-gqa')
  })

  test('a title is at most 80 characters; a longer legacy text moves to `setup` whole', () => {
    for (const t of reg.tasks) expect(t.title.length).toBeLessThanOrEqual(80)
    const long = buildRegistry({
      '/src/components/sims/rustLab.tasks.ts': { T: [{ id: 't-long', text: 'x'.repeat(120), xp: 60 }] },
    })
    expect(long.tasks[0].title).toHaveLength(80)
    expect(long.tasks[0].title.endsWith('…')).toBe(true)
    expect(long.tasks[0].setup).toBe('x'.repeat(120))
  })

  test('a legacy file with no home is a problem, not a silent drop', () => {
    const r = buildRegistry({ '/src/components/sims/mystery.tasks.ts': { T: [{ id: 't-a', text: 'a', xp: 60 }] } })
    expect(r.tasks).toEqual([])
    expect(r.problems[0]).toContain('mystery')
  })
})

describe('outcome prefixes come from the tasks files', () => {
  test('the registry declares the prefixes of the sims that have outcome tasks, and each prefix lives on one sim', () => {
    const prefixes = prefixesOf(reg)
    for (const p of ['roof', 'kv', 'alloc', 'zoo', 'blk']) expect(prefixes.has(p), p).toBe(true)
    for (const [p, sims] of prefixes) expect([...sims], `prefix ${p}`).toHaveLength(1)
  })

  test('a new family adds its file and prefix without touching this test', () => {
    const r = buildRegistry({
      '/src/components/sims/fleet.tasks.ts': { T: [outcome({ id: 'fleet.knee', simId: 'sim-batching', title: 'Find the knee' })] },
    })
    expect(r.problems).toEqual([])
    expect([...prefixesOf(r).keys()]).toEqual(['fleet'])
    expect(DOTTED.test('fleet.knee')).toBe(true)
    expect(DOTTED.test('t-sched-fifo')).toBe(false)
  })
})

describe('a tasks file may export HOME (wave-3.md §4.2)', () => {
  const old = (id: string) => ({ id, text: `Task ${id}`, xp: 60 })
  const file = (name: string, mod: Record<string, unknown>) => buildRegistry({ [`/src/components/sims/${name}.tasks.ts`]: mod })

  test('a HOME places a file that LEGACY_HOME does not know, so a new file edits no table', () => {
    const r = file('batching', { HOME: { simId: 'sim-batching', machine: 'batching' }, T: [old('t-batch-a')] })
    expect(r.problems).toEqual([])
    expect(r.byId('t-batch-a')).toMatchObject({ kind: 'legacy', simId: 'sim-batching', machine: 'batching' })
  })

  test('HOME is read before LEGACY_HOME: it moves a file that has a fallback', () => {
    const fallback = file('rustLab', { T: [old('t-x')] })
    expect(fallback.byId('t-x')).toMatchObject({ simId: 'sim-allocator', machine: 'rust' })
    const moved = file('rustLab', { HOME: { simId: 'sim-vm', machine: 'paging' }, T: [old('t-x')] })
    expect(moved.problems).toEqual([])
    expect(moved.byId('t-x')).toMatchObject({ simId: 'sim-vm', machine: 'paging' })
  })

  test('a machine-less HOME keeps the tasks on every machine; a HOME with a machine, only on that one', () => {
    const all = file('engineLike', { HOME: { simId: 'sim-engine' }, T: [old('t-e')] })
    expect(all.byId('t-e')?.machine).toBeUndefined()
    expect(all.forSim('sim-engine', 'executor').map((t) => t.id)).toEqual(['t-e'])
    expect(all.forSim('sim-engine').map((t) => t.id)).toEqual(['t-e'])
    const bound = file('batchLike', { HOME: { simId: 'sim-batching', machine: 'batching' }, T: [old('t-b')] })
    expect(bound.forSim('sim-batching', 'batching').map((t) => t.id)).toEqual(['t-b'])
    expect(bound.forSim('sim-batching', 'scheduler')).toEqual([])
    expect(bound.forSim('sim-batching')).toEqual([])
  })

  test('HOME is not a task list: it adds no task and does not count as an entry', () => {
    expect(file('batching', { HOME: { simId: 'sim-batching', machine: 'batching' }, T: [] }).tasks).toEqual([])
  })

  test('a SimTaskDef keeps its own sim and machine whatever HOME says', () => {
    const r = file('mixed', { HOME: { simId: 'sim-vm' }, T: [outcome({ id: 'mixed.one', simId: 'sim-kv', machine: 'zoo', title: 'One' })] })
    expect(r.byId('mixed.one')).toMatchObject({ simId: 'sim-kv', machine: 'zoo' })
  })

  test('a malformed HOME is a problem, and the file falls back to LEGACY_HOME when it has one', () => {
    for (const home of [{ simId: 3 }, { simId: '' }, { simId: 'sim-vm', machine: 4 }, { simId: 'sim-vm', machine: '' }, 'sim-vm', null]) {
      const r = file('mystery', { HOME: home, T: [old('t-a')] })
      expect(r.problems.join('\n'), JSON.stringify(home)).toContain('HOME must be')
    }
    const fell = file('rustLab', { HOME: { simId: 7 }, T: [old('t-x')] })
    expect(fell.problems).toEqual([expect.stringContaining('HOME must be')])
    expect(fell.byId('t-x')).toMatchObject({ simId: 'sim-allocator', machine: 'rust' })
  })
})

describe('outcome tasks must run predict → run → explain', () => {
  test('a complete outcome task is accepted as written, in any exported array', () => {
    const r = buildRegistry({ '/src/components/sims/roofline.tasks.ts': { ROOFLINE_TASKS: [outcome()] } })
    expect(r.problems).toEqual([])
    expect(r.byId('x.task')?.kind).toBe('outcome')
  })

  test('no predict, no observe key or no explain is rejected', () => {
    expect(problemsOf(outcome({ predict: undefined }))).toEqual([expect.stringContaining('has no predict')])
    expect(problemsOf(outcome({ observe: undefined }))).toEqual([expect.stringContaining('has no observe key')])
    expect(problemsOf(outcome({ observe: '' }))).toEqual([expect.stringContaining('has no observe key')])
    expect(problemsOf(outcome({ explain: undefined }))).toEqual([expect.stringContaining('has no explain')])
  })

  test('the explanation needs a model answer and three non-empty ideas', () => {
    expect(problemsOf(outcome({ explain: { prompt: 'Why?', model: '', ideas: ['a', 'b', 'c'] } }))).toHaveLength(1)
    expect(problemsOf(outcome({ explain: { prompt: 'Why?', model: 'm', ideas: ['a', ' ', 'c'] } }))).toHaveLength(1)
  })

  test('a numeric predict needs a tolerance and a unit; a choice predict needs two distinct options', () => {
    expect(problemsOf(outcome({ predict: { kind: 'numeric', prompt: 'p', unit: 'x', tolerance: {} } }))).toHaveLength(1)
    expect(problemsOf(outcome({ predict: { kind: 'numeric', prompt: 'p', unit: ' ', tolerance: { abs: 1 } } }))).toHaveLength(1)
    expect(problemsOf(outcome({ predict: { kind: 'choice', prompt: 'p', options: [{ id: 'a', text: 'A' }] } }))).toHaveLength(1)
    expect(
      problemsOf(outcome({ predict: { kind: 'choice', prompt: 'p', options: [{ id: 'a', text: 'A' }, { id: 'a', text: 'B' }] } })),
    ).toHaveLength(1)
    expect(
      problemsOf(outcome({ predict: { kind: 'choice', prompt: 'p', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] } })),
    ).toEqual([])
  })

  test('ids are unique across the registry; a duplicate is reported and the first one wins', () => {
    const r = buildRegistry({ '/src/components/sims/x.tasks.ts': { T: [outcome(), outcome({ title: 'Other' })] } })
    expect(r.problems).toEqual([expect.stringContaining('duplicate id')])
    expect(r.tasks.map((t) => t.title)).toEqual(['Find the ridge'])
  })

  test('a title over 80 characters is rejected', () => {
    expect(problemsOf(outcome({ title: 'y'.repeat(81) }))).toEqual([expect.stringContaining('title')])
  })
})

describe('contract ids (§10.2 table), as C7–C9 add them', () => {
  const CONTRACT: Record<string, { simId: string; kc: string }> = {
    'roof.ridge': { simId: 'sim-roofline', kc: KC.ridgePoint },
    'roof.decode-bound': { simId: 'sim-roofline', kc: 't4.bound-classification' },
    'roof.batch-to-ridge': { simId: 'sim-roofline', kc: 't4.decode-bandwidth' },
    'roof.tile-ai': { simId: 'sim-roofline', kc: 't4.tiling-intensity' },
    'roof.flash-ai': { simId: 'sim-roofline', kc: 't4.tiling-intensity' },
    'roof.fp8-ridge': { simId: 'sim-roofline', kc: KC.ridgePoint },
    'roof.cpu-serial': { simId: 'sim-roofline', kc: 't4.throughput-design' },
    'roof.gpu-map': { simId: 'sim-roofline', kc: 't4.throughput-design' },
    'roof.gpu-divergence': { simId: 'sim-roofline', kc: 't4.simt-warps' },
    'roof.occupancy': { simId: 'sim-roofline', kc: 't4.occupancy' },
    'roof.coalesce': { simId: 'sim-roofline', kc: 't4.coalescing' },
    'roof.bank': { simId: 'sim-roofline', kc: 't4.coalescing' },
    'roof.tiers': { simId: 'sim-roofline', kc: 't4.gpu-memory-ladder' },
    'roof.pcie': { simId: 'sim-roofline', kc: 't4.gpu-memory-ladder' },
    'roof.fleet-router': { simId: 'sim-roofline', kc: KC.boundClassification },
    'roof.fleet-decode': { simId: 'sim-roofline', kc: KC.boundClassification },
    'roof.fleet-paged-attn': { simId: 'sim-roofline', kc: KC.boundClassification },
    'roof.fleet-prefill': { simId: 'sim-roofline', kc: KC.boundClassification },
    'kv.bytes-per-token': { simId: 'sim-kv', kc: 't5.kv-bytes-per-token' },
    'kv.oom-context': { simId: 'sim-kv', kc: 't5.kv-capacity' },
    'kv.fp8-rescue': { simId: 'sim-kv', kc: 't5.kv-bytes-per-token' },
    'kv.gqa': { simId: 'sim-kv', kc: 't5.gqa-kv-heads' },
    'kv.max-batch': { simId: 'sim-kv', kc: 't5.kv-capacity' },
    'zoo.mla-ratio': { simId: 'sim-kv', kc: 't5.attention-variants' },
    'zoo.swa-flat': { simId: 'sim-kv', kc: 't5.attention-variants' },
    'zoo.dsa-reads': { simId: 'sim-kv', kc: 't5.kv-reads-vs-capacity' },
    'zoo.linear-state': { simId: 'sim-kv', kc: 't5.attention-variants' },
    'zoo.hybrid-share': { simId: 'sim-kv', kc: 't5.attention-variants' },
    'zoo.gdn-prefix': { simId: 'sim-kv', kc: 't5.kv-reads-vs-capacity' },
    'alloc.frag-first-fit': { simId: 'sim-allocator', kc: KC.externalFrag },
    'alloc.coalesce-recover': { simId: 'sim-allocator', kc: 't1.split-coalesce' },
    'alloc.fixed-block-waste': { simId: 'sim-allocator', kc: 't1.fixed-blocks' },
    'alloc.policy-race': { simId: 'sim-allocator', kc: 't1.placement-policy' },
    'alloc.double-free': { simId: 'sim-allocator', kc: KC.allocatorContract },
    'blk.share': { simId: 'sim-kv', kc: KC.blockRefcounts },
    'blk.cow': { simId: 'sim-kv', kc: KC.kvCopyOnWrite },
    'blk.preempt': { simId: 'sim-kv', kc: KC.blockRefcounts },
    'blk.sweep': { simId: 'sim-kv', kc: KC.blockTables },
  }

  test('a contract id that exists is an outcome task on the right sim and KC', () => {
    for (const [id, want] of Object.entries(CONTRACT)) {
      const t = reg.byId(id)
      if (t === undefined) continue // not landed yet
      expect(t.kind).toBe('outcome')
      expect(t.simId).toBe(want.simId)
      expect(t.kcs).toContain(want.kc as never)
    }
  })
})

describe('lessons list registry tasks', () => {
  test('every exercise block taskId resolves on the block’s own sim, with a phone model key that parses', () => {
    for (const lesson of ALL_LESSONS) {
      for (const b of lesson.blocks) {
        if (b.type !== 'exercise' || 'fleet' in b || b.taskIds === undefined) continue
        // ids a PR lists ahead of the one that registers them (PENDING_TASK_IDS, empty since the zoo registered its six) are excused; everything else must exist
        const expected = b.taskIds.filter((id) => !PENDING_TASK_IDS.includes(id))
        const found = resolveTasks(b.simId, b.machine, expected, reg)
        expect(found.map((t) => t.id)).toEqual(expected)
      }
    }
    for (const t of reg.tasks) {
      if (t.phone === undefined) continue
      expect(t.phone.canonical).toMatch(/^[a-z0-9-]+\.[a-z0-9-]+$/i)
    }
  })

  // Tripwire for C7 to C10: an unmigrated sim still calls setSearchParams and reads ?machine= itself, so mounted
  // inline it would rewrite its lesson's URL and ignore the `machine` prop. Migrate it (shell hooks) before a block names it.
  test('an inline exercise block (one with taskIds) never names a sim that still reads the URL itself', () => {
    const host = readFileSync(join(SIMS_DIR, 'SimHost.tsx'), 'utf8')
    const fileOf: Record<string, string> = {}
    for (const m of host.matchAll(/'(sim-[a-z]+)': \(\) => import\('@\/components\/sims\/(\w+)'\)/g)) fileOf[m[1]] = m[2]
    expect(Object.keys(fileOf)).toHaveLength(9)
    const offenders: string[] = []
    for (const lesson of ALL_LESSONS) {
      for (const b of lesson.blocks) {
        if (b.type !== 'exercise' || 'fleet' in b || b.taskIds === undefined || b.taskIds.length === 0) continue
        if (readsUrlItself(readFileSync(join(SIMS_DIR, `${fileOf[b.simId]}.tsx`), 'utf8'))) offenders.push(`${lesson.id}: ${b.simId}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test('the tripwire detector sees a direct router read and ignores the shell hooks', () => {
    expect(readsUrlItself("const [searchParams, setSearchParams] = useSearchParams()")).toBe(true)
    expect(readsUrlItself("import { useSearchParams } from 'react-router'")).toBe(true)
    expect(readsUrlItself("const cfg = useInitialCfg<Cfg>()\nconst { machine } = useSimMachine()\nuseWriteCfg(cfg)")).toBe(false)
  })

  test('resolveTasks keeps the order given, skips unknown ids and another sim’s ids', () => {
    expect(resolveTasks('sim-batching', null, ['t-sched-rr', 'nope', 't-sched-fifo', 't-rust-move'], reg).map((t) => t.id)).toEqual([
      't-sched-rr',
      't-sched-fifo',
    ])
    expect(resolveTasks('sim-allocator', 'rust', undefined, reg).map((t) => t.id)).toContain('t-rust-move')
  })
})

/**
 * `PENDING_TASK_IDS` lets a lesson list task ids ahead of the PR that registers them (wave-2.md §2.3). 2b-13
 * registered the zoo's six, so the list is empty; the mechanism is checked here with a stand-in list.
 */
describe('pending task ids', () => {
  const ZOO = ['zoo.mla-ratio', 'zoo.swa-flat', 'zoo.dsa-reads', 'zoo.linear-state', 'zoo.hybrid-share', 'zoo.gdn-prefix']
  /** A stand-in for the real list, which is empty. */
  const PENDING = ['zoo.mla-ratio', 'zoo.gdn-prefix']
  /** What the lesson test accepts for a block's ids. */
  const unresolved = (b: SimExerciseBlock, r = reg, pending: readonly string[] = PENDING_TASK_IDS) =>
    b.taskIds === undefined ? [] : b.taskIds.filter((id) => !pending.includes(id) && resolveTasks(b.simId, b.machine, [id], r).length === 0)
  /** The staleness rule: a pending id that some registry has registered. */
  const stale = (r = reg, pending: readonly string[] = PENDING_TASK_IDS) => pending.filter((id) => r.byId(id) !== undefined)
  const zoo = (over: Partial<SimExerciseBlock> = {}): SimExerciseBlock => ({
    type: 'exercise',
    simId: 'sim-kv',
    machine: 'zoo',
    title: 'The zoo',
    tasks: [],
    taskIds: ZOO,
    ...over,
  })
  /** A registry with one real sim-kv task, as the production one has. */
  const withKv = buildRegistry({ '/src/components/sims/x.tasks.ts': { T: [outcome({ id: 'kv.gqa', simId: 'sim-kv', title: 'GQA' })] } })

  test("the list is empty: the zoo's six task ids of §11.4 are registered", () => {
    expect(PENDING_TASK_IDS).toEqual([])
    for (const id of ZOO) {
      const t = reg.byId(id)
      expect(t?.simId, id).toBe('sim-kv')
      expect(t?.machine, id).toBe('zoo')
    }
    expect(resolveTasks('sim-kv', 'zoo', ZOO, reg).map((t) => t.id)).toEqual(ZOO)
  })

  test('a block that lists the zoo ids resolves them all, with no pending id to excuse any', () => {
    expect(unresolved(zoo())).toEqual([])
  })

  test('an exercise block may list a pending id, and an unknown id that is not pending still fails', () => {
    expect(unresolved(zoo({ taskIds: ['kv.gqa', 'zoo.mla-ratio'] }), withKv, PENDING)).toEqual([])
    expect(unresolved(zoo({ taskIds: ['kv.gqa', 'zoo.nope'] }), withKv, PENDING)).toEqual(['zoo.nope'])
    expect(unresolved(zoo({ taskIds: ['kv.gqa', 'zoo.mla-ratio'] }), withKv)).toEqual(['zoo.mla-ratio'])
  })

  test('a list goes stale, and so fails, the moment a pending id is registered', () => {
    expect(stale(withKv, PENDING)).toEqual([])
    const registered = buildRegistry({
      '/src/components/sims/kvZoo.tasks.ts': { T: [outcome({ id: 'zoo.mla-ratio', simId: 'sim-kv', machine: 'zoo', title: 'MLA ratio' })] },
    })
    expect(stale(registered, PENDING)).toEqual(['zoo.mla-ratio'])
    // and the real list is not stale, because it is empty
    expect(stale()).toEqual([])
  })

  test('planExercise: all ids pending hides the block', () => {
    expect(planExercise('sim-kv', 'zoo', PENDING, withKv, PENDING)).toEqual({ show: 'hidden' })
    expect(planExercise('sim-kv', 'zoo', ['zoo.gdn-prefix'], withKv, PENDING)).toEqual({ show: 'hidden' })
    // with the real (empty) list nothing is hidden: a block whose ids are not registered falls back to the card
    expect(planExercise('sim-kv', 'zoo', PENDING, withKv)).toEqual({ show: 'card' })
  })

  test('planExercise: pending and unknown ids are dropped, what remains runs inline, in the given order', () => {
    expect(planExercise('sim-kv', undefined, ['zoo.mla-ratio', 'kv.gqa', 'kv.nope'], withKv, PENDING)).toEqual({ show: 'inline', taskIds: ['kv.gqa'] })
    expect(planExercise('sim-kv', undefined, ['kv.gqa', 'kv.nope'], withKv)).toEqual({ show: 'inline', taskIds: ['kv.gqa'] })
  })

  test('planExercise: the zoo block runs inline now that its ids are registered', () => {
    expect(planExercise('sim-kv', 'zoo', ZOO, reg)).toEqual({ show: 'inline', taskIds: ZOO })
  })

  test("planExercise: no id left, or another sim's id, falls back to the link card", () => {
    expect(planExercise('sim-kv', undefined, ['kv.nope'], withKv)).toEqual({ show: 'card' })
    expect(planExercise('sim-kv', undefined, ['zoo.mla-ratio', 'kv.nope'], withKv)).toEqual({ show: 'card' })
    expect(planExercise('sim-roofline', undefined, ['kv.gqa'], withKv)).toEqual({ show: 'card' })
    expect(planExercise('sim-kv', undefined, [], withKv)).toEqual({ show: 'card' })
    expect(planExercise('sim-kv', undefined, undefined, withKv)).toEqual({ show: 'card' })
  })

  const html = (block: SimExerciseBlock, r = withKv) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ExerciseView, { block, trackColor: '#fff', lessonId: 't5.l4', tasks: r })))

  test('ExerciseView mounts the zoo block inline now that its ids are registered', () => {
    const out = html(zoo(), reg)
    expect(out).toContain('data-inline=')
    expect(out).toContain('data-exercise="sim-kv"')
  })

  test('ExerciseView drops unknown ids and mounts the sim inline with the rest', () => {
    const out = html(zoo({ machine: undefined, taskIds: ['kv.nope', 'kv.gqa', 'kv.nope2'] }))
    expect(out).toContain('data-inline=')
    expect(out).toContain('data-exercise="sim-kv"')
  })

  test('ExerciseView falls back to the link card when no id remains', () => {
    const out = html(zoo({ machine: undefined, tasks: ['Open the sim'], taskIds: ['zoo.mla-ratio', 'kv.nope'] }))
    expect(out).not.toContain('data-inline')
    expect(out).toContain('Guided tasks')
    expect(out).toContain('Open the sim')
    expect(html(zoo({ machine: undefined, tasks: ['Open the sim'], taskIds: undefined }))).toContain('Guided tasks')
  })
})
