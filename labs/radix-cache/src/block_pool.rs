//! Harness-owned physical block allocator.
//!
//! This is lab 02's refcounted pool factored out as infrastructure for lab
//! 07. A freshly prefetched block list owns one reference. Cache insertion
//! retains the canonical block table; the harness then releases the
//! temporary prefill owner. Shared cache entries therefore have refcount >1,
//! and a block returns to the free list only after its final owner releases.

use std::cell::RefCell;
use std::rc::Rc;

#[derive(Clone)]
pub struct BlockAllocator {
    inner: Rc<RefCell<Pool>>,
}

struct Pool {
    block_size: usize,
    free: Vec<usize>,
    refs: Vec<u32>,
}

impl BlockAllocator {
    pub fn new(num_blocks: usize, block_size: usize) -> Self {
        assert!(num_blocks > 0, "block pool must not be empty");
        assert!(block_size > 0, "block size must not be zero");
        Self {
            inner: Rc::new(RefCell::new(Pool {
                block_size,
                free: (0..num_blocks).rev().collect(),
                refs: vec![0; num_blocks],
            })),
        }
    }

    pub fn block_size(&self) -> usize {
        self.inner.borrow().block_size
    }

    pub fn total_blocks(&self) -> usize {
        self.inner.borrow().refs.len()
    }

    pub fn free_blocks(&self) -> usize {
        self.inner.borrow().free.len()
    }

    pub fn allocated_blocks(&self) -> usize {
        self.inner.borrow().refs.iter().filter(|&&r| r > 0).count()
    }

    pub fn refcount(&self, block: usize) -> u32 {
        self.inner.borrow().refs.get(block).copied().unwrap_or(0)
    }

    /// Allocate physical blocks for a completed prefill. All-or-nothing.
    pub fn allocate_for_tokens(&self, tokens: usize) -> Option<Vec<usize>> {
        if tokens == 0 {
            return None;
        }
        let need = tokens.div_ceil(self.block_size());
        let mut pool = self.inner.borrow_mut();
        if pool.free.len() < need {
            return None;
        }
        let mut blocks = Vec::with_capacity(need);
        for _ in 0..need {
            let block = pool.free.pop().expect("capacity checked");
            debug_assert_eq!(pool.refs[block], 0);
            pool.refs[block] = 1;
            blocks.push(block);
        }
        Some(blocks)
    }

    /// Add one owner for every block. Validation happens before mutation.
    pub fn retain(&self, blocks: &[usize]) -> bool {
        let mut pool = self.inner.borrow_mut();
        if blocks
            .iter()
            .any(|&block| block >= pool.refs.len() || pool.refs[block] == 0)
        {
            return false;
        }
        for &block in blocks {
            pool.refs[block] += 1;
        }
        true
    }

    /// Drop one owner for every block. Validation happens before mutation.
    pub fn release(&self, blocks: &[usize]) -> bool {
        let mut pool = self.inner.borrow_mut();
        if blocks
            .iter()
            .any(|&block| block >= pool.refs.len() || pool.refs[block] == 0)
        {
            return false;
        }
        for &block in blocks {
            pool.refs[block] -= 1;
            if pool.refs[block] == 0 {
                pool.free.push(block);
            }
        }
        true
    }

    pub fn conserved(&self) -> bool {
        self.free_blocks() + self.allocated_blocks() == self.total_blocks()
    }
}
