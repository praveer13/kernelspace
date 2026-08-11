//! Rust Zero R4 — references, mutable references, and slices.
//! Edit only src/exercises.rs.

pub mod exercises;

use rust_zero_harness::{equal, Check};

pub fn check_slice_sum() -> Check {
    equal(
        "slice_sum",
        "read through a shared slice",
        exercises::slice_sum(&[2, 3, 5, 7]),
        17,
    )
}

pub fn check_mutate_slice() -> Check {
    let mut values = [-4, 2, -1, 9];
    exercises::zero_negatives(&mut values);
    equal(
        "mutate_slice",
        "update through a mutable slice",
        values,
        [0, 2, 0, 9],
    )
}

pub fn check_split_mut() -> Check {
    let mut values = [1, 2, 3, 4];
    exercises::swap_halves(&mut values);
    equal(
        "split_mut",
        "mutate disjoint halves safely",
        values,
        [3, 4, 1, 2],
    )
}

pub fn check_str_view() -> Check {
    equal(
        "str_view",
        "accept a borrowed string view",
        exercises::first_word("paged attention"),
        "paged",
    )
}

pub fn check_borrow_then_mutate() -> Check {
    let mut values = vec![11, 22];
    let first = exercises::copy_first_then_push(&mut values);
    equal(
        "borrow_then_mutate",
        "end a read before mutation",
        (first, values),
        (11, vec![11, 22, 11]),
    )
}

pub fn check_subslice() -> Check {
    equal(
        "subslice",
        "return a slice tied to the input",
        exercises::middle(&[1, 2, 3, 4, 5]),
        &[2, 3, 4][..],
    )
}

pub fn self_checks() -> Vec<Check> {
    vec![
        check_slice_sum(),
        check_mutate_slice(),
        check_split_mut(),
        check_str_view(),
        check_borrow_then_mutate(),
        check_subslice(),
    ]
}

#[no_mangle]
pub extern "C" fn ks_run(_in_ptr: u32, _in_len: u32) -> u64 {
    rust_zero_harness::emit("rust-zero-r4", self_checks())
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
    check_test!(slice_sum, check_slice_sum());
    check_test!(mutate_slice, check_mutate_slice());
    check_test!(split_mut, check_split_mut());
    check_test!(str_view, check_str_view());
    check_test!(borrow_then_mutate, check_borrow_then_mutate());
    check_test!(subslice, check_subslice());
}
