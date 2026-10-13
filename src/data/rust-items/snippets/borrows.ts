/**
 * The borrows group of the compile bank (docs/specs/wave-2.md §15.5, task 2c-12): about fifty snippets on
 * borrows and slices in serving-domain names, each with a base that compiles and one-line edits that
 * rustc 1.96.0 rejects (E0499, E0502, E0503, E0506, E0594, E0596, and E0505 where a borrow blocks a move).
 * The themes: a collection changed while an iterator or an element borrow is alive (iterator
 * invalidation), two `&mut` of one place, an assignment while borrowed, a write through `&`, slices that
 * keep a whole buffer borrowed, and the safe patterns the analyzer accepts or rejects.
 *
 * Whys use Crichton's permissions: a path holds Read (R), Write (W) and Own (O); `&` removes W and O
 * while the borrow lives; `&mut` removes R as well; a borrow lasts to its last use, not to the end of the
 * block. A wrong fix that still fails says why in the same terms; a wrong fix that compiles is a lure
 * and says what it changes. `miss` ids name the idea a wrong pick shows:
 *   r.clone-to-silence (the default of a clone lure), r.mut-silences-borrow, r.late-use-ignored,
 *   r.same-borrow-new-spelling, r.drop-the-effect, r.assign-ends-borrow, r.mut-binding-grants-write.
 */

import { KC } from '@/data/kc/ids'
import { rs, type RustSnippet } from '../types'

const BR = KC.borrowRules
const OM = KC.ownershipMoves
const SL = 'r.slices'
const AL = KC.analyzerLimits

