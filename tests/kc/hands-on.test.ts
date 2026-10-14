/**
 * The hands-on gate (docs/specs/wave-2.md §5.4, §23.1 B4; task 2a-32). A lesson is hands-on when it holds at least one
 * graded active block other than its checkpoint: an `item` block whose family and variants exist, an `exercise` block
 * with at least one registered outcome task, a `fleet` exercise block whose exercise is in `FLEET_EXERCISES`
 * (wave-3.md §4.2, 3a-05b), or a `play` block whose play is registered (a pending play does not
 * count). At least 10 of the 15 T6 and T7 lessons must be; the test prints the list. Each item block's variant KCs
 * must intersect its lesson's `Lesson.kcs`.
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { ItemBlock, Lesson } from '../../src/data/lessons/types'
import { resolvePlay } from '../../src/components/play/registry'
import { FLEET_EXERCISES, type FleetExerciseDef } from '../../src/lib/world/fleet-ex'
import { loadFamily } from '../../src/lib/items/registry'
import type { Gen } from '../../src/lib/items/types'
import { buildRegistry, type Registry } from '../../src/lib/sims/registry'

/** The gate: at least this many of the T6/T7 lessons are hands-on. */
const HANDS_ON_MIN = 10

const SIMS_DIR = join(import.meta.dir, '..', '..', 'src', 'components', 'sims')

/** `import.meta.glob` is Vite's, so the test loads the same `*.tasks.ts` files with Bun.Glob (as tests/sims/registry.test.ts does). */
async function loadRegistry(): Promise<Registry> {
  const modules: Record<string, Record<string, unknown>> = {}
  for (const f of new Bun.Glob('*.tasks.ts').scanSync(SIMS_DIR)) {
    modules[`/src/components/sims/${f}`] = (await import(join(SIMS_DIR, f))) as Record<string, unknown>
  }
  return buildRegistry(modules)
}

const registry = await loadRegistry()
const families = new Map<string, Gen>()
for (const l of ALL_LESSONS) {
  for (const b of l.blocks) {
    if (b.type === 'item' && !families.has(b.family)) families.set(b.family, await loadFamily(b.family))
  }
}

/** The part of §5.4's definition an item block meets: its family loads and every variant exists. */
const itemBlockValid = (b: ItemBlock): boolean => {
  const gen = families.get(b.family)
  return gen !== undefined && b.variants.length > 0 && b.variants.every((v) => gen.variants.some((x) => x.id === v))
}

/** Why a lesson is hands-on, one entry per qualifying block; empty when it is not. */
function handsOnBlocks(l: Lesson, fleet: Readonly<Record<string, unknown>> = FLEET_EXERCISES): string[] {
  const out: string[] = []
  for (const b of l.blocks) {
    if (b.type === 'item' && itemBlockValid(b)) out.push(`item ${b.family}/${b.variants.join('+')}`)
    else if (b.type === 'exercise' && 'fleet' in b) {
      if (Object.hasOwn(fleet, b.fleet)) out.push(`fleet ${b.fleet}`)
    } else if (b.type === 'exercise' && 'simId' in b) {
      const ids = (b.taskIds ?? []).filter((id) => registry.byId(id)?.kind === 'outcome' && registry.byId(id)?.simId === b.simId)
      if (ids.length > 0) out.push(`exercise ${ids.join('+')}`)
    } else if (b.type === 'play' && resolvePlay(b.playId).kind === 'play') out.push(`play ${b.playId}`)
  }
  return out
}

const T67 = ALL_LESSONS.filter((l) => l.trackId === 't6' || l.trackId === 't7')

describe('hands-on T6/T7 lessons (spec §5.4)', () => {
  test('there are 15 T6/T7 lessons', () => {
    expect(T67).toHaveLength(15)
  })

  test(`at least ${HANDS_ON_MIN} of them are hands-on, and the list is printed`, () => {
    const rows = T67.map((l) => ({ id: l.id, title: l.title, how: handsOnBlocks(l) }))
    const yes = rows.filter((r) => r.how.length > 0)
    const no = rows.filter((r) => r.how.length === 0)
    console.log(
      [
        `hands-on T6/T7 lessons: ${yes.length} of ${rows.length} (gate: at least ${HANDS_ON_MIN})`,
        ...yes.map((r) => `  yes ${r.id} ${r.title}: ${r.how.join('; ')}`),
        ...no.map((r) => `  no  ${r.id} ${r.title}`),
      ].join('\n'),
    )
    expect(yes.length).toBeGreaterThanOrEqual(HANDS_ON_MIN)
  })

  test('a pending play and an unregistered task do not count', () => {
    const fake: Lesson = {
      ...(T67[0] as Lesson),
      blocks: [
        { type: 'play', playId: 'no-such-play', title: 'x' },
        { type: 'exercise', simId: 'sim-roofline' as never, title: 'x', tasks: [], taskIds: ['zoo.mla-ratio', 'no.such-task'] },
        { type: 'item', title: 'x', family: 'cost', variants: ['no-such-variant'] },
      ],
    }
    expect(handsOnBlocks(fake)).toEqual([])
  })

  test('a fleet block counts when its exercise is in FLEET_EXERCISES, and not when it is not', () => {
    const lesson = (blocks: Lesson['blocks']): Lesson => ({ ...(T67[0] as Lesson), blocks })
    const block = (fleet: string): Lesson['blocks'][number] => ({ type: 'exercise', fleet, title: 'Find the knee' })
    const listed = { knee: {} as FleetExerciseDef }
    expect(handsOnBlocks(lesson([block('knee')]), listed)).toEqual(['fleet knee'])
    expect(handsOnBlocks(lesson([block('no-such-exercise')]), listed)).toEqual([])
    // an inherited key is not a registered exercise
    expect(handsOnBlocks(lesson([block('toString'), block('constructor')]), listed)).toEqual([])
    // the real table, which 3b-03 fills, is the default
    expect(handsOnBlocks(lesson([block('knee')]))).toEqual(Object.hasOwn(FLEET_EXERCISES, 'knee') ? ['fleet knee'] : [])
  })
})

describe('item blocks (spec §5.4)', () => {
  const withBlocks = ALL_LESSONS.flatMap((l) => l.blocks.flatMap((b, i) => (b.type === 'item' ? [{ l, b, i }] : [])))

  test('the tree has the planned item blocks to check', () => {
    expect(withBlocks.length).toBeGreaterThanOrEqual(12)
  })

  for (const { l, b, i } of withBlocks) {
    test(`${l.id} block #${i} (${b.family}/${b.variants.join('+')}): family and variants exist, a variant KC is a lesson KC, and it precedes the checkpoint`, () => {
      expect(itemBlockValid(b)).toBe(true)
      const gen = families.get(b.family) as Gen
      const covered = new Set(b.variants.flatMap((v) => gen.variants.find((x) => x.id === v)?.kcs ?? []))
      expect((l.kcs ?? []).some((kc) => covered.has(kc))).toBe(true)
      const quizAt = l.blocks.findIndex((x) => x.type === 'quiz')
      if (quizAt >= 0) expect(i).toBeLessThan(quizAt)
    })
  }
})
