//! Rust Zero R9 — practical lifetime contracts. Edit only src/exercises.rs.

pub mod exercises;

use rust_zero_harness::{equal, Check};

pub fn check_first_word() -> Check {
    equal(
        "first_word",
        "return a view borrowed from one input",
        exercises::first_word("token block"),
        "token",
    )
}

pub fn check_choose_longer() -> Check {
    equal(
        "choose_longer",
        "relate a return to two inputs",
        (
            exercises::longer("kv", "attention"),
            exercises::longer("decode", "ep"),
        ),
        ("attention", "decode"),
    )
}

pub fn check_borrowed_block() -> Check {
    let tokens = [10, 20, 30];
    let block = exercises::make_block(&tokens);
    equal(
        "borrowed_block",
        "store a token slice in Block",
        block.tokens,
        &tokens[..],
    )
}

pub fn check_separate_lifetimes() -> Check {
    let left = String::from("kept");
    let selected = {
        let short = String::from("temporary");
        exercises::keep_left(&left, &short)
    };
    equal(
        "separate_lifetimes",
        "keep unrelated borrows independent",
        selected,
        "kept",
    )
}

pub fn check_owned_escape() -> Check {
    let owned = {
        let temporary = String::from("persistent");
        exercises::owned_label(&temporary)
    };
    equal(
        "owned_escape",
        "return owned data across a lifetime boundary",
        owned,
        "persistent".to_owned(),
    )
}

pub fn check_subslice_contract() -> Check {
    equal(
        "subslice_contract",
        "return a bounded subslice",
        (
            exercises::prefix(&[1, 2, 3, 4], 2),
            exercises::prefix(&[5, 6], 9),
        ),
        (&[1, 2][..], &[5, 6][..]),
    )
}

pub fn self_checks() -> Vec<Check> {
    vec![
        check_first_word(),
        check_choose_longer(),
        check_borrowed_block(),
        check_separate_lifetimes(),
        check_owned_escape(),
        check_subslice_contract(),
    ]
}

#[no_mangle]
pub extern "C" fn ks_run(_in_ptr: u32, _in_len: u32) -> u64 {
    rust_zero_harness::emit("rust-zero-r9", self_checks())
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
    check_test!(first_word, check_first_word());
    check_test!(choose_longer, check_choose_longer());
    check_test!(borrowed_block, check_borrowed_block());
    check_test!(separate_lifetimes, check_separate_lifetimes());
    check_test!(owned_escape, check_owned_escape());
    check_test!(subslice_contract, check_subslice_contract());
}
