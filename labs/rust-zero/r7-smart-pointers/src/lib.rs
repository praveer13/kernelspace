//! Rust Zero R7 — Box, Rc, Weak, and Arc. Edit only src/exercises.rs.
//!
//! Template v2: each check draws 8 inputs from its seed and compares your
//! function with its own simple oracle, so returning a literal fails. The
//! failure message names the input that broke. `cargo test` runs each check
//! on its default seed and on 32 extra seeds.
//!
//! The reference-count checks hand you handles the harness already shares
//! (`base` owners it keeps itself), so the right answer depends on the real
//! counts, not on a constant.

pub mod exercises;

use exercises::List;
use rust_zero_harness::{cases, text, u32_in, usize_in, Check, CheckDef, Ctx, Lab, Rng, LOWER};
use std::rc::Rc;
use std::sync::Arc;

#[cfg(not(feature = "reference"))]
const LAB_ID: &str = "rust-zero-r7";
/// A `--features reference` build names itself, and earns no credit anywhere.
#[cfg(feature = "reference")]
const LAB_ID: &str = "rust-zero-r7@reference";

/// The checks, in grading order: one stage per check. Ids and labels match `src/data/labs.ts`.
pub static CHECKS: [CheckDef; 6] = [
    CheckDef { id: "boxed_list", label: "own a recursive tail through Box", stage: 1, seeded: true, default_seed: 0x7701, run: check_boxed_list },
    CheckDef { id: "rc_counts", label: "track Rc strong owners", stage: 2, seeded: true, default_seed: 0x7702, run: check_rc_counts },
    CheckDef { id: "weak_edge", label: "hold a non-owning Weak edge", stage: 3, seeded: true, default_seed: 0x7703, run: check_weak_edge },
    CheckDef { id: "arc_share", label: "share immutable data with Arc", stage: 4, seeded: true, default_seed: 0x7704, run: check_arc_share },
    CheckDef { id: "handle_clone", label: "clone a handle, not its payload", stage: 5, seeded: true, default_seed: 0x7705, run: check_handle_clone },
    CheckDef { id: "unwrap_unique", label: "recover a uniquely owned Arc value", stage: 6, seeded: true, default_seed: 0x7706, run: check_unwrap_unique },
];

pub static LAB: Lab = Lab { id: LAB_ID, version: 2, checks: &CHECKS };

fn word(rng: &mut Rng) -> String {
    let len = usize_in(rng, 1, 10);
    text(rng, len, LOWER)
}

/// Three values that are all different, so a list built back to front or with a repeated
/// value is a different list.
pub fn check_boxed_list(ctx: &Ctx) -> Check {
    cases(
        "boxed_list",
        "own a recursive tail through Box",
        ctx,
        |rng, _| {
            let first = u32_in(rng, 0, 1000);
            let second = first + u32_in(rng, 1, 500);
            let third = second + u32_in(rng, 1, 500);
            let mut values = [first, second, third];
            if rng.below(2) == 0 {
                values.reverse();
            }
            values
        },
        |values| values.iter().rev().fold(List::End, |tail, &value| List::Node(value, Box::new(tail))),
        |&values| exercises::boxed_three(values),
    )
}

/// The harness already holds `base` (1 to 3) owners of the string. You clone `clones` (0 to 5)
/// more, count, drop your clones and count again; the harness counts once more afterwards, so
/// a clone you leak shows up.
pub fn check_rc_counts(ctx: &Ctx) -> Check {
    cases(
        "rc_counts",
        "track Rc strong owners",
        ctx,
        |rng, case| {
            let base = if case == 0 { 1 } else { usize_in(rng, 1, 3) };
            let clones = if case == 1 { 0 } else { usize_in(rng, 0, 5) };
            (base, clones, word(rng))
        },
        |&(base, clones, _)| (base + clones, base, base),
        |(base, clones, value)| {
            let shared = Rc::new(value.clone());
            let held: Vec<Rc<String>> = (1..*base).map(|_| Rc::clone(&shared)).collect();
            let (alive, dropped) = exercises::rc_counts(&shared, *clones);
            let after = Rc::strong_count(&shared);
            drop(held);
            (alive, dropped, after)
        },
    )
}

