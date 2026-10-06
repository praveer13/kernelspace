//! allocator.rs — forge lab 01 · THE ONLY FILE YOU EDIT
//!
//! Mission: a free-list allocator over one fixed heap. No `std::alloc`, no
//! crates — you are the allocator now.
//!
//! Contract (enforced by the harness in src/lib.rs):
//!   * `new(capacity)`        — one contiguous free run of `capacity` bytes
//!   * `alloc(size, align)`   — return Some(offset) with offset % align == 0,
//!                              or None if nothing fits. [offset, offset+size)
//!                              must not overlap any live allocation.
//!   * `free(offset, size)`   — give the exact span back. Neighboring free
//!                              spans must coalesce, or `coalesce` and
//!                              `fragmentation` will eat you.
//!
//! Offset 0 is a valid allocation (the harness never dereferences anything;
//! it only tracks spans).
//!
//! Build it in four stages. Each one turns specific checks green, and each is
//! at most 25 minutes. Go in order: a later stage reuses what an earlier one
//! built. Look for the `STAGE` markers below; the signatures never change.
//!
//!   STAGE 1  boot                      ≈ 2 min    `new` plus a bump `alloc`
//!   STAGE 2  align, no_overlap         ≈ 10 min   `align_up`, and spans
//!   STAGE 3  reuse                     ≈ 20 min   address-ordered free list,
//!                                                 first-fit, split
//!   STAGE 4  coalesce, fragmentation   ≈ 25 min   merge on `free`
//!
//! Check a stage on your machine with `cargo test <check id>`, for example
//! `cargo test boot`. Stage 1 is meant to be quick: it only proves the loop
//! (edit, build, drop the .wasm on the page) works before the real work.
//!
//! Suggested shape for stage 3 and 4 — address-ordered free list:
//!
//!     struct Block { off: usize, size: usize }
//!     free: Vec<Block>          // sorted by off, always coalesced
//!
//!   alloc: first-fit scan → align the start → split prefix/suffix
//!   free:  insert in address order → merge with left/right neighbors
//!
//! Hints:
//!   * align_up(off, align) = (off + align - 1) / align * align   (align ≥ 1)
//!   * Keep size ≥ 1 (alloc(0, _) is legal and must still be unique).
//!   * `coalesce` first uses up the heap's untouched tail, then frees
//!     neighbours and asks for one big span, so only a merged run can serve
//!     it. `fragmentation` churns ~768 KiB live of 1024 KiB on fresh seeds,
//!     and a request may fail only when no free span that large exists. A
//!     bump allocator, or a free list that never merges, fails both. A
//!     first-fit + coalescing allocator passes. That gap is the entire
//!     lesson.
//!
//! When all six checks pass in `cargo test`, build the wasm:
//!   cargo build --release --target wasm32-unknown-unknown
//! and drop target/wasm32-unknown-unknown/release/rust_allocator.wasm
//! onto https://kernelspace.dev/forge/rust-allocator.

pub struct Allocator {
    // TODO(you): your state here. Stage 1 needs only a `capacity` and a
    // bump pointer; stage 3 replaces the pointer with a free list.
    _priv: (),
}

impl Allocator {
    // STAGE 1 · boot · ≈ 2 min
    //   Store `capacity`, start the bump pointer at 0. Nothing else yet.
    pub fn new(capacity: usize) -> Self {
        let _ = capacity;
        todo!("construct your allocator")
    }

    // STAGE 1 · boot (the first, bump-only version)
    //   Return Some(pointer) and move the pointer up by `size`; None when
    //   it would pass `capacity`. No `free`, no alignment yet.
    // STAGE 2 · align, no_overlap · ≈ 10 min
    //   Write `align_up(off, align)` and round the start up before you
    //   place. Then the span is [start, start + size): make it exact, so
    //   the next one begins at `start + size`, never inside it. These two
    //   checks also call `free`: replace its `todo!` with an empty body for
    //   now (a bump allocator gives nothing back), or they trap.
    // STAGE 3 · reuse · ≈ 20 min
    //   Replace the bump pointer with an address-ordered free list.
    //   First-fit: take the first free block that holds `size` after
    //   alignment; split off the prefix and suffix as free blocks.
    pub fn alloc(&mut self, size: usize, align: usize) -> Option<usize> {
        let _ = (size, align);
        todo!("first-fit, align, split")
    }

    // STAGE 2 · until stage 3, an empty body is a fine `free`.
    // STAGE 3 · reuse
    //   Insert the span back into the free list in address order.
    // STAGE 4 · coalesce, fragmentation · ≈ 25 min
    //   After inserting, merge the span with its left neighbour when they
    //   touch, then with its right neighbour. Freeing the middle of three
    //   free blocks must merge all three.
    pub fn free(&mut self, offset: usize, size: usize) {
        let _ = (offset, size);
        todo!("insert in address order, then coalesce")
    }
}
