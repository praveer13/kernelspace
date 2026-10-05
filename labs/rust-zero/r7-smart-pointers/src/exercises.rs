//! R7 student file — choose heap and shared-ownership policies deliberately.
//! Each check in src/lib.rs feeds your function 8 inputs drawn from a seed, so the
//! contracts below are what is graded; a function that returns one fixed value fails.
//! The Rc and Arc checks hand you handles the harness already shares, and read the real
//! strong counts, so the answer depends on what you do with the handles.

use std::rc::{Rc, Weak};
use std::sync::Arc;

#[derive(Debug, PartialEq, Eq)]
pub enum List {
    Node(u32, Box<List>),
    End,
}

/// A list of the three values in order, each node owning its tail through a `Box`:
/// `boxed_three([3, 5, 8])` is `Node(3, Node(5, Node(8, End)))`.
pub fn boxed_three(values: [u32; 3]) -> List {
    let _ = values;
    todo!("TODO(you): build a recursively boxed list")
}

/// Make `clones` more owners of `shared` with `Rc::clone` (not a copy of the string) and keep
/// them alive. Return the strong count while they are alive, then the strong count once you
/// have dropped them again. Other owners may already exist: if `shared` has 2 owners,
/// `rc_counts(&shared, 3)` is `(5, 2)`, and `rc_counts(&shared, 0)` is `(2, 2)`.
pub fn rc_counts(shared: &Rc<String>, clones: usize) -> (usize, usize) {
    let _ = (shared, clones);
    todo!("TODO(you): clone and drop Rc handles")
}

/// Take `owner`, make a `Weak` from it, and report what the `Weak` can reach twice: first
/// while `owner` is alive (always `Some` copy of the text), then after you drop `owner`.
/// The second is `Some` when some other owner still keeps the string alive and `None` when
/// yours was the last: with no other owner `weak_liveness` of "kv" is `(Some("kv"), None)`.
pub fn weak_liveness(owner: Rc<String>) -> (Option<String>, Option<String>) {
    let _ = owner;
    todo!("TODO(you): downgrade the Rc and observe liveness before/after drop")
}

/// Make one more owner of `shared` with `Arc::clone` (not a copy of the Vec). Return the strong
/// count while your handle is alive and the sum of the numbers: if `shared` has 1 owner and
/// holds `[2, 3, 5, 7]`, the answer is `(2, 17)`. Drop your handle before you return.
pub fn arc_sum(shared: &Arc<Vec<u32>>) -> (usize, u32) {
    let _ = shared;
    todo!("TODO(you): clone the handle, not the Vec, and sum through it")
}

/// Two handles to one allocation holding `values`: `Arc::ptr_eq` is true and the strong count
/// is 2.
pub fn shared_handles(values: Vec<u32>) -> (Arc<Vec<u32>>, Arc<Vec<u32>>) {
    let _ = values;
    todo!("TODO(you): return two handles to the same allocation")
}

/// Take the string back out of the `Arc` when `handle` is its only owner (`Ok`). When another
/// owner exists, give the same handle back untouched (`Err(handle)`), so nothing is copied.
pub fn recover_unique(handle: Arc<String>) -> Result<String, Arc<String>> {
    let _ = handle;
    todo!("TODO(you): recover T when the Arc has one strong owner")
}

#[allow(dead_code)]
fn type_reminder(_: Rc<String>, _: Weak<String>) {}