/// Half of the inputs leave no other owner when yours is dropped (so the Weak must fail to
/// upgrade), half keep one or two (so it must still upgrade, to the same text).
pub fn check_weak_edge(ctx: &Ctx) -> Check {
    cases(
        "weak_edge",
        "hold a non-owning Weak edge",
        ctx,
        |rng, case| {
            let others = if case % 2 == 0 { 0 } else { usize_in(rng, 1, 2) };
            (others, word(rng))
        },
        |(others, value)| (Some(value.clone()), if *others > 0 { Some(value.clone()) } else { None }),
        |(others, value)| {
            let owner = Rc::new(value.clone());
            let held: Vec<Rc<String>> = (0..*others).map(|_| Rc::clone(&owner)).collect();
            let answer = exercises::weak_liveness(owner);
            drop(held);
            answer
        },
    )
}

/// The harness already holds `base` (1 to 3) handles to a list of one to eight numbers. You
/// make one more handle and report the strong count with it alive, and the sum of the list;
/// the harness counts once more afterwards. Copying the list instead of the handle reports 1.
pub fn check_arc_share(ctx: &Ctx) -> Check {
    cases(
        "arc_share",
        "share immutable data with Arc",
        ctx,
        |rng, case| {
            let base = if case == 0 { 1 } else { usize_in(rng, 1, 3) };
            let len = usize_in(rng, 1, 8);
            let values: Vec<u32> = (0..len).map(|_| u32_in(rng, 0, 1000)).collect();
            (base, values)
        },
        |(base, values)| {
            let mut total = 0;
            for value in values {
                total += value;
            }
            (base + 1, total, *base)
        },
        |(base, values)| {
            let shared = Arc::new(values.clone());
            let held: Vec<Arc<Vec<u32>>> = (1..*base).map(|_| Arc::clone(&shared)).collect();
            let (count, total) = exercises::arc_sum(&shared);
            let after = Arc::strong_count(&shared);
            drop(held);
            (count, total, after)
        },
    )
}

/// Two handles must point to one allocation (a deep copy for each handle is a different
/// allocation), exactly two owners hold it, dropping one leaves one, and the payload is the
/// numbers passed in.
pub fn check_handle_clone(ctx: &Ctx) -> Check {
    cases(
        "handle_clone",
        "clone a handle, not its payload",
        ctx,
        |rng, case| {
            let len = if case == 0 { 0 } else { usize_in(rng, 1, 8) };
            (0..len).map(|_| u32_in(rng, 0, 1000)).collect::<Vec<u32>>()
        },
        |values| (true, 2, 1, values.clone()),
        |values| {
            let (left, right) = exercises::shared_handles(values.clone());
            let same = Arc::ptr_eq(&left, &right);
            let owners = Arc::strong_count(&left);
            drop(right);
            (same, owners, Arc::strong_count(&left), left.as_ref().clone())
        },
    )
}

/// Alternating inputs: a handle nobody else holds (the string comes back out as `Ok`), and a
/// handle the harness also keeps (it must come back as `Err`, still sharing the allocation,
/// not copied out).
pub fn check_unwrap_unique(ctx: &Ctx) -> Check {
    cases(
        "unwrap_unique",
        "recover a uniquely owned Arc value",
        ctx,
        |rng, case| (case % 2 == 0, word(rng)),
        |(unique, value)| if *unique { Ok(value.clone()) } else { Err((value.clone(), 2, true)) },
        |(unique, value)| {
            let handle = Arc::new(value.clone());
            let keeper = if *unique { None } else { Some(Arc::clone(&handle)) };
            match exercises::recover_unique(handle) {
                Ok(recovered) => Ok(recovered),
                Err(back) => {
                    let still_shared = keeper.as_ref().map_or(false, |keeper| Arc::ptr_eq(keeper, &back));
                    Err((back.as_ref().clone(), Arc::strong_count(&back), still_shared))
                }
            }
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
    check_test!(boxed_list);
    check_test!(rc_counts);
    check_test!(weak_edge);
    check_test!(arc_share);
    check_test!(handle_clone);
    check_test!(unwrap_unique);

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
