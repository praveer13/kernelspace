/**
 * The `moves` group of the compile bank (docs/specs/wave-2.md §15.5, task 2c-11): about 50 snippets on
 * moves, clones and drops, in the names of the serving stack (requests, batches, schedulers, block
 * tables, sessions). Most bases compile; a few start from the buggy code, so that the fixes are the
 * lesson. Every other variant is a one-line edit whose first error rustc 1.96.0 confirms (E0382 use
 * after move, E0505 move while borrowed, E0507 move out of a borrow, and their neighbours E0381,
 * E0384, E0508 and E0509), or a one-line edit that still compiles. About a quarter of the variants
 * compile, which keeps "compiles" from being a cue in the verdict items.
 *
 * Whys follow Crichton's permissions (see ../types.ts): a path holds Read (R), Write (W) and Own (O); a
 * move removes all three from the source; `&` removes W and O while the borrow lives; `&mut` removes R
 * as well. A fix that adds `.clone()` is the clone lure: it usually compiles, and its why says what it
 * copies and why that is not what the code meant.
 *
 * Fix sets are written so that no surface feature gives the key away (the cue gate of verify-generators):
 * the right fix is sometimes the shortest option, sometimes the longest, and shares its punctuation
 * (parentheses, a closing semicolon) with at least one wrong fix. Wrong fixes are therefore real slips
 * a learner makes (a `*` that moves, a `mut` that cures nothing, a derive that is not Copy), not filler.
 */

import { KC } from '@/data/kc/ids'
import { rs, type RustSnippet, type SnippetFix } from '../types'

const OM = KC.ownershipMoves
const BR = KC.borrowRules
const CCD = 'r.clone-copy-drop'
const CLONE_MISS = 'r.clone-to-silence'

/** Misconceptions a wrong fix records when a learner picks it (a clone lure records `r.clone-to-silence` by default). */
const MISS = {
  /** `let b = a` leaves `a` usable, as a Java or Python reference would. */
  alias: 'r.assign-aliases',
  /** Adding `mut`, or lending `&mut`, is taken to cure any borrow-check error. */
  mutCures: 'r.mut-cures-error',
  /** `*r` is taken to take the value out of a reference. */
  derefMoves: 'r.deref-moves-out',
  /** Dropping, or ending a scope early, is taken to end a borrow that is still used later. */
  dropEnds: 'r.drop-ends-borrow',
  /** `&` is added wherever the checker complains, whatever type the callee wants. */
  refEverywhere: 'r.ref-fixes-all',
  /** A method that takes `self` is taken to borrow. */
  selfBorrows: 'r.self-method-borrows',
  /** Changing what the code returns is taken to be a fix. */
  changesBehaviour: 'r.fix-changes-meaning',
  /** Any derive is taken to give the trait the code needs, as if `Debug` or `PartialEq` made a type Copy. */
  wrongDerive: 'r.derive-wrong-trait',
  /** A std function is reached for with the wrong arguments, or one that needs a trait the type lacks. */
  apiSlip: 'r.std-api-slip',
} as const

const at = (line: number, text: string) => ({ line, text })
/** The one fix that compiles and keeps what the code does. */
const good = (id: string, line: number, text: string, why: string): SnippetFix => ({ id, edit: at(line, text), ok: true, why })
/** A wrong fix that rustc rejects. */
const bad = (id: string, line: number, text: string, why: string, miss?: string): SnippetFix => ({ id, edit: at(line, text), ok: false, why, ...(miss ? { miss } : {}) })
/** A wrong fix that adds `.clone()`: it usually compiles, and copies what the code meant to move or share. */
const cloned = (id: string, line: number, text: string, why: string): SnippetFix => ({ id, edit: at(line, text), ok: false, lure: 'clone', why })
/** A wrong fix that compiles and changes what the code does, without a clone. */
const drift = (id: string, line: number, text: string, why: string, miss: string = MISS.changesBehaviour): SnippetFix => ({ id, edit: at(line, text), ok: false, lure: 'other', why, miss })

