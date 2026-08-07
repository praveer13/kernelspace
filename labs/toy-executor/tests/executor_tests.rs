//! The browser and these tests run the same six checks (see src/lib.rs).

use toy_executor as lab;

macro_rules! lab_test {
    ($name:ident, $check:expr) => {
        #[test]
        fn $name() {
            let c = $check;
            assert!(c.pass, "[{}] {} — {}", c.id, c.label, c.msg);
        }
    };
}

lab_test!(block_on, lab::check_block_on());
lab_test!(fifo_poll, lab::check_fifo_poll());
lab_test!(pending_repoll, lab::check_pending_repoll());
lab_test!(ping_pong, lab::check_ping_pong());
lab_test!(many_tasks, lab::check_many_tasks());
lab_test!(nested_spawn, lab::check_nested_spawn());
