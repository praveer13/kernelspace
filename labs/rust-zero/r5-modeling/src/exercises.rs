//! R5 student file — model absence and failure explicitly.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Block {
    pub used: usize,
    pub capacity: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Prefill,
    Decode,
    Done,
}

impl Block {
    pub fn free(&self) -> usize {
        todo!("TODO(you): derive free capacity without underflow")
    }
}

pub fn phase_label(phase: Phase) -> &'static str {
    let _ = phase;
    todo!("TODO(you): match every phase")
}

pub fn first_even(values: &[u32]) -> Option<u32> {
    let _ = values;
    todo!("TODO(you): return Some(value) or None")
}

pub fn validate_capacity(capacity: usize) -> Result<usize, &'static str> {
    let _ = capacity;
    todo!("TODO(you): reject zero capacity")
}

pub fn parse_sum(left: &str, right: &str) -> Result<u32, String> {
    let _ = (left, right);
    todo!("TODO(you): parse both values and propagate failure with ?")
}

pub fn describe(state: Option<Phase>) -> &'static str {
    let _ = state;
    todo!("TODO(you): match Option containing an enum")
}
