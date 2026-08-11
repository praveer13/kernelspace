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

use crate::block_pool::BlockAllocator;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrefixMatch {
    pub len: usize,
    pub blocks: Vec<usize>,
}

pub struct RadixCache {
    // TODO(you): radix nodes / entries, allocator handle, logical clock.
    _pool: BlockAllocator,
    _max_entries: usize,
}

impl RadixCache {
    pub fn new(pool: BlockAllocator, max_entries: usize) -> Self {
        let _ = (pool, max_entries);
        todo!("construct the radix cache")
    }

    pub fn match_prefix(&mut self, tokens: &[u32]) -> PrefixMatch {
        let _ = tokens;
        todo!("walk the radix tree and return the longest cached prefix")
    }

    /// Insert one completed prompt. `blocks` is a temporary prefill-owned
    /// full block table; retain the canonical table the cache will own.
    pub fn insert(&mut self, tokens: &[u32], blocks: &[usize]) -> bool {
        let _ = (tokens, blocks);
        todo!("share full prefix blocks, CoW the partial tail, insert a leaf")
    }

    /// Evict the coldest unpinned terminal leaf. Return false when no leaf
    /// is eligible (empty cache or every leaf still has an outside owner).
    pub fn evict_lru(&mut self) -> bool {
        todo!("find the oldest eligible leaf and release its block table")
    }

    pub fn entry_count(&self) -> usize {
        todo!("return the number of terminal cache entries")
    }
}
