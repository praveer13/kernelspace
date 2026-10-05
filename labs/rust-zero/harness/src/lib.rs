//! Shared check/report harness for the ten Rust Zero micro-crates.
//!
//! Template v2 (R1–R5 so far; R6–R10 still use `equal`/`truth`/`emit`): every
//! check is a `kslab::CheckDef` that draws `CASES` inputs from the seed, asks
//! the harness's own oracle for the right answer, and compares it with what
//! your function returned. A function that returns a literal cannot pass,
//! because the inputs differ on every seed. See each crate's `src/lib.rs`.

use std::fmt::Debug;

pub use kslab;
pub use kslab::{Check, CheckDef, Ctx, Lab, Rng};

/// Inputs each seeded check draws.
pub const CASES: usize = 8;

/// `cargo test` also runs every seeded check on these many extra seeds.
pub const EXTRA_SEEDS: u32 = 32;

/// 32 fixed seeds spread over the u32 range (a Weyl sequence), so a solution that is green in
/// the terminal is green on the site's fresh seeds too.
pub fn extra_seeds() -> impl Iterator<Item = u32> {
    (1..=EXTRA_SEEDS).map(|i| i.wrapping_mul(0x9E37_79B9))
}

/// Draw `CASES` inputs from `ctx.seed` and compare `actual` with the harness's own `expected` on
/// each. `generate` gets the case number too, so it can guarantee a mix of shapes (below, inside
/// and above a range, say) while the numbers themselves come from the seed.
pub fn cases<I, O>(
    id: &'static str,
    label: &'static str,
    ctx: &Ctx,
    generate: impl Fn(&mut Rng, usize) -> I,
    expected: impl Fn(&I) -> O,
    actual: impl Fn(&I) -> O,
) -> Check
where
    I: Debug,
    O: Debug + PartialEq,
{
    cases_over(id, label, ctx, |rng| (0..CASES).map(|case| generate(rng, case)).collect(), expected, actual)
}

/// Like `cases`, for inputs that need to be planned together (a shuffled walk through every
/// variant of an enum, say). `generate` returns the `CASES` inputs.
pub fn cases_over<I, O>(
    id: &'static str,
    label: &'static str,
    ctx: &Ctx,
    generate: impl Fn(&mut Rng) -> Vec<I>,
    expected: impl Fn(&I) -> O,
    actual: impl Fn(&I) -> O,
) -> Check
where
    I: Debug,
    O: Debug + PartialEq,
{
    let mut rng = Rng::seeded(ctx.seed);
    let inputs = generate(&mut rng);
    debug_assert_eq!(inputs.len(), CASES);
    for (case, input) in inputs.iter().enumerate() {
        let want = expected(input);
        let got = actual(input);
        if got != want {
            return Check::fail(
                id,
                label,
                format!("input {} of {CASES}: {input:?}, expected {want:?}, got {got:?}", case + 1),
            );
        }
    }
    Check::pass(id, label, format!("ok: all {CASES} inputs matched"))
}

/// An integer in `lo..=hi`.
pub fn int(rng: &mut Rng, lo: i64, hi: i64) -> i64 {
    lo + rng.below((hi - lo + 1) as usize) as i64
}

pub fn i32_in(rng: &mut Rng, lo: i32, hi: i32) -> i32 {
    int(rng, lo as i64, hi as i64) as i32
}

pub fn u32_in(rng: &mut Rng, lo: u32, hi: u32) -> u32 {
    lo + (rng.next() % (hi as u64 - lo as u64 + 1)) as u32
}

pub fn usize_in(rng: &mut Rng, lo: usize, hi: usize) -> usize {
    rng.range(lo, hi)
}

/// One element of a non-empty slice.
pub fn pick<T: Copy>(rng: &mut Rng, from: &[T]) -> T {
    from[rng.below(from.len())]
}

/// Fisher–Yates, driven by the seed.
pub fn shuffle<T>(rng: &mut Rng, items: &mut [T]) {
    for i in (1..items.len()).rev() {
        items.swap(i, rng.below(i + 1));
    }
}

