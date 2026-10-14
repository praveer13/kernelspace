/**
 * The lifetimes group of the compile bank (docs/specs/wave-2.md §15.5, task 2c-13): about fifty snippets on
 * lifetimes, cells and smart pointers, in serving-domain names. They cover E0597, E0716, E0515, E0106 and
 * E0521 (a borrow that outlives its owner), E0373 (a closure or thread that borrows a local), the RefCell
 * panic at run time (`BorrowMutError`, `BorrowError`), the permissions Rc, Box and Arc leave out, and the
 * analyzer limits (`split_at_mut`, two-phase borrows, the conditional return the checker cannot prove).
 *
 * Each base compiles (or runs to the end); each other variant is a one-line edit with the outcome rustc
 * 1.96.0 gives, confirmed by scripts/build-rust-items.ts into bank/lifetimes.json. Four snippets on cells,
 * locks and shared references leave the base out: the "compiles" key of a snippet that is not run is the one
 * verdict option longer than the error codes, so the r.interior-mutability pool keeps those keys under the
 * family's 30 % cap on a strictly longest key (verify-generators) by having few of them. Whys use Crichton's
 * permissions where a permission is the reason (a path holds Read (R), Write (W) and Own (O); a move removes
 * all three; `&` removes W and O while the borrow lives; `&mut` removes R as well) and the lifetime of a
 * value where it is not: lifetime errors are about how long a borrow lives, so they carry no permission
 * label. A `.clone()` fix is always a labelled lure.
 *
 * The fix options of a variant are written against the item-level cue limits (scripts/item-cues.ts): the
 * key is not systematically the shortest or longest option, nor the only one with a semicolon or a
 * parenthesis, so a distractor often edits the same kind of line as the key. A wrong fix that rustc
 * rejects is chosen to fail with the error its why describes.
 */

import { KC } from '@/data/kc/ids'
import { rs, type LineEdit, type RustSnippet, type SnippetFix } from '../types'

const BR = KC.borrowRules
const OM = KC.ownershipMoves
const CCD = 'r.clone-copy-drop'
const SL = 'r.slices'
const AL = KC.analyzerLimits
const LT = 'r.lifetimes'
const IM = 'r.interior-mutability'

const at = (line: number, text: string): LineEdit => ({ line, text })
/** The one fix that compiles and keeps what the code does. */
const good = (id: string, line: number, text: string, why: string): SnippetFix => ({ id, edit: at(line, text), ok: true, why })
/** A wrong fix; `miss` is the misconception a learner who picks it is diagnosed with. */
const wrong = (id: string, line: number, text: string, why: string, miss?: string): SnippetFix => ({ id, edit: at(line, text), ok: false, why, ...(miss ? { miss } : {}) })
/** A wrong fix that may compile: `clone` copies the data, `other` changes what the code does some other way. */
const lure = (kind: 'clone' | 'other', id: string, line: number, text: string, why: string, miss?: string): SnippetFix => ({ id, edit: at(line, text), ok: false, lure: kind, why, ...(miss ? { miss } : {}) })

