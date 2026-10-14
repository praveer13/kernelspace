import { KC } from '@/data/kc/ids'
import type { TwinItem, TwinModule } from './types'

/**
 * Lab 06 against vLLM v1's scheduler (docs/specs/wave-3.md §9, task 3b-15). The claim `twin.vllm.scheduler` pins
 * vllm-project/vllm at v0.31.0; every statement below was read in these files at that tag:
 *   vllm/v1/core/sched/scheduler.py        Scheduler.schedule (the running loop, the waiting loop, the NOTE on the
 *                                           algorithm), Scheduler._preempt_request, the default FCFS queue
 *                                           (vllm/v1/core/sched/request_queue.py: FCFSRequestQueue.peek_request)
 *   vllm/config/scheduler.py               scheduler_reserve_full_isl = True, enable_chunked_prefill = True,
 *                                           long_prefill_token_threshold = 0, policy = "fcfs", watermark = 0.0
 *   vllm/v1/core/kv_cache_manager.py       KVCacheManager.allocate_slots (full_sequence_must_fit)
 * The numbers in the stems (max_num_batched_tokens 2,048, 16-token blocks) are a stated setup, not vLLM defaults: the
 * default in arg_utils.py depends on the usage context and the GPU, and the block size on the platform and backend.
 * The policy flags (fcfs, chunked prefill, scheduler_reserve_full_isl) are read at their defaults.
 * The lab 06 twin ships because schedule() supports three questions that a learner who wrote the lab can answer from the
 * code and the lab's own rules would get wrong: what stops the waiting loop, who is preempted, and how the one token
 * budget is spent. The arithmetic in each stem is re-derived in tests/forge/twins-content.test.ts.
 *
 * The lab's engine admits a whole prompt, skips what does not fit and "auto-preempts the newest sequence": these
 * questions show where each rule comes from in vLLM and where vLLM's loop differs from the reference scheduler.
 *
 * Authoring rules from verify:items (the twin pool's own bar): the key is never the longest option (the pool's baseline
 * allows none), key lengths spread over ranks 2, 3 and 4, and no option carries a colon, a reason connective or a
 * parenthesis, so no binary feature isolates the key.
 */

const q1: TwinItem = {
  id: 'lab06.twin.1',
  kcs: [KC.schedOrder, KC.admissionHeadroom],
  q: {
    q: 'vLLM v0.31.0 is configured with max_num_batched_tokens 2,048 and 16-token KV blocks, and its policy flags are at their defaults: first-come-first-served, chunked prefill on, no KV connector. Other requests hold most of the pool, so 200 blocks (3,200 tokens) are free, and the running requests need no new block this step. The waiting queue, oldest first, is W1 (a 4,000-token prompt), W2 (300 tokens) and W3 (200 tokens); none has a prefix-cache hit. Which of them does schedule() admit this step?',
    options: [
      'W3 and then W2, as the loop admits the smallest prompts first and leaves the 4,000-token whale for when memory frees',
      'W2 and W3, as W1 does not fit and the loop skips it and keeps walking the queue, just like your reference scheduler',
      'No request is admitted, as W1 needs 250 blocks for its whole prompt, and the loop breaks at its failed allocate_slots call',
      'W1 alone, with a first chunk of 2,048 tokens or 128 blocks, as chunked prefill needs to fit only the chunk it computes in that step',
    ],
    correct: [2],
    why: [
      'The default policy is fcfs: peek_request returns the head of a deque, and nothing sorts by prompt length. The priority policy orders by a priority value and then by arrival time, never by size.',
      "skip_request exists, but schedule() uses it for requests that are blocked (remote KV not ready, a LoRA limit, stale output in flight), not for ones that do not fit. A request that fails allocate_slots ends the loop with break. Skip and keep walking is the reference scheduler's rule; vLLM's FCFS queue does not follow it.",
      'Right. scheduler_reserve_full_isl is True by default, so allocate_slots is called with full_sequence_must_fit and checks all 250 blocks (4,000 / 16) against the 200 free. It returns None, `if new_blocks is None: break` ends the waiting loop, and W2 and W3 wait behind W1. That is head-of-line blocking.',
      'That is what happens with --no-scheduler-reserve-full-isl, which checks the first chunk alone. The default is True (vllm/config/scheduler.py), so the check covers the whole sequence, 250 blocks against 200 free.',
    ],
  },
}

