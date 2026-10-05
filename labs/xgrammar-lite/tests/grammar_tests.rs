//! The browser and these tests run the same six checks (see src/lib.rs).
//! `cargo test` failing here = the site would fail too. One source of truth.
//!
//! Each check runs on its default seed, and every seeded check also runs on
//! 32 extra seeds, so a solution green here is green on the site's fresh seeds.

use xgrammar_lite as lab;

macro_rules! lab_test {
    ($name:ident) => {
        #[test]
        fn $name() {
            let check = lab::LAB.run_check(stringify!($name), None).expect("check id is in CHECKS");
            assert!(check.pass, "[{}] {} — {}", check.id, check.label, check.msg);
        }
    };
}

lab_test!(schema_compile);
lab_test!(valid_acceptance);
lab_test!(earliest_rejection);
lab_test!(token_mask);
lab_test!(mask_overhead);
lab_test!(compile_cache);

/// 32 fixed seeds, spread over the u32 range (a Weyl sequence).
fn extra_seeds() -> impl Iterator<Item = u32> {
    (1..=32u32).map(|i| i.wrapping_mul(0x9E37_79B9))
}

#[test]
fn seeded_checks_pass_on_32_extra_seeds() {
    for def in lab::CHECKS.iter().filter(|c| c.seeded) {
        for seed in extra_seeds() {
            let c = lab::LAB.run_check(def.id, Some(seed)).expect("check id is in CHECKS");
            assert!(c.pass, "[{} seed {}] {} — {}", c.id, seed, c.label, c.msg);
        }
    }
}
