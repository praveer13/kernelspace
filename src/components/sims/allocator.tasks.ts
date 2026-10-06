/**
 * SIM-02 `sim-allocator` tasks (docs/specs/wave-1.md §10.2, task C9): four outcome tasks that grade a
 * prediction, and the old state-detected tasks kept as legacy under their old ids.
 *
 * Each outcome task names one task script (src/lib/sims/models/allocator.ts SCRIPTS): the sim loads its
 * op list, the learner plays it to the end, and the sim reports the `observe` key. The keys are spelled
 * out here, not imported, because the registry loads every tasks file eagerly and the model stays in the
 * sim's own chunk; tests/sims/allocator.test.ts pins the two together. All scenario numbers are
 * synthetic (a 1 KiB heap with 8 B headers).
 */

import { KC } from '@/data/kc/ids'
import type { SimTaskDef } from '@/lib/sims/types'

export const ALLOCATOR_OUTCOME_TASKS: SimTaskDef[] = [
  {
    id: 'alloc.frag-first-fit',
    simId: 'sim-allocator',
    machine: 'allocator',
    kind: 'outcome',
    title: 'Strand free memory with first-fit',
    setup: 'Under Task scripts, load "Eight blocks, free every other one", then press play (or step) until the queue is empty.',
    kcs: [KC.externalFrag],
    predict: {
      kind: 'numeric',
      prompt:
        'The script mallocs eight 96 B blocks with first-fit, then frees blocks 1, 3, 5 and 7. Every block also pays an 8 B header. What percent of the free bytes sits in the single largest free block?',
      unit: '%',
      tolerance: { abs: 5 },
    },
    observe: 'alloc.frag-pct',
    explain: {
      prompt: 'In one line: why can a 200 B request fail when more than half the heap is free?',
      model:
        'The free bytes are split into five holes, four of 104 B and the 192 B tail, with live blocks between them. A request needs one contiguous hole, so only the largest hole counts. That gap between free bytes and usable bytes is external fragmentation.',
      ideas: [
        'The free bytes are scattered in holes separated by live blocks',
        'A request needs a single contiguous hole, so only the largest hole counts',
        'The meter divides the largest hole by all free bytes, so scattered holes drag it down',
      ],
    },
    note: 'With 608 B free in five holes, the largest being 192 B, a 200 B malloc (208 B with its header) fails. Try it by hand. Coalescing cannot help here: no two holes touch, because live blocks sit between them.',
    phone: { canonical: 'allocator.frag-first-fit' },
    lessons: ['t1.l4'],
    legacyId: 't-frag',
  },
  {
    id: 'alloc.coalesce-recover',
    simId: 'sim-allocator',
    machine: 'allocator',
    kind: 'outcome',
    title: 'Heal a hole by freeing between two free blocks',
    setup: 'Under Task scripts, load "Heal the middle" (coalescing stays on), then play or step it to the end.',
    kcs: [KC.splitCoalesce],
    predict: {
      kind: 'numeric',
      prompt:
        'The script mallocs eight 96 B blocks (8 B header each), frees blocks 1, 3, 5 and 7, then frees block 4. With coalescing on, how many bytes is the largest free block at the end?',
      unit: 'B',
      tolerance: { abs: 8 },
    },
    observe: 'alloc.largest-free',
    explain: {
      prompt: 'In one line: what happens to a block that is freed between two free blocks?',
      model:
        'Block 4 had free neighbours on both sides (blocks 3 and 5), so the free fuses all three 104 B blocks, headers included, into one 312 B block. Without coalescing it would stay a separate 104 B hole and the largest block would remain the 192 B tail.',
      ideas: [
        'A freed block merges with a free neighbour on each side',
        'Merging reclaims the neighbours\' headers: 3 × 104 B = 312 B',
        'Without coalescing the holes stay apart and the largest stays at the tail',
      ],
    },
    note: 'Switch coalescing off, load the script again and run it: the largest block stays at 192 B, because freed neighbours are never merged. Coalescing is what turns freed neighbours back into one large block.',
    phone: { canonical: 'allocator.coalesce-recover' },
    lessons: ['t1.l3'],
    legacyId: 't-coalesce',
  },
  {
    id: 'alloc.fixed-block-waste',
    simId: 'sim-allocator',
    machine: 'allocator',
    kind: 'outcome',
    title: 'Price the fixed-block trade',
    setup: 'Under Task scripts, load "Fixed 64 B blocks, eight requests", then play or step it to the end.',
    kcs: [KC.fixedBlocks],
    predict: {
      kind: 'numeric',
      prompt:
        'The script switches to fixed 64 B blocks and mallocs 20, 33, 64, 50, 17, 41, 9 and 60 B. Each request takes one whole block. How many bytes sit unused inside the blocks at the end?',
      unit: 'B',
      tolerance: { rel: 0.05 },
    },
    observe: 'alloc.fixed-waste',
    explain: {
      prompt: 'In one line: what does a fixed block buy, and what does it cost?',
      model:
        'Every request rounds up to a whole 64 B block, so the leftover sits inside the block (218 B here) instead of between blocks. Equal blocks leave no odd-sized holes, so external fragmentation is 0, at the price of up to 63 B of internal waste per block.',
      ideas: [
        'Each request rounds up to a whole block, so the waste sits inside it',
        'Equal blocks leave no unusable holes between them: external fragmentation is 0',
        'The waste per block is bounded by the block size minus one',
      ],
    },
    note: 'The eight requests held 294 B but used 512 B: 218 B of internal waste. That is the PagedAttention trade, a small bounded waste inside every block in return for no external fragmentation. Try block sizes from 16 B to 256 B and watch the waste and the number of blocks move in opposite directions.',
    phone: { canonical: 'allocator.fixed-block-waste' },
    lessons: ['t1.l4'],
    legacyId: 't-paged',
  },
  {
    id: 'alloc.policy-race',
    simId: 'sim-allocator',
    machine: 'allocator',
    kind: 'outcome',
    title: 'Race first-fit against best-fit',
    setup:
      'Set the placement strategy to first-fit, load "Two holes, two requests" under Task scripts, and play or step it to the end. Then repeat under best-fit.',
    kcs: [KC.placementPolicy],
    predict: {
      kind: 'numeric',
      prompt:
        'A full heap has two free holes, 300 B and 120 B with their headers. The script mallocs 100 B and then 280 B (8 B header each). Under first-fit, how many bytes are free at the end?',
      unit: 'B',
      tolerance: { abs: 8 },
    },
    observe: 'alloc.race-first',
    explain: {
      prompt: 'In one line: why did first-fit strand memory that best-fit would have used?',
      model:
        'First-fit put the 100 B request in the 300 B hole, the first one it saw, leaving 192 B and 120 B. The 280 B request needs 288 B in one piece, so it failed with 312 B free. Best-fit would have used the snug 120 B hole and kept the 300 B hole whole.',
      ideas: [
        'First-fit takes the first hole that fits, even a much bigger one',
        'Splitting the big hole left no hole large enough for the big request',
        'Best-fit uses the smallest hole that fits and keeps the large hole intact',
      ],
    },
    note: 'Under best-fit the same script serves both requests and ends with 0 B free. On long traces the policies differ far less: replay the 1,000-op alternating trace and first-, next- and best-fit fail 48, 48 and 49 allocations. A policy changes which holes you keep, not whether a churning heap fragments.',
    phone: { canonical: 'allocator.policy-race' },
    lessons: ['t1.l3'],
    legacyId: 't-trace-lab',
  },
]

/** The pre-registry tasks, under their old ids. The sim still detects them, and they pay 0 XP (§8.4). */
const legacy = (id: string, title: string): SimTaskDef => ({
  id,
  simId: 'sim-allocator',
  machine: 'allocator',
  kind: 'legacy',
  title,
  setup: title,
  kcs: [],
})

export const ALLOCATOR_LEGACY_TASKS: SimTaskDef[] = [
  legacy('t-frag', 'Fragment the heap below 25% (largest free / total free)'),
  legacy('t-coalesce', 'Enable coalescing and recover above 75%'),
  legacy('t-paged', 'Observe a fixed-block trace report 0% external fragmentation'),
  legacy('t-quiz', 'Explain the observed internal-for-external fragmentation trade'),
  legacy('t-trace-lab', 'Run a long trace and compare placement policies'),
  legacy('t-double-free', 'Trigger the inspector double-free alias demonstration'),
]
