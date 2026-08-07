//! The browser and these tests run the same six checks (see src/lib.rs).

use bpe_tokenizer as lab;

macro_rules! lab_test {
    ($name:ident, $check:expr) => {
        #[test]
        fn $name() {
            let c = $check;
            assert!(c.pass, "[{}] {} — {}", c.id, c.label, c.msg);
        }
    };
}

lab_test!(bytes_are_ids, lab::check_bytes_are_ids());
lab_test!(merge_priority, lab::check_merge_priority());
lab_test!(leftmost_nonoverlap, lab::check_leftmost_nonoverlap());
lab_test!(roundtrip, lab::check_roundtrip());
lab_test!(robust_decode, lab::check_robust_decode());
lab_test!(contract, lab::check_contract());
