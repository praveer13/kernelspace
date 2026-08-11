//! R9 student file — annotations describe where borrowed outputs came from.

#[derive(Debug, PartialEq, Eq)]
pub struct Block<'a> {
    pub tokens: &'a [u32],
}

pub fn first_word(input: &str) -> &str {
    let _ = input;
    todo!("TODO(you): return a view into input")
}

pub fn longer<'a>(left: &'a str, right: &'a str) -> &'a str {
    let _ = (left, right);
    todo!("TODO(you): return one of the two borrowed inputs")
}

pub fn make_block<'a>(tokens: &'a [u32]) -> Block<'a> {
    let _ = tokens;
    todo!("TODO(you): connect the Block lifetime to the token slice")
}

pub fn keep_left<'left, 'right>(left: &'left str, right: &'right str) -> &'left str {
    let _ = (left, right);
    todo!("TODO(you): keep unrelated lifetimes unrelated")
}

pub fn owned_label(input: &str) -> String {
    let _ = input;
    todo!("TODO(you): return owned data that can outlive input")
}

pub fn prefix<'a>(values: &'a [u32], length: usize) -> &'a [u32] {
    let _ = (values, length);
    todo!("TODO(you): return a bounded borrowed prefix")
}
