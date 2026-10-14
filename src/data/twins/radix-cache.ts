import { KC } from '@/data/kc/ids'
import type { TwinItem, TwinModule } from './types'

/**
 * Lab 07 against SGLang's Rust radix-tree core (docs/specs/wave-3.md §9, task 3b-15). The claim `twin.sglang.treecore`
 * pins sgl-project/sglang at v0.5.21; every statement below was read in these files at that tag:
 *   rust/sglang-radix-tree/src/unified_tree_core.rs   match_prefix / match_prefix_helper_ / match_post_processor_,
 *                                                      insert / insert_walk_step_ / insert_commit_step_, split_node_,
 *                                                      evict_device_next_node, is_evictable_device_leaf_, CacheInitParams::default
 *   rust/sglang-radix-tree/src/node.rs                 ChildKeyType::match_len (page-quantised common prefix)
 *   rust/sglang-radix-tree/src/components/full.rs      FullComponent::evict_device_start / evict_device_next_node (the heap)
 *   rust/sglang-radix-tree/src/components/mod.rs       update_component_on_insert_overlap (default: returns prefix_len)
 *   rust/sglang-radix-tree/src/unified_lru_list.rs     LruStrategy::get_priority (PriorityKey(last_access_counter, 0))
 * Each answer is also derived by hand in tests/forge/twins-content.test.ts, from a small model of those paths, and
 * agrees with the crate's own tests (match_prefix_splits_on_a_partial_match, match_prefix_page_aligns_the_query,
 * insert_splits_on_a_partial_overlap, split_copies_stats_and_restamps_the_child).
 *
 * The lab's cache is a toy of this structure: refcounted blocks, a lookup that refreshes recency but never reshapes
 * the tree, whole-entry eviction. The questions are the three places where the production code differs in a way the
 * lab's checks would not catch.
 *
 * Authoring rules from verify:items (the twin pool's own bar): the key is never the longest option (the pool's baseline
 * allows none), key lengths spread over ranks 2, 3 and 4, and no option carries a colon, a reason connective or a
 * parenthesis, so no binary feature isolates the key.
 */

const q1: TwinItem = {
  id: 'lab07.twin.1',
  kcs: ['t5.prefix-cache-keys', 't5.radix-eviction'],
  q: {
    q: "SGLang's Rust tree core runs with 2-token pages (page_size = 2). It holds one cached request, tokens [1,2,3,4,5,6], as a single node under the root. A new request calls match_prefix on [1,2,3,9]. What does the call return, and what does the tree look like afterwards?",
    options: [
      'It returns the KV of tokens 1, 2 and 3, splits the node at 3 into [1,2,3] and [4,5,6], and ends the match at the new [1,2,3] node',
      'It returns the KV of tokens 1 and 2, splits the node at 2 into [1,2] and [3,4,5,6], and ends the match at the new [1,2] node',
      'It returns the KV of tokens 1 and 2, leaves the tree untouched, and ends the match at the original [1,2,3,4,5,6] node',
      'It returns nothing and leaves the tree untouched, as [1,2,3,9] is not a prefix of the cached [1,2,3,4,5,6] and that node does not match',
    ],
    correct: [1],
    why: [
      'KV is stored per token, but the tree is page-granular. match_len counts 3 equal tokens and rounds down to a multiple of page_size, giving 2, and split_node_ asserts that its split length is a nonzero page multiple. A page the query matches half of is not shared.',
      "Right. match_prefix_helper_ finds the child by the page [1,2]; match_len counts 3 equal tokens and rounds down to 2 (3 / 2 * 2), less than the node's 6-token key. So the walk calls split_node_(child, 2), pushes the new head node's 2 KV indices and stops. The lookup itself reshapes the tree.",
      "The count is right, the tree is not. When the common length is shorter than the node's key, match_prefix_helper_ calls split_node_ during the lookup itself and ends the match at the new head node. The lab's lookup makes the entry it hits hot, which changes recency but never the tree's structure. The core's lookup changes the structure too.",
      "Matching is by shared prefix, not by whole entries. The walk goes down an edge for as long as the tokens agree, so a query that is only partly a prefix of a cached request still hits its shared part. A lookup that hits when a whole entry is a prefix is the lab's chat_hit_rate failure.",
    ],
  },
}

