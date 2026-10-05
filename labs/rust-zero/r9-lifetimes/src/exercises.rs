//! R9 student file — annotations describe where borrowed outputs came from.
//! Each check in src/lib.rs feeds your function 8 inputs drawn from a seed, so the
//! contracts below are what is graded; a function that returns one fixed value fails.
//! The harness also tests your lifetimes: it uses each answer at a point where a wrongly
//! related lifetime would not compile, and checks that borrowed answers are views into
//! their input, not copies.

#[derive(Debug, PartialEq, Eq)]
pub struct Block<'a> {
    pub tokens: &'a [u32],
}

/// The text before the first space, or all of `input` when it has no space, as a view into
/// `input`: `first_word("token block")` is "token".
pub fn first_word(input: &str) -> &str {
    let _ = input;
    todo!("TODO(you): return a view into input")
}

/// Whichever of the two is longer, borrowed from it (the lengths always differ):
/// `longer("kv", "attention")` is "attention".
pub fn longer<'a>(left: &'a str, right: &'a str) -> &'a str {
    let _ = (left, right);
    todo!("TODO(you): return one of the two borrowed inputs")
}

/// A `Block` that holds the same slice it was given (not a copy), for as long as the slice lives.
pub fn make_block<'a>(tokens: &'a [u32]) -> Block<'a> {
    let _ = tokens;
    todo!("TODO(you): connect the Block lifetime to the token slice")
}

/// Always `left`. The answer's lifetime is `left`'s alone, so it stays usable after `right`
/// is gone: `keep_left("kept", "temporary")` is "kept".
pub fn keep_left<'left, 'right>(left: &'left str, right: &'right str) -> &'left str {
    let _ = (left, right);
    todo!("TODO(you): keep unrelated lifetimes unrelated")
}

/// An owned copy of `input`, which stays valid after `input` is dropped:
/// `owned_label("persistent")` is "persistent".to_owned().
pub fn owned_label(input: &str) -> String {
    let _ = input;
    todo!("TODO(you): return owned data that can outlive input")
}

/// The first `length` values, or all of them when `length` is larger than the slice, as a
/// view into `values`: `prefix(&[1, 2, 3, 4], 2)` is `[1, 2]` and `prefix(&[5, 6], 9)` is `[5, 6]`.
pub fn prefix<'a>(values: &'a [u32], length: usize) -> &'a [u32] {
    let _ = (values, length);
    todo!("TODO(you): return a bounded borrowed prefix")
}