export const SNIPPETS: RustSnippet[] = [
  {
    id: 'queue-iter-mut-bumps',
    kcs: [BR],
    title: 'Bump every request id, then queue one more',
    domain: 'AdmissionQueue',
    base: rs`
      struct Req { id: u64 }

      fn bump(q: &mut Vec<Req>) {
          for r in q.iter_mut() {
              r.id += 1;
          }
          q.push(Req { id: 0 });
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The `&mut` borrow that `iter_mut` takes ends with the loop on line 6, so `push` on line 7 finds `q` with R and W again.',
      },
      {
        id: 'push-inside',
        edit: { line: 5, text: '        q.push(Req { id: 0 });' },
        expect: { code: 'E0499', line: 5 },
        why: '`iter_mut` keeps `q` mutably borrowed until the loop ends on line 6, so `push` on line 5 asks for a second `&mut` while the first is alive.',
        fixes: [
          { id: 'range-loop', edit: { line: 4, text: '    for _ in 0..q.len() {' }, ok: true, why: 'The range `0..q.len()` is worked out once and holds no borrow of `q`, so `push` finds W free and the loop still runs once per request.' },
          { id: 'shared-iter', edit: { line: 4, text: '    for _ in q.iter().rev() {' }, ok: false, miss: 'r.mut-silences-borrow', why: '`iter` takes a `&` borrow instead, which still removes W from `q` until the loop ends, so `push` is still blocked.' },
          { id: 'spare-req', edit: { line: 5, text: '        let _spare = Req { id: 0 };' }, ok: false, lure: 'other', miss: 'r.drop-the-effect', why: 'It builds a request and drops it at the end of the pass, so nothing is ever queued.' },
        ],
      },
      {
        id: 'len-inside',
        edit: { line: 5, text: '        println!("{}", q.len());' },
        expect: { code: 'E0502', line: 5 },
        why: '`iter_mut` lends `q` out `&mut`, which takes R and W away until line 6, so reading `q.len()` on line 5 lacks R.',
        focus: { line: 5, path: 'q.len()', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'remove-inside',
        edit: { line: 5, text: '        q.remove(0);' },
        expect: { code: 'E0499', line: 5 },
        why: '`remove` needs `&mut q`, and the loop on line 4 already holds one until line 6.',
      },
    ],
  },

  {
    id: 'id-list-iter-pushes',
    kcs: [BR],
    title: 'Print every id, then append a sentinel',
    domain: 'Scheduler',
    base: rs`
      fn expand(ids: &mut Vec<u64>) {
          for id in ids.iter() {
              println!("id {id}");
          }
          ids.push(0);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The `&` borrow that `iter` takes ends with the loop on line 4, so `push` on line 5 finds W on `ids` again.',
      },
      {
        id: 'push-inside',
        edit: { line: 3, text: '        ids.push(0);' },
        expect: { code: 'E0502', line: 3 },
        why: '`iter` lends `ids` out with `&` until the loop ends on line 4, which removes W, and `push` on line 3 needs it.',
        focus: { line: 3, path: 'ids', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'range-loop', edit: { line: 2, text: '    for _ in 0..ids.len() {' }, ok: true, why: 'The range is worked out once and holds no borrow of `ids`, so `push` finds W free on every pass.' },
          { id: 'iter-mut', edit: { line: 2, text: '    for _ in ids.iter_mut() {' }, ok: false, miss: 'r.mut-silences-borrow', why: '`iter_mut` holds a `&mut` borrow of `ids` for the whole loop, so `push` would need a second one.' },
          { id: 'clone-push', edit: { line: 3, text: '        ids.clone().push(ids.len() as u64);' }, ok: false, lure: 'clone', why: 'It pushes onto a copy of every id, dropped at the end of the line: the list never grows.' },
        ],
      },
      {
        id: 'insert-front',
        edit: { line: 3, text: '        ids.insert(0, *id);' },
        expect: { code: 'E0502', line: 3 },
        why: '`id` points into `ids`, so the loop keeps `ids` borrowed with `&`, and `insert` on line 3 needs W.',
        focus: { line: 3, path: 'ids', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'clear-inside',
        edit: { line: 3, text: '        ids.clear();' },
        expect: { code: 'E0502', line: 3 },
        why: '`clear` needs `&mut ids`, but the iterator from line 2 holds a `&` borrow of it until line 4.',
      },
    ],
  },

  {
    id: 'block-pool-iter-inserts',
    kcs: [BR],
    title: 'Log every block refcount, then add a block',
    domain: 'BlockPool',
    base: rs`
      use std::collections::HashMap;

      fn warm(pool: &mut HashMap<u64, u32>) {
          for (id, refs) in pool.iter() {
              println!("{id}: {refs}");
          }
          pool.insert(0, 1);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The iterator and the `id` and `refs` it hands out are done with after line 5, so `insert` on line 7 finds W on `pool`.',
      },
      {
        id: 'insert-inside',
        edit: { line: 5, text: '        pool.insert(*id + 1, *refs);' },
        expect: { code: 'E0502', line: 5 },
        why: '`id` and `refs` point into `pool`, so the loop keeps it borrowed with `&`, which removes W, and `insert` on line 5 needs it.',
        focus: { line: 5, path: 'pool', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'remove-inside',
        edit: { line: 5, text: '        pool.remove(id);' },
        expect: { code: 'E0502', line: 5 },
        why: '`remove` needs `&mut pool`, but `id` is a reference into it and the loop still runs.',
      },
      {
        id: 'entry-inside',
        edit: { line: 5, text: '        *pool.entry(*id).or_default() += 1;' },
        expect: { code: 'E0502', line: 5 },
        why: '`entry` borrows `pool` `&mut` and needs W, which the `&` borrow of the loop took away.',
        focus: { line: 5, path: 'pool', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'live-set-retain-closure',
    kcs: [BR],
    title: 'Keep only the requests below the queue length',
    domain: 'AdmissionQueue',
    base: rs`
      fn trim(v: &mut Vec<usize>) {
          let n = v.len();
          v.retain(|x| *x < n);
          println!("{}", v.len());
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The closure captures the copy `n`, not `v`, so `retain` finds `v` with W on line 3.',
      },
      {
        id: 'read-in-closure',
        edit: { line: 3, text: '    v.retain(|x| *x < v.len());' },
        expect: { code: 'E0502', line: 3 },
        why: 'The closure captures `v` with `&` and travels into `retain`, which removes W from `v`, and `retain` itself needs W.',
        focus: { line: 3, path: 'v', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'use-copy', edit: { line: 3, text: '    v.retain(|x| *x < n);' }, ok: true, why: 'The closure captures the copy `n`, so no borrow of `v` is alive when `retain` takes its `&mut`.' },
          { id: 'deref-len', edit: { line: 3, text: '    v.retain(|x| *x < (*v).len());' }, ok: false, miss: 'r.same-borrow-new-spelling', why: '`(*v).len()` is the same read of `v`, so the closure still captures it with `&`.' },
          { id: 'clone-len', edit: { line: 3, text: '    v.retain(|x| *x < v.clone().len());' }, ok: false, lure: 'clone', why: '`v.clone()` is still a read of `v` inside the closure, and it would copy the whole list on every element.' },
        ],
      },
      {
        id: 'contains-in-closure',
        edit: { line: 3, text: '    v.retain(|x| v.contains(x));' },
        expect: { code: 'E0502', line: 3 },
        why: 'The closure reads `v` through `contains`, so it captures `v` with `&` until `retain` is done, and `retain` needs W.',
        focus: { line: 3, path: 'v', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'tail-token-borrow',
    kcs: [BR],
    title: 'Repeat the last token, then queue a stop token',
    domain: 'TokenBuffer',
    base: rs`
      fn echo(out: &mut Vec<u32>) {
          let last = out.last().copied();
          out.push(last.unwrap_or(0));
          let tail = out.last().copied();
          out.push(1);
          println!("{tail:?}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`copied` turns the `&u32` into a `u32`, so `tail` holds no borrow of `out` when `push` runs on line 5.',
      },
      {
        id: 'borrow-tail',
        edit: { line: 4, text: '    let tail = out.last();' },
        expect: { code: 'E0502', line: 5 },
        why: '`tail` is a reference into `out` that line 6 still uses, so `out` has lost W until then, and `push` on line 5 needs it.',
        focus: { line: 5, path: 'out', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'copy-tail', edit: { line: 4, text: '    let tail = out.last().copied();' }, ok: true, why: 'A `u32` is Copy, so `tail` holds its own copy and nothing borrows `out` across the `push`.' },
          { id: 'last-mut', edit: { line: 4, text: '    let tail = out.last_mut();' }, ok: false, miss: 'r.mut-silences-borrow', why: '`last_mut` borrows `out` `&mut`, which takes R and W away until line 6, so `push` is blocked all the same.' },
          { id: 'clone-out', edit: { line: 4, text: '    let tail = out.clone().last();' }, ok: false, lure: 'clone', why: 'The cloned vector is a temporary dropped at the end of line 4, so `tail` would point into a value that is already gone.' },
        ],
      },
      {
        id: 'tail-mut',
        edit: { line: 4, text: '    let tail = out.last_mut();' },
        expect: { code: 'E0499', line: 5 },
        why: '`tail` is a `&mut` into `out` that line 6 still uses, and `push` on line 5 asks for a second `&mut`.',
      },
      {
        id: 'first-borrow',
        edit: { line: 4, text: '    let tail = out.first();' },
        expect: { code: 'E0502', line: 5 },
        why: '`first` hands out a reference into `out`, kept alive to line 6, which removes W from `out` before `push`.',
        focus: { line: 5, path: 'out', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'prefix-count-bump',
    kcs: [BR],
    title: 'Bump a prefix hit counter, then print the old count',
    domain: 'PrefixCache',
    base: rs`
      use std::collections::HashMap;

      fn bump(m: &mut HashMap<u64, u32>, k: u64) {
          let n = m.get(&k).copied().unwrap_or(0);
          m.insert(k, n + 1);
          println!("{n}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`copied` and `unwrap_or` leave `n` as a plain `u32`, so no borrow of `m` is alive when `insert` needs W on line 5.',
      },
      {
        id: 'borrow-count',
        edit: { line: 4, text: '    let n = m.get(&k).unwrap_or(&0);' },
        expect: { code: 'E0502', line: 5 },
        why: '`n` is a reference into `m` that line 6 still prints, so `m` has lost W until then, and `insert` on line 5 needs it.',
        focus: { line: 5, path: 'm', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'copy-count', edit: { line: 4, text: '    let n = m.get(&k).copied().unwrap_or(0);' }, ok: true, why: 'The count is a `u32`, so `n` can hold a copy and the borrow of `m` ends on line 4.' },
          { id: 'deref-count', edit: { line: 5, text: '    m.insert(k, *n + 1);' }, ok: false, miss: 'r.late-use-ignored', why: 'Reading `*n` here changes nothing: `n` is still alive for the print on line 6, so `m` still lacks W.' },
          { id: 'clone-map', edit: { line: 4, text: '    let n = m.clone().get(&k).unwrap_or(&0);' }, ok: false, lure: 'clone', why: 'The cloned map is a temporary dropped at the end of line 4, so `n` would point into a value that is already gone.' },
        ],
      },
      {
        id: 'first-value',
        edit: { line: 4, text: '    let n = m.values().next().unwrap_or(&0);' },
        expect: { code: 'E0502', line: 5 },
        why: '`values` borrows the whole map with `&`, and `n` keeps one value alive to line 6, so `insert` on line 5 lacks W.',
        focus: { line: 5, path: 'm', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'max-value',
        edit: { line: 4, text: '    let n = m.values().max().unwrap_or(&0);' },
        expect: { code: 'E0502', line: 5 },
        why: '`max` returns a reference into the map, kept alive by the print on line 6, so `insert` on line 5 lacks W.',
      },
    ],
  },

  {
    id: 'slot-counter-entry',
    kcs: [BR],
    title: 'Bump the counter slot, then read the map size',
    domain: 'Router',
    base: rs`
      use std::collections::HashMap;

      fn count(m: &mut HashMap<u64, u32>) {
          let slot = m.entry(7).or_insert(0);
          *slot += 1;
          println!("{}", m.len());
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`slot` is last used on line 5, so its `&mut` borrow of `m` is over and `m.len()` on line 6 finds R.',
      },
      {
        id: 'late-slot',
        edit: { line: 6, text: '    println!("{} {slot}", m.len());' },
        expect: { code: 'E0502', line: 6 },
        why: '`slot` is a `&mut` into `m` that this line still prints, so `m` has lost R and W, and `m.len()` needs R.',
        focus: { line: 6, path: 'm', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'second-entry',
        edit: { line: 6, text: '    m.entry(8).or_insert(*slot);' },
        expect: { code: 'E0499', line: 6 },
        why: '`slot` is still used as an argument, so its `&mut` borrow of `m` is alive when the second `entry` asks for another.',
      },
      {
        id: 'insert-with-slot',
        edit: { line: 6, text: '    m.insert(9, *slot);' },
        expect: { code: 'E0499', line: 6 },
        why: '`*slot` is read as an argument of `insert`, so the `&mut` borrow behind `slot` is alive when `insert` asks for a second one.',
      },
    ],
  },

  {
    id: 'batch-drain-sum',
    kcs: [BR],
    title: 'Drain a batch into a sum, then add its length',
    domain: 'Batch',
    base: rs`
      fn flush(b: &mut Vec<u32>) -> u32 {
          let mut sum = 0;
          for t in b.drain(..) {
              sum += t;
          }
          sum + b.len() as u32
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`drain` borrows `b` `&mut` only while the loop runs, so `b.len()` on line 6 finds R again.',
      },
      {
        id: 'len-inside',
        edit: { line: 4, text: '        sum += t + b.len() as u32;' },
        expect: { code: 'E0502', line: 4 },
        why: '`drain` holds `b` mutably borrowed until line 5, which takes R and W away, and `b.len()` on line 4 needs R.',
        focus: { line: 4, path: 'b.len()', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'push-inside',
        edit: { line: 4, text: '        b.push(t);' },
        expect: { code: 'E0499', line: 4 },
        why: '`drain` holds a `&mut` borrow of `b` for the whole loop, and `push` asks for a second one.',
      },
      {
        id: 'index-inside',
        edit: { line: 4, text: '        sum += b[0];' },
        expect: { code: 'E0502', line: 4 },
        why: 'Indexing reads `b`, which needs R, but the `&mut` borrow of `drain` has taken it until line 5.',
        focus: { line: 4, path: 'b', needs: ['read'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'mirror-queue-extend',
    kcs: [BR],
    title: 'Append a copy of the queue to itself',
    domain: 'AdmissionQueue',
    base: rs`
      fn mirror(q: &mut Vec<u64>) {
          let ids = q.to_vec();
          q.extend(ids);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`to_vec` copies the ids into a new vector that owns them, so `q` is not borrowed when `extend` takes its `&mut`.',
      },
      {
        id: 'lazy-ids',
        edit: { line: 2, text: '    let ids = q.iter().copied();' },
        expect: { code: 'E0502', line: 3 },
        why: 'The lazy iterator `ids` still reads `q` and is handed to `extend` on line 3, so `q` lacks W when `extend` needs it.',
        focus: { line: 3, path: 'q', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'to-vec', edit: { line: 2, text: '    let ids = q.to_vec();' }, ok: true, why: 'The vector owns its ids, so no borrow of `q` is alive when `extend` needs W.' },
          { id: 'lazy-take', edit: { line: 2, text: '    let ids = q.iter().copied().take(2);' }, ok: false, miss: 'r.same-borrow-new-spelling', why: 'A lazy iterator over `q` is still a borrow of `q`, alive until `extend` has consumed it.' },
          { id: 'clone-extend', edit: { line: 3, text: '    q.clone().extend(ids);' }, ok: false, lure: 'clone', why: 'It extends a copy of the queue and drops it: the real queue never grows.' },
        ],
      },
      {
        id: 'drain-ids',
        edit: { line: 2, text: '    let ids = q.drain(..);' },
        expect: { code: 'E0499', line: 3 },
        why: '`drain` holds a `&mut` borrow of `q` as long as `ids` lives, and `extend` on line 3 asks for another.',
      },
      {
        id: 'plain-iter',
        edit: { line: 2, text: '    let ids = q.iter();' },
        expect: { code: 'E0502', line: 3 },
        why: '`iter` yields references into `q`, so `ids` keeps `q` borrowed with `&` until `extend` has consumed it, and `extend` needs W.',
        focus: { line: 3, path: 'q', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'adjacent-block-bumps',
    kcs: [BR],
    title: 'Bump one block count, then its neighbour',
    domain: 'BlockPool',
    base: rs`
      fn trade(s: &mut [u32], i: usize) {
          let a = &mut s[i];
          *a += 1;
          let b = &mut s[i + 1];
          *b += 1;
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`a` is last used on line 3, so its `&mut` borrow of `s` is over when line 4 takes a second one.',
      },
      {
        id: 'use-both',
        edit: { line: 5, text: '    *b += *a;' },
        expect: { code: 'E0499', line: 4 },
        why: '`a` is still used on line 5, so its `&mut` borrow of `s` is alive when line 4 asks for another, and the checker cannot tell that the two indices differ.',
      },
      {
        id: 'swap-both',
        edit: { line: 5, text: '    std::mem::swap(a, b);' },
        expect: { code: 'E0499', line: 4 },
        why: '`swap` uses `a` after `b` is made, so two `&mut` borrows of `s` are alive at line 4, although the blocks they point to are different.',
        fixes: [
          { id: 'slice-swap', edit: { line: 5, text: '    s.swap(i, i + 1);' }, ok: true, why: '`swap` on the slice takes both indices itself and borrows `s` once, so no two `&mut` of it are alive together.' },
          { id: 'same-index', edit: { line: 4, text: '    let b = &mut s[i];' }, ok: false, miss: 'r.same-borrow-new-spelling', why: 'It borrows the same block as `a`, so `swap(a, b)` would let two names write one block.' },
          { id: 'copy-vec', edit: { line: 4, text: '    let b = &mut s.to_vec()[i + 1];' }, ok: false, miss: 'r.clone-to-silence', why: '`to_vec` reads all of `s` while `a`, a `&mut` borrow of it, is still needed by `swap`, so the copy trips the checker too (E0502 at line 4).' },
        ],
      },
      {
        id: 'print-both',
        edit: { line: 5, text: '    println!("{a} {b}");' },
        expect: { code: 'E0499', line: 4 },
        why: '`a` is read on line 5, after the second `&mut s[i + 1]` has been taken on line 4, so both borrows are alive together.',
      },
    ],
  },

  {
    id: 'router-load-shift',
    kcs: [BR],
    title: 'Move one unit of load between two replicas',
    domain: 'Router',
    base: rs`
      use std::collections::HashMap;

      fn shift(m: &mut HashMap<u64, u32>) {
          let a = m.get_mut(&1).unwrap();
          *a -= 1;
          let b = m.get_mut(&2).unwrap();
          *b += 1;
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`a` is last used on line 5, so its `&mut` borrow of `m` is over when line 6 takes a second one.',
      },
      {
        id: 'use-both',
        edit: { line: 7, text: '    *b += *a;' },
        expect: { code: 'E0499', line: 6 },
        why: '`a` is read on line 7, so its `&mut` borrow of `m` is alive when line 6 asks for another; two keys of one map still count as one place.',
      },
      {
        id: 'swap-both',
        edit: { line: 7, text: '    std::mem::swap(a, b);' },
        expect: { code: 'E0499', line: 6 },
        why: '`swap` needs `a` and `b` together, so two `&mut` borrows of `m` are alive at line 6.',
      },
      {
        id: 'shared-get',
        edit: { line: 6, text: '    let b = m.get(&2).unwrap();' },
        expect: { code: 'E0594', line: 7 },
        why: '`get` hands out a `&u32`, so `*b` has R but never W, and `+=` on line 7 needs W.',
        focus: { line: 7, path: '*b', needs: ['write'] },
        permission: 'write',
        fixes: [
          { id: 'get-mut', edit: { line: 6, text: '    let b = m.get_mut(&2).unwrap();' }, ok: true, why: '`get_mut` hands out a `&mut u32`, which carries the W that `+=` needs, and `a` is already finished with.' },
          { id: 'get-or-zero', edit: { line: 6, text: '    let b = m.get(&2).unwrap_or(&0);' }, ok: false, miss: 'r.same-borrow-new-spelling', why: 'A default does not change the type: `get` still hands out a `&u32`, so `*b` has no W.' },
          { id: 'copy-value', edit: { line: 7, text: '    let _c = *b + 1;' }, ok: false, lure: 'other', miss: 'r.drop-the-effect', why: 'It adds one to a local copy and throws it away, so the map never changes.' },
        ],
      },
    ],
  },

  {
    id: 'sampler-seed-access',
    kcs: [BR],
    title: 'Advance the seed, then retune the sampler',
    domain: 'Sampler',
    base: rs`
      struct Sampler { temp: f32, seed: u64 }

      impl Sampler {
          fn seed_mut(&mut self) -> &mut u64 {
              &mut self.seed
          }
      }

      fn warm(s: &mut Sampler) {
          let seed = s.seed_mut();
          *seed += 1;
          s.temp = 0.7;
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`seed` is last used on line 11, so the borrow of all of `s` that `seed_mut` took is over when line 12 writes `s.temp`.',
      },
      {
        id: 'read-temp',
        edit: { line: 12, text: '    *seed += s.temp as u64;' },
        expect: { code: 'E0503', line: 12 },
        why: '`seed_mut` borrows the whole `Sampler` `&mut`, not just `seed`, and `seed` is still used on this line, so `s.temp` has lost R.',
        focus: { line: 12, path: 's.temp', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'read-seed',
        edit: { line: 12, text: '    *seed += s.seed;' },
        expect: { code: 'E0503', line: 12 },
        why: '`seed` is a `&mut` into `s.seed` and is used after the read, so reading `s.seed` through `s` lacks R.',
        focus: { line: 12, path: 's.seed', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'second-call',
        edit: { line: 12, text: '    *seed += *s.seed_mut();' },
        expect: { code: 'E0499', line: 12 },
        why: 'A second `seed_mut` call needs `&mut s` while `seed` is still alive for the `+=`.',
      },
    ],
  },

  {
    id: 'sched-head-peek',
    kcs: [AL, BR],
    title: 'Peek at the queue head, then log it',
    domain: 'Scheduler',
    base: rs`
      struct Sched { q: Vec<u32>, log: Vec<u32> }

      impl Sched {
          fn first(&self) -> &u32 {
              &self.q[0]
          }
      }

      fn step(s: &mut Sched) {
          let head = &s.q[0];
          s.log.push(*head + 1);
          println!("{head}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`head` borrows only the field `s.q`, and `s.log` is a different place, so `push` on line 11 finds W on it.',
      },
      {
        id: 'via-method',
        edit: { line: 10, text: '    let head = s.first();' },
        expect: { code: 'E0502', line: 11 },
        why: '`first(&self)` borrows the whole `Sched`, so `head` keeps all of `s` shared until line 12, including `s.log`; the checker does not look inside the method.',
        focus: { line: 11, path: 's.log', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'field-borrow', edit: { line: 10, text: '    let head = &s.q[0];' }, ok: true, why: 'Naming the field borrows only `s.q`, so `s.log` keeps its W.' },
          { id: 'extend-log', edit: { line: 11, text: '    s.log.extend([*head + 1]);' }, ok: false, miss: 'r.same-borrow-new-spelling', why: 'The push is not the problem: `head` still borrows all of `s` until the print on line 12, whatever method appends.' },
          { id: 'second-head', edit: { line: 10, text: '    let head = &s.q[1];' }, ok: false, lure: 'other', miss: 'r.drop-the-effect', why: 'It borrows only the field `s.q`, so it compiles, but it peeks at the second request instead of the head.' },
        ],
      },
      {
        id: 'push-queue',
        edit: { line: 11, text: '    s.q.push(*head);' },
        expect: { code: 'E0502', line: 11 },
        why: '`head` points into `s.q` and is printed on line 12, so `s.q` lacks W when `push` needs it.',
        focus: { line: 11, path: 's.q', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'reset-queue',
        edit: { line: 11, text: '    s.q = vec![];' },
        expect: { code: 'E0506', line: 11 },
        why: '`head` borrows `s.q` until the print on line 12, so assigning a new vector to it lacks W.',
        focus: { line: 11, path: 's.q', needs: ['write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'queue-zip-self',
    kcs: [BR],
    title: 'Count the queued requests with a mutable walk',
    domain: 'AdmissionQueue',
    base: rs`
      fn count(v: &mut Vec<u32>) -> usize {
          let mut n = 0;
          for _ in v.iter_mut() {
              n += 1;
          }
          n
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'One `iter_mut` borrow of `v`, used for the whole loop, is all the loop needs.',
      },
      {
        id: 'zip-mut',
        edit: { line: 3, text: '    for _ in v.iter_mut().zip(&mut *v) {' },
        expect: { code: 'E0499', line: 3 },
        why: 'Both iterators are alive at once inside `zip`, so the second `&mut *v` asks for a `&mut` of `v` while the first holds one.',
      },
      {
        id: 'zip-shared',
        edit: { line: 3, text: '    for _ in v.iter_mut().zip(&*v) {' },
        expect: { code: 'E0502', line: 3 },
        why: 'The first `iter_mut` has taken R and W from `v` for the whole loop, so `&*v` in the same expression lacks R.',
        focus: { line: 3, path: '&*v', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'zip-copy',
        edit: { line: 3, text: '    for _ in v.iter_mut().zip(v.to_vec()) {' },
        expect: { code: 'E0502', line: 3 },
        why: 'Even a copy has to be read out of `v`, and `v.to_vec()` runs while the `iter_mut` borrow is alive, so `v` lacks R there; copy first, on its own line.',
        focus: { line: 3, path: 'v.to_vec()', needs: ['read'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'double-the-queue',
    kcs: [BR],
    title: 'Append a copy of the queue to itself',
    domain: 'AdmissionQueue',
    base: rs`
      fn merge(dst: &mut Vec<u32>, src: &[u32]) {
          dst.extend_from_slice(src);
      }

      fn double(q: &mut Vec<u32>) {
          let copy = q.to_vec();
          merge(q, &copy);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`copy` owns its ids, so passing `q` as `&mut` and `&copy` as `&` borrows two different places.',
      },
      {
        id: 'alias',
        edit: { line: 7, text: '    merge(q, q);' },
        expect: { code: 'E0502', line: 7 },
        why: 'The second `q` is borrowed as `&[u32]` for the whole call, which removes W from `q`, and the first `q` is lent out `&mut`, which needs W.',
        focus: { line: 7, path: 'q', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'use-copy', edit: { line: 7, text: '    merge(q, &copy);' }, ok: true, why: 'The second argument reads `copy`, a separate place, so `q` is lent out once.' },
          { id: 'whole-slice', edit: { line: 7, text: '    merge(q, &q[..]);' }, ok: false, miss: 'r.same-borrow-new-spelling', why: '`&q[..]` is the same `&` borrow of `q` with another spelling, alive beside the `&mut`.' },
          { id: 'empty-src', edit: { line: 7, text: '    merge(q, &Vec::new());' }, ok: false, lure: 'other', miss: 'r.drop-the-effect', why: 'It appends an empty slice, so nothing is borrowed twice and nothing is copied either.' },
        ],
      },
      {
        id: 'half-window',
        edit: { line: 7, text: '    merge(q, &q[..2]);' },
        expect: { code: 'E0502', line: 7 },
        why: 'The window `&q[..2]` borrows `q` with `&` for the whole call, which removes W, and the first argument needs W to lend `q` out `&mut`.',
        focus: { line: 7, path: 'q', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'as-slice',
        edit: { line: 7, text: '    merge(q, q.as_slice());' },
        expect: { code: 'E0502', line: 7 },
        why: '`as_slice` borrows `q` with `&` for the whole call, so the `&mut` of the first argument has no W to take.',
      },
    ],
  },

  {
    id: 'reborrow-parent',
    kcs: [BR],
    title: 'Push through a reborrow, then through the original',
    domain: 'TokenBuffer',
    base: rs`
      fn load(v: &mut Vec<u32>) {
          let w = &mut *v;
          w.push(1);
          v.push(2);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`w` is last used on line 3, so its reborrow of `*v` is over when `v.push` needs `&mut` on line 4.',
      },
      {
        id: 'len-in-args',
        edit: { line: 4, text: '    w.push(v.len() as u32);' },
        expect: { code: 'E0502', line: 4 },
        why: '`w` is a `&mut` into `*v` and is used by this very `push`, so `v` has lost R and `v.len()` needs it.',
        focus: { line: 4, path: 'v', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'extend-from-parent',
        edit: { line: 4, text: '    w.extend(v.iter());' },
        expect: { code: 'E0502', line: 4 },
        why: '`v.iter()` reads `*v` while `w`, a `&mut` reborrow of it, is still needed by `extend`.',
        focus: { line: 4, path: 'v.iter()', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'swap-both',
        edit: { line: 4, text: '    std::mem::swap(v, w);' },
        expect: { code: 'E0499', line: 4 },
        why: '`swap` is given `v` and `w` together, and `w` is a live `&mut` reborrow of `*v`, so `v` is lent a second time.',
      },
    ],
  },

  {
    id: 'id-source-bump',
    kcs: [AL, BR],
    title: 'Mint an id, then record it',
    domain: 'Scheduler',
    base: rs`
      struct Gen { ids: Vec<u64>, next: u64 }

      impl Gen {
          fn bump(&mut self) -> u64 {
              self.next += 1;
              self.next
          }
          fn fill(&mut self) {
              let id = self.bump();
              self.ids.push(id);
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`bump` finishes on line 9 and returns a plain `u64`, so `push` on line 10 borrows `self.ids` with nothing else alive.',
      },
      {
        id: 'push-bump',
        edit: { line: 10, text: '        self.ids.push(self.bump());' },
        expect: { code: 'E0499', line: 10 },
        why: '`self.ids` is lent out `&mut` for the `push`, and the argument calls `bump`, which needs `&mut *self`, a second borrow that overlaps the first.',
        fixes: [
          { id: 'bump-first', edit: { line: 10, text: '        self.ids.push(id);' }, ok: true, why: 'Line 9 has already called `bump`, so `push` takes `self.ids` with nothing else borrowed.' },
          { id: 'bump-plus', edit: { line: 10, text: '        self.ids.push(self.bump() + 0);' }, ok: false, miss: 'r.same-borrow-new-spelling', why: 'Adding zero changes nothing: `bump` is still called inside the arguments of a `push` that holds `self.ids`.' },
          { id: 'push-zero', edit: { line: 10, text: '        self.ids.push(0);' }, ok: false, lure: 'other', miss: 'r.drop-the-effect', why: 'It compiles, because a literal borrows nothing, but `bump` is never called, so the counter stops advancing and every record gets the id 0.' },
        ],
      },
      {
        id: 'insert-bump',
        edit: { line: 10, text: '        self.ids.insert(0, self.bump());' },
        expect: { code: 'E0499', line: 10 },
        why: 'The same overlap: `insert` holds `self.ids` `&mut` while `bump` takes `&mut *self`.',
      },
      {
        id: 'extend-bump',
        edit: { line: 10, text: '        self.ids.extend([self.bump()]);' },
        expect: { code: 'E0499', line: 10 },
        why: '`extend` holds `self.ids` `&mut` while its argument calls `bump`, which borrows all of `self` `&mut`.',
      },
      {
        id: 'push-field',
        edit: { line: 10, text: '        self.ids.push(self.next);' },
        expect: 'compiles',
        why: 'Reading the field `self.next` touches a different place than `self.ids`, so the two borrows do not overlap.',
      },
    ],
  },

  {
    id: 'demote-pools',
    kcs: [AL, BR],
    title: 'Drain the hot pool into the cold pool',
    domain: 'BlockPool',
    base: rs`
      fn mv(a: &mut Vec<u32>, b: &mut Vec<u32>) {
          b.extend(a.drain(..));
      }

      fn demote(p: &mut Vec<Vec<u32>>) {
          let (hot, cold) = p.split_at_mut(1);
          mv(&mut hot[0], &mut cold[0]);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`split_at_mut` returns two slices that cannot overlap, so `hot[0]` and `cold[0]` are two places the checker can tell apart.',
      },
      {
        id: 'index-both',
        edit: { line: 7, text: '    mv(&mut p[0], &mut p[1]);' },
        expect: { code: 'E0499', line: 7 },
        why: 'Each index borrows all of `p`, because the checker does not compare the indices, so the call holds two `&mut` of one place even though 0 and 1 differ.',
        fixes: [
          { id: 'use-halves', edit: { line: 7, text: '    mv(&mut hot[0], &mut cold[0]);' }, ok: true, why: 'The two halves come from `split_at_mut`, which proves to the checker that they do not overlap.' },
          { id: 'same-index', edit: { line: 7, text: '    mv(&mut p[0], &mut p[0]);' }, ok: false, miss: 'r.mut-silences-borrow', why: 'Now the two borrows really are the same place, which is the error the checker exists for.' },
          { id: 'clone-dst', edit: { line: 7, text: '    mv(&mut p[0], &mut p[1].clone());' }, ok: false, lure: 'clone', why: 'The copy is read out of `p` while the first `&mut p[0]` is alive, and a copy would swallow the blocks anyway.' },
        ],
      },
      {
        id: 'same-half',
        edit: { line: 7, text: '    mv(&mut hot[0], &mut hot[0]);' },
        expect: { code: 'E0499', line: 7 },
        why: 'Both arguments are `hot[0]`, the same place, so this one is a real double `&mut`.',
      },
      {
        id: 'half-and-whole',
        edit: { line: 7, text: '    mv(&mut hot[0], &mut p[1]);' },
        expect: { code: 'E0499', line: 7 },
        why: '`hot` still borrows all of `p` `&mut` for this call, so `&mut p[1]` is a second borrow of it.',
      },
    ],
  },

  {
    id: 'staging-copy-in',
    kcs: [SL, BR],
    title: 'Copy a staging window into the output buffer',
    domain: 'TokenBuffer',
    base: rs`
      fn copy_into(src: &[u32], dst: &mut [u32]) {
          dst[..src.len()].copy_from_slice(src);
      }

      fn warm(buf: &mut [u32], out: &mut [u32]) {
          copy_into(buf, out);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`buf` is read and `out` is written: two different buffers, one `&` and one `&mut`.',
      },
      {
        id: 'same-buffer',
        edit: { line: 6, text: '    copy_into(out, out);' },
        expect: { code: 'E0502', line: 6 },
        why: 'The first argument reads `out` as `&[u32]` and the second lends it out `&mut`, so `out` would be read and written in one call.',
        focus: { line: 6, path: 'out', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'use-buf', edit: { line: 6, text: '    copy_into(buf, out);' }, ok: true, why: '`buf` is a different buffer from `out`, so one is read and the other written.' },
          { id: 'full-range', edit: { line: 6, text: '    copy_into(&out[..], out);' }, ok: false, miss: 'r.same-borrow-new-spelling', why: '`&out[..]` is the same `&` borrow with another spelling, still alive beside `&mut out`.' },
          { id: 'empty-src', edit: { line: 6, text: '    copy_into(&buf[..0], out);' }, ok: false, lure: 'other', miss: 'r.drop-the-effect', why: 'It copies an empty window of `buf`, so nothing is borrowed twice and nothing is copied either.' },
        ],
      },
      {
        id: 'shifted-window',
        edit: { line: 6, text: '    copy_into(&buf[1..], buf);' },
        expect: { code: 'E0502', line: 6 },
        why: 'The window `&buf[1..]` is a `&` borrow of `buf`, and the second argument lends all of `buf` out `&mut`.',
        focus: { line: 6, path: 'buf', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'copy-first',
        edit: { line: 6, text: '    copy_into(&out.to_vec(), out);' },
        expect: 'compiles',
        why: '`to_vec` builds an owned `Vec` that holds no borrow of `out`, and the first argument finishes reading before the second is lent out.',
      },
    ],
  },

  {
    id: 'cache-table-pair',
    kcs: [BR],
    title: 'Write into the hot and cold tables of one cache',
    domain: 'KvBlockTable',
    base: rs`
      struct Cache { hot: Vec<u8>, cold: Vec<u8> }
      impl Cache {
          fn hot(&mut self) -> &mut Vec<u8> {
              &mut self.hot
          }
          fn cold(&mut self) -> &mut Vec<u8> {
              &mut self.cold
          }
      }

      fn fill(c: &mut Cache) {
          let src = c.hot();
          src.push(1);
          let dst = c.cold();
          dst.push(2);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`src` is last used on line 13, so its `&mut` borrow of `c` is over when line 14 calls `cold`.',
      },
      {
        id: 'use-src',
        edit: { line: 15, text: '    dst.push(src.len() as u8);' },
        expect: { code: 'E0499', line: 14 },
        why: '`src` is still read on line 15, so the `&mut` borrow of the whole cache that `hot()` took is alive when line 14 calls `cold()`; the method signature hides that the tables differ.',
      },
      {
        id: 'extend-src',
        edit: { line: 15, text: '    dst.extend(src.iter());' },
        expect: { code: 'E0499', line: 14 },
        why: '`src.iter()` keeps `src` alive past line 14, so two `&mut` borrows of `c` overlap.',
      },
      {
        id: 'read-cache',
        edit: { line: 15, text: '    dst.push(c.hot.len() as u8);' },
        expect: { code: 'E0502', line: 15 },
        why: '`dst` is a `&mut` into all of `c` and is used by this `push`, so `c.hot` has lost R and `c.hot.len()` needs it.',
        focus: { line: 15, path: 'c.hot', needs: ['read'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'queue-reset-peeked',
    kcs: [BR],
    title: 'Peek at the head, then empty the queue',
    domain: 'AdmissionQueue',
    base: rs`
      fn reset(q: &mut Vec<u32>) {
          let head = q.first().copied();
          *q = Vec::new();
          println!("{head:?}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`copied` leaves `head` holding a plain `Option<u32>`, so nothing borrows `*q` when line 3 assigns it.',
      },
      {
        id: 'peek-ref',
        edit: { line: 2, text: '    let head = q.first();' },
        expect: { code: 'E0506', line: 3 },
        why: '`head` is a reference into `*q` that line 4 still prints, so `*q` has lost W until then, and assigning a new vector to it needs W.',
        focus: { line: 3, path: '*q', needs: ['write'] },
        permission: 'write',
        fixes: [
          { id: 'copy-head', edit: { line: 2, text: '    let head = q.first().copied();' }, ok: true, why: 'The head is a `u32`, so `head` can hold a copy and no borrow of `*q` is alive at the assignment.' },
          { id: 'take-instead', edit: { line: 3, text: '    let _old = std::mem::take(q);' }, ok: false, miss: 'r.late-use-ignored', why: 'Emptying the vector another way still needs `&mut *q`, and `head` still borrows it until line 4.' },
          { id: 'clone-clear', edit: { line: 3, text: '    q.clone().clear();' }, ok: false, lure: 'clone', why: 'It empties a copy of the queue and drops it, so the real queue keeps every request.' },
        ],
      },
      {
        id: 'max-ref',
        edit: { line: 2, text: '    let head = q.iter().max();' },
        expect: { code: 'E0506', line: 3 },
        why: '`max` hands back a reference into `*q`, kept alive by the print on line 4, so assigning to `*q` lacks W.',
        focus: { line: 3, path: '*q', needs: ['write'] },
        permission: 'write',
      },
      {
        id: 'window-ref',
        edit: { line: 2, text: '    let head = q.get(..1);' },
        expect: { code: 'E0506', line: 3 },
        why: 'The window from `get` borrows `*q`, and the print on line 4 keeps it alive across the assignment.',
      },
    ],
  },

  {
    id: 'slot-owner-write',
    kcs: [BR],
    title: 'Note the old owner, then reassign the slot',
    domain: 'BlockPool',
    base: rs`
      struct Slot { owner: u32 }

      fn reassign(s: &mut Slot) {
          let who = s.owner;
          s.owner = 9;
          println!("{who}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`who` is a copy of a `u32`, so nothing borrows `s.owner` when line 5 writes it.',
      },
      {
        id: 'ref-owner',
        edit: { line: 4, text: '    let who = &s.owner;' },
        expect: { code: 'E0506', line: 5 },
        why: '`who` borrows `s.owner` with `&` until the print on line 6, which removes W from it, and the assignment on line 5 needs W.',
        focus: { line: 5, path: 's.owner', needs: ['write'] },
        permission: 'write',
      },
      {
        id: 'mut-owner',
        edit: { line: 4, text: '    let who = &mut s.owner;' },
        expect: { code: 'E0506', line: 5 },
        why: '`who` borrows `s.owner` with `&mut` until line 6, which takes R and W away, so writing to `s.owner` on line 5 lacks W.',
        focus: { line: 5, path: 's.owner', needs: ['write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'running-total-bump',
    kcs: [BR],
    title: 'Add to a running total and print before and after',
    domain: 'Metrics',
    base: rs`
      fn bump(total: &mut u64, n: u64) {
          let before = *total;
          *total += n;
          println!("{before} {total}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`before` is a copy of the `u64`, so `+=` on line 3 finds `*total` with R and W.',
      },
      {
        id: 'ref-before',
        edit: { line: 2, text: '    let before = &*total;' },
        expect: { code: 'E0506', line: 3 },
        why: '`before` borrows `*total` with `&` until the print on line 4, which removes W, and `+=` on line 3 needs it.',
        focus: { line: 3, path: 'total', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'copy-before', edit: { line: 2, text: '    let before = *total;' }, ok: true, why: 'A `u64` is Copy, so `before` holds a copy and the borrow ends on line 2.' },
          { id: 'spell-out', edit: { line: 3, text: '    *total = *total + n;' }, ok: false, miss: 'r.same-borrow-new-spelling', why: 'Writing the sum out is still an assignment to `*total`, which `before` keeps borrowed until line 4.' },
          { id: 'mut-before', edit: { line: 2, text: '    let before = &mut *total;' }, ok: false, miss: 'r.mut-silences-borrow', why: 'A `&mut` reborrow takes R as well as W from `*total`, so `+=` is blocked all the more.' },
        ],
      },
      {
        id: 'mut-before',
        edit: { line: 2, text: '    let before = &mut *total;' },
        expect: { code: 'E0503', line: 3 },
        why: '`before` is a `&mut` reborrow of `*total` that line 4 still prints, so `*total` has lost R, and `+=` reads it before it writes.',
        focus: { line: 3, path: 'total', needs: ['read', 'write'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'buffer-rotate-loop',
    kcs: [BR],
    title: 'Print the buffer, then start a new one',
    domain: 'TokenBuffer',
    base: rs`
      fn rotate(buf: &mut Vec<u32>) {
          for t in buf.iter() {
              println!("{t}");
          }
          *buf = Vec::new();
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The `iter` borrow ends with the loop on line 4, so line 5 can assign `*buf`.',
      },
      {
        id: 'reset-inside',
        edit: { line: 3, text: '        *buf = Vec::new();' },
        expect: { code: 'E0506', line: 3 },
        why: 'The loop holds `*buf` borrowed with `&` until line 4, which removes W, and assigning a new vector to it needs W.',
        focus: { line: 3, path: '*buf', needs: ['write'] },
        permission: 'write',
      },
      {
        id: 'take-inside',
        edit: { line: 3, text: '        let _old = std::mem::take(buf);' },
        expect: { code: 'E0502', line: 3 },
        why: '`take` is given `buf` as a `&mut` reborrow, but the iterator still holds a `&` borrow of it.',
      },
      {
        id: 'swap-inside',
        edit: { line: 3, text: '        std::mem::swap(buf, &mut vec![]);' },
        expect: { code: 'E0502', line: 3 },
        why: '`swap` needs `buf` `&mut`, which the shared borrow of the loop forbids until line 4.',
      },
      {
        id: 'truncate-inside',
        edit: { line: 3, text: '        buf.truncate(0);' },
        expect: { code: 'E0502', line: 3 },
        why: '`truncate` needs W on `*buf`, and the iterator of line 2 has taken it.',
        focus: { line: 3, path: 'buf', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'prompt-option-clear',
    kcs: [BR],
    title: 'Take the prompt out of a request, then clear the field',
    domain: 'Request',
    base: rs`
      struct Req { prompt: Option<String> }

      fn start(r: &mut Req) {
          let p = r.prompt.take();
          r.prompt = None;
          println!("{p:?}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`take` moves the string out and leaves `None`, so `p` owns it and nothing borrows `r.prompt` on line 5.',
      },
      {
        id: 'as-deref',
        edit: { line: 4, text: '    let p = r.prompt.as_deref();' },
        expect: { code: 'E0506', line: 5 },
        why: '`p` is a `&str` into `r.prompt`, printed on line 6, so `r.prompt` has lost W until then.',
        focus: { line: 5, path: 'r.prompt', needs: ['write'] },
        permission: 'write',
        fixes: [
          { id: 'take-it', edit: { line: 4, text: '    let p = r.prompt.take();' }, ok: true, why: '`take` moves the prompt out, so `p` owns it and nothing borrows the field.' },
          { id: 'as-ref-prompt', edit: { line: 4, text: '    let p = r.prompt.as_ref();' }, ok: false, miss: 'r.same-borrow-new-spelling', why: '`as_ref` borrows the field too, so `p` is a reference alive until line 6.' },
          { id: 'is-some', edit: { line: 5, text: '    let _s = r.prompt.is_some();' }, ok: false, lure: 'other', miss: 'r.drop-the-effect', why: 'It only reads the field, so the prompt is never cleared.' },
        ],
      },
      {
        id: 'as-ref',
        edit: { line: 4, text: '    let p = r.prompt.as_ref();' },
        expect: { code: 'E0506', line: 5 },
        why: '`as_ref` hands out a reference into the field, and the print on line 6 keeps it alive across the assignment.',
        focus: { line: 5, path: 'r.prompt', needs: ['write'] },
        permission: 'write',
      },
      {
        id: 'as-mut',
        edit: { line: 4, text: '    let p = r.prompt.as_mut();' },
        expect: { code: 'E0506', line: 5 },
        why: '`as_mut` borrows the field `&mut` until line 6, so assigning to it lacks W.',
      },
      {
        id: 'iter-next',
        edit: { line: 4, text: '    let p = r.prompt.iter().next();' },
        expect: { code: 'E0506', line: 5 },
        why: 'The iterator over the `Option` yields a reference into the field, kept alive to line 6.',
      },
    ],
  },

  {
    id: 'depth-counter-tick',
    kcs: [BR],
    title: 'Bump a depth counter through a reborrow, then read it',
    domain: 'DecodeLoop',
    base: rs`
      fn tick(n: &mut u32) -> u32 {
          let m = &mut *n;
          *m += 1;
          *n
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`m` is last used on line 3, so its reborrow of `*n` is over when line 4 reads it.',
      },
      {
        id: 'read-first',
        edit: { line: 4, text: '    *n + *m' },
        expect: { code: 'E0503', line: 4 },
        why: '`m` is still read after `*n`, so `*n` has lent out R and W to the reborrow and reading it lacks R.',
        focus: { line: 4, path: '*n', needs: ['read'] },
        permission: 'read',
        fixes: [
          { id: 'm-first', edit: { line: 4, text: '    *m + *n' }, ok: true, why: 'With `*m` read first, `m` is finished before `*n` is read, so the reborrow is over.' },
          { id: 'plus-zero', edit: { line: 4, text: '    *n + *m + 0' }, ok: false, miss: 'r.same-borrow-new-spelling', why: 'Adding zero changes nothing: `*n` is still read while `m` is alive for the second operand.' },
          { id: 'clone-n', edit: { line: 4, text: '    n.clone() + *m' }, ok: false, lure: 'clone', why: '`clone` reads `*n` too, so it needs the same R that `m` has taken, and it copies a `u32` for nothing.' },
        ],
      },
      {
        id: 'compare',
        edit: { line: 4, text: '    if *n > *m { 1 } else { 0 }' },
        expect: { code: 'E0503', line: 4 },
        why: 'The comparison reads `*n` while `m`, used on the same line, still holds `*n` mutably borrowed.',
        focus: { line: 4, path: '*n', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'times',
        edit: { line: 4, text: '    *n * *m' },
        expect: { code: 'E0503', line: 4 },
        why: '`*n` is read first and `m` is used afterwards, so the reborrow is alive during the read.',
      },
      {
        id: 'm-first',
        edit: { line: 4, text: '    *m + *n' },
        expect: 'compiles',
        why: 'A borrow lasts to its last use: `*m` is read first, so `m` is dead when `*n` is read.',
      },
    ],
  },

  {
    id: 'table-retire-first',
    kcs: [BR, OM],
    title: 'Note the first row, then retire the table',
    domain: 'KvBlockTable',
    base: rs`
      struct Table { rows: Vec<u32> }

      fn retire(t: Table) -> u32 {
          let first = t.rows[0];
          let n = t.rows.len() as u32;
          drop(t);
          n + first
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`first` is a copy of a `u32`, so nothing borrows `t` when `drop(t)` moves it on line 6.',
      },
      {
        id: 'ref-first',
        edit: { line: 4, text: '    let first = &t.rows[0];' },
        expect: { code: 'E0505', line: 6 },
        why: '`first` borrows into `t` and is used on line 7, so `t` has lost W and O until then, and `drop(t)` moves it, which needs O.',
        focus: { line: 6, path: 't', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          { id: 'copy-first', edit: { line: 4, text: '    let first = t.rows[0];' }, ok: true, why: 'A `u32` is Copy, so `first` holds a copy and nothing borrows `t` when it moves.' },
          { id: 'get-first', edit: { line: 4, text: '    let first = t.rows.get(0).unwrap();' }, ok: false, miss: 'r.same-borrow-new-spelling', why: 'Another borrowing accessor: `get` returns a reference into `t.rows`, alive until line 7.' },
          { id: 'keep-table', edit: { line: 6, text: '    let _kept = &t;' }, ok: false, lure: 'other', miss: 'r.drop-the-effect', why: 'It borrows `t` instead of moving it, so the table is never dropped here.' },
        ],
      },
      {
        id: 'first-method',
        edit: { line: 4, text: '    let first = t.rows.first().unwrap();' },
        expect: { code: 'E0505', line: 6 },
        why: '`first` is a reference into `t.rows`, used on line 7, so moving `t` on line 6 lacks O.',
        focus: { line: 6, path: 't', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'last-row',
        edit: { line: 4, text: '    let first = t.rows.last().unwrap();' },
        expect: { code: 'E0505', line: 6 },
        why: '`last` returns a reference into `t.rows`, alive until line 7, so `t` cannot be moved before that.',
      },
    ],
  },

  {
    id: 'sampler-cool-down',
    kcs: [BR],
    title: 'Print the temperature, then cool the sampler',
    domain: 'Sampler',
    base: rs`
      struct Sampler { temp: f32, top_k: u32 }

      fn cool(s: &mut Sampler) {
          println!("{}", s.temp);
          s.temp = 0.5;
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Through `&mut Sampler`, `s.temp` holds W, so the assignment on line 5 is allowed.',
      },
      {
        id: 'shared-param',
        edit: { line: 3, text: 'fn cool(s: &Sampler) {' },
        expect: { code: 'E0594', line: 5 },
        why: 'Through a `&Sampler`, `s.temp` has R but never W, and the assignment needs W.',
        focus: { line: 5, path: 's.temp', needs: ['write'] },
        permission: 'write',
        fixes: [
          { id: 'mut-param', edit: { line: 3, text: 'fn cool(s: &mut Sampler) {' }, ok: true, why: 'A `&mut Sampler` carries W on its fields, which the assignment needs.' },
          { id: 'mut-binding', edit: { line: 3, text: 'fn cool(mut s: &Sampler) {' }, ok: false, miss: 'r.mut-binding-grants-write', why: '`mut` lets `s` be reassigned, but what it points to is still behind a `&` and has no W.' },
          { id: 'local-copy', edit: { line: 5, text: '    let _t = s.temp * 0.5;' }, ok: false, lure: 'other', miss: 'r.drop-the-effect', why: 'It computes a local value and drops it, so the sampler keeps its old temperature.' },
        ],
      },
      {
        id: 'mut-binding',
        edit: { line: 3, text: 'fn cool(mut s: &Sampler) {' },
        expect: { code: 'E0594', line: 5 },
        why: '`mut` makes the binding `s` reassignable, but what `s` points to is still behind a `&`, and `s.temp` has no W.',
        focus: { line: 5, path: 's.temp', needs: ['write'] },
        permission: 'write',
      },
      {
        id: 'by-value',
        edit: { line: 3, text: 'fn cool(s: Sampler) {' },
        expect: { code: 'E0594', line: 5 },
        why: 'The parameter `s` is not declared `mut`, so `s.temp` has R but no W in this function.',
        focus: { line: 5, path: 's.temp', needs: ['write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'requests-mark-done',
    kcs: [BR],
    title: 'Mark every queued request as done',
    domain: 'AdmissionQueue',
    base: rs`
      struct Req { done: bool }

      fn finish(q: &mut Vec<Req>) {
          for r in q.iter_mut() {
              r.done = true;
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`iter_mut` yields `&mut Req`, so `r.done` holds W on every pass.',
      },
      {
        id: 'iter-shared',
        edit: { line: 4, text: '    for r in q.iter() {' },
        expect: { code: 'E0594', line: 5 },
        why: '`iter` yields `&Req`, so `r.done` has R but no W, and the assignment needs W.',
        focus: { line: 5, path: 'r.done', needs: ['write'] },
        permission: 'write',
        fixes: [
          { id: 'iter-mut', edit: { line: 4, text: '    for r in q.iter_mut() {' }, ok: true, why: '`iter_mut` yields `&mut Req`, which carries the W the assignment needs.' },
          { id: 'as-slice-loop', edit: { line: 4, text: '    for r in q.as_slice() {' }, ok: false, miss: 'r.same-borrow-new-spelling', why: '`as_slice` gives the same shared view of the queue, so each `r` is still a `&Req` with no W.' },
          { id: 'ref-loop', edit: { line: 4, text: '    for r in &*q {' }, ok: false, miss: 'r.same-borrow-new-spelling', why: '`&*q` re-borrows the queue with `&`, so each `r` is still a `&Req` with no W.' },
        ],
      },
      {
        id: 'ref-loop',
        edit: { line: 4, text: '    for r in &*q {' },
        expect: { code: 'E0594', line: 5 },
        why: '`&*q` re-borrows the queue with `&`, so each `r` has R but no W.',
        focus: { line: 5, path: 'r.done', needs: ['write'] },
        permission: 'write',
      },
      {
        id: 'as-slice',
        edit: { line: 4, text: '    for r in q.as_slice() {' },
        expect: { code: 'E0594', line: 5 },
        why: '`as_slice` gives a `&[Req]`, so each element is behind a `&` and has no W.',
      },
    ],
  },

  {
    id: 'map-flag-mark',
    kcs: [BR],
    title: 'Flag one entry of the replica map',
    domain: 'Router',
    base: rs`
      use std::collections::HashMap;

      fn mark(m: &mut HashMap<u64, bool>) {
          if let Some(v) = m.get_mut(&1) {
              *v = true;
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`get_mut` hands out a `&mut bool`, so `*v` holds W.',
      },
      {
        id: 'get-shared',
        edit: { line: 4, text: '    if let Some(v) = m.get(&1) {' },
        expect: { code: 'E0594', line: 5 },
        why: '`get` hands out a `&bool`, so `*v` has R but never W, and the assignment needs W.',
        focus: { line: 5, path: '*v', needs: ['write'] },
        permission: 'write',
      },
      {
        id: 'values',
        edit: { line: 4, text: '    for v in m.values() {' },
        expect: { code: 'E0594', line: 5 },
        why: '`values` yields `&bool`, so each `*v` is behind a `&` and has no W.',
        focus: { line: 5, path: '*v', needs: ['write'] },
        permission: 'write',
      },
      {
        id: 'iter-pairs',
        edit: { line: 4, text: '    for (_, v) in m.iter() {' },
        expect: { code: 'E0594', line: 5 },
        why: '`iter` yields `(&u64, &bool)`, so the value is shared and has no W.',
      },
    ],
  },

  {
    id: 'id-buffer-binding',
    kcs: [BR],
    title: 'Build a small id buffer and hand it back',
    domain: 'TokenBuffer',
    base: rs`
      fn load() -> Vec<u32> {
          let mut ids = Vec::new();
          ids.push(1);
          ids.push(2);
          ids
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`let mut` gives the binding W, and `push` borrows it `&mut`.',
      },
      {
        id: 'not-mut',
        edit: { line: 2, text: '    let ids = Vec::new();' },
        expect: { code: 'E0596', line: 2 },
        why: '`ids` is not declared `mut`, so it has R and O but no W, and `push` borrows it `&mut`, which needs W.',
        focus: { line: 3, path: 'ids', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'add-mut', edit: { line: 2, text: '    let mut ids = Vec::new();' }, ok: true, why: '`mut` on the binding gives it W, which `push` needs.' },
          { id: 'explicit-borrow', edit: { line: 3, text: '    (&mut ids).push(1);' }, ok: false, miss: 'r.mut-binding-grants-write', why: 'Writing the `&mut` out does not give `ids` the W it lacks.' },
          { id: 'name-type', edit: { line: 2, text: '    let ids: Vec<u32> = Vec::new();' }, ok: false, miss: 'r.mut-binding-grants-write', why: 'A type annotation says what `ids` holds, not what it may do: without `mut` it still has no W.' },
          { id: 'clone-ids', edit: { line: 5, text: '    ids.clone()' }, ok: false, lure: 'clone', why: 'It changes only what is returned, not the pushes above, which still lack W.' },
        ],
      },
      {
        id: 'vec-macro',
        edit: { line: 2, text: '    let ids = vec![0];' },
        expect: { code: 'E0596', line: 2 },
        why: 'A `vec!` literal in a binding without `mut` has no W, so `push` is refused.',
        focus: { line: 3, path: 'ids', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'typed-not-mut',
        edit: { line: 2, text: '    let ids: Vec<u32> = Vec::new();' },
        expect: { code: 'E0596', line: 2 },
        why: 'Naming the type changes nothing: without `mut`, `ids` has no W for `push`.',
      },
    ],
  },

  {
    id: 'prompt-head-clear',
    kcs: [SL, BR],
    title: 'Keep the first two tokens, then clear the buffer',
    domain: 'Request',
    base: rs`
      fn trim(buf: &mut Vec<u32>) {
          let head = buf[..2].to_vec();
          buf.clear();
          println!("{head:?}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`to_vec` copies the two tokens into a vector that owns them, so no borrow of `buf` is alive when `clear` needs W.',
      },
      {
        id: 'slice-ref',
        edit: { line: 2, text: '    let head = &buf[..2];' },
        expect: { code: 'E0502', line: 3 },
        why: 'The slice `head` borrows `buf` with `&` until the print on line 4, which removes W, and `clear` on line 3 needs it.',
        focus: { line: 3, path: 'buf', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'copy-head', edit: { line: 2, text: '    let head = buf[..2].to_vec();' }, ok: true, why: 'The copy owns its two tokens, so the borrow of `buf` ends on line 2.' },
          { id: 'mut-slice', edit: { line: 2, text: '    let head = &mut buf[..2];' }, ok: false, miss: 'r.mut-silences-borrow', why: 'A `&mut` slice takes R as well as W from `buf`, so `clear` is blocked all the more.' },
          { id: 'clone-clear', edit: { line: 3, text: '    buf.clone().clear();' }, ok: false, lure: 'clone', why: 'It clears a copy of the buffer and drops it, so the real buffer keeps every token.' },
        ],
      },
      {
        id: 'slice-mut',
        edit: { line: 2, text: '    let head = &mut buf[..2];' },
        expect: { code: 'E0499', line: 3 },
        why: '`head` is a `&mut` slice of `buf` that line 4 still prints, and `clear` asks for a second `&mut`.',
      },
      {
        id: 'get-window',
        edit: { line: 2, text: '    let head = buf.get(..2);' },
        expect: { code: 'E0502', line: 3 },
        why: '`get` returns the window as a reference into `buf`, kept alive by the print on line 4, so `clear` lacks W.',
        focus: { line: 3, path: 'buf', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'split-window',
        edit: { line: 2, text: '    let (head, _) = buf.split_at(2);' },
        expect: { code: 'E0502', line: 3 },
        why: '`split_at` hands out two slices of `buf`, and `head` keeps its borrow alive to line 4.',
      },
    ],
  },

  {
    id: 'first-word-shorten',
    kcs: [SL, BR],
    title: 'Measure the first word of a prompt, then clear it',
    domain: 'Request',
    base: rs`
      fn first_word(s: &str) -> &str {
          s.split(' ').next().unwrap_or("")
      }

      fn shorten(text: &mut String) {
          let w = first_word(text).len();
          text.clear();
          println!("{w}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`len` turns the borrowed word into a `usize`, so the borrow of `text` ends on line 6.',
      },
      {
        id: 'word-ref',
        edit: { line: 6, text: '    let w = first_word(text);' },
        expect: { code: 'E0502', line: 7 },
        why: '`first_word` returns a `&str` tied to `text`, and the print on line 8 keeps it alive, so `clear` on line 7 lacks W.',
        focus: { line: 7, path: 'text', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'take-len', edit: { line: 6, text: '    let w = first_word(text).len();' }, ok: true, why: 'The length is a `usize`, so the borrow of `text` ends on line 6 and `clear` finds W.' },
          { id: 'split-off', edit: { line: 7, text: '    let _cut = text.split_off(0).len();' }, ok: false, miss: 'r.late-use-ignored', why: '`split_off` needs W on `text` as well, and the word still borrows it until line 8.' },
          { id: 'clone-arg', edit: { line: 6, text: '    let w = first_word(&text.clone());' }, ok: false, lure: 'clone', why: 'The copy is a temporary dropped at the end of line 6, so the word would point into a value that is already gone.' },
        ],
      },
      {
        id: 'prefix-slice',
        edit: { line: 6, text: '    let w = &text[..3];' },
        expect: { code: 'E0502', line: 7 },
        why: 'The slice borrows all of `text` with `&` until line 8, so `clear` lacks W.',
        focus: { line: 7, path: 'text', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'trim-ref',
        edit: { line: 6, text: '    let w = text.trim();' },
        expect: { code: 'E0502', line: 7 },
        why: '`trim` returns a `&str` into `text`, and the print keeps it alive across the `clear`.',
      },
      {
        id: 'as-str',
        edit: { line: 6, text: '    let w = text.as_str();' },
        expect: { code: 'E0502', line: 7 },
        why: '`as_str` borrows all of `text`, and `w` is printed after `clear` has asked for W.',
        focus: { line: 7, path: 'text', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'window-extend-self',
    kcs: [BR],
    title: 'Append a window of the buffer to itself',
    domain: 'TokenBuffer',
    base: rs`
      fn grow(buf: &mut Vec<u8>) {
          let w = buf[1..3].to_vec();
          buf.extend_from_slice(&w);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`to_vec` copies the window into `w`, which owns it, so `extend_from_slice` borrows `buf` with nothing else alive.',
      },
      {
        id: 'window-ref',
        edit: { line: 2, text: '    let w = &buf[1..3];' },
        expect: { code: 'E0502', line: 3 },
        why: '`w` borrows `buf` with `&` and is passed to `extend_from_slice`, so `buf` lacks W when the call needs it.',
        focus: { line: 3, path: 'buf', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'window-mut',
        edit: { line: 2, text: '    let w = &mut buf[1..3];' },
        expect: { code: 'E0499', line: 3 },
        why: '`w` is a `&mut` slice of `buf` that line 3 still passes along, and `extend_from_slice` asks for a second `&mut`.',
      },
      {
        id: 'extend-self',
        edit: { line: 3, text: '    buf.extend_from_slice(&buf[1..3]);' },
        expect: { code: 'E0502', line: 3 },
        why: 'The argument `&buf[1..3]` borrows `buf` with `&` for the whole call, which removes W, and `extend_from_slice` needs W to grow it.',
        focus: { line: 3, path: 'buf', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'from-within', edit: { line: 3, text: '    buf.extend_from_within(1..3);' }, ok: true, why: '`extend_from_within` copies the window inside one call that borrows `buf` once.' },
          { id: 'extend-ref', edit: { line: 3, text: '    buf.extend(&buf[1..3]);' }, ok: false, miss: 'r.same-borrow-new-spelling', why: '`extend` is given the same borrowed window, so `buf` is read and grown in one call.' },
          { id: 'clone-extend', edit: { line: 3, text: '    buf.clone().extend(&buf[1..3]);' }, ok: false, lure: 'clone', why: 'It extends a copy of the buffer and drops it, so the real buffer never grows.' },
        ],
      },
      {
        id: 'from-within',
        edit: { line: 3, text: '    buf.extend_from_within(1..3);' },
        expect: 'compiles',
        why: 'One call borrows `buf` `&mut` and reads its own window inside, so no second borrow is ever alive.',
      },
    ],
  },

  {
    id: 'line-tag-suffix',
    kcs: [SL, BR],
    title: 'Tag a request line with a version suffix',
    domain: 'Request',
    base: rs`
      fn tag(line: &mut String) {
          let name = line.trim().to_string();
          line.push_str("-v2");
          println!("{name:?}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`to_string` copies the trimmed text into `name`, which owns it, so no borrow of `line` is alive at the `push_str`.',
      },
      {
        id: 'trim-ref',
        edit: { line: 2, text: '    let name = line.trim();' },
        expect: { code: 'E0502', line: 3 },
        why: '`trim` returns a `&str` into `line`, and the print on line 4 keeps it alive, so `push_str` lacks W.',
        focus: { line: 3, path: 'line', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'own-name', edit: { line: 2, text: '    let name = line.trim().to_string();' }, ok: true, why: 'The copy owns its text, so the borrow of `line` ends on line 2.' },
          { id: 'ref-trim', edit: { line: 2, text: '    let name = &line.trim();' }, ok: false, miss: 'r.same-borrow-new-spelling', why: 'A `&` in front of the same borrowed `&str` changes nothing: `name` still borrows `line` until line 4.' },
          { id: 'clone-push', edit: { line: 3, text: '    line.clone().push_str("-v2-latest");' }, ok: false, lure: 'clone', why: 'It appends a suffix to a copy of the line and drops it, so the real line stays untagged.' },
        ],
      },
      {
        id: 'prefix-slice',
        edit: { line: 2, text: '    let name = &line[..3];' },
        expect: { code: 'E0502', line: 3 },
        why: 'The slice borrows all of `line` with `&` until the print, so `push_str` lacks W.',
        focus: { line: 3, path: 'line', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'as-str',
        edit: { line: 2, text: '    let name = line.as_str();' },
        expect: { code: 'E0502', line: 3 },
        why: '`as_str` borrows `line` as a whole, and `name` is printed after `push_str` has asked for W.',
      },
      {
        id: 'first-token',
        edit: { line: 2, text: '    let name = line.split(\' \').next();' },
        expect: { code: 'E0502', line: 3 },
        why: 'The first token is a `&str` into `line`, alive until line 4, so the append lacks W.',
      },
    ],
  },

  {
    id: 'chunk-zero-pad',
    kcs: [SL, BR],
    title: 'Zero the head of every chunk, then mark the buffer',
    domain: 'TokenBuffer',
    base: rs`
      fn pad(b: &mut [u32]) {
          for c in b.chunks_mut(4) {
              c[0] = 0;
          }
          b[0] = 1;
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The `chunks_mut` borrow of `b` ends with the loop on line 4, so line 5 finds W again.',
      },
      {
        id: 'touch-parent',
        edit: { line: 3, text: '        b[0] = 1;' },
        expect: { code: 'E0503', line: 3 },
        why: '`chunks_mut` keeps all of `b` mutably borrowed until the loop ends, which takes R, W and O away, so `b[0] = 1` on line 3 cannot touch it.',
      },
      {
        id: 'read-parent',
        edit: { line: 3, text: '        c[0] = b[0];' },
        expect: { code: 'E0503', line: 3 },
        why: 'The `&mut` borrow of the loop has taken R and W from `b`, so reading `b[0]` lacks R.',
        focus: { line: 3, path: 'b[0]', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'len-parent',
        edit: { line: 3, text: '        c[0] = b.len() as u32;' },
        expect: { code: 'E0502', line: 3 },
        why: '`b.len()` borrows `b` with `&`, but the loop holds it `&mut` until line 4, so `b` lacks R.',
        focus: { line: 3, path: 'b.len()', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'chunks-shared',
        edit: { line: 2, text: '    for c in b.chunks(4) {' },
        expect: { code: 'E0594', line: 3 },
        why: '`chunks` yields `&[u32]` windows, so `c[0]` has R but no W, and the assignment needs W.',
        focus: { line: 3, path: 'c[0]', needs: ['write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'window-first-peak',
    kcs: [SL, BR],
    title: 'Read the first of four samples, then append a new one',
    domain: 'Metrics',
    base: rs`
      fn first(xs: &[f32]) -> &f32 {
          &xs[0]
      }

      fn track(w: &mut Vec<f32>) {
          let m = *first(&w[..4]);
          w.push(m + 1.0);
          println!("{m}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`*first(..)` copies the `f32` out, so no borrow of `w` is alive when `push` needs W on line 7.',
      },
      {
        id: 'ref-first',
        edit: { line: 6, text: '    let m = first(&w[..4]);' },
        expect: { code: 'E0502', line: 7 },
        why: '`m` is a reference tied to the window of `w` and is printed on line 8, so `push` on line 7 lacks W.',
        focus: { line: 7, path: 'w', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'copy-first', edit: { line: 6, text: '    let m = *first(&w[..4]);' }, ok: true, why: 'The value is an `f32`, so `m` holds a copy and the borrow ends on line 6.' },
          { id: 'reborrow-first', edit: { line: 6, text: '    let m = &*first(&w[..4]);' }, ok: false, miss: 'r.same-borrow-new-spelling', why: 'Reborrowing the result is still a reference tied to the window of `w`, alive until line 8.' },
          { id: 'insert-end', edit: { line: 7, text: '    w.insert(w.len(), m + 1.0);' }, ok: false, miss: 'r.same-borrow-new-spelling', why: '`insert` needs W on `w` just as `push` does, and `m` still borrows it.' },
        ],
      },
      {
        id: 'last-ref',
        edit: { line: 6, text: '    let m = w.last().unwrap();' },
        expect: { code: 'E0502', line: 7 },
        why: '`last` returns a reference into `w`, kept alive by the print on line 8, so `push` lacks W.',
        focus: { line: 7, path: 'w', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'index-ref',
        edit: { line: 6, text: '    let m = &w[0];' },
        expect: { code: 'E0502', line: 7 },
        why: '`&w[0]` borrows `w` with `&` until line 8, so the `push` on line 7 lacks W.',
      },
    ],
  },

  {
    id: 'adjacent-id-pairs',
    kcs: [SL, BR],
    title: 'Print adjacent id pairs, then append a sentinel',
    domain: 'Scheduler',
    base: rs`
      fn pairs(ids: &mut Vec<u32>) {
          for w in ids.windows(2) {
              println!("{} {}", w[0], w[1]);
          }
          ids.push(0);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The windows borrow `ids` only while the loop runs, so `push` on line 5 finds W again.',
      },
      {
        id: 'push-inside',
        edit: { line: 3, text: '        ids.push(w[0] + w[1]);' },
        expect: { code: 'E0502', line: 3 },
        why: 'Each window `w` is a slice of `ids`, so the loop keeps `ids` borrowed with `&`, which removes W, and `push` needs it.',
        focus: { line: 3, path: 'ids', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'sort-inside',
        edit: { line: 3, text: '        ids.sort();' },
        expect: { code: 'E0502', line: 3 },
        why: '`sort` needs `&mut ids`, but the `windows` iterator holds a `&` borrow of it until line 4.',
        focus: { line: 3, path: 'ids', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'truncate-inside',
        edit: { line: 3, text: '        ids.truncate(1);' },
        expect: { code: 'E0502', line: 3 },
        why: '`truncate` needs W on `ids`, which the borrowed windows have taken until the loop ends.',
      },
      {
        id: 'swap-inside',
        edit: { line: 3, text: '        ids.swap(0, 1);' },
        expect: { code: 'E0502', line: 3 },
        why: '`swap` on a vector is a `&mut` call, and the windows hold `ids` shared until line 4.',
      },
    ],
  },

  {
    id: 'half-mix-blocks',
    kcs: [SL, BR],
    title: 'Add the third block into the first',
    domain: 'BlockPool',
    base: rs`
      fn mix(buf: &mut [u32]) {
          let (a, b) = buf.split_at_mut(2);
          a[0] += b[0];
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`split_at_mut` returns two slices that cannot overlap, so `a[0]` is written while `b[0]` is read from a different place.',
      },
      {
        id: 'shared-split',
        edit: { line: 2, text: '    let (a, b) = buf.split_at(2);' },
        expect: { code: 'E0594', line: 3 },
        why: '`split_at` returns `&` slices, so `a[0]` has R but never W, and `+=` needs W.',
        focus: { line: 3, path: 'a[0]', needs: ['write'] },
        permission: 'write',
        fixes: [
          { id: 'split-mut', edit: { line: 2, text: '    let (a, b) = buf.split_at_mut(2);' }, ok: true, why: '`split_at_mut` returns `&mut` slices, so `a[0]` holds the W that `+=` needs.' },
          { id: 'swap-names', edit: { line: 2, text: '    let (b, a) = buf.split_at_mut(2);' }, ok: false, lure: 'other', miss: 'r.drop-the-effect', why: '`split_at_mut` gives `&mut` slices, so it compiles, but `a` is now the right half and the sum goes the wrong way.' },
          { id: 'sum-local', edit: { line: 3, text: '    let _s = a[0] + b[0];' }, ok: false, lure: 'other', miss: 'r.drop-the-effect', why: 'It computes the sum into a local and drops it, so the first block never changes.' },
        ],
      },
      {
        id: 'read-parent',
        edit: { line: 3, text: '    a[0] += buf[0];' },
        expect: { code: 'E0503', line: 3 },
        why: '`a` borrows `buf` `&mut` and is written by this `+=`, so reading `buf[0]` through the parent lacks R.',
        focus: { line: 3, path: 'buf[0]', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'len-parent',
        edit: { line: 3, text: '    a[0] += buf.len() as u32;' },
        expect: { code: 'E0502', line: 3 },
        why: '`buf.len()` reads `buf` with `&` while `a`, a `&mut` slice of it, is still needed for the write.',
        focus: { line: 3, path: 'buf.len()', needs: ['read'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'top-scores-sort',
    kcs: [SL, BR],
    title: 'Keep the first three scores, then sort them all',
    domain: 'Sampler',
    base: rs`
      fn top3(xs: &mut Vec<i32>) {
          let top = xs[..3].to_vec();
          xs.sort();
          println!("{top:?}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`to_vec` copies the three scores, so `sort` borrows `xs` with nothing else alive.',
      },
      {
        id: 'top-ref',
        edit: { line: 2, text: '    let top = &xs[..3];' },
        expect: { code: 'E0502', line: 3 },
        why: '`top` borrows `xs` with `&` until the print on line 4, which removes W, and `sort` needs it.',
        focus: { line: 3, path: 'xs', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'copy-top', edit: { line: 2, text: '    let top = xs[..3].to_vec();' }, ok: true, why: 'The copy owns its three scores, so the borrow of `xs` ends on line 2.' },
          { id: 'mut-top', edit: { line: 2, text: '    let top = &mut xs[..3];' }, ok: false, miss: 'r.mut-silences-borrow', why: 'A `&mut` slice takes R as well as W from `xs`, so `sort` is blocked all the more.' },
          { id: 'clone-sort', edit: { line: 3, text: '    xs.clone().sort_by(|a, b| a.cmp(b));' }, ok: false, lure: 'clone', why: 'It sorts a copy and drops it, so the real scores stay in their old order.' },
        ],
      },
      {
        id: 'top-iter',
        edit: { line: 2, text: '    let top = xs.iter().take(3);' },
        expect: { code: 'E0502', line: 3 },
        why: 'The lazy iterator `top` still reads `xs` when it is printed on line 4, so `sort` lacks W.',
        focus: { line: 3, path: 'xs', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'top-first',
        edit: { line: 2, text: '    let top = xs.first();' },
        expect: { code: 'E0502', line: 3 },
        why: '`first` returns a reference into `xs`, alive until the print, so `sort` lacks W.',
      },
      {
        id: 'top-mut',
        edit: { line: 2, text: '    let top = &mut xs[..3];' },
        expect: { code: 'E0499', line: 3 },
        why: '`top` is a `&mut` slice of `xs` that line 4 still prints, and `sort` asks for a second `&mut`.',
      },
    ],
  },

  {
    id: 'pair-slots-if-let',
    kcs: [AL, SL],
    title: 'Swap the first two blocks when a slice has them',
    domain: 'BlockPool',
    base: rs`
      use std::mem;

      fn trade(v: &mut [u32]) {
          if let [a, b, ..] = v {
              mem::swap(a, b);
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'A slice pattern binds `a` and `b` to two elements of one slice, and the checker knows the elements are different places.',
      },
      {
        id: 'index-twice',
        edit: { line: 5, text: '        mem::swap(&mut v[0], &mut v[1]);' },
        expect: { code: 'E0499', line: 5 },
        why: 'Each `v[i]` borrows all of `v`, because the checker does not compare indices, so two `&mut` of one place are alive although 0 and 1 differ.',
        fixes: [
          { id: 'slice-swap', edit: { line: 5, text: '        v.swap(0, 1);' }, ok: true, why: '`swap` on the slice takes both indices itself and borrows `v` once.' },
          { id: 'same-index', edit: { line: 5, text: '        mem::swap(&mut v[0], &mut v[0]);' }, ok: false, miss: 'r.mut-silences-borrow', why: 'Now both borrows are really the same place, which is the error the checker exists for.' },
          { id: 'copy-over', edit: { line: 5, text: '        v[0] = v[1].clone();' }, ok: false, lure: 'clone', why: 'It overwrites the first block with a copy of the second instead of swapping, so the first value is lost.' },
        ],
      },
      {
        id: 'index-again',
        edit: { line: 5, text: '        mem::swap(a, &mut v[1]);' },
        expect: { code: 'E0499', line: 5 },
        why: '`a` is a `&mut` into `v` that `swap` still needs, so `&mut v[1]` is a second borrow of `v`.',
      },
      {
        id: 'read-again',
        edit: { line: 5, text: '        *a += v[1];' },
        expect: { code: 'E0503', line: 5 },
        why: '`a` borrows `v` `&mut` and is written by this `+=`, so reading `v[1]` through `v` lacks R.',
        focus: { line: 5, path: 'v[1]', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'len-again',
        edit: { line: 5, text: '        *a += v.len() as u32;' },
        expect: { code: 'E0502', line: 5 },
        why: '`v.len()` reads `v` with `&` while `a`, a `&mut` into it, is still needed for the write.',
        focus: { line: 5, path: 'v.len()', needs: ['read'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'push-len-two-phase',
    kcs: [AL],
    title: 'Append the queue length to the queue',
    domain: 'AdmissionQueue',
    base: rs`
      fn append_len(v: &mut Vec<usize>) {
          v.push(v.len());
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'A method call on `v` first only reserves its `&mut`, so `v.len()` can read `v` before `push` activates; this is a two-phase borrow.',
      },
      {
        id: 'push-pop',
        edit: { line: 2, text: '    v.push(v.pop().unwrap());' },
        expect: { code: 'E0499', line: 2 },
        why: 'The reserved `&mut` of `push` allows only reads in the arguments, and `pop` needs W, so it is a second `&mut` of `v`.',
        fixes: [
          { id: 'pop-first', edit: { line: 2, text: '    if let Some(t) = v.pop() { v.push(t); }' }, ok: true, why: '`pop` finishes in the `if let` head and returns an owned `usize`, so `push` borrows `v` with nothing else alive.' },
          { id: 'push-len', edit: { line: 2, text: '    v.push(v.len());' }, ok: false, lure: 'other', miss: 'r.drop-the-effect', why: 'It compiles because a read is allowed there, but it appends the length instead of the popped value.' },
          { id: 'clone-push', edit: { line: 2, text: '    v.clone().push(v.pop().unwrap());' }, ok: false, lure: 'clone', why: 'It pops the last id and pushes it onto a copy that is dropped, so the id is lost.' },
        ],
      },
      {
        id: 'insert-pop',
        edit: { line: 2, text: '    v.insert(0, v.pop().unwrap());' },
        expect: { code: 'E0499', line: 2 },
        why: 'The same rule: `insert` reserves `&mut v`, and `pop` in its arguments asks for W.',
      },
      {
        id: 'extend-iter',
        edit: { line: 2, text: '    v.extend(v.iter());' },
        expect: { code: 'E0502', line: 2 },
        why: 'The iterator `v.iter()` is passed into `extend`, so its `&` borrow of `v` is still alive when `extend` activates its `&mut`.',
        focus: { line: 2, path: 'v', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'push-first',
        edit: { line: 2, text: '    v.push(*v.first().unwrap());' },
        expect: 'compiles',
        why: 'The `&` borrow from `first` ends as soon as `*` copies the value, before `push` activates its `&mut`.',
      },
    ],
  },

  {
    id: 'grid-row-peek',
    kcs: [AL, BR],
    title: 'Read one cell of a grid, then push onto another row',
    domain: 'KvBlockTable',
    base: rs`
      fn bump(grid: &mut Vec<Vec<usize>>) {
          let row = grid[0][0];
          grid[1].push(row + 1);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`row` is a copy of a `usize`, so nothing borrows `grid` when `grid[1]` is taken `&mut`.',
      },
      {
        id: 'ref-row',
        edit: { line: 2, text: '    let row = &grid[0][0];' },
        expect: { code: 'E0502', line: 3 },
        why: '`row` borrows `grid` with `&`, and `grid[1]` is taken `&mut` before the argument that reads `row`, so `grid` lacks W; the checker does not see that rows 0 and 1 differ.',
        focus: { line: 3, path: 'grid', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'copy-row', edit: { line: 2, text: '    let row = grid[0][0];' }, ok: true, why: 'A `usize` is Copy, so `row` holds a copy and no borrow of `grid` is alive at line 3.' },
          { id: 'deref-row', edit: { line: 3, text: '    grid[1].push(*row + 1);' }, ok: false, miss: 'r.late-use-ignored', why: 'Reading `*row` is still a use of the borrow while `grid[1]` has already been taken `&mut`.' },
          { id: 'other-cell', edit: { line: 2, text: '    let row = &grid[0][1];' }, ok: false, miss: 'r.same-borrow-new-spelling', why: 'Another cell is still a reference into `grid`, alive until the push is done.' },
        ],
      },
      {
        id: 'len-arg',
        edit: { line: 3, text: '    grid[1].push(grid.len());' },
        expect: { code: 'E0502', line: 3 },
        why: '`grid[1]` is taken `&mut` first, which removes R from `grid`, and `grid.len()` in the argument needs R.',
        focus: { line: 3, path: 'grid.len()', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'cell-arg',
        edit: { line: 3, text: '    grid[1].push(grid[0][0] + 1);' },
        expect: { code: 'E0502', line: 3 },
        why: 'Indexing `grid[0]` reads `grid`, but `grid[1]` has already been taken `&mut` for the `push`, so `grid` lacks R.',
        focus: { line: 3, path: 'grid[0][0]', needs: ['read'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'slot-release-enum',
    kcs: [BR],
    title: 'Free a used slot and log which block it held',
    domain: 'BlockPool',
    base: rs`
      enum Slot { Free, Used(u32) }

      fn release(s: &mut Slot) {
          if let Slot::Used(n) = *s {
              *s = Slot::Free;
              println!("freed {n}");
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Matching `*s` copies the `u32` into `n`, so nothing borrows `*s` when line 5 assigns it.',
      },
      {
        id: 'bind-ref',
        edit: { line: 4, text: '    if let Slot::Used(n) = s {' },
        expect: { code: 'E0506', line: 5 },
        why: 'Matching on `s` binds `n` as a `&mut u32` into the slot, and the print on line 6 keeps it alive, so assigning `*s` lacks W.',
        focus: { line: 5, path: '*s', needs: ['write'] },
        permission: 'write',
        fixes: [
          { id: 'copy-n', edit: { line: 4, text: '    if let Slot::Used(n) = *s {' }, ok: true, why: 'Matching the place `*s` copies the `u32`, so `n` borrows nothing.' },
          { id: 'match-shared', edit: { line: 4, text: '    if let Slot::Used(n) = &*s {' }, ok: false, miss: 'r.assign-ends-borrow', why: '`&*s` is a `&` borrow of the slot, so `n` is still a reference alive until line 6 and `*s` has no W.' },
          { id: 'spare-slot', edit: { line: 5, text: '        let _x = Slot::Free;' }, ok: false, lure: 'other', miss: 'r.drop-the-effect', why: 'It builds a free slot and drops it, so the real slot is never freed.' },
        ],
      },
      {
        id: 'bind-shared',
        edit: { line: 4, text: '    if let Slot::Used(n) = &*s {' },
        expect: { code: 'E0506', line: 5 },
        why: '`&*s` borrows the slot with `&`, so `n` is a `&u32` alive until line 6 and `*s` has no W.',
        focus: { line: 5, path: '*s', needs: ['write'] },
        permission: 'write',
      },
      {
        id: 'bind-mut',
        edit: { line: 4, text: '    if let Slot::Used(n) = &mut *s {' },
        expect: { code: 'E0506', line: 5 },
        why: '`&mut *s` borrows the slot `&mut`, so `n` is alive until line 6 and `*s` lacks W.',
      },
    ],
  },

  {
    id: 'gain-reborrows',
    kcs: [BR],
    title: 'Double a gain through one reborrow, then read it through another',
    domain: 'Sampler',
    base: rs`
      fn tune(t: &mut f32) {
          let w = &mut *t;
          *w *= 2.0;
          let r = &*t;
          println!("{r}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`w` is last used on line 3, so its `&mut` reborrow is over when line 4 takes the shared one.',
      },
      {
        id: 'both-live',
        edit: { line: 5, text: '    println!("{r} {w}");' },
        expect: { code: 'E0502', line: 4 },
        why: '`w` is still printed on line 5, so its `&mut` reborrow is alive when line 4 reads `*t` through `r`.',
        focus: { line: 4, path: '*t', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'times-t',
        edit: { line: 3, text: '    *w *= *t;' },
        expect: { code: 'E0503', line: 3 },
        why: '`w` is written by this `*=`, so its `&mut` reborrow of `*t` is alive while `*t` is read.',
        focus: { line: 3, path: '*t', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'shared-first',
        edit: { line: 2, text: '    let w = &*t;' },
        expect: { code: 'E0594', line: 3 },
        why: '`w` is a `&f32`, so `*w` has R but never W, and `*=` needs W.',
        focus: { line: 3, path: '*w', needs: ['write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'drop-idle-requests',
    kcs: [BR],
    title: 'Drop the front request once per queued request',
    domain: 'AdmissionQueue',
    base: rs`
      fn drop_idle(v: &mut Vec<u32>) {
          for _ in 0..v.len() {
              v.remove(0);
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The range `0..v.len()` is worked out once and holds no borrow of `v`, so `remove` finds W on every pass.',
      },
      {
        id: 'iter-remove',
        edit: { line: 2, text: '    for _ in v.iter() {' },
        expect: { code: 'E0502', line: 3 },
        why: '`iter` keeps `v` borrowed with `&` for the whole loop, which removes W, and `remove` on line 3 needs it.',
        focus: { line: 3, path: 'v', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'range-loop', edit: { line: 2, text: '    for _ in 0..v.len() {' }, ok: true, why: 'The range holds no borrow of `v`, so `remove` finds W on every pass.' },
          { id: 'iter-mut', edit: { line: 2, text: '    for _ in v.iter_mut() {' }, ok: false, miss: 'r.mut-silences-borrow', why: '`iter_mut` holds a `&mut` borrow of `v` for the whole loop, so `remove` would need a second one.' },
          { id: 'clone-remove', edit: { line: 3, text: '        v.clone().remove(0);' }, ok: false, lure: 'clone', why: 'It removes the front of a copy and drops it, so the real queue never shrinks.' },
        ],
      },
      {
        id: 'iter-mut-remove',
        edit: { line: 2, text: '    for _ in v.iter_mut() {' },
        expect: { code: 'E0499', line: 3 },
        why: '`iter_mut` holds `v` mutably borrowed for the loop, and `remove` asks for a second `&mut`.',
      },
      {
        id: 'drain-remove',
        edit: { line: 2, text: '    for _ in v.drain(..) {' },
        expect: { code: 'E0499', line: 3 },
        why: '`drain` holds a `&mut` borrow of `v` until the loop ends, and `remove` needs another.',
      },
      {
        id: 'rev-remove',
        edit: { line: 2, text: '    for _ in v.iter().rev() {' },
        expect: { code: 'E0502', line: 3 },
        why: '`rev` wraps the same `&` iterator over `v`, so `remove` still lacks W.',
        focus: { line: 3, path: 'v', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'top-id-insert',
    kcs: [BR],
    title: 'Find the top id of a set, then add a sentinel',
    domain: 'Scheduler',
    base: rs`
      use std::collections::HashSet;

      fn spread(s: &mut HashSet<u32>) {
          let top = s.iter().max().copied();
          s.insert(0);
          println!("{top:?}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`copied` leaves `top` holding a plain `Option<u32>`, so nothing borrows `s` when `insert` needs W on line 5.',
      },
      {
        id: 'max-ref',
        edit: { line: 4, text: '    let top = s.iter().max();' },
        expect: { code: 'E0502', line: 5 },
        why: '`top` is a reference into the set that line 6 still prints, so `s` has lost W until then, and `insert` needs it.',
        focus: { line: 5, path: 's', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          { id: 'copy-top', edit: { line: 4, text: '    let top = s.iter().max().copied();' }, ok: true, why: 'The element is a `u32`, so `top` can hold a copy and the borrow of `s` ends on line 4.' },
          { id: 'min-top', edit: { line: 4, text: '    let top = s.iter().min();' }, ok: false, miss: 'r.same-borrow-new-spelling', why: 'Another accessor that returns a reference into the set, alive until the print on line 6.' },
          { id: 'clone-insert', edit: { line: 5, text: '    s.clone().insert(0);' }, ok: false, lure: 'clone', why: 'It inserts the sentinel into a copy of the set and drops it, so the real set never gets it.' },
        ],
      },
      {
        id: 'min-ref',
        edit: { line: 4, text: '    let top = s.iter().min();' },
        expect: { code: 'E0502', line: 5 },
        why: '`min` returns a reference into the set, kept alive by the print on line 6, so `insert` lacks W.',
        focus: { line: 5, path: 's', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'next-ref',
        edit: { line: 4, text: '    let top = s.iter().next();' },
        expect: { code: 'E0502', line: 5 },
        why: 'The first element comes back as a reference into the set, alive until line 6.',
      },
      {
        id: 'get-ref',
        edit: { line: 4, text: '    let top = s.get(&1);' },
        expect: { code: 'E0502', line: 5 },
        why: '`get` returns a reference to the stored element, so `s` has no W for `insert` until the print is done.',
      },
    ],
  },

  {
    id: 'closure-field-capture',
    kcs: [AL, BR],
    title: 'Count in a closure while logging through the struct',
    domain: 'DecodeLoop',
    base: rs`
      struct Eng { n: u32, v: Vec<u32> }

      fn run() {
          let mut e = Eng { n: 0, v: vec![] };
          let mut f = || e.n += 1;
          e.v.push(1);
          f();
          f();
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The closure captures only the field `e.n`, so `e.v` is a different place and `push` finds its W.',
      },
      {
        id: 'assign-n',
        edit: { line: 6, text: '    e.n = 0;' },
        expect: { code: 'E0506', line: 6 },
        why: 'The closure holds `e.n` mutably borrowed until its last call on line 8, so assigning to `e.n` on line 6 lacks W.',
        focus: { line: 6, path: 'e.n', needs: ['write'] },
        permission: 'write',
      },
      {
        id: 'read-n',
        edit: { line: 6, text: '    println!("{}", e.n);' },
        expect: { code: 'E0502', line: 6 },
        why: 'The closure has taken R and W from `e.n` until line 8, so reading it on line 6 lacks R.',
        focus: { line: 6, path: 'e.n', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'reads-v',
        edit: { line: 5, text: '    let mut f = || { e.n += 1; e.v.len() };' },
        expect: { code: 'E0502', line: 6 },
        why: 'The closure now also reads `e.v`, so it captures that field with `&` until line 8, and `push` on line 6 lacks W.',
        focus: { line: 6, path: 'e.v', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'pops-v',
        edit: { line: 5, text: '    let mut f = || { e.n += 1; e.v.pop() };' },
        expect: { code: 'E0499', line: 6 },
        why: 'The closure now also captures `e.v` `&mut`, so the `push` on line 6 is a second `&mut` of it.',
      },
    ],
  },

  {
    id: 'batch-send-peeked',
    kcs: [BR, OM],
    title: 'Peek at a batch head, then hand the batch on',
    domain: 'Batch',
    base: rs`
      fn send(o: &mut Vec<Vec<u8>>, b: Vec<u8>) {
          let n = b[0];
          o.push(b);
          println!("{n:?}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`n` is a copy of a `u8`, so nothing borrows `b` when `push` moves it on line 3.',
      },
      {
        id: 'ref-first',
        edit: { line: 2, text: '    let n = &b[0];' },
        expect: { code: 'E0505', line: 3 },
        why: '`n` borrows into `b` and is printed on line 4, so `b` has lost W and O until then, and `push` moves it, which needs O.',
        focus: { line: 3, path: 'b', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          { id: 'copy-first', edit: { line: 2, text: '    let n = b[0];' }, ok: true, why: 'A `u8` is Copy, so `n` holds a copy and nothing borrows `b` when it moves.' },
          { id: 'head-slice', edit: { line: 2, text: '    let n = &b[0..1];' }, ok: false, miss: 'r.same-borrow-new-spelling', why: 'Borrowing the head as a slice is still a borrow of `b`, alive until the print on line 4, so `push` cannot move it.' },
          { id: 'clone-batch', edit: { line: 3, text: '    o.push(b.clone());' }, ok: false, lure: 'clone', why: 'It hands on a copy of every byte in the batch and keeps the original alive only to print one number.' },
        ],
      },
      {
        id: 'last-ref',
        edit: { line: 2, text: '    let n = b.last();' },
        expect: { code: 'E0505', line: 3 },
        why: '`last` returns a reference into `b`, kept alive by the print on line 4, so moving `b` on line 3 lacks O.',
        focus: { line: 3, path: 'b', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'max-ref',
        edit: { line: 2, text: '    let n = b.iter().max();' },
        expect: { code: 'E0505', line: 3 },
        why: '`max` yields a reference into `b`, so the batch cannot be moved before the print is done.',
      },
      {
        id: 'head-slice',
        edit: { line: 2, text: '    let n = &b[..1];' },
        expect: { code: 'E0505', line: 3 },
        why: 'The slice borrows `b` until line 4, which removes O, so `push` cannot take the batch.',
        focus: { line: 3, path: 'b', needs: ['read', 'own'] },
        permission: 'own',
      },
    ],
  },

  {
    id: 'request-done-borrowed',
    kcs: [BR, OM],
    title: 'Note a request id, release the request, then log',
    domain: 'Request',
    base: rs`
      struct Req { id: u64, text: String }

      fn done(r: Req) {
          let id = r.id;
          drop(r);
          println!("done {id}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`id` is a copy of a `u64`, so nothing borrows `r` when `drop(r)` moves it on line 5.',
      },
      {
        id: 'ref-id',
        edit: { line: 4, text: '    let id = &r.id;' },
        expect: { code: 'E0505', line: 5 },
        why: '`id` borrows into `r` and is printed on line 6, so `r` has lost W and O until then, and `drop(r)` moves it, which needs O.',
        focus: { line: 5, path: 'r', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          { id: 'copy-id', edit: { line: 4, text: '    let id = r.id;' }, ok: true, why: 'A `u64` is Copy, so `id` holds a copy and nothing borrows `r` when it moves.' },
          { id: 'drop-text', edit: { line: 5, text: '    drop(r.text);' }, ok: false, lure: 'other', miss: 'r.drop-the-effect', why: 'It moves out only the text, which does not conflict with the borrowed id, so it compiles, but the request is never released as a whole.' },
          { id: 'borrow-it', edit: { line: 5, text: '    let _ = &r;' }, ok: false, lure: 'other', miss: 'r.drop-the-effect', why: 'It only borrows `r`, which does nothing, so the request is not released at this point.' },
        ],
      },
      {
        id: 'ref-text',
        edit: { line: 4, text: '    let id = &r.text;' },
        expect: { code: 'E0505', line: 5 },
        why: '`id` is now a reference to the text inside `r`, printed on line 6, so `r` cannot be moved before then.',
        focus: { line: 5, path: 'r', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'as-str',
        edit: { line: 4, text: '    let id = r.text.as_str();' },
        expect: { code: 'E0505', line: 5 },
        why: '`as_str` borrows the string inside `r` until line 6, which removes O from `r`.',
        focus: { line: 5, path: 'r', needs: ['read', 'own'] },
        permission: 'own',
      },
    ],
  },
]
