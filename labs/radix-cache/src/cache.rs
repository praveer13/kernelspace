//! cache.rs — forge lab 07 · THE ONLY FILE YOU EDIT
//!
//! Mission: automatic prefix caching over token-id sequences. The harness
//! gives you lab 02's refcounted BlockAllocator. You build the policy above
//! it: longest-prefix lookup, immutable shared prefixes, and leaf-only LRU.
//!
//! A compact radix tree is the intended data structure, but the checks grade
//! observable invariants rather than private field names:
//!
//!   * match_prefix returns the LONGEST token prefix represented by any
//!     cached sequence, plus the physical blocks covering that prefix.
//!   * insert takes a completed prefill's blocks. Reuse canonical blocks for
//!     every whole shared block; retain exactly one cache reference to each
//!     chosen block. A divergent partial tail must stay private (CoW).
//!   * an exact duplicate is a touch, not a second cache entry.
//!   * evict_lru considers terminal LEAVES only. An entry that is a proper
//!     prefix of another cached entry is an internal node and is ineligible.
//!   * a leaf is pinned when any block has owners outside the cache. Compare
//!     BlockAllocator::refcount with the number of cache entries referencing
//!     that block. Skip pinned leaves.
//!   * release every evicted entry's block table. Refcount zero returns the
//!     physical block to the pool automatically.
//!
//! All mutations must be all-or-nothing. Check 4 runs 2,000 operations and
//! drains the cache afterward; one leaked retain eventually starves the pool.
//!
//! Build it in four stages. Each one turns specific checks green. Go in
//! order: a later stage reuses what an earlier one built. Look for the
//! `STAGE` markers below; the signatures never change.
//!
//!   STAGE 1  exact_match                    `new`, `insert`, `match_prefix`,
//!                                           `entry_count` for one prompt
//!   STAGE 2  longest_prefix                 the deepest cached ancestor wins
//!   STAGE 3  eviction_order, cow_divergence `evict_lru` on leaves only and
//!                                           the entry limit in `insert`; a
//!                                           shared block, a private tail
//!   STAGE 4  block_conservation,            2,000 operations and a drain; a
//!            chat_hit_rate                  hit rate over 240 chat requests
//!
//! Check a stage on your machine with `cargo test <check id>`, for example
//! `cargo test exact_match`. A `todo!()` traps only the checks that reach it.
//!
//! Which check catches which mistake:
//!
//! ```text
//!   exact_match         a retain taken twice (the block refcount is 2, not
//!                       1); an exact duplicate stored as a second entry
//!   longest_prefix      the first branch that shares any prefix, instead of
//!                       the deepest cached ancestor
//!   eviction_order      a lookup that does not make an entry hot; the
//!                       hottest leaf evicted instead of the coldest; a leaf
//!                       with an outside owner evicted; a prefix that has a
//!                       descendant evicted before it; an entry limit that
//!                       is never enforced (it stores a fourth entry into a
//!                       cache that holds three)
//!   block_conservation  a retain without its release (a leak), a release
//!                       twice, an eviction that forgets to release the
//!                       block table, over 2,000 operations and a drain
//!   cow_divergence      a partial tail shared with the writer that diverges,
//!                       or a whole prefix block copied instead of shared
//!   chat_hit_rate       a lookup that hits only when a whole cached entry is
//!                       a prefix of the query: the savings are in the
//!                       partial prefix that every request shares
//! ```

use crate::block_pool::BlockAllocator;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrefixMatch {
    pub len: usize,
    pub blocks: Vec<usize>,
}

pub struct RadixCache {
    // TODO(you): radix nodes / entries, allocator handle, logical clock.
    // Stage 1 needs the entries and the pool; stage 3 adds the clock.
    _pool: BlockAllocator,
    _max_entries: usize,
}

impl RadixCache {
    // STAGE 1 · exact_match
    //   Keep the pool handle, the limit and an empty set of entries.
    pub fn new(pool: BlockAllocator, max_entries: usize) -> Self {
        let _ = (pool, max_entries);
        todo!("construct the radix cache")
    }

    // STAGE 1 · exact_match
    //   Return the whole prompt's length and the blocks that cover it.
    // STAGE 2 · longest_prefix
    //   Walk to the deepest cached ancestor and return its blocks, not the
    //   first branch that matches. No match at all is len 0 and no blocks.
    // STAGE 3 · eviction_order
    //   A hit refreshes the entry's recency.
    pub fn match_prefix(&mut self, tokens: &[u32]) -> PrefixMatch {
        let _ = tokens;
        todo!("walk the radix tree and return the longest cached prefix")
    }

    // STAGE 1 · exact_match
    //   Retain the table the cache keeps exactly once. An exact duplicate is a
    //   touch, not a second entry.
    // STAGE 3 · eviction_order
    //   At the entry limit, make room first: evict the coldest leaf before
    //   the new entry goes in. The check inserts a fourth entry into a cache
    //   that holds three.
    // STAGE 3 · cow_divergence
    //   Reuse the canonical block for every whole shared block; a divergent
    //   partial tail stays private.
    // STAGE 4 · block_conservation
    //   Leave nothing half-applied: a failed insert must not keep a retain.
    /// Insert one completed prompt. `blocks` is a temporary prefill-owned
    /// full block table; retain the canonical table the cache will own.
    pub fn insert(&mut self, tokens: &[u32], blocks: &[usize]) -> bool {
        let _ = (tokens, blocks);
        todo!("share full prefix blocks, CoW the partial tail, insert a leaf")
    }

    // STAGE 3 · eviction_order
    //   Leaves only, coldest first, and skip a leaf whose blocks have owners
    //   outside the cache. Release the evicted table once.
    /// Evict the coldest unpinned terminal leaf. Return false when no leaf
    /// is eligible (empty cache or every leaf still has an outside owner).
    pub fn evict_lru(&mut self) -> bool {
        todo!("find the oldest eligible leaf and release its block table")
    }

    // STAGE 1 · exact_match
    pub fn entry_count(&self) -> usize {
        todo!("return the number of terminal cache entries")
    }
}