const q2: TwinItem = {
  id: 'lab07.twin.2',
  kcs: [KC.blockRefcounts, 't5.prefix-cache-keys'],
  q: {
    q: 'The tree core has page_size 1 and holds [1,2,3,4] in KV slots 10, 11, 12 and 13. A new request, [1,2,5,6], has just prefilled into its own slots 20, 21, 22 and 23. It matched nothing earlier, so insert gets prev_prefix_len = 0. Which slots does the tree hold after insert, and what does insert hand back?',
    options: [
      'The tree holds 10, 11, 12, 13, 22 and 23, and insert hands back 20 and 21 as duplicates for the caller to free',
      'The tree holds 10, 11, 12, 13, 22 and 23, but slots 20 and 21 stay allocated to the request until it finishes, as a second reference to the shared tokens',
      'The tree holds 20, 21, 22 and 23 for the new path and 12 and 13 for the old leaf, and insert hands back 10 and 11 as the stale copy of the prefix',
      'The tree holds eight slots, with [1,2,5,6] as a second leaf under the root on slots 20 to 23, and nothing is shared or freed',
    ],
    correct: [0],
    why: [
      "Right. insert_walk_step_ splits [1,2,3,4] at 2 and finds [1,2] already cached, so the request's slots 20 and 21 for those tokens are duplicates. They leave in CacheAction::FreeDeviceKV (the window starts at prev_prefix_len minus the cursor, 0). insert_commit_step_ then hangs a new leaf [5,6] on the split node with slots 22 and 23. A cached slot has one owner, the tree, and its lock count guards it from eviction.",
      "That is the lab's refcount design: a second reference keeps the request's table alive next to the cached one. The core frees the duplicate at once instead (FreeDeviceKV), because the cached node already holds KV for those tokens and the tree is the one owner of a cached slot.",
      "The cached node keeps its original KV. update_component_on_insert_overlap returns prefix_len, the whole overlap, so the duplicate is cut from the new request's value slice, never from the node already in the tree. Nothing in insert swaps newer KV into a cached node.",
      "insert is a radix insert. The walk finds the cached child on the page [1], splits it at the common length and shares [1,2]; it does not add a second root edge. Keeping slots 20 and 21 as well would cache two copies of the same prefix KV.",
    ],
  },
}

const q3: TwinItem = {
  id: 'lab07.twin.3',
  kcs: ['t5.radix-eviction'],
  q: {
    q: "The tree core has page_size 1, its default eviction policy (lru) and no locks. In order: insert [1,2,3,4], insert [7,8], then match_prefix([1,2,9]). The cache now needs room and starts a device eviction walk. Which node does evict_device_next_node return first?",
    options: [
      'The leaf [3,4], the coldest one, as no lookup read any of its tokens and its stamp is older than that of the leaf [7,8]',
      'The node [1,2], the least recently used node, as the split created it before the leaf [7,8] was last touched by anything',
      'Both [1,2] and [3,4] together, as the cached request [1,2,3,4], with eviction taking a whole request at a time',
      "The leaf [7,8], with [3,4] restamped newer by the lookup's split and [1,2] not a leaf",
    ],
    correct: [3],
    why: [
      "That would hold if the split left the remainder's stamp alone, but split_node_ takes a new tick from get_and_bump_access_counter and gives it to [3,4]. The lookup's own restamp covers [1,2] and the root, yet the split has already made [3,4] newer than [7,8].",
      "The walk's heap is filled from evictable_device_leaves only, and [1,2] has a child with a device value, so is_evictable_device_leaf_ is false for it. Its stamp is also the newest in the tree, because match_post_processor_ restamped the matched path. An internal node can be a candidate only after its children are gone.",
      "Eviction works on nodes, one leaf at a time: evict_device_leaf asserts that the node is a D-leaf and frees only that node's KV, and [1,2] stays while it has a child. A cached request is a path of nodes, not one entry.",
      "Right. split_node_ stamps the remainder [3,4] with a new tick, so after the lookup it is newer than [7,8]. The walk pops the lowest PriorityKey(last_access_counter) among the evictable leaves, [3,4] and [7,8], and that is [7,8]. [1,2] is no candidate while [3,4] hangs under it.",
    ],
  },
}

/** The three questions, in play order; verify:items reads this list for the `twin` pool. */
export const TWIN_ITEMS: TwinItem[] = [q1, q2, q3]

const twin: TwinModule = {
  labId: 'radix-cache',
  labNo: '07',
  claimId: 'twin.sglang.treecore',
  path: 'rust/sglang-radix-tree/src/unified_tree_core.rs',
  symbols: ['match_prefix', 'split_node_', 'insert', 'evict_device_next_node'],
  youWrote: 'You just wrote the structure SGLang made its default on 2026-09-29: its Rust radix-tree core is now the default behind prefix lookup, insert and eviction. Trace three of them.',
  items: TWIN_ITEMS,
}

export default twin
