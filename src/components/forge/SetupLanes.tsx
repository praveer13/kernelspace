/**
 * "1 · get the lab" (docs/specs/wave-2.md §13.1, §16.1): how a learner gets the crate onto their machine. Today it is
 * ForgeLab's own setup copy, moved here unchanged: three lanes (your machine, a dev container, a Codespace) and the
 * one-command workspace. Task 2c-07 fills this component with the archives, the PowerShell one-liner and the
 * per-lab Codespaces links; its props are final, so that task never edits the page.
 */

import { useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import type { ForgeLab } from '@/data/labs'

export interface SetupLanesProps {
  lab: ForgeLab
}

const LANES = [
  {
    id: 'a',
    title: 'lane A — your machine',
    body: 'Two commands if you have Rust; one installer if you don’t.',
    code: 'rustup target add wasm32-unknown-unknown',
  },
  {
    id: 'b',
    title: 'lane B — dev container',
    body: 'Open the unzipped folder in VS Code → "Reopen in Container". Toolchain and wasm target preinstalled.',
  },
  {
    id: 'c',
    title: 'lane C — codespaces',
    body: 'Open the kernelspace repo in a Codespace. Same environment, burns your free GitHub quota.',
  },
]

const sectionLabel = 'font-mono text-[11px] uppercase tracking-[0.14em] text-text-3'

export function SetupLanes({ lab }: SetupLanesProps) {
  const [setupCopied, setSetupCopied] = useState(false)
  const archiveName = lab.zip.split('/').pop() ?? `${lab.id}.zip`
  const downloadUrl = new URL(lab.zip, window.location.origin).href
  const workspaceDir = lab.id
  const setupCommand =
    `test ! -e ${workspaceDir} && ` +
    `curl -fsSL ${downloadUrl} -o ${archiveName} && ` +
    `mkdir ${workspaceDir} && ` +
    `unzip -q ${archiveName} -d ${workspaceDir} && ` +
    `cd ${workspaceDir}/${lab.crateDir ?? lab.id}`

  return (
    <section className="mt-12" aria-labelledby="get-lab">
      <h2 id="get-lab" className={sectionLabel}>
        1 · get the lab
      </h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {LANES.map((lane) => (
          <div key={lane.id} className="min-w-0 rounded-lg border border-line bg-surface-1 p-5">
            <p className="font-mono text-sm text-text-1">{lane.title}</p>
            <p className="mt-2 text-body-sm text-text-2">{lane.body}</p>
            {lane.code && (
              <pre tabIndex={0} className="mt-3 overflow-x-auto rounded border border-line bg-ink p-3 font-mono text-[12px] text-text-1">
                {lane.code}
              </pre>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface-1">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-1">
              one-command workspace
            </p>
            <p className="mt-0.5 text-body-sm text-text-3">
              macOS, Linux, or WSL · requires curl and unzip
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(setupCommand).catch(() => undefined)
              setSetupCopied(true)
              window.setTimeout(() => setSetupCopied(false), 1200)
            }}
            className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-text-3 transition-colors hover:text-text-1 [@media(pointer:coarse)]:min-h-11"
            aria-label="Copy workspace setup command"
          >
            {setupCopied ? (
              <Check className="h-3.5 w-3.5 text-accent" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {setupCopied ? 'copied' : 'copy'}
          </button>
        </div>
        <pre tabIndex={0} className="overflow-x-auto bg-ink p-4 font-mono text-[12px] leading-relaxed text-text-1">
          {setupCommand}
        </pre>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="text-body-sm text-text-3">
            Creates a fresh folder and enters the exercise crate. It stops if that folder already exists.
          </p>
          <a
            href={lab.zip}
            download
            className="inline-flex shrink-0 items-center gap-2 font-mono text-[11px] text-accent underline [@media(pointer:coarse)]:min-h-11"
          >
            <Download className="h-3.5 w-3.5" /> download ZIP instead
          </a>
        </div>
      </div>
    </section>
  )
}

export default SetupLanes
