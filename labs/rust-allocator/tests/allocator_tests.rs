//! The browser and these tests run the same six checks (see src/lib.rs).
//! `cargo test` failing here = the site would fail too. One source of truth.

use rust_allocator as lab;

macro_rules! lab_test {
    ($name:ident, $check:expr) => {
        #[test]
        fn $name() {
            let c = $check;
            assert!(c.pass, "[{}] {} — {}", c.id, c.label, c.msg);
        }
    };
}

lab_test!(boot, lab::check_boot());
lab_test!(align, lab::check_align());
lab_test!(no_overlap, lab::check_no_overlap());
lab_test!(coalesce, lab::check_coalesce());
lab_test!(reuse, lab::check_reuse());
lab_test!(fragmentation, lab::check_fragmentation());
