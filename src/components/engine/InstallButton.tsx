import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Check, Cpu } from 'lucide-react'
import type { ForgeLab } from '@/data/labs'
import { ENGINE_SLOTS, slotForLab } from '@/lib/engine/catalog'
import { checkInstall, requiredChecksOf } from '@/lib/engine/store'
import type { Credit } from '@/lib/forge/run'
import type { LabRunReport } from '@/lib/forge/types'
import { sha256Hex } from '@/lib/ledger/stable'
import { useSlots } from '@/pages/fleet/slots'
import { installDay, shortShaOf } from './EngineSchematic'

/**
 * "Install in your engine" on ForgeLab (docs/specs/wave-2.md §10.2, §2.3), shown after a run. ForgeLab mounts it
 * with the run's report, the credit `creditFor` gave it and the exact module bytes that ran. The button appears
 * only when `checkInstall` says yes: a learner build from a template v2 crate, at or above the catalog's lab
 * version, with every required check passed on seeds drawn at grade time in this very run. It installs through
 * the slot store, so the module survives a reload and the Fleet runs it.
 *
 * A run whose required checks all passed but that cannot be installed says why, in the §10.2 words. A run with
 * a red required check says nothing: the lab page is already telling the learner what to fix.
 */
export interface InstallButtonProps {
  lab: ForgeLab
  report: LabRunReport
  credit: Credit
  /** The module that produced `report`, as dropped. */
  bytes: ArrayBuffer
}

type Phase = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; sha256: string } | { kind: 'failed'; message: string }

/** One id per module, so a new run (new bytes) remounts the button and forgets the last install result. */
const moduleIds = new WeakMap<ArrayBuffer, number>()
let lastModuleId = 0
function moduleKey(bytes: ArrayBuffer): number {
  let id = moduleIds.get(bytes)
  if (id === undefined) {
    id = ++lastModuleId
    moduleIds.set(bytes, id)
  }
  return id
}

export default function InstallButton(props: InstallButtonProps) {
  return <InstallPanel key={moduleKey(props.bytes)} {...props} />
}

function InstallPanel({ lab, report, credit, bytes }: InstallButtonProps) {
  const slot = slotForLab(lab.id)
  const installed = useSlots((s) => (slot ? s.installed[slot] : undefined))
  const install = useSlots((s) => s.install)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [sha, setSha] = useState<string | null>(null)

  // The hash tells whether this very module already fills the slot.
  useEffect(() => {
    let live = true
    sha256Hex(bytes).then(
      (h) => live && setSha(h),
      () => undefined, // crypto.subtle is absent on insecure origins; the store reports that when installing
    )
    return () => {
      live = false
    }
  }, [bytes])

  if (!slot) return null
  const spec = ENGINE_SLOTS[slot]
  const required = requiredChecksOf(lab.id)
  const allRequiredPassed = required.every((id) => report.checks.some((c) => c.id === id && c.status === 'pass'))
  if (!allRequiredPassed) return null

  // A reference build earns no credit anywhere: `credit === null` is the same fact as `report.reference`, so either says no.
  const verdict = checkInstall(slot, credit === null ? { ...report, reference: true } : report, required)
  if (!verdict.ok) {
    return (
      <p data-testid="install-refusal" className="mt-4 rounded-md border border-line bg-surface-1 px-4 py-3 text-body-sm text-text-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">not installable · </span>
        {verdict.message}
        {verdict.detail ? `. ${verdict.detail}` : ''}.
      </p>
    )
  }

  const already = sha !== null && installed?.sha256 === sha
  const done = phase.kind === 'done' || already
  const doneSha = phase.kind === 'done' ? phase.sha256 : (installed?.sha256 ?? '')

  const onInstall = () => {
    setPhase({ kind: 'busy' })
    install({ slot, report, bytes, required }).then(
      (out) => setPhase(out.ok ? { kind: 'done', sha256: out.sha256 } : { kind: 'failed', message: out.message }),
      (e: unknown) => setPhase({ kind: 'failed', message: `could not save this module on this device: ${e instanceof Error ? e.message : String(e)}` }),
    )
  }

  return (
    <div className="mt-4 rounded-md border border-accent/40 bg-accent/5 p-4" data-testid="install-panel">
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">your engine · {spec.label} slot</p>
      {done ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-text-2">
          <Check className="h-4 w-4 text-accent" aria-hidden="true" />
          <span>
            Installed as your {spec.label} (sha <span className="font-mono">{shortShaOf(doneSha)}</span>). It stays on this device and the Fleet runs it.
          </span>
          <Link to="/fleet" className="text-accent underline underline-offset-2">
            Open the Fleet
          </Link>
        </p>
      ) : (
        <>
          <p className="mt-2 text-body-sm text-text-2">
            Every required check passed on fresh seeds, so this module can run in your engine as the {spec.label}
            {installed ? `, replacing the one installed on ${installDay(installed.at)}` : ''}.
          </p>
          <button
            type="button"
            onClick={onInstall}
            disabled={phase.kind === 'busy'}
            className="mt-3 inline-flex items-center gap-2 rounded-md border border-accent/60 bg-accent/10 px-3.5 py-2 font-mono text-[12px] text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
          >
            <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
            {phase.kind === 'busy' ? 'installing…' : 'install in your engine'}
          </button>
        </>
      )}
      <p role="status" className="mt-2 text-body-sm text-danger empty:mt-0">
        {phase.kind === 'failed' ? phase.message : ''}
      </p>
    </div>
  )
}
