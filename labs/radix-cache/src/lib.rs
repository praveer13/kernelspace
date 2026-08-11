//! radix-cache — forge lab 07.
//!
//! Automatic Prefix Caching, from block pool to router signal. The harness
//! owns lab 02's allocator; you own the radix policy above it. Every prompt
//! is an exact token-id sequence. Cache hits return the longest reusable
//! prefix, insertions share full blocks and copy-on-write a divergent
//! partial tail, and memory pressure evicts the coldest unpinned leaf.
//!
//! ┌───────────────────────────────────────────────────────────────┐
//! │  YOU EDIT:   src/cache.rs      (the only file with TODO(you)) │
//! │  DO NOT EDIT lib.rs/block_pool.rs — allocator + six checks.   │
//! └───────────────────────────────────────────────────────────────┘
//!
//! Ownership at the insert boundary:
//!   1. The harness allocates a temporary block table (prefill owns ref=1).
//!   2. cache.insert chooses canonical shared-prefix blocks and retains the
//!      table it will own.
//!   3. The harness releases the temporary table. Unused fresh prefix
//!      blocks return immediately; cached suffix blocks remain at ref=1.
//!
//! That protocol is the lab 02 manager API, imported as infrastructure.

mod block_pool;
mod cache;

use block_pool::BlockAllocator;
use cache::{PrefixMatch, RadixCache};
use kslab::{Check, Report};

const BS: usize = 16;

/* --------------------------- determinism ---------------------------- */

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

fn tokens(start: u32, len: usize) -> Vec<u32> {
    (0..len).map(|i| start + i as u32).collect()
}

/// Prefill a full prompt, evicting leaves until the physical pool can fit
/// it; insert; then release the temporary prefill owner.
fn store(cache: &mut RadixCache, pool: &BlockAllocator, prompt: &[u32]) -> bool {
    loop {
        if let Some(fresh) = pool.allocate_for_tokens(prompt.len()) {
            let inserted = cache.insert(prompt, &fresh);
            let released = pool.release(&fresh);
            return inserted && released;
        }
        if !cache.evict_lru() {
            return false;
        }
    }
}

fn miss() -> PrefixMatch {
    PrefixMatch {
        len: 0,
        blocks: Vec::new(),
    }
}

/* ------------------------------ checks ------------------------------ */

/// 1. Exact request returns the complete token length and stable block ids.
pub fn check_exact_match() -> Check {
    const ID: &str = "exact_match";
    const LABEL: &str = "exact-match hit returns the full cached block table";
    let pool = BlockAllocator::new(24, BS);
    let mut cache = RadixCache::new(pool.clone(), 8);
    let prompt = tokens(100, 40);
    if !store(&mut cache, &pool, &prompt) {
        return Check::fail(ID, LABEL, "could not insert into an empty cache");
    }
    let first = cache.match_prefix(&prompt);
    let second = cache.match_prefix(&prompt);
    if first.len != prompt.len() || first.blocks.len() != 3 {
        return Check::fail(
            ID,
            LABEL,
            format!(
                "40 tokens should hit exactly across 3 blocks, got len={} blocks={:?}",
                first.len, first.blocks
            ),
        );
    }
    if first != second {
        return Check::fail(
            ID,
            LABEL,
            "repeating an exact lookup changed the block table",
        );
    }
    if first.blocks.iter().any(|&b| pool.refcount(b) != 1) {
        return Check::fail(ID, LABEL, "after prefill release, an unshared cache entry must own exactly one reference per block");
    }
    Check::pass(
        ID,
        LABEL,
        "40/40 tokens hit; the same three physical blocks returned",
    )
}

/// 2. A query follows the deepest cached ancestor, not the first branch.
pub fn check_longest_prefix() -> Check {
    const ID: &str = "longest_prefix";
    const LABEL: &str = "longest cached ancestor wins";
    let pool = BlockAllocator::new(48, BS);
    let mut cache = RadixCache::new(pool.clone(), 12);
    let system = tokens(1_000, 32);
    let mut document = system.clone();
    document.extend(tokens(2_000, 16));
    let mut other_branch = system.clone();
    other_branch.extend(tokens(3_000, 12));
    if !store(&mut cache, &pool, &system)
        || !store(&mut cache, &pool, &document)
        || !store(&mut cache, &pool, &other_branch)
    {
        return Check::fail(ID, LABEL, "setup inserts failed");
    }
    let mut query = document.clone();
    query.extend(tokens(9_000, 11));
    let hit = cache.match_prefix(&query);
    if hit.len != document.len() || hit.blocks.len() != 3 {
        return Check::fail(
            ID,
            LABEL,
            format!(
                "expected the 48-token document ancestor, got len={} blocks={:?}",
                hit.len, hit.blocks
            ),
        );
    }
    let unknown = tokens(77_000, 20);
    if cache.match_prefix(&unknown) != miss() {
        return Check::fail(
            ID,
            LABEL,
            "an unrelated token sequence reported a cache hit",
        );
    }
    Check::pass(
        ID,
        LABEL,
        "48-token child beat its 32-token ancestor; unrelated input missed",
    )
}