const q2: TwinItem = {
  id: 'lab06.twin.2',
  kcs: [KC.admissionHeadroom, KC.continuousBatching],
  q: {
    q: "vLLM v0.31.0 with its policy flags at their defaults (first-come-first-served, no KV connector). Three requests are running, admitted in this order: R1, R2, R3. The KV pool is full. This step R1's decode token crosses a block boundary and needs one new block; R2 needs none. R2 holds 40 blocks (the most) and R3 holds 5. schedule() reaches R1 first and allocate_slots returns None. What does it do?",
    options: [
      'It preempts R2, the request holding the most blocks, as freeing 40 blocks at once ends the memory pressure fastest on the next step, and R1 and R3 keep running',
      'It preempts R1, the request that asked for the block and cannot get it, and lets R2 and R3 carry on with their decode tokens as before',
      'It preempts R3 and swaps its blocks to CPU memory, then resumes it from its last token once enough GPU memory frees up again',
      'It preempts R3, the last request in the running list, frees its blocks, resets its progress to 0, queues it first in waiting and admits nobody',
    ],
    correct: [3],
    why: [
      'Blocks held play no part. With the fcfs policy the victim is self.running[-1]; only the priority policy picks by a key, and then by priority value and arrival time, not by memory held.',
      'R1 would be the victim only if it were the last request in `running`. The loop takes running[-1], and R1 is first. Preempting the oldest request would also throw away the most progress.',
      'v1 has no swap. _preempt_request frees the blocks and sets num_computed_tokens to 0, so on resuming the request recomputes its prompt and the output so far, except for blocks that are still in the prefix cache. Nothing is copied to CPU.',
      'Right. With fcfs the victim is running[-1], the request admitted last (the priority policy takes the max by priority and arrival time instead). _preempt_request frees its blocks, sets num_computed_tokens = 0 and prepend_request puts it at the front of waiting. The waiting loop runs `if not preempted_reqs`, so no new request is admitted. This is the "auto-preempts the newest sequence" rule your lab\'s engine applied for you.',
    ],
  },
}

const q3: TwinItem = {
  id: 'lab06.twin.3',
  kcs: [KC.continuousBatching, KC.batchingThroughput],
  q: {
    q: "vLLM v0.31.0 with max_num_batched_tokens set to 2,048 and its policy flags at their defaults (chunked prefill on). 40 requests are decoding, one token each this step. The head of the waiting queue is a 6,000-token prompt with no prefix-cache hit, whose whole sequence fits in the free KV blocks. How many of its prompt tokens does this step's schedule() give it?",
    options: [
      '2,048 tokens, as prefill and decode draw on separate budgets and the 40 decode tokens do not shrink the chunk the prompt gets in this step',
      '6,000 tokens, the whole prompt in one step, as it fits in the free KV blocks and nothing else in the loop limits how much of it goes in',
      '2,008 tokens, as the 40 running requests are served first at one token each and the new prompt gets the rest of the budget',
      '0 tokens, as a prompt larger than the remaining budget waits until the running requests finish',
    ],
    correct: [2],
    why: [
      'There is one budget. token_budget starts at max_num_scheduled_tokens and every scheduled token, decode or prefill, subtracts from it. The NOTE at the top of schedule() says there is no "decoding phase" nor "prefill phase".',
      "Fitting in memory is the admission gate; the step's token budget is separate and caps the chunk with num_new_tokens = min(num_new_tokens, request_token_budget). 6,000 tokens in one step would be nearly three times max_num_batched_tokens: 6,000 / 2,048 = 2.93.",
      'Right. The running loop goes first and takes one token per decode request from token_budget (2,048 - 40 = 2,008). In the waiting loop request_token_budget = min(token_budget, input_budget - draft_slots) = 2,008, and with enable_chunked_prefill on, num_new_tokens = min(6,000, 2,008). The other 3,992 tokens follow in later steps.',
      'That is the behaviour with chunked prefill off, where `not enable_chunked_prefill and num_new_tokens > request_token_budget` ends the loop. It is on by default, so the prompt is cut to the budget instead of waiting.',
    ],
  },
}

/** The three questions, in play order; verify:items reads this list for the `twin` pool. */
export const TWIN_ITEMS: TwinItem[] = [q1, q2, q3]

const twin: TwinModule = {
  labId: 'batching-scheduler',
  labNo: '06',
  claimId: 'twin.vllm.scheduler',
  path: 'vllm/v1/core/sched/scheduler.py',
  symbols: ['Scheduler.schedule', 'Scheduler._preempt_request'],
  youWrote:
    'You just wrote the valve vLLM runs once per step. Its v1 scheduler has no prefill phase and no decode phase: one loop spends one token budget over the running and the waiting requests. Trace what it admits, where it stops and whom it preempts.',
  items: TWIN_ITEMS,
}

export default twin
