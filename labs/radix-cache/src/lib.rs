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
//!
//! Template v2: every check runs on its own, in a fresh copy of your module,
//! and a `todo!()` traps only the checks that reach it. The two gauntlets are
//! seeded: `block_conservation` (the 2,000-op churn) and `chat_hit_rate` (the
//! replay's family order) draw from the seed. `cargo test` runs them on their
//! default seeds and on 32 extra seeds, so a crate that is green here is green
//! on the site's fresh seeds too.
//!
//! Which check catches which mistake:
//!
//! ```text
//!   exact_match         a lookup that misses its own entry, or an exact
//!                       duplicate stored as a second entry
//!   longest_prefix      the first branch instead of the deepest ancestor
//!   eviction_order      a lookup that does not touch, an internal prefix
//!                       evicted before its descendant, a pinned leaf evicted
//!   block_conservation  a retain without its release (a leak), a release
//!                       twice, an entry limit that is not enforced
//!   cow_divergence      a partial tail shared with a writer that diverges, or
//!                       a whole prefix block copied instead of shared
//!   chat_hit_rate       lookups that hit only on a whole cached entry: the
//!                       savings are in the partial prefix every request shares
//! ```

mod block_pool;
mod cache;

use block_pool::BlockAllocator;
use cache::{PrefixMatch, RadixCache};
use kslab::{Check, CheckDef, Ctx, Lab, Rng};

const BS: usize = 16;

/// The checks, in grading order. Ids and labels match `src/data/labs.ts`;
/// stages are the F2 order of play (1 = the two-minute win).
pub static CHECKS: [CheckDef; 6] = [
    CheckDef { id: "exact_match", label: EXACT_MATCH, stage: 1, seeded: false, default_seed: 0, run: check_exact_match },
    CheckDef { id: "longest_prefix", label: LONGEST_PREFIX, stage: 2, seeded: false, default_seed: 0, run: check_longest_prefix },
    CheckDef { id: "eviction_order", label: EVICTION_ORDER, stage: 3, seeded: false, default_seed: 0, run: check_eviction_order },
    CheckDef { id: "block_conservation", label: BLOCK_CONSERVATION, stage: 4, seeded: true, default_seed: 0xCAC4E5, run: check_block_conservation },
    CheckDef { id: "cow_divergence", label: COW_DIVERGENCE, stage: 3, seeded: false, default_seed: 0, run: check_cow_divergence },
    CheckDef { id: "chat_hit_rate", label: CHAT_HIT_RATE, stage: 4, seeded: true, default_seed: 0xC4A7, run: check_chat_hit_rate },
];

#[cfg(not(feature = "reference"))]
const LAB_ID: &str = "radix-cache";
/// A `--features reference` build names itself, and earns no credit anywhere.
#[cfg(feature = "reference")]
const LAB_ID: &str = "radix-cache@reference";

pub static LAB: Lab = Lab { id: LAB_ID, version: 2, checks: &CHECKS };

const EXACT_MATCH: &str = "exact-match hit returns the full cached block table";
const LONGEST_PREFIX: &str = "longest cached ancestor wins";
const EVICTION_ORDER: &str = "leaf LRU respects recency and live pins";
const BLOCK_CONSERVATION: &str = "2000-op churn conserves every physical block";
const COW_DIVERGENCE: &str = "divergent writer copy-on-writes a shared partial tail";
const CHAT_HIT_RATE: &str = "shared-system chat replay clears the KV-hit floor";

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
pub fn check_exact_match(_: &Ctx) -> Check {
    const ID: &str = "exact_match";
    const LABEL: &str = EXACT_MATCH;
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
    // The same prompt again is a touch, not a second entry.
    if !store(&mut cache, &pool, &prompt) {
        return Check::fail(ID, LABEL, "re-inserting an exact duplicate failed");
    }
    if cache.entry_count() != 1 || cache.match_prefix(&prompt) != first {
        return Check::fail(
            ID,
            LABEL,
            format!(
                "an exact duplicate must be a touch: {} entries after two identical inserts, want 1",
                cache.entry_count()
            ),
        );
    }
    if pool.allocated_blocks() != 3 || first.blocks.iter().any(|&b| pool.refcount(b) != 1) {
        return Check::fail(
            ID,
            LABEL,
            format!(
                "after a duplicate insert and release, 3 blocks at one reference each; got {} blocks allocated",
                pool.allocated_blocks()
            ),
        );
    }
    Check::pass(
        ID,
        LABEL,
        "40/40 tokens hit; the same three physical blocks returned; a duplicate insert was a touch",
    )
}

