//! R3 student file — follow ownership through every signature.
//! Each check in src/lib.rs feeds your function 8 inputs drawn from a seed, so the
//! contracts below are what is graded; a function that returns one fixed value fails.

#[derive(Debug, PartialEq)]
pub struct Request {
    pub name: String,
}

/// Return `(value + 1, value + 2)`: `value` is Copy, so both bindings can use it.
/// `copied_plus(10)` is `(11, 12)`.
pub fn copied_plus(value: u32) -> (u32, u32) {
    let _ = value;
    todo!("TODO(you): Copy the scalar and use both bindings")
}

/// Consume `name` and return it lower-cased (ASCII), reusing the owned String:
/// `normalize_owned("DeCoDe".to_owned())` is "decode".
pub fn normalize_owned(name: String) -> String {
    let _ = name;
    todo!("TODO(you): mutate the owned String and return it")
}

/// Return two independent Strings that both hold `value`: pushing onto one must not change
/// the other. `duplicate_buffers("rust".to_owned())` is `("rust", "rust")`.
pub fn duplicate_buffers(value: String) -> (String, String) {
    let _ = value;
    todo!("TODO(you): clone only because two independent buffers are required")
}

/// Take the Vec by value and return the sum of its elements: `consume_vec(vec![3, 5, 8])` is 16.
pub fn consume_vec(values: Vec<u32>) -> u32 {
    let _ = values;
    todo!("TODO(you): consume the Vec into its sum")
}

/// Move the String out of `slot`, leaving `None` behind; an already-empty slot gives `None`.
pub fn take_pending(slot: &mut Option<String>) -> Option<String> {
    let _ = slot;
    todo!("TODO(you): move the String out while leaving None")
}

/// Replace `request.name` with `replacement` and return the name that was there before.
pub fn rename(request: &mut Request, replacement: String) -> String {
    let _ = (request, replacement);
    todo!("TODO(you): replace the field and return its previous owner")
}
