//! R7 student file — choose heap and shared-ownership policies deliberately.

use std::rc::{Rc, Weak};
use std::sync::Arc;

#[derive(Debug, PartialEq, Eq)]
pub enum List {
    Node(u32, Box<List>),
    End,
}

pub fn boxed_three(values: [u32; 3]) -> List {
    let _ = values;
    todo!("TODO(you): build a recursively boxed list")
}

pub fn rc_counts(value: String) -> (usize, usize) {
    let _ = value;
    todo!("TODO(you): clone and drop one Rc handle")
}

pub fn weak_liveness(value: String) -> (bool, bool) {
    let _ = value;
    todo!("TODO(you): downgrade Rc and observe liveness before/after drop")
}

pub fn arc_sum(values: Vec<u32>) -> (usize, u32) {
    let _ = values;
    todo!("TODO(you): share one Vec allocation through Arc")
}

pub fn shared_handles(values: Vec<u32>) -> (Arc<Vec<u32>>, Arc<Vec<u32>>) {
    let _ = values;
    todo!("TODO(you): return two handles to the same allocation")
}

pub fn recover_unique(value: String) -> Result<String, Arc<String>> {
    let _ = value;
    todo!("TODO(you): recover T when the Arc has one strong owner")
}

#[allow(dead_code)]
fn type_reminder(_: Rc<String>, _: Weak<String>) {}
