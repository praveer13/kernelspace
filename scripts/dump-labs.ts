/**
 * dump-labs — the 18 forge labs as JSON for the zip packer and the guardrail gate (docs/specs/wave-1.md §13.4).
 * pack-labs.py reads each lab's real check ids from here, so AGENTS.md can never drift from labs.ts.
 *
 *   bun scripts/dump-labs.ts
 */
import { RUST_ZERO_LABS, SYSTEMS_FORGE_LABS, type ForgeLab } from '../src/data/labs'

export interface LabDump {
  id: string
  title: string
  /** basename of the zip in public/labs, e.g. rust-allocator.zip */
  zip: string
  /** the TODO(you) file, relative to the unzipped workspace root */
  todoFile: string
  /** the lab's crate directory, relative to the workspace root */
  crateDir: string
  /** wasm file name the student drops */
  artifactName: string
  required: { id: string; label: string }[]
  optional: { id: string; label: string }[]
}

function dumpLab(lab: ForgeLab): LabDump {
  const crateDir = lab.crateDir ?? lab.id
  const pick = (c: { id: string; label: string }) => ({ id: c.id, label: c.label })
  return {
    id: lab.id,
    title: lab.title,
    zip: lab.zip.replace(/^\/labs\//, ''),
    todoFile: `${crateDir}/${lab.editFile}`,
    crateDir,
    artifactName: lab.artifact.replace(/^.*\//, ''),
    required: lab.checks.filter((c) => !c.optional).map(pick),
    optional: lab.checks.filter((c) => c.optional).map(pick),
  }
}

export function dumpLabs(): LabDump[] {
  return [...RUST_ZERO_LABS, ...SYSTEMS_FORGE_LABS].map(dumpLab)
}

if (import.meta.main) {
  process.stdout.write(`${JSON.stringify(dumpLabs(), null, 2)}\n`)
}
