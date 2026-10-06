//! Rust Zero R1 — bindings, scalar types, and expressions.
//! Edit only src/exercises.rs.
//!
//! Template v2: each check draws 8 inputs from its seed and compares your
//! function with its own simple oracle, so returning a literal fails. The
//! failure message names the input that broke. `cargo test` runs each check
//! on its default seed and on 32 extra seeds.

pub mod exercises;

use rust_zero_harness::{cases, i32_in, pick, u32_in, usize_in, Check, CheckDef, Ctx, Lab, Rng};

#[cfg(not(feature = "reference"))]
const LAB_ID: &str = "rust-zero-r1";
/// A `--features reference` build names itself, and earns no credit anywhere.
#[cfg(feature = "reference")]
const LAB_ID: &str = "rust-zero-r1@reference";

/// The checks, in grading order: one stage per check. Ids and labels match `src/data/labs.ts`.
pub static CHECKS: [CheckDef; 6] = [
    CheckDef { id: "mut_accumulate", label: "mutable accumulation", stage: 1, seeded: true, default_seed: 0x5101, run: check_mut_accumulate },
    CheckDef { id: "shadow_convert", label: "shadow a value into a new type", stage: 2, seeded: true, default_seed: 0x5102, run: check_shadow_convert },
    CheckDef { id: "typed_average", label: "explicit numeric conversion", stage: 3, seeded: true, default_seed: 0x5103, run: check_typed_average },
    CheckDef { id: "block_value", label: "return a block expression", stage: 4, seeded: true, default_seed: 0x5104, run: check_block_value },
    CheckDef { id: "branch_value", label: "if as a value", stage: 5, seeded: true, default_seed: 0x5105, run: check_branch_value },
    CheckDef { id: "destructure", label: "tuple destructuring", stage: 6, seeded: true, default_seed: 0x5106, run: check_destructure },
];

pub static LAB: Lab = Lab { id: LAB_ID, version: 2, checks: &CHECKS };

/// Slices of 0–6 values; every non-empty one holds a negative and a positive.
fn values(rng: &mut Rng, case: usize) -> Vec<i32> {
    if case == 0 {
        return Vec::new();
    }
    let mut v: Vec<i32> = (0..usize_in(rng, 2, 6)).map(|_| i32_in(rng, -60, 60)).collect();
    v[0] = -i32_in(rng, 1, 60);
    v[1] = i32_in(rng, 1, 60);
    v
}

pub fn check_mut_accumulate(ctx: &Ctx) -> Check {
    cases(
        "mut_accumulate",
        "mutable accumulation",
        ctx,
        values,
        |v| v.iter().map(|&x| x as i64).sum::<i64>() as i32,
        |v| exercises::accumulate(v),
    )
}

/// Half the inputs are large enough that `kib * 1024` overflows a u32.
pub fn check_shadow_convert(ctx: &Ctx) -> Check {
    cases(
        "shadow_convert",
        "shadow a value into a new type",
        ctx,
        |rng, case| if case % 2 == 0 { u32_in(rng, 1 << 22, u32::MAX) } else { u32_in(rng, 0, 100_000) },
        |&kib| u64::from(kib) << 10,
        |&kib| exercises::kib_to_bytes(kib),
    )
}

/// `total` is never a multiple of `count`, so integer division visibly truncates.
pub fn check_typed_average(ctx: &Ctx) -> Check {
    cases(
        "typed_average",
        "explicit numeric conversion",
        ctx,
        |rng, _| {
            let count = u32_in(rng, 2, 40);
            (u32_in(rng, 0, 200) * count + u32_in(rng, 1, count - 1), count)
        },
        |&(total, count)| f64::from(total) / f64::from(count),
        |&(total, count)| exercises::average(total, count),
    )
}

pub fn check_block_value(ctx: &Ctx) -> Check {
    cases(
        "block_value",
        "return a block expression",
        ctx,
        |rng, _| (usize_in(rng, 1, 200), usize_in(rng, 1, 512)),
        |&(blocks, per_block)| (0..blocks).map(|_| per_block).sum::<usize>(),
        |&(blocks, per_block)| exercises::block_capacity(blocks, per_block),
    )
}

/// Below, exactly at, above, and one under capacity, twice each.
pub fn check_branch_value(ctx: &Ctx) -> Check {
    cases(
        "branch_value",
        "if as a value",
        ctx,
        |rng, case| {
            let capacity = usize_in(rng, 2, 256);
            let active = match case % 4 {
                0 => usize_in(rng, 0, capacity - 1),
                1 => capacity,
                2 => capacity + usize_in(rng, 1, 40),
                _ => capacity - 1,
            };
            (active, capacity)
        },
        |&(active, capacity)| if capacity > active { "open" } else { "full" },
        |&(active, capacity)| exercises::load_label(active, capacity),
    )
}

pub fn check_destructure(ctx: &Ctx) -> Check {
    cases(
        "destructure",
        "tuple destructuring",
        ctx,
        |rng, _| {
            let a = i32_in(rng, -1000, 1000);
            (a, a + pick(rng, &[-37, -5, -1, 1, 8, 90]))
        },
        |&(a, b)| (b, a),
        |&pair| exercises::swap_pair(pair),
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
    check_test!(mut_accumulate);
    check_test!(shadow_convert);
    check_test!(typed_average);
    check_test!(block_value);
    check_test!(branch_value);
    check_test!(destructure);

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
