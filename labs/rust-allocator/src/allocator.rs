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
//!                              spans must coalesce, or check 4 and 6 will
//!                              eat you.
//!
//! Offset 0 is a valid allocation (the harness never dereferences anything;
//! it only tracks spans).
//!
//! Suggested shape — address-ordered free list:
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
//!   * The fragmentation check churns ~450 KiB live of 1024 KiB. A bump
//!     allocator fails it. A first-fit + coalescing allocator passes with
//!     room to spare. That gap is the entire lesson.
//!
//! When all six checks pass in `cargo test`, build the wasm:
//!   cargo build --release --target wasm32-unknown-unknown
//! and drop target/wasm32-unknown-unknown/release/rust_allocator.wasm
//! onto https://kernelspace.dev/forge/rust-allocator.

pub struct Allocator {
    // TODO(you): your state here. (A `capacity` field and a free list are
    // the classic starting point.)
    _priv: (),
}

impl Allocator {
    pub fn new(capacity: usize) -> Self {
        let _ = capacity;
        todo!("construct your allocator")
    }

    pub fn alloc(&mut self, size: usize, align: usize) -> Option<usize> {
        let _ = (size, align);
        todo!("first-fit, align, split")
    }

    pub fn free(&mut self, offset: usize, size: usize) {
        let _ = (offset, size);
        todo!("insert in address order, then coalesce")
    }
}