/// `len` characters drawn from `alphabet` (ASCII).
pub fn text(rng: &mut Rng, len: usize, alphabet: &[u8]) -> String {
    (0..len).map(|_| pick(rng, alphabet) as char).collect()
}

pub const LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
pub const MIXED: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/// Declares `ks_abi_version` (ABI v2) and a one-line `ks_run` for a template-v2 crate.
#[macro_export]
macro_rules! export_lab {
    ($lab:expr) => {
        $crate::kslab::export_abi_v2!();

        #[no_mangle]
        pub extern "C" fn ks_run(in_ptr: u32, in_len: u32) -> u64 {
            $crate::kslab::run(unsafe { $crate::kslab::input(in_ptr, in_len) }, &$lab)
        }
    };
}

/// A seeded check on one seed, for the 32-extra-seeds tests.
pub fn run_on(lab: &Lab, id: &str, seed: u32) -> Check {
    lab.run_check(id, Some(seed)).expect("check id is in CHECKS")
}

/* ----------------------- v1 helpers (R6–R10 until C12b) ----------------------- */

pub fn equal<T>(id: &'static str, label: &'static str, actual: T, expected: T) -> Check
where
    T: Debug + PartialEq,
{
    if actual == expected {
        Check::pass(id, label, format!("ok: {actual:?}"))
    } else {
        Check::fail(id, label, format!("expected {expected:?}, got {actual:?}"))
    }
}

pub fn truth(
    id: &'static str,
    label: &'static str,
    passed: bool,
    success: &'static str,
    failure: &'static str,
) -> Check {
    if passed {
        Check::pass(id, label, success)
    } else {
        Check::fail(id, label, failure)
    }
}

pub fn emit(lab: &'static str, checks: Vec<Check>) -> u64 {
    kslab::emit(&kslab::Report {
        lab,
        version: 1,
        checks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn drawn(seed: u32) -> Vec<usize> {
        let seen = RefCell::new(Vec::new());
        let ctx = Ctx { seed, fresh: true };
        let c = cases("t", "t", &ctx, |r, _| r.below(1000), |x| *x, |x| {
            seen.borrow_mut().push(*x);
            *x
        });
        assert!(c.pass);
        seen.into_inner()
    }

    #[test]
    fn cases_draw_eight_inputs_from_the_seed() {
        let a = drawn(5);
        assert_eq!(a.len(), CASES);
        assert_eq!(a, drawn(5));
        assert_ne!(a, drawn(6));
    }

    #[test]
    fn a_returned_literal_fails_on_every_seed_tried() {
        let literal = |seed| {
            let ctx = Ctx { seed, fresh: true };
            cases("t", "t", &ctx, |r, _| r.below(1000), |x| *x + 1, |_| 11)
        };
        assert_eq!((0..1000u32).filter(|s| literal(*s).pass).count(), 0);
        let c = literal(3);
        assert!(!c.pass);
        assert!(c.msg.starts_with("input 1 of 8: "), "{}", c.msg);
    }

    #[test]
    fn shuffle_is_a_permutation_and_ranges_hold() {
        let mut rng = Rng::seeded(9);
        let mut v = [1, 2, 3, 4, 5];
        shuffle(&mut rng, &mut v);
        v.sort();
        assert_eq!(v, [1, 2, 3, 4, 5]);
        for _ in 0..1000 {
            assert!((-7..=7).contains(&i32_in(&mut rng, -7, 7)));
            assert!((3..=9).contains(&u32_in(&mut rng, 3, 9)));
        }
        let _ = u32_in(&mut rng, 0, u32::MAX);
    }

    #[test]
    fn extra_seeds_are_32_and_distinct() {
        let mut seeds: Vec<u32> = extra_seeds().collect();
        seeds.sort();
        seeds.dedup();
        assert_eq!(seeds.len(), 32);
    }
}
