/**
 * The seed group of the compile bank (docs/specs/wave-2.md §15.4, task 2c-04): ten snippets that cover
 * every compile KC, every kind of item and both build modes, so the schema, the permission labels, the
 * clone-lure rule and the verdict option drawing were reviewed on real items before the content groups
 * (moves, borrows, lifetimes) were written. Each snippet's base compiles; each other variant is a
 * one-line edit that rustc 1.96.0 rejects (or, for the RefCell snippet, that panics when run).
 *
 * Whys use Crichton's permissions: a path holds Read (R), Write (W) and Own (O); a move removes all three;
 * `&` removes W and O while the borrow lives; `&mut` removes R as well.
 */

import { KC } from '@/data/kc/ids'
import { rs, type RustSnippet } from '../types'

const BR = KC.borrowRules
const OM = KC.ownershipMoves
const CCD = 'r.clone-copy-drop'
const SL = 'r.slices'
const AL = KC.analyzerLimits
const LT = 'r.lifetimes'
const IM = 'r.interior-mutability'

export const SNIPPETS: RustSnippet[] = [
  {
    id: 'block-table-first-block',
    kcs: [BR, OM],
    title: 'Read the first block, then grow the table',
    domain: 'KvBlockTable',
    base: rs`
      struct BlockTable {
          blocks: Vec<u32>,
      }

      fn grow(table: &mut BlockTable, id: u32) {
          let first = table.blocks[0];
          table.blocks.push(id);
          println!("first block {first}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`first` is a copy of a `u32`, so no borrow of `table.blocks` is alive when `push` on line 7 needs its W.',
      },
      {
        id: 'borrow-first',
        edit: { line: 6, text: '    let first = &table.blocks[0];' },
        expect: { code: 'E0502', line: 7 },
        why: '`first` borrows into `table.blocks` with `&` and is used on line 8, so `table.blocks` has lost W until then; `push` on line 7 needs W.',
        focus: { line: 7, path: 'table.blocks', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'copy-first', edit: { line: 6, text: '    let first = table.blocks[0];' }, ok: true, why: 'A `u32` is Copy: `first` holds its own copy, so the borrow ends on line 6 and `push` gets W back.' },
          {
            id: 'clone-push',
            edit: { line: 7, text: '    table.blocks.clone().push(id);' },
            ok: false,
            lure: 'clone',
            why: 'It pushes onto a copy of every block, and the copy is dropped at the end of the line: the table never grows.',
          },
          { id: 'mut-first', edit: { line: 6, text: '    let first = &mut table.blocks[0];' }, ok: false, why: 'A `&mut` borrow takes R as well as W from `table.blocks`, so `push` is blocked all the same.' },
        ],
      },
      {
        id: 'mut-first',
        edit: { line: 6, text: '    let first = &mut table.blocks[0];' },
        expect: { code: 'E0499', line: 7 },
        why: '`first` is a `&mut` borrow into `table.blocks` that lives until line 8, and `push` on line 7 needs a second `&mut` borrow of it while the first is alive.',
      },
      {
        id: 'move-out',
        edit: { line: 7, text: '    let moved = table.blocks;' },
        expect: { code: 'E0507', line: 7 },
        why: 'Through `&mut BlockTable`, `table.blocks` has R and W but never O, and `let moved = table.blocks` moves the vector out, which needs O.',
        focus: { line: 7, path: 'table.blocks', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'shared-table',
        edit: { line: 5, text: 'fn grow(table: &BlockTable, id: u32) {' },
        expect: { code: 'E0596', line: 7 },
        why: 'Through a `&BlockTable`, `table.blocks` has R but no W, and `push` borrows it `&mut`, which needs W.',
        focus: { line: 7, path: 'table.blocks', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'request-prompt-slice',
    kcs: [SL, BR],
    title: 'Print the prompt window, then append a token',
    domain: 'Request',
    base: rs`
      struct Request {
          tokens: Vec<u32>,
      }

      fn admit(req: &mut Request, next: u32) {
          let prompt = &req.tokens[..2];
          println!("{prompt:?}");
          req.tokens.push(next);
          println!("{} tokens", req.tokens.len());
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The slice `prompt` borrows `req.tokens`, but its last use is line 7, so the borrow is over before `push` needs W on line 8.',
      },
      {
        id: 'late-use',
        edit: { line: 9, text: '    println!("{prompt:?}");' },
        expect: { code: 'E0502', line: 8 },
        why: 'The slice `prompt` borrows all of `req.tokens` and is now used on line 9, so `req.tokens` lacks W on line 8, where `push` needs it.',
        focus: { line: 8, path: 'req.tokens', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          {
            id: 'reborrow',
            edit: { line: 9, text: '    println!("{:?}", &req.tokens[..2]);' },
            ok: true,
            why: 'A fresh slice after the push shows the same two tokens, since `push` only appends, and no borrow spans line 8.',
          },
          {
            id: 'clone-push',
            edit: { line: 8, text: '    req.tokens.clone().push(next);' },
            ok: false,
            lure: 'clone',
            why: 'It appends `next` to a copy of every token, dropped at once: the request never gets its token.',
          },
          { id: 'full-range', edit: { line: 6, text: '    let prompt = &req.tokens[0..2];' }, ok: false, why: '`0..2` is the same range as `..2`: the slice still borrows `req.tokens` until line 9, so `push` still lacks W.' },
          { id: 'print-early', edit: { line: 7, text: '    println!("{:?}", prompt);' }, ok: false, why: 'Writing the line 7 print another way changes nothing: the print on line 9 still keeps the slice, and its borrow, alive across the `push`.' },
        ],
      },
      {
        id: 'late-len',
        edit: { line: 9, text: '    let n = prompt.len();' },
        expect: { code: 'E0502', line: 8 },
        why: 'Reading `prompt.len()` on line 9 keeps the slice, and its `&` borrow of `req.tokens`, alive across line 8, where `push` needs W.',
      },
      {
        id: 'drop-tokens',
        edit: { line: 8, text: '    drop(req.tokens);' },
        expect: { code: 'E0507', line: 8 },
        why: 'Through `&mut Request`, `req.tokens` has R and W but no O, and `drop` takes the vector by value, which needs O.',
        focus: { line: 8, path: 'req.tokens', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'shared-req',
        edit: { line: 5, text: 'fn admit(req: &Request, next: u32) {' },
        expect: { code: 'E0596', line: 8 },
        why: 'Through a `&Request`, `req.tokens` has R but no W, and `push` needs W to append.',
        focus: { line: 8, path: 'req.tokens', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'admit-copies-the-id',
    kcs: [OM, CCD],
    title: 'Queue a request, then log its id',
    domain: 'Request',
    base: rs`
      #[derive(Clone)]
      struct Request {
          id: u64,
          prompt: String,
      }
      fn admit(q: &mut Vec<Request>, r: Request) {
          let id = r.id;
          q.push(r);
          println!("queued {id}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`r.id` is a `u64`, which is Copy, so `id` is a copy and `r` still has O when `push` moves it on line 8.',
      },
      {
        id: 'read-after-move',
        edit: { line: 9, text: '    println!("queued {}", r.id);' },
        expect: { code: 'E0382', line: 9 },
        why: '`push` on line 8 moved `r` into the queue, so `r` lost R and O (a parameter not declared `mut` never had W); reading `r.id` on line 9 needs R.',
        focus: { line: 9, path: 'r.id', needs: ['read'] },
        permission: 'read',
        fixes: [
          { id: 'use-copy', edit: { line: 9, text: '    println!("queued {id}");' }, ok: true, why: 'Line 7 already copied the `u64` id out before the move, so printing `id` reads nothing of `r`.' },
          {
            id: 'clone-req',
            edit: { line: 8, text: '    q.push(r.clone());' },
            ok: false,
            lure: 'clone',
            why: 'It queues a copy of the whole request, prompt string included, only so that `r` survives for one print.',
          },
          { id: 'borrow-id', edit: { line: 7, text: '    let id = &r.id;' }, ok: false, why: 'It only changes what `id` holds: line 9 still reads `r.id` after `push` on line 8 moved `r`, which left it no R.' },
        ],
      },
      {
        id: 'push-twice',
        edit: { line: 9, text: '    q.push(r);' },
        expect: { code: 'E0382', line: 9 },
        why: 'The first `push` moved `r`, so it has no permissions left, and a second move on line 9 needs R and O.',
      },
      {
        id: 'string-id',
        edit: { line: 3, text: '    id: String,' },
        expect: { code: 'E0382', line: 8 },
        why: 'A `String` id is not Copy, so `let id = r.id` moves it out of `r`; the partly moved `r` cannot be moved whole on line 8.',
      },
    ],
  },

  {
    id: 'batch-flush-while-borrowed',
    kcs: [OM, BR],
    title: 'Log the first id, then hand the batch on',
    domain: 'Batch',
    base: rs`
      #[derive(Clone)]
      struct Batch {
          ids: Vec<u64>,
      }

      fn flush(b: Batch, out: &mut Vec<Batch>) {
          let first = &b.ids[0];
          println!("flush {first}");
          out.push(b);
          println!("done");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`first` borrows into `b`, but its last use is line 8, so `b` has O back when `push` moves it on line 9.',
      },
      {
        id: 'late-first',
        edit: { line: 10, text: '    println!("done {first}");' },
        expect: { code: 'E0505', line: 9 },
        why: '`first` borrows into `b` with `&` and is used on line 10, so `b` has lost O until then (a parameter not declared `mut` never had W); moving `b` on line 9 needs O.',
        focus: { line: 9, path: 'b', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          { id: 'copy-first', edit: { line: 7, text: '    let first = b.ids[0];' }, ok: true, why: 'A `u64` is Copy, so `first` can hold a copy, and nothing borrows `b` when it moves.' },
          {
            id: 'clone-batch',
            edit: { line: 9, text: '    out.push(b.clone());' },
            ok: false,
            lure: 'clone',
            why: 'It hands on a copy of every id in the batch and keeps the original alive only to print one number.',
          },
          { id: 'mut-first', edit: { line: 7, text: '    let first = &mut b.ids[0];' }, ok: false, why: '`b` is not declared `mut`, so it has no W to lend, and a `&mut` borrow would block the move as well.' },
        ],
      },
      {
        id: 'read-after-move',
        edit: { line: 10, text: '    println!("{}", b.ids.len());' },
        expect: { code: 'E0382', line: 10 },
        why: '`push` moved `b` on line 9, so `b.ids` has no permissions left, and `len` on line 10 needs R.',
        focus: { line: 10, path: 'b.ids', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'mut-borrow',
        edit: { line: 7, text: '    let first = &mut b.ids[0];' },
        expect: { code: 'E0596', line: 7 },
        why: '`b` is not declared `mut`, so `b.ids` never had W, and a `&mut` borrow needs it.',
        focus: { line: 7, path: 'b.ids', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'swap-block-owners',
    kcs: [AL, BR],
    title: 'Swap the owners of two blocks',
    domain: 'BlockPool',
    base: rs`
      fn rotate(owners: &mut Vec<u32>) {
          let (a, b) = owners.split_at_mut(1);
          let first = &mut a[0];
          let second = &mut b[0];
          std::mem::swap(first, second);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`split_at_mut` hands out two `&mut` slices that cannot overlap, so `first` and `second` borrow different blocks.',
      },
      {
        id: 'index-twice',
        edit: { line: 4, text: '    let second = &mut owners[1];' },
        expect: { code: 'E0499', line: 4 },
        why: '`a` still borrows `owners` `&mut` through `first`, and the checker does not see that index 1 lies outside `a`: it rejects a second `&mut` of `owners` although this one is safe.',
        fixes: [
          { id: 'from-tail', edit: { line: 4, text: '    let second = &mut b[0];' }, ok: true, why: '`b` is the part of `owners` that starts at index 1, so `b[0]` is `owners[1]`, the same block, borrowed through the split.' },
          { id: 'same-half', edit: { line: 4, text: '    let second = &mut a[0];' }, ok: false, why: '`a[0]` is the block `first` already borrows: two `&mut` to one place is the real error the checker exists for.' },
          { id: 'copy-owner', edit: { line: 4, text: '    let second = b[0];' }, ok: false, why: '`b[0]` copies the owner id, so `second` is a `u32`, and `swap` needs two `&mut` places to swap.' },
        ],
      },
      {
        id: 'same-half',
        edit: { line: 4, text: '    let second = &mut a[0];' },
        expect: { code: 'E0499', line: 4 },
        why: '`first` already borrows `a[0]` `&mut` until line 5, so a second `&mut a[0]` would let two names write one block.',
      },
      {
        id: 'shared-split',
        edit: { line: 2, text: '    let (a, b) = owners.split_at(1);' },
        expect: { code: 'E0596', line: 3 },
        why: '`split_at` returns `&` slices, so `a[0]` has R but never W, and `&mut a[0]` needs W.',
        focus: { line: 3, path: 'a[0]', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'swap-through-owners',
        edit: { line: 5, text: '    std::mem::swap(first, &mut owners[0]);' },
        expect: { code: 'E0499', line: 5 },
        why: '`first` already borrows `owners[0]` `&mut` through the split, so `&mut owners[0]` would let two names write one block.',
      },
    ],
  },

  {
    id: 'cache-hottest-key',
    kcs: [LT, OM],
    title: 'Return the hottest key of the cache',
    domain: 'PrefixCache',
    base: rs`
      struct Cache {
          keys: Vec<String>,
      }

      fn hottest(c: &Cache) -> &str {
          let key = &c.keys[0];
          key.as_str()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The return type borrows from `c`, and `key` borrows `c.keys[0]`, so the `&str` points into the cache, which outlives the call.',
      },
      {
        id: 'owned-copy',
        edit: { line: 6, text: '    let key = c.keys[0].clone();' },
        expect: { code: 'E0515', line: 7 },
        why: '`key` is now a `String` the function owns, dropped when `hottest` returns, so a `&str` into it cannot be returned.',
      },
      {
        id: 'move-out',
        edit: { line: 6, text: '    let key = c.keys[0];' },
        expect: { code: 'E0507', line: 6 },
        why: 'Through `&Cache`, `c.keys[0]` has R only; `let key = c.keys[0]` moves the `String` out, which needs O.',
        focus: { line: 6, path: 'c.keys[0]', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          { id: 'borrow-key', edit: { line: 6, text: '    let key = &c.keys[0];' }, ok: true, why: 'Borrowing `c.keys[0]` needs only R, and it ties the returned `&str` to the cache, which outlives the call.' },
          {
            id: 'clone-key',
            edit: { line: 6, text: '    let key = c.keys[0].clone();' },
            ok: false,
            lure: 'clone',
            why: 'The copy is a `String` the function owns, dropped on return, so the `&str` into it cannot leave: rustc reports E0515 instead.',
          },
          { id: 'deref-key', edit: { line: 6, text: '    let key = *c.keys[0];' }, ok: false, why: 'Dereferencing a `String` gives a `str`, whose size is unknown at compile time, so it cannot be a local.' },
        ],
      },
      {
        id: 'two-caches',
        edit: { line: 5, text: 'fn hottest(c: &Cache, d: &Cache) -> &str {' },
        expect: { code: 'E0106', line: 5 },
        why: 'With two borrowed inputs, rustc cannot tell which one the returned `&str` borrows from, so it asks for a lifetime.',
      },
      {
        id: 'temp-key',
        edit: { line: 7, text: '    c.keys[0].clone().as_str()' },
        expect: { code: 'E0515', line: 7 },
        why: '`clone` makes a temporary `String` owned by the function, and the `&str` into it would outlive it.',
      },
    ],
  },

  {
    id: 'count-request-names',
    kcs: [LT],
    title: 'Name each request and count the names',
    domain: 'Scheduler',
    base: rs`
      fn count(reqs: &[u64]) -> usize {
          let mut names = Vec::new();
          for id in reqs {
              let name = format!("req-{id}");
              names.push(name);
          }
          names.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`push` moves each `String` into `names`, so the names live as long as the vector.',
      },
      {
        id: 'push-ref',
        edit: { line: 5, text: '        names.push(&name);' },
        expect: { code: 'E0597', line: 5 },
        why: '`name` is dropped at the end of each pass (line 6), but `names` keeps a reference to it and is used on line 7.',
        fixes: [
          { id: 'move-in', edit: { line: 5, text: '        names.push(name);' }, ok: true, why: 'Moving the `String` in gives it to the vector, so it lives as long as `names` does.' },
          {
            id: 'clone-in',
            edit: { line: 5, text: '        names.push(name.clone());' },
            ok: false,
            lure: 'clone',
            why: 'It stores a second copy of every name, and the original is dropped a line later: the move does the same with no copy.',
          },
          { id: 'ref-temp', edit: { line: 4, text: '        let name = &format!("req-{id}");' }, ok: false, why: 'Borrowing the temporary only moves the problem: it is still dropped at the end of each pass.' },
        ],
      },
      {
        id: 'push-temp',
        edit: { line: 5, text: '        names.push(name.clone().as_str());' },
        expect: { code: 'E0716', line: 5 },
        why: '`name.clone()` is a temporary dropped at the end of line 5, but `names` keeps the `&str` into it until line 7.',
      },
      {
        id: 'ref-temp',
        edit: { line: 4, text: '        let name = &format!("req-{id}");' },
        expect: { code: 'E0716', line: 4 },
        why: 'The `String` from `format!` is a temporary that lives only until the end of the pass, while `names` keeps the borrow until line 7.',
      },
      {
        id: 'slice-name',
        edit: { line: 5, text: '        names.push(&name[..3]);' },
        expect: { code: 'E0597', line: 5 },
        why: 'The slice borrows `name`, which is dropped at the end of each pass, while `names` keeps the slice until line 7.',
      },
    ],
  },

  {
    id: 'hit-stats-refcell',
    kcs: [IM],
    title: 'Count the hits, then record one more',
    domain: 'PrefixCache',
    run: true,
    base: rs`
      use std::cell::RefCell;

      struct Stats {
          hits: RefCell<Vec<u32>>,
      }

      fn main() {
          let hits = RefCell::new(vec![]);
          let s = Stats { hits };
          let n = s.hits.borrow().len();
          s.hits.borrow_mut().push(7);
          println!("{n:?}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The `Ref` from `borrow()` is a temporary dropped at the end of line 10, so `borrow_mut` on line 11 finds the cell free.',
      },
      {
        id: 'hold-ref',
        edit: { line: 10, text: '    let n = s.hits.borrow();' },
        expect: { code: 'BorrowMutError', line: 11 },
        why: '`n` keeps a `Ref` until line 12, so the cell is still borrowed when `borrow_mut` runs on line 11: the same rule as `&` and `&mut`, checked at run time.',
        fixes: [
          { id: 'take-len', edit: { line: 10, text: '    let n = s.hits.borrow().len();' }, ok: true, why: 'Taking the length ends the `Ref` on line 10, so `borrow_mut` finds the cell free.' },
          {
            id: 'clone-list',
            edit: { line: 10, text: '    let n = s.hits.borrow().clone();' },
            ok: false,
            lure: 'clone',
            why: 'It copies the whole hit list only to end the borrow early, and the program prints that copy instead of the count.',
          },
          { id: 'print-len', edit: { line: 12, text: '    println!("{:?}", n.len());' }, ok: false, why: 'The `Ref` in `n` still lives until line 12, so line 11 still finds the cell borrowed.' },
        ],
      },
      {
        id: 'move-hits',
        edit: { line: 10, text: '    let n = s.hits;' },
        expect: { code: 'E0382', line: 11 },
        why: '`let n = s.hits` moves the cell out of `s`, so `s.hits` has no permissions left, and `borrow_mut` on line 11 needs R: a RefCell is changed through `&`.',
        focus: { line: 11, path: 's.hits', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'ref-push',
        edit: { line: 11, text: '    s.hits.borrow().push(7);' },
        expect: { code: 'E0596', line: 11 },
        why: 'A `Ref` from `borrow()` lends the vector with R only, like `&`, and `push` needs W: only `borrow_mut` hands out W.',
      },
      {
        id: 'mut-field',
        edit: { line: 10, text: '    let n = &mut s.hits;' },
        expect: { code: 'E0596', line: 10 },
        why: '`s` is not declared `mut`, so `s.hits` has no W; a RefCell exists so that `borrow_mut` needs only `&`.',
        focus: { line: 10, path: 's.hits', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'scheduler-tick-budget',
    kcs: [BR, CCD],
    title: 'Spend the budget, then report what was left',
    domain: 'Scheduler',
    base: rs`
      #[derive(Clone)]
      struct Scheduler {
          budget: u32,
          queue: Vec<u32>,
      }

      fn tick(s: &mut Scheduler) {
          let left = s.budget;
          s.budget = 0;
          println!("{left} left");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`left` is a copy of the `u32` budget, so nothing borrows `s.budget` when line 9 assigns to it.',
      },
      {
        id: 'borrow-budget',
        edit: { line: 8, text: '    let left = &s.budget;' },
        expect: { code: 'E0506', line: 9 },
        why: '`left` borrows `s.budget` with `&` until line 10, so `s.budget` has lost W, and the assignment on line 9 needs W.',
        focus: { line: 9, path: 's.budget', needs: ['write'] },
        permission: 'write',
        fixes: [
          { id: 'copy-budget', edit: { line: 8, text: '    let left = s.budget;' }, ok: true, why: 'A `u32` is Copy, so `left` keeps its own value and the field is free to change.' },
          {
            id: 'clone-sched',
            edit: { line: 8, text: '    let left = &s.clone().budget;' },
            ok: false,
            lure: 'clone',
            why: 'It copies the whole scheduler, queue and all, to read one `u32`.',
          },
          { id: 'mut-left', edit: { line: 8, text: '    let left = &mut s.budget;' }, ok: false, why: 'A `&mut` borrow takes every permission from `s.budget` while `left` lives, so line 9 still lacks W.' },
        ],
      },
      {
        id: 'mut-budget',
        edit: { line: 8, text: '    let left = &mut s.budget;' },
        expect: { code: 'E0506', line: 9 },
        why: '`left` borrows `s.budget` `&mut` until line 10, which takes all its permissions, and the assignment on line 9 needs W.',
        focus: { line: 9, path: 's.budget', needs: ['write'] },
        permission: 'write',
      },
      {
        id: 'move-queue',
        edit: { line: 9, text: '    let q = s.queue;' },
        expect: { code: 'E0507', line: 9 },
        why: 'Through `&mut Scheduler`, `s.queue` has R and W but no O, and moving the vector out needs O.',
        focus: { line: 9, path: 's.queue', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'shared-sched',
        edit: { line: 7, text: 'fn tick(s: &Scheduler) {' },
        expect: { code: 'E0594', line: 9 },
        why: 'Through a `&Scheduler`, `s.budget` has R but no W, and assigning to it needs W.',
        focus: { line: 9, path: 's.budget', needs: ['write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'prefix-cache-two-phase',
    kcs: [AL, BR],
    title: 'Record a prefix length in the cache',
    domain: 'PrefixCache',
    base: rs`
      struct PrefixCache {
          lens: Vec<usize>,
      }

      fn record(c: &mut PrefixCache) {
          c.lens.push(c.lens.len());
          let n = c.lens[0];
          c.lens.push(n);
          println!("{}", c.lens.len());
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'A method call reserves its `&mut` receiver but takes it only after the arguments run (a two-phase borrow), so `c.lens.len()` still has R.',
      },
      {
        id: 'explicit-mut',
        edit: { line: 6, text: '    Vec::push(&mut c.lens, c.lens.len());' },
        expect: { code: 'E0502', line: 6 },
        why: 'Written as a function call, `&mut c.lens` is taken before the arguments run, so `c.lens` has lost R when `len` needs it: the checker rejects a call that is safe.',
        focus: { line: 6, path: 'c.lens', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'iter-push',
        edit: { line: 8, text: '    for n in &c.lens { c.lens.push(*n); }' },
        expect: { code: 'E0502', line: 8 },
        why: 'The loop borrows `c.lens` with `&` for every pass, so it has no W for `push`: growing a vector while iterating it could move it under the iterator.',
        focus: { line: 8, path: 'c.lens', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'pop-push',
        edit: { line: 8, text: '    c.lens.push(c.lens.pop().unwrap());' },
        expect: { code: 'E0499', line: 8 },
        why: 'A two-phase borrow lets the arguments read, not write: `pop` needs a second `&mut` of `c.lens` while `push` has reserved the first.',
      },
    ],
  },
]
