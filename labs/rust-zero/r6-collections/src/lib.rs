//! Rust Zero R6 — Vec, HashMap, closures, and iterators.
//! Edit only src/exercises.rs.
//!
//! Template v2: each check draws 8 inputs from its seed and compares your
//! function with its own simple oracle, so returning a literal fails. The
//! failure message names the input that broke. `cargo test` runs each check
//! on its default seed and on 32 extra seeds.

pub mod exercises;

use exercises::Job;
use rust_zero_harness::{cases, i32_in, shuffle, u32_in, usize_in, Check, CheckDef, Ctx, Lab, Rng};
use std::collections::HashMap;

#[cfg(not(feature = "reference"))]
const LAB_ID: &str = "rust-zero-r6";
/// A `--features reference` build names itself, and earns no credit anywhere.
#[cfg(feature = "reference")]
const LAB_ID: &str = "rust-zero-r6@reference";

/// The checks, in grading order: one stage per check. Ids and labels match `src/data/labs.ts`.
pub static CHECKS: [CheckDef; 6] = [
    CheckDef { id: "filter_vec", label: "filter owned values into a Vec", stage: 1, seeded: true, default_seed: 0x6601, run: check_filter_vec },
    CheckDef { id: "stable_sort", label: "stable key-based ordering", stage: 2, seeded: true, default_seed: 0x6602, run: check_stable_sort },
    CheckDef { id: "frequency_map", label: "count values with HashMap::entry", stage: 3, seeded: true, default_seed: 0x6603, run: check_frequency_map },
    CheckDef { id: "grouped_sum", label: "accumulate values by key", stage: 4, seeded: true, default_seed: 0x6604, run: check_grouped_sum },
    CheckDef { id: "closure_capture", label: "capture a threshold in a closure", stage: 5, seeded: true, default_seed: 0x6605, run: check_closure_capture },
    CheckDef { id: "iterator_pipeline", label: "compose map, filter, and fold", stage: 6, seeded: true, default_seed: 0x6606, run: check_iterator_pipeline },
];

pub static LAB: Lab = Lab { id: LAB_ID, version: 2, checks: &CHECKS };

/// Values in `-20..=40` in no particular order around `threshold`: one below it, one above it
/// and one equal to it (so `>=` and `>` give different answers), `4..=10` values in all.
fn around(rng: &mut Rng, threshold: i32) -> Vec<i32> {
    let len = usize_in(rng, 4, 10);
    let mut values: Vec<i32> = (0..len).map(|_| i32_in(rng, -20, 40)).collect();
    values[0] = threshold - i32_in(rng, 1, 5);
    values[1] = threshold + i32_in(rng, 1, 5);
    values[2] = threshold;
    shuffle(rng, &mut values);
    values
}

/// The first input is empty; every other one holds the minimum itself, so `>=` and `>` differ.
pub fn check_filter_vec(ctx: &Ctx) -> Check {
    cases(
        "filter_vec",
        "filter owned values into a Vec",
        ctx,
        |rng, case| {
            let minimum = i32_in(rng, -10, 20);
            let values = if case == 0 { Vec::new() } else { around(rng, minimum) };
            (values, minimum)
        },
        |(values, minimum)| {
            let mut kept = Vec::new();
            for &value in values {
                if value >= *minimum {
                    kept.push(value);
                }
            }
            kept
        },
        |(values, minimum)| exercises::filter_at_least(values.clone(), *minimum),
    )
}

/// Three to nine jobs over three lanes, so lanes repeat. Ids are distinct, and the first two
/// jobs share a lane with the later arrival holding the smaller id: ordering by `(lane, id)`
/// or by id alone is not ordering by lane while keeping arrival order.
pub fn check_stable_sort(ctx: &Ctx) -> Check {
    cases(
        "stable_sort",
        "stable key-based ordering",
        ctx,
        |rng, _| {
            let len = usize_in(rng, 3, 9);
            let mut ids: Vec<u8> = (0..len as u8).map(|i| i * 3 + 1).collect();
            shuffle(rng, &mut ids);
            let mut jobs: Vec<Job> = ids.iter().map(|&id| Job { lane: rng.below(3) as u8, id }).collect();
            jobs[1].lane = jobs[0].lane;
            if jobs[0].id < jobs[1].id {
                let id = jobs[0].id;
                jobs[0].id = jobs[1].id;
                jobs[1].id = id;
            }
            jobs
        },
        |jobs| {
            // lane by lane, each in arrival order: no sort at all
            let mut out = Vec::new();
            for lane in 0..=u8::MAX {
                out.extend(jobs.iter().filter(|j| j.lane == lane).cloned());
            }
            out
        },
        |jobs| exercises::stable_by_lane(jobs.clone()),
    )
}

