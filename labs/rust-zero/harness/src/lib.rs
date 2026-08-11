//! Shared check/report harness for the ten Rust Zero micro-crates.

use std::fmt::Debug;

pub use kslab::Check;

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
