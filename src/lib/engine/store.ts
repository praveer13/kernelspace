/**
 * Who may be installed in your engine (docs/specs/wave-2.md §10.2). Pure: a run report in, a verdict out.
 *
 * A module goes into a slot only after a run on fresh seeds in which every required check of its lab
 * passed, and only if it is a learner build, from a template v2 crate, at or above the catalog's minimum
 * lab version. `installModule` is the one writer: it checks, then hands the bytes to the ledger's
 * `installComponent` (content-addressed bytes in the `components` store plus the working record `engine:slots`).
 */

import { FORGE_LABS } from '@/data/labs'
import { creditFor } from '@/lib/forge/run'
import type { LabRunReport } from '@/lib/forge/types'
import type { ComponentInstall, EngineSlot } from '@/lib/ledger/types'
import { ENGINE_SLOTS } from './catalog'

/** The four refusals of §10.2, plus the one for a module dropped into another lab's slot. */
export type RefusalCode = 'reference' | 'wrong-lab' | 'abi-1' | 'stale-version' | 'not-fresh-green'

/** The §10.2 messages, word for word. */
export const REFUSALS: Readonly<Record<Exclude<RefusalCode, 'wrong-lab'>, string>> = {
  'abi-1': 'built from the v1 template: rebuild from the new zip',
  'stale-version': 'this module predates the router verbs: download the zip again and rebuild',
  reference: 'reference modules earn no credit and cannot be installed',
  'not-fresh-green': 'pass every check on fresh seeds first',
}

export type InstallVerdict = { ok: true } | { ok: false; code: RefusalCode; message: string; detail?: string }

/** The ids of the checks that gate a lab (`optional` checks are advanced extensions and never gate). */
export function requiredChecksOf(labId: string): string[] {
  return (FORGE_LABS.find((l) => l.id === labId)?.checks ?? []).filter((c) => !c.optional).map((c) => c.id)
}

const refuse = (code: Exclude<RefusalCode, 'wrong-lab'>, detail?: string): InstallVerdict => ({ ok: false, code, message: REFUSALS[code], ...(detail ? { detail } : {}) })

/**
 * Whether the run that `report` describes entitles its module to `slot`. Refusals come in this order:
 * a reference build, another lab's module, ABI 1, a lab version below the catalog minimum, then a run that
 * did not pass every required check on fresh seeds. The last uses `creditFor` with no history: an earlier
 * run's unseen passes do not count, so the module in hand is the one that passed.
 * `required` defaults to the lab's non-optional checks.
 */
export function checkInstall(slot: EngineSlot, report: LabRunReport, required: readonly string[] = requiredChecksOf(ENGINE_SLOTS[slot].lab)): InstallVerdict {
  const spec = ENGINE_SLOTS[slot]
  if (report.reference) return refuse('reference')
  if (report.lab !== spec.lab) {
    return { ok: false, code: 'wrong-lab', message: `the ${spec.label} slot wants a ${spec.lab} module, not ${report.lab}` }
  }
  if (report.abi === 1) return refuse('abi-1')
  if (report.version < spec.minVersion) return refuse('stale-version', `${spec.lab} must be at lab version ${spec.minVersion} or later; this module is version ${report.version}`)
  if (creditFor(report, {}, required) !== 'unseen') return refuse('not-fresh-green')
  return { ok: true }
}

/** What `installModule` needs from the ledger façade (`useProgress.getState()` satisfies it). */
export interface ComponentLedger {
  installComponent(c: ComponentInstall): Promise<{ sha256: string }>
}

export interface ModuleToInstall {
  slot: EngineSlot
  /** The run that earned the install: `lab` and `version` come from it. */
  report: LabRunReport
  bytes: ArrayBuffer | Uint8Array
  /** The file the learner dropped. */
  name?: string
  required?: readonly string[]
}

export type InstallOutcome = (InstallVerdict & { ok: false }) | { ok: true; sha256: string }

/** Checks, then stores. A refusal writes nothing. */
export async function installModule(ledger: ComponentLedger, m: ModuleToInstall): Promise<InstallOutcome> {
  const verdict = checkInstall(m.slot, m.report, m.required)
  if (!verdict.ok) return verdict
  const { sha256 } = await ledger.installComponent({
    slot: m.slot,
    labId: m.report.lab,
    version: m.report.version,
    abi: m.report.abi,
    bytes: m.bytes,
    ...(m.name === undefined ? {} : { name: m.name }),
  })
  return { ok: true, sha256 }
}
