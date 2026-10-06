//! Rust Zero R9 — practical lifetime contracts. Edit only src/exercises.rs.
//!
//! Template v2: each check draws 8 inputs from its seed and compares your
//! function with its own simple oracle, so returning a literal fails. The
//! failure message names the input that broke. `cargo test` runs each check
//! on its default seed and on 32 extra seeds.
//!
//! Some checks also compile-test your signatures: `separate_lifetimes` calls
//! `keep_left` with a `right` that is dropped before the answer is used, and
//! `owned_escape` returns before its input is dropped. A signature that ties
//! the wrong lifetimes together stops the crate compiling, at that call.

pub mod exercises;

use rust_zero_harness::{cases, text, u32_in, usize_in, Check, CheckDef, Ctx, Lab, Rng, LOWER, MIXED};

#[cfg(not(feature = "reference"))]
const LAB_ID: &str = "rust-zero-r9";
/// A `--features reference` build names itself, and earns no credit anywhere.
#[cfg(feature = "reference")]
const LAB_ID: &str = "rust-zero-r9@reference";

/// The checks, in grading order: one stage per check. Ids and labels match `src/data/labs.ts`.
pub static CHECKS: [CheckDef; 6] = [
    CheckDef { id: "first_word", label: "return a view borrowed from one input", stage: 1, seeded: true, default_seed: 0x9901, run: check_first_word },
    CheckDef { id: "choose_longer", label: "relate a return to two inputs", stage: 2, seeded: true, default_seed: 0x9902, run: check_choose_longer },
    CheckDef { id: "borrowed_block", label: "store a token slice in Block", stage: 3, seeded: true, default_seed: 0x9903, run: check_borrowed_block },
    CheckDef { id: "separate_lifetimes", label: "keep unrelated borrows independent", stage: 4, seeded: true, default_seed: 0x9904, run: check_separate_lifetimes },
    CheckDef { id: "owned_escape", label: "return owned data across a lifetime boundary", stage: 5, seeded: true, default_seed: 0x9905, run: check_owned_escape },
    CheckDef { id: "subslice_contract", label: "return a bounded subslice", stage: 6, seeded: true, default_seed: 0x9906, run: check_subslice_contract },
];

pub static LAB: Lab = Lab { id: LAB_ID, version: 2, checks: &CHECKS };

fn lower_word(rng: &mut Rng) -> String {
    let len = usize_in(rng, 1, 8);
    text(rng, len, LOWER)
}

/// One to four lower-case words separated by single spaces; every fourth input is one word.
/// The answer is the text before the first space, and it must be a view into the input
/// (it starts where the input starts), not a copy.
pub fn check_first_word(ctx: &Ctx) -> Check {
    cases(
        "first_word",
        "return a view borrowed from one input",
        ctx,
        |rng, case| {
            let words = if case % 4 == 0 { 1 } else { usize_in(rng, 2, 4) };
            (0..words).map(|_| lower_word(rng)).collect::<Vec<String>>().join(" ")
        },
        |input| (input.split(' ').next().unwrap_or("").to_owned(), true),
        |input| {
            let word = exercises::first_word(input);
            (word.to_owned(), std::ptr::eq(word.as_ptr(), input.as_ptr()))
        },
    )
}

/// The two lengths always differ, and the longer one is the left argument in half the inputs
/// and the right one in the other half, so neither "always left" nor "always right" passes.
pub fn check_choose_longer(ctx: &Ctx) -> Check {
    cases(
        "choose_longer",
        "relate a return to two inputs",
        ctx,
        |rng, case| {
            let short = usize_in(rng, 1, 8);
            let long = short + usize_in(rng, 1, 4);
            let (left_len, right_len) = if case % 2 == 0 { (long, short) } else { (short, long) };
            (text(rng, left_len, LOWER), text(rng, right_len, LOWER))
        },
        |(left, right)| if left.len() > right.len() { left.clone() } else { right.clone() },
        |(left, right)| exercises::longer(left, right).to_owned(),
    )
}

