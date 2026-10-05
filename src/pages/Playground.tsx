import { useParams } from 'react-router'
import NotFound from '@/pages/NotFound'
import ErrorBoundary from '@/components/ErrorBoundary'
import SimHost from '@/components/sims/SimHost'
import { SIM_ALIASES } from '@/lib/sims/host'

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
      <SimHost key={SIM_ALIASES[simId]} mode="lab" simId={SIM_ALIASES[simId]} />
    </ErrorBoundary>
  )
}
