// A helper outside src/data/lessons/ that reaches the claims registry (K0-E2).
import { claimNumber } from '@/data/claims'

export function helperValue(): number {
  return claimNumber('production.vllm.block-size')
}
