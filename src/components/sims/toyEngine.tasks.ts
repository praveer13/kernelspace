import type { SimTask } from '@/components/sims/PlaygroundShell'

/** Machine-less, like engineExt.tasks.ts, which ToyEngineSim spreads after this list. */
export const HOME = { simId: 'sim-engine' }

export const TOY_ENGINE_TASKS: SimTask[] = [
  { id: 'tokenize', text: 'Tokenize a prompt and watch every merge round', xp: 60 },
  { id: 'forward', text: 'Run a full forward pass (reach the first decoded token)', xp: 60 },
  { id: 'decode', text: 'Naive-decode 8 tokens and watch the waste counter spin', xp: 60 },
  { id: 'kv', text: 'Enable the KV cache and cut mean ITL by 5× or more', xp: 60 },
  { id: 'batch', text: 'Run 4 concurrent sequences with continuous batching', xp: 60 },
]
