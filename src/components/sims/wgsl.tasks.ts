import type { SimTask } from '@/components/sims/PlaygroundShell'

export const HOME = { simId: 'sim-wgsl' }

export const WGSL_TASKS: SimTask[] = [
  { id: 'wgsl-16m', text: 'Run the modeled 16M vector add and inspect its 192 MiB traffic', xp: 60 },
  { id: 'wgsl-sweep', text: 'Run vector add at workgroup sizes 64 and 1024', xp: 60 },
  { id: 'wgsl-barrier', text: 'Remove a reduction barrier and observe a wrong sum', xp: 60 },
  { id: 'wgsl-multipass', text: 'Run multi-pass reduction to one verified scalar', xp: 60 },
]
