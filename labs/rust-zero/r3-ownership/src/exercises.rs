//! R3 student file — follow ownership through every signature.

#[derive(Debug, PartialEq)]
pub struct Request {
    pub name: String,
}

pub fn copied_plus(value: u32) -> (u32, u32) {
    let _ = value;
    todo!("TODO(you): Copy the scalar and use both bindings")
}

pub fn normalize_owned(name: String) -> String {
    let _ = name;
    todo!("TODO(you): mutate the owned String and return it")
}

pub fn duplicate_buffers(value: String) -> (String, String) {
    let _ = value;
    todo!("TODO(you): clone only because two independent buffers are required")
}

pub fn consume_vec(values: Vec<u32>) -> u32 {
    let _ = values;
    todo!("TODO(you): consume the Vec into its sum")
}

pub fn take_pending(slot: &mut Option<String>) -> Option<String> {
    let _ = slot;
    todo!("TODO(you): move the String out while leaving None")
}

pub fn rename(request: &mut Request, replacement: String) -> String {
    let _ = (request, replacement);
    todo!("TODO(you): replace the field and return its previous owner")
}
