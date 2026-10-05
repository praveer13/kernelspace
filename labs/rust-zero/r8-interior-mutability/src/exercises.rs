//! R8 student file — scope every dynamic borrow or lock guard.
//! Each check in src/lib.rs feeds your function 8 inputs drawn from a seed, so the
//! contracts below are what is graded; a function that returns one fixed value fails.

use std::cell::{Cell, RefCell};
use std::sync::Mutex;

/// Add `amount` to the counter through the shared reference and return the new value:
/// with the counter at 4, `increment(&cell, 3)` is 7 and `cell.get()` is 7 afterwards.
pub fn increment(cell: &Cell<usize>, amount: usize) -> usize {
    let _ = (cell, amount);
    todo!("TODO(you): get, set, and return the new value")
}

/// Push `message` onto the log and return the new number of lines: with `["boot"]` in the
/// log, `append_log(&log, "ready")` is 2 and the log is `["boot", "ready"]`.
pub fn append_log(log: &RefCell<Vec<String>>, message: &str) -> usize {
    let _ = (log, message);
    todo!("TODO(you): mutate through a RefMut guard")
}

/// Whether the cell could be mutably borrowed right now, without panicking: true when nobody
/// holds it, false when a `Ref` or a `RefMut` is alive. Leave the cell exactly as you found
/// it: no guard may outlive your function.
pub fn mutable_available(values: &RefCell<Vec<u32>>) -> bool {
    let _ = values;
    todo!("TODO(you): detect conflicts with try_borrow_mut")
}

/// Sum the numbers, then push that sum onto the end of the same vector, and return it. The
/// read guard must be gone before the write: with `[2, 3, 5]` the result is 10 and the vector
/// becomes `[2, 3, 5, 10]`. An empty vector sums to 0.
pub fn read_then_append(values: &RefCell<Vec<i32>>) -> i32 {
    let _ = values;
    todo!("TODO(you): end the read guard before the write guard")
}

/// Add `amount` to the locked number and return the new value: with 12 inside,
/// `add_locked(&value, 8)` is 20 and the mutex holds 20 afterwards.
pub fn add_locked(value: &Mutex<i32>, amount: i32) -> i32 {
    let _ = (value, amount);
    todo!("TODO(you): update through the MutexGuard")
}

/// Push `first`, then `second`, onto the locked vector, locking separately for each push,
/// and return the new length. Release the first guard before locking again: a thread that
/// locks a mutex it already holds waits for itself. With `[1]` inside, `two_updates(&values, 2, 3)`
/// is 3 and the vector is `[1, 2, 3]`.
pub fn two_updates(values: &Mutex<Vec<u32>>, first: u32, second: u32) -> usize {
    let _ = (values, first, second);
    todo!("TODO(you): release the first guard before locking again")
}
