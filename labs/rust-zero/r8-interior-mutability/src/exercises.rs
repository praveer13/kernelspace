//! R8 student file — scope every dynamic borrow or lock guard.

use std::cell::{Cell, RefCell};
use std::sync::Mutex;

pub fn increment(cell: &Cell<usize>, amount: usize) -> usize {
    let _ = (cell, amount);
    todo!("TODO(you): get, set, and return the new value")
}

pub fn append_log(log: &RefCell<Vec<String>>, message: &str) -> usize {
    let _ = (log, message);
    todo!("TODO(you): mutate through a RefMut guard")
}

pub fn mutable_available(values: &RefCell<Vec<u32>>) -> bool {
    let _ = values;
    todo!("TODO(you): detect conflicts with try_borrow_mut")
}

pub fn read_then_append(values: &RefCell<Vec<i32>>) -> i32 {
    let _ = values;
    todo!("TODO(you): end the read guard before the write guard")
}

pub fn add_locked(value: &Mutex<i32>, amount: i32) -> i32 {
    let _ = (value, amount);
    todo!("TODO(you): update through the MutexGuard")
}

pub fn two_updates(values: &Mutex<Vec<u32>>, first: u32, second: u32) -> usize {
    let _ = (values, first, second);
    todo!("TODO(you): release the first guard before locking again")
}
