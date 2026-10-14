/* eslint-disable react-refresh/only-export-components -- the ledger write for a twin question is exported beside the
   component so the test records exactly what the panel plays */
/**
 * "The production twin" on ForgeLab (docs/specs/wave-3.md §9, §2.3): once a lab is done, the file in a production
 * codebase that does what the learner just wrote. It shows the file at the ref its claim pins (a link, the claim's
 * `verifiedAt`, and "stale since" past the claim's 60-day TTL), the "you just wrote ..." line and three tracing
 * questions played by the shared ItemCard, one at a time, each written to the ledger as `item:lab<NN>.twin.<n>` with
 * `src: 'practice'` (pool `twin`; the refs are the ones scripts/item-pools.ts gives the same questions).
 *
 * A lab without a twin module renders nothing, and so does a lab that is not done, a twin that fails to load and a
 * twin that breaks the rules of `twinProblems` (the content task's test and verify:items say why). Nothing is fetched
 * before the lab is done: the twin, its claim group and the item player load on that edge, so the panel's own chunk
 * (which ForgeLab mounts on every visit) stays small. Nothing locks: the questions can be played again.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ForgeLab } from '@/data/labs'
import { getClaim, staleSince, type Claim } from '@/data/claims'
import { findTwin, twinFileUrl, twinItemId, twinProblems, type TwinModule } from '@/data/twins'
import type { ItemResult } from '@/lib/items/play'
import type { PlayableItem } from '@/lib/items/types'
import type { ItemResponse } from '@/lib/ledger/types'
import { useProgress } from '@/lib/progress'
import { freshSeed } from '@/lib/rng'
import { cn } from '@/lib/utils'

const ItemCard = lazy(() => import('@/components/items/ItemCard'))

/** The ledger caps an item's KCs (codec MAX_KCS). */
const MAX_KCS = 6

export interface TwinPanelProps {
  lab: ForgeLab
  /** The lab is done (a credited pass of every required check is in the ledger). */
  done: boolean
  /** Where the twin comes from; the registry's `findTwin` unless a test supplies a fixture. */
  find?: (labId: string) => Promise<TwinModule | undefined>
  /** The clock "stale since" reads; now unless a test pins it. */
  now?: Date
}

/** The authored item a twin question plays as: `item:lab<NN>.twin.<n>` (n from 1), under its own KCs. */
export function twinPlayable(twin: TwinModule, n: number): PlayableItem {
  const { q, kcs } = twin.items[n - 1]
  return { source: 'item', item: { id: twinItemId(twin.labNo, n), q, kcs } }
}

/** The ledger event for one answer: an `item` event, `src: 'practice'`, the authored pick and the question's KCs. */
export function twinResponse(r: ItemResult): ItemResponse {
  return {
    kind: 'item',
    ref: r.ref as ItemResponse['ref'],
    rev: r.rev,
    score: r.score,
    ok: r.ok,
    ...(r.conf ? { conf: r.conf } : {}),
    seed: r.seed,
    ms: r.ms,
    provenance: 'practice',
    data: {
      src: 'practice',
      pick: r.pick ?? [],
      kcs: r.kcs.slice(0, MAX_KCS),
      nsec: r.nsec,
      ...(r.grade.diagnosis ? { miss: r.grade.diagnosis.id } : {}),
    },
  }
}

/** "sgl-project/sglang@v0.5.21": the repository and the ref the claim pins. */
const pinLabel = (pin: { repo: string; ref: string }) => `${pin.repo}@${pin.ref}`

const sectionLabel = 'font-mono text-[11px] uppercase tracking-[0.14em] text-text-3'
const BUTTON = 'min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright'

interface Loaded {
  labId: string
  twin: TwinModule
  claim: Claim
}

export default function TwinPanel({ lab, done, find = findTwin, now }: TwinPanelProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!done) return
    let live = true
    ;(async () => {
      try {
        const twin = await find(lab.id)
        if (twin === undefined) return
        // the claim group registers on import; it is the one place twin claims live (claims/homes.ts)
        await import('@/data/claims/lazy/twins')
        const claim = getClaim(twin.claimId)
        if (live && twinProblems(twin, claim).length === 0) setLoaded({ labId: lab.id, twin, claim })
      } catch {
        // no twin, a chunk that would not load or an unknown claim: the lab page is complete without it
      }
    })()
    return () => {
      live = false
    }
  }, [lab.id, done, find])

  if (!done || loaded === null || loaded.labId !== lab.id) return null
  return <TwinView lab={lab} twin={loaded.twin} claim={loaded.claim} now={now} />
}

