import type { SimTask } from '@/components/sims/PlaygroundShell'

export const ENGINE_EXT_TASKS: SimTask[] = [
  {
    id: 't-eng-flops',
    text: 'Inspect per-stage FLOP shares during the forward pass',
    xp: 60,
  },
  {
    id: 't-eng-ctx',
    text: 'Model the KV-cache vs weights crossover from 1k to 128k tokens',
    xp: 60,
  },
  {
    id: 't-eng-gqa',
    text: 'Switch GQA KV-heads (32 → 8) and watch KV size / decode cost change',
    xp: 60,
  },
  {
    id: 't-eng-tokcmp',
    text: 'Compare tokenization density across English / Japanese / base64 presets',
    xp: 60,
  },
  {
    id: 't-eng-words',
    text: 'Estimate 128k-context word capacity for prose and source code',
    xp: 60,
  },
  {
    id: 't-eng-exec',
    text: 'Run timers, repair a missing waker, and move blocking work off-loop',
    xp: 60,
  },
]
