//! R10 student file — atomicity plus an explicit visibility contract.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderingUse {
    Counter,
    Publish,
    Observe,
}

pub fn next_ticket(counter: &AtomicUsize) -> usize {
    let _ = counter;
    todo!("TODO(you): fetch_add with Relaxed ordering")
}

pub fn publish_then_consume(value: &AtomicUsize, ready: &AtomicBool, next: usize) -> Option<usize> {
    let _ = (value, ready, next);
    todo!("TODO(you): publish with Release and observe with Acquire")
}

pub fn claim(state: &AtomicUsize, expected: usize, next: usize) -> Result<usize, usize> {
    let _ = (state, expected, next);
    todo!("TODO(you): compare_exchange with valid success/failure orderings")
}

pub fn raise_to(counter: &AtomicUsize, minimum: usize) -> usize {
    let _ = (counter, minimum);
    todo!("TODO(you): use fetch_update and return the final value")
}

pub fn lock_round_trip(locked: &AtomicBool) -> bool {
    let _ = locked;
    todo!("TODO(you): Acquire the flag, then Release it")
}

pub fn ordering_for(use_case: OrderingUse) -> Ordering {
    let _ = use_case;
    todo!("TODO(you): classify counter, publication, and observation")
}
