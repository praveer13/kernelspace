//! The browser and these tests run the same six checks (see src/lib.rs).
//! Want to race a baseline? The simulator is pub: build an FCFS policy in
//! an example, run it on lab::scn_fleet(), compare goodputs.

use batching_scheduler as lab;

macro_rules! lab_test {
    ($name:ident, $check:expr) => {
        #[test]
        fn $name() {
            let c = $check;
            assert!(c.pass, "[{}] {} — {}", c.id, c.label, c.msg);
        }
    };
}

lab_test!(runs_clean, lab::check_runs_clean());
lab_test!(slo_light, lab::check_slo_light());
lab_test!(burst, lab::check_burst());
lab_test!(convoy, lab::check_convoy());
lab_test!(starvation, lab::check_starvation());
lab_test!(goodput_score, lab::check_goodput_score());
