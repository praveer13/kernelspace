//! Rust Zero R2 — functions and control flow. Edit only src/exercises.rs.
//!
//! Template v2: each check draws 8 inputs from its seed and compares your
//! function with its own simple oracle, so returning a literal fails. The
//! failure message names the input that broke. `cargo test` runs each check
//! on its default seed and on 32 extra seeds.

pub mod exercises;

use rust_zero_harness::{cases, i32_in, pick, u32_in, Check, CheckDef, Ctx, Lab};

#[cfg(not(feature = "reference"))]
const LAB_ID: &str = "rust-zero-r2";
/// A `--features reference` build names itself, and earns no credit anywhere.
#[cfg(feature = "reference")]
const LAB_ID: &str = "rust-zero-r2@reference";

/// The checks, in grading order: one stage per check. Ids and labels match `src/data/labs.ts`.
pub static CHECKS: [CheckDef; 6] = [
    CheckDef { id: "branch_expression", label: "if/else expression", stage: 1, seeded: true, default_seed: 0x5201, run: check_branch_expression },
    CheckDef { id: "range_sum", label: "for over a half-open range", stage: 2, seeded: true, default_seed: 0x5202, run: check_range_sum },
    CheckDef { id: "while_search", label: "condition-driven search", stage: 3, seeded: true, default_seed: 0x5203, run: check_while_search },
    CheckDef { id: "loop_value", label: "break with a value", stage: 4, seeded: true, default_seed: 0x5204, run: check_loop_value },
    CheckDef { id: "tuple_match", label: "exhaustive tuple match", stage: 5, seeded: true, default_seed: 0x5205, run: check_tuple_match },
    CheckDef { id: "guarded_match", label: "match arm guard", stage: 6, seeded: true, default_seed: 0x5206, run: check_guarded_match },
];

pub static LAB: Lab = Lab { id: LAB_ID, version: 2, checks: &CHECKS };

/// Below, inside, above and exactly on an edge of `low..=high`, twice each.
pub fn check_branch_expression(ctx: &Ctx) -> Check {
    cases(
        "branch_expression",
        "if/else expression",
        ctx,
        |rng, case| {
            let low = i32_in(rng, -100, 50);
            let high = low + i32_in(rng, 1, 60);
            let value = match case % 4 {
                0 => low - i32_in(rng, 1, 30),
                1 => i32_in(rng, low, high),
                2 => high + i32_in(rng, 1, 30),
                _ => pick(rng, &[low, high]),
            };
            (value, low, high)
        },
        |&(value, low, high)| value.max(low).min(high),
        |&(value, low, high)| exercises::clamp(value, low, high),
    )
}

/// `n` is 0 and 1 first, then anywhere up to 3,000.
pub fn check_range_sum(ctx: &Ctx) -> Check {
    cases(
        "range_sum",
        "for over a half-open range",
        ctx,
        |rng, case| if case < 2 { case as u32 } else { u32_in(rng, 2, 3000) },
        |&n| (u64::from(n) * u64::from(n.saturating_sub(1)) / 2) as u32,
        |&n| exercises::sum_below(n),
    )
}

/// `start` is 0, an exact multiple, just past one, or anywhere.
pub fn check_while_search(ctx: &Ctx) -> Check {
    cases(
        "while_search",
        "condition-driven search",
        ctx,
        |rng, case| {
            let divisor = u32_in(rng, 1, 60);
            let multiple = u32_in(rng, 0, 80) * divisor;
            let start = match (case, case % 3) {
                (0, _) => 0,
                (_, 0) => multiple,
                (_, 1) if divisor > 1 => multiple + u32_in(rng, 1, divisor - 1),
                _ => u32_in(rng, 0, 5000),
            };
            (start, divisor)
        },
        |&(start, divisor)| start.div_ceil(divisor) * divisor,
        |&(start, divisor)| exercises::first_multiple(start, divisor),
    )
}

/// `limit` is 0, a power of two, one under a power of two, or anywhere.
pub fn check_loop_value(ctx: &Ctx) -> Check {
    cases(
        "loop_value",
        "break with a value",
        ctx,
        |rng, case| match (case, case % 3) {
            (0, _) => 0,
            (_, 1) => 1 << u32_in(rng, 0, 20),
            (_, 2) => (1 << u32_in(rng, 1, 20)) - 1,
            _ => u32_in(rng, 0, 1_000_000),
        },
        |&limit| 1u32 << (32 - limit.leading_zeros()),
        |&limit| exercises::first_power_above(limit),
    )
}

/// Every shape in eight cases: the origin, both axes and all four quadrants.
pub fn check_tuple_match(ctx: &Ctx) -> Check {
    cases(
        "tuple_match",
        "exhaustive tuple match",
        ctx,
        |rng, case| {
            let (mut x, mut y) = (i32_in(rng, 1, 20), i32_in(rng, 1, 20));
            match case % 8 {
                0 => (x, y) = (0, 0),
                1 => y = 0,
                2 => x = -x,
                3 => {}
                4 => (x, y) = (-x, -y),
                5 => y = -y,
                6 => x = 0,
                _ => {
                    if rng.below(2) == 0 {
                        x = -x
                    }
                    if rng.below(2) == 0 {
                        y = -y
                    }
                }
            }
            (x, y)
        },
        |&(x, y)| match (x.signum(), y.signum()) {
            (0, 0) => "origin",
            (0, _) | (_, 0) => "axis",
            (-1, 1) => "north-west",
            (1, 1) => "north-east",
            (-1, -1) => "south-west",
            _ => "south-east",
        },
        |&point| exercises::quadrant(point),
    )
}

/// Each band in turn, with both sides of the 75 % edge. Every seed runs `(0, 0)` and an active
/// load on a disabled slot, so the "disabled" before "idle" order is always tested.
pub fn check_guarded_match(ctx: &Ctx) -> Check {
    cases(
        "guarded_match",
        "match arm guard",
        ctx,
        |rng, case| {
            let capacity = u32_in(rng, 2, 10) as usize * 4;
            match case % 8 {
                0 => (0, 0),
                1 => (0, capacity),
                2 => (capacity + 1 + rng.below(8), capacity),
                3 => (capacity, capacity),
                4 => (rng.below(3) + 1, 0),
                5 => (rng.range(1, capacity * 3 / 4 - 1), capacity),
                6 => (capacity * 3 / 4, capacity),
                _ => (capacity * 3 / 4 - 1, capacity),
            }
        },
        |&(active, capacity)| {
            if capacity == 0 {
                "disabled"
            } else if active == 0 {
                "idle"
            } else if active >= capacity {
                "full"
            } else if active * 4 >= capacity * 3 {
                "hot"
            } else {
                "warm"
            }
        },
        |&(active, capacity)| exercises::load_band(active, capacity),
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
    check_test!(branch_expression);
    check_test!(range_sum);
    check_test!(while_search);
    check_test!(loop_value);
    check_test!(tuple_match);
    check_test!(guarded_match);

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
