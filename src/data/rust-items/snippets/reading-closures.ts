/**
 * The `reading-closures` group of the compile bank (docs/specs/serving-reading.md §4): serving-first reading items on
 * r.closures-collections. Serving code counts with maps (BPE pair counts, per-tenant usage), passes policies and
 * comparators as closures, and hands closures to worker threads. What a closure captures, and how, decides what the
 * code around it may still do: a closure that reads a map lends it for as long as the closure lives, one that changes
 * a captured budget is `FnMut`, and a `move` closure takes what it captures with it.
 *
 * Reader voice (§4.1): no Read/Write/Own labels, no permission or focus, reading KCs only; one fix that compiles and
 * keeps what the code does, every other compiling fix a labelled lure.
 */

import { rs, type RustSnippet, type SnippetFix } from '../types'

const C = 'r.closures-collections'

/** Misconceptions a wrong fix records when a learner picks it (a clone lure records `r.clone-to-silence`). */
const MISS = {
  changesBehaviour: 'r.fix-changes-meaning',
  refEverywhere: 'r.ref-fixes-all',
  mutCures: 'r.mut-cures-error',
  /** `move` is taken to fix any closure error, whatever the closure must do to what it captures. */
  moveCures: 'r.move-cures-closure',
} as const

const at = (line: number, text: string) => ({ line, text })
const good = (id: string, line: number, text: string, why: string): SnippetFix => ({ id, edit: at(line, text), ok: true, why })
const bad = (id: string, line: number, text: string, why: string, miss?: string): SnippetFix => ({ id, edit: at(line, text), ok: false, why, ...(miss ? { miss } : {}) })
const cloned = (id: string, line: number, text: string, why: string): SnippetFix => ({ id, edit: at(line, text), ok: false, lure: 'clone', why })
const drift = (id: string, line: number, text: string, why: string, miss: string = MISS.changesBehaviour): SnippetFix => ({ id, edit: at(line, text), ok: false, lure: 'other', why, miss })

