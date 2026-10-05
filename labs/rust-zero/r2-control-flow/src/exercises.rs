//! R2 student file — pure control flow, no allocation required.
//! Each check in src/lib.rs feeds your function 8 inputs drawn from a seed, so the
//! contracts below are what is graded; a function that returns one fixed value fails.

/// Clamp `value` into `low..=high` (`low < high`) with an if/else expression:
/// `clamp(-2, 0, 10)` is 0, `clamp(7, 0, 10)` is 7, `clamp(14, 0, 10)` is 10.
pub fn clamp(value: i32, low: i32, high: i32) -> i32 {
    let _ = (value, low, high);
    todo!("TODO(you): return an if/else expression")
}

/// Sum of every integer in the half-open range `0..n`; `sum_below(10)` is 45, `sum_below(0)` is 0.
pub fn sum_below(n: u32) -> u32 {
    let _ = n;
    todo!("TODO(you): for over 0..n")
}

/// The smallest multiple of `divisor` that is at least `start` (`divisor` is never 0):
/// `first_multiple(23, 7)` is 28 and `first_multiple(28, 7)` is also 28.
pub fn first_multiple(start: u32, divisor: u32) -> u32 {
    let _ = (start, divisor);
    todo!("TODO(you): search with while")
}

/// The smallest power of two strictly greater than `limit`:
/// `first_power_above(65)` is 128, `first_power_above(64)` is 128, `first_power_above(0)` is 1.
pub fn first_power_above(limit: u32) -> u32 {
    let _ = limit;
    todo!("TODO(you): break from loop with a value")
}

/// Name where `(x, y)` sits, checking in this order: `(0, 0)` is "origin"; any other point with
/// x == 0 or y == 0 is "axis"; then "north-west" (x < 0, y > 0), "north-east" (x > 0, y > 0),
/// "south-west" (x < 0, y < 0) and "south-east" (x > 0, y < 0).
pub fn quadrant(point: (i32, i32)) -> &'static str {
    let _ = point;
    todo!("TODO(you): match every axis/sign shape")
}

/// Label a load, checking in this order: "disabled" when `capacity` is 0; "idle" when `active`
/// is 0; "full" when `active >= capacity`; "hot" when `active` is at least 75 % of `capacity`
/// (`active * 4 >= capacity * 3`); otherwise "warm". So `load_band(6, 8)` is "hot" and
/// `load_band(5, 8)` is "warm".
pub fn load_band(active: usize, capacity: usize) -> &'static str {
    let _ = (active, capacity);
    todo!("TODO(you): use match guards")
}
