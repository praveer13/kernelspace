import { useParams } from 'react-router'
import NotFound from '@/pages/NotFound'
import MemoryGridSim from '@/components/sims/MemoryGridSim'
import AllocatorSim from '@/components/sims/AllocatorSim'
import VmPagingSim from '@/components/sims/VmPagingSim'
import RooflineSim from '@/components/sims/RooflineSim'
import WgslSim from '@/components/sims/WgslSim'
import QuantizerSim from '@/components/sims/QuantizerSim'
import KvCacheSim from '@/components/sims/KvCacheSim'
import BatchingSim from '@/components/sims/BatchingSim'
import ToyEngineSim from '@/components/sims/ToyEngineSim'

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
  return <Sim />
}
