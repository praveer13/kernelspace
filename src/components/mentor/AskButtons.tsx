/**
 * "Ask claude", "ask chatgpt" and "copy packet" (H2, docs/specs/wave-2.md §14.2): the one place a context packet
 * leaves the page. A press copies the packet to the clipboard, records `ack packet:…` (how it left, how long it was,
 * which arm of the help experiment showed it) and opens the agent with a short instruction to paste it. If the
 * clipboard refuses, the packet appears in a dialog to copy by hand. The mounts differ only in what they put in the
 * packet: AgentActions (lessons), AskPacket (a lab's failing checks) and the sim page (its `?cfg=`).
 *
 * The packet is built when the pointer or focus reaches the buttons, so a press can copy and open the tab in the same
 * turn as the click: Safari blocks `window.open` after an await. A press that beats the build still works, and if the
 * browser blocks the tab anyway the link is shown here and the status does not claim it opened (ask-flow.ts).
 *
 * The ack never records content, and nothing here is credit: help-seeking is counted, not graded.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ClipboardCopy, ExternalLink } from 'lucide-react'
import { clsx as cn } from 'clsx'
import { useProgress } from '@/lib/progress'
import type { PacketRef } from '@/lib/ledger/types'
import type { Arm } from '@/lib/learner/experiments'
import { agentUrl } from '@/lib/mentor/packet'
import type { Agent, Packet } from '@/lib/mentor/packet'
import { ackVia, askFlow, askLine, type Via } from './ask-flow'

const CHIP =
  'inline-flex min-h-6 items-center gap-1 rounded border border-line px-2 py-0.5 font-mono text-[10px] text-text-3 transition-colors hover:border-accent/50 hover:text-accent aria-disabled:cursor-wait aria-disabled:opacity-60 [@media(pointer:coarse)]:min-h-11'
const BUTTON =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-sm border border-line-bright bg-surface-3 px-3 py-1.5 text-body-sm text-text-1 transition-colors duration-150 hover:bg-surface-2 aria-disabled:cursor-wait aria-disabled:opacity-60 [@media(pointer:coarse)]:min-h-11'

export interface AskButtonsProps {
  /** The ack this use writes: `packet:lesson/<id>`, `packet:lab/<lab>/<check>` or `packet:sim/<id>`. */
  packetRef: PacketRef
  /** Names the page in the link's instruction, e.g. `lesson t5.l4`. */
  label: string
  /** Builds the packet at press time (it fetches the lesson and reads the ledger). */
  build(): Promise<Packet>
  /** The help-experiment arm to record, when this page is randomized. */
  arm?: Arm
  /** Also show "copy packet", which copies without opening an agent. */
  copyPacket?: boolean
  size?: 'chip' | 'button'
  /** Extra controls before the packet's own, e.g. a lesson's "copy md". */
  lead?: ReactNode
  /** Names what the buttons are about, for assistive technology: "ask claude about check coalesce". */
  about?: string
  className?: string
}

/** A packet built ahead of the press stays good this long; the ledger notes in it are read again after that. */
const WARM_MS = 20_000

interface Warm {
  at: number
  promise: Promise<Packet>
  packet?: Packet
}

/** What the dialog shows when the clipboard write failed. */
interface Manual {
  packet: Packet
  via: Via
}

