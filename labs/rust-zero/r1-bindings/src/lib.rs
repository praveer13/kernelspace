//! Rust Zero R1 — bindings, scalar types, and expressions.
//! Edit only src/exercises.rs.

pub mod exercises;

use rust_zero_harness::{equal, Check};

pub fn check_mut_accumulate() -> Check {
    equal(
        "mut_accumulate",
        "mutable accumulation",
        exercises::accumulate(&[4, -2, 9]),
        11,
    )
}

pub fn check_shadow_convert() -> Check {
    equal(
        "shadow_convert",
        "shadow a value into a new type",
        exercises::kib_to_bytes(4097),
        4_195_328u64,
    )
}

pub fn check_typed_average() -> Check {
    equal(
        "typed_average",
        "explicit numeric conversion",
        exercises::average(42, 4),
        10.5,
    )
}

pub fn check_block_value() -> Check {
    equal(
        "block_value",
        "return a block expression",
        exercises::block_capacity(17, 64),
        1088,
    )
}

pub fn check_branch_value() -> Check {
    equal(
        "branch_value",
        "if as a value",
        (exercises::load_label(3, 8), exercises::load_label(8, 8)),
        ("open", "full"),
    )
}

pub fn check_destructure() -> Check {
    equal(
        "destructure",
        "tuple destructuring",
        exercises::swap_pair((-3, 12)),
        (12, -3),
    )
}

pub fn self_checks() -> Vec<Check> {
    vec![
        check_mut_accumulate(),
        check_shadow_convert(),
        check_typed_average(),
        check_block_value(),
        check_branch_value(),
        check_destructure(),
    ]
}

#[no_mangle]
pub extern "C" fn ks_run(_in_ptr: u32, _in_len: u32) -> u64 {
    rust_zero_harness::emit("rust-zero-r1", self_checks())
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
    check_test!(mut_accumulate, check_mut_accumulate());
    check_test!(shadow_convert, check_shadow_convert());
    check_test!(typed_average, check_typed_average());
    check_test!(block_value, check_block_value());
    check_test!(branch_value, check_branch_value());
    check_test!(destructure, check_destructure());
}
