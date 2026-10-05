//! Rust Zero R10 — atomics and memory orderings. Edit only src/exercises.rs.
//!
//! Template v2: each check draws 8 inputs from its seed and compares your
//! function with its own simple oracle, so returning a literal fails. The
//! failure message names the input that broke. `cargo test` runs each check
//! on its default seed and on 32 extra seeds.
//!
//! These checks run on one thread, so they verify what each operation does to
//! the value (atomicity of the result), not which `Ordering` you chose: the
//! lesson and `exercises.rs` state the ordering each function needs.

pub mod exercises;

use exercises::OrderingUse;
use rust_zero_harness::{cases, cases_over, pick, shuffle, u32_in, usize_in, Check, CheckDef, Ctx, Lab, Rng, CASES};
use std::cell::Cell;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

#[cfg(not(feature = "reference"))]
const LAB_ID: &str = "rust-zero-r10";
/// A `--features reference` build names itself, and earns no credit anywhere.
#[cfg(feature = "reference")]
const LAB_ID: &str = "rust-zero-r10@reference";

/// The checks, in grading order: one stage per check. Ids and labels match `src/data/labs.ts`.
pub static CHECKS: [CheckDef; 6] = [
    CheckDef { id: "relaxed_ticket", label: "allocate ids with a Relaxed fetch-add", stage: 1, seeded: true, default_seed: 0xA001, run: check_relaxed_ticket },
    CheckDef { id: "publish_consume", label: "pair Release publication with Acquire observation", stage: 2, seeded: true, default_seed: 0xA002, run: check_publish_consume },
    CheckDef { id: "compare_exchange", label: "claim a state with CAS", stage: 3, seeded: true, default_seed: 0xA003, run: check_compare_exchange },
    CheckDef { id: "fetch_update", label: "perform conditional atomic update", stage: 4, seeded: true, default_seed: 0xA004, run: check_fetch_update },
    CheckDef { id: "spin_lock", label: "Acquire a flag and Release it", stage: 5, seeded: true, default_seed: 0xA005, run: check_spin_lock },
    CheckDef { id: "ordering_choice", label: "classify counter vs publication orderings", stage: 6, seeded: true, default_seed: 0xA006, run: check_ordering_choice },
];

pub static LAB: Lab = Lab { id: LAB_ID, version: 2, checks: &CHECKS };

/// The counter starts anywhere in `0..=1000` (the first input starts at 0) and hands out one
/// to five tickets; the tickets, in order, and the counter afterwards must match.
pub fn check_relaxed_ticket(ctx: &Ctx) -> Check {
    cases(
        "relaxed_ticket",
        "allocate ids with a Relaxed fetch-add",
        ctx,
        |rng, case| (if case == 0 { 0 } else { usize_in(rng, 1, 1000) }, usize_in(rng, 1, 5)),
        |&(start, count)| ((start..start + count).collect::<Vec<usize>>(), start + count),
        |&(start, count)| {
            let counter = AtomicUsize::new(start);
            let tickets: Vec<usize> = (0..count).map(|_| exercises::next_ticket(&counter)).collect();
            (tickets, counter.load(Ordering::Relaxed))
        },
    )
}

/// `value` starts as an unrelated number and `ready` as false. After your function, the
/// number published must be `next`, the flag must be set, and you must have seen `next`.
pub fn check_publish_consume(ctx: &Ctx) -> Check {
    cases(
        "publish_consume",
        "pair Release publication with Acquire observation",
        ctx,
        |rng, _| {
            let before = usize_in(rng, 0, 1000);
            (before, before + usize_in(rng, 1, 9000))
        },
        |&(_, next)| (Some(next), next, true),
        |&(before, next)| {
            let value = AtomicUsize::new(before);
            let ready = AtomicBool::new(false);
            let seen = exercises::publish_then_consume(&value, &ready, next);
            (seen, value.load(Ordering::SeqCst), ready.load(Ordering::SeqCst))
        },
    )
}

