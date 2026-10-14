/**
 * `sim-kv` block-table explorer tasks (docs/specs/wave-3.md §13, task 3a-19): four outcome tasks that grade a
 * prediction, replacing the click-through `t-blk-share`, `t-blk-cow`, `t-blk-preempt` and `t-blk-sweep` (each names
 * its old id in `legacyId`, so an earlier completion still shows).
 *
 * The explorer reports each task's `observe` key when the learner does the step in `setup`. The keys are spelled
 * out here, not imported, because the registry loads every tasks file eagerly and the model stays in the sim's own
 * chunk; tests/sims/block-table.test.ts pins the two together. Every scenario number is synthetic (a pool of 10
 * physical blocks of 16 tokens, a 48-token prompt, a 64-token request that needs 4 blocks).
 */

import { KC } from '@/data/kc/ids'
import type { SimTaskDef } from '@/lib/sims/types'

export const BLOCK_TABLE_EXPLORER_TASKS: SimTaskDef[] = [
  {
    id: 'blk.share',
    simId: 'sim-kv',
    machine: 'blocks',
    kind: 'outcome',
    title: 'Fork a beam and count the free blocks',
    setup: 'Press "reset shared A+B prompt" and leave the pool at 10 blocks. Then press "fork beam from B" once and read the free count.',
    kcs: [KC.blockRefcounts],
    predict: {
      kind: 'numeric',
      prompt:
        'Sequences A and B share a 48-token prompt stored in 16-token blocks: 3 physical blocks, refcount 2 each, in a pool of 10. You fork beam C from B. How many blocks are free afterwards?',
      unit: 'blocks',
      tolerance: { abs: 0 },
    },
    observe: 'blk.share-free',
    explain: {
      prompt: 'In one line: what does the fork cost, and what changes in each shared block?',
      model:
        'The fork copies B\'s block table, three entries, and none of its tokens. Each of the three physical blocks gains one reference, so its refcount goes from 2 to 3, and no block leaves the free queue: 7 are still free. Copying the prompt for C would have taken 3 more blocks and left 4.',
      ideas: [
        'The fork copies the block table, not the KV tokens',
        'Each shared block gains a reference: refcount 2 becomes 3',
        'No block leaves the free queue, so the prefix is paid for once',
      ],
    },
    note: 'Three sequences now read the same 48 tokens from three physical blocks. A block goes back to the free queue only when its refcount reaches 0, which is why dropping a sequence that shares everything frees nothing (the preemption task shows it).',
    phone: { canonical: 'blocks.share' },
    lessons: ['t5.l5'],
    legacyId: 't-blk-share',
  },
  {
    id: 'blk.cow',
    simId: 'sim-kv',
    machine: 'blocks',
    kind: 'outcome',
    title: 'Copy-on-write: what one write copies',
    setup: 'Press "reset shared A+B prompt", then "fork beam from B", then "diverge B at L2".',
    kcs: [KC.kvCopyOnWrite],
    predict: {
      kind: 'numeric',
      prompt:
        'Beam C has forked from B, so all three prompt blocks have refcount 3. B now writes into its last prompt block, L2, which is shared. How many tokens of KV does the manager copy?',
      unit: 'tokens',
      tolerance: { abs: 0 },
    },
    observe: 'blk.cow-copied',
    explain: {
      prompt: 'In one line: why does B get a copy while A and C keep the original?',
      model:
        'The block has three owners, so writing into it in place would change what A and C read. The manager takes one free block, copies the block\'s 16 tokens of KV into it, points B\'s table at the copy and drops B\'s reference to the original (refcount 3 to 2). Nothing else is copied.',
      ideas: [
        'A write to a block with refcount above 1 must not change what the other owners read',
        'The manager copies exactly one block, 16 tokens, and not the whole prefix',
        'B\'s table now points at a private copy (refcount 1) and the original loses one reference',
      ],
    },
    note: 'The copy is one block, whatever the prompt length: the 32 tokens in the other two blocks stay shared by all three sequences. The cost of divergence is bounded by the block size, which is one more reason blocks are small.',
    phone: { canonical: 'blocks.cow' },
    lessons: ['t5.l5'],
    legacyId: 't-blk-cow',
  },
  {
    id: 'blk.preempt',
    simId: 'sim-kv',
    machine: 'blocks',
    kind: 'outcome',
    title: 'Preempt a sequence that shares its blocks',
    setup:
      'Press "reset shared A+B prompt", then "spawn 64-token request" twice. The second press finds 3 free blocks for a request that needs 4 and opens the preemption dialog. Choose seq A and either policy, then press "preempt & admit".',
    kcs: [KC.blockRefcounts],
    predict: {
      kind: 'numeric',
      prompt:
        'The pool of 10 holds A and B (sharing 3 blocks, refcount 2 each) and D (4 blocks of its own). 3 blocks are free and a new request needs 4. You preempt seq A. How many blocks does that return to the free queue?',
      unit: 'blocks',
      tolerance: { abs: 0 },
    },
    observe: 'blk.preempt-freed-a',
    explain: {
      prompt: 'In one line: why did preempting A not make room, and which victim would have?',
      model:
        'All three of A\'s blocks are also B\'s, so dropping A only lowers each refcount from 2 to 1 and no block reaches 0. Room appears when a victim\'s blocks reach refcount 0, as D\'s four private blocks do. Swap-to-CPU (the V0 option) keeps the victim\'s KV on the host to copy back, while recompute (all V1 does) throws it away and prefills it again later.',
      ideas: [
        'A shared block returns to the free queue only when its refcount reaches 0',
        'A\'s three blocks are also B\'s, so dropping A leaves each at refcount 1',
        'A victim with private blocks, like D, frees all of them at once',
      ],
    },
    note: 'Pick seq D in the dialog next and the same request is admitted, because D\'s four blocks are its own. The victim\'s block count is not what matters: the number of blocks only it owns is. Compare the two policies\' TTFT cards afterwards (the numbers are illustrative).',
    phone: { canonical: 'blocks.preempt' },
    lessons: ['t5.l5'],
    legacyId: 't-blk-preempt',
  },
  {
    id: 'blk.sweep',
    simId: 'sim-kv',
    machine: 'blocks',
    kind: 'outcome',
    title: 'Size the tail waste at 64-token blocks',
    setup: 'Move the block-size slider to 64 tokens and read the tail waste.',
    kcs: [KC.blockTables],
    predict: {
      kind: 'numeric',
      prompt: 'A 48-token prompt is stored in blocks of 64 tokens. How many token slots sit unused in its last block?',
      unit: 'tokens',
      tolerance: { abs: 0 },
    },
    observe: 'blk.sweep-tail-64',
    explain: {
      prompt: 'In one line: why is 16 tokens the default block size, and not 4 or 64?',
      model:
        'Block size trades two costs. A bigger block leaves more unused slots in a sequence\'s last block (this prompt wastes 16 slots at 64 tokens and none at 16; across random lengths about half a block), while a smaller block needs more table entries (12 at 4 tokens against 3 at 16), each a lookup in the attention kernel. 16 tokens keeps both small.',
      ideas: [
        'A bigger block leaves more unused slots in the last block',
        'A smaller block needs more block-table entries, so more lookups per sequence',
        '16 tokens keeps both the tail waste and the table small',
      ],
    },
    note: 'Sweep the slider from 4 to 64: the waste column is zero until the block is larger than the 16 tokens that divide the prompt evenly, while the entry count falls from 12 to 1. A different prompt length moves the waste but not the shape of the trade.',
    phone: { canonical: 'blocks.sweep' },
    lessons: ['t5.l5'],
    legacyId: 't-blk-sweep',
  },
]
