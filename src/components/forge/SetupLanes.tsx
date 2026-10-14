/**
 * "1 · get the lab" (docs/specs/wave-2.md §13.1, §16.1-16.2): how a learner gets the crate onto their machine. Three
 * lanes (your machine, a dev container, a Codespace) and the one-command workspace in four tabs: POSIX, tar, PowerShell
 * and WSL. The commands live in src/lib/forge/setup.ts; the Codespaces billing note's free core-hours come from the
 * claims registry. Props are final since 2c-02, so this component never needs ForgeLab edited.
 */

import { useState, type KeyboardEvent } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { ClaimValue } from '@/components/ClaimValue'
import type { ForgeLab } from '@/data/labs'
import {
  CODESPACES_FREE_HOURS_CLAIM,
  MSVC_BUILD_TOOLS_URL,
  artifactPaths,
  codespacesUrl,
  crateOf,
  setupTabs,
  tarballPath,
} from '@/lib/forge/setup'
import { cn } from '@/lib/utils'

export interface SetupLanesProps {
  lab: ForgeLab
}

const sectionLabel = 'font-mono text-[11px] uppercase tracking-[0.14em] text-text-3'
const codeBox = 'overflow-x-auto rounded border border-line bg-ink p-3 font-mono text-[12px] text-text-1'
const linkClass = 'text-accent underline underline-offset-2'

export function SetupLanes({ lab }: SetupLanesProps) {
  const [setupCopied, setSetupCopied] = useState(false)
  const origin = window.location.origin
  const tabs = setupTabs(lab, origin)
  const [activeId, setActiveId] = useState(tabs[0].id)
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]
  const artifact = artifactPaths(lab)
  const crate = crateOf(lab)

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1
    const next =
      event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : -1
    if (next < 0) return
    event.preventDefault()
    setActiveId(tabs[next].id)
    document.getElementById(`setup-tab-${tabs[next].id}`)?.focus()
  }

  return (
    <section className="mt-12" aria-labelledby="get-lab">
      <h2 id="get-lab" className={sectionLabel}>
        1 · get the lab
      </h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="min-w-0 rounded-lg border border-line bg-surface-1 p-5">
          <p className="font-mono text-sm text-text-1">lane A — your machine</p>
          <p className="mt-2 text-body-sm text-text-2">Two commands if you have Rust; one installer if you don’t.</p>
          <pre tabIndex={0} className={cn('mt-3', codeBox)}>
            rustup target add wasm32-unknown-unknown
          </pre>
          <p className="mt-3 text-body-sm text-text-3">
            No Rust yet: macOS and Linux run the rustup line from{' '}
            <a href="https://rustup.rs" target="_blank" rel="noreferrer" className={linkClass}>
              rustup.rs
            </a>
            . On Windows, rustup-init.exe asks for the{' '}
            <a href={MSVC_BUILD_TOOLS_URL} target="_blank" rel="noreferrer" className={linkClass}>
              Microsoft C++ Build Tools
            </a>
            ; <span className="font-mono text-[12px]">cargo test</span> links with them. Or use WSL.
          </p>
        </div>
        <div className="min-w-0 rounded-lg border border-line bg-surface-1 p-5">
          <p className="font-mono text-sm text-text-1">lane B — dev container</p>
          <p className="mt-2 text-body-sm text-text-2">
            Open the unpacked folder in VS Code → "Reopen in Container". Toolchain and wasm target preinstalled.
          </p>
        </div>
        <div className="min-w-0 rounded-lg border border-line bg-surface-1 p-5">
          <p className="font-mono text-sm text-text-1">lane C — codespaces</p>
          <p className="mt-2 text-body-sm text-text-2">
            A Codespace that builds only this crate and opens{' '}
            <span className="break-all font-mono text-[12px] text-text-1">{lab.editFile}</span>.
          </p>
          <p className="mt-3">
            <a
              href={codespacesUrl(lab.id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center font-mono text-[12px] text-accent underline underline-offset-2 [@media(pointer:coarse)]:min-h-11"
            >
              Open {lab.id} in Codespaces
            </a>
          </p>
          <p className="mt-2 text-body-sm text-text-3">
            Codespaces bills your GitHub account (
            <ClaimValue id={CODESPACES_FREE_HOURS_CLAIM} format={(c) => `${c.value} core-hours`} /> a month free).
          </p>
          <p className="mt-2 text-body-sm text-text-3">
            In its terminal: <span className="break-all font-mono text-[12px]">cd labs/{crate}</span>. The workspace root
            there is <span className="font-mono text-[12px]">labs/</span>, so the build lands in{' '}
            <span className="break-all font-mono text-[12px]">labs/{lab.artifact}</span>.
          </p>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface-1">
        <div className="border-b border-line px-4 pt-2.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-1">one-command workspace</p>
          <div role="tablist" aria-label="Setup command by platform" className="mt-1 flex gap-5 overflow-x-auto">
            {tabs.map((tab, index) => (
              <button
                key={tab.id}
                id={`setup-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={active.id === tab.id}
                aria-controls="setup-panel"
                tabIndex={active.id === tab.id ? 0 : -1}
                onClick={() => {
                  setActiveId(tab.id)
                  setSetupCopied(false)
                }}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn(
                  '-mb-px shrink-0 border-b-2 py-2 font-mono text-body-sm transition-colors duration-150 [@media(pointer:coarse)]:min-h-11',
                  active.id === tab.id ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-1',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div role="tabpanel" id="setup-panel" aria-labelledby={`setup-tab-${active.id}`}>
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <p className="min-w-0 text-body-sm text-text-3">{active.platform}</p>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(active.command).catch(() => undefined)
                setSetupCopied(true)
                window.setTimeout(() => setSetupCopied(false), 1200)
              }}
              className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-text-3 transition-colors hover:text-text-1 [@media(pointer:coarse)]:min-h-11"
              aria-label="Copy workspace setup command"
            >
              {setupCopied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
              {setupCopied ? 'copied' : 'copy'}
            </button>
          </div>
          <pre tabIndex={0} className="overflow-x-auto bg-ink p-4 font-mono text-[12px] leading-relaxed text-text-1">
            {active.command}
          </pre>
          <div className="border-t border-line px-4 py-3">
            <p className="text-body-sm text-text-3">{active.note}</p>
            {active.extra && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-body-sm text-text-3">
                {active.extra.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line px-4 py-3">
          <p className="min-w-0 text-body-sm text-text-3">
            After <span className="font-mono text-[12px]">cargo build --release --target wasm32-unknown-unknown</span>{' '}
            the module is{' '}
            <span className="break-all font-mono text-[12px] text-text-1">{artifact.fromWorkspace}</span>: cargo writes
            to the workspace root’s <span className="font-mono text-[12px]">target/</span>, which is{' '}
            <span className="break-all font-mono text-[12px]">{artifact.fromCrate}</span> from inside the crate.
          </p>
          <div className="flex shrink-0 flex-wrap gap-x-5 gap-y-1">
            <a
              href={lab.zip}
              download
              className="inline-flex items-center gap-2 font-mono text-[11px] text-accent underline [@media(pointer:coarse)]:min-h-11"
            >
              <Download className="h-3.5 w-3.5" /> download ZIP instead
            </a>
            <a
              href={tarballPath(lab.zip)}
              download
              className="inline-flex items-center gap-2 font-mono text-[11px] text-accent underline [@media(pointer:coarse)]:min-h-11"
            >
              <Download className="h-3.5 w-3.5" /> download .tar.gz
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

export default SetupLanes
