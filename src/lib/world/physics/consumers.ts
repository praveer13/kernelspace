/**
 * The consumer contract for eligibility (docs/specs/s5.md §5.2, §5.7; S5-D19, S5-D54).
 *
 * Anything learner-facing that reads the fitted table is a consumer: a v2 Fleet exercise def (S5-12, S5-13) or a
 * calibrated `step` variant (S5-14). Each names the rows it uses and the metric it reads (`tpot` or `ttft`).
 * `verify:physics` collects every consumer and checks it against the table: a row that is not calibrated, or a metric the
 * row is not eligible for, fails the build, so a failed row can never reach a learner by a later task forgetting to look.
 *
 * Two sources, so no later task edits `scripts/verify-physics.ts`:
 *  - every `FLEET_EXERCISES` entry that has a `phys` key (duck-typed, §6.5: `{ id, phys, rows, metric }`);
 *  - every items family module's optional `PHYSICS_CONSUMERS` export, an array of `PhysicsConsumer`.
 *
 * `checkEligibility` is pure. `collectConsumers` loads the registries, so only scripts and tests call it: nothing on
 * the main thread imports this module.
 */

import type { CalibratedRow } from './types'

export type PhysicsMetric = 'tpot' | 'ttft'

export interface PhysicsConsumer {
  /** what the sentence in a failure names: `fleet-ex/frontier`, `step/decode-ms` */
  id: string
  /** row keys (`h100-vllm-0-10-2-fp8`) */
  rows: readonly string[]
  metric: PhysicsMetric
  /**
   * The `PHYS_ID` the consumer was banded or authored on, when it records one (a v2 exercise def does, §6.5). A refit gives
   * a new id; a consumer on an older one is stale and must be re-banded, never silently re-graded.
   */
  phys?: string
}

/**
 * Everything wrong with `consumers` against the table's rows, as sentences (empty: all eligible). A consumer must name at
 * least one row, every row must exist and be `calibrated`, and the row must be eligible for the consumer's metric. With
 * `physId`, a consumer that records another `phys` is stale.
 */
export function checkEligibility(consumers: readonly PhysicsConsumer[], rows: readonly CalibratedRow[], physId?: string): string[] {
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const out: string[] = []
  for (const c of consumers) {
    if (c.metric !== 'tpot' && c.metric !== 'ttft') {
      out.push(`${c.id}: metric ${JSON.stringify(c.metric)} is neither tpot nor ttft`)
      continue
    }
    if (c.rows.length === 0) out.push(`${c.id}: names no row`)
    if (physId !== undefined && c.phys !== undefined && c.phys !== physId) out.push(`${c.id}: was banded on ${c.phys}, the table is ${physId}`)
    for (const key of c.rows) {
      const row = byKey.get(key)
      if (!row) out.push(`${c.id}: names row ${key}, which is not in the table`)
      else if (row.status !== 'calibrated') out.push(`${c.id}: names row ${key}, which is ${row.status}`)
      else if (!row.eligible[c.metric]) out.push(`${c.id}: reads ${c.metric} on row ${key}, which is not eligible for ${c.metric}`)
    }
  }
  return out
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The consumers a `FLEET_EXERCISES`-shaped table holds: an entry with a `phys` key is a v2 def and must say its rows and metric (§6.5). */
export function exerciseConsumers(exercises: Readonly<Record<string, unknown>>): PhysicsConsumer[] {
  const out: PhysicsConsumer[] = []
  for (const key of Object.keys(exercises).sort()) {
    const def = exercises[key]
    if (!isRecord(def) || !('phys' in def)) continue
    const id = `fleet-ex/${typeof def.id === 'string' ? def.id : key}`
    const rows = Array.isArray(def.rows) && def.rows.every((r) => typeof r === 'string') ? (def.rows as string[]) : []
    // a def with a malformed metric still becomes a consumer, so `checkEligibility` names the fault
    out.push({ id, rows, metric: def.metric as PhysicsMetric, phys: typeof def.phys === 'string' ? def.phys : undefined })
  }
  return out
}

/** The consumers a family module exports as `PHYSICS_CONSUMERS` (none when it has no such export). */
export function familyConsumers(familyId: string, mod: unknown): PhysicsConsumer[] {
  if (!isRecord(mod) || !('PHYSICS_CONSUMERS' in mod)) return []
  const list = mod.PHYSICS_CONSUMERS
  if (!Array.isArray(list)) throw new Error(`items family ${familyId}: PHYSICS_CONSUMERS is not an array`)
  return list.map((c, i) => {
    if (!isRecord(c) || typeof c.id !== 'string') throw new Error(`items family ${familyId}: PHYSICS_CONSUMERS[${i}] has no id`)
    return { id: c.id, rows: Array.isArray(c.rows) ? (c.rows as string[]) : [], metric: c.metric as PhysicsMetric, phys: typeof c.phys === 'string' ? c.phys : undefined }
  })
}

/**
 * Every consumer in the repository: the v2 exercise defs of `FLEET_EXERCISES` and each items family's
 * `PHYSICS_CONSUMERS`. The registries are imported here, on demand, so importing this module costs nothing.
 */
export async function collectConsumers(): Promise<PhysicsConsumer[]> {
  const { FLEET_EXERCISES } = await import('../fleet-ex')
  const { familyIds } = await import('../../items/registry')
  const out = exerciseConsumers(FLEET_EXERCISES)
  for (const id of await familyIds()) {
    const mod: unknown = await import(/* @vite-ignore */ new URL(`../../items/families/${id}.ts`, import.meta.url).href)
    out.push(...familyConsumers(id, mod))
  }
  return out
}
