//! The browser and these tests run the same six checks (see src/lib.rs).

use kv_block_manager as lab;

macro_rules! lab_test {
    ($name:ident, $check:expr) => {
        #[test]
        fn $name() {
            let c = $check;
            assert!(c.pass, "[{}] {} — {}", c.id, c.label, c.msg);
        }
    };
}

lab_test!(paging, lab::check_paging());
lab_test!(capacity, lab::check_capacity());
lab_test!(fork_shares, lab::check_fork_shares());
lab_test!(cow, lab::check_cow());
lab_test!(free_refcount, lab::check_free_refcount());
lab_test!(gauntlet, lab::check_gauntlet());
lab_test!(adapter_unified_paging, lab::check_adapter_unified_paging());
