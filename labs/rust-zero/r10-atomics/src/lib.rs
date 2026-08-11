//! Rust Zero R10 — atomics and memory orderings. Edit only src/exercises.rs.

pub mod exercises;

use exercises::OrderingUse;
use rust_zero_harness::{equal, Check};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

pub fn check_relaxed_ticket() -> Check {
    let counter = AtomicUsize::new(40);
    let first = exercises::next_ticket(&counter);
    let second = exercises::next_ticket(&counter);
    equal(
        "relaxed_ticket",
        "allocate ids with a Relaxed fetch-add",
        (first, second, counter.load(Ordering::Relaxed)),
        (40, 41, 42),
    )
}

pub fn check_publish_consume() -> Check {
    let value = AtomicUsize::new(0);
    let ready = AtomicBool::new(false);
    equal(
        "publish_consume",
        "pair Release publication with Acquire observation",
        exercises::publish_then_consume(&value, &ready, 99),
        Some(99),
    )
}

pub fn check_compare_exchange() -> Check {
    let state = AtomicUsize::new(7);
    let success = exercises::claim(&state, 7, 8);
    let failure = exercises::claim(&state, 7, 9);
    equal(
        "compare_exchange",
        "claim a state with CAS",
        (success, failure, state.load(Ordering::Relaxed)),
        (Ok(7), Err(8), 8),
    )
}

pub fn check_fetch_update() -> Check {
    let counter = AtomicUsize::new(5);
    let high = exercises::raise_to(&counter, 12);
    let low = exercises::raise_to(&counter, 3);
    equal(
        "fetch_update",
        "perform conditional atomic update",
        (high, low, counter.load(Ordering::Relaxed)),
        (12, 12, 12),
    )
}

pub fn check_spin_lock() -> Check {
    let locked = AtomicBool::new(false);
    let first = exercises::lock_round_trip(&locked);
    locked.store(true, Ordering::Relaxed);
    let second = exercises::lock_round_trip(&locked);
    equal(
        "spin_lock",
        "Acquire a flag and Release it",
        (first, second),
        (true, false),
    )
}

pub fn check_ordering_choice() -> Check {
    equal(
        "ordering_choice",
        "classify counter vs publication orderings",
        (
            exercises::ordering_for(OrderingUse::Counter),
            exercises::ordering_for(OrderingUse::Publish),
            exercises::ordering_for(OrderingUse::Observe),
        ),
        (Ordering::Relaxed, Ordering::Release, Ordering::Acquire),
    )
}

pub fn self_checks() -> Vec<Check> {
    vec![
        check_relaxed_ticket(),
        check_publish_consume(),
        check_compare_exchange(),
        check_fetch_update(),
        check_spin_lock(),
        check_ordering_choice(),
    ]
}

#[no_mangle]
pub extern "C" fn ks_run(_in_ptr: u32, _in_len: u32) -> u64 {
    rust_zero_harness::emit("rust-zero-r10", self_checks())
}

#[cfg(test)]
mod tests {
    use super::*;
    macro_rules! check_test {
        ($name:ident, $check:expr) => {
            #[test]
            fn $name() {
                let check = $check;
                assert!(check.pass, "[{}] {}", check.id, check.msg);
            }
        };
    }
    check_test!(relaxed_ticket, check_relaxed_ticket());
    check_test!(publish_consume, check_publish_consume());
    check_test!(compare_exchange, check_compare_exchange());
    check_test!(fetch_update, check_fetch_update());
    check_test!(spin_lock, check_spin_lock());
    check_test!(ordering_choice, check_ordering_choice());
}
