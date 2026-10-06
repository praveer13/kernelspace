//! R4 student file — solve without cloning or allocating unless required.
//! Each check in src/lib.rs feeds your function 8 inputs drawn from a seed, so the
//! contracts below are what is graded; a function that returns one fixed value fails.

/// Sum of the elements, read through the shared slice: `slice_sum(&[2, 3, 5, 7])` is 17,
/// and an empty slice sums to 0.
pub fn slice_sum(values: &[u32]) -> u32 {
    let _ = values;
    todo!("TODO(you): read through the shared slice")
}

/// Replace every negative element with 0 in place; non-negative elements stay as they are:
/// `[-4, 2, -1, 9]` becomes `[0, 2, 0, 9]`.
pub fn zero_negatives(values: &mut [i32]) {
    let _ = values;
    todo!("TODO(you): mutate through the exclusive slice")
}

/// Swap the first half of the slice with the second half in place (the length is even):
/// `[1, 2, 3, 4]` becomes `[3, 4, 1, 2]`.
pub fn swap_halves(values: &mut [i32]) {
    let _ = values;
    todo!("TODO(you): split into two disjoint mutable slices")
}

/// The text before the first space, or all of `input` when it has no space, as a view into
/// `input` (no allocation): `first_word("paged attention")` is "paged".
pub fn first_word(input: &str) -> &str {
    let _ = input;
    todo!("TODO(you): return a borrowed string view")
}

/// Return the first element (the Vec is never empty) and push a copy of it onto the end:
/// `[11, 22]` becomes `[11, 22, 11]` and the result is 11.
pub fn copy_first_then_push(values: &mut Vec<u32>) -> u32 {
    let _ = values;
    todo!("TODO(you): end the read before mutating the Vec")
}

/// Everything except the first and last element, as a subslice of `values` (it has at least
/// two elements, so the answer may be empty): `middle(&[1, 2, 3, 4, 5])` is `[2, 3, 4]`.
pub fn middle(values: &[u32]) -> &[u32] {
    let _ = values;
    todo!("TODO(you): return a subslice")
}
