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
import { buildRegistry, registry, resolveTasks } from '../../src/lib/sims/registry'
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
    for (const id of ['t-sched-fifo', 't-rust-move', 't-ctx-cliff', 't-lock-aba', 't-layout-aos', 't-eng-gqa', 't-blk-cow', 't-frame-trace']) {
      expect(ids).toContain(id)
    }
    // outcome tasks arrive per sim (C7–C9) under dotted ids: `roof.*`, `kv.*`, `alloc.*`; every other task is legacy
    for (const t of reg.tasks) expect(t.kind === 'outcome').toBe(/^(roof|kv|alloc)\./.test(t.id))
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
    'kv.bytes-per-token': { simId: 'sim-kv', kc: 't5.kv-bytes-per-token' },
    'kv.oom-context': { simId: 'sim-kv', kc: 't5.kv-capacity' },
    'kv.fp8-rescue': { simId: 'sim-kv', kc: 't5.kv-bytes-per-token' },
    'kv.gqa': { simId: 'sim-kv', kc: 't5.gqa-kv-heads' },
    'kv.max-batch': { simId: 'sim-kv', kc: 't5.kv-capacity' },
    'alloc.frag-first-fit': { simId: 'sim-allocator', kc: KC.externalFrag },
    'alloc.coalesce-recover': { simId: 'sim-allocator', kc: 't1.split-coalesce' },
    'alloc.fixed-block-waste': { simId: 'sim-allocator', kc: 't1.fixed-blocks' },
    'alloc.policy-race': { simId: 'sim-allocator', kc: 't1.placement-policy' },
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
        if (b.type !== 'exercise' || b.taskIds === undefined) continue
        const found = resolveTasks(b.simId, b.machine, b.taskIds, reg)
        expect(found.map((t) => t.id)).toEqual(b.taskIds)
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
        if (b.type !== 'exercise' || b.taskIds === undefined || b.taskIds.length === 0) continue
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
