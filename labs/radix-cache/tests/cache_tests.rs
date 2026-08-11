//! The browser and these tests run the same six checks (see src/lib.rs).

use radix_cache as lab;

macro_rules! lab_test {
    ($name:ident, $check:expr) => {
        #[test]
        fn $name() {
            let c = $check;
            assert!(c.pass, "[{}] {} — {}", c.id, c.label, c.msg);
        }
    };
}

lab_test!(exact_match, lab::check_exact_match());
lab_test!(longest_prefix, lab::check_longest_prefix());
lab_test!(eviction_order, lab::check_eviction_order());
lab_test!(block_conservation, lab::check_block_conservation());
lab_test!(cow_divergence, lab::check_cow_divergence());
lab_test!(chat_hit_rate, lab::check_chat_hit_rate());