export default function AskButtons({ packetRef, label, build, arm, copyPacket = false, size = 'chip', lead, about, className }: AskButtonsProps) {
  const recordHelp = useProgress((s) => s.recordHelp)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [manual, setManual] = useState<Manual | null>(null)
  // The agent whose link is shown in place of a tab the browser would not open.
  const [blocked, setBlocked] = useState<Agent | null>(null)
  const warm = useRef<Warm | null>(null)
  const buildNow = useRef(build)
  const dialog = useRef<HTMLDialogElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const style = size === 'chip' ? CHIP : BUTTON
  const iconSize = size === 'chip' ? 11 : 14
  const suffix = about === undefined ? '' : ` about ${about}`

  useEffect(() => {
    buildNow.current = build
  }, [build])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    if (manual === null) return
    dialog.current?.showModal()
    area.current?.select()
  }, [manual])

  const say = (text: string) => {
    setStatus(text)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setStatus(''), 8000)
  }

  // Starts the build when the learner reaches for a button, so the press itself has nothing to wait for.
  const prepare = () => {
    const held = warm.current
    if (held !== null && Date.now() - held.at < WARM_MS) return
    const entry: Warm = { at: Date.now(), promise: buildNow.current() }
    warm.current = entry
    entry.promise.then(
      (p) => {
        entry.packet = p
      },
      () => {
        if (warm.current === entry) warm.current = null
      },
    )
  }

  const use = (via: Via) => {
    if (busy) return
    const held = warm.current
    const ready = held !== null && Date.now() - held.at < WARM_MS ? held.packet : undefined
    warm.current = null
    setBusy(true)
    setBlocked(null)
    // Everything up to the first await in askFlow runs inside this click: the copy starts and, with a ready packet, so does the tab.
    askFlow({
      via,
      url: agentUrl(via === 'copy' ? 'claude' : via, label),
      ready,
      build: () => buildNow.current(),
      writeText: (text) => navigator.clipboard.writeText(text),
      open: (url) => window.open(url, '_blank'),
    })
      .then((result) => {
        if (result.status !== 'failed') recordHelp(packetRef, { via: ackVia(result, via), chars: result.packet.chars, ...(arm === undefined ? {} : { arm }) })
        say(askLine(result))
        if (result.status === 'manual') setManual({ packet: result.packet, via })
        if (result.status === 'blocked' && via !== 'copy') setBlocked(via)
      })
      .finally(() => setBusy(false))
  }

  const agentLink = (a: Agent) => agentUrl(a, label)

  return (
    <div
      className={cn('inline-flex flex-wrap items-center gap-1.5', className)}
      data-ask-buttons={packetRef}
      onPointerEnter={prepare}
      onPointerDown={prepare}
      onFocusCapture={prepare}
    >
      {lead}
      {copyPacket && (
        <button type="button" className={style} aria-disabled={busy} onClick={() => use('copy')}>
          <ClipboardCopy size={iconSize} aria-hidden /> copy packet<span className="sr-only">{suffix}</span>
        </button>
      )}
      {(['claude', 'chatgpt'] as const).map((a) => (
        <button key={a} type="button" className={style} aria-disabled={busy} onClick={() => use(a)}>
          <ExternalLink size={iconSize} aria-hidden /> ask {a}
          <span className="sr-only">{suffix} (copies a packet, then opens a new tab)</span>
        </button>
      ))}
      <span role="status" aria-live="polite" className={cn(status === '' ? 'sr-only' : 'font-mono text-[11px] text-text-3')}>
        {status}
      </span>
      {blocked !== null && (
        <a className={cn(style, 'no-underline')} href={agentLink(blocked)} target="_blank" rel="noopener noreferrer" data-ask-blocked={blocked}>
          Open {blocked}
          <ExternalLink size={iconSize} aria-hidden />
          <span className="sr-only"> (opens in a new tab; the packet is already copied)</span>
        </a>
      )}
      {manual !== null && (
        <dialog
          ref={dialog}
          aria-labelledby="packet-manual-title"
          onClose={() => setManual(null)}
          className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-sm border border-line-bright bg-surface-2 p-4 text-text-1 backdrop:bg-black/60"
        >
          <h2 id="packet-manual-title" className="text-body font-medium">
            Copy the packet by hand
          </h2>
          <p className="mt-1 text-body-sm text-text-2">
            Your browser did not let this page use the clipboard. Select the text below, copy it, and paste it into your agent.
          </p>
          <label htmlFor="packet-manual-text" className="sr-only">
            The packet, {manual.packet.chars} characters
          </label>
          <textarea
            id="packet-manual-text"
            ref={area}
            readOnly
            rows={10}
            value={manual.packet.text}
            className="mt-2 w-full min-w-0 rounded-sm border border-line bg-ink p-2 font-mono text-[12px] text-text-1"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {manual.via !== 'copy' && (
              <a className={cn(BUTTON, 'no-underline')} href={agentLink(manual.via)} target="_blank" rel="noopener noreferrer">
                Open {manual.via}
                <ExternalLink size={13} aria-hidden />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
            <button type="button" className={BUTTON} onClick={() => dialog.current?.close()}>
              Close
            </button>
          </div>
        </dialog>
      )}
    </div>
  )
}
