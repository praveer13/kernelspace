/**
 * The watcher's repositories and window (docs/specs/wave-2.md §18; serving dossier, serving-landscape.md:275-283).
 * The twenty repos the weekly digest would poll, Dynamo included, and the fixed window the backtest reads.
 * Pure data: fetch.ts, match.ts and the tests import it, nothing here touches the network or the disk.
 */

export interface WatchRepo {
  /** Short id used in reports: the dossier's spelling. */
  id: string
  /** Hosted `owner/name` as the API reports it today (a renamed org is written under its new owner). */
  repo: string
  /**
   * How lesson prose names the project. A release line from this repo that hits the keyword rule maps to the
   * lessons whose text contains one of these (the matcher's repo anchor). Empty when no lesson names the project,
   * so only a term tag can flag its lines.
   */
  names: string[]
  /** Match `names` case-sensitively: short or common words ("slime", "verl", "EPP") would otherwise hit ordinary prose. */
  exact?: boolean
}

/** Both ends inclusive, UTC days. 61 days (8.7 weeks) holding the KVBM deprecation of 2026-09-21 and llm-d v0.10.0. */
export const WATCH_WINDOW = { from: '2026-08-01', to: '2026-09-30' } as const

export const WATCHLIST: readonly WatchRepo[] = [
  { id: 'vllm', repo: 'vllm-project/vllm', names: ['vLLM'] },
  { id: 'sglang', repo: 'sgl-project/sglang', names: ['SGLang'] },
  { id: 'dynamo', repo: 'ai-dynamo/dynamo', names: ['Dynamo'], exact: true },
  { id: 'llm-d', repo: 'llm-d/llm-d', names: ['llm-d'] },
  { id: 'TensorRT-LLM', repo: 'NVIDIA/TensorRT-LLM', names: ['TensorRT-LLM'] },
  { id: 'flashinfer', repo: 'flashinfer-ai/flashinfer', names: ['FlashInfer'] },
  { id: 'flash-attention', repo: 'Dao-AILab/flash-attention', names: ['FlashAttention', 'flash-attention'] },
  { id: 'DeepEP', repo: 'deepseek-ai/DeepEP', names: ['DeepEP'] },
  { id: 'DeepGEMM', repo: 'deepseek-ai/DeepGEMM', names: ['DeepGEMM'] },
  { id: 'Mooncake', repo: 'kvcache-ai/Mooncake', names: ['Mooncake'] },
  { id: 'LMCache', repo: 'LMCache/LMCache', names: ['LMCache'] },
  { id: 'verl', repo: 'verl-project/verl', names: ['verl'], exact: true },
  { id: 'slime', repo: 'THUDM/slime', names: ['slime'], exact: true },
  { id: 'AReaL', repo: 'areal-project/AReaL', names: ['AReaL'], exact: true },
  { id: 'mistral.rs', repo: 'EricLBuehler/mistral.rs', names: ['mistral.rs'] },
  // "candle" and "burn" are ordinary English words and no lesson names the Rust projects, so they carry no anchor
  { id: 'candle', repo: 'huggingface/candle', names: [] },
  { id: 'burn', repo: 'tracel-ai/burn', names: [] },
  { id: 'cudarc', repo: 'chelsea0x3b/cudarc', names: ['cudarc'] },
  { id: 'InferenceX', repo: 'SemiAnalysisAI/InferenceX', names: ['InferenceX', 'InferenceMAX'] },
  {
    id: 'gateway-api-inference-extension',
    repo: 'kubernetes-sigs/gateway-api-inference-extension',
    names: ['gateway-api-inference-extension', 'endpoint picker', 'EPP'],
  },
]

export const WATCH_REPO_COUNT = 20

const byRepo = new Map(WATCHLIST.map((w) => [w.repo.toLowerCase(), w]))

/** The watchlist entry for an `owner/name`, any case. */
export const watchRepo = (repo: string): WatchRepo | undefined => byRepo.get(repo.toLowerCase())
