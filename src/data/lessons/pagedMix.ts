import { claimNumber } from './claims'

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

/**
 * The waste account t1.l4 and t5.l5 give in the same words (K0-FIX3): Figure 2's vLLM bar, what it is and is not, and the
 * course's own "under 4%" with the mix's share at the paper's block and at vLLM's default. Every number is a claim or is
 * computed from one.
 */
export function wasteStory(): string {
  const paper = claimNumber('serving.pagedattention.paper-block-size')
  const engine = claimNumber('production.vllm.block-size')
  const fig2 = claimNumber('serving.pagedattention.fig2-vllm-token-states')
  const bound = claimNumber('synthetic.kv.paged-waste')
  return `The paper's Figure 2 labels vLLM's bar ${fig2}% token states: an average over one experiment (§6.2), not a bound. ${fig2Rest()} "Under ${bound}%" is the course's estimate, not the paper's, and it holds only where blocks are small next to the sequences: the course's mixed batch of eight sequences (${mixRange()} tokens) wastes ${mixWastePct(paper)}% at the paper's ${paper}-token blocks and ${mixWastePct(engine)}% at vLLM's default of ${engine}.`
}

/**
 * What Figure 2 implies for vLLM, in the words wasteStory(), t2.l7's Figure 2 callout and the paged-waste erratum share
 * (K0-FIX4): the rest of the 100% that the claim's token-states bar leaves, in that one experiment. Computed from the claim.
 */
export function fig2Rest(): string {
  const rest = (100 - claimNumber('serving.pagedattention.fig2-vllm-token-states')).toFixed(1)
  return `So by Figure 2, about ${rest}% of vLLM's KV memory held something other than token states in that experiment.`
}

/**
 * What the block-table indirection costs, as the paper measures it (§7.1) and as its authors weigh it: t2.l7 and t5.l5
 * give it in these words (K0-FIX4). Both ends of the range are claims.
 */
export function kernelCostStory(): string {
  const lo = claimNumber('serving.pagedattention.kernel-overhead-low')
  const hi = claimNumber('serving.pagedattention.kernel-overhead-high')
  return `The paper measures what the indirection costs (§7.1): ${lo}–${hi}% higher attention-kernel latency than FasterTransformer's kernel, from reading the block table, extra branches and variable sequence lengths. The authors call the overhead small because it touches only the attention operator, not the model's other operators such as the linear layers, and vLLM still outperforms FasterTransformer end to end (§6).`
}

/** The paper's headline throughput and its largest request-rate figure (abstract, §6.2), every number a claim (K0-FIX4). */
export function throughputStory(): string {
  const lo = claimNumber('serving.pagedattention.throughput-gain-low')
  const hi = claimNumber('serving.pagedattention.throughput-gain-high')
  const ft = claimNumber('serving.pagedattention.ft-request-rate')
  return `In the paper's evaluation (§6: OPT and LLaMA models on A100 GPUs, workloads synthesized from ShareGPT and Alpaca), vLLM improves throughput ${lo}–${hi}× at the same level of latency over FasterTransformer and Orca (abstract), because the memory it frees lets it batch more requests. Its largest figure is against FasterTransformer, which lacks fine-grained scheduling and manages memory like Orca (Max): up to ${ft}× higher request rates (§6.2).`
}
