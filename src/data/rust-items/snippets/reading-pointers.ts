/**
 * The `reading-pointers` group of the compile bank (docs/specs/serving-reading.md §4): serving-first reading items on
 * r.smart-pointers. A serving stack shares KV blocks, prefix nodes, execution plans and model weights through handles:
 * `Rc` within a thread, `Arc` across threads, `Box` for one owner on the heap. Cloning a handle (`Rc::clone`,
 * `Arc::clone`) bumps a count and copies no data; data behind a shared handle is read-only unless something like
 * `Rc::make_mut` or a `Mutex` says otherwise; and only `Arc` may cross to another thread.
 *
 * Reader voice (§4.1): no Read/Write/Own labels, no permission or focus, reading KCs only; one fix that compiles and
 * keeps what the code does, every other compiling fix a labelled lure. Rule 4: no fix calls `.clone()` on an `Rc`, an
 * `Arc` or a `Weak`, because there it is a correct handle copy, which the clone lure would mislabel; handle copies are
 * written `Rc::clone(&x)`.
 */

import { rs, type RustSnippet, type SnippetFix } from '../types'

const S = 'r.smart-pointers'
const E = 'r.enums-option-result'

/** Misconceptions a wrong fix records when a learner picks it (a clone lure records `r.clone-to-silence`). */
const MISS = {
  changesBehaviour: 'r.fix-changes-meaning',
  refEverywhere: 'r.ref-fixes-all',
  mutCures: 'r.mut-cures-error',
  /** An `Rc` is taken to be shareable with another thread. */
  rcCrosses: 'r.rc-crosses-threads',
  /** A new handle is taken to need a new copy of the data, or the reverse. */
  handleIsData: 'r.handle-is-data',
} as const

const at = (line: number, text: string) => ({ line, text })
const good = (id: string, line: number, text: string, why: string): SnippetFix => ({ id, edit: at(line, text), ok: true, why })
const bad = (id: string, line: number, text: string, why: string, miss?: string): SnippetFix => ({ id, edit: at(line, text), ok: false, why, ...(miss ? { miss } : {}) })
const cloned = (id: string, line: number, text: string, why: string): SnippetFix => ({ id, edit: at(line, text), ok: false, lure: 'clone', why })
const drift = (id: string, line: number, text: string, why: string, miss: string = MISS.changesBehaviour): SnippetFix => ({ id, edit: at(line, text), ok: false, lure: 'other', why, miss })

