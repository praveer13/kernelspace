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

use std::collections::HashMap;

pub struct Tokenizer {
    // TODO(you): your state here.
    _priv: (),
}

impl Tokenizer {
    pub fn new(merges: Vec<(u32, u32, u32)>) -> Self {
        let _ = merges;
        todo!("index the merge table: pair → rank/id, id → children")
    }

    pub fn encode(&self, text: &str) -> Vec<u32> {
        let _ = text;
        todo!("bytes → ids; loop: lowest-rank pair, replace all, repeat")
    }

    pub fn decode(&self, ids: &[u32]) -> String {
        let _ = ids;
        todo!("expand merge ids to bytes; U+FFFD for unknown; never panic")
    }
}