export const SNIPPETS: RustSnippet[] = [
  {
    id: 'route-best-tag',
    kcs: [LT],
    title: 'Keep the best tag after a scope ends',
    domain: 'Request',
    base: rs`
      fn route(p: &str) -> usize {
          let mut best = p;
          {
              let tag = "hi";
              best = &tag;
          }
          best.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`tag` is a `&\'static str`, so `&tag` reborrows through it: `best` is tied to the literal, which lives for the whole program, not to the local `tag` that ends on line 6.',
      },
      {
        id: 'owned-tag',
        edit: at(4, '        let tag = String::from("hi");'),
        expect: { code: 'E0597', line: 5 },
        why: '`tag` now owns its text and is dropped on line 6, but `best` borrows it on line 5 and is read on line 7, so the borrow would outlive its owner.',
        fixes: [
          good('literal-tag', 4, '        let tag = "hi";', 'A literal is a `&\'static str`: the borrow is tied to text that is never dropped, so it can outlive the block.'),
          lure('clone', 'clone-tag', 5, '        best = &tag.clone();', 'It borrows a copy of the string, and that copy is a temporary dropped at the end of line 5, while `best` is read on line 7.'),
          wrong('slice-tag', 5, '        best = &tag[..];', 'A slice of `tag` still borrows the `String`, which is dropped at the end of the block.', 'r.borrow-view-is-not-a-copy'),
        ],
      },
      {
        id: 'temp-tag',
        edit: at(5, '        best = &tag.to_uppercase();'),
        expect: { code: 'E0716', line: 5 },
        why: '`tag.to_uppercase()` builds a temporary `String` that is dropped at the end of line 5, but `best` keeps a borrow of it until line 7.',
      },
      {
        id: 'immutable-best',
        edit: at(2, '    let best = p;'),
        expect: { code: 'E0384', line: 5 },
        why: '`best` is not declared `mut`, so it has no W after the first value, and the assignment on line 5 needs W.',
        focus: { line: 5, path: 'best', needs: ['write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'slot-index-keys',
    kcs: [LT, BR],
    title: 'Index request ids in a list of views',
    domain: 'Scheduler',
    base: rs`
      fn index(ids: Vec<String>) -> usize {
          let mut ix: Vec<&str> = vec![];
          for id in &ids {
              ix.push(&id);
          }
          ix.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Each `id` is a reference into `ids`, which the function owns until it returns, so the views in `ix` never outlive what they point into.',
      },
      {
        id: 'by-value',
        edit: at(3, '    for id in ids {'),
        expect: { code: 'E0597', line: 4 },
        why: 'The loop moves each `String` into `id`, which is dropped at the end of its pass, but `ix` keeps a `&str` into it and is read on line 6.',
        fixes: [
          good('by-ref', 3, '    for id in ids.iter() {', 'Looping over `ids.iter()` lends each id instead of moving it, so the views point into `ids`, which lives until the function returns.'),
          lure('clone', 'clone-id', 4, '        ix.push(&id.clone());', 'The view is of a copy, and the copy is a temporary dropped at the end of line 4, so `ix` still holds a dangling borrow.'),
          wrong('into-iter', 3, '    for id in ids.into_iter() {', '`into_iter` still moves each `String` into `id`, which is dropped at the end of its pass, so the views dangle all the same.', 'r.borrow-view-is-not-a-copy'),
        ],
      },
      {
        id: 'temp-view',
        edit: at(4, '        ix.push(&id.to_uppercase());'),
        expect: { code: 'E0716', line: 4 },
        why: '`to_uppercase()` builds a temporary `String` that is dropped at the end of line 4, but `ix` keeps a `&str` into it until line 6.',
      },
      {
        id: 'static-views',
        edit: at(2, '    let mut ix: Vec<&\'static str> = vec![];'),
        expect: { code: 'E0597', line: 3 },
        why: 'A `\'static` view must be valid for the whole program, but `ids` is a local that is dropped when the function returns.',
      },
    ],
  },

  {
    id: 'first-word-vocab',
    kcs: [LT, SL],
    title: 'Return the first word of a vocabulary entry',
    domain: 'Tokenizer',
    base: rs`
      struct Tokenizer {
          vocab: Vec<String>,
      }

      fn head(t: &Tokenizer) -> &str {
          let line = &t.vocab[0];
          line.split(' ').next().unwrap()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`line` borrows into `t.vocab`, which the caller owns, so the returned `&str` is tied to the tokenizer and outlives the call.',
      },
      {
        id: 'owned-line',
        edit: at(6, '    let line = t.vocab[0].to_string();'),
        expect: { code: 'E0515', line: 7 },
        why: '`to_string` copies the entry into a new `String` that `head` owns and drops on return, so the `&str` into it would point at freed memory.',
        fixes: [
          good('borrow-vocab', 6, '    let line = t.vocab[0].as_str();', 'Borrowing the entry that `t` owns ties the result to the tokenizer, which outlives the call.'),
          lure('clone', 'clone-line', 6, '    let line = (t.vocab[0]).clone();', 'A clone is a new `String` owned by this function too: it is dropped on return, and the returned slice still points into it.'),
          wrong('static-ret', 5, 'fn head(t: &Tokenizer) -> &\'static str {', 'Promising `\'static` does not make the text live that long: the `String` is still dropped when the function returns.', 'r.static-to-silence'),
        ],
      },
      {
        id: 'ret-temp',
        edit: at(7, '    format!("{line}!").trim()'),
        expect: { code: 'E0515', line: 7 },
        why: '`format!` builds a temporary `String` that is dropped as the function returns, and the returned `&str` points into it.',
      },
      {
        id: 'by-value',
        edit: at(5, 'fn head(t: Tokenizer) -> &str {'),
        expect: { code: 'E0106', line: 5 },
        why: 'With `t` taken by value there is no input lifetime for the returned `&str` to borrow from, so the signature has nothing to name.',
      },
    ],
  },

  {
    id: 'session-name-field',
    kcs: [LT],
    title: 'Store a name in a session',
    domain: 'Session',
    base: rs`
      struct Session {
          id: u64,
          name: String,
      }

      fn open(id: u64) -> Session {
          Session { id, name: "chat".into() }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The `String` field owns its text, so a `Session` needs no lifetime: it keeps its name alive itself.',
      },
      {
        id: 'ref-field',
        edit: at(3, '    name: &str,'),
        expect: { code: 'E0106', line: 3 },
        why: 'A reference stored in a struct must say how long it is valid, and the struct has no lifetime parameter to name.',
        fixes: [
          good('own-it', 3, '    name: Box<str>,', 'A boxed `str` owns its text, so the `Session` keeps the name alive itself and nothing needs a lifetime.'),
          lure('other', 'static-name', 3, '    name: &\'static str,', 'It compiles, but every session name must now be a literal baked into the program: one built at run time cannot be stored.', 'r.static-to-silence'),
          wrong('named-lifetime', 3, '    name: &\'a str,', '`\'a` is used but never declared on `Session`, so the compiler cannot say what it means.', 'r.lifetime-needs-declaring'),
        ],
      },
      {
        id: 'vec-field',
        edit: at(3, '    name: Vec<&str>,'),
        expect: { code: 'E0106', line: 3 },
        why: 'A reference inside a `Vec` field still needs a lifetime: the struct would hold borrows with no stated owner to outlive.',
      },
      {
        id: 'ret-ref',
        edit: at(6, 'fn open(id: u64) -> &str {'),
        expect: { code: 'E0106', line: 6 },
        why: 'A function that takes no reference gives a returned `&str` nothing to borrow from, so the signature cannot be completed by elision.',
      },
    ],
  },

  {
    id: 'block-view-escape',
    kcs: [LT, SL],
    title: 'Hand out a view of the first block bytes',
    domain: 'KvBlockTable',
    base: rs`
      struct View<'a> {
          bytes: &'a [u8],
      }

      fn view(pool: &[u8]) -> View<'_> {
          let head = &pool[..4];
          View { bytes: &head }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`head` is a slice of `pool`, which the caller owns, so the `View` is tied to the caller\'s pool and outlives the call.',
      },
      {
        id: 'local-vec',
        edit: at(6, '    let head = pool[..4].to_vec();'),
        expect: { code: 'E0515', line: 7 },
        why: '`to_vec` copies the bytes into a `Vec` that `view` owns and drops on return, and the `View` would point into it.',
        fixes: [
          good('slice-pool', 6, '    let head = pool.split_at(4).0;', 'The first part of `pool` is a slice of bytes the caller owns, so the `View` can leave the function.'),
          lure('clone', 'clone-head', 6, '    let head = pool.clone();', 'Cloning a slice reference copies the reference, not the bytes, so `head` is the whole pool, not its first four bytes.'),
          wrong('ref-vec', 6, '    let head = &pool[..4].to_vec();', 'The `&` keeps the temporary `Vec` alive only to the end of `view`, so the `View` still points into data that is dropped on return.', 'r.temporary-lives-in-the-let'),
        ],
      },
      {
        id: 'temp-vec',
        edit: at(6, '    let head = &pool[..4].to_vec();'),
        expect: { code: 'E0515', line: 7 },
        why: 'The `let` keeps the temporary `Vec` alive only until the end of `view`, and the `View` handed back points into it.',
      },
      {
        id: 'two-inputs',
        edit: at(5, 'fn view(pool: &[u8], n: &[u8]) -> View<\'_> {'),
        expect: { code: 'E0106', line: 5 },
        why: 'With two input references the compiler cannot guess which one the `View` borrows from, so the elided lifetime has no single source.',
      },
    ],
  },

  {
    id: 'label-temp-trim',
    kcs: [LT],
    title: 'Trim a label built from an id',
    domain: 'Batch',
    base: rs`
      fn label(id: u32) -> usize {
          let tag = id.to_string();
          let tag = tag.trim();
          tag.len() + 1
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The first `tag` keeps the `String` alive until the end of the function, and the second `tag` is a slice of it.',
      },
      {
        id: 'temp-trim',
        edit: at(2, '    let tag = id.to_string().trim();'),
        expect: { code: 'E0716', line: 2 },
        why: '`to_string()` is a temporary dropped at the end of line 2, but `tag` is a slice into it and is read on later lines.',
        fixes: [
          good('extend-temp', 2, '    let tag = &id.to_string();', 'A `&` taken straight in a `let` extends the temporary to the end of the block, so the second `tag` has a `String` to slice.'),
          lure('clone', 'clone-tag', 3, '    let tag = tag.clone();', 'The trouble is on line 2, where the temporary dies; cloning the slice on line 3 does not keep the `String` alive.'),
          wrong('ref-trim', 2, '    let tag = &id.to_string().trim();', 'The `&` falls on the slice that `trim` returns, not on the `String`, which is still a temporary dropped at the end of the statement.', 'r.temporary-lives-in-the-let'),
        ],
      },
      {
        id: 'temp-chain',
        edit: at(3, '    let tag = tag.to_uppercase().trim();'),
        expect: { code: 'E0716', line: 3 },
        why: '`to_uppercase()` builds a new temporary `String` that is dropped at the end of line 3, and `tag` slices it.',
      },
      {
        id: 'block-owner',
        edit: at(3, '    let tag = { let t = tag; t.trim() };'),
        expect: { code: 'E0597', line: 3 },
        why: 'The block moves the `String` into `t`, which is dropped when the block ends, but the slice it returns outlives the block.',
      },
    ],
  },

  {
    id: 'worker-name-thread',
    kcs: [LT, OM],
    title: 'Start a worker thread and log its name',
    domain: 'Worker',
    base: rs`
      fn spawn_worker(id: u32) {
          let name = format!("worker-{id}");
          let h = std::thread::spawn(move || {
              println!("{name} {id}");
          });
          h.join().unwrap();
          println!("{id} done");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`move` gives the closure its own `name` and its own copy of `id`, so the thread needs nothing from this stack frame, which may be gone before it runs.',
      },
      {
        id: 'no-move',
        edit: at(3, '    let h = std::thread::spawn(|| {'),
        expect: { code: 'E0373', line: 3 },
        why: 'Without `move` the closure borrows `name` and `id`, but a spawned thread can outlive `spawn_worker`, so those borrows could dangle.',
        fixes: [
          good('add-move', 3, '    let h = std::thread::spawn(move || {', '`move` gives the thread its own `name` and `id`, so nothing it uses lives on this stack frame.'),
          lure('clone', 'clone-name', 4, '        println!("{} {id}", name.clone());', 'The closure still borrows `name` and `id`: cloning inside the thread copies a string but leaves the borrow, and the error, in place.'),
          wrong('closure-arg', 3, '    let h = std::thread::spawn(move |_| {', '`spawn` calls its closure with no arguments, so a closure that takes one does not fit.'),
        ],
      },
      {
        id: 'move-then-use',
        edit: at(7, '    println!("{name} done");'),
        expect: { code: 'E0382', line: 7 },
        why: '`move` gave `name` to the thread, so `name` lost R, W and O here, and printing it on line 7 needs R.',
        focus: { line: 7, path: 'name', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('print-id', 7, '    println!("{id} done");', '`id` is a `u32`, which is Copy, so the thread got a copy and this frame still has the original to read.'),
          lure('clone', 'clone-name', 4, '        println!("{} {id}", name.clone());', '`move` still moves `name` into the closure whatever the thread does with it, so line 7 still reads a moved value.'),
          wrong('drop-name', 7, '    drop(name);', 'Dropping `name` reads it after the move just the same: it still has no R, W or O.', 'r.move-keeps-the-name'),
        ],
      },
      {
        id: 'ref-param',
        edit: at(1, 'fn spawn_worker(id: &u32) {'),
        expect: { code: 'E0521', line: 3 },
        why: '`move` moves the reference `id` into the thread, but the reference is only valid while the caller\'s `u32` is, which may end before the thread does.',
        fixes: [
          good('own-id', 1, 'fn spawn_worker(id: u32) {', 'An owned `u32` is copied into the thread, so the thread does not depend on the caller\'s variable.'),
          lure('other', 'static-id', 1, 'fn spawn_worker(id: &\'static u32) {', 'It compiles, but callers can now pass only references that live for the whole program, such as a constant, not a counter they own.', 'r.static-to-silence'),
          wrong('named-id', 1, 'fn spawn_worker<\'a>(id: &\'a u32) {', 'Naming the lifetime does not lengthen it: `\'a` is still only as long as the caller\'s variable, not `\'static`.', 'r.named-lifetime-is-not-static'),
        ],
      },
    ],
  },

  {
    id: 'scorer-closure',
    kcs: [LT],
    title: 'Return a scoring closure with a bias',
    domain: 'Router',
    base: rs`
      fn scorer(b: &u32) -> impl Fn(u32) -> u32 {
          let bias = *b * 2;
          move |x| x + bias
      }

      fn total() -> u32 {
          let f = scorer(&3);
          f(1) + f(2)
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`bias` is a `u32` that `scorer` computes, and `move` copies it into the closure, so the closure owns everything it uses and can outlive the call.',
      },
      {
        id: 'no-move',
        edit: at(3, '    |x| x + bias'),
        expect: { code: 'E0373', line: 3 },
        why: 'Without `move` the closure borrows the local `bias`, which is dropped when `scorer` returns, but the closure is handed to the caller.',
        fixes: [
          good('add-move', 3, '    move |x| x + bias', '`move` copies the `u32` into the closure, so the closure carries its own bias out of the function.'),
          lure('clone', 'clone-bias', 3, '    |x| x + bias.clone()', 'The clone is made when the closure runs, and the closure still borrows `bias` to get at it: the borrow, and the error, remain.'),
          wrong('cast-bias', 3, '    |x| x + bias as u32', 'A cast copies the value inside the closure, but the closure still borrows `bias` to read it.', 'r.move-is-optional'),
        ],
      },
      {
        id: 'ref-local',
        edit: at(2, '    let bias = &(*b * 2);'),
        expect: { code: 'E0716', line: 2 },
        why: 'The `&` in the `let` extends the temporary `u32` to the end of `scorer`, but `move` copies a reference to it into a closure that outlives the call, so it is dropped while still borrowed.',
      },
    ],
  },

  {
    id: 'tally-scoped-threads',
    kcs: [LT, BR],
    title: 'Count and print in scoped threads',
    domain: 'Scheduler',
    base: rs`
      fn tally(reqs: Vec<u32>) -> u32 {
          let mut total = 0;
          std::thread::scope(|s| {
              s.spawn(|| total += reqs[0]);
              s.spawn(|| println!("{:?}", reqs));
          });
          total
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'A scoped thread cannot outlive `scope`, so it may borrow locals: one closure writes `total`, the other only reads `reqs`, and both borrows end before line 7.',
      },
      {
        id: 'plain-spawn',
        edit: at(4, '        std::thread::spawn(|| total += 1);'),
        expect: { code: 'E0597', line: 4 },
        why: 'A thread from `std::thread::spawn` can outlive `tally`, so it needs a closure that is valid for `\'static`, and this one borrows the local `total`; only `s.spawn` inside the scope may.',
        fixes: [
          good('scoped-spawn', 4, '        s.spawn(|| total += 1);', '`s.spawn` joins before `scope` returns, so the closure may borrow `total` for that long.'),
          lure('other', 'move-copy', 4, '        s.spawn(move || total += 1);', 'It compiles because `move` copies the `u32`, but the thread adds to its own copy and `total` is never changed.', 'r.move-copies-the-counter'),
          wrong('move-scope', 3, '    std::thread::scope(move |s| {', 'Moving `total` into the scope closure changes who owns it, not how long the spawned thread lives: the thread still borrows it.', 'r.move-is-optional'),
        ],
      },
      {
        id: 'two-writers',
        edit: at(5, '        s.spawn(|| total += 1);'),
        expect: { code: 'E0499', line: 5 },
        why: 'The first closure holds a `&mut` borrow of `total` until the scope ends, and the second closure needs another `&mut` borrow of it while the first is alive.',
      },
      {
        id: 'read-while-write',
        edit: at(5, '        s.spawn(|| println!("{total}"));'),
        expect: { code: 'E0502', line: 5 },
        why: 'The first closure holds a `&mut` borrow of `total` until the scope ends, so `total` has no R for the second closure to read it.',
        focus: { line: 5, path: 'total', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'drop-reqs',
        edit: at(5, '        drop(reqs);'),
        expect: { code: 'E0373', line: 4 },
        why: '`drop(reqs)` takes `reqs` by value, so the scope closure captures and owns it; the first thread borrows a value that closure drops when it returns, before the thread is joined.',
      },
    ],
  },

  {
    id: 'stats-shared-ref',
    kcs: [IM, BR],
    title: 'Bump a hit counter through a handle',
    domain: 'PrefixCache',
    base: rs`
      struct Stats {
          hits: u32,
      }

      fn record(s: &mut Stats) {
          s.hits += 1;
      }
    `,
    variants: [
      {
        id: 'shared-ref',
        edit: at(5, 'fn record(s: &Stats) {'),
        expect: { code: 'E0594', line: 6 },
        why: 'Through a `&Stats`, `s.hits` has R but no W, and `+=` assigns to it, which needs W.',
        focus: { line: 6, path: 's.hits', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          good('mut-ref', 5, 'fn record(s: &mut Stats) {', 'A `&mut Stats` gives `s.hits` W as well as R, and the caller must hold the only handle while it runs.'),
          wrong('cell-field', 2, '    hits: std::cell::Cell<u32>,', 'A `Cell` changes through `&`, but only with `set` and `get`: `+=` is not defined on a `Cell`, so line 6 no longer type-checks.', 'r.cell-is-a-wrapper'),
          wrong('static-ref', 5, 'fn record(s: &\'static Stats) {', 'A longer lifetime adds no W: a `&\'static Stats` is still shared, so `+=` still lacks W.', 'r.static-to-silence'),
        ],
      },
      {
        id: 'rc-handle',
        edit: at(5, 'fn record(s: std::rc::Rc<Stats>) {'),
        expect: { code: 'E0594', line: 6 },
        why: 'An `Rc` hands out shared access only, so `s.hits` has R but no W, since other handles may read the same `Stats`.',
        focus: { line: 6, path: 's.hits', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'ref-to-mut',
        edit: at(5, 'fn record(s: &&mut Stats) {'),
        expect: { code: 'E0594', line: 6 },
        why: 'Behind a shared `&` to a `&mut`, only R passes through: `s.hits` has no W, because a `&mut` reached through a `&` cannot be used to write.',
        focus: { line: 6, path: 's.hits', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'mut-binding',
        edit: at(5, 'fn record(mut s: &Stats) {'),
        expect: { code: 'E0594', line: 6 },
        why: '`mut` on the binding lets `s` point at another `Stats`, but it adds no W to the shared reference: through a `&Stats`, `s.hits` has R only.',
        focus: { line: 6, path: 's.hits', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'rc-block-table',
    kcs: [IM, OM],
    title: 'Share one block list between two handles',
    domain: 'KvBlockTable',
    base: rs`
      use std::rc::Rc;

      fn share(t: Rc<Vec<u32>>) -> usize {
          let mut a = Rc::clone(&t);
          let b = Rc::clone(&t);
          let _n = a.len();
          b.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`Rc::clone` copies a handle and bumps a count, not the list: `a`, `b` and `t` all point at one `Vec`, and `len` needs only R.',
      },
      {
        id: 'push-through-rc',
        edit: at(6, '    a.push(7);'),
        expect: { code: 'E0596', line: 6 },
        why: 'An `Rc` shares its `Vec` with every handle, so `a` holds R but no W of it, and `push` needs W.',
        fixes: [
          good('make-mut', 6, '    Rc::make_mut(&mut a).push(7);', '`make_mut` gives `a` its own copy of the list when other handles exist, and then hands out W of that copy.'),
          lure('other', 'get-mut', 6, '    Rc::get_mut(&mut a).unwrap().push(7);', 'It compiles, but `get_mut` returns `None` while `t` and `b` share the list, so `unwrap` would panic at run time.', 'r.get-mut-needs-unique'),
          lure('clone', 'clone-rc', 6, '    a.clone().push(7);', 'The clone is another handle to the same list, which still has no W: `push` is rejected exactly as before.'),
        ],
      },
      {
        id: 'move-out-of-rc',
        edit: at(6, '    let v = *a;'),
        expect: { code: 'E0507', line: 6 },
        why: 'An `Rc` shares its `Vec` with other handles, so `*a` has R but no O, and `let v = *a` moves the vector out, which needs O.',
      },
      {
        id: 'move-first',
        edit: at(4, '    let mut a = t;'),
        expect: { code: 'E0382', line: 5 },
        why: '`let a = t` moved the handle, so `t` lost R, W and O, and `Rc::clone(&t)` on line 5 needs R.',
        focus: { line: 5, path: 't', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('clone-handle', 4, '    let a = Rc::clone(&t);', '`Rc::clone(&t)` copies a handle, so `t` keeps R, W and O and line 5 can clone it again.'),
          lure('clone', 'clone-late', 5, '    let b = t.clone();', '`t` is already moved on line 4, so a clone of it on line 5 reads a moved value just the same.'),
          wrong('borrow-t', 5, '    let b = &t;', 'It still reads `t` on line 5 after the move: borrowing needs R, which the move took.', 'r.move-keeps-the-name'),
        ],
      },
      {
        id: 'get-mut-shared',
        edit: at(7, '    Rc::get_mut(&mut b).unwrap().len()'),
        expect: { code: 'E0596', line: 7 },
        why: '`b` is not declared `mut`, so the binding has no W, and `&mut b` needs W: `get_mut` would give W of the list only while no other handle shares it.',
        focus: { line: 7, path: 'b', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'hand-off-guard',
    kcs: [IM],
    title: 'Count the queue, then hand a number back',
    domain: 'Scheduler',
    run: true,
    base: rs`
      use std::cell::RefCell;
      use std::rc::Rc;

      fn main() {
          let q = Rc::new(RefCell::new(vec![1]));
          let h = Rc::clone(&q);
          let g = q.borrow_mut();
          let n = g.len();
          drop(g);
          h.borrow_mut().push(n);
          println!("{:?}", q.borrow());
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`drop(g)` ends the `RefMut` on line 9, so the cell is free when `borrow_mut` runs again on line 10.',
      },
      {
        id: 'no-drop',
        edit: at(9, '    let _ = g;'),
        expect: { code: 'BorrowMutError', line: 10 },
        why: '`let _ = g` does not move or drop `g`, so its `RefMut` lives to the end of `main` and the cell is still borrowed on line 10: the `&mut` rule, checked at run time.',
        fixes: [
          good('drop-g', 9, '    std::mem::drop(g);', '`drop` moves the guard and ends the borrow on the spot, so the cell is free again.'),
          wrong('bind-g', 9, '    let _g = g;', 'A binding named `_g` keeps the guard alive until the end of `main`: only a name that is exactly `_` skips the binding, and even that does not drop anything.', 'r.underscore-drops'),
          wrong('forget-g', 9, '    std::mem::forget(g);', '`forget` never runs the guard\'s drop, so the cell stays marked as borrowed for the rest of the program.', 'r.forget-is-not-drop'),
        ],
      },
      {
        id: 'shared-peek',
        edit: at(8, '    let n = h.borrow().len();'),
        expect: { code: 'BorrowError', line: 8 },
        why: '`g` is a `RefMut` that is alive until line 9, so the cell is mutably borrowed, and `borrow()` on line 8 needs a shared borrow: R is taken while `&mut` lives.',
      },
      {
        id: 'second-mut',
        edit: at(8, '    let n = h.borrow_mut().len();'),
        expect: { code: 'BorrowMutError', line: 8 },
        why: '`g` is a `RefMut` that is alive until line 9, so a second `borrow_mut()` on line 8 finds the cell already mutably borrowed.',
      },
      {
        id: 'ref-push',
        edit: at(10, '    h.borrow().push(n);'),
        expect: { code: 'E0596', line: 10 },
        why: 'A `Ref` from `borrow()` lends the vector with R only, like `&`, and `push` needs W: only `borrow_mut` hands out W.',
        focus: { line: 10, path: 'h.borrow()', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'arc-mutex-counter',
    kcs: [IM, OM],
    title: 'Add to a shared counter from a thread',
    domain: 'Metrics',
    base: rs`
      use std::sync::{Arc, Mutex};
      use std::thread;

      fn count(n: u32) -> u32 {
          let c = Arc::new(Mutex::new(0));
          let c2 = Arc::clone(&c);
          let h = thread::spawn(move || {
              *c2.lock().unwrap() += n;
          });
          h.join().unwrap();
          let total = *c.lock().unwrap();
          total
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The thread owns `c2`, a second handle to the same `Mutex`, and `n` is copied in: both outlive this frame, and `lock` gives W through a shared handle.',
      },
      {
        id: 'no-move',
        edit: at(7, '    let h = thread::spawn(|| {'),
        expect: { code: 'E0373', line: 7 },
        why: 'Without `move` the closure borrows `c2` and `n`, but the thread can outlive `count`, so those borrows could dangle.',
        fixes: [
          good('add-move', 7, '    let h = thread::spawn(move || {', '`move` gives the thread its own handle `c2` and its own copy of `n`, so it needs nothing from this frame.'),
          lure('clone', 'clone-c2', 8, '        *c2.clone().lock().unwrap() += n;', 'It clones the handle inside the closure, but the closure still borrows `c2` and `n` from this frame to do it.'),
          wrong('closure-arg', 7, '    let h = thread::spawn(move |_| {', '`spawn` calls its closure with no arguments, so a closure that takes one does not fit.'),
        ],
      },
      {
        id: 'ref-handle',
        edit: at(6, '    let c2 = &c;'),
        expect: { code: 'E0597', line: 6 },
        why: '`move` copies the reference `c2` into the thread, but a spawned thread needs `\'static` data and `c` is a local that is dropped when `count` returns.',
      },
      {
        id: 'moved-arc',
        edit: at(6, '    let c2 = c;'),
        expect: { code: 'E0382', line: 11 },
        why: '`let c2 = c` moved the `Arc`, so `c` lost R, W and O, and `c.lock()` on line 11 needs R.',
        focus: { line: 11, path: 'c', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('clone-arc', 6, '    let c2 = Arc::clone(&c);', '`Arc::clone(&c)` copies a handle and bumps an atomic count, so `c` is still there for line 11.'),
          wrong('use-c2', 11, '    let total = *c2.lock().unwrap();', '`c2` has moved into the thread, so line 11 can no longer name it either.', 'r.move-keeps-the-name'),
          wrong('borrow-c', 6, '    let c2 = &c;', 'A borrowed `c2` keeps `c` readable on line 11, but a spawned thread needs `\'static` data and `c` is a local.', 'r.static-to-silence'),
        ],
      },
    ],
  },

  {
    id: 'box-block-list',
    kcs: [OM],
    title: 'Take the block list out of its box',
    domain: 'KvBlockTable',
    base: rs`
      fn take(b: Box<Vec<u32>>) -> usize {
          let v = *b;
          let n = v.len();
          n
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'A `Box` owns its `Vec`, so `*b` has R, W and O, and moving the vector out needs O: only a `Box` allows it.',
      },
      {
        id: 'ref-box',
        edit: at(1, 'fn take(b: &Box<Vec<u32>>) -> usize {'),
        expect: { code: 'E0507', line: 2 },
        why: 'Through a `&Box`, `*b` has R but no O, because the caller still owns the box, and `let v = *b` moves the vector out, which needs O.',
        focus: { line: 2, path: '*b', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('borrow-inner', 2, '    let v = &**b;', 'A borrow of the inner vector needs only R, and `len` reads through the reference.'),
          lure('clone', 'clone-inner', 2, '    let v = (**b).clone();', 'It compiles because it copies every block into a new `Vec`, only to take its length.'),
          wrong('deref-twice', 2, '    let v = **b;', 'Dereferencing once more still moves the vector out of the borrowed box, which still needs O.', 'r.deref-moves-out'),
        ],
      },
      {
        id: 'use-after',
        edit: at(3, '    let n = b.len() + v.len();'),
        expect: { code: 'E0382', line: 3 },
        why: '`let v = *b` moved the vector out of the box, so `b` lost R, W and O, and `b.len()` needs R.',
        focus: { line: 3, path: 'b', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('use-v', 3, '    let n = v.len();', 'The vector now lives in `v`, so its length is read from there.'),
          lure('clone', 'clone-first', 2, '    let v = (*b).clone();', 'It leaves the box full by copying every block into `v`, only so the length can be read twice.'),
          wrong('deref-b', 3, '    let n = (*b).len() + v.len();', 'Writing `(*b)` names the same moved path, which has no R left.', 'r.move-keeps-the-name'),
        ],
      },
      {
        id: 'rc-instead',
        edit: at(1, 'fn take(b: std::rc::Rc<Vec<u32>>) -> usize {'),
        expect: { code: 'E0507', line: 2 },
        why: 'An `Rc` shares its `Vec` with other handles, so `*b` has R but no O, and moving the vector out needs O.',
      },
      {
        id: 'push-v',
        edit: at(3, '    let n = { v.push(1); v.len() };'),
        expect: { code: 'E0596', line: 3 },
        why: '`v` is not declared `mut`, so it has no W, and `push` borrows it `&mut`, which needs W: moving the vector out of the box did not make the binding mutable.',
        focus: { line: 3, path: 'v', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'cell-flag-shared',
    kcs: [IM],
    title: 'Arm a flag through a shared reference',
    domain: 'Scheduler',
    base: rs`
      use std::cell::Cell;

      struct Flags {
          ready: Cell<bool>,
      }

      fn arm(f: &Flags) -> bool {
          f.ready.set(true);
          f.ready.get()
      }
    `,
    variants: [
      {
        id: 'assign-field',
        edit: at(8, '    f.ready = Cell::new(true);'),
        expect: { code: 'E0594', line: 8 },
        why: 'Assigning the field itself replaces the whole `Cell`, which needs W of `f.ready`, and a `&Flags` gives R only.',
        focus: { line: 8, path: 'f.ready', needs: ['write'] },
        permission: 'write',
        fixes: [
          good('use-set', 8, '    f.ready.set(true);', '`set` writes through `&`, so it needs R only.'),
          lure('other', 'mut-param', 7, 'fn arm(f: &mut Flags) -> bool {', 'It compiles, but now the caller must hold the only handle to the `Flags`, which is what a `Cell` exists to avoid.', 'r.cell-is-a-wrapper'),
          wrong('deref-cell', 8, '    *f.ready = true;', 'A `Cell` does not dereference to its value: the value is reached with `get` and `set`.', 'r.cell-is-a-wrapper'),
        ],
      },
      {
        id: 'get-mut',
        edit: at(8, '    *f.ready.get_mut() = true;'),
        expect: { code: 'E0596', line: 8 },
        why: '`get_mut` takes `&mut self`, so it needs W of `f.ready`, and a `&Flags` gives R only; `set` is the method that works through `&`.',
        focus: { line: 8, path: 'f.ready', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'into-inner',
        edit: at(9, '    f.ready.into_inner()'),
        expect: { code: 'E0507', line: 9 },
        why: '`into_inner` takes the `Cell` by value, so it needs O of `f.ready`, and a `&Flags` gives R only.',
        focus: { line: 9, path: 'f.ready', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('use-get', 9, '    f.ready.get()', '`get` copies the `bool` out through `&`, so it needs R only.'),
          lure('other', 'use-take', 9, '    f.ready.take()', 'It compiles, but `take` leaves `false` behind, so reading the flag also disarms it.', 'r.take-is-not-get'),
          wrong('deref-flag', 9, '    (*f).ready.into_inner()', 'Writing the path another way changes nothing: `into_inner` still takes the cell out of a shared reference.', 'r.deref-moves-out'),
        ],
      },
    ],
  },

  {
    id: 'slot-take-request',
    kcs: [OM, CCD],
    title: 'Pop the request out of a slot',
    domain: 'Request',
    base: rs`
      use std::rc::Rc;

      struct Slot {
          req: Option<String>,
      }

      fn pop(s: &mut Slot) -> Option<String> {
          s.req.take()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`take` swaps `None` into the slot and returns the old value, so nothing is moved out of `s.req`: it holds R and W through `&mut`.',
      },
      {
        id: 'move-field',
        edit: at(8, '    s.req'),
        expect: { code: 'E0507', line: 8 },
        why: 'Through `&mut Slot`, `s.req` has R and W but no O, and returning it by value moves the `Option` out, which needs O.',
        focus: { line: 8, path: 's.req', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('take', 8, '    s.req.take()', '`take` leaves `None` in the slot and hands back the request, so the slot stays valid and nothing needs O.'),
          lure('clone', 'clone-req', 8, '    s.req.clone()', 'It compiles because it copies the request string, but the slot still holds the request, so it can be popped twice.'),
          wrong('iter-req', 8, '    s.req.iter()', '`iter` returns an iterator over the option, not the `Option<String>` the function promises.', 'r.borrow-view-is-not-a-copy'),
        ],
      },
      {
        id: 'shared-slot',
        edit: at(7, 'fn pop(s: &Slot) -> Option<String> {'),
        expect: { code: 'E0596', line: 8 },
        why: 'Through a `&Slot`, `s.req` has R but no W, and `take` borrows it `&mut`, which needs W.',
        focus: { line: 8, path: 's.req', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'rc-slot',
        edit: at(7, 'fn pop(s: &mut Rc<Slot>) -> Option<String> {'),
        expect: { code: 'E0596', line: 8 },
        why: 'An `Rc` shares its `Slot` with other handles, so `s.req` has R but no W, and `take` needs W.',
      },
      {
        id: 'map-field',
        edit: at(8, '    s.req.map(|r| r)'),
        expect: { code: 'E0507', line: 8 },
        why: '`map` takes the `Option` by value, so it needs O of `s.req`, and through `&mut Slot` the field has R and W but no O.',
        focus: { line: 8, path: 's.req', needs: ['read', 'own'] },
        permission: 'own',
      },
    ],
  },

  {
    id: 'tap-reentry',
    kcs: [IM],
    title: 'Log a number and then its half, recursively',
    domain: 'Router',
    run: true,
    base: rs`
      use std::cell::RefCell;

      struct Tap { log: RefCell<Vec<u32>> }
      impl Tap {
          fn note(&self, x: u32) {
              let mut g = self.log.borrow_mut();
              g.push(x);
              drop(g);
              if x > 0 { self.note(x / 2) }
          }
      }
      fn main() {
          let h = Tap { log: RefCell::default() };
          h.note(2);
          println!("{:?}", h.log.borrow());
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`drop(g)` ends the `RefMut` before the recursive call, so each call finds the cell free.',
      },
      {
        id: 'recurse-held',
        edit: at(8, '        println!("{}", g.len());'),
        expect: { code: 'BorrowMutError', line: 6 },
        why: 'With `drop` gone the guard `g` lives to the end of the call, so the recursive call finds the cell mutably borrowed when its own `borrow_mut` runs on line 6.',
        fixes: [
          good('drop-g', 8, '        std::mem::drop(g);', 'Dropping the guard before the recursive call frees the cell, so the next `borrow_mut` succeeds.'),
          wrong('bind-g', 8, '        let _g = g;', 'The new binding keeps the guard alive to the end of the call, so the recursive call still finds the cell borrowed.', 'r.underscore-drops'),
          wrong('drop-ref', 8, '        drop(&g);', '`drop(&g)` drops a reference to the guard, which does nothing: the `RefMut` itself lives to the end of the call.', 'r.drop-a-reference'),
        ],
      },
      {
        id: 'shared-guard',
        edit: at(6, '        let g = self.log.borrow();'),
        expect: { code: 'E0596', line: 7 },
        why: 'A `Ref` from `borrow()` lends the vector with R only, like `&`, and `push` needs W: only `borrow_mut` hands out W.',
        focus: { line: 7, path: 'g', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'reborrow-inside',
        edit: at(7, '        g.push(self.log.borrow()[0]);'),
        expect: { code: 'BorrowError', line: 7 },
        why: '`g` is a `RefMut` that lives to the end of the call, so `borrow()` on line 7 finds the cell mutably borrowed: R is taken while `&mut` lives.',
      },
      {
        id: 'move-vec',
        edit: at(7, '        let v = *g;'),
        expect: { code: 'E0507', line: 7 },
        why: 'A `RefMut` lends the vector with R and W but no O, and `let v = *g` moves it out, which needs O.',
      },
    ],
  },

  {
    id: 'rotate-owners-len',
    kcs: [AL, BR],
    title: 'Swap the first and last block owners',
    domain: 'BlockPool',
    base: rs`
      use std::mem::swap;

      fn rotate(o: &mut Vec<u32>) {
          let n = o.len();
          o.swap(0, n - 1);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`n` is a copy of the length, so no argument reads `o` while the call to `swap` holds its `&mut` borrow.',
      },
      {
        id: 'swap-len',
        edit: at(5, '    o.swap(0, o.len() - 1);'),
        expect: { code: 'E0502', line: 5 },
        why: '`swap` is a slice method reached through `DerefMut`, so the `&mut` borrow of `o` is taken before the arguments run (not two-phase), and `o.len()` has lost R: the checker rejects a call that is safe.',
        focus: { line: 5, path: 'o', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('len-first', 5, '    o.swap(0, n - 1);', 'The length is read on line 4, before the `&mut` borrow starts, so the arguments need nothing from `o`.'),
          lure('clone', 'clone-vec', 5, '    o.clone().swap(0, o.len() - 1);', 'It compiles because it swaps two entries of a copy, which is dropped at once: the real vector is never reordered.'),
          wrong('as-slice', 5, '    o.as_mut_slice().swap(0, o.len() - 1);', 'Writing the conversion out changes nothing: the `&mut` borrow of `o` is still taken before `o.len()` runs.', 'r.method-form-two-phase'),
        ],
      },
      {
        id: 'push-len',
        edit: at(5, '    o.push(o.len() as u32);'),
        expect: 'compiles',
        why: '`push` is a method of `Vec` itself, so its `&mut` borrow is two-phase: it is reserved, `o.len()` reads, and only then does the borrow turn mutable.',
      },
      {
        id: 'mem-swap',
        edit: at(5, '    swap(&mut o[0], &mut o[n - 1]);'),
        expect: { code: 'E0499', line: 5 },
        why: 'The first `&mut o[0]` is alive until `swap` runs, and the second `&mut o[n - 1]` needs another `&mut` borrow of `o`: the checker cannot see that the two indices differ.',
        fixes: [
          good('swap-method', 5, '    o.swap(0, n - 1);', '`Vec::swap` takes both indices itself, so it needs only one `&mut` borrow of the vector.'),
          lure('clone', 'clone-first', 5, '    swap(&mut o[0].clone(), &mut o[n - 1]);', 'It swaps a copy of the first entry with the last one, so the first entry in the vector never changes.'),
          lure('other', 'swap-first-two', 5, '    o.swap(0, 1);', 'It compiles, but it swaps the first two blocks instead of the first and the last.'),
        ],
      },
    ],
  },

  {
    id: 'slot-or-insert',
    kcs: [AL, BR],
    title: 'Return a cached prompt or insert an empty one',
    domain: 'PrefixCache',
    base: rs`
      use std::collections::HashMap;
      type M = HashMap<u32, String>;

      fn get(m: &mut M, k: u32) -> &String {
          if m.contains_key(&k) { return &m[&k]; }
          m.insert(k, String::new());
          &m[&k]
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`contains_key` returns a `bool`, so no borrow of `m` is alive when `insert` needs W on line 6.',
      },
      {
        id: 'cond-get',
        edit: at(5, '    if let Some(v) = m.get(&k) { return v; }'),
        expect: { code: 'E0502', line: 6 },
        why: 'Returning `v` ties the borrow to the whole function, so the checker keeps `m` borrowed even on the path that did not return, and `insert` has no W: a safe pattern the analyzer rejects.',
        fixes: [
          good('contains-key', 5, '    if m.contains_key(&k) { return &m[&k]; }', 'A `bool` test borrows `m` only for the call, and the early return reborrows after it, so nothing is alive when `insert` runs.'),
          lure('other', 'entry-first', 5, '    let _ = m.entry(k).or_default();', 'It compiles, but line 6 then overwrites the entry, so a prompt that was already cached is replaced by an empty one.', 'r.overwrite-to-silence'),
          lure('other', 'peek-only', 5, '    let _ = m.contains_key(&k);', 'It compiles because nothing is returned early any more: every call now overwrites the cached prompt with an empty one.', 'r.overwrite-to-silence'),
        ],
      },
      {
        id: 'iter-remove',
        edit: at(6, '    for v in m.values() { m.remove(&k); }'),
        expect: { code: 'E0502', line: 6 },
        why: '`values()` borrows `m` with `&` for every pass of the loop, so `m` has no W for `remove`: removing an entry mid-iteration could free what `v` points at.',
        focus: { line: 6, path: 'm', needs: ['write'] },
        permission: 'write',
      },
      {
        id: 'shared-map',
        edit: at(4, 'fn get(m: &M, k: u32) -> &String {'),
        expect: { code: 'E0596', line: 6 },
        why: 'Through a `&M`, `m` has R but no W, and `insert` borrows it `&mut`, which needs W.',
        focus: { line: 6, path: 'm', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'queue-via-method',
    kcs: [AL, BR],
    title: 'Spend a token while holding the queue',
    domain: 'Scheduler',
    base: rs`
      struct Sched { queue: Vec<u32>, left: u32 }

      impl Sched {
          fn q(&mut self) -> &mut Vec<u32> {
              &mut self.queue
          }
      }

      fn tick(s: &mut Sched) {
          let q = &mut s.queue;
          s.left -= 1;
          q.push(s.left);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`&mut s.queue` borrows one field, so `s.left` keeps R and W while `q` lives: the checker tracks fields separately.',
      },
      {
        id: 'via-method',
        edit: at(10, '    let q = s.q();'),
        expect: { code: 'E0503', line: 11 },
        why: 'The signature `q(&mut self)` borrows the whole of `*s`, not just the queue, so `s.left` has lost R and W until the last use of `q` on line 12.',
        fixes: [
          good('field-borrow', 10, '    let q = &mut s.queue;', 'Borrowing the field directly leaves `s.left` alone, because the checker sees through the path.'),
          lure('clone', 'clone-q', 10, '    let q = &mut s.queue.clone();', 'It compiles, but `q` is now a copy of the queue that is dropped at the end of the call, so the real queue never gets the token.'),
          wrong('whole-s', 10, '    let q = &mut s;', 'It borrows the whole `Sched` instead of the queue, so `s.left` stays locked and `q` has no `push`.', 'r.method-borrows-the-field'),
        ],
      },
      {
        id: 'call-method',
        edit: at(11, '    s.left = s.q().len() as u32;'),
        expect: { code: 'E0499', line: 11 },
        why: '`q` borrows `s.queue` `&mut` until line 12, and `s.q()` needs a `&mut` borrow of all of `*s`, which overlaps it.',
      },
      {
        id: 'shared-sched',
        edit: at(9, 'fn tick(s: &Sched) {'),
        expect: { code: 'E0596', line: 10 },
        why: 'Through a `&Sched`, `s.queue` has R but no W, and `&mut s.queue` needs W.',
        focus: { line: 10, path: 's.queue', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'closure-field-capture-sched',
    kcs: [AL, BR],
    title: 'Count a dispatch in a closure while queuing',
    domain: 'Scheduler',
    base: rs`
      struct Sched { queue: Vec<u32>, left: u32 }

      impl Sched {
          fn spend(&mut self) { self.left -= 1 }
      }

      fn tick(s: &mut Sched) {
          let mut f = || s.left -= 1;
          s.queue.push(0);
          f();
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The closure captures only the field `s.left`, so `s.queue` is free to change while `f` is alive.',
      },
      {
        id: 'move-closure',
        edit: at(8, '    let mut f = move || s.left -= 1;'),
        expect: { code: 'E0382', line: 9 },
        why: 'A `move` closure takes the whole reference `s`, not just the field it names, so `s` lost R, W and O here, and `s.queue.push` needs them.',
        fixes: [
          good('drop-move', 8, '    let mut f = || s.left -= 1;', 'Without `move` the closure borrows just the field `s.left`, so `s.queue` stays usable.'),
          wrong('method-call', 8, '    let mut f = move || s.spend();', '`spend(&mut self)` needs all of `*s`, and `move` takes the whole reference, so `s.queue.push` is rejected.', 'r.method-borrows-the-field'),
          wrong('deref-left', 8, '    let mut f = || *s.left -= 1;', 'A `u32` cannot be dereferenced with `*`, so the closure does not compile at all.'),
        ],
      },
      {
        id: 'same-field',
        edit: at(9, '    s.left += 1;'),
        expect: { code: 'E0503', line: 9 },
        why: 'The closure holds a `&mut` borrow of `s.left` until `f()` on line 10, so `s.left` has lost R and W, and `+=` needs both.',
      },
      {
        id: 'shared-sched',
        edit: at(7, 'fn tick(s: &Sched) {'),
        expect: { code: 'E0596', line: 8 },
        why: 'Through a `&Sched`, `s.left` has R but no W, and the closure needs a `&mut` borrow of it.',
      },
    ],
  },

  {
    id: 'split-first-two-blocks',
    kcs: [AL, SL],
    title: 'Swap the first two blocks of a pool',
    domain: 'BlockPool',
    base: rs`
      fn pair(v: &mut [u32]) -> Option<u32> {
          let (a, r) = v.split_first_mut()?;
          let b = &mut r[0];
          std::mem::swap(a, b);
          Some(*a + *b)
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`split_first_mut` hands out two `&mut` that cannot overlap, `a` for the first entry and `r` for the others, so `a` and `b` are different blocks.',
      },
      {
        id: 'index-twice',
        edit: at(3, '    let b = &mut v[1];'),
        expect: { code: 'E0499', line: 3 },
        why: '`a` still borrows `v` `&mut`, and the checker does not see that index 1 lies outside it: it rejects a second `&mut` of `v` although this one is safe.',
        fixes: [
          good('from-rest', 3, '    let b = &mut r[0];', '`r` is the part of `v` after the first entry, so `r[0]` is the same block, borrowed through the split.'),
          lure('clone', 'clone-b', 3, '    let b = &mut v[1].clone();', 'The clone still reads `v[1]` while `a` holds `v` `&mut`, so it is rejected all the same, and it would swap with a copy anyway.'),
          wrong('range-b', 3, '    let b = &mut v[1..][0];', 'A slice of `v` is still a `&mut` borrow of all of `v`, which overlaps the one `a` holds.', 'r.disjoint-index-is-not-disjoint'),
        ],
      },
      {
        id: 'read-first',
        edit: at(5, '    Some(v[0] + *a)'),
        expect: { code: 'E0503', line: 5 },
        why: '`a` borrows `v[0]` `&mut` and is read after `v[0]`, so `v[0]` has lost R and W when it is read first.',
        focus: { line: 5, path: 'v[0]', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'len-in-index',
        edit: at(3, '    let b = &mut r[v.len() - 2];'),
        expect: { code: 'E0502', line: 3 },
        why: '`a` and `r` borrow `v` `&mut`, so `v.len()` has lost R while they live: read the length before the split.',
        focus: { line: 3, path: 'v', needs: ['read'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'zero-tail-halves',
    kcs: [AL, SL],
    title: 'Copy the head into the tail, then clear it',
    domain: 'Batch',
    base: rs`
      fn zero_tail(b: &mut [u32], k: usize) {
          let (h, t) = b.split_at_mut(k);
          t[0] = h[0];
          h[0] = 0;
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`split_at_mut` hands out two `&mut` slices that cannot overlap, so `h` and `t` each hold R and W of their own half.',
      },
      {
        id: 'range-overlap',
        edit: at(2, '    let (h, t) = (&mut b[..k], &mut b[k..]);'),
        expect: { code: 'E0499', line: 2 },
        why: 'The checker does not know that `..k` and `k..` never overlap: the first `&mut b[..k]` is alive, and the second needs another `&mut` borrow of `b`.',
        fixes: [
          good('split-at', 2, '    let (h, t) = b.split_at_mut(k);', '`split_at_mut` proves the halves disjoint inside, with unsafe code the checker cannot see, and hands out both `&mut`.'),
          wrong('shared-tail', 2, '    let (h, t) = (&mut b[..k], &b[k..]);', 'A `&` of the tail still conflicts with the `&mut` of the head, and `t[0] = …` would need W it does not have.', 'r.disjoint-index-is-not-disjoint'),
          wrong('shared-split', 2, '    let (h, t) = b.split_at(k);', '`split_at` hands out shared slices, so `t[0] = …` has R but no W.', 'r.disjoint-index-is-not-disjoint'),
        ],
      },
      {
        id: 'index-both',
        edit: at(3, '    b[k] = h[0];'),
        expect: { code: 'E0503', line: 3 },
        why: '`h` borrows `b` `&mut` until line 4, so `b` has lost R and W when `b[k]` is assigned: the index is checked against its length.',
      },
      {
        id: 'len-while-split',
        edit: at(3, '    t[0] = b.len() as u32;'),
        expect: { code: 'E0502', line: 3 },
        why: '`h` and `t` borrow `b` `&mut`, so `b.len()` has lost R while they live: read the length before the split.',
        focus: { line: 3, path: 'b', needs: ['read'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'recycle-used-blocks',
    kcs: [AL, OM],
    title: 'Move the used blocks back to the free list',
    domain: 'BlockPool',
    base: rs`
      struct Pool { free: Vec<u8>, used: Vec<u8> }

      fn recycle(p: &mut Pool) {
          let used = std::mem::take(&mut p.used);
          p.free.extend(used);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`take` swaps an empty vector into `p.used` and returns the old one, so nothing is moved out of a borrowed place.',
      },
      {
        id: 'move-field',
        edit: at(4, '    let used = p.used;'),
        expect: { code: 'E0507', line: 4 },
        why: 'Through `&mut Pool`, `p.used` has R and W but no O, and `let used = p.used` moves the vector out, which needs O.',
        focus: { line: 4, path: 'p.used', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('take', 4, '    let used = std::mem::take(&mut p.used);', '`take` leaves an empty vector in the pool and hands over the blocks, so the pool stays valid and no O is needed.'),
          lure('clone', 'clone-used', 4, '    let used = p.used.clone();', 'It copies every block id, and the pool still lists them as used, so a block is both used and free.'),
          wrong('deref-used', 4, '    let used = *&mut p.used;', 'Going through a `&mut` still moves the vector out of `p`, which still needs O.', 'r.deref-moves-out'),
        ],
      },
      {
        id: 'extend-self',
        edit: at(5, '    p.free.extend(&p.free);'),
        expect: { code: 'E0502', line: 5 },
        why: '`&p.free` is a shared borrow that lasts for the call, so `p.free` has no W when `extend` writes into it: appending could move the vector under the borrow.',
        focus: { line: 5, path: 'p.free', needs: ['write'] },
        permission: 'write',
        fixes: [
          good('extend-used', 5, '    p.free.extend(used);', 'The blocks come from `used`, which the function owns, so nothing borrows `p.free`.'),
          lure('clone', 'clone-free', 5, '    p.free.extend(p.free.clone());', 'It compiles because it appends a copy, but it doubles the free list instead of returning the used blocks.'),
          wrong('field-used', 5, '    p.free.extend(p.used);', 'It moves `p.used` out of `&mut Pool`, which holds R and W of it but no O, so it fails with E0507 instead.', 'r.deref-moves-out'),
        ],
      },
      {
        id: 'take-shared',
        edit: at(3, 'fn recycle(p: &Pool) {'),
        expect: { code: 'E0596', line: 4 },
        why: 'Through a `&Pool`, `p.used` has R but no W, and `&mut p.used` needs W.',
        focus: { line: 4, path: 'p.used', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'mark-done-fields',
    kcs: [AL, BR],
    title: 'Copy each request id into the done list',
    domain: 'Scheduler',
    base: rs`
      struct Sched {
          reqs: Vec<u32>,
          done: Vec<u32>,
      }

      fn mark(s: &mut Sched) {
          for r in s.reqs.iter() {
              s.done.push(*r);
          }
      }

      fn push_done(s: &mut Sched, r: u32) {
          s.done.push(r);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The loop borrows only `s.reqs`, and `push` needs W of `s.done`: the checker tracks the two fields separately.',
      },
      {
        id: 'same-field',
        edit: at(8, '        s.reqs.push(*r);'),
        expect: { code: 'E0502', line: 8 },
        why: 'The loop borrows `s.reqs` with `&` for every pass, so it has no W for `push`: growing a vector mid-iteration could move it under the iterator.',
        focus: { line: 8, path: 's.reqs', needs: ['write'] },
        permission: 'write',
      },
      {
        id: 'helper-fn',
        edit: at(8, '        push_done(s, *r);'),
        expect: { code: 'E0502', line: 8 },
        why: '`push_done` takes the whole `&mut Sched`, so the checker must assume it may touch `s.reqs`, which the loop still borrows with `&`: a signature too wide for what the body does.',
        focus: { line: 8, path: 's', needs: ['write'] },
        permission: 'write',
        fixes: [
          good('push-field', 8, '        s.done.push(*r);', 'Naming the field lets the checker see that only `s.done` changes, while the loop holds `s.reqs`.'),
          wrong('reborrow-s', 8, '        push_done(&mut *s, *r);', 'A reborrow of `*s` is still a `&mut` of the whole struct, which overlaps the loop\'s borrow of `s.reqs`.', 'r.method-borrows-the-field'),
          wrong('iter-mut', 7, '    for r in s.reqs.iter_mut() {', 'A `&mut` borrow of `s.reqs` is no lighter than a `&` one: it still blocks the helper\'s `&mut Sched`, and `*r` is no longer a `u32`.', 'r.method-borrows-the-field'),
        ],
      },
      {
        id: 'shared-sched',
        edit: at(6, 'fn mark(s: &Sched) {'),
        expect: { code: 'E0596', line: 8 },
        why: 'Through a `&Sched`, `s.done` has R but no W, and `push` needs W.',
        focus: { line: 8, path: 's.done', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'lexer-over-text',
    kcs: [LT],
    title: 'Hold a view of the prompt in a lexer',
    domain: 'Tokenizer',
    base: rs`
      struct Lexer<'a>(&'a str);

      fn count(t: String) -> usize {
          let lx = Lexer(&t);
          lx.0.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`Lexer<\'a>` says its text is valid for `\'a`, and `&t` is a borrow that lasts as long as `lx` is used, while `t` lives to the end of `count`.',
      },
      {
        id: 'bare-ref',
        edit: at(1, 'struct Lexer(&str);'),
        expect: { code: 'E0106', line: 1 },
        why: 'A reference stored in a struct must say how long it is valid, and `&str` with no lifetime names nothing the struct could be tied to.',
        fixes: [
          good('name-it', 1, 'struct Lexer<\'a>(&\'a str);', 'The struct declares `\'a`, and the field uses it, so every `Lexer` is tied to the text it borrows.'),
          wrong('static-text', 1, 'struct Lexer(&\'static str);', 'A `\'static` field asks for text that lives for the whole program, and `&t` borrows a local `String` that is dropped on return.', 'r.static-to-silence'),
          wrong('own-text', 1, 'struct Lexer(String);', 'The field now owns its text, but line 4 still builds the `Lexer` from a borrow `&t`, which is not a `String`.', 'r.borrow-view-is-not-a-copy'),
        ],
      },
      {
        id: 'temp-copy',
        edit: at(4, '    let lx = Lexer(t.to_string().as_str());'),
        expect: { code: 'E0716', line: 4 },
        why: '`to_string()` builds a temporary `String` that is dropped at the end of line 4, but `lx` borrows it and is read on line 5.',
        fixes: [
          good('borrow-t', 4, '    let lx = Lexer(&t);', '`t` is a `String` that `count` owns until it returns, so a borrow of it outlives every use of `lx`.'),
          lure('clone', 'clone-t', 4, '    let lx = Lexer(t.clone().as_str());', 'The clone is another temporary dropped at the end of line 4, so `lx` still points at a `String` that is gone.'),
          wrong('mut-borrow', 4, '    let lx = Lexer(&mut t);', '`Lexer` holds a `&str`, not a `&mut String`, and `t` is not declared `mut` either.', 'r.mut-binding-vs-mut-ref'),
        ],
      },
      {
        id: 'drop-text',
        edit: at(5, '    { drop(t); lx.0.len() }'),
        expect: { code: 'E0505', line: 5 },
        why: '`lx` borrows `t` and is read after `drop(t)`, so `t` has no O while the borrow lives, and `drop` moves it out.',
        focus: { line: 5, path: 't', needs: ['own'] },
        permission: 'own',
        fixes: [
          good('read-first', 5, '    { let n = lx.0.len(); drop(t); n }', 'The last use of `lx` is before `drop`, so the borrow has ended and `t` has O again.'),
          lure('clone', 'clone-drop', 5, '    { drop(t.clone()); lx.0.len() }', 'It compiles because only a copy is dropped; `t` stays alive, so the memory this was meant to release is still held.'),
          lure('other', 'drop-ref', 5, '    { drop(&t); lx.0.len() }', 'It compiles because dropping a reference does nothing: `t` is still alive and the borrow was never the problem.', 'r.drop-a-reference'),
        ],
      },
    ],
  },

  {
    id: 'big-priority-pick',
    kcs: [LT],
    title: 'Pick the higher priority of two requests',
    domain: 'Scheduler',
    base: rs`
      fn big<'a>(a: &'a u8, b: &'a u8) -> &'a u8 {
          if a >= b { a } else { b }
      }

      fn top() -> u8 {
          let a = 3;
          let r;
          {
              let b = &5;
              r = big(&a, b);
          }
          *r
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`&5` is a constant promoted to `\'static`, so `b` is valid for the whole program, and `r` is tied only to `a`, which outlives the block.',
      },
      {
        id: 'local-b',
        edit: at(9, '        let b = &(a + 1);'),
        expect: { code: 'E0716', line: 9 },
        why: '`big` ties `r` to both inputs, and `a + 1` is a temporary that lives only to the end of the block, but `r` is read on line 12.',
        fixes: [
          good('promote-b', 9, '        let b = &5;', 'A constant is promoted to `\'static`, so the borrow is valid for as long as `r` needs it.'),
          wrong('own-b', 9, '        let b = &mut (a + 1);', 'A `&mut` of a temporary has the same short life, and `big` wants a shared reference.', 'r.temporary-lives-in-the-let'),
          wrong('copy-b', 9, '        let b = &{ a + 1 };', 'The braces build a new temporary in the same place: it is dropped when the block ends.', 'r.temporary-lives-in-the-let'),
        ],
      },
      {
        id: 'no-named',
        edit: at(1, 'fn big(a: &u8, b: &u8) -> &u8 {'),
        expect: { code: 'E0106', line: 1 },
        why: 'With two input references the compiler cannot guess which one the returned `&u8` borrows from, so the signature must name the lifetime.',
        fixes: [
          good('name-both', 1, 'fn big<\'a>(a: &\'a u8, b: &\'a u8) -> &\'a u8 {', 'One lifetime `\'a` on both inputs and the output says the result is valid only as long as both are.'),
          wrong('name-one', 1, 'fn big<\'a>(a: &\'a u8, b: &u8) -> &\'a u8 {', 'The body may return `b`, which was given no `\'a`, so the compiler cannot prove the result lives that long.', 'r.named-lifetime-is-not-static'),
          wrong('static-out', 1, 'fn big(a: &u8, b: &u8) -> &\'static u8 {', 'Promising `\'static` does not make the inputs live that long: the body returns one of them.', 'r.static-to-silence'),
        ],
      },
      {
        id: 'ret-ref-top',
        edit: at(5, 'fn top() -> &u8 {'),
        expect: { code: 'E0106', line: 5 },
        why: '`top` takes no reference, so a returned `&u8` has nothing to borrow from, and elision cannot fill the lifetime in.',
      },
    ],
  },

  {
    id: 'next-token-elided',
    kcs: [LT, BR],
    title: 'Pull two tokens before using either',
    domain: 'Tokenizer',
    base: rs`
      struct Lexer<'a> { src: &'a str, at: usize }

      impl<'a> Lexer<'a> {
          fn next(&mut self) -> &'a str {
              let s = &self.src[self.at..];
              self.at = self.src.len();
              s
          }
      }

      fn two(l: &mut Lexer) -> usize {
          let a = l.next();
          let b = l.next();
          a.len() + b.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`next` returns `&\'a str`, tied to the text, not to the `&mut self` borrow, so the borrow of `l` ends when the call returns and `a` stays valid.',
      },
      {
        id: 'tied-to-self',
        edit: at(4, '    fn next(&mut self) -> &str {'),
        expect: { code: 'E0499', line: 13 },
        why: 'Elision ties the returned `&str` to the `&mut self` borrow, so `a` keeps `*l` mutably borrowed until line 14, and the second `l.next()` needs another `&mut`.',
        fixes: [
          good('name-a', 4, '    fn next(&mut self) -> &\'a str {', 'Naming `\'a` ties the token to the text the lexer holds, so the `&mut self` borrow ends at the call.'),
          wrong('tie-mut', 4, '    fn next(&\'a mut self) -> &\'a str {', 'Putting `\'a` on `&mut self` makes the borrow of the lexer as long as the text, so the second call still finds it borrowed.', 'r.named-lifetime-is-not-static'),
          wrong('fresh-b', 4, '    fn next<\'b>(&\'b mut self) -> &\'b str {', 'A new `\'b` is the same thing elision gave: the token lives only as long as the `&mut self` borrow.', 'r.named-lifetime-is-not-static'),
        ],
      },
      {
        id: 'shared-lexer',
        edit: at(11, 'fn two(l: &Lexer) -> usize {'),
        expect: { code: 'E0596', line: 12 },
        why: 'Through a `&Lexer`, `*l` has R but no W, and `next` takes `&mut self`, which needs W.',
        focus: { line: 12, path: 'l', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'bare-src',
        edit: at(1, 'struct Lexer<\'a> { src: &str, at: usize }'),
        expect: { code: 'E0106', line: 1 },
        why: 'The field `src: &str` has no lifetime, so the compiler cannot say how long it is valid, although the struct declares `\'a`.',
      },
    ],
  },

  {
    id: 'spawn-loop-var',
    kcs: [LT, OM],
    title: 'Spawn one worker per request',
    domain: 'Worker',
    base: rs`
      use std::thread::spawn;

      fn fan(n: u32) {
          let mut hs = vec![];
          for i in 0..n {
              hs.push(spawn(move || i * 2));
          }
          for h in hs {
              h.join().unwrap();
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`move` copies `i` into each closure, so a worker uses nothing from `fan`\'s frame and may outlive it.',
      },
      {
        id: 'no-move',
        edit: at(6, '        hs.push(spawn(|| i * 2));'),
        expect: { code: 'E0373', line: 6 },
        why: 'Without `move` the closure borrows the loop variable `i`, which is gone after its pass, but the thread may still be running.',
        fixes: [
          good('add-move', 6, '        hs.push(spawn(move || i * 2));', '`move` copies the `u32` into the closure, so the thread carries its own `i`.'),
          lure('clone', 'clone-i', 6, '        hs.push(spawn(|| i.clone()));', 'The clone is made inside the thread, which still borrows `i` to reach it: the borrow, and the error, remain.'),
          wrong('use-n', 6, '        hs.push(spawn(|| n * 2));', 'It borrows `n` instead, a parameter that is also dropped when `fan` returns, and `n` is not the loop variable.', 'r.move-is-optional'),
        ],
      },
      {
        id: 'immutable-hs',
        edit: at(4, '    let hs = vec![];'),
        expect: { code: 'E0596', line: 6 },
        why: '`hs` is not declared `mut`, so it has no W, and `push` borrows it `&mut`, which needs W.',
        focus: { line: 6, path: 'hs', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'join-borrowed',
        edit: at(8, '    for h in &hs {'),
        expect: { code: 'E0507', line: 9 },
        why: 'Looping over `&hs` lends each handle, so `h` has R but no O, and `join` takes the handle by value, which needs O.',
        focus: { line: 9, path: 'h', needs: ['read', 'own'] },
        permission: 'own',
      },
    ],
  },

  {
    id: 'boxed-scorer',
    kcs: [LT, OM],
    title: 'Box a scoring closure for the router',
    domain: 'Router',
    base: rs`
      type F = Box<dyn Fn(u32) -> u32>;

      fn make(w: u32) -> F {
          let bias = w + 1;
          Box::new(move |x| x * bias)
      }

      fn run() -> u32 {
          let f = make(2);
          f(3) + f(4)
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`move` copies `bias` into the closure, so the boxed closure owns what it uses and can leave `make`.',
      },
      {
        id: 'no-move',
        edit: at(5, '    Box::new(|x| x * bias)'),
        expect: { code: 'E0373', line: 5 },
        why: 'Without `move` the closure borrows the local `bias`, which is dropped when `make` returns, but the closure is handed to the caller.',
        fixes: [
          good('add-move', 5, '    Box::new(move |x| x * bias)', '`move` copies the `u32` into the closure, so it carries its own bias out of the function.'),
          lure('clone', 'clone-bias', 5, '    Box::new(|x| x * bias.clone())', 'The clone happens when the closure runs, and the closure still borrows `bias` to get at it.'),
          wrong('ref-bias', 4, '    let bias = &(w + 1);', 'Making `bias` a reference does not help: it points at a temporary of `make`, dropped on return, and the closure would carry that borrow out.', 'r.move-is-optional'),
        ],
      },
      {
        id: 'once-twice',
        edit: at(1, 'type F = Box<dyn FnOnce(u32) -> u32>;'),
        expect: { code: 'E0382', line: 10 },
        why: 'A `FnOnce` closure is consumed by its first call, so `f` lost R, W and O at `f(3)`, and `f(4)` needs to use it again.',
        fixes: [
          good('back-to-fn', 1, 'type F = Box<dyn Fn(u32) -> u32>;', '`Fn` can be called any number of times, because calling it only reads what the closure holds.'),
          wrong('fn-mut', 1, 'type F = Box<dyn FnMut(u32) -> u32>;', 'A `FnMut` closure can be called twice, but it needs `&mut` access to `f`, and line 9 declares it without `mut`.', 'r.fnonce-is-not-fnmut'),
          wrong('keep-once', 9, '    let f = &make(2);', 'Borrowing the box does not let the call consume it: a `FnOnce` takes `self`, so it still needs O.', 'r.borrow-view-is-not-a-copy'),
        ],
      },
      {
        id: 'local-ref',
        edit: at(4, '    let bias = &(w + 1);'),
        expect: { code: 'E0515', line: 5 },
        why: '`move` copies the reference `bias` into the boxed closure that `make` returns, but the temporary `w + 1` behind it is dropped when `make` returns.',
      },
    ],
  },

  {
    id: 'guard-temp-peek',
    kcs: [LT, OM],
    title: 'Peek at the first block under a lock',
    domain: 'Metrics',
    base: rs`
      use std::sync::Mutex;

      fn peek(m: &Mutex<Vec<u32>>) -> u32 {
          let g = m.lock().unwrap();
          let f = g.first();
          *f.unwrap_or(&0)
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`g` holds the lock guard until the end of `peek`, and `f` borrows into the guarded vector, so the borrow never outlives the guard.',
      },
      {
        id: 'temp-guard',
        edit: at(5, '    let f = m.lock().unwrap().first();'),
        expect: { code: 'E0716', line: 5 },
        why: 'The guard is a temporary dropped at the end of line 5, which releases the lock, but `f` points into the vector and is read on line 6.',
        fixes: [
          good('keep-guard', 5, '    let f = g.first();', 'Naming the guard on line 4 keeps it alive to the end of the function, so `f` has a vector to point into.'),
          lure('other', 'last-block', 5, '    let f = g.iter().last();', 'It compiles, but it reads the last block instead of the first.'),
          wrong('paren-guard', 5, '    let f = (m.lock().unwrap()).first();', 'Parentheses change nothing: the guard is still a temporary dropped at the end of the statement.', 'r.temporary-lives-in-the-let'),
        ],
      },
      {
        id: 'drop-guard',
        edit: at(6, '    drop(g); *f.unwrap_or(&0)'),
        expect: { code: 'E0505', line: 6 },
        why: '`f` borrows into the vector that `g` guards and is read after `drop(g)`, so `g` has no O while the borrow lives.',
        focus: { line: 6, path: 'g', needs: ['own'] },
        permission: 'own',
        fixes: [
          good('read-first', 6, '    let v = *f.unwrap_or(&0); drop(g); v', 'Reading the value before `drop` ends the borrow, so `g` has O again and the lock is released at `drop`.'),
          lure('clone', 'clone-g', 6, '    drop(g.clone()); *f.unwrap_or(&0)', 'It compiles because only a copy of the vector is dropped: the real guard is alive, so the lock is not released.'),
          lure('other', 'drop-ref', 6, '    drop(&g); *f.unwrap_or(&0)', 'It compiles because dropping a reference does nothing: the guard is still alive and the lock is still held.', 'r.drop-a-reference'),
        ],
      },
    ],
  },

  {
    id: 'index-names-map',
    kcs: [LT, BR],
    title: 'Index each name by its position',
    domain: 'PrefixCache',
    base: rs`
      use std::collections::HashMap;

      fn index(v: Vec<String>) -> usize {
          let mut m = HashMap::new();
          for (n, i) in v.iter().zip(0..) {
              m.insert(n.as_str(), i);
          }
          m.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Each `n` is a reference into `v`, which `index` owns until it returns, so every key in `m` is valid for as long as `m` is used.',
      },
      {
        id: 'into-iter',
        edit: at(5, '    for (n, i) in v.into_iter().zip(0..) {'),
        expect: { code: 'E0597', line: 6 },
        why: '`into_iter` moves each `String` into `n`, which is dropped at the end of its pass, but `m` keeps a `&str` into it and is read on line 8.',
        fixes: [
          good('borrow-v', 5, '    for (n, i) in v.iter().zip(0..) {', 'Looping over `v.iter()` lends each name instead of moving it, so the keys point into `v`, which lives until the function returns.'),
          lure('clone', 'clone-key', 6, '        m.insert(&n.clone(), i);', 'The key is a borrow of a copy, and the copy is a temporary dropped at the end of line 6: `m` would hold a dangling key.'),
          wrong('iter-mut', 5, '    for (n, i) in v.iter_mut().zip(0..) {', '`iter_mut` needs W of `v`, which is not declared `mut`, and the keys would borrow `v` `&mut` as well.', 'r.borrow-view-is-not-a-copy'),
        ],
      },
      {
        id: 'temp-key',
        edit: at(6, '        m.insert(&n.to_lowercase(), i);'),
        expect: { code: 'E0716', line: 6 },
        why: '`to_lowercase()` builds a temporary `String` dropped at the end of line 6, but `m` keeps a `&str` into it until line 8.',
      },
      {
        id: 'drop-source',
        edit: at(8, '    drop(v); m.len()'),
        expect: { code: 'E0505', line: 8 },
        why: 'The keys of `m` borrow `v` with `&` and `m` is read after `drop(v)`, so `v` has lost O while the borrow lives, and `drop` moves it.',
        focus: { line: 8, path: 'v', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('len-first', 8, '    let c = m.len(); drop(v); c', 'Reading the length first is the last use of `m`, so the borrow of `v` has ended and `v` has O again at `drop`.'),
          lure('clone', 'clone-drop', 8, '    drop(v.clone()); m.len()', 'It compiles because only a copy of the names is dropped: `v` stays alive, so the memory `drop` was meant to release is still held.'),
          lure('other', 'drop-ref', 8, '    drop(&v); m.len()', 'It compiles because dropping a reference does nothing: `v` is still alive and the borrow was never the problem.', 'r.drop-a-reference'),
        ],
      },
    ],
  },

  {
    id: 'hot-slot-scope',
    kcs: [LT],
    title: 'Keep a hot slot after its block ends',
    domain: 'Scheduler',
    base: rs`
      fn pick() -> u32 {
          let a = 7;
          let mut hot: Vec<&u32> = vec![];
          {
              let b = 9;
              hot.push(&a);
              println!("{b}");
          }
          *hot[0]
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`hot` holds a borrow of `a`, which is declared in the outer scope and lives until `pick` returns, so the borrow outlives the block.',
      },
      {
        id: 'inner-ref',
        edit: at(6, '        hot.push(&b);'),
        expect: { code: 'E0597', line: 6 },
        why: '`b` is dropped at the end of the block on line 8, but `hot` holds a borrow of it and is read on line 9.',
        fixes: [
          good('promote', 5, '        let b = &9;', 'A constant behind `&` is promoted to `\'static`, so `b` points at data that is never dropped and the borrow can leave the block.'),
          lure('clone', 'clone-b', 6, '        hot.push(&b.clone());', 'The borrow is of a copy, and the copy is a temporary dropped at the end of line 6, so the borrow dangles sooner still.'),
          wrong('mut-b', 5, '        let b = &mut 9;', 'A `&mut` constant is not promoted to `\'static`, so `b` is still dropped at the end of the block.', 'r.static-to-silence'),
        ],
      },
      {
        id: 'mut-ref',
        edit: at(6, '        hot.push(&mut b);'),
        expect: { code: 'E0596', line: 6 },
        why: '`b` is not declared `mut`, so it has no W, and `&mut b` needs W.',
        focus: { line: 6, path: 'b', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'block-value',
        edit: at(6, '        hot.push(&{ b });'),
        expect: { code: 'E0716', line: 6 },
        why: 'The braces build a new `u32` as a temporary, dropped at the end of line 6, but `hot` keeps a borrow of it until line 9.',
      },
    ],
  },

  {
    id: 'first-field-width',
    kcs: [LT],
    title: 'Measure the first field of a row',
    domain: 'Tokenizer',
    base: rs`
      fn width(s: &str) -> usize {
          let h = s.split(',').next();
          h.map_or(0, |t| t.len())
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`h` is a slice of `s`, which the caller owns, so the field stays valid for as long as `h` is read.',
      },
      {
        id: 'temp-owned',
        edit: at(2, '    let h = s.to_owned().split(\',\').next();'),
        expect: { code: 'E0716', line: 2 },
        why: '`to_owned()` builds a temporary `String` that is dropped at the end of line 2, but `h` is a slice into it and is read on line 3.',
        fixes: [
          good('borrow-s', 2, '    let h = s.split(\',\').next();', 'Splitting `s` itself borrows text the caller owns, so `h` points at something that outlives the function body.'),
          lure('other', 'comma-space', 2, '    let h = s.split(", ").next();', 'It compiles, but it splits at a comma followed by a space, so a row whose fields are not separated by a space is not split.'),
          wrong('ref-copy', 2, '    let h = &s.to_owned().split(\',\').next();', 'The `&` falls on the result of `next()`, not on the `String`, so the copy is still a temporary dropped at the end of the statement.', 'r.temporary-lives-in-the-let'),
        ],
      },
      {
        id: 'temp-last',
        edit: at(2, '    let h = s.to_owned().split(\',\').last();'),
        expect: { code: 'E0716', line: 2 },
        why: 'The temporary `String` from `to_owned()` is dropped at the end of line 2, and `last()` gives a slice into it that line 3 still reads.',
      },
    ],
  },

  {
    id: 'hook-registry',
    kcs: [LT, OM],
    title: 'Register two scoring hooks for the router',
    domain: 'Router',
    base: rs`
      type Cb = Box<dyn Fn() -> u32>;

      fn hooks(n: u32) -> Vec<Cb> {
          let mut v: Vec<Cb> = vec![];
          v.push(Box::new(move || n + 1));
          v.push(Box::new(move || n * 2));
          v
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`move` copies `n` into each closure, so a hook owns what it uses and the boxed closures can leave `hooks`.',
      },
      {
        id: 'no-move',
        edit: at(5, '    v.push(Box::new(|| n + 1));'),
        expect: { code: 'E0597', line: 5 },
        why: 'Without `move` the closure borrows the parameter `n`, but a `Box<dyn Fn>` must be valid for `\'static` and `n` is dropped when `hooks` returns.',
        fixes: [
          good('add-move', 5, '    v.push(Box::new(move || n + 1));', '`move` copies the `u32` into the closure, so the hook carries its own `n` out of the function.'),
          lure('clone', 'clone-n', 5, '    v.push(Box::new(|| n.clone()));', 'The clone is made when the closure runs, and the closure still borrows `n` to reach it: the borrow, and the error, remain.'),
          wrong('ref-n', 5, '    v.push(Box::new(|| &n + 1));', 'Spelling the use as a reference does not copy anything: the closure still borrows `n`.', 'r.move-is-optional'),
        ],
      },
      {
        id: 'immutable-vec',
        edit: at(4, '    let v: Vec<Cb> = vec![];'),
        expect: { code: 'E0596', line: 4 },
        why: '`v` is not declared `mut`, so it has no W, and `push` on line 5 borrows it `&mut`, which needs W.',
        focus: { line: 5, path: 'v', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'chunk-workers',
    kcs: [LT, OM],
    title: 'Count each chunk of a batch in a thread',
    domain: 'Worker',
    base: rs`
      use std::thread::spawn;

      fn fan(d: Vec<u32>) -> usize {
          let mut hs = vec![];
          for c in d.chunks(2) {
              let c = c.to_vec();
              hs.push(spawn(move || c.len()));
          }
          let mut n = 0;
          for h in hs { n += h.join().unwrap(); }
          n
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`to_vec` copies the chunk into a `Vec` that `move` hands to the thread, so the thread owns its data and needs nothing from `d`.',
      },
      {
        id: 'borrowed-chunk',
        edit: at(6, '        let c = c;'),
        expect: { code: 'E0597', line: 5 },
        why: '`c` is now a slice borrowed from `d`, and `spawn` needs a closure valid for `\'static`, but `d` is a local dropped when `fan` returns.',
      },
      {
        id: 'no-move',
        edit: at(7, '        hs.push(spawn(|| c.len()));'),
        expect: { code: 'E0373', line: 7 },
        why: 'Without `move` the closure borrows the loop\'s `c`, which is dropped at the end of its pass, but the thread may still be running.',
        fixes: [
          good('add-move', 7, '        hs.push(spawn(move || c.len()));', '`move` gives the thread its own `Vec`, so it uses nothing from the loop body.'),
          lure('clone', 'clone-c', 7, '        hs.push(spawn(|| c.clone().len()));', 'The clone is made inside the thread, which still borrows `c` to reach it: the borrow, and the error, remain.'),
          wrong('ref-c', 6, '        let c = &c.to_vec();', 'Making `c` a reference does not help: the `Vec` behind it is a temporary of the loop body, and the thread needs data valid for `\'static`.', 'r.move-is-optional'),
        ],
      },
      {
        id: 'joined-twice',
        edit: at(11, '    n + hs.len()'),
        expect: { code: 'E0382', line: 11 },
        why: 'The loop moved every handle out of `hs`, so `hs` lost R, W and O, and `hs.len()` needs R.',
        focus: { line: 11, path: 'hs', needs: ['read'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'bump-while-reading',
    kcs: [IM],
    title: 'Bump the queue when a request id is seen',
    domain: 'Scheduler',
    run: true,
    base: rs`
      use std::cell::RefCell;

      fn main() {
          let q = RefCell::new(vec![1, 2, 3]);
          let n = q.borrow().len();
          for i in 0..n {
              if q.borrow()[i] == 2 {
                  q.borrow_mut().push(4);
              }
          }
          println!("{}", q.borrow().len());
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The `Ref` in an `if` condition is a temporary dropped before the block starts, so `borrow_mut` on line 8 finds the cell free.',
      },
      {
        id: 'get-in-cond',
        edit: at(7, '        if q.borrow().get(i) == Some(&2) {'),
        expect: 'compiles',
        why: 'The `Ref` and the `Option<&u32>` borrowed from it are temporaries of the `if` condition, dropped before the block starts, so `borrow_mut` on line 8 finds the cell free.',
      },
      {
        id: 'if-let',
        edit: at(7, '        if let 2 = q.borrow()[i] {'),
        expect: { code: 'BorrowMutError', line: 8 },
        why: 'In an `if let`, the temporary `Ref` lives until the end of the block, so the cell is still borrowed when `borrow_mut` runs on line 8: the `&mut` rule, checked at run time.',
        fixes: [
          good('plain-if', 7, '        if q.borrow().get(i) == Some(&2) {', 'The condition of a plain `if` drops its temporary `Ref` before the block runs, so the cell is free again.'),
          lure('clone', 'clone-elem', 7, '        if let 2 = q.borrow()[i].clone() {', 'Cloning the element changes what the pattern matches on, not when the `Ref` is dropped: it still lives to the end of the block.'),
          wrong('bind-elem', 7, '        if let x = q.borrow()[i] {', 'The pattern `x` always matches, and the `Ref` still lives to the end of the block, so the cell is still borrowed.', 'r.temporary-lives-in-the-let'),
        ],
      },
      {
        id: 'hold-ref',
        edit: at(5, '    let r = q.borrow(); let n = r.len();'),
        expect: { code: 'BorrowMutError', line: 8 },
        why: '`r` keeps its `Ref` until the end of `main`, so the cell is still borrowed when `borrow_mut` runs on line 8.',
        fixes: [
          good('no-binding', 5, '    let n = q.borrow().len();', 'Taking the length ends the `Ref` on line 5, so `borrow_mut` finds the cell free.'),
          lure('clone', 'clone-list', 5, '    let n = q.borrow().clone().len();', 'It compiles because the temporary `Ref` is gone at the end of the line, but it copies every element only to read a length.'),
          wrong('ref-binding', 5, '    let r = &q.borrow(); let n = r.len();', 'A `&` in a `let` keeps the temporary `Ref` alive to the end of `main`, so the cell stays borrowed.', 'r.temporary-lives-in-the-let'),
        ],
      },
      {
        id: 'ref-push',
        edit: at(8, '            q.borrow().push(4);'),
        expect: { code: 'E0596', line: 8 },
        why: 'A `Ref` from `borrow()` lends the vector with R only, like `&`, and `push` needs W: only `borrow_mut` hands out W.',
        focus: { line: 8, path: 'q.borrow()', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'rc-handles-queue',
    kcs: [IM, OM],
    title: 'Add to a queue through a second handle',
    domain: 'Scheduler',
    run: true,
    base: rs`
      use std::cell::RefCell;
      use std::rc::Rc;

      fn main() {
          let q = Rc::new(RefCell::new(vec![1]));
          let h = Rc::clone(&q);
          let f = move |x| h.borrow_mut().push(x);
          f(2);
          let n = q.borrow().len();
          f(n);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The `Ref` from `borrow()` is a temporary dropped at the end of line 9, so the cell is free when `f` calls `borrow_mut` on line 10.',
      },
      {
        id: 'inline',
        edit: at(10, '    f(q.borrow().len());'),
        expect: { code: 'BorrowMutError', line: 7 },
        why: 'The temporary `Ref` lives to the end of the statement, which includes the call to `f`, so the cell is still borrowed when `f` runs `borrow_mut` on line 7.',
      },
      {
        id: 'hold-ref',
        edit: at(9, '    let g = q.borrow(); let n = g.len();'),
        expect: { code: 'BorrowMutError', line: 7 },
        why: '`g` keeps its `Ref` until the end of `main`, so the cell is still borrowed when `f` runs `borrow_mut` on line 7.',
      },
      {
        id: 'move-handle',
        edit: at(6, '    let h = q;'),
        expect: { code: 'E0382', line: 9 },
        why: '`let h = q` moved the `Rc`, so `q` lost R, W and O, and `q.borrow()` on line 9 needs R.',
        focus: { line: 9, path: 'q', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('clone-handle', 6, '    let h = Rc::clone(&q);', '`Rc::clone(&q)` copies a handle and bumps a count, so `q` keeps R, W and O and shares the list.'),
          lure('other', 'fresh-queue', 6, '    let h = Rc::new(RefCell::new(vec![]));', 'It compiles, but `h` is now a second, separate queue: what `f` adds never reaches `q`.', 'r.fresh-handle-is-not-a-share'),
          wrong('read-h', 9, '    let n = h.borrow().len();', 'The closure took `h` with `move`, so line 9 cannot name it either.', 'r.move-keeps-the-name'),
        ],
      },
      {
        id: 'shared-f',
        edit: at(7, '    let f = move |x| h.borrow().push(x);'),
        expect: { code: 'E0596', line: 7 },
        why: 'A `Ref` from `borrow()` lends the vector with R only, like `&`, and `push` needs W: only `borrow_mut` hands out W.',
        focus: { line: 7, path: 'h.borrow()', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'retain-dead-set',
    kcs: [AL, BR],
    title: 'Drop the dead requests from the queue',
    domain: 'Scheduler',
    base: rs`
      struct Sched {
          q: Vec<u32>,
          dead: Vec<u32>,
      }

      impl Sched {
          fn is_dead(&self, x: &u32) -> bool {
              self.dead.contains(x)
          }
      }

      fn gc(s: &mut Sched) {
          s.q.retain(|x| !s.dead.contains(x));
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The closure captures only the field `s.dead`, so `s.q` is free to be borrowed `&mut` by `retain` at the same time.',
      },
      {
        id: 'via-method',
        edit: at(13, '    s.q.retain(|x| !s.is_dead(x));'),
        expect: { code: 'E0502', line: 13 },
        why: '`is_dead(&self)` borrows the whole of `*s`, so the closure needs R of `s.q`, which `retain` has already borrowed `&mut`: a signature wider than what the body reads.',
        focus: { line: 13, path: 's', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('field-test', 13, '    s.q.retain(|x| !s.dead.contains(x));', 'Naming the field lets the checker see that the closure reads only `s.dead`, while `retain` writes `s.q`.'),
          wrong('assoc-call', 13, '    s.q.retain(|x| !Sched::is_dead(s, x));', 'Calling the method as a function still passes the whole `&Sched`, which overlaps the `&mut` borrow of `s.q`.', 'r.method-borrows-the-field'),
          wrong('reborrow-s', 13, '    s.q.retain(|x| !(&*s).is_dead(x));', 'A reborrow of `*s` is still a `&` of the whole struct, which overlaps the `&mut` borrow of `s.q`.', 'r.method-borrows-the-field'),
        ],
      },
      {
        id: 'len-in-retain',
        edit: at(13, '    s.q.retain(|x| { s.q.len(); true });'),
        expect: { code: 'E0502', line: 13 },
        why: '`retain` holds `s.q` `&mut` while it runs, so the closure cannot read `s.q.len()`: the list could change under it.',
        focus: { line: 13, path: 's.q', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'shared-sched',
        edit: at(12, 'fn gc(s: &Sched) {'),
        expect: { code: 'E0596', line: 13 },
        why: 'Through a `&Sched`, `s.q` has R but no W, and `retain` borrows it `&mut`, which needs W.',
        focus: { line: 13, path: 's.q', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'cursor-last-node',
    kcs: [AL, BR],
    title: 'Walk a request chain to its last link',
    domain: 'Request',
    base: rs`
      struct Node {
          id: u32,
          next: Option<Box<Node>>,
      }

      fn last(mut cur: &mut Node) -> &mut Node {
          while let Some(ref mut n) = cur.next {
              cur = n;
          }
          cur
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`ref mut n` borrows the field `cur.next` directly, so when the loop stops there is no borrow left and `cur` can be returned.',
      },
      {
        id: 'as-mut',
        edit: at(7, '    while let Some(n) = cur.next.as_mut() {'),
        expect: { code: 'E0499', line: 10 },
        why: 'Calling `as_mut()` takes a `&mut` borrow of `cur.next` that the checker keeps alive past the loop, so returning `cur` on line 10 looks like a second `&mut`, although the borrow is dead when the loop stops: a safe program the analyzer rejects.',
        fixes: [
          good('ref-mut', 7, '    while let Some(ref mut n) = cur.next {', 'The pattern borrows the field itself, with no call in between, and the borrow checker sees that it ends with the loop.'),
          wrong('deref-mut', 7, '    while let Some(n) = &mut cur.next {', 'It borrows `cur.next` with a `&mut` expression, which the checker keeps alive past the loop in just the same way.', 'r.method-borrows-the-field'),
          wrong('take-next', 7, '    while let Some(n) = cur.next.take() {', '`take` empties the field and hands back an owned `Box`, not a borrow of the next node, so `cur = n` no longer type-checks.', 'r.deref-moves-out'),
        ],
      },
      {
        id: 'frozen-cursor',
        edit: at(6, 'fn last(cur: &mut Node) -> &mut Node {'),
        expect: { code: 'E0384', line: 8 },
        why: '`cur` is not declared `mut`, so the binding has no W after its first value, and `cur = n` assigns to it: this changes which node `cur` points at, not the node.',
        focus: { line: 8, path: 'cur', needs: ['write'] },
        permission: 'write',
        fixes: [
          good('mut-binding', 6, 'fn last(mut cur: &mut Node) -> &mut Node {', 'The `mut` on the binding gives `cur` W, so it can be pointed at the next node.'),
          wrong('assign-through', 8, '        *cur = n;', 'This writes into the node `cur` points at, instead of pointing `cur` at the next node, and `n` is not a `Node`.', 'r.mut-binding-vs-mut-ref'),
          wrong('shared-ref', 6, 'fn last(cur: &Node) -> &mut Node {', 'A `&Node` cannot be returned as a `&mut Node`, and a binding not declared `mut` still cannot be reassigned.', 'r.mut-binding-vs-mut-ref'),
        ],
      },
    ],
  },

  {
    id: 'above-min-iter',
    kcs: [LT],
    title: 'Return the blocks above a minimum size',
    domain: 'BlockPool',
    base: rs`
      fn above(
          v: &[u32],
          min: u32,
      ) -> impl Iterator<Item = &u32> {
          v.iter().filter(move |x| **x > min)
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The iterator borrows `v`, which the caller owns, and `move` copies `min` into the closure, so nothing it holds is local to `above`.',
      },
      {
        id: 'no-move',
        edit: at(5, '    v.iter().filter(|x| **x > min)'),
        expect: { code: 'E0373', line: 5 },
        why: 'Without `move` the closure borrows the parameter `min`, which is dropped when `above` returns, but the iterator is handed to the caller.',
        fixes: [
          good('add-move', 5, '    v.iter().filter(move |x| **x > min)', '`move` copies the `u32` into the closure, so the iterator carries its own `min` out of the function.'),
          lure('clone', 'clone-min', 5, '    v.iter().filter(|x| **x > min.clone())', 'The clone is made when the closure runs, and the closure still borrows `min` to reach it: the borrow, and the error, remain.'),
          wrong('ref-min', 5, '    v.iter().filter(|x| **x > *&min)', 'Writing the use through a reference changes nothing: the closure still borrows the local `min`.', 'r.move-is-optional'),
        ],
      },
      {
        id: 'owned-copy',
        edit: at(5, '    v.to_vec().iter().filter(|x| **x > 1)'),
        expect: { code: 'E0515', line: 5 },
        why: '`to_vec()` builds a temporary `Vec` that `above` owns and drops on return, and the iterator handed back points into it.',
      },
      {
        id: 'by-value',
        edit: at(2, '    v: Vec<u32>,'),
        expect: { code: 'E0106', line: 4 },
        why: 'With `v` taken by value there is no input lifetime for the returned `&u32` to borrow from, so the signature has nothing to name.',
      },
    ],
  },

  {
    id: 'job-ref-thread',
    kcs: [LT, OM],
    title: 'Start a thread from a borrowed job',
    domain: 'Worker',
    base: rs`
      use std::thread;

      struct Job {
          id: u32,
      }

      fn start(j: &Job) {
          let id = j.id;
          thread::spawn(move || id);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`id` is a copy of a `u32`, and `move` hands it to the thread, so the thread needs nothing from the borrowed `Job`.',
      },
      {
        id: 'capture-ref',
        edit: at(9, '    thread::spawn(move || j.id);'),
        expect: { code: 'E0521', line: 9 },
        why: '`move` hands the reference `j` to the thread, but `j` is only valid while the caller\'s `Job` is, and the thread may outlive it.',
        fixes: [
          good('copy-id', 9, '    thread::spawn(move || id);', 'The thread gets a copy of the `u32` read on line 8, so it does not depend on the caller\'s `Job`.'),
          lure('other', 'static-job', 7, 'fn start(j: &\'static Job) {', 'It compiles, but callers can now pass only a `Job` that lives for the whole program, not one they built.', 'r.static-to-silence'),
          wrong('deref-j', 9, '    thread::spawn(move || (*j).id);', 'Writing the dereference out changes nothing: `move` still hands the reference `j` to the thread.', 'r.move-is-optional'),
        ],
      },
      {
        id: 'ref-field',
        edit: at(8, '    let id = &j.id;'),
        expect: { code: 'E0521', line: 9 },
        why: '`id` now borrows from `j`, and `move` hands that borrow to a thread that may outlive the caller\'s `Job`.',
      },
      {
        id: 'no-move',
        edit: at(9, '    thread::spawn(|| id);'),
        expect: { code: 'E0373', line: 9 },
        why: 'Without `move` the closure borrows the local `id`, which is dropped when `start` returns, but the thread may still be running.',
        fixes: [
          good('add-move', 9, '    thread::spawn(move || id);', '`move` copies the `u32` into the closure, so the thread carries its own `id`.'),
          lure('clone', 'clone-id', 9, '    thread::spawn(|| id.clone());', 'The clone is made inside the thread, which still borrows `id` to reach it: the borrow, and the error, remain.'),
          wrong('ref-id', 9, '    thread::spawn(|| &id);', 'Returning a reference changes what the thread yields, not what it borrows: the closure still depends on the local `id`.', 'r.move-is-optional'),
        ],
      },
    ],
  },

  {
    id: 'take-from-cell-queue',
    kcs: [IM, OM],
    title: 'Take the first request from a shared queue',
    domain: 'Scheduler',
    base: rs`
      use std::cell::RefCell;
      type Q = RefCell<Vec<String>>;

      fn take(c: &Q) -> String {
          c.borrow_mut().remove(0)
      }
    `,
    variants: [
      {
        id: 'index-move',
        edit: at(5, '    c.borrow()[0]'),
        expect: { code: 'E0507', line: 5 },
        why: 'A `Ref` lends the vector with R only, so `[0]` has R but no O, and returning the `String` by value moves it out, which needs O.',
        focus: { line: 5, path: 'c.borrow()[0]', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'ref-remove',
        edit: at(5, '    c.borrow().remove(0)'),
        expect: { code: 'E0596', line: 5 },
        why: 'A `Ref` from `borrow()` lends the vector with R only, like `&`, and `remove` borrows it `&mut`, which needs W: only `borrow_mut` hands out W.',
        focus: { line: 5, path: 'c.borrow()', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'into-inner',
        edit: at(5, '    c.into_inner().remove(0)'),
        expect: { code: 'E0507', line: 5 },
        why: '`into_inner` takes the `RefCell` by value, so it needs O of `*c`, and a `&Q` gives R only.',
        focus: { line: 5, path: 'c', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'mut-cell',
        edit: at(5, '    c.get_mut().remove(0)'),
        expect: { code: 'E0596', line: 5 },
        why: '`get_mut` takes `&mut self`, so it needs W of `*c`, and a `&Q` gives R only: a `RefCell` is changed with `borrow_mut`, which needs only `&`.',
        focus: { line: 5, path: 'c', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'words-tied-to-self',
    kcs: [LT, SL],
    title: 'Split a prompt into words in a lexer',
    domain: 'Tokenizer',
    base: rs`
      struct Lexer<'a> { src: &'a str }

      impl<'a> Lexer<'a> {
          fn words(&self) -> Vec<&'a str> {
              self.src.split(' ').collect()
          }
      }

      fn run(t: String) -> usize {
          let w;
          {
              let lx = Lexer { src: &t };
              w = lx.words();
          }
          w.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`words` returns `&\'a str`, tied to the text, not to the `&self` borrow, so the words stay valid after `lx` is dropped.',
      },
      {
        id: 'tied-to-self',
        edit: at(4, '    fn words(&self) -> Vec<&str> {'),
        expect: { code: 'E0597', line: 13 },
        why: 'Elision ties the returned words to the `&self` borrow, so they live only as long as `lx`, which is dropped on line 14, but `w` is read on line 15.',
        fixes: [
          good('name-a', 4, '    fn words(&self) -> Vec<&\'a str> {', 'Naming `\'a` ties the words to the text the lexer holds, so they outlive the lexer.'),
          wrong('static-words', 4, '    fn words(&self) -> Vec<&\'static str> {', 'Promising `\'static` does not make the text live that long: `t` is still a local `String`.', 'r.static-to-silence'),
          wrong('tie-self', 4, '    fn words(&\'a self) -> Vec<&\'a str> {', 'Putting `\'a` on `&self` makes the borrow of the lexer as long as the text, so `lx` would have to outlive `t`.', 'r.named-lifetime-is-not-static'),
        ],
      },
      {
        id: 'temp-text',
        edit: at(12, '        let lx = Lexer { src: &t.clone() };'),
        expect: { code: 'E0716', line: 12 },
        why: 'The `&` in the `let` extends the cloned `String` to the end of the inner block (line 14), but `w` still borrows it and is read on line 15, so the temporary is gone too early.',
      },
      {
        id: 'drop-text',
        edit: at(15, '    drop(t); w.len()'),
        expect: { code: 'E0505', line: 15 },
        why: 'The words in `w` borrow `t` through the lexer and are read after `drop(t)`, so `t` has no O while the borrow lives, and `drop` moves it.',
        focus: { line: 15, path: 't', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('len-first', 15, '    let n = w.len(); drop(t); n', 'Reading the length first is the last use of `w`, so the borrow of `t` has ended and `t` has O again at `drop`.'),
          lure('clone', 'clone-drop', 15, '    let _ = drop(t.clone()); w.len()', 'It compiles because only a copy is dropped: `t` stays alive, so the memory this was meant to release is still held.'),
          lure('other', 'drop-ref', 15, '    drop(&t); w.len()', 'It compiles because dropping a reference does nothing: `t` is still alive and the borrow was never the problem.', 'r.drop-a-reference'),
        ],
      },
    ],
  },

  {
    id: 'drain-locked-queue',
    kcs: [IM, OM],
    title: 'Drain the queue behind a lock',
    domain: 'Metrics',
    base: rs`
      use std::sync::Mutex;

      fn drain(m: &Mutex<Vec<u32>>) -> Vec<u32> {
          std::mem::take(&mut *m.lock().unwrap())
      }
    `,
    variants: [
      {
        id: 'move-guard',
        edit: at(4, '    *m.lock().unwrap()'),
        expect: { code: 'E0507', line: 4 },
        why: 'Through the guard, the vector has R and W but no O, and returning `*guard` by value moves it out, which needs O.',
        focus: { line: 4, path: '*m.lock().unwrap()', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('take', 4, '    std::mem::take(&mut *m.lock().unwrap())', '`take` leaves an empty vector behind and hands over the old one, so the lock still guards a valid value and no O is needed.'),
          lure('clone', 'clone-all', 4, '    m.lock().unwrap().clone()', 'It compiles because it returns a copy, but the queue still holds every request, so they would be drained again by the next caller.'),
          wrong('deref-twice', 4, '    **m.lock().unwrap()', 'A second dereference reaches a slice, which has no size known at compile time and cannot be returned by value.', 'r.deref-moves-out'),
        ],
      },
      {
        id: 'into-inner',
        edit: at(4, '    m.into_inner().unwrap()'),
        expect: { code: 'E0507', line: 4 },
        why: '`into_inner` takes the `Mutex` by value, so it needs O of `*m`, and a `&Mutex` gives R only.',
        focus: { line: 4, path: 'm', needs: ['read', 'own'] },
        permission: 'own',
      },
    ],
  },

  {
    id: 'peek-while-writing',
    kcs: [IM],
    title: 'Record the queue length in the queue',
    domain: 'PrefixCache',
    run: true,
    base: rs`
      use std::cell::RefCell;

      fn main() {
          let q = RefCell::new(vec![1, 2]);
          let n = q.borrow().len();
          q.borrow_mut().push(n);
          println!("{:?}", q.borrow());
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The `Ref` from line 5 is a temporary dropped at the end of that line, so the cell is free when `borrow_mut` runs on line 6.',
      },
      {
        id: 'extend-n',
        edit: at(6, '    q.borrow_mut().extend([n, n]);'),
        expect: 'compiles',
        why: 'The array is built from `n`, a copy of the length taken on line 5, so no `borrow()` runs while the `RefMut` of the receiver is alive.',
      },
      {
        id: 'both-mut',
        edit: at(6, '    (q.borrow_mut(), q.borrow_mut());'),
        expect: { code: 'BorrowMutError', line: 6 },
        why: 'The tuple builds its fields in order, so the first `RefMut` is alive when the second `borrow_mut()` runs and finds the cell already mutably borrowed.',
      },
      {
        id: 'push-len',
        edit: at(6, '    q.borrow_mut().push(q.borrow().len());'),
        expect: { code: 'BorrowError', line: 6 },
        why: 'The receiver `q.borrow_mut()` runs first and its `RefMut` lives to the end of the statement, so `borrow()` in the argument finds the cell mutably borrowed: R is taken while `&mut` lives.',
        fixes: [
          good('let-first', 6, '    q.borrow_mut().push(n);', 'The length was read on line 5 and its `Ref` is gone, so `push` finds the cell free.'),
          lure('other', 'push-zero', 6, '    q.borrow_mut().push(0);', 'It compiles and stops the panic, but it pushes 0 instead of the length that line 5 recorded.'),
          wrong('index-first', 6, '    q.borrow_mut().push(q.borrow()[0]);', 'Reading an element instead of the length changes nothing: `borrow()` still runs while the receiver\'s `RefMut` is alive.', 'r.two-phase-for-cells'),
        ],
      },
      {
        id: 'ref-push',
        edit: at(6, '    q.borrow().push(n);'),
        expect: { code: 'E0596', line: 6 },
        why: 'A `Ref` from `borrow()` lends the vector with R only, like `&`, and `push` needs W: only `borrow_mut` hands out W.',
        focus: { line: 6, path: 'q.borrow()', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'lease-returns-block',
    kcs: [AL, BR],
    title: 'Lease a block and return it when done',
    domain: 'BlockPool',
    base: rs`
      struct Lease<'a> {
          pool: &'a mut Vec<u32>,
          id: u32,
      }

      impl Drop for Lease<'_> {
          fn drop(&mut self) {
              self.pool.push(self.id);
          }
      }

      fn run(pool: &mut Vec<u32>) {
          let l = Lease { pool, id: 1 };
          println!("{}", l.id);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`l` holds the only `&mut` borrow of `*pool` until its `drop` runs at the end of `run`, and nothing else touches the pool meanwhile.',
      },
      {
        id: 'use-pool',
        edit: at(14, '    println!("{}", pool.len());'),
        expect: { code: 'E0502', line: 14 },
        why: '`l` has `*pool` borrowed `&mut` until its `drop` runs at the end of `run`, which takes R from `pool`, and `pool.len()` needs R.',
        focus: { line: 14, path: 'pool', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('drop-first', 14, '    drop(l); println!("{}", pool.len());', 'Moving `l` into `drop` ends the lease on the spot, so `pool` has R again, and the block is back in the pool.'),
          lure('clone', 'clone-pool', 14, '    println!("{}", pool.clone().len());', 'The clone still reads `pool` to make the copy, which the lease has borrowed `&mut`, so the same conflict remains.'),
          wrong('drop-lease-ref', 14, '    drop(&l); println!("{}", pool.len());', 'Dropping a reference does nothing: `l` still holds its `&mut` borrow of `*pool` until the end of `run`.', 'r.drop-a-reference'),
        ],
      },
      {
        id: 'drop-pool',
        edit: at(14, '    drop(pool);'),
        expect: { code: 'E0505', line: 14 },
        why: '`l` borrows `*pool` until its `drop` runs, so `pool` has no O while the lease lives, and `drop(pool)` moves it.',
        focus: { line: 14, path: 'pool', needs: ['own'] },
        permission: 'own',
      },
      {
        id: 'move-field',
        edit: at(14, '    let m = l.pool; m.push(2);'),
        expect: { code: 'E0509', line: 14 },
        why: '`Lease` implements `Drop`, so its fields cannot be moved out: `l.pool` has R but no O, since `drop` needs the whole `Lease` intact (and `l` is not declared `mut`, so it has no W either).',
        focus: { line: 14, path: 'l.pool', needs: ['read', 'own'] },
        permission: 'own',
      },
    ],
  },

  {
    id: 'cap-static-ref',
    kcs: [LT],
    title: 'Return a reference to the admission cap',
    domain: 'Scheduler',
    base: rs`
      const MAX: u32 = 8;

      fn cap(extra: u32) -> &'static u32 {
          let _ = extra;
          &(MAX * 2)
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`MAX * 2` is a constant expression, which rustc promotes to a `\'static` value, so a reference to it can be returned.',
      },
      {
        id: 'param-sum',
        edit: at(5, '    &(MAX + extra)'),
        expect: { code: 'E0515', line: 5 },
        why: '`MAX + extra` depends on a parameter, so it is a temporary of `cap`, dropped on return, and the reference would outlive it.',
      },
      {
        id: 'local-block',
        edit: at(5, '    { let n = MAX * 2; &n }'),
        expect: { code: 'E0515', line: 5 },
        why: '`n` is a local of `cap`, dropped on return, so a reference to it cannot be returned: only a constant expression is promoted to `\'static`.',
      },
      {
        id: 'const-call',
        edit: at(5, '    &MAX.pow(2)'),
        expect: { code: 'E0515', line: 5 },
        why: 'A method call is not promoted to `\'static`, even when its inputs are constants: `pow` builds a temporary dropped on return.',
      },
    ],
  },

  {
    id: 'walk-radix-chain',
    kcs: [IM, BR],
    title: 'Count the links of a radix chain',
    domain: 'PrefixCache',
    base: rs`
      use std::{cell::RefCell, rc::Rc};
      type H = Rc<RefCell<Node>>;
      struct Node { next: Option<H> }

      fn len(mut cur: H) -> usize {
          let mut n = 1;
          loop {
              let nx = cur.borrow().next.clone();
              match nx {
                  Some(x) => cur = x,
                  None => return n,
              }
              n += 1;
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The `Ref` from `borrow()` is a temporary dropped at the end of line 8, so `cur` is no longer borrowed when line 10 assigns to it.',
      },
      {
        id: 'match-borrow',
        edit: at(9, '        match cur.borrow().next.clone() {'),
        expect: { code: 'E0506', line: 10 },
        why: 'The temporary `Ref` in a `match` scrutinee lives to the end of the `match`, so `cur` is still borrowed, and has no W, when line 10 assigns to it.',
        focus: { line: 10, path: 'cur', needs: ['write'] },
        permission: 'write',
        fixes: [
          good('bind-first', 9, '        match nx {', 'The `Ref` ended with line 8, so `match` only looks at an owned handle and `cur` can be reassigned.'),
          wrong('match-nx-ref', 9, '        match &nx {', 'The `Ref` is already gone, but `x` would now be a `&H`, not the `H` that `cur` holds.', 'r.borrow-view-is-not-a-copy'),
          wrong('match-as-ref', 9, '        match cur.borrow().next.as_ref() {', 'The `Ref` still lives to the end of the `match`, and `x` would now be a `&H`, not the `H` that `cur` holds.', 'r.temporary-lives-in-the-let'),
        ],
      },
      {
        id: 'frozen-cur',
        edit: at(5, 'fn len(cur: H) -> usize {'),
        expect: { code: 'E0384', line: 10 },
        why: '`cur` is not declared `mut`, so the binding has no W after its first value, and `cur = x` assigns to it.',
        focus: { line: 10, path: 'cur', needs: ['write'] },
        permission: 'write',
      },
      {
        id: 'move-next',
        edit: at(8, '        let nx = cur.borrow().next;'),
        expect: { code: 'E0507', line: 8 },
        why: 'A `Ref` lends the node with R only, so `nx` has R but no O, and `let nx = …` moves the `Option` out, which needs O.',
        focus: { line: 8, path: 'cur.borrow().next', needs: ['read', 'own'] },
        permission: 'own',
      },
    ],
  },

  {
    id: 'fill-halves-scoped',
    kcs: [AL, SL],
    title: 'Fill the two halves of a batch in threads',
    domain: 'Batch',
    base: rs`
      fn fill(v: &mut [u32]) {
          let (a, b) = v.split_at_mut(2);
          std::thread::scope(|s| {
              s.spawn(|| a[0] = 1);
              s.spawn(|| b[0] = 2);
          });
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`split_at_mut` hands out two `&mut` slices that cannot overlap, and scoped threads end before `fill` returns, so each thread may borrow one half.',
      },
      {
        id: 'same-half',
        edit: at(5, '        s.spawn(|| a[1] = 2);'),
        expect: { code: 'E0499', line: 5 },
        why: 'The first closure holds `a` `&mut` until the scope ends, and the second closure needs another `&mut` borrow of it: two threads would write one half.',
        fixes: [
          good('use-b', 5, '        s.spawn(|| b[0] += 2);', '`b` is the other half, so the two threads write different blocks and the borrows do not overlap.'),
          wrong('use-v', 5, '        s.spawn(|| v[3] = 2);', '`a` and `b` still borrow all of `v` `&mut`, and the closure needs unique access to `*v` while they live.', 'r.disjoint-index-is-not-disjoint'),
          wrong('move-a', 5, '        s.spawn(move || a[1] = 2);', '`move` would move `a` into the second thread, but the first closure already borrows it.', 'r.move-is-optional'),
        ],
      },
      {
        id: 'plain-spawn',
        edit: at(4, '        std::thread::spawn(|| a[0] = 1);'),
        expect: { code: 'E0521', line: 4 },
        why: 'A thread from `std::thread::spawn` can outlive `fill`, but `a` borrows from the caller\'s `v`, so the borrowed data would escape the function; only `s.spawn` inside the scope may.',
      },
      {
        id: 'shared-v',
        edit: at(1, 'fn fill(v: &[u32]) {'),
        expect: { code: 'E0596', line: 2 },
        why: 'Through a `&[u32]`, `v` has R but no W, and `split_at_mut` borrows it `&mut`, which needs W.',
        focus: { line: 2, path: 'v', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'bump-hot-slots',
    kcs: [BR],
    title: 'Bump the two hottest slots, then append',
    domain: 'BlockPool',
    base: rs`
      fn bump(v: &mut Vec<u32>) {
          let mut hot: Vec<&mut u32> =
              v.iter_mut().take(2).collect();
          for h in hot.iter_mut() { **h += 1; }
          v.push(0);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`hot` holds `&mut` borrows into `v`, but its last use is line 4, so `v` has W back when `push` needs it on line 5.',
      },
      {
        id: 'use-hot-after',
        edit: at(5, '    v.push(hot.len() as u32);'),
        expect: { code: 'E0499', line: 5 },
        why: '`hot` borrows `v` `&mut` and is read on line 5, so `v` has lost R and W while `push` needs a second `&mut` borrow of it.',
        fixes: [
          good('push-const', 5, '    v.push(0);', 'Nothing reads `hot` after line 4, so its borrows are over and `push` gets W back.'),
          wrong('count-hot', 5, '    v.push(hot.iter().count() as u32);', 'Counting through an iterator still reads `hot`, so its `&mut` borrows of `v` are alive when `push` needs W.', 'r.disjoint-index-is-not-disjoint'),
          wrong('read-hot', 5, '    v.push(*hot[0] + 1);', 'Reading through `hot[0]` is a use of the `&mut` borrows, so `v` is still borrowed when `push` needs W.', 'r.disjoint-index-is-not-disjoint'),
        ],
      },
      {
        id: 'shared-v',
        edit: at(1, 'fn bump(v: &Vec<u32>) {'),
        expect: { code: 'E0596', line: 3 },
        why: 'Through a `&Vec<u32>`, `v` has R but no W, and `iter_mut` borrows it `&mut`, which needs W.',
        focus: { line: 3, path: 'v', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },
]