/// One to eight tokens. The block must hold the very slice it was given (same start, same
/// length), not a copy of the numbers.
pub fn check_borrowed_block(ctx: &Ctx) -> Check {
    cases(
        "borrowed_block",
        "store a token slice in Block",
        ctx,
        |rng, _| {
            let len = usize_in(rng, 1, 8);
            (0..len).map(|_| u32_in(rng, 0, 50_000)).collect::<Vec<u32>>()
        },
        |tokens| (tokens.clone(), true),
        |tokens| {
            let block = exercises::make_block(tokens);
            (block.tokens.to_vec(), std::ptr::eq(block.tokens, tokens.as_slice()))
        },
    )
}

/// `right` is dropped before the answer is used: this compiles only when the answer's lifetime
/// is `left`'s alone. The answer must be `left` itself (same text, same address).
pub fn check_separate_lifetimes(ctx: &Ctx) -> Check {
    cases(
        "separate_lifetimes",
        "keep unrelated borrows independent",
        ctx,
        |rng, _| (lower_word(rng), lower_word(rng)),
        |(left, _)| (left.clone(), true),
        |(left, right)| {
            let kept = {
                let short = right.clone();
                exercises::keep_left(left, &short)
            };
            (kept.to_owned(), std::ptr::eq(kept, left.as_str()))
        },
    )
}

/// The input is dropped before the answer is compared, so the answer has to be owned. Letters
/// and digits in both cases, so changing the text in any way shows. The first input is empty.
pub fn check_owned_escape(ctx: &Ctx) -> Check {
    cases(
        "owned_escape",
        "return owned data across a lifetime boundary",
        ctx,
        |rng, case| {
            let len = if case == 0 { 0 } else { usize_in(rng, 1, 12) };
            text(rng, len, MIXED)
        },
        |input| input.clone(),
        |input| {
            let temporary = input.clone();
            exercises::owned_label(&temporary)
        },
    )
}

/// The slice has two to eight values, and the requested length is, in turn: 0, exactly the
/// length, longer than the slice, and a proper prefix (never the whole slice). The answer is
/// as long as the request allows and starts where the input starts (when it is not empty).
pub fn check_subslice_contract(ctx: &Ctx) -> Check {
    cases(
        "subslice_contract",
        "return a bounded subslice",
        ctx,
        |rng, case| {
            let len = usize_in(rng, 2, 8);
            let values: Vec<u32> = (0..len).map(|_| u32_in(rng, 0, 999)).collect();
            let length = match case % 4 {
                0 => 0,
                1 => len,
                2 => len + usize_in(rng, 1, 5),
                _ => usize_in(rng, 1, len - 1),
            };
            (values, length)
        },
        |(values, length)| (values[..(*length).min(values.len())].to_vec(), true),
        |(values, length)| {
            let part = exercises::prefix(values, *length);
            (part.to_vec(), part.is_empty() || std::ptr::eq(part.as_ptr(), values.as_ptr()))
        },
    )
}

rust_zero_harness::export_lab!(LAB);

#[cfg(test)]
mod tests {
    use super::*;
    use rust_zero_harness::{extra_seeds, run_on};

    macro_rules! check_test {
        ($name:ident) => {
            #[test]
            fn $name() {
                let c = LAB.run_check(stringify!($name), None).expect("check id is in CHECKS");
                assert!(c.pass, "[{}] {}", c.id, c.msg);
            }
        };
    }
    check_test!(first_word);
    check_test!(choose_longer);
    check_test!(borrowed_block);
    check_test!(separate_lifetimes);
    check_test!(owned_escape);
    check_test!(subslice_contract);

    #[test]
    fn seeded_checks_pass_on_32_extra_seeds() {
        for def in CHECKS.iter().filter(|c| c.seeded) {
            for seed in extra_seeds() {
                let c = run_on(&LAB, def.id, seed);
                assert!(c.pass, "[{} seed {}] {}", c.id, seed, c.msg);
            }
        }
    }
}
