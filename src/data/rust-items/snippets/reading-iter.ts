/**
 * The `reading-iter` group of the compile bank (docs/specs/serving-reading.md §4): serving-first reading items on
 * r.iterators-ownership. Serving code walks free lists, block tables, batches and grammar matchers with iterators, and
 * what a loop may do to the items depends on how it walks them: `iter` lends each item, `iter_mut` lends it for
 * changing, `into_iter` (and a bare `for x in v`) moves the collection into the loop. Adapters such as `filter` and
 * `map` do nothing until a consuming call (`collect`, `count`, `max_by_key`) pulls the chain through, and while a
 * chain or a loop still borrows a collection, nothing else may change it.
 *
 * Reader voice (§4.1): no Read/Write/Own labels, no permission or focus, reading KCs only; one fix that compiles and
 * keeps what the code does, every other compiling fix a labelled lure.
 */

import { rs, type RustSnippet, type SnippetFix } from '../types'

const I = 'r.iterators-ownership'

/** Misconceptions a wrong fix records when a learner picks it (a clone lure records `r.clone-to-silence`). */
const MISS = {
  /** Changing what the code returns is taken to be a fix. */
  changesBehaviour: 'r.fix-changes-meaning',
  /** `&`, `*` or `mut` is added wherever rustc complains, whatever the code needs. */
  refEverywhere: 'r.ref-fixes-all',
  /** Adding `mut`, or lending `&mut`, is taken to cure any borrow error. */
  mutCures: 'r.mut-cures-error',
  /** Draining or consuming a collection is taken to be the same as reading it. */
  consumeIsRead: 'r.consume-is-read',
} as const

const at = (line: number, text: string) => ({ line, text })
const good = (id: string, line: number, text: string, why: string): SnippetFix => ({ id, edit: at(line, text), ok: true, why })
const bad = (id: string, line: number, text: string, why: string, miss?: string): SnippetFix => ({ id, edit: at(line, text), ok: false, why, ...(miss ? { miss } : {}) })
const cloned = (id: string, line: number, text: string, why: string): SnippetFix => ({ id, edit: at(line, text), ok: false, lure: 'clone', why })
const drift = (id: string, line: number, text: string, why: string, miss: string = MISS.changesBehaviour): SnippetFix => ({ id, edit: at(line, text), ok: false, lure: 'other', why, miss })

