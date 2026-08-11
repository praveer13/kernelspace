//! Rust Zero R6 — Vec, HashMap, closures, and iterators.
//! Edit only src/exercises.rs.

pub mod exercises;

use exercises::Job;
use rust_zero_harness::{equal, Check};
use std::collections::HashMap;

pub fn check_filter_vec() -> Check {
    equal(
        "filter_vec",
        "filter owned values into a Vec",
        exercises::filter_at_least(vec![1, 8, 3, 13, 5], 5),
        vec![8, 13, 5],
    )
}

pub fn check_stable_sort() -> Check {
    let jobs = vec![
        Job { lane: 2, id: 1 },
        Job { lane: 1, id: 2 },
        Job { lane: 2, id: 3 },
        Job { lane: 1, id: 4 },
    ];
    equal(
        "stable_sort",
        "stable key-based ordering",
        exercises::stable_by_lane(jobs),
        vec![
            Job { lane: 1, id: 2 },
            Job { lane: 1, id: 4 },
            Job { lane: 2, id: 1 },
            Job { lane: 2, id: 3 },
        ],
    )
}

pub fn check_frequency_map() -> Check {
    let expected = HashMap::from([(3, 3), (5, 2), (8, 1)]);
    equal(
        "frequency_map",
        "count values with HashMap::entry",
        exercises::frequencies(&[3, 5, 3, 8, 5, 3]),
        expected,
    )
}

pub fn check_grouped_sum() -> Check {
    let expected = HashMap::from([("decode".to_owned(), 11), ("prefill".to_owned(), 7)]);
    equal(
        "grouped_sum",
        "accumulate values by key",
        exercises::sum_by_key(&[("decode", 3), ("prefill", 7), ("decode", 8)]),
        expected,
    )
}

pub fn check_closure_capture() -> Check {
    equal(
        "closure_capture",
        "capture a threshold in a closure",
        exercises::count_above(&[2, 9, 4, 12, 7], 6),
        3,
    )
}

pub fn check_iterator_pipeline() -> Check {
    equal(
        "iterator_pipeline",
        "compose map, filter, and fold",
        exercises::even_square_sum(&[1, 2, 3, 4, 5, 6]),
        56,
    )
}

pub fn self_checks() -> Vec<Check> {
    vec![
        check_filter_vec(),
        check_stable_sort(),
        check_frequency_map(),
        check_grouped_sum(),
        check_closure_capture(),
        check_iterator_pipeline(),
    ]
}

#[no_mangle]
pub extern "C" fn ks_run(_in_ptr: u32, _in_len: u32) -> u64 {
    rust_zero_harness::emit("rust-zero-r6", self_checks())
}

#[cfg(test)]
mod tests {
    use super::*;
    macro_rules! check_test {
        ($name:ident, $check:expr) => {
            #[test]
            fn $name() {
                let check = $check;
                assert!(check.pass, "[{}] {}", check.id, check.msg);
            }
        };
    }
    check_test!(filter_vec, check_filter_vec());
    check_test!(stable_sort, check_stable_sort());
    check_test!(frequency_map, check_frequency_map());
    check_test!(grouped_sum, check_grouped_sum());
    check_test!(closure_capture, check_closure_capture());
    check_test!(iterator_pipeline, check_iterator_pipeline());
}