/// Two to four distinct values, each repeated one to four times (the first at least twice),
/// shuffled; the first input is empty.
pub fn check_frequency_map(ctx: &Ctx) -> Check {
    cases(
        "frequency_map",
        "count values with HashMap::entry",
        ctx,
        |rng, case| {
            if case == 0 {
                return Vec::new();
            }
            let kinds = usize_in(rng, 2, 4);
            let mut values = Vec::new();
            for kind in 0..kinds {
                let value = (kind as u32) * 7 + u32_in(rng, 0, 6);
                let times = if kind == 0 { usize_in(rng, 2, 4) } else { usize_in(rng, 1, 4) };
                values.extend(std::iter::repeat(value).take(times));
            }
            shuffle(rng, &mut values);
            values
        },
        |values| {
            // sort, then count each run of equal values
            let mut sorted = values.clone();
            sorted.sort_unstable();
            let mut runs: Vec<(u32, usize)> = Vec::new();
            for value in sorted {
                match runs.last_mut() {
                    Some((last, count)) if *last == value => *count += 1,
                    _ => runs.push((value, 1)),
                }
            }
            runs.into_iter().collect::<HashMap<u32, usize>>()
        },
        |values| exercises::frequencies(values),
    )
}

const KEYS: [&str; 6] = ["prefill", "decode", "cache", "sample", "evict", "route"];

/// Three to nine rows over two to four seeded keys. The first two rows share a key, and no
/// value is 0, so overwriting instead of adding changes the answer.
pub fn check_grouped_sum(ctx: &Ctx) -> Check {
    cases(
        "grouped_sum",
        "accumulate values by key",
        ctx,
        |rng, _| {
            let mut pool = KEYS;
            shuffle(rng, &mut pool);
            let kinds = usize_in(rng, 2, 4);
            let len = usize_in(rng, 3, 9);
            let mut rows: Vec<(String, i32)> = (0..len)
                .map(|_| {
                    let magnitude = i32_in(rng, 1, 50);
                    let value = if rng.below(3) == 0 { -magnitude } else { magnitude };
                    (pool[rng.below(kinds)].to_owned(), value)
                })
                .collect();
            rows[1].0 = rows[0].0.clone();
            rows
        },
        |rows| {
            let mut totals: HashMap<String, i32> = HashMap::new();
            for (key, value) in rows {
                let seen = totals.get(key).copied().unwrap_or(0);
                totals.insert(key.clone(), seen + value);
            }
            totals
        },
        |rows| {
            let borrowed: Vec<(&str, i32)> = rows.iter().map(|(key, value)| (key.as_str(), *value)).collect();
            exercises::sum_by_key(&borrowed)
        },
    )
}

/// The first input is empty; the others hold values below, equal to and above the threshold
/// (only strictly above counts).
pub fn check_closure_capture(ctx: &Ctx) -> Check {
    cases(
        "closure_capture",
        "capture a threshold in a closure",
        ctx,
        |rng, case| {
            let threshold = i32_in(rng, -10, 20);
            let values = if case == 0 { Vec::new() } else { around(rng, threshold) };
            (values, threshold)
        },
        |(values, threshold)| {
            let mut count = 0;
            for &value in values {
                if value > *threshold {
                    count += 1;
                }
            }
            count
        },
        |(values, threshold)| exercises::count_above(values, *threshold),
    )
}

/// The first input is empty; the others hold both even and odd values (zero among the
/// possible evens), so squaring everything, or summing the evens unsquared, is wrong.
pub fn check_iterator_pipeline(ctx: &Ctx) -> Check {
    cases(
        "iterator_pipeline",
        "compose map, filter, and fold",
        ctx,
        |rng, case| {
            if case == 0 {
                return Vec::new();
            }
            let len = usize_in(rng, 2, 10);
            let mut values: Vec<u32> = (0..len).map(|_| u32_in(rng, 0, 40)).collect();
            values[0] = u32_in(rng, 0, 19) * 2 + 1;
            values[1] = u32_in(rng, 1, 20) * 2;
            shuffle(rng, &mut values);
            values
        },
        |values| {
            let mut total = 0;
            for &value in values {
                if value % 2 == 0 {
                    total += value * value;
                }
            }
            total
        },
        |values| exercises::even_square_sum(values),
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
    check_test!(filter_vec);
    check_test!(stable_sort);
    check_test!(frequency_map);
    check_test!(grouped_sum);
    check_test!(closure_capture);
    check_test!(iterator_pipeline);

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
