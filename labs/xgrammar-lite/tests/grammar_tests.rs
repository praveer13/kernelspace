//! The browser and these tests run the same six checks (see src/lib.rs).

use xgrammar_lite as lab;

macro_rules! lab_test {
    ($name:ident, $check:expr) => {
        #[test]
        fn $name() {
            let check = $check;
            assert!(check.pass, "[{}] {} — {}", check.id, check.label, check.msg);
        }
    };
}

lab_test!(schema_compile, lab::check_schema_compile());
lab_test!(valid_acceptance, lab::check_valid_acceptance());
lab_test!(earliest_rejection, lab::check_earliest_rejection());
lab_test!(token_mask, lab::check_token_mask());
lab_test!(mask_overhead, lab::check_mask_overhead());
lab_test!(compile_cache, lab::check_compile_cache());