/// 3. LRU is updated by hits; internal prefixes and externally pinned
/// leaves are not eviction candidates.
pub fn check_eviction_order() -> Check {
    const ID: &str = "eviction_order";
    const LABEL: &str = "leaf LRU respects recency and live pins";

    // Ordinary LRU: touch A, so inserting D evicts B.
    let pool = BlockAllocator::new(32, BS);
    let mut cache = RadixCache::new(pool.clone(), 3);
    let (a, b, c, d) = (
        tokens(10, 16),
        tokens(100, 16),
        tokens(200, 16),
        tokens(300, 16),
    );
    if !store(&mut cache, &pool, &a)
        || !store(&mut cache, &pool, &b)
        || !store(&mut cache, &pool, &c)
    {
        return Check::fail(ID, LABEL, "LRU setup failed");
    }
    cache.match_prefix(&a); // A becomes hottest.
    if !store(&mut cache, &pool, &d) {
        return Check::fail(ID, LABEL, "insert D failed at the entry limit");
    }
    if cache.match_prefix(&b).len != 0
        || cache.match_prefix(&a).len != a.len()
        || cache.match_prefix(&c).len != c.len()
        || cache.match_prefix(&d).len != d.len()
    {
        return Check::fail(
            ID,
            LABEL,
            "entry-limit eviction did not remove the coldest leaf B",
        );
    }

    // Pin the now-oldest C with an outside owner. The eviction must skip it.
    let c_blocks = cache.match_prefix(&c).blocks;
    if !pool.retain(&c_blocks) {
        return Check::fail(ID, LABEL, "could not create an external pin");
    }
    // Touch A and D after C, making C oldest while pinned.
    cache.match_prefix(&a);
    cache.match_prefix(&d);
    if !cache.evict_lru() {
        return Check::fail(
            ID,
            LABEL,
            "no leaf was evicted while one unpinned candidate existed",
        );
    }
    if cache.match_prefix(&c).len != c.len() {
        return Check::fail(ID, LABEL, "evicted C while its blocks had an outside owner");
    }
    if !pool.release(&c_blocks) {
        return Check::fail(ID, LABEL, "failed to release the test pin");
    }

    // A terminal prefix with a child is an internal node, never a leaf.
    let pool2 = BlockAllocator::new(32, BS);
    let mut tree = RadixCache::new(pool2.clone(), 3);
    let base = tokens(5_000, 32);
    let mut child = base.clone();
    child.extend(tokens(6_000, 16));
    let side = tokens(7_000, 16);
    let newcomer = tokens(8_000, 16);
    if !store(&mut tree, &pool2, &base)
        || !store(&mut tree, &pool2, &child)
        || !store(&mut tree, &pool2, &side)
    {
        return Check::fail(ID, LABEL, "leaf-protection setup failed");
    }
    tree.match_prefix(&child); // child hot; base remains oldest but internal.
    if !store(&mut tree, &pool2, &newcomer) {
        return Check::fail(ID, LABEL, "newcomer insert failed");
    }
    // Drop child; if an incorrect eviction removed base earlier, no exact
    // base entry remains after the child disappears.
    if !tree.evict_lru() || tree.match_prefix(&base).len != base.len() {
        return Check::fail(
            ID,
            LABEL,
            "an internal terminal prefix was evicted before its descendant",
        );
    }

    Check::pass(
        ID,
        LABEL,
        "touches update LRU; pins and internal ancestors are protected",
    )
}

/// 4. Two thousand mixed inserts/lookups/evictions, then a complete drain.
pub fn check_block_conservation() -> Check {
    const ID: &str = "block_conservation";
    const LABEL: &str = "2000-op churn conserves every physical block";
    const TOTAL: usize = 128;
    const MAX_ENTRIES: usize = 24;
    let pool = BlockAllocator::new(TOTAL, BS);
    let mut cache = RadixCache::new(pool.clone(), MAX_ENTRIES);
    let mut rng = Rng(0xCA_C4_E5);

    for op in 0..2_000usize {
        let family = rng.below(12) as u32;
        let mut prompt = tokens(10_000 + family * 1_000, 32);
        let tail_len = 8 + rng.below(49);
        prompt.extend((0..tail_len).map(|i| 100_000 + (op as u32) * 64 + i as u32));

        match rng.below(100) {
            0..=69 => {
                let _ = cache.match_prefix(&prompt);
                if !store(&mut cache, &pool, &prompt) {
                    return Check::fail(
                        ID,
                        LABEL,
                        format!("op {op}: cache could not make room for a small prompt"),
                    );
                }
            }
            70..=89 => {
                let _ = cache.match_prefix(&prompt);
            }
            _ => {
                let _ = cache.evict_lru();
            }
        }

        if cache.entry_count() > MAX_ENTRIES {
            return Check::fail(
                ID,
                LABEL,
                format!(
                    "op {op}: {} entries exceeds max {MAX_ENTRIES}",
                    cache.entry_count()
                ),
            );
        }
        if !pool.conserved() {
            return Check::fail(
                ID,
                LABEL,
                format!(
                    "op {op}: {} free + {} allocated != {TOTAL}",
                    pool.free_blocks(),
                    pool.allocated_blocks()
                ),
            );
        }
    }

    let mut drains = 0;
    while cache.entry_count() > 0 && drains <= MAX_ENTRIES + 1 {
        if !cache.evict_lru() {
            return Check::fail(
                ID,
                LABEL,
                "cache would not drain with no external owners — a retain leaked",
            );
        }
        drains += 1;
    }
    if cache.entry_count() != 0 || pool.free_blocks() != TOTAL || !pool.conserved() {
        return Check::fail(
            ID,
            LABEL,
            format!(
                "after drain: entries={} free={}/{} allocated={}",
                cache.entry_count(),
                pool.free_blocks(),
                TOTAL,
                pool.allocated_blocks()
            ),
        );
    }
    Check::pass(
        ID,
        LABEL,
        "2,000 operations + full drain returned all 128 blocks",
    )
}