/// 2. A query follows the deepest cached ancestor, not the first branch.
pub fn check_longest_prefix(_: &Ctx) -> Check {
    const ID: &str = "longest_prefix";
    const LABEL: &str = LONGEST_PREFIX;
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
pub fn check_eviction_order(_: &Ctx) -> Check {
    const ID: &str = "eviction_order";
    const LABEL: &str = EVICTION_ORDER;

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
    // `base` is the oldest entry, but `child` extends it: the coldest LEAF is
    // `side`, and it must be the one that went.
    if tree.match_prefix(&side).len != 0
        || tree.match_prefix(&child).len != child.len()
        || tree.match_prefix(&newcomer).len != newcomer.len()
    {
        return Check::fail(
            ID,
            LABEL,
            "at the entry limit the coldest leaf (side) must go; an internal terminal prefix with a descendant is not a leaf",
        );
    }
    // Drop the child (now the oldest leaf): `base` is a leaf again and must
    // still be an entry of its own.
    if !tree.evict_lru() || tree.match_prefix(&base).len != base.len() || tree.entry_count() != 2 {
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
pub fn check_block_conservation(ctx: &Ctx) -> Check {
    const ID: &str = "block_conservation";
    const LABEL: &str = BLOCK_CONSERVATION;
    const TOTAL: usize = 128;
    const MAX_ENTRIES: usize = 24;
    let pool = BlockAllocator::new(TOTAL, BS);
    let mut cache = RadixCache::new(pool.clone(), MAX_ENTRIES);
    let mut rng = Rng::seeded(ctx.seed);

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
pub fn check_cow_divergence(_: &Ctx) -> Check {
    const ID: &str = "cow_divergence";
    const LABEL: &str = COW_DIVERGENCE;
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
/// after the first request in each family. Seeded: which family each of the
/// 240 requests belongs to.
pub fn check_chat_hit_rate(ctx: &Ctx) -> Check {
    const ID: &str = "chat_hit_rate";
    const LABEL: &str = CHAT_HIT_RATE;
    const REQUESTS: usize = 240;
    let pool = BlockAllocator::new(128, BS);
    let mut cache = RadixCache::new(pool.clone(), 32);
    let mut rng = Rng::seeded(ctx.seed);
    let mut hit_tokens = 0usize;
    let mut prompt_tokens = 0usize;

    for i in 0..REQUESTS {
        // Eight interleaved products/agents sharing their own 64-token
        // system+tool prefix — a realistic multi-tenant chat shape.
        let family = rng.below(8);
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

/// The full suite on default seeds, in grading order (v1 report order).
pub fn self_checks() -> Vec<Check> {
    CHECKS.iter().map(|c| (c.run)(&Ctx { seed: c.default_seed, fresh: false })).collect()
}

/* ------------------------------ probe ------------------------------- */

/// `probe <seed>`: 48 seeded chat requests (four 32-token system prompts, a
/// 16-token user turn each) through YOUR cache, which holds 12 entries over a
/// 48-block pool, summarised in one line. Deterministic for a given seed and
/// cache.
pub fn probe(seed: u32) -> String {
    let mut rng = Rng::seeded(seed);
    let pool = BlockAllocator::new(48, BS);
    let mut cache = RadixCache::new(pool.clone(), 12);
    let (mut hit_tokens, mut prompt_tokens) = (0usize, 0usize);
    for turn in 0..48usize {
        let mut prompt = tokens(500_000 + rng.below(4) as u32 * 1_000, 32);
        prompt.extend((0..16).map(|i| 800_000 + turn as u32 * 32 + i as u32));
        hit_tokens += cache.match_prefix(&prompt).len;
        prompt_tokens += prompt.len();
        if !store(&mut cache, &pool, &prompt) {
            return format!("err request {turn}: the cache could not admit a 48-token prompt");
        }
    }
    format!(
        "requests=48 hit_tokens={hit_tokens} prompt_tokens={prompt_tokens} hit_rate={:.3} entries={} free_blocks={} conserved={}",
        hit_tokens as f64 / prompt_tokens as f64,
        cache.entry_count(),
        pool.free_blocks(),
        pool.conserved()
    )
}

/* ------------------------------ wasm ABI ---------------------------- */

kslab::export_abi_v2!();

#[no_mangle]
pub extern "C" fn ks_run(in_ptr: u32, in_len: u32) -> u64 {
    kslab::run(unsafe { kslab::input(in_ptr, in_len) }, &LAB)
}

/// The runtime bridge: `probe <seed>` (see `probe`).
#[no_mangle]
pub extern "C" fn ks_invoke(in_ptr: u32, in_len: u32) -> u64 {
    kslab::install_panic_hook();
    let cmd = std::str::from_utf8(unsafe { kslab::input(in_ptr, in_len) }).unwrap_or("");
    let mut it = cmd.split_whitespace();
    let reply = match (it.next(), it.next().map(str::parse::<u32>)) {
        (Some("probe"), Some(Ok(seed))) => probe(seed),
        _ => format!("err unknown command {:?} (try: probe <seed>)", kslab::clip(cmd.trim(), 40)),
    };
    kslab::emit_str(&reply)
}