export const SNIPPETS: RustSnippet[] = [
  {
    id: 'arc-block-share',
    kcs: [S],
    title: 'Share a cached block with one more sequence',
    domain: 'BlockPool',
    base: rs`
      use std::sync::Arc;

      struct Block {
          refs: u32,
          ids: Vec<u32>,
      }

      fn share(b: &Arc<Block>) -> Arc<Block> {
          let s = Arc::clone(b);
          assert!(Arc::strong_count(&s) > 1);
          s
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`Arc::clone` makes a second handle to the same block and bumps the `Arc`\'s own count; no KV is copied, and the block is only read.',
      },
      {
        id: 'bump-field',
        edit: { line: 10, text: '    s.refs += 1;' },
        expect: { code: 'E0594', line: 10 },
        why: 'Data behind an `Arc` is shared by every handle, so it cannot be changed through one of them, not even its own count field.',
        fixes: [
          good('arc-count', 10, '    assert!(Arc::strong_count(&s) > 1);', 'The `Arc` already counts its handles, and `Arc::clone` on line 9 bumped that count; the block itself stays read-only.'),
          bad('mut-handle', 9, '    let mut s = Arc::clone(b);', 'A `mut` binding lets `s` become another handle; the block behind it is still shared and read-only.', MISS.mutCures),
          bad('get-mut', 10, '    Arc::get_mut(&mut s).unwrap().refs += 1;', '`get_mut` needs `s` declared `mut`, and it hands out the block only while no other handle exists, which sharing just made false.', MISS.mutCures),
        ],
      },
      {
        id: 'deep-copy',
        edit: { line: 9, text: '    let s = Arc::new(**b);' },
        expect: { code: 'E0507', line: 9 },
        why: '`**b` is the shared block itself, and it cannot be moved out from under the other handles into a new `Arc`.',
        fixes: [
          good('handle', 9, '    let s = Arc::clone(b);', 'Sharing means another handle to the same block, which `Arc::clone` makes without touching the data.'),
          bad('arc-of-arc', 9, '    let s = Arc::new(Arc::clone(b));', 'That wraps a new handle in a second `Arc`, an `Arc<Arc<Block>>`, not the `Arc<Block>` the function returns.', MISS.handleIsData),
          cloned('deep', 9, '    let s = Arc::new((**b).clone());', '`Block` cannot be cloned, and copying the block\'s KV is exactly what sharing avoids.'),
        ],
      },
      {
        id: 'own-param',
        edit: { line: 8, text: 'fn share(b: Arc<Block>) -> Arc<Block> {' },
        expect: { code: 'E0308', line: 9 },
        why: '`Arc::clone` takes a loan of a handle, `&Arc<Block>`, and `b` is now the handle itself.',
      },
    ],
  },
  {
    id: 'prefix-node-share',
    kcs: [S],
    title: 'Two radix nodes share one KV block',
    domain: 'PrefixCache',
    base: rs`
      use std::rc::Rc;

      struct Block(u32);
      struct Node {
          kv: Rc<Block>,
      }

      fn share(b: Block) -> (Node, Node) {
          let kv = Rc::new(b);
          let a = Node { kv: Rc::clone(&kv) };
          let c = Node { kv };
          (a, c)
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Both nodes hold an `Rc` handle to the one block: `Rc::clone` on line 10 makes the second handle, and line 11 moves the first into `c`.',
      },
      {
        id: 'move-twice',
        edit: { line: 10, text: '    let a = Node { kv };' },
        expect: { code: 'E0382', line: 11 },
        why: 'Line 10 moves the only handle into `a`, so line 11 has no `kv` left to give `c`.',
        fixes: [
          good('rc-clone', 10, '    let a = Node { kv: Rc::clone(&kv) };', '`Rc::clone` makes a second handle to the same block, so both nodes can hold one.'),
          drift('fresh', 10, '    let a = Node { kv: Rc::new(Block(0)) };', 'Node `a` now holds a new, different block, so the two nodes no longer share their KV.', MISS.handleIsData),
          bad('deref', 10, '    let a = Node { kv: Rc::new(*kv) };', '`*kv` is the shared block, which cannot be moved out from under the handle.', MISS.handleIsData),
        ],
      },
      {
        id: 'deref-copy',
        edit: { line: 10, text: '    let a = Node { kv: Rc::new(*kv) };' },
        expect: { code: 'E0507', line: 10 },
        why: '`*kv` is the block behind the handle, which cannot be moved out of it into a second `Rc`.',
        fixes: [
          good('rc-clone', 10, '    let a = Node { kv: Rc::clone(&kv) };', 'A second handle to the same block is what sharing means.'),
          bad('rc-of-rc', 10, '    let a = Node { kv: Rc::new(kv) };', 'That wraps the handle in another `Rc`, which is not the `Rc<Block>` a node holds.', MISS.handleIsData),
          bad('borrow', 10, '    let a = Node { kv: &kv };', 'A loan of the handle is not a handle.', MISS.refEverywhere),
        ],
      },
      {
        id: 'write-shared',
        edit: { line: 11, text: '    kv.0 += 1; let c = Node { kv };' },
        expect: { code: 'E0594', line: 11 },
        why: 'The block is shared through `Rc` handles, so it cannot be changed through one of them.',
      },
    ],
  },
  {
    id: 'plan-to-worker',
    kcs: [S],
    title: 'Hand the execution plan to a worker thread',
    domain: 'Worker',
    base: rs`
      use std::{rc::Rc, sync::Arc, thread};

      struct Plan {
          layers: usize,
      }

      fn run(plan: Arc<Plan>) -> usize {
          let w = thread::spawn(move || {
              plan.layers
          });
          w.join().unwrap()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'An `Arc` keeps its count with atomic operations, so its handles may cross threads; the `move` closure takes this one to the worker.',
      },
      {
        id: 'rc',
        edit: { line: 7, text: 'fn run(plan: Rc<Plan>) -> usize {' },
        expect: { code: 'E0277', line: 8 },
        why: 'An `Rc` keeps its count without atomics, so it may not be sent to another thread: `Rc<Plan>` is not `Send`.',
        fixes: [
          good('arc', 7, 'fn run(plan: Arc<Plan>) -> usize {', 'An `Arc` handle may be sent to the worker thread.'),
          bad('ref', 7, 'fn run(plan: &Plan) -> usize {', 'A plain loan cannot go to a thread that may outlive `run`.', MISS.refEverywhere),
          bad('rc-arc', 7, 'fn run(plan: Rc<Arc<Plan>>) -> usize {', 'The outer `Rc` still may not cross threads, whatever it holds.', MISS.rcCrosses),
        ],
      },
      {
        id: 'no-move',
        edit: { line: 8, text: '    let w = thread::spawn(|| {' },
        expect: { code: 'E0373', line: 8 },
        why: 'Without `move` the closure only borrows `plan`, and the thread may outlive `run`, which owns it.',
        fixes: [
          good('move', 8, '    let w = thread::spawn(move || {', '`move` hands the `Arc` handle to the thread, so the thread owns what it reads.'),
          drift('const', 9, '        1', 'The thread no longer reads the plan, so it compiles, but it reports 1 layer whatever the plan says.'),
          bad('typed', 8, '    let w = thread::spawn(|| -> usize {', 'Naming the return type changes nothing about what the closure borrows.'),
        ],
      },
      {
        id: 'ref-plan',
        edit: { line: 7, text: 'fn run(plan: &Plan) -> usize {' },
        expect: { code: 'E0521', line: 8 },
        why: 'A plain loan of the plan would escape into a thread that may outlive `run`.',
      },
    ],
  },
  {
    id: 'pool-handle-thread',
    kcs: [S],
    title: 'Give a worker its own handle to the block pool',
    domain: 'BlockPool',
    base: rs`
      use std::sync::{Arc, Mutex};
      use std::thread;

      type Pool = Arc<Mutex<Vec<u32>>>;

      fn worker(pool: &Pool) {
          let p = Pool::clone(pool);
          thread::spawn(move || {
              p.lock().unwrap().push(7);
          });
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`Pool::clone` makes a new `Arc` handle for the thread, and the `Mutex` inside lets one thread at a time change the free list.',
      },
      {
        id: 'rc',
        edit: { line: 4, text: 'type Pool = std::rc::Rc<Mutex<Vec<u32>>>;' },
        expect: { code: 'E0277', line: 8 },
        why: 'An `Rc` handle may not be sent to another thread, so the closure that holds one cannot be spawned.',
        fixes: [
          good('arc', 4, 'type Pool = Arc<Mutex<Vec<u32>>>;', 'An `Arc` handle may cross to the worker thread.'),
          bad('box', 4, 'type Pool = Box<Mutex<Vec<u32>>>;', 'Cloning a `Box` copies what it holds, and a `Mutex` cannot be copied: a `Box` has one owner, so there is no second handle to give the thread.', MISS.handleIsData),
          bad('rc-vec', 4, 'type Pool = std::rc::Rc<Vec<u32>>;', 'Dropping the `Mutex` leaves nothing to lock, and an `Rc` still cannot cross threads.', MISS.rcCrosses),
        ],
      },
      {
        id: 'no-clone',
        edit: { line: 7, text: '    let p = pool;' },
        expect: { code: 'E0521', line: 8 },
        why: '`p` is now just the caller\'s loan of the pool, which would escape into a thread that may outlive `worker`.',
        fixes: [
          good('handle', 7, '    let p = Pool::clone(pool);', 'A new `Arc` handle belongs to the thread, so nothing borrowed escapes.'),
          bad('deref', 7, '    let p = *pool;', 'That would move the caller\'s `Arc` out from behind its loan, which a loan never allows; the thread needs a handle of its own.', MISS.refEverywhere),
          bad('guard', 7, '    let p = pool.lock().unwrap();', '`p` would be the lock guard, which has no `lock` of its own; and a guard belongs to this thread and the caller\'s pool, so it could not travel to the worker anyway.'),
        ],
      },
      {
        id: 'no-move',
        edit: { line: 8, text: '    thread::spawn(|| {' },
        expect: { code: 'E0373', line: 8 },
        why: 'Without `move` the closure only borrows `p`, and the thread may outlive `worker`, which owns it.',
      },
    ],
  },
  {
    id: 'cow-block-table',
    kcs: [S],
    title: 'Copy a forked block table on its first write',
    domain: 'KvBlockTable',
    base: rs`
      use std::rc::Rc;

      struct Table {
          blocks: Rc<Vec<u32>>,
      }

      fn fork(t: &Table) -> Table {
          Table { blocks: Rc::clone(&t.blocks) }
      }

      fn grow(t: &mut Table, b: u32) {
          Rc::make_mut(&mut t.blocks).push(b);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'A fork shares its parent\'s block list through a second handle. `Rc::make_mut` copies the list only if another handle still shares it, then lets this table change its own copy.',
      },
      {
        id: 'push-shared',
        edit: { line: 12, text: '    t.blocks.push(b);' },
        expect: { code: 'E0596', line: 12 },
        why: 'The list behind the `Rc` may be shared with a fork, so it cannot be changed through this handle.',
        fixes: [
          good('make-mut', 12, '    Rc::make_mut(&mut t.blocks).push(b);', '`make_mut` copies the list on the first write while it is shared, then pushes to this table\'s own list.'),
          drift('to-vec', 12, '    t.blocks.to_vec().push(b);', 'It pushes to a temporary copy that is thrown away, so the table never grows.'),
          bad('deref', 12, '    (*t.blocks).push(b);', 'Spelling the `*` out still changes the shared list.', MISS.refEverywhere),
        ],
      },
      {
        id: 'move-out',
        edit: { line: 8, text: '    Table { blocks: t.blocks }' },
        expect: { code: 'E0507', line: 8 },
        why: '`t` only lends the parent table, so its handle cannot be moved out into the fork.',
        fixes: [
          good('rc-clone', 8, '    Table { blocks: Rc::clone(&t.blocks) }', 'A second handle lets parent and fork share the list without copying it.'),
          drift('empty', 8, '    Table { blocks: Rc::new(vec![]) }', 'The fork starts with no blocks, so it loses the prefix it was meant to share.', MISS.handleIsData),
          bad('deref-clone', 8, '    Table { blocks: Rc::clone(&*t.blocks) }', '`&*t.blocks` lends the list itself, not the handle, and `Rc::clone` needs a loan of a handle.', MISS.refEverywhere),
        ],
      },
      {
        id: 'shared-grow',
        edit: { line: 11, text: 'fn grow(t: &Table, b: u32) {' },
        expect: { code: 'E0596', line: 12 },
        why: '`make_mut` needs a `&mut` loan of the handle, and `grow` now borrows the table only for reading.',
      },
    ],
  },
  {
    id: 'weights-to-workers',
    kcs: [S],
    title: 'Share one copy of the weights across workers',
    domain: 'ModelWeights',
    base: rs`
      use std::sync::Arc;
      use std::thread;

      struct Weights {
          raw: Vec<u8>,
      }

      fn serve(w: Arc<Weights>, n: usize) {
          for _ in 0..n {
              let w = Arc::clone(&w);
              thread::spawn(move || w.raw.len());
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Each worker gets its own `Arc` handle (line 10) to the one copy of the weights; the bytes are never copied.',
      },
      {
        id: 'move-arc',
        edit: { line: 10, text: '        let w = w;' },
        expect: { code: 'E0382', line: 10 },
        why: 'The first pass moves the only handle into its thread, so the second pass has no `w` left to move.',
        fixes: [
          good('arc-clone', 10, '        let w = Arc::clone(&w);', 'A new handle per worker leaves the original for the next pass.'),
          bad('downgrade', 10, '        let w = Arc::downgrade(&w);', 'A `Weak` handle does not keep the weights alive, and it has no `raw` to read until it is upgraded.', MISS.handleIsData),
          bad('into-inner', 10, '        let w = Arc::into_inner(w);', '`into_inner` takes the handle by value and gives an `Option` of the weights, which has no `raw` to read.', MISS.handleIsData),
        ],
      },
      {
        id: 'no-move',
        edit: { line: 11, text: '        thread::spawn(|| w.raw.len());' },
        expect: { code: 'E0373', line: 11 },
        why: 'Without `move` the closure only borrows this pass\'s handle, which is dropped at the end of the pass while the thread may still run.',
        fixes: [
          good('move', 11, '        thread::spawn(move || w.raw.len());', '`move` gives the thread its own handle.'),
          bad('ref', 11, '        thread::spawn(|| (&w).raw.len());', 'An explicit loan is still a loan the thread may outlive.', MISS.refEverywhere),
          bad('plus-zero', 11, '        thread::spawn(|| w.raw.len() + 0);', 'Changing the arithmetic changes nothing about what the closure borrows.'),
        ],
      },
      {
        id: 'ref-weights',
        edit: { line: 8, text: 'fn serve(w: &Weights, n: usize) {' },
        expect: { code: 'E0308', line: 10 },
        why: '`Arc::clone` needs a loan of an `Arc`, and `w` is now a plain loan of the weights, which has no count to bump.',
      },
    ],
  },
  {
    id: 'lease-returns-blocks',
    kcs: [S],
    title: 'A lease returns its blocks when it is dropped',
    domain: 'Lease',
    base: rs`
      use std::sync::{Arc, Mutex};

      type Pool = Arc<Mutex<Vec<u32>>>;

      // a lease returns its blocks on drop
      struct Lease(Pool, Vec<u32>);

      impl Drop for Lease {
          fn drop(&mut self) {
              let mut p = self.0.lock().unwrap();
              p.append(&mut self.1);
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The lease holds a handle to the shared pool, locks it when dropped, and moves its block ids back with `append`, which leaves the lease\'s own list empty.',
      },
      {
        id: 'extend-move',
        edit: { line: 11, text: '        p.extend(self.1);' },
        expect: { code: 'E0507', line: 11 },
        why: '`drop` only gets `&mut self`, so the lease\'s list cannot be moved out of it whole.',
        fixes: [
          good('append', 11, '        p.append(&mut self.1);', '`append` moves the ids across through the `&mut` loan and leaves an empty list behind.'),
          cloned('clone', 11, '        p.extend(self.1.clone());', 'It returns the ids, but only after copying the whole list, which is then dropped anyway.'),
          bad('push', 11, '        p.push(self.1);', 'The pool holds block ids, not lists of them.'),
        ],
      },
      {
        id: 'no-mut-guard',
        edit: { line: 10, text: '        let p = self.0.lock().unwrap();' },
        expect: { code: 'E0596', line: 11 },
        why: 'The lock guard lends the free list for changing only through a `mut` binding.',
        fixes: [
          good('mut-guard', 10, '        let mut p = self.0.lock().unwrap();', 'A `mut` guard lets `append` change the locked list.'),
          bad('expect', 10, '        let p = self.0.lock().expect("x");', '`expect` takes the guard out of the lock\'s `Result` as `unwrap` does, and `p` is still not declared `mut`.', MISS.mutCures),
          bad('no-unwrap', 10, '        let p = self.0.lock();', 'Without `unwrap`, `p` is the `Result` of locking, not the guard, so there is no list to append to.'),
        ],
      },
    ],
  },
  {
    id: 'fork-block-handles',
    kcs: [S],
    title: 'Fork a sequence that shares every block',
    domain: 'KvBlockTable',
    base: rs`
      use std::rc::Rc;

      struct Block {
          ids: Vec<u32>,
      }

      fn fork(t: &[Rc<Block>]) -> Vec<Rc<Block>> {
          t.iter().map(Rc::clone).collect()
      }
    `,
    variants: [
      {
        id: 'owned-blocks',
        edit: { line: 7, text: 'fn fork(t: &[Rc<Block>]) -> Vec<Block> {' },
        expect: { code: 'E0277', line: 8 },
        why: 'The chain yields new `Rc` handles, and a `Vec<Block>` would need the blocks themselves.',
        fixes: [
          good('handles', 7, 'fn fork(t: &[Rc<Block>]) -> Vec<Rc<Block>> {', 'A fork is a list of handles to the same blocks, which is what the chain builds.'),
          bad('move-blocks', 8, '    t.iter().map(|b| **b).collect()', '`**b` is a shared block, which cannot be moved out from under its handles.', MISS.handleIsData),
          bad('borrowed', 7, 'fn fork(t: &[Rc<Block>]) -> Vec<&Block> {', 'The chain yields handles, not loans of blocks.', MISS.refEverywhere),
        ],
      },
      {
        id: 'by-ref',
        edit: { line: 8, text: '    t.iter().collect()' },
        expect: { code: 'E0277', line: 8 },
        why: '`iter` lends each handle, so the chain yields `&Rc<Block>`, and the fork must hold handles of its own.',
        fixes: [
          good('map-clone', 8, '    t.iter().map(Rc::clone).collect()', '`Rc::clone` turns each lent handle into a new handle to the same block: a count bump, no KV copied.'),
          bad('rc-new', 8, '    t.iter().map(|b| Rc::new(**b)).collect()', '`**b` is a shared block, which cannot be moved out into a new `Rc`; and a fork shares blocks, it does not copy them.', MISS.handleIsData),
          bad('downgrade', 8, '    t.iter().map(Rc::downgrade).collect()', 'Weak links do not keep the blocks alive, and the fork must hold `Rc` handles.', MISS.handleIsData),
        ],
      },
      {
        id: 'deref-block',
        edit: { line: 8, text: '    t.iter().map(|b| **b).collect()' },
        expect: { code: 'E0277', line: 8 },
        why: 'The chain now yields blocks, not handles, so it cannot build the `Vec<Rc<Block>>` the function returns.',
      },
    ],
  },
  {
    id: 'box-next-block',
    kcs: [S, E],
    title: 'Read the next block in a chained table',
    domain: 'KvBlockTable',
    base: rs`
      struct Block {
          id: u32,
          next: Option<Box<Block>>,
      }

      fn second(b: &Block) -> Option<u32> {
          let n = b.next.as_ref()?;
          Some(n.id)
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`as_ref` lends the boxed next block (or gives `None` at the end of the chain), so the chain is read without being taken apart.',
      },
      {
        id: 'move-next',
        edit: { line: 7, text: '    let n = b.next?;' },
        expect: { code: 'E0507', line: 7 },
        why: '`?` on the field itself would move the `Box` out of a block that is only lent.',
        fixes: [
          good('as-ref', 7, '    let n = b.next.as_ref()?;', '`as_ref` lends the box inside the `Option`, so nothing moves.'),
          drift('unwrap-deref', 7, '    let n = b.next.as_deref().unwrap();', 'At the end of the chain it now panics instead of answering `None`.', 'r.unwrap-handles-none'),
          cloned('clone-ref', 7, '    let n = (&b.next).clone()?;', 'Cloning a loan gives another loan of the `Option`, and `?` cannot look inside a loan.'),
        ],
      },
      {
        id: 'unbox',
        edit: { line: 7, text: '    let n = *b.next.as_ref()?;' },
        expect: { code: 'E0507', line: 7 },
        why: '`*` on the lent box tries to move the whole next block out of the chain.',
      },
      {
        id: 'take-next',
        edit: { line: 7, text: '    let n = b.next.take()?;' },
        expect: { code: 'E0596', line: 7 },
        why: '`take` detaches the next block, which changes the chain, and `b` is lent only for reading.',
        fixes: [
          good('as-ref', 7, '    let n = b.next.as_ref()?;', 'Reading the next block needs only a loan of it.'),
          drift('mut-block', 6, 'fn second(b: &mut Block) -> Option<u32> {', 'With `&mut`, `take` compiles and cuts the chain after the first block, so a read becomes an eviction.'),
          bad('deref', 7, '    let n = *b.next.as_ref()?;', '`*` on the lent box moves the next block out.', MISS.refEverywhere),
        ],
      },
    ],
  },
]
