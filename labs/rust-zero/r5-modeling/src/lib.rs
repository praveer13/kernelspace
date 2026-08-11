//! Rust Zero R5 — structs, enums, Option, Result, and question-mark.
//! Edit only src/exercises.rs.

pub mod exercises;

use exercises::{Block, Phase};
use rust_zero_harness::{equal, Check};

pub fn check_block_method() -> Check {
    equal(
        "block_method",
        "derive a value through a struct method",
        Block {
            used: 19,
            capacity: 64,
        }
        .free(),
        45,
    )
}

pub fn check_state_match() -> Check {
    equal(
        "state_match",
        "exhaustively match an enum state",
        [
            exercises::phase_label(Phase::Prefill),
            exercises::phase_label(Phase::Decode),
            exercises::phase_label(Phase::Done),
        ],
        ["prefill", "decode", "done"],
    )
}

pub fn check_option_lookup() -> Check {
    equal(
        "option_lookup",
        "return optional lookup state",
        (
            exercises::first_even(&[1, 5, 8, 10]),
            exercises::first_even(&[1, 3, 5]),
        ),
        (Some(8), None),
    )
}

pub fn check_result_validate() -> Check {
    equal(
        "result_validate",
        "validate with a typed error",
        (
            exercises::validate_capacity(32),
            exercises::validate_capacity(0),
        ),
        (Ok(32), Err("capacity must be positive")),
    )
}

pub fn check_question_mark() -> Check {
    equal(
        "question_mark",
        "propagate parse failure with ?",
        (
            exercises::parse_sum("12", "30"),
            exercises::parse_sum("12", "nope"),
        ),
        (Ok(42), Err("invalid right".to_owned())),
    )
}

pub fn check_nested_match() -> Check {
    equal(
        "nested_match",
        "match Option containing an enum",
        [
            exercises::describe(None),
            exercises::describe(Some(Phase::Prefill)),
            exercises::describe(Some(Phase::Done)),
        ],
        ["missing", "running:prefill", "complete"],
    )
}

pub fn self_checks() -> Vec<Check> {
    vec![
        check_block_method(),
        check_state_match(),
        check_option_lookup(),
        check_result_validate(),
        check_question_mark(),
        check_nested_match(),
    ]
}

#[no_mangle]
pub extern "C" fn ks_run(_in_ptr: u32, _in_len: u32) -> u64 {
    rust_zero_harness::emit("rust-zero-r5", self_checks())
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
    check_test!(block_method, check_block_method());
    check_test!(state_match, check_state_match());
    check_test!(option_lookup, check_option_lookup());
    check_test!(result_validate, check_result_validate());
    check_test!(question_mark, check_question_mark());
    check_test!(nested_match, check_nested_match());
}
