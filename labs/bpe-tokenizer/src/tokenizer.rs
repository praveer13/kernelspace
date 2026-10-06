//! tokenizer.rs — forge lab 03 · THE ONLY FILE YOU EDIT
//!
//! Mission: byte-level BPE — the application side. The trainer lives in
//! the harness; serving engines only ever apply a frozen table, and so
//! do you.
//!
//! Contract (enforced by the harness in src/lib.rs):
//!   * `new(merges)`  — `merges[i] = (left, right, new_id)`; the INDEX is
//!     the rank (earlier rule = higher priority). Ids 0..=255 are bytes.
//!   * `encode(text)` — start from `text.as_bytes()` as ids; repeatedly
//!     merge the LOWEST-RANK adjacent pair present, all occurrences,
//!     left-to-right non-overlapping, until no pair has a rule.
//!   * `decode(ids)`  — expand merge ids back to their byte trees, then
//!     UTF-8. Unknown ids become U+FFFD; never panic.
//!
//! Suggested state:
//!
//!     rules: HashMap<(u32, u32), (u32 /*rank*/, u32 /*merged id*/)>
//!     children: HashMap<u32, (u32, u32)>   // merged id → children, for decode
//!
//! Hints:
//!   * encode's inner loop: scan the current id vec once, find the
//!     smallest rank among adjacent pairs, then do one left-to-right
//!     replacement pass. Repeat. The strings here are tiny — clarity
//!     beats cleverness.
//!   * decode: expand each id with a work stack (push right child, then
//!     left) instead of recursion; collect bytes, then
//!     `String::from_utf8_lossy`. For an unknown id append the UTF-8 of
//!     '\u{FFFD}' (b"\xEF\xBF\xBD").
//!   * Check 2 is the trap: lowest RANK, not leftmost pair. GPT-2 got
//!     this right; half of all toy implementations don't.
//!
//! Build it in four stages. Each one turns specific checks green, and each is
//! at most 25 minutes. Go in order: a later stage reuses what an earlier one
//! built. Look for the `STAGE` markers below; the signatures never change.
//!
//!   STAGE 1  bytes_are_ids               ≈ 2 min    bytes are ids, both ways,
//!                                                   with no merges
//!   STAGE 2  merge_priority,             ≈ 20 min   `new` indexes the table;
//!            leftmost_nonoverlap                    `encode` merges
//!   STAGE 3  roundtrip, robust_decode    ≈ 20 min   `decode` expands merge
//!                                                   ids; bad ids degrade
//!   STAGE 4  contract                    ≈ 10 min   merge until nothing
//!                                                   merges, on unseen text
//!
//! Check a stage on your machine with `cargo test <check id>`, for example
//! `cargo test bytes_are_ids`. Stage 1 is meant to be quick: it only proves
//! the loop (edit, build, drop the .wasm on the page) works before the real
//! work. A `todo!()` traps only the checks that reach it.
//!
//! Which check catches which mistake:
//!
//! ```text
//!   bytes_are_ids         a base vocabulary that is not "byte b is id b"
//!   merge_priority        merging the leftmost pair, or the highest rank,
//!                         instead of the lowest rank
//!   leftmost_nonoverlap   a run `aaa` merged right-to-left or overlapping,
//!                         or the last rule of the table never applied
//!   roundtrip             a decode that loses a byte, or stops expanding a
//!                         merge id after one level (a seeded table of 16-48
//!                         merges, seeded UTF-8)
//!   robust_decode         an unknown id that panics or vanishes
//!   contract              an encode that makes one pass and stops while a
//!                         merge rule still applies; wrong ids on a fixed
//!                         unseen text
//! ```
//!
//! `merge_priority` and `leftmost_nonoverlap` each read a tiny table, so a
//! stage 2 that passes both can still fail `contract`: the real table has 48
//! rules, and merged ids feed later rules.

#[allow(unused_imports)] // import becomes live as the student completes the template
use std::collections::HashMap;

pub struct Tokenizer {
    // TODO(you): your state here. Stage 2 needs `pair → (rank, id)`; stage 3
    // adds `id → children` for decode.
    _priv: (),
}

impl Tokenizer {
    // STAGE 1 · bytes_are_ids · ≈ 2 min
    //   With an empty table there is nothing to index; ignoring `merges` is
    //   a fine first version.
    // STAGE 2 · merge_priority, leftmost_nonoverlap · ≈ 20 min
    //   Index the table: pair → (rank, merged id). The rank is the position
    //   in `merges`, not the merged id.
    // STAGE 3 · roundtrip, robust_decode · ≈ 20 min
    //   Also keep merged id → (left, right), so decode can expand it.
    pub fn new(merges: Vec<(u32, u32, u32)>) -> Self {
        let _ = merges;
        todo!("index the merge table: pair → rank/id, id → children")
    }

    // STAGE 1 · bytes_are_ids
    //   `text.as_bytes()`, each byte widened to its own id.
    // STAGE 2 · merge_priority, leftmost_nonoverlap
    //   Scan the adjacent pairs, take the one with the LOWEST rank anywhere
    //   in the sequence (not the leftmost pair that has a rule), then
    //   replace every occurrence in one left-to-right pass that skips the
    //   second half of a merged pair (`aaa` becomes [aa, a]).
    // STAGE 4 · contract · ≈ 10 min
    //   Repeat until no adjacent pair has a rule. A merge makes new pairs,
    //   and merged ids appear in later rules, so one pass is not enough.
    pub fn encode(&self, text: &str) -> Vec<u32> {
        let _ = text;
        todo!("bytes → ids; loop: lowest-rank pair, replace all, repeat")
    }

    // STAGE 1 · bytes_are_ids
    //   Ids below 256 are the bytes themselves; collect them and build the
    //   string.
    // STAGE 3 · roundtrip, robust_decode
    //   Expand a merge id to its children until only bytes are left (a
    //   merge id may contain merge ids). An id that is neither a byte nor
    //   in your table becomes U+FFFD; an empty slice is the empty string.
    pub fn decode(&self, ids: &[u32]) -> String {
        let _ = ids;
        todo!("expand merge ids to bytes; U+FFFD for unknown; never panic")
    }
}
