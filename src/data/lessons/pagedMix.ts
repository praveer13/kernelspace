/**
 * The mixed batch t1.l4 and t5.l5 quote tail waste for: eight sequence lengths in tokens (the t1.l4 fragmentation item
 * family pins the same eight, and tests/lessons/k0-fix2-rules.test.ts holds the two equal). Waste at a block size is the unused slots of every sequence's last block, as a share of
 * the slots those blocks hold; a lesson reads it for the paper's block size and for vLLM's, so both numbers follow the claims.
 */
export const MIX: readonly number[] = [330, 245, 288, 412, 367, 301, 190, 455]

/** Tail waste of the mix at `block` tokens per block, in percent to one decimal place, as text. */
export function mixWastePct(block: number): string {
  const slots = MIX.reduce((s, n) => s + Math.ceil(n / block) * block, 0)
  const used = MIX.reduce((s, n) => s + n, 0)
  return (((slots - used) / slots) * 100).toFixed(1)
}

/** The mix's shortest and longest sequence, as text: '190 to 455'. */
export function mixRange(): string {
  return `${Math.min(...MIX)} to ${Math.max(...MIX)}`
}
