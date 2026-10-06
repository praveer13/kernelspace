//! R1 student file — replace every TODO(you), keep the signatures.
//! Each check in src/lib.rs feeds your function 8 inputs drawn from a seed, so the
//! examples below are the contract; a function that returns one fixed value fails.

/// Return the sum of every value, including negative values. `accumulate(&[4, -2, 9])` is 11,
/// and an empty slice sums to 0.
pub fn accumulate(values: &[i32]) -> i32 {
    let _ = values;
    todo!("TODO(you): use a mutable accumulator")
}

/// Convert kibibytes to bytes. One KiB is 1024 bytes, and the answer must not overflow:
/// `kib_to_bytes(4097)` is 4_195_328, and `u32::MAX` KiB still fits the `u64` result.
pub fn kib_to_bytes(kib: u32) -> u64 {
    let _ = kib;
    todo!("TODO(you): shadow into the wider type")
}

/// Return total / count as a floating-point value, without integer truncation.
/// `average(42, 4)` is 10.5; `count` is never 0.
pub fn average(total: u32, count: u32) -> f64 {
    let _ = (total, count);
    todo!("TODO(you): convert before dividing")
}

/// Return blocks * per_block through the value of an inner block expression.
/// `block_capacity(17, 64)` is 1088.
pub fn block_capacity(blocks: usize, per_block: usize) -> usize {
    let _ = (blocks, per_block);
    todo!("TODO(you): return a block expression")
}

/// Return "open" below capacity and "full" otherwise (at or above it).
/// `load_label(3, 8)` is "open", `load_label(8, 8)` is "full".
pub fn load_label(active: usize, capacity: usize) -> &'static str {
    let _ = (active, capacity);
    todo!("TODO(you): use if as a value")
}

/// Return the two tuple members in reverse order: `swap_pair((-3, 12))` is `(12, -3)`.
pub fn swap_pair(pair: (i32, i32)) -> (i32, i32) {
    let _ = pair;
    todo!("TODO(you): destructure the tuple")
}
