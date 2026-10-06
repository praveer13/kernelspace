/**
 * The forge ABI on the host side: what each template version can do, the `ks_run` input lines and
 * the shape checks on the replies (docs/specs/wave-1.md §12.1, §12.3).
 *
 * Pure: no wasm, no workers. src/lib/forge/run.ts drives modules with it; tests drive it with
 * plain objects.
 */

import type { AbiCompat, AbiVersion, CheckMeta, ListReply } from './types'

/** The newest ABI this page speaks. A module reporting more was built from a newer template. */
export const HOST_ABI: AbiVersion = 2

/** A `--features reference` build appends this to its lab id. Such a run is shown and never credited. */
export const REFERENCE_SUFFIX = '@reference'

export const NEWER_TEMPLATE_NOTE = 'built with a newer template than this page: reload'

/** The compatibility table (§12.3). ABI > 2 has no row: `compatFor` refuses it. */
export const ABI_COMPAT: Readonly<Record<AbiVersion, AbiCompat>> = {
  1: {
    abi: 1,
    perCheck: false,
    seeds: false,
    trace: false,
    probe: false,
    maxProvenance: 'lab-green',
    note: 'built from the v1 template: rebuild for per-check results',
  },
  2: {
    abi: 2,
    perCheck: true,
    seeds: true,
    trace: true,
    probe: true,
    maxProvenance: 'unseen',
    note: '',
  },
}

/** The row for a module's `ks_abi_version()` (absent = 1), or null when the module is newer than the page. */
export function compatFor(abi: number): AbiCompat | null {
  if (abi === 1 || abi === 2) return ABI_COMPAT[abi]
  return null
}

/** `rust-allocator@reference` → `{lab: 'rust-allocator', reference: true}`. */
export function splitLabId(id: string): { lab: string; reference: boolean } {
  return id.endsWith(REFERENCE_SUFFIX)
    ? { lab: id.slice(0, -REFERENCE_SUFFIX.length), reference: true }
    : { lab: id, reference: false }
}

/* ------------------------------ ks_run input ------------------------------ */

/** Ask for the checks' metadata. Runs no student code. */
export const LIST_INPUT = 'v 2\nlist\n'

/** Run one check; `seed` only for a seeded check on a fresh seed (otherwise the crate's default seed). */
export function onlyInput(id: string, seed?: number): string {
  return `v 2\nonly ${id}\n${seed === undefined ? '' : `seed ${seed >>> 0}\n`}`
}

/* --------------------------------- replies --------------------------------- */

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const isU32 = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 0xffff_ffff

/** A `list` reply, or the reason it is not one. */
export function parseListReply(x: unknown): ListReply | string {
  if (!isObj(x)) return 'the list reply is not a JSON object'
  if (typeof x.lab !== 'string' || x.lab === '') return 'the list reply has no lab id'
  if (typeof x.version !== 'number') return 'the list reply has no version'
  if (x.abi !== 2) return `the list reply says abi ${String(x.abi)}, not 2`
  if (!Array.isArray(x.checks) || x.checks.length === 0) return 'the list reply has no checks'
  const checks: CheckMeta[] = []
  const seen = new Set<string>()
  for (const c of x.checks as unknown[]) {
    if (!isObj(c) || typeof c.id !== 'string' || c.id === '' || /\s/.test(c.id)) return 'a listed check has no usable id'
    if (seen.has(c.id)) return `check "${c.id}" is listed twice`
    if (typeof c.label !== 'string') return `check "${c.id}" has no label`
    if (typeof c.stage !== 'number' || !Number.isInteger(c.stage) || c.stage < 0) return `check "${c.id}" has no stage`
    if (typeof c.seeded !== 'boolean') return `check "${c.id}" does not say whether it is seeded`
    seen.add(c.id)
    checks.push({ id: c.id, label: c.label, stage: c.stage, seeded: c.seeded })
  }
  return { lab: x.lab, version: x.version, abi: 2, checks }
}

/** One check's verdict from an `only <id>` reply. */
export interface OnlyVerdict {
  pass: boolean
  msg: string
  seed?: number
}

/** The verdict for `id` in an `only` reply, or the reason the reply is unusable. */
export function parseOnlyReply(x: unknown, id: string, lab: string): OnlyVerdict | string {
  if (!isObj(x)) return 'the check reply is not a JSON object'
  if (x.lab !== lab) return `the check reply names lab "${String(x.lab)}", but the list said "${lab}"`
  if (x.abi !== 2) return `the check reply says abi ${String(x.abi)}, not 2`
  if (!Array.isArray(x.checks)) return 'the check reply has no checks'
  const hits = (x.checks as unknown[]).filter((c) => isObj(c) && c.id === id)
  if (hits.length !== 1 || x.checks.length !== 1) return `the reply to "only ${id}" did not report exactly that check`
  const c = hits[0] as Record<string, unknown>
  if (typeof c.pass !== 'boolean' || typeof c.msg !== 'string') return `check "${id}" has no pass/msg`
  if (c.seed !== undefined && !isU32(c.seed)) return `check "${id}" reports an invalid seed`
  return c.seed === undefined ? { pass: c.pass, msg: c.msg } : { pass: c.pass, msg: c.msg, seed: c.seed }
}

/**
 * The message under a trapped check: "not implemented yet" plus the `todo!()` text for an unfinished
 * function, the panic text otherwise. `panicked at src/allocator.rs:47:9: not yet implemented: construct
 * your allocator` → `not implemented yet: construct your allocator (src/allocator.rs:47:9)`.
 */
export function trapMessage(panic: string | undefined): string {
  const text = panic?.trim()
  if (!text) return 'trapped without a panic message: the module aborted (an out-of-bounds access, or a panic with no text)'
  const m = /^panicked at (\S+?:\d+:\d+):\s*([\s\S]*)$/.exec(text)
  const [where, what] = m ? [m[1], m[2]] : ['', text]
  const todo = /^not yet implemented(?::\s*([\s\S]*))?$/.exec(what)
  if (todo) return `not implemented yet${todo[1] ? `: ${todo[1]}` : ''}${where ? ` (${where})` : ''}`
  return where ? `panicked at ${where}: ${what}` : `panicked: ${what}`
}

/** Same ids in the same order: a respawned worker must see the module it saw before. */
export function sameChecks(a: ListReply, b: ListReply): boolean {
  return a.lab === b.lab && a.checks.length === b.checks.length && a.checks.every((c, i) => c.id === b.checks[i].id)
}