export const SNIPPETS: RustSnippet[] = [
  {
    id: 'queue-for-loop-consumes',
    kcs: [OM, CCD],
    title: 'Count the queue by bytes, then by length',
    domain: 'Scheduler',
    base: rs`
      #[derive(Clone)]
      struct Request {
          id: u64,
          prompt: String,
      }

      fn drain(queue: Vec<Request>) -> usize {
          let mut bytes = 0;
          for r in &queue {
              bytes += r.prompt.len();
          }
          println!("{bytes} bytes");
          queue.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`for r in &queue` only borrows the vector, so `queue` keeps R and O and `queue.len()` on line 13 can read it.',
      },
      {
        id: 'consume-loop',
        edit: { line: 9, text: '    for r in queue {' },
        expect: { code: 'E0382', line: 13 },
        why: '`for r in queue` calls `into_iter`, which moves the vector into the loop, so `queue` has no R, W or O left; `queue.len()` on line 13 needs R.',
        focus: { line: 13, path: 'queue', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('borrow-loop', 9, '    for r in &queue {', 'Looping over `&queue` lends R for the loop only, so `queue` still owns its requests afterwards.'),
          cloned('clone-queue', 9, '    for r in queue.clone() {', 'It copies every request, prompt strings included, to feed a loop that only reads them.'),
          bad('mut-loop', 9, '    for r in &mut queue {', '`queue` is not declared `mut`, so it has no W to lend; and a `&mut` borrow would be wider than a read-only loop needs.', MISS.mutCures),
          drift('skip-len', 13, '    0', 'Nothing reads `queue` after the loop any more, so it compiles, but it returns 0 instead of the number of queued requests.'),
        ],
      },
      {
        id: 'into-iter-loop',
        edit: { line: 9, text: '    for r in queue.into_iter() {' },
        expect: { code: 'E0382', line: 13 },
        why: 'An explicit `into_iter()` takes the vector by value, exactly as the bare `for r in queue` does, so `queue` has no R left for `queue.len()` on line 13.',
        focus: { line: 13, path: 'queue', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'move-field',
        edit: { line: 10, text: '        let p = r.prompt;' },
        expect: { code: 'E0507', line: 10 },
        why: '`r` is a `&Request` borrowed from the vector, so `r.prompt` has R but no O; `let p = r.prompt` moves the string out, which needs O.',
        focus: { line: 10, path: 'r.prompt', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('borrow-prompt', 10, '        let p = &r.prompt;', 'A `&String` needs only R, which `r.prompt` has, and the request keeps its prompt.'),
          cloned('clone-prompt', 10, '        let p = r.prompt.clone();', 'It copies the whole prompt to look at it, and the copy is dropped at the end of each pass.'),
          bad('consume-bytes', 10, '        let p = r.prompt.into_bytes();', '`into_bytes` takes the `String` by value, which needs O, so the move out of `r.prompt` is still there.', MISS.selfBorrows),
          bad('deref-prompt', 10, '        let p = *r.prompt;', 'Dereferencing a `String` gives a `str`, whose size is unknown, so it cannot be bound by value.', MISS.derefMoves),
        ],
      },
    ],
  },

  {
    id: 'request-handoff-let',
    kcs: [OM],
    title: 'Hand a request to the queue, then touch the old name',
    domain: 'Request',
    base: rs`
      #[derive(Clone)]
      struct Request {
          id: u64,
          prompt: String,
          done: bool,
      }

      fn stage(mut req: Request) -> Request {
          let mut queued = req;
          println!("staged {}", queued.id);
          queued
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`let mut queued = req` moves the request, and from line 10 on the code touches only `queued`, which holds R, W and O.',
      },
      {
        id: 'read-moved',
        edit: { line: 10, text: '    println!("staged {}", req.id);' },
        expect: { code: 'E0382', line: 10 },
        why: 'Line 9 moved `req` into `queued`, so `req` lost R, W and O; reading `req.id` for the print needs R, even though a `u64` is cheap.',
        focus: { line: 10, path: 'req.id', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('read-queued', 10, '    println!("staged {}", queued.id);', 'The request lives in `queued` now, and `queued` holds the R this read needs.'),
          cloned('clone-req', 9, '    let mut queued = req.clone();', 'It copies the prompt string only so that `req` stays readable for one print.'),
          bad('borrow-req', 9, '    let mut queued = &req;', 'It stops the move, but `queued` becomes a `&Request`, and the function returns a `Request`.', MISS.refEverywhere),
          bad('into-req', 9, '    let mut queued = req.into();', '`into` takes `req` by value, so it moves it just as the plain `let` did.', MISS.alias),
        ],
      },
      {
        id: 'write-moved',
        edit: { line: 10, text: '    req.done = true;' },
        expect: { code: 'E0382', line: 10 },
        why: 'Line 9 moved `req`, so it has no W left; assigning `req.done` needs W, and `mut` on the parameter cannot bring the value back.',
        focus: { line: 10, path: 'req.done', needs: ['write'] },
        permission: 'write',
        fixes: [
          good('write-queued', 10, '    queued.done = true;', '`queued` owns the request now and was declared `mut`, so it holds the W the assignment needs.'),
          cloned('clone-req', 9, '    let mut queued = req.clone();', 'The assignment now lands on `req`, the original, while the returned `queued` is a copy that never sees `done = true`.'),
          bad('borrow-req', 9, '    let mut queued = &req;', 'It stops the move, but `queued` becomes a `&Request`, and the function returns a `Request`.', MISS.refEverywhere),
        ],
      },
      {
        id: 'move-twice',
        edit: { line: 10, text: '    let again = req;' },
        expect: { code: 'E0382', line: 10 },
        why: 'The first `let` moved `req`, so a second move on line 10 needs R and O that `req` no longer holds.',
      },
    ],
  },

  {
    id: 'prefill-consumes-request',
    kcs: [OM],
    title: 'Take the prompt out of a request',
    domain: 'Request',
    base: rs`
      #[derive(Clone)]
      struct Request { id: u64, prompt: String }

      impl Request {
          fn into_prompt(self) -> String {
              self.prompt
          }
      }

      fn prefill(req: Request) -> usize {
          let id = req.id;
          let p = req.into_prompt();
          id as usize + p.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Line 11 copies the `u64` id out before line 12 consumes `req`, and nothing touches `req` afterwards.',
      },
      {
        id: 'read-after-consume',
        edit: { line: 13, text: '    req.id as usize + p.len()' },
        expect: { code: 'E0382', line: 13 },
        why: '`into_prompt` takes `self` by value, so the call on line 12 moved `req`; reading `req.id` on line 13 needs R.',
        focus: { line: 13, path: 'req.id', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('use-copied-id', 13, '    id as usize + p.len()', 'Line 11 already holds a copy of the id, so line 13 reads nothing of `req`.'),
          cloned('clone-req', 12, '    let p = req.clone().into_prompt();', 'It copies the whole request, prompt included, and consumes the copy, only to keep `req.id` readable.'),
          bad('ref-result', 12, '    let p = &req.into_prompt();', 'The `&` borrows the returned string; the call still takes `req` by value and moves it.', MISS.selfBorrows),
          drift('length-only', 13, '    p.len()', 'It compiles because nothing reads `req` any more, but the result no longer includes the id.'),
        ],
      },
      {
        id: 'consume-twice',
        edit: { line: 13, text: '    id as usize + req.into_prompt().len()' },
        expect: { code: 'E0382', line: 13 },
        why: 'A second `into_prompt` call needs `req` by value again, but the first call on line 12 already moved it.',
      },
      {
        id: 'borrow-self',
        edit: { line: 5, text: '    fn into_prompt(&self) -> String {' },
        expect: { code: 'E0507', line: 6 },
        why: 'With `&self`, `self.prompt` has R but no O, and returning it by value moves it out, which needs O.',
        focus: { line: 6, path: 'self.prompt', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('take-self', 5, '    fn into_prompt(self) -> String {', 'Taking `self` by value gives the method O of the whole request, so it can move the prompt out.'),
          cloned('clone-prompt', 6, '        self.prompt.clone()', 'It copies the prompt on every call, and the caller keeps a request it no longer needs.'),
          bad('mut-self', 5, '    fn into_prompt(&mut self) -> String {', '`&mut self` still borrows: it adds W, but O stays with the caller, so the method cannot move the prompt out.', MISS.mutCures),
          bad('deref-prompt', 6, '        *self.prompt', 'Dereferencing a `String` gives an unsized `str`, not the `String` the method returns.', MISS.derefMoves),
        ],
      },
    ],
  },

  {
    id: 'label-unwrap-tag',
    kcs: [OM],
    title: 'Label a request by its optional tag',
    domain: 'Request',
    base: rs`
      #[derive(Clone)]
      struct Request {
          id: u64,
          tag: Option<String>,
      }

      fn label(r: &Request) -> String {
          let t = r.tag.as_deref().unwrap_or("-");
          format!("{}:{}", r.id, t)
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`as_deref` views the tag as a `&str` for the length of the call: it needs only R, which `r.tag` has through the `&Request`.',
      },
      {
        id: 'unwrap-through-ref',
        edit: { line: 8, text: '    let t = r.tag.unwrap();' },
        expect: { code: 'E0507', line: 8 },
        why: '`Option::unwrap` takes the option by value, which needs O of `r.tag`; through a `&Request` the field has R but no O.',
        focus: { line: 8, path: 'r.tag', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('as-deref', 8, '    let t = r.tag.as_deref().unwrap();', 'It unwraps a view of the tag, an `Option<&str>`, which needs only R.'),
          cloned('clone-tag', 8, '    let t = r.tag.clone().unwrap();', 'It copies the tag string to own a value this function only prints.'),
          bad('deref-request', 8, '    let t = (*r).tag.unwrap();', '`(*r)` is the request itself, but still behind the reference; the field still has no O.', MISS.derefMoves),
          bad('take-tag', 8, '    let t = r.tag.take().unwrap().as_str();', '`take` needs `&mut` access to the tag, which needs W; a `&Request` gives only R.', MISS.mutCures),
        ],
      },
      {
        id: 'as-mut-unwrap',
        edit: { line: 8, text: '    let t = r.tag.as_mut().unwrap();' },
        expect: { code: 'E0596', line: 8 },
        why: 'Through a `&Request`, `r.tag` has R but no W, and `as_mut` borrows the option `&mut`.',
        focus: { line: 8, path: 'r.tag', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'unwrap-in-format',
        edit: { line: 9, text: '    format!("{}:{}", r.id, r.tag.unwrap())' },
        expect: { code: 'E0507', line: 9 },
        why: 'The `unwrap` still takes `r.tag` by value through the `&Request`, which needs the O the field lacks.',
        focus: { line: 9, path: 'r.tag', needs: ['read', 'own'] },
        permission: 'own',
      },
    ],
  },

  {
    id: 'sampling-copy-in-loop',
    kcs: [CCD, OM],
    title: 'Decode the same sampling settings every step',
    domain: 'SamplingParams',
    base: rs`
      #[derive(Clone, Copy)]
      struct Sampling {
          top_k: u32,
          temp: f32,
      }

      fn run(s: Sampling, steps: u32) {
          for _ in 0..steps {
              decode(s);
          }
      }

      fn decode(s: Sampling) -> u32 {
          s.top_k
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`Sampling` is Copy, so passing `s` copies its 8 bytes and `s` keeps R and O for the next pass.',
      },
      {
        id: 'no-copy',
        edit: { line: 1, text: '#[derive(Clone)]' },
        expect: { code: 'E0382', line: 9 },
        why: 'Without Copy, `decode(s)` moves `s` on the first pass, and the second pass finds a path with no R and no O.',
        fixes: [
          good('derive-copy', 1, '#[derive(Clone, Copy)]', 'Both fields are Copy, so the struct can be too; every call now copies 8 bytes and `s` stays whole.'),
          cloned('clone-call', 9, '        decode(s.clone());', 'It compiles and copies, but it writes the copy by hand at every call of a type that is cheap enough to be Copy.'),
          bad('borrow-call', 9, '        decode(&s);', '`decode` takes a `Sampling` by value, and a `&Sampling` is not one.', MISS.refEverywhere),
          bad('derive-eq', 1, '#[derive(Clone, PartialEq)]', '`PartialEq` lets two settings be compared; it does not let one be copied, so the second pass still finds a moved value.', MISS.wrongDerive),
        ],
      },
      {
        id: 'copy-twice',
        edit: { line: 9, text: '        decode(s) + decode(s);' },
        expect: 'compiles',
        why: 'A Copy value is copied, not moved, so two calls in one statement each get their own copy of `s`.',
      },
    ],
  },

  {
    id: 'closure-borrows-batch',
    kcs: [OM, BR],
    title: 'Count the batch through a closure',
    domain: 'Batch',
    base: rs`
      #[derive(Clone)]
      struct Batch {
          ids: Vec<u64>,
      }

      fn tally(batch: Batch) -> usize {
          let count = || batch.ids.len();
          let moved = &batch;
          count() + moved.ids.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The closure borrows `batch.ids` with `&`, and a second `&` borrow only needs R, so both can be alive at once.',
      },
      {
        id: 'move-batch',
        edit: { line: 8, text: '    let moved = batch;' },
        expect: { code: 'E0505', line: 8 },
        why: 'The closure `count` borrows `batch` and is used on line 9, so `batch` lost W and O until then; `let moved = batch` moves it, which needs O.',
        focus: { line: 8, path: 'batch', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('borrow-batch', 8, '    let moved = &batch;', 'A shared borrow needs only R, which `batch` still holds while the closure borrows it.'),
          cloned('clone-batch', 8, '    let moved = batch.clone();', 'It copies every id so that a second name can read what the closure already reads.'),
          bad('mut-batch', 8, '    let moved = &mut batch;', '`batch` is not declared `mut`, and a `&mut` borrow would also clash with the closure that is still alive.', MISS.mutCures),
          bad('move-closure', 7, '    let count = move || batch.ids.len();', 'A `move` closure takes `batch` itself, so line 8 then moves a value that is already gone.', MISS.dropEnds),
        ],
      },
      {
        id: 'move-closure',
        edit: { line: 7, text: '    let count = move || batch.ids.len();' },
        expect: { code: 'E0382', line: 8 },
        why: 'The `move` closure took `batch` whole, so `batch` has no R, W or O left; the borrow `&batch` on line 8 needs R.',
        focus: { line: 8, path: 'batch', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('plain-closure', 7, '    let count = || batch.ids.len();', 'Without `move` the closure borrows `batch` with R, so line 8 can borrow it too.'),
          cloned('clone-after', 8, '    let moved = &batch.clone();', 'The clone reads `batch`, which the `move` closure already took, so it fails the same way.'),
          bad('mut-borrow', 8, '    let moved = &mut batch;', 'A `&mut` borrow of a moved path needs R and W, and it has neither.', MISS.mutCures),
        ],
      },
    ],
  },

  {
    id: 'finish-partial-move',
    kcs: [OM],
    title: 'Pull the text out of a response, then return it',
    domain: 'Response',
    base: rs`
      #[derive(Clone)]
      struct Response {
          text: String,
          tokens: usize,
      }

      fn finish(resp: Response) -> Response {
          let text = resp.text;
          println!("{}", text.len());
          Response { text, ..resp }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Moving `resp.text` leaves `resp.tokens` readable, and `..resp` only needs the fields not named: the partly moved value is enough.',
      },
      {
        id: 'return-whole',
        edit: { line: 10, text: '    resp' },
        expect: { code: 'E0382', line: 10 },
        why: '`resp.text` was moved out on line 8, so `resp` as a whole has lost O of that field; returning `resp` moves all of it.',
        fixes: [
          good('borrow-text', 8, '    let text = &resp.text;', 'A `&String` needs only R, so nothing leaves `resp` and the whole value can be returned.'),
          cloned('clone-text', 8, '    let text = resp.text.clone();', 'It copies the text to read its length; the response moves on unchanged.'),
          bad('mut-text', 8, '    let text = &mut resp.text;', '`resp` is not declared `mut`, so it has no W to lend with `&mut`.', MISS.mutCures),
          cloned('clone-resp', 10, '    resp.clone()', 'Cloning reads `resp` as a whole, but `resp.text` already left, so there is no whole value to copy.'),
        ],
      },
      {
        id: 'read-moved-field',
        edit: { line: 9, text: '    println!("{}", resp.text.len());' },
        expect: { code: 'E0382', line: 9 },
        why: 'Line 8 moved `resp.text` into `text`, so the path has no R left; `len` on line 9 reads it.',
        focus: { line: 9, path: 'resp.text', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('read-text', 9, '    println!("{}", text.len());', 'The string lives in `text` now, which holds the R that `len` needs.'),
          cloned('clone-text', 8, '    let text = resp.text.clone();', 'It copies the text so that `resp.text` stays readable on line 9, though line 10 then returns the copy.'),
          bad('borrow-text', 8, '    let text = &resp.text;', 'It stops the move, but line 10 builds a `Response` whose `text` field is a `String`, not a `&String`.', MISS.refEverywhere),
        ],
      },
      {
        id: 'move-text-twice',
        edit: { line: 9, text: '    let again = resp.text;' },
        expect: { code: 'E0382', line: 9 },
        why: 'Line 8 already moved `resp.text`, so a second move of the same field needs R and O that it lost.',
      },
    ],
  },

  {
    id: 'event-match-moves',
    kcs: [OM, CCD],
    title: 'Size an event, then log it',
    domain: 'Event',
    base: rs`
      #[derive(Clone)]
      enum Event {
          Done(String),
          Failed(String),
      }

      fn report(ev: Event) -> usize {
          let n = match &ev {
              Event::Done(msg) => msg.len(),
              Event::Failed(why) => why.len(),
          };
          log(&ev);
          n
      }

      fn log(_ev: &Event) {}
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Matching on `&ev` binds `msg` and `why` as `&String`, so `ev` keeps its permissions and `log(&ev)` on line 12 can read it.',
      },
      {
        id: 'match-moves',
        edit: { line: 8, text: '    let n = match ev {' },
        expect: { code: 'E0382', line: 12 },
        why: 'Matching on `ev` itself binds `msg` by value, which moves the string out of `ev`; the partly moved `ev` has lost R, so `&ev` on line 12 fails.',
        focus: { line: 12, path: 'ev', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('match-ref', 8, '    let n = match &ev {', 'Matching on a reference binds `&String`, which needs only R, so no string leaves `ev`.'),
          cloned('clone-event', 8, '    let n = match ev.clone() {', 'It copies the event, payload string included, and matches on the copy.'),
          bad('deref-event', 8, '    let n = match *ev {', '`ev` is an `Event`, not a pointer, so there is nothing to dereference.', MISS.derefMoves),
        ],
      },
      {
        id: 'drop-then-log',
        edit: { line: 12, text: '    drop(ev); log(&ev);' },
        expect: { code: 'E0382', line: 12 },
        why: '`drop(ev)` moves `ev` into `drop`, which ends it, so the borrow `&ev` in the same line needs an R that is gone.',
      },
      {
        id: 'match-mut-ref',
        edit: { line: 8, text: '    let n = match &mut ev {' },
        expect: { code: 'E0596', line: 8 },
        why: '`ev` is not declared `mut`, so it has no W, and `&mut ev` needs it even when the arms only read.',
        focus: { line: 8, path: 'ev', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'evict-block-while-viewed',
    kcs: [OM, BR],
    title: 'Evict a block after measuring its data',
    domain: 'BlockPool',
    base: rs`
      struct Block {
          id: u32,
          data: Vec<u8>,
      }

      fn evict(block: Block) -> usize {
          let view = &block.data;
          let n = view.len();
          drop(block);
          n
      }

      fn free(_b: Block) {}
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`view` is last used on line 8, so its borrow is over when `drop(block)` takes O on line 9.',
      },
      {
        id: 'use-after-drop',
        edit: { line: 10, text: '    n + view.len()' },
        expect: { code: 'E0505', line: 9 },
        why: '`view` borrows `block.data` and is used again on line 10, so `block` has lost W and O until then; `drop(block)` moves it, which needs O.',
        focus: { line: 9, path: 'block', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('reuse-len', 10, '    n + n', 'The length is already in `n`, so line 10 needs no borrow and `drop(block)` finds `block` free.'),
          cloned('clone-data', 7, '    let view = block.data.clone();', 'It copies the whole buffer so a view can outlive the block, in a function that exists to free that memory.'),
          drift('drop-view', 9, '    drop(view);', 'Dropping a reference does nothing, so the block is no longer dropped on line 9 and the eviction frees nothing.', MISS.dropEnds),
          drift('first-term', 10, '    n', 'It compiles because nothing reads `view` after the drop, but it drops the second term, so the result is half of what the line meant.'),
        ],
      },
      {
        id: 'view-after-drop',
        edit: { line: 10, text: '    view.len()' },
        expect: { code: 'E0505', line: 9 },
        why: 'Line 10 reads through `view`, so the `&` borrow of `block.data` is alive across line 9, where `drop(block)` needs O.',
        focus: { line: 9, path: 'block', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'mut-view',
        edit: { line: 7, text: '    let view = &mut block.data;' },
        expect: { code: 'E0596', line: 7 },
        why: '`block` is not declared `mut`, so `block.data` never had W; a `&mut` borrow needs it.',
        focus: { line: 7, path: 'block.data', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'recycle-lease-slot',
    kcs: [OM, BR],
    title: 'Return a lease to the pool',
    domain: 'Lease',
    base: rs`
      #[derive(Clone)]
      struct Lease {
          slot: u32,
      }

      struct Pool {
          free: Vec<Lease>,
      }

      fn recycle(pool: &mut Pool, lease: Lease) {
          let slot = &lease.slot;
          println!("slot {slot}");
          pool.free.push(lease);
          println!("freed");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`slot` is last used on line 12, so the borrow of `lease` is over when `push` moves the lease on line 13.',
      },
      {
        id: 'use-after-push',
        edit: { line: 14, text: '    println!("freed {slot}");' },
        expect: { code: 'E0505', line: 13 },
        why: '`slot` borrows `lease.slot` and is used again on line 14, so `lease` has lost W and O until then; `push(lease)` moves it, which needs O.',
        focus: { line: 13, path: 'lease', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('copy-slot', 11, '    let slot = lease.slot;', 'A `u32` is Copy, so `slot` holds its own copy and `lease` is free to move.'),
          cloned('clone-lease', 13, '    pool.free.push(lease.clone());', 'It pushes a copy of the lease and leaves the original to be dropped at the end of the function.'),
          bad('mut-slot', 11, '    let slot = &mut lease.slot;', '`lease` is not declared `mut`, and a `&mut` borrow would take R and W away from the lease for even longer.', MISS.mutCures),
          bad('deref-lease', 13, '    pool.free.push(*lease);', '`lease` is a `Lease`, not a reference, so there is nothing to dereference.', MISS.derefMoves),
        ],
      },
      {
        id: 'read-after-push',
        edit: { line: 14, text: '    println!("freed {}", lease.slot);' },
        expect: { code: 'E0382', line: 14 },
        why: '`push(lease)` on line 13 moved the lease into the pool, so `lease.slot` has no R left on line 14.',
        focus: { line: 14, path: 'lease.slot', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'push-twice',
        edit: { line: 14, text: '    pool.free.push(lease);' },
        expect: { code: 'E0382', line: 14 },
        why: 'The first `push` moved `lease`, so a second move needs R and O that the lease no longer holds.',
      },
      {
        id: 'shared-pool',
        edit: { line: 10, text: 'fn recycle(pool: &Pool, lease: Lease) {' },
        expect: { code: 'E0596', line: 13 },
        why: 'Through a `&Pool`, `pool.free` has R but no W, and `push` borrows it `&mut`, which needs W.',
        focus: { line: 13, path: 'pool.free', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          good('mut-pool', 10, 'fn recycle(pool: &mut Pool, lease: Lease) {', 'A `&mut Pool` carries W for every field, so `pool.free` can grow.'),
          bad('mut-lease', 10, 'fn recycle(pool: &Pool, mut lease: Lease) {', '`mut` on `lease` gives W to the lease, not to the pool behind the `&`.', MISS.mutCures),
          bad('insert-front', 13, '    pool.free.insert(0, lease);', '`insert` is another method that borrows the vector `&mut`, so it needs the same W.', MISS.mutCures),
        ],
      },
    ],
  },

  {
    id: 'seal-batch-field-order',
    kcs: [OM],
    title: 'Seal a batch with its size',
    domain: 'Batch',
    base: rs`
      struct Batch {
          n: usize,
          ids: Vec<u64>,
      }

      fn seal(v: Vec<u64>) -> Batch {
          println!("sealing {}", v.len());
          Batch { n: v.len(), ids: v }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Struct fields are built in the order written: `v.len()` reads `v` first, and `ids: v` moves it last.',
      },
      {
        id: 'swap-fields',
        edit: { line: 8, text: '    Batch { ids: v, n: v.len() }' },
        expect: { code: 'E0382', line: 8 },
        why: '`ids: v` is built first and moves `v` into the struct, so `v` has no R left for `v.len()` in the next field.',
        focus: { line: 8, path: 'v', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('size-first', 8, '    Batch { n: v.len(), ids: v }', 'Reading the length first, then moving the vector, never touches `v` after the move.'),
          cloned('clone-ids', 8, '    Batch { ids: v.clone(), n: v.len() }', 'It copies every id into the batch and drops the original, which the struct could have taken as it was.'),
          bad('capacity', 8, '    Batch { ids: v, n: v.capacity() }', 'Reading the capacity is a read like `len`, and `v` has no R after the move.', MISS.alias),
          drift('size-zero', 8, '    Batch { ids: v, n: 0 }', 'It compiles because nothing reads `v` after the move, but the batch now claims to hold 0 requests.'),
        ],
      },
      {
        id: 'early-move',
        edit: { line: 7, text: '    let w = v;' },
        expect: { code: 'E0382', line: 8 },
        why: '`let w = v` moved the vector to `w`, so `v` has no R left for `v.len()` on line 8.',
        focus: { line: 8, path: 'v', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('borrow-w', 7, '    let w = &v;', 'A shared borrow needs only R, and `w` is not used again, so `v` keeps its permissions for line 8.'),
          cloned('clone-w', 7, '    let w = v.clone();', 'It copies every id into a second vector that nothing reads.'),
          bad('deref-v', 7, '    let w = *v;', 'Dereferencing a `Vec` gives a slice, whose size is unknown, so it cannot be bound by value.', MISS.derefMoves),
        ],
      },
    ],
  },

  {
    id: 'prompt-concat-consumes',
    kcs: [OM, CCD],
    title: 'Join the system prompt and the user text',
    domain: 'PromptBuilder',
    base: rs`
      fn build(sys: String, user: &str) -> usize {
          let full = format!("{sys}{user}");
          println!("{} bytes", full.len());
          sys.len() + full.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`format!` only borrows `sys`, so the string keeps R and O and line 4 can still read it.',
      },
      {
        id: 'plus-moves',
        edit: { line: 2, text: '    let full = sys + user;' },
        expect: { code: 'E0382', line: 4 },
        why: '`String + &str` takes the left string by value and reuses its buffer, so `sys` was moved on line 2 and has no R for `sys.len()`.',
        focus: { line: 4, path: 'sys', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('format-join', 2, '    let full = format!("{sys}{user}");', '`format!` borrows both strings and builds a new one, so `sys` stays whole.'),
          cloned('clone-left', 2, '    let full = sys.clone() + user;', 'It copies the system prompt so that `+` can consume the copy.'),
          bad('from-sys', 2, '    let full = String::from(sys) + user;', '`String::from(sys)` takes the string by value, so it moves `sys` just as `+` did.', MISS.alias),
          bad('push-str', 2, '    let full = sys.push_str(user);', '`push_str` needs `&mut` access, which needs W, and it returns nothing to name `full`.', MISS.mutCures),
        ],
      },
      {
        id: 'moved-by-let',
        edit: { line: 3, text: '    let s = sys;' },
        expect: { code: 'E0382', line: 4 },
        why: '`let s = sys` moved the string, so `sys` has no R left for `sys.len()` on line 4.',
        focus: { line: 4, path: 'sys', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'into-bytes',
        edit: { line: 3, text: '    let b = sys.into_bytes();' },
        expect: { code: 'E0382', line: 4 },
        why: '`into_bytes` takes the `String` by value, so line 3 moved `sys`, and `sys.len()` on line 4 needs an R it lost.',
        focus: { line: 4, path: 'sys', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('as-bytes', 3, '    let b = sys.as_bytes();', '`as_bytes` borrows the string, which needs only R, so `sys` stays readable.'),
          cloned('clone-bytes', 3, '    let b = sys.clone().into_bytes();', 'It copies the whole prompt into a byte vector that nothing uses.'),
          bad('ref-bytes', 3, '    let b = (&sys).into_bytes();', '`into_bytes` still wants the `String` by value, and a `&String` gives no O to move it.', MISS.selfBorrows),
          drift('user-bytes', 3, '    let b = user.as_bytes();', 'It compiles, but the bytes now come from the user text, not the system prompt.'),
        ],
      },
    ],
  },

  {
    id: 'claim-slot-unwrap',
    kcs: [OM],
    title: 'Claim the lease in a slot',
    domain: 'Lease',
    base: rs`
      #[derive(Clone)]
      struct Lease {
          id: u32,
          owner: String,
      }

      fn claim(mut slot: Option<Lease>) -> bool {
          let lease = slot.take().unwrap();
          println!("lease {}", lease.id);
          slot.is_none()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`take` swaps a `None` into the slot and hands back the old value, so `slot` keeps R, W and O.',
      },
      {
        id: 'unwrap-moves',
        edit: { line: 8, text: '    let lease = slot.unwrap();' },
        expect: { code: 'E0382', line: 10 },
        why: '`Option::unwrap` takes the option by value, so line 8 moved `slot` and left no R for `slot.is_none()` on line 10.',
        focus: { line: 10, path: 'slot', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('take-first', 8, '    let lease = slot.take().unwrap();', '`take` moves the lease out and leaves a `None`, so the slot is still there to ask.'),
          cloned('clone-slot', 8, '    let lease = slot.clone().unwrap();', 'It copies the lease and its owner string, and the slot still claims to hold one.'),
          drift('as-ref', 8, '    let lease = slot.as_ref().unwrap();', 'It borrows the lease instead of taking it, so the slot stays full and `is_none()` answers false.'),
          bad('ref-unwrap', 8, '    let lease = &slot.unwrap();', 'The `&` borrows the result, but `unwrap` still takes the option by value and moves `slot`.', MISS.refEverywhere),
        ],
      },
      {
        id: 'unwrap-twice',
        edit: { line: 9, text: '    let again = slot.unwrap();' },
        expect: { code: 'E0382', line: 10 },
        why: '`slot.unwrap()` on line 9 moved the option, so `slot.is_none()` on line 10 reads a path with no R.',
        focus: { line: 10, path: 'slot', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'immutable-slot',
        edit: { line: 7, text: 'fn claim(slot: Option<Lease>) -> bool {' },
        expect: { code: 'E0596', line: 8 },
        why: '`slot` is not declared `mut`, so it has no W, and `take` borrows it `&mut`.',
        focus: { line: 8, path: 'slot', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          good('mut-slot', 7, 'fn claim(mut slot: Option<Lease>) -> bool {', 'Declaring the binding `mut` gives it the W that `take` needs.'),
          bad('ref-take', 8, '    let lease = (&slot).take().unwrap();', 'A `&` borrow carries only R, so `take` through it still lacks the W it needs.', MISS.mutCures),
          bad('ref-param', 7, 'fn claim(ref slot: Option<Lease>) -> bool {', '`ref` binds a reference to the argument, which gives R only, so `take` still lacks W.', MISS.mutCures),
        ],
      },
    ],
  },

  {
    id: 'latency-window-consumes',
    kcs: [OM, BR],
    title: 'Sum the latencies, then read the middle one',
    domain: 'LatencyWindow',
    base: rs`
      fn p50(ms: Vec<u64>) -> Option<u64> {
          let t: u64 = ms.iter().sum();
          println!("total {t}");
          let mid = ms.len() / 2;
          ms.get(mid).copied()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`iter` borrows the vector with `&`, so `ms` keeps R and O and the later reads are fine.',
      },
      {
        id: 'sum-consumes',
        edit: { line: 2, text: '    let t: u64 = ms.into_iter().sum();' },
        expect: { code: 'E0382', line: 4 },
        why: '`into_iter` takes the vector by value, so line 2 moved `ms`, and `ms.len()` on line 4 needs an R it lost.',
        focus: { line: 4, path: 'ms', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('iter-sum', 2, '    let t: u64 = ms.iter().sum();', '`iter` borrows each latency with R and leaves the vector whole.'),
          cloned('clone-sum', 2, '    let t: u64 = ms.clone().iter().sum();', 'It copies the whole window to add it up, and the copy is dropped at the end of the line.'),
          drift('count-only', 2, '    let t: u64 = ms.len() as u64;', 'It compiles, but `t` now counts the samples instead of adding up their latencies.'),
          bad('drain-sum', 2, '    let t: u64 = ms.drain(..).sum();', '`drain` borrows the vector `&mut`, and `ms` is not declared `mut`, so it has no W to lend.', MISS.mutCures),
        ],
      },
      {
        id: 'index-after-move',
        edit: { line: 5, text: '    ms.into_iter().nth(ms.len() / 2)' },
        expect: { code: 'E0382', line: 5 },
        why: 'The receiver `ms.into_iter()` is evaluated first and moves `ms`, so the argument `ms.len()` reads a path with no R.',
        focus: { line: 5, path: 'ms', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'sort-immutable',
        edit: { line: 3, text: '    ms.sort();' },
        expect: { code: 'E0596', line: 3 },
        why: '`ms` is not declared `mut`, so it has no W, and `sort` borrows the vector `&mut`.',
        focus: { line: 3, path: 'ms', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          good('mut-param', 1, 'fn p50(mut ms: Vec<u64>) -> Option<u64> {', 'Declaring the parameter `mut` gives the vector the W that `sort` needs.'),
          bad('sort-unstable', 3, '    ms.sort_unstable();', 'It sorts in place too, so it borrows the vector `&mut` and needs the same W.', MISS.mutCures),
          bad('ref-param', 1, 'fn p50(ref ms: Vec<u64>) -> Option<u64> {', '`ref` binds a reference to the argument, which gives R only, so `sort` still lacks W.', MISS.mutCures),
        ],
      },
    ],
  },

  {
    id: 'trace-request-twice',
    kcs: [OM],
    title: 'Trace a request before admitting it',
    domain: 'Request',
    base: rs`
      #[derive(Debug, Clone)]
      struct Request {
          id: u64,
          prompt: String,
      }

      fn trace(x: impl std::fmt::Debug) {
          println!("{x:?}");
      }

      fn admit(req: Request) -> Request {
          trace(&req);
          trace(&req);
          req
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`impl Debug` accepts a `&Request` as well, and a shared borrow needs only R, so `req` is whole when line 14 returns it.',
      },
      {
        id: 'trace-by-value',
        edit: { line: 12, text: '    trace(req);' },
        expect: { code: 'E0382', line: 13 },
        why: '`trace(req)` passes the request by value, which moves it; `&req` on line 13 needs R that the moved path lost.',
        focus: { line: 13, path: 'req', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('trace-ref', 12, '    trace(&req);', 'Passing `&req` lends R for the call and `req` keeps its O.'),
          cloned('clone-arg', 12, '    trace(req.clone());', 'It copies the prompt string to print a request that `trace` could have borrowed.'),
          bad('deref-arg', 12, '    trace(*&req);', '`*&req` is the request itself again, so passing it by value still moves it, out of a borrow.', MISS.derefMoves),
          bad('mut-arg', 13, '    trace(&mut req);', '`req` is not declared `mut`, and the move on line 12 already took everything away.', MISS.mutCures),
        ],
      },
      {
        id: 'trace-last',
        edit: { line: 13, text: '    trace(req);' },
        expect: { code: 'E0382', line: 14 },
        why: '`trace(req)` moved the request, so returning `req` on line 14 needs R and O that it no longer has.',
      },
      {
        id: 'mut-trace',
        edit: { line: 12, text: '    trace(&mut req);' },
        expect: { code: 'E0596', line: 12 },
        why: '`req` is not declared `mut`, so it has no W to lend with `&mut`.',
        focus: { line: 12, path: 'req', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'tag-map-consumes',
    kcs: [OM],
    title: 'Measure a request tag, then test it',
    domain: 'Request',
    base: rs`
      #[derive(Clone)]
      struct Request {
          id: u64,
          tag: Option<String>,
      }

      fn tag_len(r: Request) -> usize {
          let n = r.tag.as_ref().map(|t| t.len());
          let m = r.tag.is_some();
          n.unwrap_or(0) + m as usize
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`as_ref` turns `&Option<String>` into `Option<&String>`, a view that needs only R, so `r.tag` stays whole.',
      },
      {
        id: 'map-moves',
        edit: { line: 8, text: '    let n = r.tag.map(|t| t.len());' },
        expect: { code: 'E0382', line: 9 },
        why: '`Option::map` takes the option by value, so line 8 moved `r.tag`, and `is_some` on line 9 needs an R it lost.',
        focus: { line: 9, path: 'r.tag', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('as-ref', 8, '    let n = r.tag.as_ref().map(|t| t.len());', 'Mapping over a view of the tag needs only R, so the string stays in the request.'),
          cloned('clone-tag', 8, '    let n = r.tag.clone().map(|t| t.len());', 'It copies the tag string just to measure it.'),
          bad('take-tag', 8, '    let n = r.tag.take().map(|t| t.len());', '`take` needs `&mut` access, and `r` is not declared `mut`, so it has no W to lend.', MISS.mutCures),
          bad('as-mut', 8, '    let n = r.tag.as_mut().map(|t| t.len());', '`as_mut` borrows the option `&mut`, which needs W; `r` is not declared `mut`.', MISS.mutCures),
        ],
      },
      {
        id: 'unwrap-moves',
        edit: { line: 8, text: '    let n = Some(r.tag.unwrap().len());' },
        expect: { code: 'E0382', line: 9 },
        why: '`unwrap` takes the option by value and moves `r.tag`, so `is_some` on line 9 reads a path with no R.',
        focus: { line: 9, path: 'r.tag', needs: ['read'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'slice-head-then-own',
    kcs: [OM, BR],
    title: 'Measure the first tokens, then take them over',
    domain: 'Request',
    base: rs`
      fn admit(tokens: Vec<u32>) -> usize {
          let head = &tokens[..2];
          let n = head.len();
          let owned = tokens;
          n + owned.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`head` is last used on line 3, so the borrow of `tokens` is over when line 4 moves the vector.',
      },
      {
        id: 'late-head',
        edit: { line: 5, text: '    head.len() + owned.len()' },
        expect: { code: 'E0505', line: 4 },
        why: '`head` borrows `tokens` and is used again on line 5, so `tokens` has lost W and O until then; `let owned = tokens` moves it, which needs O.',
        focus: { line: 4, path: 'tokens', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('borrow-owned', 4, '    let owned = &tokens;', 'A shared borrow needs only R, which `tokens` still holds beside the slice.'),
          cloned('clone-owned', 4, '    let owned = tokens.clone();', 'It copies every token so that two names can read what one vector already holds.'),
          bad('mut-owned', 4, '    let owned = &mut tokens;', '`tokens` is not declared `mut`, and a `&mut` borrow would take R from the slice that still reads it.', MISS.mutCures),
        ],
      },
      {
        id: 'mut-head',
        edit: { line: 2, text: '    let head = &mut tokens[..2];' },
        expect: { code: 'E0596', line: 2 },
        why: '`tokens` is not declared `mut`, so it has no W, and a `&mut` slice needs it.',
        focus: { line: 2, path: 'tokens', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          good('mut-param', 1, 'fn admit(mut tokens: Vec<u32>) -> usize {', 'Declaring the parameter `mut` gives the vector the W a `&mut` slice needs.'),
          bad('ref-param', 1, 'fn admit(ref tokens: Vec<u32>) -> usize {', '`ref` binds a reference to the argument, which gives R only, so a `&mut` slice still lacks W.', MISS.mutCures),
          bad('as-mut-slice', 2, '    let head = tokens.as_mut_slice();', '`as_mut_slice` borrows the vector `&mut` too, so the missing W is still the problem.', MISS.mutCures),
        ],
      },
    ],
  },

  {
    id: 'flush-table-blocks',
    kcs: [OM, CCD],
    title: 'Flush the blocks out of a table',
    domain: 'KvBlockTable',
    base: rs`
      struct Table {
          blocks: Vec<u32>,
          epoch: u64,
      }

      impl Table {
          fn flush(&mut self) -> Vec<u32> {
              self.epoch += 1;
              std::mem::take(&mut self.blocks)
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`mem::take` moves the vector out and leaves an empty one in its place, so `self.blocks` never loses O for good.',
      },
      {
        id: 'move-field',
        edit: { line: 9, text: '        self.blocks' },
        expect: { code: 'E0507', line: 9 },
        why: 'Through `&mut Table`, `self.blocks` has R and W but no O, and returning it by value moves the vector out, which needs O.',
        focus: { line: 9, path: 'self.blocks', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('take-blocks', 9, '        std::mem::take(&mut self.blocks)', 'It swaps an empty vector in, so the table keeps a valid field while the caller gets the old blocks.'),
          cloned('clone-blocks', 9, '        self.blocks.clone()', 'It returns a copy and leaves every block in the table, so a flush no longer empties it.'),
          bad('ref-blocks', 9, '        &self.blocks', 'It returns a `&Vec<u32>`, but the method returns a `Vec<u32>`.', MISS.refEverywhere),
          bad('replace-one-arg', 9, '        std::mem::replace(&mut self.blocks)', '`replace` needs the value to put back as a second argument; `take` supplies an empty one itself.', MISS.apiSlip),
        ],
      },
      {
        id: 'shared-self',
        edit: { line: 7, text: '    fn flush(&self) -> Vec<u32> {' },
        expect: { code: 'E0594', line: 8 },
        why: 'Through a `&Table`, `self.epoch` has R but no W, and `+=` writes it.',
        focus: { line: 8, path: 'self.epoch', needs: ['write'] },
        permission: 'write',
        fixes: [
          good('mut-self', 7, '    fn flush(&mut self) -> Vec<u32> {', 'A `&mut self` carries W for every field, so the epoch can change and the blocks can be taken.'),
          bad('plain-assign', 8, '        self.epoch = self.epoch + 1;', 'It writes the same field, so it needs the same W a `&Table` does not give.', MISS.mutCures),
          cloned('clone-blocks', 9, '        self.blocks.clone()', 'The write on line 8 is still behind a `&`, and the copy would leave every block in the table.'),
        ],
      },
      {
        id: 'bind-field',
        edit: { line: 8, text: '        let old = self.blocks;' },
        expect: { code: 'E0507', line: 8 },
        why: '`let old = self.blocks` moves the vector out of a place behind `&mut Table`, which has no O.',
        focus: { line: 8, path: 'self.blocks', needs: ['read', 'own'] },
        permission: 'own',
      },
    ],
  },

  {
    id: 'longest-prompt-index',
    kcs: [OM, CCD],
    title: 'Find the longest prompt in a list',
    domain: 'Scheduler',
    base: rs`
      fn longest(prompts: &Vec<String>) -> usize {
          let first = &prompts[0];
          let mut best = first.len();
          for p in prompts {
              best = best.max(p.len());
          }
          best
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`&prompts[0]` and `for p in prompts` both only read the strings, which needs only R through the reference.',
      },
      {
        id: 'index-move',
        edit: { line: 2, text: '    let first = prompts[0];' },
        expect: { code: 'E0507', line: 2 },
        why: 'Indexing a `Vec<String>` gives a place inside the vector, which has no O through `&Vec`; `let first = prompts[0]` moves the string out of it.',
        focus: { line: 2, path: 'prompts[0]', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('borrow-first', 2, '    let first = &prompts[0];', 'A `&String` needs only R, which the element has through the reference.'),
          cloned('clone-first', 2, '    let first = prompts[0].clone();', 'It copies the first prompt to read its length, then drops the copy.'),
          drift('whole-list', 2, '    let first = prompts;', 'It compiles, but `first` is now the whole list, so the best length starts from the number of prompts.'),
          bad('mut-first', 2, '    let first = &mut prompts[0];', '`prompts` is a `&Vec`, so its elements have R but no W, and `&mut` needs it.', MISS.mutCures),
        ],
      },
      {
        id: 'for-move',
        edit: { line: 4, text: '    for p in *prompts {' },
        expect: { code: 'E0507', line: 4 },
        why: '`*prompts` is the vector itself, behind a shared reference, and `for` moves what it loops over, which needs O.',
        focus: { line: 4, path: 'prompts', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('loop-ref', 4, '    for p in prompts {', '`prompts` is already a `&Vec`, so looping over it lends R to each element.'),
          cloned('clone-loop', 4, '    for p in prompts.clone() {', 'It copies the whole list, every prompt string included, to read the lengths.'),
          bad('mut-loop', 4, '    for p in &mut prompts {', '`prompts` is a `&Vec` bound without `mut`, so it has no W to lend.', MISS.mutCures),
        ],
      },
      {
        id: 'remove-first',
        edit: { line: 2, text: '    let first = prompts.remove(0);' },
        expect: { code: 'E0596', line: 2 },
        why: '`remove` shifts the elements, so it borrows the vector `&mut`, which needs W; a `&Vec` has R only.',
        focus: { line: 2, path: 'prompts', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'move-vec',
        edit: { line: 2, text: '    let first = *prompts;' },
        expect: { code: 'E0507', line: 2 },
        why: '`*prompts` is the whole vector behind a shared reference, and binding it by value moves it out, which needs O.',
        focus: { line: 2, path: 'prompts', needs: ['read', 'own'] },
        permission: 'own',
      },
    ],
  },

  {
    id: 'weights-behind-rc',
    kcs: [OM],
    title: 'Size model weights shared through an Rc',
    domain: 'ModelWeights',
    base: rs`
      use std::rc::Rc;

      struct Weights {
          name: String,
          bytes: Vec<u8>,
      }

      fn load(w: Rc<Weights>) -> usize {
          let view = &w.name;
          view.len() + w.bytes.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'An `Rc` hands out shared access only, and `&w.name` needs just R of the field.',
      },
      {
        id: 'move-name',
        edit: { line: 9, text: '    let view = w.name;' },
        expect: { code: 'E0507', line: 9 },
        why: 'Several `Rc` handles may point at the same weights, so a handle gives R and never O of a field; `let view = w.name` moves the string out.',
        focus: { line: 9, path: 'w.name', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('borrow-name', 9, '    let view = &w.name;', 'A `&String` needs only R, which every handle has.'),
          cloned('clone-name', 9, '    let view = w.name.clone();', 'It copies the name out of weights that every other handle still shares.'),
          bad('mut-name', 9, '    let view = &mut w.name;', 'An `Rc` gives R and never W, so a `&mut` borrow of its field fails too.', MISS.mutCures),
        ],
      },
      {
        id: 'move-all',
        edit: { line: 10, text: '    let all = *w; all.bytes.len()' },
        expect: { code: 'E0507', line: 10 },
        why: '`*w` would move the whole `Weights` out of the `Rc`, but the other handles still point at it, so no handle holds O.',
        focus: { line: 10, path: 'w', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'push-through-rc',
        edit: { line: 10, text: '    w.bytes.push(0); view.len()' },
        expect: { code: 'E0596', line: 10 },
        why: 'An `Rc` gives R and never W, because other handles may be reading; `push` borrows `w.bytes` `&mut`, which needs W.',
        focus: { line: 10, path: 'w.bytes', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'worker-state-match',
    kcs: [OM, CCD],
    title: 'Size the job a worker is on, then reset it',
    domain: 'Worker',
    base: rs`
      #[derive(Clone)]
      enum State { Idle, Busy(String) }
      struct Worker { state: State }

      impl Worker {
          fn job(&mut self) -> usize {
              let n = match &self.state {
                  State::Idle => 0,
                  State::Busy(id) => id.len(),
              };
              self.state = State::Idle;
              n
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Matching on `&self.state` binds `id` as a `&String`, which needs only R; the reset on line 11 then has W again.',
      },
      {
        id: 'match-moves',
        edit: { line: 7, text: '        let n = match self.state {' },
        expect: { code: 'E0507', line: 7 },
        why: 'Matching on `self.state` itself binds `id` by value, which moves the string out; behind `&mut self` the field has R and W but no O.',
        focus: { line: 7, path: 'self.state', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('match-ref', 7, '        let n = match &self.state {', 'Matching on a reference binds `&String`, which needs only R.'),
          cloned('clone-state', 7, '        let n = match self.state.clone() {', 'It copies the state, job id string included, to take its length.'),
          bad('match-deref', 7, '        let n = match *self.state {', '`State` is not a pointer, so there is nothing to dereference.', MISS.derefMoves),
        ],
      },
      {
        id: 'shared-assign',
        edit: { line: 6, text: '    fn job(&self) -> usize {' },
        expect: { code: 'E0594', line: 11 },
        why: 'Through a `&Worker`, `self.state` has R but no W, and the reset on line 11 assigns it.',
        focus: { line: 11, path: 'self.state', needs: ['write'] },
        permission: 'write',
        fixes: [
          good('mut-self', 6, '    fn job(&mut self) -> usize {', 'A `&mut self` carries the W that assigning a field needs.'),
          bad('mut-borrow', 11, '        let s = &mut self.state;', 'Borrowing the field `&mut` is the same need as assigning it: W, which a `&Worker` does not give.', MISS.mutCures),
          bad('extra-param', 6, '    fn job(&self, n: u32) -> usize {', 'A new parameter changes nothing about the borrow of `self`, so the assignment still lacks W.', MISS.mutCures),
        ],
      },
      {
        id: 'move-then-reset',
        edit: { line: 11, text: '        let old = self.state;' },
        expect: { code: 'E0507', line: 11 },
        why: '`let old = self.state` moves the state out of a place behind `&mut self`, which has no O.',
        focus: { line: 11, path: 'self.state', needs: ['read', 'own'] },
        permission: 'own',
      },
    ],
  },

  {
    id: 'collect-prompts-loop',
    kcs: [OM, CCD],
    title: 'Collect the prompts of a request list',
    domain: 'Scheduler',
    base: rs`
      struct Request {
          id: u64,
          prompt: String,
      }

      fn collect(reqs: &Vec<Request>) -> usize {
          let mut out = Vec::new();
          for r in reqs {
              out.push(&r.prompt);
          }
          out.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Each `r` is a `&Request`, and `&r.prompt` needs only R, so `out` collects references to prompts that stay in the list.',
      },
      {
        id: 'push-owned',
        edit: { line: 9, text: '        out.push(r.prompt);' },
        expect: { code: 'E0507', line: 9 },
        why: '`r` is a `&Request`, so `r.prompt` has R but no O; pushing it by value moves the string out of the list.',
        focus: { line: 9, path: 'r.prompt', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('push-ref', 9, '        out.push(&r.prompt);', 'Pushing a `&String` needs only R, and the prompts stay in the list.'),
          cloned('clone-push', 9, '        out.push(r.prompt.clone());', 'It copies every prompt into `out`, which only needed to point at them.'),
          drift('to-owned', 9, '        out.push(r.prompt.to_owned());', 'It is `.clone()` under another name: it copies each prompt, so `out` holds new strings.', CLONE_MISS),
          bad('push-deref', 9, '        out.push(*r.prompt);', 'Dereferencing a `String` gives a `str`, which is unsized and cannot be pushed by value.', MISS.derefMoves),
        ],
      },
      {
        id: 'drain-shared',
        edit: { line: 8, text: '    for r in reqs.drain(..) {' },
        expect: { code: 'E0596', line: 8 },
        why: '`drain` removes the elements, so it borrows the vector `&mut`, which needs W; a `&Vec` has R only.',
        focus: { line: 8, path: 'reqs', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'assign-through',
        edit: { line: 9, text: '        out.push(&r.prompt); r.id = 0;' },
        expect: { code: 'E0594', line: 9 },
        why: '`r` is a `&Request`, so `r.id` has R but no W; the assignment needs W.',
        focus: { line: 9, path: 'r.id', needs: ['write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'plan-box-deref',
    kcs: [OM, CCD],
    title: 'Run a boxed execution plan',
    domain: 'Plan',
    base: rs`
      #[derive(Clone)]
      struct Plan {
          steps: Vec<u32>,
      }

      fn run(plan: Box<Plan>) -> usize {
          let inner = *plan;
          inner.steps.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'A `Box` owns its contents alone, so `*plan` can move the whole plan out; the box is then spent.',
      },
      {
        id: 'ref-box',
        edit: { line: 6, text: 'fn run(plan: &Box<Plan>) -> usize {' },
        expect: { code: 'E0507', line: 7 },
        why: 'Through a `&Box<Plan>` the plan has R but no O, and `*plan` would move it out of the box the caller still owns.',
        focus: { line: 7, path: 'plan', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('reborrow', 7, '    let inner = &**plan;', 'Two derefs reach the plan itself, and `&` takes only R of it.'),
          cloned('clone-plan', 7, '    let inner = (**plan).clone();', 'It copies every step of the plan to read how many there are.'),
          bad('triple-deref', 7, '    let inner = &***plan;', 'A `Plan` has no further level to dereference, so the third `*` has nothing to act on.', MISS.derefMoves),
        ],
      },
      {
        id: 'use-after-box',
        edit: { line: 8, text: '    plan.steps.len() + inner.steps.len()' },
        expect: { code: 'E0382', line: 8 },
        why: '`let inner = *plan` moved the plan out of the box, so `plan.steps` has no R left on line 8.',
        focus: { line: 8, path: 'plan.steps', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('double-inner', 8, '    inner.steps.len() * 2', 'Both terms are the same length, and `inner` holds the plan now.'),
          cloned('clone-inner', 7, '    let inner = (*plan).clone();', 'It copies the plan so that the box can be read as well, though both terms measure the same steps.'),
          bad('double-plan', 8, '    plan.steps.len() * 2', 'The plan was moved out on line 7, so the box has nothing left to read.', MISS.alias),
        ],
      },
      {
        id: 'unbox-twice',
        edit: { line: 8, text: '    let again = *plan; inner.steps.len()' },
        expect: { code: 'E0382', line: 8 },
        why: 'The first `*plan` moved the plan out of the box, so a second one needs R and O that the box no longer holds.',
      },
    ],
  },

  {
    id: 'first-owner-array',
    kcs: [OM],
    title: 'Read the owner of the first slot in an array',
    domain: 'BlockPool',
    base: rs`
      struct Slot { owner: String }

      fn first_owner(slots: [Slot; 4]) -> usize {
          let first = &slots[0].owner;
          first.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`&slots[0].owner` needs only R of one element, and an array by value holds R for all of them.',
      },
      {
        id: 'index-field',
        edit: { line: 4, text: '    let first = slots[0].owner;' },
        expect: { code: 'E0508', line: 4 },
        why: 'rustc cannot track which array elements were moved out, so an element of an array has R and W but never O; moving `owner` out of `slots[0]` needs O.',
        focus: { line: 4, path: 'slots[0].owner', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('borrow-owner', 4, '    let first = &slots[0].owner;', 'A `&String` needs only R, which every element of the array has.'),
          cloned('clone-owner', 4, '    let first = slots[0].owner.clone();', 'It copies the owner string just to read its length.'),
          bad('deref-owner', 4, '    let first = *slots[0].owner;', 'Dereferencing a `String` gives a `str`, whose size is unknown, so it cannot be bound by value.', MISS.derefMoves),
          bad('into-bytes', 4, '    let first = slots[0].owner.into_bytes();', '`into_bytes` takes the string by value, so the move out of the array element is still there.', MISS.selfBorrows),
        ],
      },
      {
        id: 'mut-owner',
        edit: { line: 4, text: '    let first = &mut slots[0].owner;' },
        expect: { code: 'E0596', line: 4 },
        why: '`slots` is not declared `mut`, so its elements have no W, and a `&mut` borrow needs it.',
        focus: { line: 4, path: 'slots[0].owner', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'guard-name-move',
    kcs: [OM, CCD],
    title: 'Read the name of a guard that logs its release',
    domain: 'Guard',
    base: rs`
      struct Guard {
          name: String,
      }

      impl Drop for Guard {
          fn drop(&mut self) {
              println!("release {}", self.name);
          }
      }

      fn take_name(g: Guard) -> usize {
          let n = &g.name;
          n.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`&g.name` needs only R, so `g` stays whole and its `Drop` runs once, at the end of the function.',
      },
      {
        id: 'move-name',
        edit: { line: 12, text: '    let n = g.name;' },
        expect: { code: 'E0509', line: 12 },
        why: 'A type with a `Drop` impl must reach `drop` whole, so its fields have R and W but never O; `let n = g.name` moves the string out.',
        focus: { line: 12, path: 'g.name', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('borrow-name', 12, '    let n = &g.name;', 'A `&String` needs only R, and the guard reaches its `drop` whole.'),
          cloned('clone-name', 12, '    let n = g.name.clone();', 'It copies the name to read its length, and the guard still logs the original.'),
          bad('mut-name', 12, '    let n = &mut g.name;', '`g` is not declared `mut`, so `g.name` has no W to lend.', MISS.mutCures),
          bad('into-bytes', 12, '    let n = g.name.into_bytes();', '`into_bytes` takes the string by value, so it moves `g.name` out of a type with a destructor.', MISS.selfBorrows),
        ],
      },
      {
        id: 'destructure',
        edit: { line: 12, text: '    let Guard { name: n } = g;' },
        expect: { code: 'E0509', line: 12 },
        why: 'A pattern that binds `name` by value moves the field out of `g`, and a `Drop` type does not allow a partial move.',
        focus: { line: 12, path: 'g', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'drop-borrowed',
        edit: { line: 13, text: '    drop(g); n.len()' },
        expect: { code: 'E0505', line: 13 },
        why: '`n` borrows `g.name` and is used after `drop(g)` in the same line, so `g` has no O to give while the borrow lives.',
        focus: { line: 13, path: 'g', needs: ['read', 'own'] },
        permission: 'own',
      },
    ],
  },

  {
    id: 'conn-addr-take',
    kcs: [OM, CCD],
    title: 'Hand back the address of a closing connection',
    domain: 'Replica',
    base: rs`
      struct Conn {
          addr: String,
          open: bool,
      }

      impl Drop for Conn {
          fn drop(&mut self) {
              self.open = false;
          }
      }

      fn addr_of(mut c: Conn) -> String {
          std::mem::take(&mut c.addr)
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`mem::take` leaves an empty string in `c.addr`, so `c` is still whole when its `Drop` runs, and `mut c` gives it the W `take` needs.',
      },
      {
        id: 'move-field',
        edit: { line: 13, text: '    c.addr' },
        expect: { code: 'E0509', line: 13 },
        why: 'A type with a `Drop` impl must reach `drop` whole, so `c.addr` has R and W but not O; returning the field by value moves it out.',
        focus: { line: 13, path: 'c.addr', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('take-addr', 13, '    std::mem::take(&mut c.addr)', 'It moves the string out and puts an empty one back, so the connection is whole when `drop` runs.'),
          cloned('clone-addr', 13, '    c.addr.clone()', 'It returns a copy and leaves the original in the connection until `drop` ends it.'),
          bad('replace-one-arg', 13, '    std::mem::replace(&mut c.addr)', '`replace` needs the value to put back as a second argument; `take` supplies an empty one itself.', MISS.apiSlip),
          bad('deref-addr', 13, '    *c.addr', 'Dereferencing a `String` gives a `str`, not the `String` the function returns.', MISS.derefMoves),
        ],
      },
      {
        id: 'pattern-move',
        edit: { line: 13, text: '    let Conn { addr, .. } = c; addr' },
        expect: { code: 'E0509', line: 13 },
        why: 'Binding `addr` by value in a pattern moves the field out of `c`, and a `Drop` type does not allow a partial move.',
        focus: { line: 13, path: 'c', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'immutable-take',
        edit: { line: 12, text: 'fn addr_of(c: Conn) -> String {' },
        expect: { code: 'E0596', line: 13 },
        why: '`c` is not declared `mut`, so `c.addr` has no W, and `mem::take` borrows it `&mut`.',
        focus: { line: 13, path: 'c.addr', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          good('mut-param', 12, 'fn addr_of(mut c: Conn) -> String {', 'Declaring the parameter `mut` gives the connection the W that `take` needs.'),
          cloned('clone-take', 13, '    std::mem::take(&mut c.addr.clone())', 'It takes from a copy, which still needs `&mut` access to a temporary, and it leaves the real address in place.'),
          bad('split-off', 13, '    (&mut c).addr.split_off(0)', 'Lending `&mut c` needs the W that the binding lacks, and `split_off` needs it as well.', MISS.mutCures),
        ],
      },
    ],
  },

  {
    id: 'batch-ids-drop-log',
    kcs: [OM, CCD],
    title: 'Total the ids of a batch that logs its drop',
    domain: 'Batch',
    base: rs`
      struct Batch { ids: Vec<u64> }

      impl Drop for Batch {
          fn drop(&mut self) {
              println!("{} ids", self.ids.len());
          }
      }

      fn total(b: Batch) -> u64 {
          let mut sum = 0;
          for id in &b.ids {
              sum += id;
          }
          sum
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`&b.ids` needs only R, so `b` stays whole and `drop` logs the ids at the end of the function.',
      },
      {
        id: 'consume-ids',
        edit: { line: 11, text: '    for id in b.ids {' },
        expect: { code: 'E0509', line: 11 },
        why: '`for id in b.ids` moves the vector into the loop, but a `Drop` type must reach `drop` whole, so `b.ids` has no O.',
        focus: { line: 11, path: 'b.ids', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('loop-ref', 11, '    for id in &b.ids {', 'Looping over `&b.ids` lends R for the loop, and the batch reaches `drop` whole.'),
          cloned('clone-ids', 11, '    for id in b.ids.clone() {', 'It copies every id to loop over them, and `drop` still logs the original.'),
          bad('mut-loop', 11, '    for id in &mut b.ids {', '`b` is not declared `mut`, so `b.ids` has no W to lend.', MISS.mutCures),
          bad('drain-ids', 11, '    for id in b.ids.drain(..) {', '`drain` borrows the vector `&mut`, and `b` is not declared `mut`, so it has no W to lend.', MISS.mutCures),
        ],
      },
      {
        id: 'destructure',
        edit: { line: 14, text: '    let Batch { ids } = b; ids[0]' },
        expect: { code: 'E0509', line: 14 },
        why: 'Binding `ids` by value in a pattern moves the vector out of `b`, and a `Drop` type does not allow a partial move.',
        focus: { line: 14, path: 'b', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'explicit-drop',
        edit: { line: 14, text: '    drop(b); sum' },
        expect: 'compiles',
        why: '`drop(b)` moves the batch whole into `drop`, which runs its destructor now, and nothing reads `b` afterwards.',
      },
      {
        id: 'use-after-drop',
        edit: { line: 14, text: '    drop(b); b.ids.len() as u64' },
        expect: { code: 'E0382', line: 14 },
        why: '`drop(b)` moved the batch, so `b.ids` has no R left for `len`.',
        focus: { line: 14, path: 'b.ids', needs: ['read'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'pick-slot-uninit',
    kcs: [OM],
    title: 'Pick a slot on a hot or a cold path',
    domain: 'BlockPool',
    base: rs`
      fn pick(hot: bool) -> u32 {
          let slot: u32;
          if hot {
              slot = 7;
          } else {
              slot = 0;
          }
          slot
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Both branches assign `slot` once, so on every path it is initialized exactly once before line 8 reads it.',
      },
      {
        id: 'missing-else',
        edit: { line: 6, text: '        println!("cold");' },
        expect: { code: 'E0381', line: 8 },
        why: 'On the cold path `slot` is never assigned, so line 8 reads a binding that holds no value yet: it has no R there.',
        fixes: [
          good('assign-cold', 6, '        slot = 0;', 'Now every path assigns `slot` exactly once before it is read.'),
          bad('init-early', 2, '    let slot: u32 = 0;', 'The binding then holds a value already, and the assignment on line 4 is a second one to a binding not declared `mut`.', MISS.mutCures),
          drift('return-zero', 8, '    0', 'It compiles because nothing reads `slot` any more, but the hot path now returns 0 instead of 7.'),
        ],
      },
      {
        id: 'read-first',
        edit: { line: 2, text: '    let slot: u32; let early = slot;' },
        expect: { code: 'E0381', line: 2 },
        why: 'The `let` declares `slot` without a value, so reading it in the same line reads a binding that holds nothing yet.',
      },
      {
        id: 'assign-twice',
        edit: { line: 8, text: '    slot = 9; slot' },
        expect: { code: 'E0384', line: 8 },
        why: 'Both branches already gave `slot` its one value, and a binding not declared `mut` has no W for a second assignment.',
        focus: { line: 8, path: 'slot', needs: ['write'] },
        permission: 'write',
        fixes: [
          good('mut-slot', 2, '    let mut slot: u32;', 'A `mut` binding has W, so it can be assigned again after the branches.'),
          bad('assign-sum', 8, '    slot = slot + 9; slot', 'It assigns `slot` again, so it needs the W that a binding without `mut` lacks.', MISS.mutCures),
          bad('deref-assign', 8, '    *slot = 9; slot', '`slot` is a `u32`, not a reference, so there is nothing to dereference.', MISS.derefMoves),
        ],
      },
    ],
  },

  {
    id: 'warm-ids-uninit',
    kcs: [OM],
    title: 'Warm a cache with one id per request',
    domain: 'PrefixCache',
    base: rs`
      fn warm(n: usize) -> Vec<u32> {
          let ids: Vec<u32>;
          match n {
              0 => ids = Vec::new(),
              _ => ids = vec![1; n],
          }
          ids
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Each arm assigns `ids` once, so it is initialized on every path before line 7 returns it.',
      },
      {
        id: 'arm-missing',
        edit: { line: 5, text: '        _ => {}' },
        expect: { code: 'E0381', line: 7 },
        why: 'When `n` is not 0 nothing assigns `ids`, so line 7 moves a binding that holds no value.',
        fixes: [
          good('assign-arm', 5, '        _ => ids = vec![1; n],', 'Each arm now assigns `ids` once, so line 7 always has a vector to return.'),
          drift('empty-vec', 5, '        _ => ids = vec![],', 'It compiles, but the warm cache is empty for every `n`, not `n` ones.'),
          bad('init-early', 2, '    let ids = Vec::new();', 'The binding holds a vector already, so the assignment in the first arm is a second one to a binding not declared `mut`.', MISS.mutCures),
        ],
      },
      {
        id: 'read-before-match',
        edit: { line: 3, text: '    let first = ids.len(); match n {' },
        expect: { code: 'E0381', line: 3 },
        why: '`ids` is declared on line 2 without a value, so `ids.len()` reads a binding that holds nothing yet.',
      },
    ],
  },

  {
    id: 'count-assign-twice',
    kcs: [OM, BR],
    title: 'Add up request counts in a loop',
    domain: 'Metrics',
    base: rs`
      fn count(reqs: &[u64]) -> u64 {
          let mut total = 0;
          for r in reqs {
              total += *r;
          }
          total
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`mut total` has W, so `total += r` can change it on every pass.',
      },
      {
        id: 'immutable-total',
        edit: { line: 2, text: '    let total = 0;' },
        expect: { code: 'E0384', line: 4 },
        why: '`total` is not declared `mut`, so it has no W after its first value, and `total += *r` assigns it again.',
        focus: { line: 4, path: 'total', needs: ['write'] },
        permission: 'write',
        fixes: [
          good('mut-total', 2, '    let mut total = 0;', 'Declaring the binding `mut` gives it the W that `+=` needs on each pass.'),
          bad('plain-assign', 4, '        total = *r;', 'It still assigns `total` a second time, which needs the W the binding lacks, and it would drop the running sum.', MISS.mutCures),
          drift('shadow-total', 4, '        let total = *r;', 'It compiles, but each pass makes a new `total` that ends with the pass, so the function returns 0.'),
        ],
      },
      {
        id: 'assign-through-ref',
        edit: { line: 4, text: '        *r += 1;' },
        expect: { code: 'E0594', line: 4 },
        why: '`r` is a `&u64` taken from a shared slice, so `*r` has R but no W, and `+=` writes it.',
        focus: { line: 4, path: 'r', needs: ['write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'clamp-budget-param',
    kcs: [OM],
    title: 'Clamp a token budget to a cap',
    domain: 'Scheduler',
    base: rs`
      fn clamp(mut budget: u32, cap: u32) -> u32 {
          if budget > cap {
              budget = cap;
          }
          budget
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`mut budget` gives the parameter W, so line 3 may assign it.',
      },
      {
        id: 'immutable-param',
        edit: { line: 1, text: 'fn clamp(budget: u32, cap: u32) -> u32 {' },
        expect: { code: 'E0384', line: 3 },
        why: 'A parameter not declared `mut` has no W, and line 3 assigns it a second value.',
        focus: { line: 3, path: 'budget', needs: ['write'] },
        permission: 'write',
        fixes: [
          good('mut-param', 1, 'fn clamp(mut budget: u32, cap: u32) -> u32 {', 'Declaring the parameter `mut` gives it the W that the assignment needs.'),
          drift('shadow-budget', 3, '        let budget = cap;', 'It compiles, but the new binding ends with the `if`, so line 5 returns the budget unclamped.'),
          bad('deref-budget', 3, '        *budget = cap;', '`budget` is a `u32`, not a reference, so there is nothing to dereference.', MISS.derefMoves),
          bad('ref-param', 1, 'fn clamp(ref budget: u32, cap: u32) -> u32 {', '`ref` binds a reference to the argument, which gives R only, and a `&u32` cannot be compared with a `u32`.', MISS.mutCures),
        ],
      },
      {
        id: 'assign-cap',
        edit: { line: 3, text: '        cap = budget;' },
        expect: { code: 'E0384', line: 3 },
        why: '`cap` is a parameter not declared `mut`, so it has no W, and the assignment needs it.',
        focus: { line: 3, path: 'cap', needs: ['write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'chain-block-ids',
    kcs: [CCD, OM],
    title: 'Chain two block ids from one id',
    domain: 'KvBlockTable',
    base: rs`
      #[derive(Clone)]
      struct BlockId(u32);

      impl BlockId {
          fn next(&self) -> BlockId {
              BlockId(self.0 + 1)
          }
      }

      fn chain(id: BlockId) -> BlockId {
          let a = id.next();
          let b = id.next();
          BlockId(a.0 + b.0)
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`next(&self)` borrows the id for the call and needs only R, so `id` is intact for the second call.',
      },
      {
        id: 'consume-self',
        edit: { line: 5, text: '    fn next(self) -> BlockId {' },
        expect: { code: 'E0382', line: 12 },
        why: '`next(self)` takes the id by value; `BlockId` is not Copy, so the call on line 11 moved `id`, and line 12 needs R and O that it lost.',
        fixes: [
          good('derive-copy', 1, '#[derive(Clone, Copy)]', 'A four-byte id can be Copy: each call then takes a copy, and `id` keeps R and O.'),
          cloned('clone-first', 11, '    let a = id.clone().next();', 'It compiles because the last call may take the original, but it adds a `.clone()` that a Copy id would not need.'),
          bad('ref-receiver', 11, '    let a = (&id).next();', 'A `&BlockId` gives R and never O, and `next(self)` needs O to take the id.', MISS.selfBorrows),
          bad('derive-debug', 1, '#[derive(Clone, Debug)]', '`Debug` prints a value; it does not make the type Copy, so the second call still finds a moved id.', MISS.wrongDerive),
        ],
      },
      {
        id: 'drop-then-next',
        edit: { line: 12, text: '    drop(id); let b = id.next();' },
        expect: { code: 'E0382', line: 12 },
        why: '`drop(id)` moves the id, so `id.next()` after it borrows a path that has no R.',
        focus: { line: 12, path: 'id', needs: ['read'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'lease-drop-order',
    kcs: [CCD, OM],
    title: 'Free a lease early and keep its slot number',
    domain: 'Lease',
    base: rs`
      struct Lease { slot: u32 }

      impl Drop for Lease {
          fn drop(&mut self) {
              println!("free {}", self.slot);
          }
      }

      fn serve() -> u32 {
          let lease = Lease { slot: 3 };
          let slot = lease.slot;
          drop(lease);
          slot
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The slot number is copied out before `drop(lease)` moves the lease, so the lease is freed on line 12 and nothing reads it after.',
      },
      {
        id: 'read-after-drop',
        edit: { line: 13, text: '    lease.slot' },
        expect: { code: 'E0382', line: 13 },
        why: '`drop(lease)` moved the lease into `drop`, which ended it, so `lease.slot` has no R left on line 13.',
        focus: { line: 13, path: 'lease.slot', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('use-copy', 13, '    slot', 'Line 11 already copied the number out, so line 13 reads nothing of the dropped lease.'),
          cloned('clone-read', 13, '    lease.slot.clone()', 'The clone still reads `lease`, which was moved on line 12; copying a `u32` does not bring the lease back.'),
          drift('return-zero', 13, '    0', 'It compiles because nothing reads the lease after the drop, but the function returns 0 instead of the slot number.'),
        ],
      },
      {
        id: 'drop-twice',
        edit: { line: 13, text: '    drop(lease); slot' },
        expect: { code: 'E0382', line: 13 },
        why: 'The first `drop` moved the lease, so a second move needs R and O that it no longer holds.',
      },
      {
        id: 'drop-field',
        edit: { line: 12, text: '    drop(lease.slot);' },
        expect: 'compiles',
        why: '`lease.slot` is a Copy `u32`, so `drop` receives a copy; the lease itself is not moved and is freed at the end of the function.',
      },
      {
        id: 'drop-borrowed',
        edit: { line: 12, text: '    let r = &lease; drop(lease); drop(r);' },
        expect: { code: 'E0505', line: 12 },
        why: '`r` borrows `lease` and is used after `drop(lease)`, so `lease` has lost O while the borrow lives.',
        focus: { line: 12, path: 'lease', needs: ['read', 'own'] },
        permission: 'own',
      },
    ],
  },

  {
    id: 'share-weights-handles',
    kcs: [CCD, OM],
    title: 'Hand two readers a handle to the same weights',
    domain: 'ModelWeights',
    base: rs`
      use std::rc::Rc;

      struct Weights {
          bytes: Vec<u8>,
      }

      fn share(w: Rc<Weights>) -> usize {
          let a = Rc::clone(&w);
          let b = w;
          a.bytes.len() + b.bytes.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`Rc::clone(&w)` copies the handle and bumps a count, not the weights; the last use of `w` then moves the original handle.',
      },
      {
        id: 'move-twice',
        edit: { line: 8, text: '    let a = w;' },
        expect: { code: 'E0382', line: 9 },
        why: '`let a = w` moved the handle, so `let b = w` on line 9 needs R and O that `w` no longer holds.',
        fixes: [
          good('rc-clone', 8, '    let a = Rc::clone(&w);', 'It adds a second handle to the same weights, so both names own one and `w` stays whole.'),
          bad('borrow-w', 8, '    let a = &w;', 'A borrow cannot be a second owner: moving `w` into `b` on line 9 would need O while `a` still borrows it.', MISS.refEverywhere),
          bad('rc-new-deref', 8, '    let a = Rc::new(*w);', 'An `Rc` never gives up the weights it shares, so `*w` cannot be moved out into a new one.', MISS.derefMoves),
        ],
      },
      {
        id: 'read-after-move',
        edit: { line: 10, text: '    a.bytes.len() + w.bytes.len()' },
        expect: { code: 'E0382', line: 10 },
        why: '`let b = w` moved the original handle on line 9, so `w.bytes` has no R left on line 10.',
        focus: { line: 10, path: 'w.bytes', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'push-through-handle',
        edit: { line: 10, text: '    a.bytes.push(1); b.bytes.len()' },
        expect: { code: 'E0596', line: 10 },
        why: 'Two handles share the weights, so each gives R and never W; `push` borrows `a.bytes` `&mut`, which needs W.',
        focus: { line: 10, path: 'a.bytes', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'oldest-ring-slot',
    kcs: [OM, CCD],
    title: 'Take the oldest request out of a ring of slots',
    domain: 'Scheduler',
    base: rs`
      #[derive(Clone)]
      struct Req { prompt: String }

      fn oldest(r: [Req; 3], i: usize) -> Req {
          r[i]
      }
    `,
    variants: [
      {
        id: 'base',
        expect: { code: 'E0508', line: 5 },
        why: 'rustc cannot tell which array elements were moved out, so an element has R and W but never O; returning `r[i]` by value needs O.',
        focus: { line: 5, path: 'r[i]', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('into-iter', 5, '    r.into_iter().nth(i).unwrap()', 'An array by value can be consumed by `into_iter`, which hands each element out with its O.'),
          cloned('clone-slot', 5, '    r[i].clone()', 'It returns a copy of the prompt string and leaves the original in an array that is dropped at the end of the call.'),
          bad('ref-slot', 5, '    &r[i]', 'It returns a `&Req`, but the function returns a `Req`, and the reference would outlive the array.', MISS.refEverywhere),
          bad('unwrap-default', 5, '    r.into_iter().nth(i).unwrap_or_default()', '`unwrap_or_default` needs `Req` to implement `Default`, which it does not; plain `unwrap` is enough here.', MISS.apiSlip),
        ],
      },
      {
        id: 'vec-version',
        edit: { line: 4, text: 'fn oldest(r: Vec<Req>, i: usize) -> Req {' },
        expect: { code: 'E0507', line: 5 },
        why: 'Indexing a `Vec` gives a place inside it, and a place inside a vector has R and W but never O; `r[i]` by value moves it out.',
        focus: { line: 5, path: 'r[i]', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('into-iter', 5, '    r.into_iter().nth(i).unwrap()', 'A vector by value can be consumed by `into_iter`, which hands each element out with its O.'),
          cloned('clone-slot', 5, '    r[i].clone()', 'It copies the request and drops the whole vector with the original still inside.'),
          bad('ref-slot', 5, '    &r[i]', 'It returns a `&Req`, but the function returns a `Req`.', MISS.refEverywhere),
          bad('unwrap-default', 5, '    r.into_iter().nth(i).unwrap_or_default()', '`unwrap_or_default` needs `Req` to implement `Default`, which it does not; plain `unwrap` is enough here.', MISS.apiSlip),
        ],
      },
      {
        id: 'slice-ref',
        edit: { line: 4, text: 'fn oldest(r: &[Req; 3], i: usize) -> Req {' },
        expect: { code: 'E0508', line: 5 },
        why: 'Through a reference the array has R only, and an element of an array never has O in any case; `r[i]` by value needs it.',
        focus: { line: 5, path: 'r[i]', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'field-of-slot',
        edit: { line: 5, text: '    Req { prompt: r[i].prompt }' },
        expect: { code: 'E0508', line: 5 },
        why: 'Moving the `prompt` field out of `r[i]` needs O of that element, and array elements never have it.',
        focus: { line: 5, path: 'r[i].prompt', needs: ['read', 'own'] },
        permission: 'own',
      },
    ],
  },

  {
    id: 'name-pair-array',
    kcs: [OM],
    title: 'Add up the lengths of two names in an array',
    domain: 'Replica',
    base: rs`
      fn pair(ns: [String; 2]) -> usize {
          let a = &ns[0];
          let b = &ns[1];
          a.len() + b.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Both borrows need only R of an element, which an array holds, and they can be alive together.',
      },
      {
        id: 'move-first',
        edit: { line: 2, text: '    let a = ns[0];' },
        expect: { code: 'E0508', line: 2 },
        why: 'An element of an array has R and W but never O, because rustc cannot track which elements left; `let a = ns[0]` moves the string out.',
        focus: { line: 2, path: 'ns[0]', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('borrow-first', 2, '    let a = &ns[0];', 'A `&String` needs only R, which every element has.'),
          cloned('clone-first', 2, '    let a = ns[0].clone();', 'It copies the first name to read its length.'),
          bad('into-bytes', 2, '    let a = ns[0].into_bytes();', '`into_bytes` takes the string by value, so it still moves it out of the array.', MISS.selfBorrows),
          bad('deref-first', 2, '    let a = *ns[0];', 'Dereferencing a `String` gives a `str`, whose size is unknown, so it cannot be bound by value.', MISS.derefMoves),
        ],
      },
      {
        id: 'move-second',
        edit: { line: 3, text: '    let b = ns[1];' },
        expect: { code: 'E0505', line: 3 },
        why: 'rustc treats every index of an array as one place, so `a` borrowing `ns[0]` also borrows `ns[1]`: the element has lost O, and `let b = ns[1]` moves it.',
        focus: { line: 3, path: 'ns[1]', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'into-iter-first',
        edit: { line: 2, text: '    let a = ns.into_iter().next().unwrap();' },
        expect: { code: 'E0382', line: 3 },
        why: '`into_iter` consumes the whole array, so line 2 moved `ns`, and `&ns[1]` on line 3 needs an R it lost.',
        focus: { line: 3, path: 'ns', needs: ['read'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'encode-twice-by-value',
    kcs: [OM, CCD],
    title: 'Encode the same batch twice',
    domain: 'Tokenizer',
    base: rs`
      fn encode(ids: impl AsRef<[u32]>) -> usize {
          ids.as_ref().len()
      }

      fn run(batch: Vec<u32>) -> usize {
          let a = encode(&batch);
          let b = encode(&batch);
          a + b
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`impl AsRef<[u32]>` accepts a `&Vec<u32>` too, and a shared borrow needs only R, so both calls leave `batch` whole.',
      },
      {
        id: 'first-by-value',
        edit: { line: 6, text: '    let a = encode(batch);' },
        expect: { code: 'E0382', line: 7 },
        why: '`encode(batch)` passes the vector by value, which moves it; `&batch` on line 7 needs R that the moved path lost.',
        focus: { line: 7, path: 'batch', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('borrow-arg', 6, '    let a = encode(&batch);', 'Passing `&batch` lends R for the call, and `batch` keeps its O.'),
          cloned('clone-arg', 6, '    let a = encode(batch.clone());', 'It copies every id so that `encode` can consume a vector it only measures.'),
          bad('mut-arg', 6, '    let a = encode(&mut batch);', '`batch` is not declared `mut`, so it has no W to lend, and `encode` only needs to read.', MISS.mutCures),
          bad('deref-arg', 6, '    let a = encode(*&batch);', '`*&batch` is the vector itself again, so passing it by value still moves it out of a borrow.', MISS.derefMoves),
        ],
      },
      {
        id: 'mut-borrow',
        edit: { line: 7, text: '    let b = encode(&mut batch);' },
        expect: { code: 'E0596', line: 7 },
        why: '`batch` is not declared `mut`, so it has no W, and `&mut batch` needs it.',
        focus: { line: 7, path: 'batch', needs: ['read', 'write'] },
        permission: 'write',
      },
      {
        id: 'both-by-value',
        edit: { line: 6, text: '    let a = encode(batch); let _ = &batch;' },
        expect: { code: 'E0382', line: 6 },
        why: '`encode(batch)` moved the vector, so the borrow `&batch` in the same line needs an R it lost.',
        focus: { line: 6, path: 'batch', needs: ['read'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'session-insert-key',
    kcs: [OM, CCD],
    title: 'Open a session and report it',
    domain: 'SessionTable',
    base: rs`
      use std::collections::HashMap;
      type Map = HashMap<String, u32>;

      fn open(m: &mut Map, id: String) {
          let n = id.len();
          m.insert(id, 1);
          println!("open {n}");
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'The id length is read before `insert` moves the string into the map, and nothing touches `id` afterwards.',
      },
      {
        id: 'print-id',
        edit: { line: 7, text: '    println!("open {id}");' },
        expect: { code: 'E0382', line: 7 },
        why: '`insert(id, 1)` moved the string into the map as the key, so `id` has no R left for the print on line 7.',
        focus: { line: 7, path: 'id', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('print-len', 7, '    println!("open {n}");', 'The length was read on line 5, before the move, so line 7 touches nothing of `id`.'),
          cloned('clone-key', 6, '    m.insert(id.clone(), 1);', 'It stores a copy of the id as the key so that the original can be printed once.'),
          bad('ref-key', 6, '    m.insert(&id, 1);', 'The map owns `String` keys, and a `&String` is not one.', MISS.refEverywhere),
        ],
      },
      {
        id: 'insert-twice',
        edit: { line: 7, text: '    m.insert(id, 2);' },
        expect: { code: 'E0382', line: 7 },
        why: 'The first `insert` moved `id` into the map, so a second move needs R and O that it no longer holds.',
      },
      {
        id: 'get-after-insert',
        edit: { line: 7, text: '    println!("{:?}", m.get(&id));' },
        expect: { code: 'E0382', line: 7 },
        why: 'The map took `id` on line 6, so `&id` on line 7 borrows a path that has no R.',
        focus: { line: 7, path: 'id', needs: ['read'] },
        permission: 'read',
      },
    ],
  },

  {
    id: 'extend-moves-batch',
    kcs: [OM, CCD],
    title: 'Merge a batch into another and count both',
    domain: 'Batch',
    base: rs`
      type V = Vec<u64>;
      fn merge(mut a: V, b: V) -> usize {
          a.extend(b);
          a.len() + b.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: { code: 'E0382', line: 4 },
        why: '`extend` takes any `IntoIterator` by value, so `a.extend(b)` moved the vector `b`, and `b.len()` on line 4 needs an R it lost.',
        focus: { line: 4, path: 'b', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('extend-ref', 3, '    a.extend(&b);', 'Extending from `&b` borrows each id, which a `u64` can copy, so `b` keeps its permissions.'),
          cloned('clone-arg', 3, '    a.extend(b.clone());', 'It copies the whole vector to feed `extend`, which could read the originals.'),
          bad('append', 3, '    a.append(b);', '`append` takes a `&mut Vec`, not a `Vec`, and it would empty `b` as well.', MISS.refEverywhere),
          drift('len-only', 4, '    a.len()', 'It compiles because nothing reads `b` any more, but the result no longer adds the length of `b`.'),
        ],
      },
      {
        id: 'chain-moves',
        edit: { line: 3, text: '    a.extend(b.into_iter());' },
        expect: { code: 'E0382', line: 4 },
        why: '`into_iter` takes the vector by value, so line 3 moved `b`, and `b.len()` on line 4 needs R.',
        focus: { line: 4, path: 'b', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'append-immutable',
        edit: { line: 3, text: '    a.append(&mut b);' },
        expect: { code: 'E0596', line: 3 },
        why: '`b` is not declared `mut`, so it has no W, and `&mut b` needs it.',
        focus: { line: 3, path: 'b', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'draft-params-update',
    kcs: [OM, CCD],
    title: 'Draft new sampling params from old ones',
    domain: 'SamplingParams',
    base: rs`
      #[derive(Clone)]
      struct Params {
          k: u32,
          stop: String,
      }

      fn draft(b: Params) -> usize {
          let p = Params { k: 1, ..b };
          p.stop.len() + b.k as usize
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`..b` moves only the fields not named, so `b.stop` leaves; `b.k` is a Copy field that was not moved, and reading it stays legal.',
      },
      {
        id: 'read-stop',
        edit: { line: 9, text: '    p.stop.len() + b.stop.len()' },
        expect: { code: 'E0382', line: 9 },
        why: '`..b` on line 8 moved `b.stop` into `p`, so the field has no R left for `b.stop.len()`.',
        focus: { line: 9, path: 'b.stop', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('read-p', 9, '    p.stop.len() * 2', 'The string lives in `p` now, which holds the R that `len` needs.'),
          cloned('clone-update', 8, '    let p = Params { k: 1, ..b.clone() };', 'It copies the stop string into `p` so that `b` keeps its own, though only one of them is read.'),
          bad('two-reads', 9, '    p.stop.len() + b.stop.len() * 2', 'The extra term still reads `b.stop`, which line 8 moved.', MISS.alias),
          drift('zero', 9, '    0', 'It compiles because nothing reads `p` or `b` any more, but the result is 0.'),
        ],
      },
      {
        id: 'pass-whole',
        edit: { line: 9, text: '    let q = b; p.stop.len()' },
        expect: { code: 'E0382', line: 9 },
        why: '`b.stop` already left in line 8, so moving `b` as a whole needs the O of a field that is gone.',
      },
      {
        id: 'update-twice',
        edit: { line: 9, text: '    let q = Params { k: 2, ..b }; 0' },
        expect: { code: 'E0382', line: 9 },
        why: 'A second `..b` would move `b.stop` again, but the first update on line 8 already took it.',
      },
    ],
  },

  {
    id: 'retry-send-loop',
    kcs: [OM, CCD],
    title: 'Retry a send three times',
    domain: 'Router',
    base: rs`
      #[derive(Clone)]
      struct Request { id: u64, prompt: String }

      impl Request {
          fn send(self) -> u64 { self.id }
          fn peek(&self) -> u64 { self.id }
      }

      fn retry(req: Request) -> u64 {
          let mut last = 0;
          for _ in 0..3 {
              last = req.send();
          }
          last
      }
    `,
    variants: [
      {
        id: 'base',
        expect: { code: 'E0382', line: 12 },
        why: '`send(self)` takes the request by value, so the first pass moved `req`, and the second pass finds a path with no R and no O.',
        fixes: [
          good('peek', 12, '        last = req.peek();', '`peek(&self)` needs only R, so `req` keeps its O for every pass.'),
          cloned('clone-send', 12, '        last = req.clone().send();', 'It copies the whole request, prompt included, on every pass to feed a method that consumes it.'),
          bad('ref-send', 12, '        last = (&req).send();', 'A `&Request` gives R and never O, and `send(self)` needs O to take the request.', MISS.selfBorrows),
          bad('mut-param', 9, 'fn retry(mut req: Request) -> u64 {', '`mut` gives the binding W, but a move takes R, W and O alike, so the second pass still fails.', MISS.mutCures),
        ],
      },
      {
        id: 'ref-receiver',
        edit: { line: 12, text: '        last = (&req).send();' },
        expect: { code: 'E0507', line: 12 },
        why: 'A `&Request` gives R and never O, and `send(self)` takes the request by value, which needs O.',
        focus: { line: 12, path: 'req', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'send-then-peek',
        edit: { line: 12, text: '        last = req.send() + req.peek();' },
        expect: { code: 'E0382', line: 12 },
        why: '`req.send()` moves the request first, so `req.peek()` in the same line borrows a path with no R.',
      },
    ],
  },

  {
    id: 'cfg-expect-twice',
    kcs: [OM, CCD],
    title: 'Read the model name from an optional config twice',
    domain: 'Replica',
    base: rs`
      fn model_len(c: Option<String>) -> usize {
          let a = c.expect("m").len();
          let b = c.expect("m").len();
          a + b
      }
    `,
    variants: [
      {
        id: 'base',
        expect: { code: 'E0382', line: 3 },
        why: '`Option::expect` takes the option by value, so line 2 moved `c`, and the second `expect` needs R and O that it lost.',
        fixes: [
          good('as-deref', 2, '    let a = c.as_deref().expect("m").len();', 'It reads a view of the name, which needs only R, so line 3 can still take `c`.'),
          cloned('clone-opt', 2, '    let a = c.clone().expect("m").len();', 'It copies the model name just to measure it.'),
          bad('take-opt', 2, '    let a = c.take().expect("m").len();', '`take` needs W of `c`, and the parameter is not declared `mut`.', MISS.mutCures),
          bad('ref-opt', 2, '    let a = (&c).expect("m").len();', '`expect(self)` takes the option by value, which needs O; a `&Option` gives only R.', MISS.selfBorrows),
        ],
      },
      {
        id: 'view-after-move',
        edit: { line: 3, text: '    let b = c.as_deref().expect("m").len();' },
        expect: { code: 'E0382', line: 3 },
        why: 'Line 2 moved `c`, so the borrow `c.as_deref()` on line 3 needs an R that `c` no longer has.',
        focus: { line: 3, path: 'c', needs: ['read'] },
        permission: 'read',
      },
      {
        id: 'unwrap-or-default',
        edit: { line: 3, text: '    let b = c.unwrap_or_default().len();' },
        expect: { code: 'E0382', line: 3 },
        why: '`unwrap_or_default` also takes the option by value, and line 2 already moved it.',
      },
    ],
  },

  {
    id: 'route-iter-dropped',
    kcs: [OM, BR],
    title: 'Look up the first route, then free the table',
    domain: 'Router',
    base: rs`
      fn lookup(routes: Vec<String>) -> usize {
          let mut it = routes.iter();
          let first = it.next();
          let n = first.map(|s| s.len());
          drop(routes);
          n.unwrap_or(0)
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`first` is last used on line 4 and `n` holds only a length, so no borrow of `routes` is alive when `drop(routes)` needs O.',
      },
      {
        id: 'use-first-late',
        edit: { line: 6, text: '    first.map(|s| s.len()).unwrap_or(0)' },
        expect: { code: 'E0505', line: 5 },
        why: '`first` borrows an element of `routes` and is used on line 6, so `routes` has lost O until then; `drop(routes)` moves it.',
        focus: { line: 5, path: 'routes', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('use-len', 6, '    n.unwrap_or(0)', 'The length is already in `n`, so line 6 needs no borrow and `drop` finds `routes` free.'),
          cloned('clone-routes', 2, '    let mut it = routes.clone().iter();', 'The copy is a temporary that is dropped at the end of the line while `it` still borrows it.'),
          drift('drop-iter', 5, '    drop(it);', 'Dropping the iterator frees nothing: `routes` is no longer dropped on line 5.', MISS.dropEnds),
          bad('first-again', 6, '    first.map(|s| s.len()).unwrap_or(1)', 'It still reads `first`, which borrows `routes` across the drop.', MISS.dropEnds),
        ],
      },
      {
        id: 'iter-after-drop',
        edit: { line: 6, text: '    it.count()' },
        expect: { code: 'E0505', line: 5 },
        why: 'The iterator `it` borrows `routes` and is used on line 6, so `routes` has lost O when `drop(routes)` moves it on line 5.',
        focus: { line: 5, path: 'routes', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'into-iter-moved',
        edit: { line: 2, text: '    let mut it = routes.into_iter();' },
        expect: { code: 'E0382', line: 5 },
        why: '`into_iter` took the vector by value, so `routes` has no R, W or O left for `drop(routes)` on line 5.',
      },
    ],
  },

  {
    id: 'head-of-queue-index',
    kcs: [OM, CCD],
    title: 'Hand back the head of a request queue',
    domain: 'Scheduler',
    base: rs`
      #[derive(Clone, Default)]
      struct Request { id: u64, prompt: String }

      fn head(q: &mut Vec<Request>) -> Request {
          q[0]
      }
    `,
    variants: [
      {
        id: 'base',
        expect: { code: 'E0507', line: 5 },
        why: 'An element of a vector has R and W through `&mut Vec`, but never O; returning `q[0]` by value moves it out.',
        focus: { line: 5, path: 'q[0]', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('remove-head', 5, '    q.remove(0)', '`remove` takes the element out and shifts the rest down, which a `&mut Vec` is allowed to do.'),
          cloned('clone-head', 5, '    q[0].clone()', 'It returns a copy and leaves the request in the queue, so it will be served twice.'),
          drift('pop-last', 5, '    q.pop().unwrap()', 'It compiles, but it hands back the last request, not the head.'),
          bad('first-deref', 5, '    *q.first().unwrap()', '`first` returns a reference, and `*` on it moves the request out again, which needs O.', MISS.derefMoves),
        ],
      },
      {
        id: 'shared-queue',
        edit: { line: 4, text: 'fn head(q: &Vec<Request>) -> Request {' },
        expect: { code: 'E0507', line: 5 },
        why: 'Through a `&Vec` the elements have R only, and returning `q[0]` by value needs O.',
        focus: { line: 5, path: 'q[0]', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'get-first',
        edit: { line: 5, text: '    *q.get(0).unwrap()' },
        expect: { code: 'E0507', line: 5 },
        why: '`get` hands out a `&Request`, and `*` on it moves the request out of the queue, which needs O.',
        focus: { line: 5, path: 'q', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'take-first',
        edit: { line: 5, text: '    std::mem::take(&mut q[0])' },
        expect: 'compiles',
        why: '`mem::take` swaps a default request into the slot and hands back the old one, so the queue keeps a valid element; it needs W, which `&mut Vec` has.',
      },
    ],
  },

  {
    id: 'sched-next-take',
    kcs: [OM, CCD],
    title: 'Admit the next request a scheduler holds',
    domain: 'Scheduler',
    base: rs`
      #[derive(Clone)]
      struct Req { id: u64 }
      struct Sched { next: Option<Req> }

      impl Sched {
          fn admit(&mut self) -> u64 {
              let r = self.next.take().unwrap();
              r.id
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`take` moves the request out and leaves a `None`, so `self.next` never loses O for good.',
      },
      {
        id: 'unwrap-field',
        edit: { line: 7, text: '        let r = self.next.unwrap();' },
        expect: { code: 'E0507', line: 7 },
        why: '`unwrap` takes the option by value, which needs O of `self.next`; behind `&mut self` the field has R and W but no O.',
        focus: { line: 7, path: 'self.next', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('take-unwrap', 7, '        let r = self.next.take().unwrap();', '`take` swaps a `None` in and hands the request out, so the scheduler stays valid.'),
          cloned('clone-next', 7, '        let r = self.next.clone().unwrap();', 'It copies the request and leaves the original in the scheduler, so it is admitted again next time.'),
          drift('as-ref', 7, '        let r = self.next.as_ref().unwrap();', 'It borrows the request instead of taking it, so the scheduler keeps it and admits it again.'),
          bad('ref-unwrap', 7, '        let r = &self.next.unwrap();', 'The `&` borrows the result, but `unwrap` still takes the option by value, which needs O.', MISS.refEverywhere),
        ],
      },
      {
        id: 'shared-self',
        edit: { line: 6, text: '    fn admit(&self) -> u64 {' },
        expect: { code: 'E0596', line: 7 },
        why: 'Through a `&Sched`, `self.next` has R but no W, and `take` borrows it `&mut`.',
        focus: { line: 7, path: 'self.next', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          good('mut-self', 6, '    fn admit(&mut self) -> u64 {', 'A `&mut self` carries W for every field, so `take` can swap in a `None`.'),
          drift('as-ref', 7, '        let r = self.next.as_ref().unwrap();', 'It needs only R, so it compiles, but the request stays in the scheduler and is admitted again.'),
          bad('extra-param', 6, '    fn admit(&self, n: u64) -> u64 {', 'A new parameter changes nothing about the borrow of `self`, so `take` still lacks W.', MISS.mutCures),
        ],
      },
      {
        id: 'expect-moves',
        edit: { line: 7, text: '        let r = self.next.expect("x");' },
        expect: { code: 'E0507', line: 7 },
        why: '`expect` also takes the option by value, and `self.next` has no O behind `&mut self`.',
        focus: { line: 7, path: 'self.next', needs: ['read', 'own'] },
        permission: 'own',
      },
    ],
  },

  {
    id: 'params-builder-chain',
    kcs: [OM, CCD],
    title: 'Set a field through a consuming builder method',
    domain: 'SamplingParams',
    base: rs`
      #[derive(Clone)]
      struct Params { n: u32, p: String }

      impl Params {
          fn n(self, n: u32) -> Params {
              Params { n, ..self }
          }
          fn len(&self) -> usize { self.p.len() }
      }

      fn build(b: Params) -> usize {
          b.n(8);
          b.len()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: { code: 'E0382', line: 13 },
        why: '`n(self, ..)` takes the params by value, so line 12 moved `b` and threw the result away; `b.len()` on line 13 needs an R it lost.',
        focus: { line: 13, path: 'b', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('rebind', 12, '    let b = b.n(8);', 'The method gives the params back, so rebinding the result keeps one owner and `b.len()` reads it.'),
          cloned('clone-recv', 12, '    b.clone().n(8);', 'It compiles, but the setter runs on a copy that is dropped at once, so the setting is lost.'),
          bad('ref-recv', 12, '    (&b).n(8);', 'A `&Params` gives R and never O, and `n(self, ..)` needs O to take the params.', MISS.selfBorrows),
          bad('discard', 12, '    let _ = b.n(8);', 'The result is discarded but `b` is still moved into the call, so line 13 reads a moved path.', MISS.alias),
        ],
      },
      {
        id: 'ref-receiver',
        edit: { line: 12, text: '    (&b).n(8);' },
        expect: { code: 'E0507', line: 12 },
        why: 'A `&Params` gives R and never O, and `n(self, ..)` takes the params by value, which needs O.',
        focus: { line: 12, path: 'b', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'assign-field',
        edit: { line: 12, text: '    b.n = 8;' },
        expect: { code: 'E0594', line: 12 },
        why: '`b` is not declared `mut`, so its fields have no W, and the assignment needs it.',
        focus: { line: 12, path: 'b.n', needs: ['write'] },
        permission: 'write',
        fixes: [
          good('mut-param', 11, 'fn build(mut b: Params) -> usize {', 'Declaring the parameter `mut` gives its fields the W that the assignment needs.'),
          bad('ref-assign', 12, '    (&mut b).n = 8;', 'A `&mut` borrow needs the W the binding lacks.', MISS.mutCures),
          bad('ref-param', 11, 'fn build(ref b: Params) -> usize {', '`ref` binds a reference to the argument, which gives R only, so the assignment still lacks W.', MISS.mutCures),
        ],
      },
    ],
  },

  {
    id: 'rotate-reinit-binding',
    kcs: [OM, CCD],
    title: 'Rotate the active batch for the next one',
    domain: 'Batch',
    base: rs`
      type V = Vec<u32>;
      fn rotate(mut cur: V, next: V) -> V {
          let old = cur;
          cur = next;
          old
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Moving `cur` out takes its R, W and O, but assigning a new value to a `mut` binding gives them back, so `cur = next` is legal.',
      },
      {
        id: 'read-moved',
        edit: { line: 4, text: '    let n = cur.len(); cur = next;' },
        expect: { code: 'E0382', line: 4 },
        why: '`cur` was moved on line 3 and has not been given a new value yet, so `cur.len()` reads a path with no R.',
        focus: { line: 4, path: 'cur', needs: ['read'] },
        permission: 'read',
        fixes: [
          good('assign-only', 4, '    cur = next;', 'Assigning first brings R, W and O back, and nothing reads the moved vector.'),
          cloned('clone-old', 3, '    let old = cur.clone();', 'It copies the whole batch so that `cur` stays readable for one length.'),
          bad('ref-old', 3, '    let old = &cur;', 'It borrows instead of moving, but the function returns a `Vec`, not a `&Vec`.', MISS.refEverywhere),
        ],
      },
      {
        id: 'immutable-reinit',
        edit: { line: 2, text: 'fn rotate(cur: V, next: V) -> V {' },
        expect: { code: 'E0384', line: 4 },
        why: 'A binding not declared `mut` has no W, and a moved binding does not get one back: `cur = next` is an assignment to it.',
        focus: { line: 4, path: 'cur', needs: ['write'] },
        permission: 'write',
        fixes: [
          good('mut-param', 2, 'fn rotate(mut cur: V, next: V) -> V {', 'Declaring the parameter `mut` gives it W, so it can hold a new value after the move.'),
          bad('ref-param', 2, 'fn rotate(ref cur: V, next: V) -> V {', '`ref` binds a reference to the argument, which is not a `V` any more, and it still gives R only.', MISS.mutCures),
          bad('clone-from', 4, '    cur.clone_from(&next);', '`clone_from` borrows `cur`, which line 3 moved, and it needs `&mut` access as well.', MISS.mutCures),
        ],
      },
      {
        id: 'move-twice',
        edit: { line: 4, text: '    let again = cur; cur = next;' },
        expect: { code: 'E0382', line: 4 },
        why: '`cur` was moved on line 3 and is only given a value after this line, so a second move needs R and O it lost.',
      },
    ],
  },

  {
    id: 'swap-table-ids',
    kcs: [OM, CCD],
    title: 'Swap the block ids of two tables',
    domain: 'KvBlockTable',
    base: rs`
      struct Table { ids: Vec<u32> }

      fn swap_ids(a: &mut Table, b: &mut Table) {
          std::mem::swap(&mut a.ids, &mut b.ids);
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`mem::swap` exchanges two places without moving either out, so each field has a value at every moment.',
      },
      {
        id: 'assign-move',
        edit: { line: 4, text: '    a.ids = b.ids;' },
        expect: { code: 'E0507', line: 4 },
        why: '`b.ids` has R and W through `&mut Table` but no O, and `a.ids = b.ids` moves it out and leaves `b` without a vector.',
        focus: { line: 4, path: 'b.ids', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('swap', 4, '    std::mem::swap(&mut a.ids, &mut b.ids);', 'The swap keeps a vector in both places, so neither table is ever left without one.'),
          cloned('clone-ids', 4, '    a.ids = b.ids.clone();', 'It copies the ids and leaves `b` holding the same blocks, so two tables now own the same ids.'),
          bad('deref-ids', 4, '    a.ids = *b.ids;', 'Dereferencing a `Vec` gives a slice, whose size is unknown, so it cannot be assigned.', MISS.derefMoves),
          bad('swap-value', 4, '    std::mem::swap(&mut a.ids, b.ids);', '`swap` wants two `&mut Vec`, and `b.ids` is a `Vec`, not a mutable reference to one.', MISS.refEverywhere),
        ],
      },
      {
        id: 'swap-shared',
        edit: { line: 3, text: 'fn swap_ids(a: &mut Table, b: &Table) {' },
        expect: { code: 'E0596', line: 4 },
        why: 'Through a `&Table`, `b.ids` has R but no W, and `swap` borrows both places `&mut`.',
        focus: { line: 4, path: 'b.ids', needs: ['read', 'write'] },
        permission: 'write',
        fixes: [
          good('mut-b', 3, 'fn swap_ids(a: &mut Table, b: &mut Table) {', 'A `&mut Table` carries the W that `swap` needs on both sides.'),
          cloned('clone-ids', 4, '    a.ids = b.ids.clone();', 'It reads `b` with R and copies the ids, so `a` gets them but `b` keeps its own and nothing is swapped.'),
          bad('ref-param', 3, 'fn swap_ids(a: &mut Table, ref b: &Table) {', '`ref` binds one more reference, which still gives R only, so `swap` still lacks W on `b.ids`.', MISS.mutCures),
        ],
      },
      {
        id: 'same-table',
        edit: { line: 4, text: '    std::mem::swap(&mut a.ids, &mut a.ids);' },
        expect: { code: 'E0499', line: 4 },
        why: 'Both arguments borrow `a.ids` `&mut`, and two `&mut` borrows of one place cannot be alive at once.',
      },
    ],
  },

  {
    id: 'tail-byte-then-own',
    kcs: [OM, BR],
    title: 'Peek at the last byte, then take the buffer',
    domain: 'Request',
    base: rs`
      fn pad(buf: Vec<u8>) -> usize {
          let tail = buf.last();
          let owned = buf;
          owned.len() + tail.is_some() as usize
      }
    `,
    variants: [
      {
        id: 'base',
        expect: { code: 'E0505', line: 3 },
        why: '`tail` borrows an element of `buf` and is used on line 4, so `buf` has lost W and O until then; `let owned = buf` moves it.',
        focus: { line: 3, path: 'buf', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('copy-tail', 2, '    let tail = buf.last().copied();', 'A `u8` is Copy, so `tail` holds its own copy and `buf` is free to move.'),
          cloned('clone-buf', 3, '    let owned = buf.clone();', 'It copies every byte of the buffer so that a second name can own what the first one still borrows.'),
          bad('last-mut', 2, '    let tail = buf.last_mut();', '`buf` is not declared `mut`, and a `&mut` borrow would take R as well as W and O.', MISS.mutCures),
          drift('first-byte', 2, '    let tail = buf.first().copied();', 'It compiles, but it looks at the first byte, not the last.'),
        ],
      },
      {
        id: 'copy-tail',
        edit: { line: 2, text: '    let tail = buf.last().copied();' },
        expect: 'compiles',
        why: '`copied` turns the borrowed `Option<&u8>` into an owned `Option<u8>`, so no borrow of `buf` is alive when it moves.',
      },
      {
        id: 'into-boxed',
        edit: { line: 3, text: '    let owned = buf.into_boxed_slice();' },
        expect: { code: 'E0505', line: 3 },
        why: '`into_boxed_slice` takes the vector by value while `tail` still borrows it, so `buf` has no O to give.',
        focus: { line: 3, path: 'buf', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'mut-tail',
        edit: { line: 2, text: '    let tail = buf.last_mut();' },
        expect: { code: 'E0596', line: 2 },
        why: '`buf` is not declared `mut`, so it has no W, and `last_mut` borrows it `&mut`.',
        focus: { line: 2, path: 'buf', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'radix-node-depth',
    kcs: [OM, CCD],
    title: 'Measure how deep a prefix-cache node goes',
    domain: 'RadixNode',
    base: rs`
      #[derive(Clone)]
      struct Node {
          key: String,
          kids: Vec<Node>,
      }

      fn depth(n: &Node) -> usize {
          match n.kids.first() {
              Some(k) => 1 + depth(&k),
              _ => 1,
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`first` hands out a `&Node`, which needs only R of the child, so the tree stays whole.',
      },
      {
        id: 'owned-kids',
        edit: { line: 8, text: '    match n.kids.into_iter().next() {' },
        expect: { code: 'E0507', line: 8 },
        why: '`into_iter` takes the children by value, which needs O of `n.kids`; behind `&Node` the field has R only.',
        focus: { line: 8, path: 'n.kids', needs: ['read', 'own'] },
        permission: 'own',
        fixes: [
          good('first-kid', 8, '    match n.kids.first() {', '`first` borrows the first child, which needs only R.'),
          cloned('clone-kids', 8, '    match n.kids.clone().pop() {', 'It copies every subtree of the node, and then looks at the last child of the copy instead of the first.'),
          bad('deref-kids', 8, '    match (*n).kids.pop() {', '`(*n)` is the node, still behind the reference, and `pop` needs W of its children.', MISS.mutCures),
          bad('remove-kid', 8, '    match n.kids.remove(0) {', '`remove` shifts the children down, so it needs W, and it returns a `Node`, not an `Option`.', MISS.mutCures),
        ],
      },
      {
        id: 'move-key',
        edit: { line: 8, text: '    let key = n.key; match n.kids.first() {' },
        expect: { code: 'E0507', line: 8 },
        why: '`n` is a `&Node`, so `n.key` has R but no O; `let key = n.key` moves the string out of the tree.',
        focus: { line: 8, path: 'n.key', needs: ['read', 'own'] },
        permission: 'own',
      },
      {
        id: 'drain-kids',
        edit: { line: 8, text: '    match n.kids.drain(..).next() {' },
        expect: { code: 'E0596', line: 8 },
        why: '`drain` removes the children, so it borrows `n.kids` `&mut`, which needs W; a `&Node` has R only.',
        focus: { line: 8, path: 'n.kids', needs: ['read', 'write'] },
        permission: 'write',
      },
    ],
  },

  {
    id: 'first-big-uninit',
    kcs: [OM],
    title: 'Return the first latency above a threshold',
    domain: 'LatencyWindow',
    base: rs`
      fn first_big(xs: &[u32]) -> u32 {
          let found: u32;
          for &x in xs {
              if x > 9 {
                  found = x;
                  break;
              }
          }
          found
      }
    `,
    variants: [
      {
        id: 'base',
        expect: { code: 'E0381', line: 9 },
        why: 'If no sample is above 9 the loop ends without assigning `found`, so line 9 reads a binding that may hold no value yet.',
        fixes: [
          good('init-mut', 2, '    let mut found = 0;', 'The binding starts with a value and has W for the assignment in the loop, so line 9 always reads something.'),
          bad('init-only', 2, '    let found: u32 = 0;', 'The binding now has a value, but without `mut` it has no W for the assignment on line 5.', MISS.mutCures),
          bad('mut-only', 2, '    let mut found: u32;', '`mut` gives W but no value, so an empty loop still leaves `found` unassigned on line 9.', MISS.mutCures),
          drift('return-zero', 9, '    0', 'It compiles because nothing reads `found` any more, but it returns 0 even when a sample is above 9.'),
        ],
      },
      {
        id: 'assign-no-break',
        edit: { line: 6, text: '            println!("hit");' },
        expect: { code: 'E0384', line: 5 },
        why: 'Without the `break`, the loop can assign `found` again on the next pass, and a binding not declared `mut` has no W for a second value.',
        focus: { line: 5, path: 'found', needs: ['write'] },
        permission: 'write',
      },
      {
        id: 'read-in-loop',
        edit: { line: 4, text: '        if found > 9 {' },
        expect: { code: 'E0381', line: 4 },
        why: '`found` is declared on line 2 without a value and nothing has assigned it yet on the first pass, so line 4 reads a binding that holds nothing.',
      },
    ],
  },

]