/* ------------------------------ the panel ------------------------------ */

interface TwinViewProps {
  lab: ForgeLab
  twin: TwinModule
  claim: Claim
  now?: Date
}

function TwinView({ lab, twin, claim, now }: TwinViewProps) {
  const recordItems = useProgress((s) => s.recordItems)
  const pin = claim.pin!
  const stale = useMemo(() => staleSince(claim, now), [claim, now])
  const [at, setAt] = useState(0)
  const [round, setRound] = useState(0)
  const [seed, setSeed] = useState(freshSeed)
  const [rights, setRights] = useState<boolean[]>([])
  const summary = useRef<HTMLDivElement>(null)
  const total = twin.items.length
  const finished = at >= total

  // The last Next unmounts the item that held focus: the summary takes it.
  useEffect(() => {
    if (finished) summary.current?.focus()
  }, [finished])

  const answered = (r: ItemResult) => {
    recordItems([twinResponse(r)])
    setRights((prev) => [...prev, r.ok])
  }
  const again = () => {
    setAt(0)
    setRound((n) => n + 1)
    setSeed(freshSeed())
    setRights([])
  }

  return (
    <section className="mt-12 max-w-3xl" aria-labelledby={`twin-${lab.id}`} data-twin={lab.id}>
      <h2 id={`twin-${lab.id}`} className={sectionLabel}>
        the production twin
      </h2>
      <p className="mt-3 text-body text-text-1" data-twin-line>
        {twin.youWrote}
      </p>

      <div className="mt-3 rounded-lg border border-line bg-surface-1 px-4 py-3 text-body-sm text-text-2" data-twin-source>
        <a
          href={twinFileUrl(pin, twin.path)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center font-mono text-text-1 underline underline-offset-2 [overflow-wrap:anywhere]"
        >
          {twin.path}
          <span className="sr-only"> at {pinLabel(pin)} (opens GitHub in a new tab)</span>
        </a>
        <p className="font-mono text-[12px] text-text-3">
          <span data-twin-pin>pinned at {pinLabel(pin)}</span> · <span data-twin-verified>checked {claim.verifiedAt}</span>
          {stale !== null && (
            <>
              {' '}
              ·{' '}
              <span className="text-amber" data-twin-stale>
                stale since {stale}
              </span>
            </>
          )}
        </p>
        {stale !== null && (
          <p className="mt-1" data-twin-stale-note>
            Nobody has re-read this file since {claim.verifiedAt}, and a claim like this is good for {claim.ttlDays} days. The upstream may have moved on; the
            link opens the file as it was at the pinned ref.
          </p>
        )}
        <p className="mt-2">
          The questions trace{' '}
          {twin.symbols.map((s, i) => (
            <span key={s}>
              {i > 0 && (i === twin.symbols.length - 1 ? ' and ' : ', ')}
              <code className="font-mono text-[13px] text-text-1">{s}</code>
            </span>
          ))}
          .
        </p>
      </div>

      <div className="mt-4">
        {!finished && (
          <Suspense fallback={<p className="min-h-11 font-mono text-body-sm text-text-3">loading…</p>}>
            <ItemCard
              key={`${round}:${twin.items[at].id}`}
              item={twinPlayable(twin, at + 1)}
              seed={seed}
              autoFocus={at > 0 || round > 0}
              eyebrow={`trace ${at + 1} of ${total}`}
              onResult={answered}
              onNext={() => setAt(at + 1)}
              nextLabel={at + 1 < total ? 'Next question' : 'Finish'}
            />
          </Suspense>
        )}
        {finished && (
          <div ref={summary} tabIndex={-1} className={cn('rounded-lg border border-line bg-surface-1 px-4 py-4 focus:outline-none')} data-twin-done>
            <p role="status" className="text-body-sm text-text-1">
              {rights.filter(Boolean).length} of {total} traced right.
            </p>
            <button type="button" onClick={again} className={`mt-3 ${BUTTON}`}>
              Trace them again
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