export const SNIPPETS: RustSnippet[] = [
  {
    id: 'free-list-sum',
    kcs: [I],
    title: 'Sum the free list for the conservation check',
    domain: 'BlockPool',
    base: rs`
      struct Pool {
          free: Vec<u32>,
      }

      // block conservation: sum the free ids
      fn id_sum(p: &Pool) -> u32 {
          let mut sum = 0;
          for b in &p.free {
              sum += b;
          }
          sum
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`for b in &p.free` lends each block id to the loop and leaves the list where it is, which is all a check that only reads needs.',
      },
      {
        id: 'into-iter',
        edit: { line: 8, text: '    for b in p.free {' },
        expect: { code: 'E0507', line: 8 },
        why: 'A bare `for b in p.free` moves the list into the loop, and `p` only lends the pool, so the list cannot be taken out of it.',
        fixes: [
          good('borrow', 8, '    for b in &p.free {', 'Looping over `&p.free` lends each id and leaves the list in the pool.'),
          cloned('clone', 8, '    for b in p.free.clone() {', 'It copies the whole free list just to read it once.'),
          bad('mut-ref', 8, '    for b in &mut p.free {', '`&mut p.free` would lend each id for changing, which a lent pool cannot give, and a `&mut u32` cannot be added to the sum.', MISS.mutCures),
        ],
      },
      {
        id: 'drain',
        edit: { line: 8, text: '    for b in p.free.drain(..) {' },
        expect: { code: 'E0596', line: 8 },
        why: '`drain` takes every id out of the list as it goes, which changes the pool, and `p` lends it only for reading.',
        fixes: [
          good('borrow', 8, '    for b in &p.free {', 'Lending each id is all a sum needs; the free list stays as it was.'),
          drift('mut-pool', 6, 'fn id_sum(p: &mut Pool) -> u32 {', 'With a `&mut Pool`, `drain` compiles and empties the free list, so a check that should only read loses every free block.', MISS.consumeIsRead),
          bad('mut-ref', 8, '    for b in &mut p.free {', '`&mut p.free` asks to change the list through a pool lent only for reading, and a `&mut u32` cannot be added to the sum.', MISS.mutCures),
        ],
      },
      {
        id: 'sort-first',
        edit: { line: 7, text: '    let mut sum = 0; p.free.sort();' },
        expect: { code: 'E0596', line: 7 },
        why: 'Sorting reorders the free list in place, which changes the pool, and `p` lends it only for reading.',
      },
    ],
  },
  {
    id: 'batch-ids-loop',
    kcs: [I],
    title: 'Collect a batch\'s request ids, then its size',
    domain: 'Batch',
    base: rs`
      struct Req {
          id: u32,
      }

      fn ids(b: Vec<Req>) -> (Vec<u32>, usize) {
          let mut out = Vec::new();
          for r in &b {
              out.push(r.id);
          }
          (out, b.len())
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`for r in &b` lends each request to the loop, so the batch still exists for `b.len()` on line 10.',
      },
      {
        id: 'by-value',
        edit: { line: 7, text: '    for r in b {' },
        expect: { code: 'E0382', line: 10 },
        why: '`for r in b` moves the batch into the loop, which uses each request up, so `b.len()` on line 10 reads a batch that is gone.',
        fixes: [
          good('borrow-loop', 7, '    for r in &b {', 'Lending the batch to the loop keeps it for `b.len()`.'),
          bad('drain', 7, '    for r in b.drain(..) {', '`drain` empties the batch as it goes, which needs a `mut` binding; and line 10 would then count 0.', MISS.consumeIsRead),
          cloned('clone-loop', 7, '    for r in b.clone() {', '`Req` cannot be cloned; and the loop only reads ids, so no copy is needed.'),
          bad('mut-ref', 7, '    for r in &mut b {', '`&mut b` asks to change a batch not declared `mut`; the loop only reads ids anyway.', MISS.mutCures),
        ],
      },
      {
        id: 'iter-mut',
        edit: { line: 7, text: '    for r in &mut b {' },
        expect: { code: 'E0596', line: 7 },
        why: '`&mut b` lends the batch for changing, and `b` is not declared `mut`; the loop only reads ids anyway.',
      },
      {
        id: 'push-ref',
        edit: { line: 8, text: '        out.push(r);' },
        expect: { code: 'E0308', line: 10 },
        why: '`out` now collects borrowed `&Req` values, so it is not the `Vec<u32>` of ids that line 10 returns.',
        fixes: [
          good('push-id', 8, '        out.push(r.id);', 'Pushing each request\'s id, a `u32` copied out of the loan, builds the `Vec<u32>` of ids.'),
          bad('push-ref-ref', 8, '        out.push(&r);', 'Pushing a loan of the loan collects `&&Req` values, further from the ids.', MISS.refEverywhere),
          bad('push-deref', 8, '        out.push(*r);', 'That would collect whole requests, not ids, and a lent request cannot be moved out of the batch.', MISS.refEverywhere),
        ],
      },
    ],
  },
  {
    id: 'live-ids-chain',
    kcs: [I],
    title: 'Ids of the requests still running',
    domain: 'Batch',
    base: rs`
      struct Req {
          id: u32,
          done: bool,
      }

      fn live(w: &[Req]) -> Vec<u32> {
          w.iter()
              .filter(|r| !r.done)
              .map(|r| r.id)
              .collect()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`filter` and `map` only describe the work; `collect` on line 10 runs the chain and builds the `Vec`.',
      },
      {
        id: 'lazy-rev',
        edit: { line: 10, text: '        .rev()' },
        expect: { code: 'E0308', line: 7 },
        why: 'Without `collect` the chain is still an unrun iterator, not the `Vec<u32>` the function returns.',
        fixes: [
          good('collect', 10, '        .collect()', '`collect` runs the chain and gathers the ids into a `Vec`.'),
          drift('rev-collect', 10, '        .rev().collect()', 'It builds the `Vec` newest first, so the batch runs in the wrong order.'),
          bad('collect-box', 10, '        .collect::<Box<[u32]>>()', 'That runs the chain into a boxed slice of ids, and the function returns a `Vec<u32>`, a different type.'),
        ],
      },
      {
        id: 'owned-items',
        edit: { line: 9, text: '        .map(|r| *r)' },
        expect: { code: 'E0277', line: 10 },
        why: 'The chain now yields whole requests, and a `Vec<u32>` cannot be collected from them.',
        fixes: [
          good('id', 9, '        .map(|r| r.id)', 'Mapping each lent request to its id yields `u32` values, which collect into the `Vec<u32>`.'),
          bad('ref-id', 9, '        .map(|r| &r.id)', 'That yields borrowed `&u32` values, still not the `u32` ids the `Vec` holds.', MISS.refEverywhere),
          bad('same', 9, '        .map(|r| r)', 'The chain still yields borrowed requests, not ids.'),
        ],
      },
      {
        id: 'iter-mut',
        edit: { line: 7, text: '    w.iter_mut()' },
        expect: { code: 'E0596', line: 7 },
        why: '`iter_mut` lends each request for changing, and `w` is a shared slice that only lends them for reading.',
      },
    ],
  },
  {
    id: 'reap-finished',
    kcs: [I],
    title: 'Return the blocks of finished sequences',
    domain: 'Scheduler',
    base: rs`
      struct Seq { blocks: Vec<u32>, done: bool }

      fn reap(run: &mut Vec<Seq>,
              free: &mut Vec<u32>) {
          for s in run.iter() {
              if s.done {
                  free.extend(&s.blocks);
              }
          }
          run.retain(|s| !s.done);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The loop only lends each sequence, copies its block ids onto the free list, and lets go; `retain` on line 10 then removes the finished sequences.',
      },
      {
        id: 'retain-in-loop',
        edit: { line: 7, text: '            run.retain(|s| !s.done);' },
        expect: { code: 'E0502', line: 7 },
        why: 'The loop still lends `run` to `iter()` while `retain` tries to change it; removing sequences mid-walk would pull them out from under the loop.',
      },
      {
        id: 'extend-move',
        edit: { line: 7, text: '            free.extend(s.blocks);' },
        expect: { code: 'E0507', line: 7 },
        why: '`s` is a lent sequence, so its `blocks` list cannot be moved out of it.',
        fixes: [
          good('extend-ref', 7, '            free.extend(&s.blocks);', 'Extending from `&s.blocks` copies each `u32` id across and leaves the sequence whole until `retain` drops it.'),
          cloned('clone', 7, '            free.extend(s.blocks.clone());', 'It builds a throwaway copy of the list just to copy the ids again.'),
          bad('append', 7, '            free.append(&mut s.blocks);', '`append` empties the source list, which needs it lent for changing, and `iter()` lends each sequence only for reading.', MISS.mutCures),
        ],
      },
      {
        id: 'into-run',
        edit: { line: 5, text: '    for s in run {' },
        expect: { code: 'E0382', line: 10 },
        why: '`for s in run` moves the `&mut` reference itself into the loop, so `run.retain` on line 10 has nothing left to call it on.',
        fixes: [
          good('iter', 5, '    for s in run.iter() {', '`run.iter()` lends the list to the loop and gives it back for `retain`.'),
          drift('drain', 5, '    for s in run.drain(..) {', 'It empties the running list, so sequences that are still decoding are dropped with the finished ones.', MISS.consumeIsRead),
          bad('deref', 5, '    for s in *run {', '`*run` is the list itself, which cannot be moved out of the reference.', MISS.refEverywhere),
        ],
      },
    ],
  },
  {
    id: 'matcher-step',
    kcs: [I],
    title: 'Advance every grammar matcher by one token',
    domain: 'Sampler',
    base: rs`
      #[derive(Clone)]
      struct Matcher {
          state: u32,
      }

      impl Matcher {
          fn advance(&mut self, tok: u32) {
              self.state ^= tok;
          }
      }

      fn step(ms: &mut [Matcher], tok: u32) {
          for m in ms.iter_mut() {
              m.advance(tok);
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`iter_mut` lends each matcher for changing, so `advance` updates the matcher in the slice itself.',
      },
      {
        id: 'iter',
        edit: { line: 13, text: '    for m in ms.iter() {' },
        expect: { code: 'E0596', line: 14 },
        why: '`iter` lends each matcher only for reading, and `advance` changes it.',
        fixes: [
          good('iter-mut', 13, '    for m in ms.iter_mut() {', '`iter_mut` lends each matcher for changing, so the real matcher advances.'),
          cloned('clone-step', 14, '        m.clone().advance(tok);', 'It advances a throwaway copy, so every real matcher keeps its old state and the mask is wrong from the next token on.'),
          drift('cloned-iter', 13, '    for mut m in ms.iter().cloned() {', 'The loop gets owned copies, so it compiles, but it advances the copies and leaves the matchers in the slice behind.'),
        ],
      },
      {
        id: 'shared-slice',
        edit: { line: 12, text: 'fn step(ms: &[Matcher], tok: u32) {' },
        expect: { code: 'E0596', line: 13 },
        why: 'A shared slice lends the matchers only for reading, so `iter_mut` has nothing to lend for changing.',
        fixes: [
          good('mut-slice', 12, 'fn step(ms: &mut [Matcher], tok: u32) {', 'A `&mut` slice lets the loop change each matcher in place.'),
          bad('iter', 13, '    for m in ms.iter() {', 'Now the loop compiles up to `advance`, which still needs to change a matcher lent only for reading.', MISS.mutCures),
          drift('to-vec', 13, '    for mut m in ms.to_vec() {', 'It advances copies in a temporary `Vec`, and the caller\'s matchers never move.'),
        ],
      },
      {
        id: 'move-out',
        edit: { line: 14, text: '        let mut x = *m; x.advance(tok);' },
        expect: { code: 'E0507', line: 14 },
        why: '`m` lends a matcher that stays in the slice, so `*m` cannot move it out into `x`.',
      },
    ],
  },
  {
    id: 'admissible-count',
    kcs: [I],
    title: 'Count admissible requests, then clear the window',
    domain: 'Batch',
    base: rs`
      fn take(w: &mut Vec<u32>, c: u32) -> usize {
          let ok = w.iter().filter(|t| **t <= c);
          let n = ok.count();
          w.clear();
          n
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The `filter` chain borrows `w` until `count` on line 3 runs it to the end; after that nothing holds the borrow, so `clear` may change `w`.',
      },
      {
        id: 'push-early',
        edit: { line: 3, text: '    w.push(0); let n = ok.count();' },
        expect: { code: 'E0502', line: 3 },
        why: 'The chain on line 2 has not run yet and still borrows `w`, so `push` cannot change `w` before `count` runs it.',
      },
      {
        id: 'no-deref',
        edit: { line: 2, text: '    let ok = w.iter().filter(|t| t <= c);' },
        expect: { code: 'E0308', line: 2 },
        why: '`iter` lends each count as a `&u32`, and `filter` lends that again, so `t` is a `&&u32`, two references away from the `u32` it is compared with.',
        fixes: [
          good('deref-twice', 2, '    let ok = w.iter().filter(|t| **t <= c);', 'Two `*` follow both loans to the count itself, which compares with `c`.'),
          bad('deref-once', 2, '    let ok = w.iter().filter(|t| *t <= c);', 'One `*` leaves a `&u32`, still a reference away from `c`.', MISS.refEverywhere),
          drift('strict', 2, '    let ok = w.iter().filter(|t| **t < c);', 'A request of exactly `c` tokens is no longer counted as admissible.'),
        ],
      },
    ],
  },
  {
    id: 'batch-drain',
    kcs: [I],
    title: 'Take the head of the waiting queue as a batch',
    domain: 'Batch',
    base: rs`
      struct Req {
          id: u32,
      }

      fn batch(w: &mut Vec<Req>, n: usize)
          -> Vec<Req> {
          let k = n.min(w.len());
          w.drain(..k).collect()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`drain(..k)` moves the first `k` requests out of the queue and closes the gap, so the batch owns them and the queue keeps the rest.',
      },
      {
        id: 'index-move',
        edit: { line: 8, text: '    vec![w[0]]' },
        expect: { code: 'E0507', line: 8 },
        why: 'Indexing only lends the element, and moving it out would leave a hole in the queue, so `w[0]` cannot be moved into the batch.',
        fixes: [
          good('drain', 8, '    w.drain(..k).collect()', '`drain` moves the head out and shifts the rest down, so the queue has no hole.'),
          bad('ref', 8, '    vec![&w[0]]', 'A batch of borrowed requests is not the owned `Vec<Req>` the function returns.', MISS.refEverywhere),
          drift('split-off', 8, '    w.split_off(k)', 'It takes the tail of the queue instead of its head, so the newest requests jump ahead of the oldest.'),
        ],
      },
      {
        id: 'shared',
        edit: { line: 5, text: 'fn batch(w: &Vec<Req>, n: usize)' },
        expect: { code: 'E0596', line: 8 },
        why: '`drain` takes requests out of the queue, which changes it, and `&Vec` lends the queue only for reading.',
        fixes: [
          good('mut-queue', 5, 'fn batch(w: &mut Vec<Req>, n: usize)', 'A `&mut` queue lets `drain` move the batch out of it.'),
          bad('take-refs', 8, '    w.iter().take(k).collect()', 'That collects borrowed `&Req` values, and the batch must own its requests.', MISS.refEverywhere),
          bad('mut-binding', 5, 'fn batch(mut w: &Vec<Req>, n: usize)', 'A `mut` binding lets `w` point elsewhere; the queue it points at is still lent only for reading.', MISS.mutCures),
        ],
      },
      {
        id: 'owned',
        edit: { line: 5, text: 'fn batch(w: Vec<Req>, n: usize)' },
        expect: { code: 'E0596', line: 8 },
        why: '`w` now owns a queue of its own but is not declared `mut`, so `drain` cannot change it; and the caller\'s queue would never shrink.',
      },
    ],
  },
  {
    id: 'decode-step',
    kcs: [I],
    title: 'One decode step over the running sequences',
    domain: 'Batch',
    base: rs`
      struct Seq {
          left: u32,
      }

      fn step(run: &mut Vec<Seq>) -> usize {
          for s in run.iter_mut() {
              s.left -= 1;
          }
          run.retain(|s| s.left > 0);
          run.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`iter_mut` lends each sequence for changing; once the loop ends, `retain` may change the list itself.',
      },
      {
        id: 'iter-shared',
        edit: { line: 6, text: '    for s in run.iter() {' },
        expect: { code: 'E0594', line: 7 },
        why: '`iter` lends each sequence only for reading, so `s.left -= 1` cannot change it.',
        fixes: [
          good('iter-mut', 6, '    for s in run.iter_mut() {', '`iter_mut` lends each sequence for changing, so its count goes down.'),
          drift('no-step', 7, '        let _left = s.left - 1;', 'Nothing is decremented, so no sequence ever finishes.'),
          bad('mut-binding', 6, '    for mut s in run.iter() {', 'A `mut` binding lets `s` point at another sequence; the sequence itself is still lent only for reading.', MISS.mutCures),
        ],
      },
      {
        id: 'by-value',
        edit: { line: 6, text: '    for s in run {' },
        expect: { code: 'E0382', line: 9 },
        why: '`for s in run` moves the `&mut` reference into the loop, so line 9 has no `run` left to call `retain` on.',
        fixes: [
          good('iter-mut', 6, '    for s in run.iter_mut() {', '`iter_mut` lends the list to the loop and gives it back for `retain`.'),
          bad('shared', 6, '    for s in &*run {', 'That lends each sequence only for reading, so `s.left -= 1` cannot change it.', MISS.refEverywhere),
          drift('drain', 6, '    for mut s in run.drain(..) {', 'It empties the running list, so every sequence is dropped after one step.', MISS.consumeIsRead),
        ],
      },
      {
        id: 'retain-inside',
        edit: { line: 7, text: '        run.retain(|s| s.left > 0);' },
        expect: { code: 'E0499', line: 7 },
        why: 'The loop already lends `run` for changing through `iter_mut`, and `retain` asks for a second such loan of the same list.',
      },
    ],
  },
  {
    id: 'prune-finished',
    kcs: [I],
    title: 'Keep only unfinished requests',
    domain: 'AdmissionQueue',
    base: rs`
      struct Req {
          id: u32,
          done: bool,
      }

      fn prune(q: Vec<Req>) -> Vec<Req> {
          q.into_iter()
              .filter(|r| !r.done)
              .collect()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`into_iter` moves each request out of the queue, `filter` keeps the unfinished ones, and `collect` gathers them into a new queue that owns them.',
      },
      {
        id: 'iter-refs',
        edit: { line: 7, text: '    q.iter()' },
        expect: { code: 'E0277', line: 9 },
        why: '`iter` lends the requests, so the chain yields `&Req`, and a `Vec<Req>` cannot be collected from borrowed requests.',
        fixes: [
          good('into-iter', 7, '    q.into_iter()', '`into_iter` moves the requests themselves through the chain, so the new queue owns them.'),
          bad('drain', 7, '    q.drain(..)', '`drain` would hand the requests over, but it changes the queue, and `q` is not declared `mut`.', MISS.mutCures),
          bad('iter-mut', 7, '    q.iter_mut()', '`iter_mut` lends each request for changing; it still does not hand them over.', MISS.mutCures),
        ],
      },
      {
        id: 'count',
        edit: { line: 9, text: '        .count()' },
        expect: { code: 'E0308', line: 7 },
        why: '`count` runs the chain and gives a number, and the function returns the queue.',
      },
      {
        id: 'borrow-q',
        edit: { line: 6, text: 'fn prune(q: &Vec<Req>) -> Vec<Req> {' },
        expect: { code: 'E0277', line: 9 },
        why: 'A borrowed queue can only lend its requests, so the chain yields `&Req`, and the result must own them.',
        fixes: [
          good('owned', 6, 'fn prune(q: Vec<Req>) -> Vec<Req> {', 'Taking the queue by value lets `into_iter` move the requests through the chain.'),
          bad('mut-ref', 6, 'fn prune(q: &mut Vec<Req>) -> Vec<Req> {', 'A `&mut` queue lends its requests for changing, and still cannot hand them over.', MISS.mutCures),
          bad('slice', 6, 'fn prune(q: &[Req]) -> Vec<Req> {', 'A slice lends its requests as well.', MISS.refEverywhere),
        ],
      },
    ],
  },
]
