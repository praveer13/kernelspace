//! Rust Zero R5 — structs, enums, Option, Result, and question-mark.
//! Edit only src/exercises.rs.
//!
//! Template v2: each check draws 8 inputs from its seed and compares your
//! function with its own simple oracle, so returning a literal fails. The
//! failure message names the input that broke. `cargo test` runs each check
//! on its default seed and on 32 extra seeds.

pub mod exercises;

use exercises::{Block, Phase};
use rust_zero_harness::{
    cases, cases_over, pick, shuffle, u32_in, usize_in, Check, CheckDef, Ctx, Lab, Rng, CASES,
};

#[cfg(not(feature = "reference"))]
const LAB_ID: &str = "rust-zero-r5";
/// A `--features reference` build names itself, and earns no credit anywhere.
#[cfg(feature = "reference")]
const LAB_ID: &str = "rust-zero-r5@reference";

/// The checks, in grading order: one stage per check. Ids and labels match `src/data/labs.ts`.
pub static CHECKS: [CheckDef; 6] = [
    CheckDef { id: "block_method", label: "derive a value through a struct method", stage: 1, seeded: true, default_seed: 0x5501, run: check_block_method },
    CheckDef { id: "state_match", label: "exhaustively match an enum state", stage: 2, seeded: true, default_seed: 0x5502, run: check_state_match },
    CheckDef { id: "option_lookup", label: "return optional lookup state", stage: 3, seeded: true, default_seed: 0x5503, run: check_option_lookup },
    CheckDef { id: "result_validate", label: "validate with a typed error", stage: 4, seeded: true, default_seed: 0x5504, run: check_result_validate },
    CheckDef { id: "question_mark", label: "propagate parse failure with ?", stage: 5, seeded: true, default_seed: 0x5505, run: check_question_mark },
    CheckDef { id: "nested_match", label: "match Option containing an enum", stage: 6, seeded: true, default_seed: 0x5506, run: check_nested_match },
];

pub static LAB: Lab = Lab { id: LAB_ID, version: 2, checks: &CHECKS };

const PHASES: [Phase; 3] = [Phase::Prefill, Phase::Decode, Phase::Done];

/// Every variant once in a seeded order, then the rest drawn at random.
fn walk<T: Copy>(rng: &mut Rng, every: &[T]) -> Vec<T> {
    let mut all = every.to_vec();
    shuffle(rng, &mut all);
    while all.len() < CASES {
        all.push(pick(rng, every));
    }
    all
}

/// Under, exactly at and over capacity: the free space never underflows.
pub fn check_block_method(ctx: &Ctx) -> Check {
    cases(
        "block_method",
        "derive a value through a struct method",
        ctx,
        |rng, case| {
            let capacity = usize_in(rng, 1, 512);
            let used = match case % 4 {
                2 => capacity,
                3 => capacity + usize_in(rng, 1, 100),
                _ => usize_in(rng, 0, capacity - 1),
            };
            (used, capacity)
        },
        |&(used, capacity)| capacity.saturating_sub(used),
        |&(used, capacity)| Block { used, capacity }.free(),
    )
}

pub fn check_state_match(ctx: &Ctx) -> Check {
    cases_over(
        "state_match",
        "exhaustively match an enum state",
        ctx,
        |rng| walk(rng, &PHASES),
        |phase| match phase {
            Phase::Prefill => "prefill",
            Phase::Decode => "decode",
            Phase::Done => "done",
        },
        |&phase| exercises::phase_label(phase),
    )
}

/// Some slices have no even number; others have one at a seeded position past the front, and
/// the longer ones a second even number after it.
pub fn check_option_lookup(ctx: &Ctx) -> Check {
    cases(
        "option_lookup",
        "return optional lookup state",
        ctx,
        |rng, case| {
            let odd = |rng: &mut Rng| u32_in(rng, 0, 50) * 2 + 1;
            let len = usize_in(rng, 3, 8);
            let mut v: Vec<u32> = (0..len).map(|_| odd(rng)).collect();
            match case % 3 {
                0 => {
                    let first = usize_in(rng, 1, len - 1);
                    v[first] = u32_in(rng, 0, 50) * 2;
                }
                1 => {
                    let first = usize_in(rng, 0, len - 2);
                    v[first] = u32_in(rng, 0, 50) * 2;
                    v[len - 1] = u32_in(rng, 0, 50) * 2;
                }
                _ => {
                    if case == 2 {
                        v.clear();
                    }
                }
            }
            v
        },
        |values| values.iter().copied().find(|v| v % 2 == 0),
        |values| exercises::first_even(values),
    )
}

pub fn check_result_validate(ctx: &Ctx) -> Check {
    cases(
        "result_validate",
        "validate with a typed error",
        ctx,
        |rng, case| if case % 4 == 0 { 0 } else { usize_in(rng, 1, 4096) },
        |&capacity| if capacity == 0 { Err("capacity must be positive") } else { Ok(capacity) },
        |&capacity| exercises::validate_capacity(capacity),
    )
}

/// Good pairs, a bad right side, a bad left side, and one pair that is bad on both sides.
pub fn check_question_mark(ctx: &Ctx) -> Check {
    const KINDS: [(bool, bool); CASES] = [
        (true, true),
        (true, true),
        (true, false),
        (false, true),
        (true, true),
        (true, false),
        (false, true),
        (false, false),
    ];
    cases(
        "question_mark",
        "propagate parse failure with ?",
        ctx,
        |rng, case| {
            let (left_ok, right_ok) = KINDS[case];
            let mut side = |ok: bool| {
                if ok {
                    u32_in(rng, 0, 1_000_000).to_string()
                } else {
                    pick(rng, &["nope", "", "12x", "7 7", "abc", "3.5", "x1", "-4"]).to_owned()
                }
            };
            (side(left_ok), side(right_ok))
        },
        |(left, right)| match (left.parse::<u32>(), right.parse::<u32>()) {
            (Ok(a), Ok(b)) => Ok(a + b),
            (Err(_), _) => Err("invalid left".to_owned()),
            (_, Err(_)) => Err("invalid right".to_owned()),
        },
        |(left, right)| exercises::parse_sum(left, right),
    )
}

pub fn check_nested_match(ctx: &Ctx) -> Check {
    cases_over(
        "nested_match",
        "match Option containing an enum",
        ctx,
        |rng| walk(rng, &[None, Some(Phase::Prefill), Some(Phase::Decode), Some(Phase::Done)]),
        |state| match state {
            None => "missing",
            Some(Phase::Prefill) => "running:prefill",
            Some(Phase::Decode) => "running:decode",
            Some(Phase::Done) => "complete",
        },
        |&state| exercises::describe(state),
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
    check_test!(block_method);
    check_test!(state_match);
    check_test!(option_lookup);
    check_test!(result_validate);
    check_test!(question_mark);
    check_test!(nested_match);

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
