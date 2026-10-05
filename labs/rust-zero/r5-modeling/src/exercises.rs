//! R5 student file — model absence and failure explicitly.
//! Each check in src/lib.rs feeds your function 8 inputs drawn from a seed, so the
//! contracts below are what is graded; a function that returns one fixed value fails.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Block {
    pub used: usize,
    pub capacity: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Prefill,
    Decode,
    Done,
}

impl Block {
    /// Free capacity: `capacity - used`, or 0 when `used` is already at or past `capacity`
    /// (it must not underflow). `Block { used: 19, capacity: 64 }.free()` is 45.
    pub fn free(&self) -> usize {
        todo!("TODO(you): derive free capacity without underflow")
    }
}

/// "prefill", "decode" or "done", matching the variant.
pub fn phase_label(phase: Phase) -> &'static str {
    let _ = phase;
    todo!("TODO(you): match every phase")
}

/// The first even value, or `None` when there is none: `first_even(&[1, 5, 8, 10])` is
/// `Some(8)` and `first_even(&[1, 3, 5])` is `None`.
pub fn first_even(values: &[u32]) -> Option<u32> {
    let _ = values;
    todo!("TODO(you): return Some(value) or None")
}

/// `Ok(capacity)` for a positive value; `Err("capacity must be positive")` for 0.
pub fn validate_capacity(capacity: usize) -> Result<usize, &'static str> {
    let _ = capacity;
    todo!("TODO(you): reject zero capacity")
}

/// Parse both strings as `u32` and add them. A `left` that does not parse (checked first) gives
/// `Err("invalid left".to_owned())`, a `right` that does not gives `Err("invalid right".to_owned())`:
/// `parse_sum("12", "30")` is `Ok(42)`.
pub fn parse_sum(left: &str, right: &str) -> Result<u32, String> {
    let _ = (left, right);
    todo!("TODO(you): parse both values and propagate failure with ?")
}

/// `None` is "missing"; `Some(phase)` is "running:prefill", "running:decode" or "complete"
/// (for `Done`).
pub fn describe(state: Option<Phase>) -> &'static str {
    let _ = state;
    todo!("TODO(you): match Option containing an enum")
}
