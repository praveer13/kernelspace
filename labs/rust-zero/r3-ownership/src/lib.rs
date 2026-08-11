//! Rust Zero R3 — ownership, moves, clones, and drops.
//! Edit only src/exercises.rs.

pub mod exercises;

use exercises::Request;
use rust_zero_harness::{equal, truth, Check};

pub fn check_copy_scalar() -> Check {
    equal(
        "copy_scalar",
        "distinguish Copy from move",
        exercises::copied_plus(10),
        (11, 12),
    )
}

pub fn check_return_ownership() -> Check {
    equal(
        "return_ownership",
        "consume and return an owned String",
        exercises::normalize_owned("DeCoDe".to_owned()),
        "decode".to_owned(),
    )
}

pub fn check_clone_independent() -> Check {
    let (mut left, right) = exercises::duplicate_buffers("rust".to_owned());
    left.push('!');
    truth(
        "clone_independent",
        "clone only for independent buffers",
        left == "rust!" && right == "rust",
        "mutating one buffer left the clone unchanged",
        "the returned Strings were not independent copies",
    )
}

pub fn check_consume_vec() -> Check {
    equal(
        "consume_vec",
        "consume a Vec into a result",
        exercises::consume_vec(vec![3, 5, 8, 13]),
        29,
    )
}

pub fn check_option_take() -> Check {
    let mut slot = Some("waiting".to_owned());
    let taken = exercises::take_pending(&mut slot);
    equal(
        "option_take",
        "move a value out through Option::take",
        (taken, slot),
        (Some("waiting".to_owned()), None),
    )
}

pub fn check_replace_field() -> Check {
    let mut request = Request {
        name: "prefill".to_owned(),
    };
    let previous = exercises::rename(&mut request, "decode".to_owned());
    equal(
        "replace_field",
        "replace and return an owned field",
        (previous, request.name),
        ("prefill".to_owned(), "decode".to_owned()),
    )
}

pub fn self_checks() -> Vec<Check> {
    vec![
        check_copy_scalar(),
        check_return_ownership(),
        check_clone_independent(),
        check_consume_vec(),
        check_option_take(),
        check_replace_field(),
    ]
}

#[no_mangle]
pub extern "C" fn ks_run(_in_ptr: u32, _in_len: u32) -> u64 {
    rust_zero_harness::emit("rust-zero-r3", self_checks())
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
    check_test!(copy_scalar, check_copy_scalar());
    check_test!(return_ownership, check_return_ownership());
    check_test!(clone_independent, check_clone_independent());
    check_test!(consume_vec, check_consume_vec());
    check_test!(option_take, check_option_take());
    check_test!(replace_field, check_replace_field());
}