/// 5. A branch can share whole prefix blocks but must copy a partial tail.
pub fn check_cow_divergence() -> Check {
    const ID: &str = "cow_divergence";
    const LABEL: &str = "divergent writer copy-on-writes a shared partial tail";
    let pool = BlockAllocator::new(24, BS);
    let mut cache = RadixCache::new(pool.clone(), 8);
    let base = tokens(30_000, 20); // one full block + a 4-token partial tail
    let mut branch = base.clone();
    branch.extend(tokens(40_000, 7));
    if !store(&mut cache, &pool, &base) || !store(&mut cache, &pool, &branch) {
        return Check::fail(ID, LABEL, "setup insert failed");
    }
    let base_hit = cache.match_prefix(&base);
    let branch_hit = cache.match_prefix(&branch);
    if base_hit.blocks.len() != 2 || branch_hit.blocks.len() != 2 {
        return Check::fail(
            ID,
            LABEL,
            "20- and 27-token entries must each have two blocks",
        );
    }
    if base_hit.blocks[0] != branch_hit.blocks[0] {
        return Check::fail(
            ID,
            LABEL,
            "the complete first prefix block was copied instead of shared",
        );
    }
    if base_hit.blocks[1] == branch_hit.blocks[1] {
        return Check::fail(
            ID,
            LABEL,
            "the divergent branch still aliases the partial tail — writer can corrupt sharer",
        );
    }
    if pool.allocated_blocks() != 3 {
        return Check::fail(
            ID,
            LABEL,
            format!(
                "expected 3 physical blocks (1 shared + 2 private tails), got {}",
                pool.allocated_blocks()
            ),
        );
    }
    Check::pass(
        ID,
        LABEL,
        "full block shared; partial tail split into two private CoW blocks",
    )
}

fn chat_prompt(family: usize, turn: usize) -> Vec<u32> {
    // 64 stable tokens stand in for policy + tool schema. The first user
    // token is request-unique, so cross-request reuse ends exactly there.
    let mut prompt = tokens(200_000 + family as u32 * 1_000, 64);
    prompt.extend((0..16).map(|i| 900_000 + turn as u32 * 32 + i as u32));
    prompt
}

/// 6. Replay a system-prompt-heavy chat trace. APC should skip most input
/// after the first request in each family.
pub fn check_chat_hit_rate() -> Check {
    const ID: &str = "chat_hit_rate";
    const LABEL: &str = "shared-system chat replay clears the KV-hit floor";
    const REQUESTS: usize = 240;
    let pool = BlockAllocator::new(128, BS);
    let mut cache = RadixCache::new(pool.clone(), 32);
    let mut hit_tokens = 0usize;
    let mut prompt_tokens = 0usize;

    for i in 0..REQUESTS {
        // Eight interleaved products/agents sharing their own 64-token
        // system+tool prefix — a realistic multi-tenant chat shape.
        let family = (i * 7 + i / 5) % 8;
        let prompt = chat_prompt(family, i);
        let hit = cache.match_prefix(&prompt);
        hit_tokens += hit.len;
        prompt_tokens += prompt.len();
        if !store(&mut cache, &pool, &prompt) {
            return Check::fail(
                ID,
                LABEL,
                format!("request {i}: cache could not admit the replay prompt"),
            );
        }
    }

    let rate = hit_tokens as f64 / prompt_tokens as f64;
    if rate < 0.65 {
        return Check::fail(
            ID,
            LABEL,
            format!("KV hit rate {:.1}% is below the 65% floor; longest-prefix reuse or LRU locality is broken", rate * 100.0),
        );
    }
    Check::pass(
        ID,
        LABEL,
        format!(
            "{:.1}% of prompt tokens reused across {REQUESTS} chat requests",
            rate * 100.0
        ),
    )
}

pub fn self_checks() -> Vec<Check> {
    vec![
        check_exact_match(),
        check_longest_prefix(),
        check_eviction_order(),
        check_block_conservation(),
        check_cow_divergence(),
        check_chat_hit_rate(),
    ]
}

#[no_mangle]
pub extern "C" fn ks_run(_in_ptr: u32, _in_len: u32) -> u64 {
    let report = Report {
        lab: "radix-cache",
        version: 1,
        checks: self_checks(),
    };
    kslab::emit(&report)
}