export const SNIPPETS: RustSnippet[] = [
  {
    id: 'pair-counts-entry',
    kcs: [C],
    title: 'Count adjacent token pairs, as bpe.py does',
    domain: 'Tokenizer',
    base: rs`
      use std::collections::HashMap;

      type Counts = HashMap<(u32, u32), u32>;

      fn count(ids: &[u32]) -> Counts {
          let mut c = Counts::new();
          for w in ids.windows(2) {
              let p = (w[0], w[1]);
              *c.entry(p).or_insert(0) += 1;
          }
          c
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`entry(p).or_insert(0)` finds the pair\'s count, adding a 0 the first time, and lends it for changing, so `+= 1` updates the map in place; the function then hands the map to its caller.',
      },
      {
        id: 'no-mut',
        edit: { line: 6, text: '    let c = Counts::new();' },
        expect: { code: 'E0596', line: 9 },
        why: '`entry` changes the map, and `c` is not declared `mut`.',
        fixes: [
          good('mut-map', 6, '    let mut c = Counts::new();', 'A `mut` binding lets `entry` add and bump counts.'),
          bad('insert-one', 9, '        c.insert(p, 1);', '`insert` changes the map too, so `c` still needs `mut`; and it would reset every count to 1.'),
          bad('ref', 6, '    let c = &Counts::new();', 'A shared loan of a temporary map cannot be changed either, and line 11 must hand back the map itself.', MISS.refEverywhere),
        ],
      },
      {
        id: 'ref-return',
        edit: { line: 5, text: 'fn count(ids: &[u32]) -> &Counts {' },
        expect: { code: 'E0308', line: 11 },
        why: 'The signature promises a loan of a map, and line 11 hands over the map itself.',
        fixes: [
          good('owned-return', 5, 'fn count(ids: &[u32]) -> Counts {', 'The map is built here, so the caller gets it by value.'),
          bad('static-ref', 5, "fn count(ids: &[u32]) -> &'static Counts {", 'A `\'static` loan would have to outlive every caller, and line 11 hands over the map itself, not a loan.', MISS.refEverywhere),
          bad('mut-ref', 5, 'fn count(ids: &[u32]) -> &mut Counts {', 'A `&mut` loan is still a loan, and line 11 hands over the map itself.', MISS.refEverywhere),
        ],
      },
      {
        id: 'key-ref',
        edit: { line: 8, text: '        let p = &(w[0], w[1]);' },
        expect: { code: 'E0308', line: 9 },
        why: 'The map\'s keys are `(u32, u32)` pairs, and `entry` now gets a loan of a pair instead.',
      },
    ],
  },
  {
    id: 'bump-closure',
    kcs: [C],
    title: 'Count distinct token ids with a counting closure',
    domain: 'Tokenizer',
    base: rs`
      use std::collections::HashMap;

      fn tally(ids: &[u32]) -> usize {
          let mut seen = HashMap::new();
          let mut bump = |id: u32| {
              *seen.entry(id).or_insert(0) += 1;
          };
          for &id in ids {
              bump(id);
          }
          seen.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`bump` changes `seen`, so it holds a `&mut` loan of the map from line 5 until its last call on line 9; `seen.len()` on line 11 comes after.',
      },
      {
        id: 'peek-in-head',
        edit: { line: 8, text: '    for &id in ids.iter().take(seen.len()) {' },
        expect: { code: 'E0502', line: 8 },
        why: '`bump` still holds its loan of `seen` for the calls inside the loop, so the loop head cannot read `seen.len()`.',
      },
      {
        id: 'not-mut',
        edit: { line: 5, text: '    let bump = |id: u32| {' },
        expect: { code: 'E0596', line: 9 },
        why: 'Calling a closure that changes what it captured changes the closure itself, so `bump` must be declared `mut`.',
        fixes: [
          good('mut-bump', 5, '    let mut bump = |id: u32| {', 'A `mut` closure binding can be called to change the map it captured.'),
          bad('mut-param', 5, '    let bump = |mut id: u32| {', 'That lets the closure change its parameter `id`, not itself; a call to `bump` changes the closure, so `bump` still needs `mut`.', MISS.mutCures),
          bad('ref-call', 9, '        (&bump)(id);', 'Calling through a shared loan of the closure still cannot change it, and changing it is what a call does.', MISS.refEverywhere),
        ],
      },
      {
        id: 'len-in-loop',
        edit: { line: 9, text: '        bump(id); let _ = seen.len();' },
        expect: { code: 'E0502', line: 9 },
        why: '`bump` is called again on the next pass, so its loan of `seen` is still live when this line reads `seen.len()`.',
        fixes: [
          good('call-only', 9, '        bump(id);', 'Reading the length once after the loop, as line 11 does, waits until `bump` is done with the map.'),
          cloned('clone-map', 9, '        bump(id); let _ = seen.clone();', 'Cloning reads `seen` too, while `bump` still holds it.'),
          bad('drop-bump', 9, '        bump(id); drop(bump);', 'Dropping `bump` inside the loop leaves nothing to call on the next pass.'),
        ],
      },
      {
        id: 'move-closure',
        edit: { line: 5, text: '    let mut bump = move |id: u32| {' },
        expect: { code: 'E0382', line: 11 },
        why: '`move` hands the map to the closure, so `seen.len()` on line 11 reads a map that now belongs to `bump`.',
        fixes: [
          good('borrow', 5, '    let mut bump = |id: u32| {', 'Without `move`, the closure only borrows `seen`, and the loan ends after the loop.'),
          bad('lend-move', 5, '    let bump = &mut move |id: u32| {', 'Lending the closure changes nothing about what it took: `move` still hands it the map, so line 11 still reads a `seen` that moved.', MISS.moveCures),
          bad('take-back', 11, '    std::mem::take(&mut seen).len()', 'Taking the map back out still reaches for a `seen` that moved into the closure.'),
        ],
      },
    ],
  },
  {
    id: 'admit-policy-fnmut',
    kcs: [C],
    title: 'An admission policy that spends a token budget',
    domain: 'Scheduler',
    base: rs`
      fn run<F: FnMut(u32) -> bool>(mut f: F) {
          for prompt in [512, 4096, 128] {
              if f(prompt) {}
          }
      }

      fn demo() {
          let mut budget = 4096;
          run(|p| {
              let ok = p <= budget;
              if ok { budget -= p; }
              ok
          });
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The policy changes the `budget` it captured, so it is an `FnMut` closure, and `run` holds it `mut` to call it.',
      },
      {
        id: 'fn-bound',
        edit: { line: 1, text: 'fn run<F: Fn(u32) -> bool>(f: F) {' },
        expect: { code: 'E0594', line: 11 },
        why: 'An `Fn` closure may only read what it captured, and this policy spends the budget on line 11.',
        fixes: [
          good('fnmut', 1, 'fn run<F: FnMut(u32) -> bool>(mut f: F) {', '`FnMut` allows the policy to change its budget, and `mut f` lets `run` call it.'),
          bad('fnonce', 1, 'fn run<F: FnOnce(u32) -> bool>(mut f: F) {', 'An `FnOnce` policy may be called only once, and `run` calls it for every prompt.'),
          drift('no-spend', 11, '        if ok {}', 'The budget never shrinks, so every prompt that fits on its own is admitted.'),
        ],
      },
      {
        id: 'no-mut-param',
        edit: { line: 1, text: 'fn run<F: FnMut(u32) -> bool>(f: F) {' },
        expect: { code: 'E0596', line: 3 },
        why: 'Calling an `FnMut` closure changes it, so `run` must hold `f` as `mut`.',
        fixes: [
          good('mut-f', 1, 'fn run<F: FnMut(u32) -> bool>(mut f: F) {', 'A `mut` parameter lets `run` call the policy that changes its budget.'),
          bad('fn-f', 1, 'fn run<F: Fn(u32) -> bool>(f: F) {', 'An `Fn` bound needs no `mut`, but this policy changes its budget, so it is not `Fn`.'),
          bad('fnonce', 1, 'fn run<F: FnOnce(u32) -> bool>(mut f: F) {', 'An `FnOnce` policy may be called only once, and `run` calls it for every prompt.'),
        ],
      },
      {
        id: 'no-mut-budget',
        edit: { line: 8, text: '    let budget = 4096;' },
        expect: { code: 'E0594', line: 11 },
        why: 'The closure can only change `budget` if the binding it captured is `mut`.',
        fixes: [
          good('mut-budget', 8, '    let mut budget = 4096;', 'A `mut` budget can be spent by the closure that captured it.'),
          drift('no-spend', 11, '        if ok {}', 'The budget never shrinks, so every prompt that fits on its own is admitted.'),
          bad('deref', 11, '        if ok { *budget -= p; }', '`budget` is a number, not a reference, so `*` has nothing to follow.', MISS.refEverywhere),
        ],
      },
    ],
  },
  {
    id: 'sort-by-team',
    kcs: [C],
    title: 'Order waiting requests by tenant',
    domain: 'Scheduler',
    base: rs`
      struct Req {
          id: u32,
          team: String,
      }

      fn order(w: &mut Vec<Req>) {
          w.sort_by(|a, b| a.team.cmp(&b.team));
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The comparator closure is lent two requests at a time and compares their team names in place; nothing is copied or moved.',
      },
      {
        id: 'key-owned',
        edit: { line: 7, text: '    w.sort_by_key(|r| r.team);' },
        expect: { code: 'E0507', line: 7 },
        why: 'A key closure is lent each request, so it cannot move the `team` string out of it to use as the key.',
        fixes: [
          good('cmp', 7, '    w.sort_by(|a, b| a.team.cmp(&b.team));', '`sort_by` compares the lent names in place.'),
          cloned('clone-key', 7, '    w.sort_by_key(|r| r.team.clone());', 'It copies a team name for every comparison to make a key it could have compared in place.'),
          drift('by-id', 7, '    w.sort_by_key(|r| r.id);', 'It sorts by request id, not by tenant.'),
        ],
      },
      {
        id: 'shared-vec',
        edit: { line: 6, text: 'fn order(w: &Vec<Req>) {' },
        expect: { code: 'E0596', line: 7 },
        why: 'Sorting reorders the queue in place, and `&Vec` lends it only for reading.',
        fixes: [
          good('mut-vec', 6, 'fn order(w: &mut Vec<Req>) {', 'A `&mut` queue can be reordered in place.'),
          bad('slice', 6, 'fn order(w: &[Req]) {', 'A shared slice still lends the requests only for reading.', MISS.refEverywhere),
          bad('mut-binding', 6, 'fn order(mut w: &Vec<Req>) {', 'A `mut` binding lets `w` point elsewhere; the queue is still lent only for reading.', MISS.mutCures),
        ],
      },
      {
        id: 'owned-vec',
        edit: { line: 6, text: 'fn order(w: Vec<Req>) {' },
        expect: { code: 'E0596', line: 7 },
        why: '`w` now owns its queue but is not declared `mut`, so it cannot be sorted; and the caller would never see the order.',
      },
    ],
  },
  {
    id: 'hit-scorer',
    kcs: [C],
    title: 'Score workers by cached hits, then reset the winner',
    domain: 'Router',
    base: rs`
      use std::collections::HashMap;

      type Hits = HashMap<u32, u32>;

      fn pick(hits: &mut Hits) -> u32 {
          let score = |w: &u32| hits[w];
          let best = [1, 2, 3].iter()
              .max_by_key(|w| score(w))
              .copied()
              .unwrap_or(0);
          hits.insert(best, 0);
          best
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`score` only reads `hits`, so it borrows the map until its last use on line 8; `insert` on line 11 comes after.',
      },
      {
        id: 'score-after',
        edit: { line: 12, text: '    best + score(&best)' },
        expect: { code: 'E0502', line: 11 },
        why: '`score` is used again on line 12, so it still borrows `hits` when `insert` on line 11 tries to change the map.',
      },
      {
        id: 'move-closure',
        edit: { line: 6, text: '    let score = move |w: &u32| hits[w];' },
        expect: { code: 'E0382', line: 11 },
        why: '`move` hands the `&mut` loan of the map to the closure, so `hits` is gone by line 11.',
        fixes: [
          good('borrow', 6, '    let score = |w: &u32| hits[w];', 'Without `move`, the closure only borrows the map, and the loan ends after line 8.'),
          cloned('clone-map', 6, '    let score = |w: &u32| hits.clone()[w];', 'It copies the whole map for every score it reads.'),
          bad('move-sum', 6, '    let score = move |w: &u32| hits[w] + 0;', '`move` still hands the loan to the closure, so line 11 still has no `hits`.', MISS.moveCures),
        ],
      },
      {
        id: 'shared-map',
        edit: { line: 5, text: 'fn pick(hits: &Hits) -> u32 {' },
        expect: { code: 'E0596', line: 11 },
        why: '`insert` resets the winner\'s count, which changes the map, and `&Hits` lends it only for reading.',
        fixes: [
          good('mut-map', 5, 'fn pick(hits: &mut Hits) -> u32 {', 'A `&mut` map lets line 11 reset the winner after scoring.'),
          bad('mut-binding', 5, 'fn pick(mut hits: &Hits) -> u32 {', 'A `mut` binding lets `hits` point at another map; the map is still lent only for reading.', MISS.mutCures),
          cloned('clone-insert', 11, '    hits.clone().insert(best, 0);', 'It resets the count in a throwaway copy, so the real map never changes.'),
        ],
      },
    ],
  },
  {
    id: 'spawn-sum-batch',
    kcs: [C],
    title: 'Sum a batch on a worker thread',
    domain: 'Worker',
    base: rs`
      use std::thread;

      fn launch(batch: Vec<u32>) -> u32 {
          let h = thread::spawn(move || {
              batch.iter().sum::<u32>()
          });
          h.join().unwrap()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The `move` closure takes the batch with it to the new thread, and `join` waits for the thread\'s answer.',
      },
      {
        id: 'no-move',
        edit: { line: 4, text: '    let h = thread::spawn(|| {' },
        expect: { code: 'E0373', line: 4 },
        why: 'Without `move` the closure only borrows `batch`, and the thread may outlive `launch`, which owns it.',
        fixes: [
          good('move', 4, '    let h = thread::spawn(move || {', '`move` gives the batch to the thread, so the thread owns what it reads.'),
          cloned('clone-sum', 5, '        batch.clone().iter().sum::<u32>()', 'The closure still borrows `batch` to clone it, so the thread still borrows from `launch`.'),
          bad('ref-batch', 5, '        (&batch).iter().sum::<u32>()', '`iter` already borrows `batch`; spelling the loan out changes nothing, and the thread still borrows from `launch`.', MISS.refEverywhere),
        ],
      },
      {
        id: 'use-after',
        edit: { line: 7, text: '    h.join().unwrap() + batch.len() as u32' },
        expect: { code: 'E0382', line: 7 },
        why: 'The `move` closure took `batch` to the thread, so `batch.len()` on line 7 reads a value that moved.',
      },
      {
        id: 'handle-tail',
        edit: { line: 7, text: '    h' },
        expect: { code: 'E0308', line: 7 },
        why: '`h` is the thread\'s handle, not its answer; the function promises a `u32`.',
        fixes: [
          good('join', 7, '    h.join().unwrap()', '`join` waits for the thread and gives its sum.'),
          bad('join-ok', 7, '    h.join().ok()', '`ok` turns a panicked worker into `None`, and the function promises a `u32`, not an `Option`.'),
          bad('thread', 7, '    h.thread()', 'That is the worker\'s `Thread` handle, not its answer.'),
        ],
      },
    ],
  },
  {
    id: 'p99-sort-floats',
    kcs: [C],
    title: 'Sort a latency window to read its p99',
    domain: 'Metrics',
    base: rs`
      fn p99(ms: &mut Vec<f64>) -> f64 {
          ms.sort_by(|a, b| a.total_cmp(b));
          let i = ms.len() * 99 / 100;
          ms[i.min(ms.len() - 1)]
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'An `f64` has no total order (a not-a-number value is not even equal to itself), so the comparator closure orders each pair with `total_cmp`.',
      },
      {
        id: 'plain-sort',
        edit: { line: 2, text: '    ms.sort();' },
        expect: { code: 'E0277', line: 2 },
        why: '`sort` needs a total order on the items, which `f64` does not have.',
        fixes: [
          good('total-cmp', 2, '    ms.sort_by(|a, b| a.total_cmp(b));', 'A comparator closure with `total_cmp` gives the floats an order to sort by.'),
          bad('key', 2, '    ms.sort_by_key(|x| *x);', 'A key closure still needs a key with a total order, and the key is still an `f64`.'),
          drift('reverse', 2, '    ms.sort_by(|a, b| b.total_cmp(a));', 'It sorts slowest first, so line 4 reads the p1, not the p99.'),
        ],
      },
      {
        id: 'sort-key',
        edit: { line: 2, text: '    ms.sort_by_key(|x| *x);' },
        expect: { code: 'E0277', line: 2 },
        why: 'The key closure returns an `f64`, and a sort key must have a total order.',
      },
      {
        id: 'partial',
        edit: { line: 2, text: '    ms.sort_by(|a, b| a.partial_cmp(b));' },
        expect: { code: 'E0308', line: 2 },
        why: '`partial_cmp` answers with an `Option`, because a not-a-number value has no order, and the comparator must return an `Ordering`.',
        fixes: [
          good('total', 2, '    ms.sort_by(|a, b| a.total_cmp(b));', '`total_cmp` always answers with an `Ordering`, even for a not-a-number value.'),
          bad('partial-q', 2, '    ms.sort_by(|a, b| a.partial_cmp(b)?);', '`?` needs the closure to return an `Option`, and a comparator returns an `Ordering`.'),
          drift('reverse', 2, '    ms.sort_by(|a, b| b.total_cmp(a));', 'It sorts slowest first, so line 4 reads the p1, not the p99.'),
        ],
      },
    ],
  },
  {
    id: 'tenant-usage',
    kcs: [C],
    title: 'Total tokens per tenant',
    domain: 'Scheduler',
    base: rs`
      use std::collections::HashMap;

      struct Req { tenant: String, toks: u32 }

      fn toks(q: &[Req]) -> HashMap<&str, u32> {
          let mut m = HashMap::new();
          for r in q {
              *m.entry(r.tenant.as_str())
                  .or_insert(0) += r.toks;
          }
          m
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The map\'s keys are `&str` loans of the tenant names in `q`, so no name is copied; `entry` adds a 0 the first time and the count grows in place.',
      },
      {
        id: 'key-owned',
        edit: { line: 8, text: '        *m.entry(r.tenant)' },
        expect: { code: 'E0308', line: 11 },
        why: 'With `String` keys the map becomes a `HashMap<String, u32>`, and the function promises `&str` keys.',
        fixes: [
          good('as-str', 8, '        *m.entry(r.tenant.as_str())', 'Each key lends the tenant\'s name from `q`, which lives as long as the map.'),
          cloned('clone-key', 8, '        *m.entry(r.tenant.clone().as_str())', 'The key would lend a copied name that is dropped at the end of the statement, while the map still holds the loan.'),
          bad('by-len', 8, '        *m.entry(r.tenant.as_str().len())', 'That keys the map by the length of each name, not the name.'),
        ],
      },
      {
        id: 'no-mut',
        edit: { line: 6, text: '    let m = HashMap::new();' },
        expect: { code: 'E0596', line: 8 },
        why: '`entry` changes the map, and `m` is not declared `mut`.',
        fixes: [
          good('mut', 6, '    let mut m = HashMap::new();', 'A `mut` map lets `entry` add tenants and grow their counts.'),
          bad('ref', 6, '    let m = &HashMap::new();', 'A shared loan of a temporary map cannot be changed either, and line 11 must hand back the map itself.', MISS.refEverywhere),
          bad('mut-r', 7, '    for mut r in q {', '`mut r` lets the loop variable point elsewhere; the map is what changes.', MISS.mutCures),
        ],
      },
      {
        id: 'ret-owned',
        edit: { line: 5, text: 'fn toks(q: &[Req]) -> HashMap<String, u32> {' },
        expect: { code: 'E0308', line: 11 },
        why: 'The keys are `&str` loans of the names, and the signature now promises owned `String` keys.',
      },
    ],
  },
]
