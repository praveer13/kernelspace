import type { SimTask } from '@/components/sims/PlaygroundShell'
import type { TaskHome } from '@/lib/sims/registry'

export const HOME: TaskHome = { simId: 'sim-quant' }

export const QUANTIZER_TASKS: SimTask[] = [
  { id: 'q-fp16', text: 'Quantize π (3.14159…) to FP16 and read the reconstruction error', xp: 60 },
  { id: 'q-int4-max', text: 'Find the largest exactly-representable INT4 value (zero error at q = ±7)', xp: 60 },
  { id: 'q-group-compare', text: 'Calibrate per-tensor INT4, then group-128; compare max error and distribution drift', xp: 60 },
  { id: 'q-outlier', text: 'Run the AWQ-style challenge: inject the 47.3 salient outlier, then rescue its group', xp: 60 },
]
