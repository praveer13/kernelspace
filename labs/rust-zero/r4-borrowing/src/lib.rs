//! Rust Zero R4 — references, mutable references, and slices.
//! Edit only src/exercises.rs.
//!
//! Template v2: each check draws 8 inputs from its seed and compares your
//! function with its own simple oracle, so returning a literal fails. The
//! failure message names the input that broke. `cargo test` runs each check
//! on its default seed and on 32 extra seeds.

pub mod exercises;

use rust_zero_harness::{cases, i32_in, text, u32_in, usize_in, Check, CheckDef, Ctx, Lab, Rng, LOWER};

#[cfg(not(feature = "reference"))]
const LAB_ID: &str = "rust-zero-r4";
/// A `--features reference` build names itself, and earns no credit anywhere.
#[cfg(feature = "reference")]
const LAB_ID: &str = "rust-zero-r4@reference";

/// The checks, in grading order: one stage per check. Ids and labels match `src/data/labs.ts`.
pub static CHECKS: [CheckDef; 6] = [
    CheckDef { id: "slice_sum", label: "read through a shared slice", stage: 1, seeded: true, default_seed: 0x5401, run: check_slice_sum },
    CheckDef { id: "mutate_slice", label: "update through a mutable slice", stage: 2, seeded: true, default_seed: 0x5402, run: check_mutate_slice },
    CheckDef { id: "split_mut", label: "mutate disjoint halves safely", stage: 3, seeded: true, default_seed: 0x5403, run: check_split_mut },
    CheckDef { id: "str_view", label: "accept a borrowed string view", stage: 4, seeded: true, default_seed: 0x5404, run: check_str_view },
    CheckDef { id: "borrow_then_mutate", label: "end a read before mutation", stage: 5, seeded: true, default_seed: 0x5405, run: check_borrow_then_mutate },
    CheckDef { id: "subslice", label: "return a slice tied to the input", stage: 6, seeded: true, default_seed: 0x5406, run: check_subslice },
];

pub static LAB: Lab = Lab { id: LAB_ID, version: 2, checks: &CHECKS };

/// `len` values in `lo..=hi`.
fn numbers(rng: &mut Rng, len: usize, lo: u32, hi: u32) -> Vec<u32> {
    (0..len).map(|_| u32_in(rng, lo, hi)).collect()
}

/// The first case is an empty slice.
pub fn check_slice_sum(ctx: &Ctx) -> Check {
    cases(
        "slice_sum",
        "read through a shared slice",
        ctx,
        |rng, case| {
            let len = if case == 0 { 0 } else { usize_in(rng, 1, 10) };
            numbers(rng, len, 0, 1000)
        },
        |values| values.iter().sum::<u32>(),
        |values| exercises::slice_sum(values),
    )
}

/// Every slice holds at least one negative and one positive value.
pub fn check_mutate_slice(ctx: &Ctx) -> Check {
    cases(
        "mutate_slice",
        "update through a mutable slice",
        ctx,
        |rng, _| {
            let mut v: Vec<i32> = (0..usize_in(rng, 2, 10)).map(|_| i32_in(rng, -50, 50)).collect();
            v[0] = -i32_in(rng, 1, 50);
            v[1] = i32_in(rng, 1, 50);
            v
        },
        |values| values.iter().map(|&v| if v < 0 { 0 } else { v }).collect::<Vec<i32>>(),
        |values| {
            let mut values = values.clone();
            exercises::zero_negatives(&mut values);
            values
        },
    )
}

/// An even number of elements, from 2 up to 10.
pub fn check_split_mut(ctx: &Ctx) -> Check {
    cases(
        "split_mut",
        "mutate disjoint halves safely",
        ctx,
        |rng, case| {
            let half = if case == 0 { 1 } else { usize_in(rng, 2, 5) };
            (0..half * 2).map(|_| i32_in(rng, -50, 50)).collect::<Vec<i32>>()
        },
        |values| {
            let half = values.len() / 2;
            values[half..].iter().chain(values[..half].iter()).copied().collect::<Vec<i32>>()
        },
        |values| {
            let mut values = values.clone();
            exercises::swap_halves(&mut values);
            values
        },
    )
}

/// One to four lower-case words separated by single spaces; every fourth input is one word.
pub fn check_str_view(ctx: &Ctx) -> Check {
    cases(
        "str_view",
        "accept a borrowed string view",
        ctx,
        |rng, case| {
            let words = if case % 4 == 0 { 1 } else { usize_in(rng, 2, 4) };
            let list: Vec<String> = (0..words)
                .map(|_| {
                    let len = usize_in(rng, 1, 8);
                    text(rng, len, LOWER)
                })
                .collect();
            list.join(" ")
        },
        |input| input.split(' ').next().unwrap_or("").to_owned(),
        |input| exercises::first_word(input).to_owned(),
    )
}

pub fn check_borrow_then_mutate(ctx: &Ctx) -> Check {
    cases(
        "borrow_then_mutate",
        "end a read before mutation",
        ctx,
        |rng, _| {
            let len = usize_in(rng, 1, 6);
            numbers(rng, len, 0, 1000)
        },
        |values| {
            let mut after = values.clone();
            after.push(values[0]);
            (values[0], after)
        },
        |values| {
            let mut values = values.clone();
            let first = exercises::copy_first_then_push(&mut values);
            (first, values)
        },
    )
}

/// From two elements (an empty answer) up to nine.
pub fn check_subslice(ctx: &Ctx) -> Check {
    cases(
        "subslice",
        "return a slice tied to the input",
        ctx,
        |rng, case| {
            let len = match case {
                0 => 2,
                1 => 3,
                _ => usize_in(rng, 4, 9),
            };
            numbers(rng, len, 0, 99)
        },
        |values| values.iter().skip(1).take(values.len() - 2).copied().collect::<Vec<u32>>(),
        |values| exercises::middle(values).to_vec(),
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
    check_test!(slice_sum);
    check_test!(mutate_slice);
    check_test!(split_mut);
    check_test!(str_view);
    check_test!(borrow_then_mutate);
    check_test!(subslice);

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