/// Even inputs claim a state that matches (the swap happens, and `Ok` holds the old value);
/// odd inputs claim a state that does not (nothing changes, and `Err` holds the real value).
/// `next` always differs from the current state, so a swap that wrongly happens shows.
pub fn check_compare_exchange(ctx: &Ctx) -> Check {
    cases(
        "compare_exchange",
        "claim a state with CAS",
        ctx,
        |rng, case| {
            let current = usize_in(rng, 0, 1000);
            let next = current + usize_in(rng, 1, 500);
            let expected = if case % 2 == 0 { current } else { current + usize_in(rng, 501, 900) };
            (current, expected, next)
        },
        |&(current, expected, next)| {
            if current == expected {
                (Ok(current), next)
            } else {
                (Err(current), current)
            }
        },
        |&(current, expected, next)| {
            let state = AtomicUsize::new(current);
            let result = exercises::claim(&state, expected, next);
            (result, state.load(Ordering::Relaxed))
        },
    )
}

/// The minimum is above the counter, below it or equal to it (each at least twice, in a seeded
/// order): the counter only ever goes up, and you return what it holds afterwards.
pub fn check_fetch_update(ctx: &Ctx) -> Check {
    cases_over(
        "fetch_update",
        "perform conditional atomic update",
        ctx,
        |rng| {
            let mut kinds: Vec<usize> = (0..CASES).map(|case| case % 3).collect();
            shuffle(rng, &mut kinds);
            kinds
                .into_iter()
                .map(|kind| {
                    let start = usize_in(rng, 10, 1000);
                    let minimum = match kind {
                        0 => start + usize_in(rng, 1, 500),
                        1 => start - usize_in(rng, 1, 9),
                        _ => start,
                    };
                    (start, minimum)
                })
                .collect()
        },
        |&(start, minimum)| {
            let top = if start > minimum { start } else { minimum };
            (top, top)
        },
        |&(start, minimum)| {
            let counter = AtomicUsize::new(start);
            let result = exercises::raise_to(&counter, minimum);
            (result, counter.load(Ordering::Relaxed))
        },
    )
}

/// What the work sees and what is left behind. When the flag is free, your function must have
/// it taken while `work` runs (the harness's closure looks), return `work`'s number, and leave
/// the flag free. When someone else holds it, `work` must not run at all, the answer is `None`,
/// and the flag stays held. Half the inputs are each.
pub fn check_spin_lock(ctx: &Ctx) -> Check {
    cases_over(
        "spin_lock",
        "Acquire a flag and Release it",
        ctx,
        |rng| {
            let mut held: Vec<bool> = (0..CASES).map(|case| case % 2 == 0).collect();
            shuffle(rng, &mut held);
            held.into_iter().map(|held| (held, u32_in(rng, 0, 1_000_000))).collect()
        },
        |&(held, number)| {
            if held {
                (None, None, true)
            } else {
                (Some(number), Some(true), false)
            }
        },
        |&(held, number)| {
            let locked = AtomicBool::new(held);
            let seen: Cell<Option<bool>> = Cell::new(None);
            let result = exercises::lock_round_trip(&locked, || {
                seen.set(Some(locked.load(Ordering::SeqCst)));
                number
            });
            (result, seen.get(), locked.load(Ordering::SeqCst))
        },
    )
}

const USES: [OrderingUse; 3] = [OrderingUse::Counter, OrderingUse::Publish, OrderingUse::Observe];

/// Every use once in a seeded order, then the rest drawn at random.
pub fn check_ordering_choice(ctx: &Ctx) -> Check {
    cases_over(
        "ordering_choice",
        "classify counter vs publication orderings",
        ctx,
        |rng: &mut Rng| {
            let mut all = USES.to_vec();
            shuffle(rng, &mut all);
            while all.len() < CASES {
                all.push(pick(rng, &USES));
            }
            all
        },
        |use_case| match use_case {
            OrderingUse::Counter => Ordering::Relaxed,
            OrderingUse::Publish => Ordering::Release,
            OrderingUse::Observe => Ordering::Acquire,
        },
        |&use_case| exercises::ordering_for(use_case),
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
    check_test!(relaxed_ticket);
    check_test!(publish_consume);
    check_test!(compare_exchange);
    check_test!(fetch_update);
    check_test!(spin_lock);
    check_test!(ordering_choice);

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
