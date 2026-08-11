//! Rust Zero R8 — Cell, RefCell, and Mutex. Edit only src/exercises.rs.

pub mod exercises;

use rust_zero_harness::{equal, Check};
use std::cell::{Cell, RefCell};
use std::sync::Mutex;

pub fn check_cell_counter() -> Check {
    let counter = Cell::new(4);
    let result = exercises::increment(&counter, 3);
    equal(
        "cell_counter",
        "update a Copy counter through Cell",
        (result, counter.get()),
        (7, 7),
    )
}

pub fn check_refcell_log() -> Check {
    let log = RefCell::new(vec!["boot".to_owned()]);
    let length = exercises::append_log(&log, "ready");
    equal(
        "refcell_log",
        "mutate a log behind RefCell",
        (length, log.into_inner()),
        (2, vec!["boot".to_owned(), "ready".to_owned()]),
    )
}

pub fn check_conflict_detection() -> Check {
    let values = RefCell::new(vec![1, 2]);
    let read = values.borrow();
    let available = exercises::mutable_available(&values);
    drop(read);
    equal(
        "conflict_detection",
        "detect a borrow conflict without panic",
        (available, exercises::mutable_available(&values)),
        (false, true),
    )
}

pub fn check_scoped_borrow() -> Check {
    let values = RefCell::new(vec![2, 3, 5]);
    let total = exercises::read_then_append(&values);
    equal(
        "scoped_borrow",
        "drop a read guard before a write",
        (total, values.into_inner()),
        (10, vec![2, 3, 5, 10]),
    )
}

pub fn check_mutex_update() -> Check {
    let value = Mutex::new(12);
    let result = exercises::add_locked(&value, 8);
    let stored = *value.lock().unwrap();
    equal(
        "mutex_update",
        "update state through a MutexGuard",
        (result, stored),
        (20, 20),
    )
}

pub fn check_lock_scope() -> Check {
    let values = Mutex::new(vec![1]);
    let length = exercises::two_updates(&values, 2, 3);
    let inner = values.into_inner().unwrap();
    equal(
        "lock_scope",
        "release a guard before the next lock",
        (length, inner),
        (3, vec![1, 2, 3]),
    )
}

pub fn self_checks() -> Vec<Check> {
    vec![
        check_cell_counter(),
        check_refcell_log(),
        check_conflict_detection(),
        check_scoped_borrow(),
        check_mutex_update(),
        check_lock_scope(),
    ]
}

#[no_mangle]
pub extern "C" fn ks_run(_in_ptr: u32, _in_len: u32) -> u64 {
    rust_zero_harness::emit("rust-zero-r8", self_checks())
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
    check_test!(cell_counter, check_cell_counter());
    check_test!(refcell_log, check_refcell_log());
    check_test!(conflict_detection, check_conflict_detection());
    check_test!(scoped_borrow, check_scoped_borrow());
    check_test!(mutex_update, check_mutex_update());
    check_test!(lock_scope, check_lock_scope());
}
