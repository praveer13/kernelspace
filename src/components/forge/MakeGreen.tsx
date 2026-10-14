/**
 * ForgeLab's "2 · make it green" box: the loop in the crate and where the built module lands. The artifact path is the
 * workspace root's `target/` (docs/specs/wave-2.md §16.1), the same two spellings SetupLanes shows: from the folder the
 * archive unpacked to, and from inside the crate, where the learner is after `cd <crate>`. The bare `lab.artifact` is
 * relative to the workspace, so printed right after `cd <crate>` it named a folder that does not exist there.
 */

import { Terminal } from 'lucide-react'
import type { ForgeLab } from '@/data/labs'
import { artifactPaths, crateOf } from '@/lib/forge/setup'

const sectionLabel = 'font-mono text-[11px] uppercase tracking-[0.14em] text-text-3'

export function MakeGreen({ lab }: { lab: ForgeLab }) {
  const required = lab.checks.filter((check) => !check.optional).length
  const optional = lab.checks.length - required
  const artifact = artifactPaths(lab)
  return (
    <section className="mt-12" aria-labelledby="make-green">
      <h2 id="make-green" className={sectionLabel}>
        2 · make it green
      </h2>
      <div className="mt-4 rounded-lg border border-line bg-surface-1 p-5">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
          <Terminal className="h-3.5 w-3.5" /> in the crate
        </div>
        <pre tabIndex={0} className="mt-3 overflow-x-auto rounded border border-line bg-ink p-4 font-mono text-[12px] leading-relaxed text-text-1">
{`cd ${crateOf(lab)}
$EDITOR ${lab.editFile}${' '.repeat(Math.max(1, 20 - lab.editFile.length))}# the only file with TODO(you)
cargo test                    # ${required} required${optional > 0 ? ` + ${optional} advanced` : ''}
cargo build --release --target wasm32-unknown-unknown`}
        </pre>
        <p className="mt-3 min-w-0 text-body-sm text-text-2">
          the artifact to drop below:{' '}
          <span className="break-all font-mono text-[12px] text-text-1">{artifact.fromWorkspace}</span>
          {' '}(cargo writes to the workspace root’s <span className="font-mono text-[12px]">target/</span>, which is{' '}
          <span className="break-all font-mono text-[12px]">{artifact.fromCrate}</span> from inside the crate)
        </p>
      </div>
    </section>
  )
}

export default MakeGreen
