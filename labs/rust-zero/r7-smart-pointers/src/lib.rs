//! Rust Zero R7 — Box, Rc, Weak, and Arc. Edit only src/exercises.rs.

pub mod exercises;

use exercises::List;
use rust_zero_harness::{equal, truth, Check};
use std::sync::Arc;

fn list_values(list: &List, out: &mut Vec<u32>) {
    match list {
        List::Node(value, tail) => {
            out.push(*value);
            list_values(tail, out);
        }
        List::End => {}
    }
}

pub fn check_boxed_list() -> Check {
    let list = exercises::boxed_three([3, 5, 8]);
    let mut values = Vec::new();
    list_values(&list, &mut values);
    equal(
        "boxed_list",
        "own a recursive tail through Box",
        values,
        vec![3, 5, 8],
    )
}

pub fn check_rc_counts() -> Check {
    equal(
        "rc_counts",
        "track Rc strong owners",
        exercises::rc_counts("cache".to_owned()),
        (2, 1),
    )
}

pub fn check_weak_edge() -> Check {
    equal(
        "weak_edge",
        "hold a non-owning Weak edge",
        exercises::weak_liveness("parent".to_owned()),
        (true, false),
    )
}

pub fn check_arc_share() -> Check {
    equal(
        "arc_share",
        "share immutable data with Arc",
        exercises::arc_sum(vec![2, 3, 5, 7]),
        (2, 17),
    )
}

pub fn check_handle_clone() -> Check {
    let (left, right) = exercises::shared_handles(vec![11, 13]);
    truth(
        "handle_clone",
        "clone a handle, not its payload",
        Arc::ptr_eq(&left, &right) && Arc::strong_count(&left) == 2,
        "both handles point to one allocation",
        "the handles do not share exactly one allocation",
    )
}

pub fn check_unwrap_unique() -> Check {
    equal(
        "unwrap_unique",
        "recover a uniquely owned Arc value",
        exercises::recover_unique("owned".to_owned()),
        Ok("owned".to_owned()),
    )
}

pub fn self_checks() -> Vec<Check> {
    vec![
        check_boxed_list(),
        check_rc_counts(),
        check_weak_edge(),
        check_arc_share(),
        check_handle_clone(),
        check_unwrap_unique(),
    ]
}

#[no_mangle]
pub extern "C" fn ks_run(_in_ptr: u32, _in_len: u32) -> u64 {
    rust_zero_harness::emit("rust-zero-r7", self_checks())
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
    check_test!(boxed_list, check_boxed_list());
    check_test!(rc_counts, check_rc_counts());
    check_test!(weak_edge, check_weak_edge());
    check_test!(arc_share, check_arc_share());
    check_test!(handle_clone, check_handle_clone());
    check_test!(unwrap_unique, check_unwrap_unique());
}
