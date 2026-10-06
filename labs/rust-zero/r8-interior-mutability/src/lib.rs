//! Rust Zero R8 — Cell, RefCell, and Mutex. Edit only src/exercises.rs.
//!
//! Template v2: each check draws 8 inputs from its seed and compares your
//! function with its own simple oracle, so returning a literal fails. The
//! failure message names the input that broke. `cargo test` runs each check
//! on its default seed and on 32 extra seeds.

pub mod exercises;

use rust_zero_harness::{
    cases, cases_over, i32_in, pick, shuffle, text, u32_in, usize_in, Check, CheckDef, Ctx, Lab, Rng, CASES, LOWER,
};
use std::cell::{Cell, RefCell};
use std::sync::Mutex;

#[cfg(not(feature = "reference"))]
const LAB_ID: &str = "rust-zero-r8";
/// A `--features reference` build names itself, and earns no credit anywhere.
#[cfg(feature = "reference")]
const LAB_ID: &str = "rust-zero-r8@reference";

/// The checks, in grading order: one stage per check. Ids and labels match `src/data/labs.ts`.
pub static CHECKS: [CheckDef; 6] = [
    CheckDef { id: "cell_counter", label: "update a Copy counter through Cell", stage: 1, seeded: true, default_seed: 0x8801, run: check_cell_counter },
    CheckDef { id: "refcell_log", label: "mutate a log behind RefCell", stage: 2, seeded: true, default_seed: 0x8802, run: check_refcell_log },
    CheckDef { id: "conflict_detection", label: "detect a borrow conflict without panic", stage: 3, seeded: true, default_seed: 0x8803, run: check_conflict_detection },
    CheckDef { id: "scoped_borrow", label: "drop a read guard before a write", stage: 4, seeded: true, default_seed: 0x8804, run: check_scoped_borrow },
    CheckDef { id: "mutex_update", label: "update state through a MutexGuard", stage: 5, seeded: true, default_seed: 0x8805, run: check_mutex_update },
    CheckDef { id: "lock_scope", label: "release a guard before the next lock", stage: 6, seeded: true, default_seed: 0x8806, run: check_lock_scope },
];

pub static LAB: Lab = Lab { id: LAB_ID, version: 2, checks: &CHECKS };

fn word(rng: &mut Rng) -> String {
    let len = usize_in(rng, 2, 8);
    text(rng, len, LOWER)
}

/// The first input adds 0; both the counter and the amount are drawn from the seed.
pub fn check_cell_counter(ctx: &Ctx) -> Check {
    cases(
        "cell_counter",
        "update a Copy counter through Cell",
        ctx,
        |rng, case| (usize_in(rng, 0, 1000), if case == 0 { 0 } else { usize_in(rng, 1, 500) }),
        |&(start, amount)| (start + amount, start + amount),
        |&(start, amount)| {
            let counter = Cell::new(start);
            let result = exercises::increment(&counter, amount);
            (result, counter.get())
        },
    )
}

/// The first log is empty; the others hold one to three lines already.
pub fn check_refcell_log(ctx: &Ctx) -> Check {
    cases(
        "refcell_log",
        "mutate a log behind RefCell",
        ctx,
        |rng, case| {
            let lines = if case == 0 { 0 } else { usize_in(rng, 1, 3) };
            ((0..lines).map(|_| word(rng)).collect::<Vec<String>>(), word(rng))
        },
        |(lines, message)| {
            let mut all = lines.clone();
            all.push(message.clone());
            (lines.len() + 1, all)
        },
        |(lines, message)| {
            let log = RefCell::new(lines.clone());
            let length = exercises::append_log(&log, message);
            (length, log.into_inner())
        },
    )
}

#[derive(Debug, Clone, Copy)]
pub enum Hold {
    /// Nobody holds the cell.
    Free,
    /// This many `Ref` guards are alive.
    Readers(usize),
    /// A `RefMut` guard is alive.
    Writer,
}

