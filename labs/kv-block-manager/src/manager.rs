//! manager.rs — forge lab 02 · THE ONLY FILE YOU EDIT
//!
//! Mission: vLLM's block manager, miniaturized. A fixed pool of physical
//! KV blocks; per-sequence block tables; fork() via refcounts; copy-on-write
//! when a shared tail is appended.
//!
//! Contract (enforced by the harness in src/lib.rs):
//!   * `new(num_blocks, block_size)` — `num_blocks` free physical blocks,
//!     each holding `block_size` tokens. Physical ids are 0..num_blocks.
//!   * `allocate(seq, tokens)`  — create a NEW sequence (false if it exists
//!     or tokens == 0). Needs ceil(tokens / block_size) blocks. false with
//!     NO state change if the pool can't cover it.
//!   * `append(seq, n)`         — grow by n tokens. If the partial tail
//!     block is shared (refcount > 1), copy-on-write first. All-or-nothing.
//!   * `fork(src, dst)`         — dst gets src's exact block table; every
//!     block's refcount++. Allocates NOTHING. false if src missing or dst
//!     exists.
//!   * `free(seq)`              — refcount-- on every block; a block returns
//!     to the pool only at refcount 0. Leaks fail the gauntlet.
//!   * `translate(seq, token)`  — physical block id for that token, or None
//!     if out of range / unknown seq.
//!   * `free_blocks()`          — blocks currently in the pool.
//!   * `dump()`                 — observability: emit your whole state in
//!     the line format the Fleet page parses (see the method's doc).
//!
//! Suggested shape:
//!
//!     free: Vec<usize>                 // physical ids in the pool
//!     refcounts: Vec<u32>              // per physical block
//!     tables: HashMap<u32, Vec<usize>> // seq id → block table
//!     lens: HashMap<u32, usize>        // seq id → token length
//!
//! The CoW trigger, precisely: the last block is PARTIAL (len % block_size
//! ≠ 0) AND its refcount > 1. A shared FULL block needs no copy — new
//! tokens land in a fresh block anyway.

use std::collections::HashMap;

pub struct BlockManager {
    // TODO(you): your state here.
    _priv: (),
}

impl BlockManager {
    pub fn new(num_blocks: usize, block_size: usize) -> Self {
        let _ = (num_blocks, block_size);
        todo!("construct your block manager")
    }

    pub fn allocate(&mut self, seq: u32, tokens: usize) -> bool {
        let _ = (seq, tokens);
        todo!("ceil(tokens/block_size) blocks, all-or-nothing")
    }

    pub fn append(&mut self, seq: u32, n: usize) -> bool {
        let _ = (seq, n);
        todo!("CoW the shared partial tail, then grow")
    }

    pub fn fork(&mut self, src: u32, dst: u32) -> bool {
        let _ = (src, dst);
        todo!("copy the table, refcount++ every block, allocate nothing")
    }

    pub fn free(&mut self, seq: u32) {
        let _ = seq;
        todo!("refcount--; return blocks at zero")
    }

    pub fn translate(&self, seq: u32, token: usize) -> Option<usize> {
        let _ = (seq, token);
        todo!("block table lookup: table[token / block_size]")
    }

    pub fn free_blocks(&self) -> usize {
        todo!("blocks currently in the pool")
    }

    /// Observability hook — the Fleet page (/fleet) renders your manager
    /// live from this output. You can't operate what you can't see.
    /// Exact format (the Fleet parses it):
    ///   capacity <num_blocks> <block_size>
    ///   free <count>
    ///   block <id> refs <n>          — one line per ALLOCATED block
    ///   seq <id> len <tokens> blocks <id,id,…>   — one line per sequence
    pub fn dump(&self) -> String {
        todo!("emit capacity/free/block/seq lines")
    }
}
