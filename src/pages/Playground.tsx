import { useParams } from 'react-router'
import NotFound from '@/pages/NotFound'
import ErrorBoundary from '@/components/ErrorBoundary'
import SimHost from '@/components/sims/SimHost'
import AskButtons from '@/components/mentor/AskButtons'
import { SIM_ALIASES, decodeCfg } from '@/lib/sims/host'
import { buildPacket, claimsFor, fetchLessonMd } from '@/lib/mentor/packet'
import type { Packet } from '@/lib/mentor/packet'
import { SIMS } from '@/lib/tracks'

/** The lesson a sim is used in (`usedIn: 'T5.L4'` -> `t5.l4`), or undefined for the capstone's engine. */
function lessonOfSim(canonical: string): string | undefined {
  const meta = SIMS.find((s) => SIM_ALIASES[s.id] === canonical)
  const id = meta?.usedIn.toLowerCase()
  return id !== undefined && /^t\d\.l\d+$/.test(id) ? id : undefined
}

/**
 * "Ask claude / ask chatgpt" for a sim: a packet with the sim and its current `?cfg=`, read at the press (the sim writes
 * the URL a moment after each change), and the section of the lesson that uses it. It sits above the sim's own header:
 * the lab shells let their content run past a fixed-height box, so a row below them would lie under it.
 */
function SimAsk({ simId }: { simId: string }) {
  const build = async (): Promise<Packet> => {
    const params = new URLSearchParams(window.location.search)
    const cfg = decodeCfg<unknown>(params.get('cfg'))
    const from = params.get('from') ?? undefined
    const lessonId = from !== undefined && /^[a-z0-9]+\.l\d+$/.test(from) ? from : lessonOfSim(simId)
    const [md, claims] = await Promise.all([lessonId === undefined ? '' : fetchLessonMd(lessonId), lessonId === undefined ? [] : claimsFor({ lessonId })])
    return buildPacket({
      scope: { kind: 'sim', simId, ...(lessonId === undefined ? {} : { lessonId }), ...(cfg === null || cfg === undefined ? {} : { cfg: JSON.stringify(cfg) }) },
      claims,
      md,
    })
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-surface-1 px-4 py-1.5">
      <span className="font-mono text-label uppercase tracking-[0.10em] text-text-3">Stuck? Ask your own agent</span>
      <AskButtons packetRef={`packet:sim/${simId}`} label={`simulator ${simId}`} about={`simulator ${simId}`} build={build} copyPacket />
    </div>
  )
}

/**
 * /lab/:simId. Accepts both the canonical `sim-*` ids used by the progress store / lessons and the short
 * ids used in src/lib/tracks.ts (SIM_ALIASES). The sim is mounted by SimHost in lab mode, the only mode
 * that reads and writes `?cfg=` and `?machine=`.
 */
export default function Playground() {
  const { simId = '' } = useParams()
  if (!Object.hasOwn(SIM_ALIASES, simId)) return <NotFound />
  return (
    <ErrorBoundary label="this simulator" resetKey={simId}>
      <SimAsk simId={SIM_ALIASES[simId]} />
      <SimHost key={SIM_ALIASES[simId]} mode="lab" simId={SIM_ALIASES[simId]} />
    </ErrorBoundary>
  )
}
