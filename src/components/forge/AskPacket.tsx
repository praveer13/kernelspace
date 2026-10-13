/**
 * "Ask claude / ask chatgpt" with a context packet (docs/specs/wave-2.md §14.3): the failing checks and the rung the
 * learner reached, copied to the clipboard, beside the hint ladder. ForgeLab mounts it with `{lab, reports}`.
 *
 * Like `HintLadder`, it reads the rung reached from the ledger's `hint:` acks and the failing checks from `reports`, the
 * graded runs of this visit, oldest first. Which red checks may ask is the experiment (§14.4): in the packet arm the
 * button shows at once (R1 to R4 stay closed in the ladder), in the ladder arm and in labs that are not randomized it
 * shows after R2. The packet carries the checks' messages (code-stripped) and a keyless lesson excerpt, never the
 * learner's code.
 */

import { useEffect } from 'react'
import type { ForgeLab } from '@/data/labs'
import type { LabRunReport } from '@/lib/forge/types'
import { useProgress } from '@/lib/progress'
import { ensureExpSeed, isRandomizedLab, readExpSeed } from '@/lib/learner/experiments'
import { bestHeading, buildPacket, claimsFor, fetchLessonMd, helpRows, learnerNotes } from '@/lib/mentor/packet'
import type { HelpRow, Packet } from '@/lib/mentor/packet'
import AskButtons from '@/components/mentor/AskButtons'

export interface AskPacketProps {
  lab: ForgeLab
  reports: readonly LabRunReport[]
}

const engine = () => useProgress.controls.engine()

/** The id prefix of a lab's authored items: "lab", its index as two digits, and a dot. */
const itemPrefix = (lab: ForgeLab): string => `lab${String(lab.index).padStart(2, '0')}.`

/** The packet buttons under the ladder. Presentational: `AskPacket` wires it to the ledger. */
export function AskPacketView({ lab, reports, acks, expSeed }: AskPacketProps & { acks: Readonly<Record<string, string>>; expSeed: number | undefined }) {
  const rows = helpRows({ labId: lab.id, reports, acks, expSeed })
  if (rows.length === 0) return <div hidden data-ask-packet={lab.id} />

  const build = (row: HelpRow): (() => Promise<Packet>) => async () => {
    const [md, notes, claims] = await Promise.all([
      fetchLessonMd(lab.lessonId),
      learnerNotes(engine, { lessonId: lab.lessonId, labItemPrefix: itemPrefix(lab) }),
      claimsFor({ labId: lab.id, lessonId: lab.lessonId }),
    ])
    const others = rows.filter((r) => r.check.id !== row.check.id).map((r) => r.check)
    return buildPacket({
      scope: { kind: 'lab', labId: lab.id, title: lab.title, checkId: row.check.id, rung: row.rung, lessonId: lab.lessonId, h2: bestHeading(md, `${row.check.label} ${row.check.id.replace(/[-_]/g, ' ')}`) },
      notes,
      failing: [row.check, ...others],
      claims,
      md,
    })
  }

  return (
    <section aria-labelledby="ask-packet-title" data-ask-packet={lab.id} className="space-y-3">
      <h3 id="ask-packet-title" className="font-mono text-label uppercase tracking-[0.10em] text-text-3">
        Ask your own agent, with a packet
      </h3>
      <p className="text-body-sm text-text-2">
        A packet is a short brief for your agent: which check is red and what it said, the lesson section behind it and the sourced numbers. It never includes your code. The button copies it, then opens the agent;
        paste it there. Using it is counted as asking for help, never as credit.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.check.id} className="rounded-sm border border-line bg-surface-2 px-3 py-2" data-packet-check={row.check.id} data-arm={row.arm ?? 'none'}>
            <p className="text-body-sm text-text-1">
              <span className="font-mono">{row.check.id}</span> <span className="text-text-2">{row.check.label}</span>
            </p>
            {row.show ? (
              <AskButtons
                className="mt-1.5"
                size="button"
                copyPacket
                packetRef={`packet:lab/${lab.id}/${row.check.id}`}
                label={`lab ${lab.id}, check ${row.check.id}`}
                about={`check ${row.check.id}`}
                {...(row.arm === undefined ? {} : { arm: row.arm })}
                build={build(row)}
              />
            ) : (
              <p className="mt-1 text-[12px] text-text-3">The packet opens after R2 of the hints for this check.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function AskPacket({ lab, reports }: AskPacketProps) {
  const acks = useProgress((s) => s.acks)
  const ready = useProgress((s) => s.ledger.ready)
  const expSeed = useProgress((s) => readExpSeed(s.working['exp:seed']))
  // `exp:seed` is created once, the first time a randomized lab shows help (HintLadder does the same; the first one wins).
  useEffect(() => {
    if (ready && expSeed === undefined && isRandomizedLab(lab.id)) ensureExpSeed(useProgress.getState(), Math.random)
  }, [ready, expSeed, lab.id])
  return <AskPacketView lab={lab} reports={reports} acks={acks} expSeed={expSeed} />
}

export default AskPacket
