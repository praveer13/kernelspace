import { Suspense, lazy } from 'react'
import { useParams } from 'react-router'
import NotFound from '@/pages/NotFound'
import RouteFallback from '@/components/RouteFallback'

// Each simulator is its own chunk; only the one being opened is fetched.
const MemoryGridSim = lazy(() => import('@/components/sims/MemoryGridSim'))
const AllocatorSim = lazy(() => import('@/components/sims/AllocatorSim'))
const VmPagingSim = lazy(() => import('@/components/sims/VmPagingSim'))
const RooflineSim = lazy(() => import('@/components/sims/RooflineSim'))
const WgslSim = lazy(() => import('@/components/sims/WgslSim'))
const QuantizerSim = lazy(() => import('@/components/sims/QuantizerSim'))
const KvCacheSim = lazy(() => import('@/components/sims/KvCacheSim'))
const BatchingSim = lazy(() => import('@/components/sims/BatchingSim'))
const ToyEngineSim = lazy(() => import('@/components/sims/ToyEngineSim'))

/**
 * /lab/:simId registry. Accepts both the canonical `sim-*` ids used by the
 * progress store / lessons and the short ids used in src/lib/tracks.ts.
 */
const REGISTRY: Record<string, React.ComponentType> = {
  'sim-memory': MemoryGridSim,
  'memory-grid': MemoryGridSim,
  'sim-allocator': AllocatorSim,
  allocator: AllocatorSim,
  'sim-vm': VmPagingSim,
  paging: VmPagingSim,
  'sim-roofline': RooflineSim,
  roofline: RooflineSim,
  'sim-wgsl': WgslSim,
  wgsl: WgslSim,
  'sim-quant': QuantizerSim,
  quantizer: QuantizerSim,
  'sim-kv': KvCacheSim,
  'kv-calc': KvCacheSim,
  'sim-batching': BatchingSim,
  batching: BatchingSim,
  'sim-engine': ToyEngineSim,
  engine: ToyEngineSim,
}

export default function Playground() {
  const { simId = '' } = useParams()
  const Sim = REGISTRY[simId]
  if (!Sim) return <NotFound />
  return (
    <Suspense fallback={<RouteFallback label="loading simulator" />}>
      <Sim />
    </Suspense>
  )
}
