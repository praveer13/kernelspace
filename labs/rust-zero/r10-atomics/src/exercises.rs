//! R10 student file — atomicity plus an explicit visibility contract.
//! Each check in src/lib.rs feeds your function 8 inputs drawn from a seed, so the
//! contracts below are what is graded; a function that returns one fixed value fails.
//! The checks run on one thread: they verify what each operation does to the value, and
//! the ordering each function needs is named in its comment.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderingUse {
    Counter,
    Publish,
    Observe,
}

/// Hand out the next ticket: return the counter's current value and add 1 to it in one atomic
/// step, with `Relaxed` ordering (an id counter publishes nothing). With the counter at 40,
/// the first call returns 40, the second 41, and the counter then holds 42.
pub fn next_ticket(counter: &AtomicUsize) -> usize {
    let _ = counter;
    todo!("TODO(you): fetch_add with Relaxed ordering")
}

/// Store `next` into `value`, then set `ready` with `Release` so the store is visible to
/// whoever sees the flag. Then read `ready` with `Acquire`: when it is set, return
/// `Some(value)` as you now see it, otherwise `None`. With `ready` false and `next` 99 the
/// answer is `Some(99)`, and afterwards `value` holds 99 and `ready` is true.
pub fn publish_then_consume(value: &AtomicUsize, ready: &AtomicBool, next: usize) -> Option<usize> {
    let _ = (value, ready, next);
    todo!("TODO(you): publish with Release and observe with Acquire")
}

/// Move `state` from `expected` to `next` in one atomic compare-and-exchange. `Ok(old)` when
/// the state was `expected` (it now holds `next`), `Err(actual)` when it was something else
/// (it is unchanged). With the state at 7, `claim(&state, 7, 8)` is `Ok(7)`, and then
/// `claim(&state, 7, 9)` is `Err(8)`. Pick a success ordering that acquires and a failure
/// ordering that is no stronger than it.
pub fn claim(state: &AtomicUsize, expected: usize, next: usize) -> Result<usize, usize> {
    let _ = (state, expected, next);
    todo!("TODO(you): compare_exchange with valid success/failure orderings")
}

/// Raise the counter to at least `minimum` and never lower it, with `fetch_update`; return
/// the value the counter holds afterwards. With the counter at 5, `raise_to(&counter, 12)` is
/// 12, and then `raise_to(&counter, 3)` is still 12.
pub fn raise_to(counter: &AtomicUsize, minimum: usize) -> usize {
    let _ = (counter, minimum);
    todo!("TODO(you): use fetch_update and return the final value")
}

/// Run `work` while holding a one-flag lock. Try to take the flag (false to true) with
/// `Acquire`: if someone else already holds it, return `None` without running `work`. Otherwise
/// run `work`, release the flag (back to false) with `Release`, and return `Some` of its result.
/// The flag must read true while `work` runs and false afterwards.
pub fn lock_round_trip(locked: &AtomicBool, work: impl FnOnce() -> u32) -> Option<u32> {
    let _ = (locked, work);
    todo!("TODO(you): Acquire the flag, run the work, then Release it")
}

/// The ordering each use needs: an id counter is `Relaxed`, publishing data to another thread
/// is `Release`, and observing that publication is `Acquire`.
pub fn ordering_for(use_case: OrderingUse) -> Ordering {
    let _ = use_case;
    todo!("TODO(you): classify counter, publication, and observation")
}
