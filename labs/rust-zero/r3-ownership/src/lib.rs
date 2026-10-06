//! Rust Zero R3 — ownership, moves, clones, and drops.
//! Edit only src/exercises.rs.
//!
//! Template v2: each check draws 8 inputs from its seed and compares your
//! function with its own simple oracle, so returning a literal fails. The
//! failure message names the input that broke. `cargo test` runs each check
//! on its default seed and on 32 extra seeds.

pub mod exercises;

use exercises::Request;
use rust_zero_harness::{cases, text, u32_in, usize_in, Check, CheckDef, Ctx, Lab, Rng, LOWER, MIXED};

#[cfg(not(feature = "reference"))]
const LAB_ID: &str = "rust-zero-r3";
/// A `--features reference` build names itself, and earns no credit anywhere.
#[cfg(feature = "reference")]
const LAB_ID: &str = "rust-zero-r3@reference";

/// The checks, in grading order: one stage per check. Ids and labels match `src/data/labs.ts`.
pub static CHECKS: [CheckDef; 6] = [
    CheckDef { id: "copy_scalar", label: "distinguish Copy from move", stage: 1, seeded: true, default_seed: 0x5301, run: check_copy_scalar },
    CheckDef { id: "return_ownership", label: "consume and return an owned String", stage: 2, seeded: true, default_seed: 0x5302, run: check_return_ownership },
    CheckDef { id: "clone_independent", label: "clone only for independent buffers", stage: 3, seeded: true, default_seed: 0x5303, run: check_clone_independent },
    CheckDef { id: "consume_vec", label: "consume a Vec into a result", stage: 4, seeded: true, default_seed: 0x5304, run: check_consume_vec },
    CheckDef { id: "option_take", label: "move a value out through Option::take", stage: 5, seeded: true, default_seed: 0x5305, run: check_option_take },
    CheckDef { id: "replace_field", label: "replace and return an owned field", stage: 6, seeded: true, default_seed: 0x5306, run: check_replace_field },
];

pub static LAB: Lab = Lab { id: LAB_ID, version: 2, checks: &CHECKS };

/// A word of `len` characters from `alphabet`.
fn word(rng: &mut Rng, lo: usize, hi: usize, alphabet: &[u8]) -> String {
    let len = usize_in(rng, lo, hi);
    text(rng, len, alphabet)
}

pub fn check_copy_scalar(ctx: &Ctx) -> Check {
    cases(
        "copy_scalar",
        "distinguish Copy from move",
        ctx,
        |rng, _| u32_in(rng, 0, 1_000_000),
        |&value| (value + 1, value + 2),
        |&value| exercises::copied_plus(value),
    )
}

/// Every name starts with an upper-case letter, so only a real lower-casing passes.
pub fn check_return_ownership(ctx: &Ctx) -> Check {
    cases(
        "return_ownership",
        "consume and return an owned String",
        ctx,
        |rng, _| {
            let head = text(rng, 1, b"ABCDEFGHIJKLMNOPQRSTUVWXYZ");
            head + &word(rng, 2, 11, MIXED)
        },
        |name| name.chars().map(|c| c.to_ascii_lowercase()).collect::<String>(),
        |name| exercises::normalize_owned(name.clone()),
    )
}

/// Mutates the first buffer after the call: the second must not change with it.
pub fn check_clone_independent(ctx: &Ctx) -> Check {
    cases(
        "clone_independent",
        "clone only for independent buffers",
        ctx,
        |rng, _| word(rng, 1, 12, LOWER),
        |value| (format!("{value}!"), value.clone()),
        |value| {
            let (mut left, right) = exercises::duplicate_buffers(value.clone());
            left.push('!');
            (left, right)
        },
    )
}

pub fn check_consume_vec(ctx: &Ctx) -> Check {
    cases(
        "consume_vec",
        "consume a Vec into a result",
        ctx,
        |rng, case| {
            let len = if case == 0 { 0 } else { usize_in(rng, 1, 10) };
            (0..len).map(|_| u32_in(rng, 0, 1000)).collect::<Vec<u32>>()
        },
        |values| values.iter().sum::<u32>(),
        |values| exercises::consume_vec(values.clone()),
    )
}

/// Every fourth slot is already empty.
pub fn check_option_take(ctx: &Ctx) -> Check {
    cases(
        "option_take",
        "move a value out through Option::take",
        ctx,
        |rng, case| if case % 4 == 3 { None } else { Some(word(rng, 1, 10, LOWER)) },
        |slot| (slot.clone(), None),
        |slot| {
            let mut slot = slot.clone();
            let taken = exercises::take_pending(&mut slot);
            (taken, slot)
        },
    )
}

pub fn check_replace_field(ctx: &Ctx) -> Check {
    cases(
        "replace_field",
        "replace and return an owned field",
        ctx,
        |rng, _| (word(rng, 1, 10, LOWER), word(rng, 1, 10, MIXED) + "#"),
        |(old, new)| (old.clone(), new.clone()),
        |(old, new)| {
            let mut request = Request { name: old.clone() };
            let previous = exercises::rename(&mut request, new.clone());
            (previous, request.name)
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
    check_test!(copy_scalar);
    check_test!(return_ownership);
    check_test!(clone_independent);
    check_test!(consume_vec);
    check_test!(option_take);
    check_test!(replace_field);

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
