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
//!
//! Build it in four stages. Each one turns specific checks green, and each is
//! at most 25 minutes. Go in order: a later stage reuses what an earlier one
//! built. Look for the `STAGE` markers below; the signatures never change.
//!
//!   STAGE 1  paging                         ≈ 2 min    `new`, `allocate`,
//!                                                      `translate`, `free_blocks`
//!   STAGE 2  capacity                       ≈ 10 min   all-or-nothing
//!                                                      `allocate`; `free`
//!   STAGE 3  fork_shares, free_refcount     ≈ 20 min   refcounts; `fork`;
//!                                                      `free` decrements
//!   STAGE 4  cow, gauntlet                  ≈ 25 min   `append` and the copy
//!                                                      on a shared tail
//!   STAGE 5  adapter_unified_paging         optional   after T6.L9; never
//!                                                      blocks completion
//!
//! Check a stage on your machine with `cargo test <check id>`, for example
//! `cargo test paging`. Stage 1 never calls `free`, `fork` or `append`, so
//! leave those as `todo!` until their stage: a `todo!()` traps only the
//! checks that reach it.
//!
//! Which check catches which mistake:
//!
//! ```text
//!   paging          a ceil that rounds down (20 tokens in 1 block), or a
//!                   translate with no bound (token 20 of a 20-token
//!                   sequence still answers)
//!   capacity        an allocate that succeeds on a full pool, one that fails
//!                   but still changes state, or a free that never recycles
//!   fork_shares     a fork that copies blocks instead of the table
//!   free_refcount   a free that returns a block another sequence still uses
//!                   (and a free that forgets to return it at refcount 0)
//!   cow             an append into a shared tail that writes through it, or
//!                   a copy that moves the parent's tail
//!   gauntlet        what the five above miss: an allocate or append that
//!                   takes blocks before it fails, a copy-on-write that
//!                   forgets to drop the shared block's refcount, any leak or
//!                   double free. 2,000 seeded ops, conservation after each
//! ```
//!
//! The first five run one scenario each, so a green stage 3 does not mean the
//! gauntlet passes: the gauntlet interleaves every operation.
//!
//! Optional advanced extension (T6.L9): treat LoRA adapter weights as paged
//! objects in the SAME physical pool. `load_adapter` reserves whole pages,
//! `adapter_page` exposes its table, and `unload_adapter` returns the pages.
//! The default methods below fail closed so the original six-check lab still
//! completes; replace them only after the core manager is green.

#[allow(unused_imports)]
// used by the intended solution shape; template still builds warning-free
use std::collections::HashMap;

pub struct BlockManager {
    // TODO(you): your state here. Stage 1 needs `block_size`, the pool and
    // the tables; stage 3 adds a refcount per physical block.
    _priv: (),
}

impl BlockManager {
    // STAGE 1 · paging · ≈ 2 min
    //   Keep `block_size`, a pool of `num_blocks` free physical ids, and a
    //   table per sequence. Nothing is shared yet.
    pub fn new(num_blocks: usize, block_size: usize) -> Self {
        let _ = (num_blocks, block_size);
        todo!("construct your block manager")
    }

    // STAGE 1 · paging
    //   blocks = ceil(tokens / block_size); take that many ids off the pool
    //   and store them as the sequence's table, with its length.
    // STAGE 2 · capacity · ≈ 10 min
    //   Check the pool covers `blocks` BEFORE you take any. A refusal must
    //   leave the pool and every table exactly as they were.
    // STAGE 3 · fork_shares, free_refcount
    //   Each block you hand out starts at refcount 1.
    pub fn allocate(&mut self, seq: u32, tokens: usize) -> bool {
        let _ = (seq, tokens);
        todo!("ceil(tokens/block_size) blocks, all-or-nothing")
    }

    // STAGE 4 · cow, gauntlet · ≈ 25 min
    //   Work out every block the append needs first (a copy of a shared
    //   partial tail, plus whole new blocks for the rest), fail with no
    //   change if the pool cannot cover them, then apply. When you copy a
    //   shared tail: take a fresh block, put it in THIS table only, and
    //   refcount-- the shared one. The parent's table never changes.
    pub fn append(&mut self, seq: u32, n: usize) -> bool {
        let _ = (seq, n);
        todo!("CoW the shared partial tail, then grow")
    }

    // STAGE 3 · fork_shares · ≈ 20 min
    //   Clone the table and the length, refcount++ every block, take
    //   nothing from the pool. False if `src` is missing or `dst` exists.
    pub fn fork(&mut self, src: u32, dst: u32) -> bool {
        let _ = (src, dst);
        todo!("copy the table, refcount++ every block, allocate nothing")
    }

    // STAGE 2 · capacity
    //   Until stage 3 every block has one owner, so freeing a sequence
    //   returns all of its blocks to the pool.
    // STAGE 3 · free_refcount
    //   refcount-- on each block of the table; only a block that reaches 0
    //   goes back to the pool. Unknown ids are a no-op.
    pub fn free(&mut self, seq: u32) {
        let _ = seq;
        todo!("refcount--; return blocks at zero")
    }

    // STAGE 1 · paging
    //   table[token / block_size], or None when `token` is at or past the
    //   sequence length (the last block is usually partial) or the
    //   sequence is unknown.
    pub fn translate(&self, seq: u32, token: usize) -> Option<usize> {
        let _ = (seq, token);
        todo!("block table lookup: table[token / block_size]")
    }

    // STAGE 1 · paging
    //   How many ids are in the pool right now.
    pub fn free_blocks(&self) -> usize {
        todo!("blocks currently in the pool")
    }

    /// OPTIONAL(advanced): reserve `pages` blocks for one LoRA adapter from
    /// the same free pool used by sequence KV. Duplicate ids, zero pages,
    /// and insufficient capacity return false without changing state.
    pub fn load_adapter(&mut self, adapter: u32, pages: usize) -> bool {
        let _ = (adapter, pages);
        false
    }

    /// OPTIONAL(advanced): release every page owned by this adapter. Unknown
    /// ids are a no-op, matching `free(seq)`.
    pub fn unload_adapter(&mut self, adapter: u32) {
        let _ = adapter;
    }

    /// OPTIONAL(advanced): physical page id at the adapter's logical index.
    pub fn adapter_page(&self, adapter: u32, page: usize) -> Option<usize> {
        let _ = (adapter, page);
        None
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