/// Every way to hold the cell (free, one to three readers, a writer) appears, in a seeded
/// order. While it is held your function must answer without panicking; when it returns, the
/// harness lets go and the cell must be free again (a guard you leaked would keep it locked),
/// with its contents untouched.
pub fn check_conflict_detection(ctx: &Ctx) -> Check {
    cases_over(
        "conflict_detection",
        "detect a borrow conflict without panic",
        ctx,
        |rng| {
            let mut holds = vec![Hold::Free, Hold::Readers(usize_in(rng, 1, 3)), Hold::Writer];
            shuffle(rng, &mut holds);
            while holds.len() < CASES {
                let readers = usize_in(rng, 1, 3);
                holds.push(pick(rng, &[Hold::Free, Hold::Readers(readers), Hold::Writer]));
            }
            holds
                .into_iter()
                .map(|hold| (hold, (0..usize_in(rng, 0, 4)).map(|_| u32_in(rng, 0, 99)).collect::<Vec<u32>>()))
                .collect()
        },
        |(hold, contents)| (matches!(hold, Hold::Free), true, contents.clone()),
        |(hold, contents)| {
            let cell = RefCell::new(contents.clone());
            let mut readers = Vec::new();
            let mut writer = None;
            match hold {
                Hold::Free => {}
                Hold::Readers(count) => readers.extend((0..*count).map(|_| cell.borrow())),
                Hold::Writer => writer = Some(cell.borrow_mut()),
            }
            let available = exercises::mutable_available(&cell);
            drop(readers);
            drop(writer);
            let free_after = cell.try_borrow_mut().is_ok();
            (available, free_after, cell.into_inner())
        },
    )
}

/// The first vector is empty; the others hold one to six numbers, some of them negative.
pub fn check_scoped_borrow(ctx: &Ctx) -> Check {
    cases(
        "scoped_borrow",
        "drop a read guard before a write",
        ctx,
        |rng, case| {
            let len = if case == 0 { 0 } else { usize_in(rng, 1, 6) };
            (0..len).map(|_| i32_in(rng, -20, 50)).collect::<Vec<i32>>()
        },
        |values| {
            let mut total = 0;
            for value in values {
                total += value;
            }
            let mut all = values.clone();
            all.push(total);
            (total, all)
        },
        |values| {
            let cell = RefCell::new(values.clone());
            let total = exercises::read_then_append(&cell);
            (total, cell.into_inner())
        },
    )
}

pub fn check_mutex_update(ctx: &Ctx) -> Check {
    cases(
        "mutex_update",
        "update state through a MutexGuard",
        ctx,
        |rng, case| (i32_in(rng, -500, 500), if case == 0 { 0 } else { i32_in(rng, -100, 100) }),
        |&(start, amount)| (start + amount, start + amount),
        |&(start, amount)| {
            let value = Mutex::new(start);
            let result = exercises::add_locked(&value, amount);
            let stored = *value.lock().unwrap();
            (result, stored)
        },
    )
}

/// The first vector is empty; `first` and `second` always differ, so the order they are
/// pushed in shows.
pub fn check_lock_scope(ctx: &Ctx) -> Check {
    cases(
        "lock_scope",
        "release a guard before the next lock",
        ctx,
        |rng, case| {
            let len = if case == 0 { 0 } else { usize_in(rng, 1, 3) };
            let initial: Vec<u32> = (0..len).map(|_| u32_in(rng, 0, 99)).collect();
            let first = u32_in(rng, 0, 99);
            (initial, first, first + u32_in(rng, 1, 50))
        },
        |(initial, first, second)| {
            let mut all = initial.clone();
            all.push(*first);
            all.push(*second);
            (initial.len() + 2, all)
        },
        |(initial, first, second)| {
            let values = Mutex::new(initial.clone());
            let length = exercises::two_updates(&values, *first, *second);
            (length, values.into_inner().unwrap())
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
    check_test!(cell_counter);
    check_test!(refcell_log);
    check_test!(conflict_detection);
    check_test!(scoped_borrow);
    check_test!(mutex_update);
    check_test!(lock_scope);

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
