//! Rust Zero R2 — functions and control flow. Edit only src/exercises.rs.

pub mod exercises;

use rust_zero_harness::{equal, Check};

pub fn check_branch_expression() -> Check {
    equal(
        "branch_expression",
        "if/else expression",
        (
            exercises::clamp(-2, 0, 10),
            exercises::clamp(7, 0, 10),
            exercises::clamp(14, 0, 10),
        ),
        (0, 7, 10),
    )
}

pub fn check_range_sum() -> Check {
    equal(
        "range_sum",
        "for over a half-open range",
        exercises::sum_below(10),
        45,
    )
}

pub fn check_while_search() -> Check {
    equal(
        "while_search",
        "condition-driven search",
        exercises::first_multiple(23, 7),
        28,
    )
}

pub fn check_loop_value() -> Check {
    equal(
        "loop_value",
        "break with a value",
        exercises::first_power_above(65),
        128,
    )
}

pub fn check_tuple_match() -> Check {
    equal(
        "tuple_match",
        "exhaustive tuple match",
        [
            exercises::quadrant((0, 0)),
            exercises::quadrant((0, 4)),
            exercises::quadrant((-2, 5)),
            exercises::quadrant((3, -1)),
        ],
        ["origin", "axis", "north-west", "south-east"],
    )
}

pub fn check_guarded_match() -> Check {
    equal(
        "guarded_match",
        "match arm guard",
        [
            exercises::load_band(0, 0),
            exercises::load_band(0, 8),
            exercises::load_band(6, 8),
            exercises::load_band(8, 8),
        ],
        ["disabled", "idle", "hot", "full"],
    )
}

pub fn self_checks() -> Vec<Check> {
    vec![
        check_branch_expression(),
        check_range_sum(),
        check_while_search(),
        check_loop_value(),
        check_tuple_match(),
        check_guarded_match(),
    ]
}

#[no_mangle]
pub extern "C" fn ks_run(_in_ptr: u32, _in_len: u32) -> u64 {
    rust_zero_harness::emit("rust-zero-r2", self_checks())
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
    check_test!(branch_expression, check_branch_expression());
    check_test!(range_sum, check_range_sum());
    check_test!(while_search, check_while_search());
    check_test!(loop_value, check_loop_value());
    check_test!(tuple_match, check_tuple_match());
    check_test!(guarded_match, check_guarded_match());
}
