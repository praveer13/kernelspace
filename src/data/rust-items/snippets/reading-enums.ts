/**
 * The `reading-enums` group of the compile bank (docs/specs/serving-reading.md §4): serving-first reading items on
 * r.enums-option-result. A Rust serving stack says "maybe nothing" with `Option` and "it can fail" with `Result`: an
 * allocator that can run dry, a table lookup past its end, a request state, a full queue that hands the request back,
 * a pin that can hit memory pressure. The learner reads the code and names rustc's verdict or the one-line fix.
 *
 * Reader voice (§4.1): the learner skipped Rust Zero, so the whys say what the code does in plain words (owns, lends,
 * moves, hands back) and never use the Read/Write/Own labels of R3. No variant carries a permission label or a focus.
 * Every snippet lists reading KCs only, so no legacy pool moves. Fix sets have exactly one fix that compiles and keeps
 * what the code does; every other fix that compiles is a labelled lure whose why says what it changes.
 */

import { rs, type RustSnippet, type SnippetFix } from '../types'

const E = 'r.enums-option-result'
const I = 'r.iterators-ownership'
const S = 'r.smart-pointers'

/** Misconceptions a wrong fix records when a learner picks it (a clone lure records `r.clone-to-silence`). */
const MISS = {
  /** `.unwrap()` is taken to handle the empty case, rather than to panic on it. */
  unwrapHandles: 'r.unwrap-handles-none',
  /** A `_` arm is taken to be harmless, whatever it now catches. */
  wildcardSafe: 'r.wildcard-is-safe',
  /** Changing what the code returns is taken to be a fix. */
  changesBehaviour: 'r.fix-changes-meaning',
  /** `&` or `*` is added wherever rustc complains, whatever type the code wants. */
  refEverywhere: 'r.ref-fixes-all',
  /** A full or closed queue is allowed to drop the request it was handed (the t5.l10 spiral's misconception). */
  fullDrops: 't3.full-drops-silently',
} as const

const at = (line: number, text: string) => ({ line, text })
/** The one fix that compiles and keeps what the code does. */
const good = (id: string, line: number, text: string, why: string): SnippetFix => ({ id, edit: at(line, text), ok: true, why })
/** A wrong fix that rustc rejects. */
const bad = (id: string, line: number, text: string, why: string, miss?: string): SnippetFix => ({ id, edit: at(line, text), ok: false, why, ...(miss ? { miss } : {}) })
/** A wrong fix that adds `.clone()`. */
const cloned = (id: string, line: number, text: string, why: string): SnippetFix => ({ id, edit: at(line, text), ok: false, lure: 'clone', why })
/** A wrong fix that compiles and changes what the code does, without a clone. */
const drift = (id: string, line: number, text: string, why: string, miss: string = MISS.changesBehaviour): SnippetFix => ({ id, edit: at(line, text), ok: false, lure: 'other', why, miss })

export const SNIPPETS: RustSnippet[] = [
  {
    id: 'alloc-option-admit',
    kcs: [E],
    title: 'Admit a request only if every block it needs is free',
    domain: 'BlockPool',
    base: rs`
      struct Pool { free: Vec<u32> }

      impl Pool {
          fn alloc(&mut self) -> Option<u32> {
              self.free.pop()
          }
      }

      fn admit(p: &mut Pool, n: usize)
          -> Option<Vec<u32>> {
          let mut got = Vec::new();
          for _ in 0..n {
              got.push(p.alloc()?);
          }
          Some(got)
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`alloc` says "the pool is empty" with `None`, and the `?` on line 13 hands that `None` straight back to whoever called `admit`. The blocks already in `got` are dropped with it, not put back.',
      },
      {
        id: 'no-q',
        edit: { line: 13, text: '        got.push(p.alloc());' },
        expect: { code: 'E0308', line: 15 },
        why: 'Without `?`, `got` collects the `Option<u32>` values themselves, so `Some(got)` on line 15 is not the `Option<Vec<u32>>` that line 10 promises.',
        fixes: [
          good('question', 13, '        got.push(p.alloc()?);', '`?` takes the block id out of `Some`, or returns `None` from `admit` at the first empty pop, so `got` holds plain ids again.'),
          drift('unwrap', 13, '        got.push(p.alloc().unwrap());', 'An empty pool now panics the scheduler thread, where the code meant to hand `None` back so the request can wait.', MISS.unwrapHandles),
          bad('some-q', 15, '    Some(got?)', '`?` looks inside an `Option` or a `Result`, and `got` is a `Vec`; line 13 still pushes `Option` values.'),
        ],
      },
      {
        id: 'ok-or-q',
        edit: { line: 13, text: '        got.push(p.alloc().ok_or(0u32)?);' },
        expect: { code: 'E0277', line: 13 },
        why: '`ok_or` turns the `Option` into a `Result` with `0` as its error, and a `?` on a `Result` hands back that error; `admit` returns an `Option`, which has no way to carry it.',
        fixes: [
          good('question', 13, '        got.push(p.alloc()?);', 'Without `ok_or`, the `?` works on the `Option` itself: it takes the block id out of `Some`, or returns `None` from `admit` at the first empty pop.'),
          bad('plain', 13, '        got.push(p.alloc());', 'Without `?`, `got` collects the `Option<u32>` values themselves, so `Some(got)` on line 15 is not the `Option<Vec<u32>>` that line 10 promises.'),
          drift('unwrap', 13, '        got.push(p.alloc().unwrap());', 'An empty pool now panics the scheduler thread, where the code meant to hand `None` back so the request can wait.', MISS.unwrapHandles),
        ],
      },
      {
        id: 'shared-self',
        edit: { line: 4, text: '    fn alloc(&self) -> Option<u32> {' },
        expect: { code: 'E0596', line: 5 },
        why: '`pop` takes a block off the free list, which changes the pool, and `&self` lends the pool only for reading.',
        fixes: [
          good('mut-self', 4, '    fn alloc(&mut self) -> Option<u32> {', '`&mut self` lends the pool for changing, which `pop` needs; `admit` already holds a `&mut Pool` to lend.'),
          cloned('clone-pop', 5, '        self.free.clone().pop()', 'It pops from a copy of the free list, so the pool never shrinks and every call hands out the same block.'),
          drift('none', 5, '        None', 'The pool now always says it is empty, so no request is ever admitted.'),
        ],
      },
    ],
  },
  {
    id: 'translate-get-match',
    kcs: [E],
    title: 'Translate a token position to its physical block',
    domain: 'KvBlockTable',
    base: rs`
      fn phys(t: &[u32], tok: usize) -> u32 {
          match t.get(tok / 16) {
              Some(b) => *b,
              None => u32::MAX,
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`get` returns `Some` with the block id while the table is long enough and `None` past its end. The `match` names both, so a position past the table maps to `u32::MAX`, never to a real block.',
      },
      {
        id: 'drop-none',
        edit: { line: 4, text: '        Some(_) => 0,' },
        expect: { code: 'E0004', line: 2 },
        why: 'No arm names `None` any more, so a position past the end of the table has no case, and a `match` on an `Option` must cover both.',
        fixes: [
          good('none-max', 4, '        None => u32::MAX,', 'Naming `None` again covers every case, and a position past the table still maps to the no-block value.'),
          drift('none-zero', 4, '        None => 0,', 'Block 0 is a real block, so a position past the table now reads another sequence\'s KV.'),
          bad('some-max', 4, '        Some(_) => u32::MAX,', 'Two `Some` arms still leave `None` without a case.'),
        ],
      },
      {
        id: 'index',
        edit: { line: 2, text: '    match t[tok / 16] {' },
        expect: { code: 'E0308', line: 3 },
        why: 'Indexing gives the `u32` itself (and panics past the end), so the `Some(b)` pattern on line 3 is matched against a plain number.',
        fixes: [
          good('get', 2, '    match t.get(tok / 16) {', '`get` returns `Option<&u32>`, which is what the `Some` and `None` arms match, and it never panics.'),
          bad('ref-index', 2, '    match &t[tok / 16] {', 'A reference to the number is still not an `Option`, so line 3 still does not fit.', MISS.refEverywhere),
          bad('some-index', 2, '    match Some(t[tok]) {', 'Now `b` is a plain `u32`, so `*b` on line 3 has no reference to follow; and indexing still panics past the end.'),
        ],
      },
      {
        id: 'no-deref',
        edit: { line: 3, text: '        Some(b) => b,' },
        expect: { code: 'E0308', line: 3 },
        why: '`get` lends the element, so `b` is a `&u32`, and the arm must give the `u32` the function returns.',
      },
    ],
  },
  {
    id: 'request-state-held',
    kcs: [E],
    title: 'Count the blocks each request state holds',
    domain: 'Request',
    base: rs`
      enum Req {
          Waiting,
          Running { n: usize },
          Preempted,
      }

      fn held(r: &Req) -> usize {
          match r {
              Req::Running { n } => *n,
              Req::Waiting => 0,
              Req::Preempted => 0,
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'A request\'s state is one `enum`, and `held` names all three states, so the code says what each one holds; only a running request holds blocks.',
      },
      {
        id: 'new-state',
        edit: { line: 4, text: '    Preempted, Swapped,' },
        expect: { code: 'E0004', line: 8 },
        why: 'Adding `Swapped` leaves `held` without an arm for it, so every `match` on a request state stops compiling until someone decides what a swapped request holds.',
      },
      {
        id: 'no-deref',
        edit: { line: 9, text: '        Req::Running { n } => n,' },
        expect: { code: 'E0308', line: 9 },
        why: '`r` is a reference, so the pattern binds `n` as a `&usize`, and the arm must give a `usize`.',
        fixes: [
          good('deref', 9, '        Req::Running { n } => *n,', '`*n` reads the number behind the reference; a `usize` is copied, so nothing moves.'),
          drift('one', 9, '        Req::Running { .. } => 1,', 'Every running request now counts as holding one block, whatever its size.'),
          bad('tuple', 9, '        Req::Running(n) => *n,', '`Running` has a named field, so a tuple pattern does not fit it.'),
        ],
      },
      {
        id: 'dup-arm',
        edit: { line: 11, text: '        Req::Waiting => 0,' },
        expect: { code: 'E0004', line: 8 },
        why: 'Line 11 now names `Waiting` a second time, so `Preempted` has no arm, and the repeated arm can never run.',
      },
    ],
  },
  {
    id: 'push-hands-back',
    kcs: [E],
    title: 'A full queue hands the request back',
    domain: 'AdmissionQueue',
    base: rs`
      struct Req(u32);
      type Q = Vec<Req>;

      fn push(q: &mut Q, r: Req) -> Option<Req> {
          if q.len() >= 4 { return Some(r); }
          q.push(r);
          None
      }

      fn admit(q: &mut Q, r: Req) -> u32 {
          match push(q, r) {
              None => 0,
              Some(b) => b.0,
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'A full queue hands the request back inside `Some`, so the caller owns it again and can retry or reject it; `None` means the queue kept it.',
      },
      {
        id: 'use-moved',
        edit: { line: 13, text: '        Some(_) => r.0,' },
        expect: { code: 'E0382', line: 13 },
        why: '`r` moved into `push` on line 11. When the queue is full the request comes back as the `Some` value; `r` itself is gone.',
        fixes: [
          good('bind-back', 13, '        Some(b) => b.0,', 'Binding the handed-back request as `b` reads the one the queue returned.'),
          drift('fake-id', 13, '        Some(_) => u32::MAX,', 'A rejected request now reports a made-up id, and the request itself is dropped.', MISS.fullDrops),
          bad('none-r', 13, '        None => r.0 as u32,', 'Now neither arm names `Some`, and `r` is still the request that moved into `push`.'),
        ],
      },
      {
        id: 'drop-none',
        edit: { line: 12, text: '        Some(_) => 1,' },
        expect: { code: 'E0004', line: 11 },
        why: 'Both arms now match `Some`, so the queued case, `None`, has no arm.',
        fixes: [
          good('none', 12, '        None => 0,', 'Naming `None` again covers the queued case.'),
          drift('wild', 12, '        _ => 0,', 'The `_` arm now catches every result first, so a rejected request also reports 0 and line 13 never runs.', MISS.wildcardSafe),
          bad('none-b', 12, '        None => b.0,', 'There is nothing to read in the queued case: `None` carries no request.'),
        ],
      },
      {
        id: 'bool-ret',
        edit: { line: 4, text: 'fn push(q: &mut Q, r: Req) -> bool {' },
        expect: { code: 'E0308', line: 5 },
        why: 'A `bool` cannot carry the request back: line 5 returns `Some(r)`, which is not a `bool`.',
      },
    ],
  },
  {
    id: 'sync-channel-offer',
    kcs: [E],
    title: 'Offer a request to a bounded channel',
    domain: 'AdmissionQueue',
    base: rs`
      use std::sync::mpsc::SyncSender;
      use std::sync::mpsc::TrySendError as E;

      struct Req(u32);

      fn offer(tx: &SyncSender<Req>, r: Req)
          -> Option<Req> {
          match tx.try_send(r) {
              Ok(()) => None,
              Err(E::Full(r)) => Some(r),
              Err(E::Disconnected(r)) => Some(r),
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`try_send` never waits: a full or closed channel hands the request back inside the error, and `offer` returns it to the caller.',
      },
      {
        id: 'use-moved',
        edit: { line: 10, text: '        Err(E::Full(_)) => Some(r),' },
        expect: { code: 'E0382', line: 10 },
        why: '`r` moved into `try_send` on line 8. The request comes back inside `E::Full`, and line 10 ignores it and reaches for the moved `r`.',
        fixes: [
          good('bind-back', 10, '        Err(E::Full(r)) => Some(r),', 'Binding the request inside `E::Full` returns the one the channel handed back.'),
          drift('drop-it', 10, '        Err(E::Full(_)) => None,', 'A full channel now drops the request and tells the caller it was sent.', MISS.fullDrops),
          bad('fresh', 10, '        Err(E::Full(_)) => Some(Req(r.0)),', 'Reading `r.0` still reads the request that moved into `try_send`.'),
        ],
      },
      {
        id: 'drop-disc',
        edit: { line: 11, text: '        Err(E::Full(_)) => None,' },
        expect: { code: 'E0004', line: 8 },
        why: 'No arm names `E::Disconnected` any more, so a closed channel has no case.',
        fixes: [
          good('disc-back', 11, '        Err(E::Disconnected(r)) => Some(r),', 'A closed channel hands the request back again, as a full one does.'),
          drift('err-any', 11, '        Err(_) => None,', 'A closed channel now swallows the request, which the caller never sees again.', MISS.fullDrops),
          bad('disc-r', 11, '        Err(E::Disconnected(_)) => Some(r),', '`r` moved into `try_send`; the request to return is the one inside the error.'),
        ],
      },
      {
        id: 'blocking',
        edit: { line: 8, text: '    match tx.send(r) {' },
        expect: { code: 'E0308', line: 10 },
        why: '`send` waits for room and its error has no `Full` case, so the `E::Full` pattern on line 10 does not fit.',
      },
    ],
  },
  {
    id: 'admit-two-pins',
    kcs: [E],
    title: 'Pin an adapter, then reserve KV',
    domain: 'Lease',
    base: rs`
      struct Pressure;
      struct Lease(usize);

      fn pin(free: &mut usize, n: usize)
          -> Result<Lease, Pressure> {
          if *free < n { return Err(Pressure); }
          *free -= n;
          Ok(Lease(n))
      }

      fn admit(free: &mut usize)
          -> Result<(Lease, Lease), Pressure> {
          let a = pin(free, 4)?;
          let kv = pin(free, 8)?;
          Ok((a, kv))
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'Each `?` hands a `Pressure` to the caller at once. If the second pin fails, `a` is dropped on the way out, and `Lease` has no `Drop`, so its 4 pages stay taken: `?` returns early, it does not undo.',
      },
      {
        id: 'ok-q',
        edit: { line: 13, text: '    let a = pin(free, 4).ok()?;' },
        expect: { code: 'E0277', line: 13 },
        why: '`ok` turns the `Result` into an `Option` and throws the `Pressure` away, so in a function that returns a `Result` this `?` has no error to hand back.',
        fixes: [
          good('question', 13, '    let a = pin(free, 4)?;', 'Without `ok`, the `?` works on the `Result` itself: it takes the `Lease` out of `Ok`, or returns the `Pressure` at once.'),
          bad('ok-a', 13, '    let a = pin(free, 4).ok();', 'Without `?`, `a` is an `Option<Lease>`, so the tuple on line 15 holds an `Option` where a `Lease` belongs.'),
          drift('ok-unwrap', 13, '    let a = pin(free, 4).ok().unwrap();', 'Pressure on the adapter pin now panics, where the code meant to hand the `Pressure` back to the caller.', MISS.unwrapHandles),
        ],
      },
      {
        id: 'string-err',
        edit: { line: 12, text: '    -> Result<(Lease, Lease), String> {' },
        expect: { code: 'E0277', line: 13 },
        why: '`?` converts the error it returns into the function\'s error type, and nothing converts a `Pressure` into a `String`.',
        fixes: [
          good('pressure-err', 12, '    -> Result<(Lease, Lease), Pressure> {', 'With `Pressure` as the error type, each `?` returns the error unchanged.'),
          bad('unwrap', 13, '    let a = pin(free, 4).unwrap();', '`unwrap` needs an error it can print, which `Pressure` is not, and it would panic on pressure instead of returning it.', 'r.unwrap-handles-none'),
          bad('box-err', 12, '    -> Result<(Lease, Lease), Box<str>> {', 'Nothing converts a `Pressure` into a `Box<str>` either.'),
        ],
      },
      {
        id: 'no-q',
        edit: { line: 13, text: '    let a = pin(free, 4);' },
        expect: { code: 'E0308', line: 15 },
        why: 'Without `?`, `a` is the whole `Result`, so the tuple on line 15 holds a `Result` where a `Lease` belongs.',
        fixes: [
          good('question', 13, '    let a = pin(free, 4)?;', '`?` takes the `Lease` out of `Ok`, or returns the `Pressure` at once.'),
          bad('ok-a', 13, '    let a = pin(free, 4).ok();', 'That turns the `Result` into an `Option<Lease>`, still not a `Lease`.'),
          bad('pin-ref', 13, '    let a = &pin(free, 4)?;', 'A reference to the lease is not the `Lease` the tuple holds.', MISS.refEverywhere),
        ],
      },
    ],
  },
  {
    id: 'slot-take',
    kcs: [E],
    title: 'Evict the request from a batch slot',
    domain: 'Scheduler',
    base: rs`
      struct Req(u32);

      struct Slot {
          req: Option<Req>,
      }

      fn evict(s: &mut Slot) -> Option<Req> {
          s.req.take()
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`take` moves the request out and leaves `None` in the slot, so a `&mut Slot` is enough: the slot stays valid, now empty.',
      },
      {
        id: 'move-out',
        edit: { line: 8, text: '    s.req' },
        expect: { code: 'E0507', line: 8 },
        why: 'The slot is only lent, so its request cannot be moved out and leave the slot with nothing in it.',
        fixes: [
          good('take', 8, '    s.req.take()', '`take` moves the request out and puts `None` in its place, so the lent slot is still whole.'),
          cloned('clone', 8, '    s.req.clone()', '`Req` cannot be cloned, and a copy would leave the request in the slot too, so it would run twice.'),
          bad('ref', 8, '    &s.req', 'That lends the slot\'s `Option`; the function promises the request itself.', MISS.refEverywhere),
        ],
      },
      {
        id: 'shared',
        edit: { line: 7, text: 'fn evict(s: &Slot) -> Option<Req> {' },
        expect: { code: 'E0596', line: 8 },
        why: '`take` changes the slot, and `&Slot` lends it only for reading.',
        fixes: [
          good('mut', 7, 'fn evict(s: &mut Slot) -> Option<Req> {', 'A `&mut Slot` lets `take` empty the slot as it hands the request out.'),
          drift('none', 8, '    None', 'Nothing is evicted: the request stays in its slot and keeps its blocks.'),
          bad('take-spelled', 8, '    Option::take(&mut s.req)', 'Spelling the call out still asks to change a slot lent only for reading.'),
        ],
      },
      {
        id: 'as-ref',
        edit: { line: 8, text: '    s.req.as_ref()' },
        expect: { code: 'E0308', line: 8 },
        why: '`as_ref` only lends the request, as an `Option<&Req>`, and the function promises the request itself.',
      },
    ],
  },
  {
    id: 'utf8-ready',
    kcs: [E],
    title: 'Show text only once a character is whole',
    domain: 'Tokenizer',
    base: rs`
      use std::str::from_utf8;

      // The text so far, or None while a
      // character is split across tokens.
      fn ready(buf: &[u8]) -> Option<&str> {
          match from_utf8(buf) {
              Ok(s) => Some(s),
              Err(_) => None,
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`from_utf8` returns a `Result`: `Ok` with the text when the bytes are whole UTF-8, `Err` when a character is cut off, and `ready` turns that into `Some` or `None`.',
      },
      {
        id: 'ok-raw',
        edit: { line: 7, text: '        Ok(s) => s,' },
        expect: { code: 'E0308', line: 7 },
        why: 'Every arm must give the function\'s type, `Option<&str>`, and line 7 gives a bare `&str`.',
        fixes: [
          good('some', 7, '        Ok(s) => Some(s),', 'Wrapping the text in `Some` gives the arm the function\'s type.'),
          bad('owned', 7, '        Ok(s) => Some(s.to_string()),', '`to_string` makes an owned `String`, and the function hands back a borrowed `&str`.'),
          bad('q', 7, '        Ok(s) => Some(s)?,', '`?` takes the text back out of the `Some`, so the arm gives a bare `&str` again.'),
        ],
      },
      {
        id: 'drop-err',
        edit: { line: 8, text: '        Ok(_) => None,' },
        expect: { code: 'E0004', line: 6 },
        why: 'Both arms now match `Ok`, so a cut-off character, the `Err` case, has no arm.',
        fixes: [
          good('err-none', 8, '        Err(_) => None,', 'Naming `Err` again covers the cut-off case, which waits for the next token.'),
          drift('empty', 8, '        _ => Some(""),', 'A half-received character now shows as an empty piece of text instead of waiting for the next token.', MISS.wildcardSafe),
          bad('ok-none', 8, '        Ok(None) => None,', 'The `Ok` value is text, not an `Option`, so a `None` pattern cannot match it; and the cut-off case still has no arm.'),
        ],
      },
      {
        id: 'str-ret',
        edit: { line: 5, text: 'fn ready(buf: &[u8]) -> &str {' },
        expect: { code: 'E0308', line: 7 },
        why: 'The function now promises a bare `&str`, and line 7 still wraps the text in `Some`.',
      },
      {
        id: 'owned-from',
        edit: { line: 6, text: '    match String::from_utf8(buf) {' },
        expect: { code: 'E0308', line: 6 },
        why: '`String::from_utf8` takes an owned `Vec<u8>`, and `buf` is only a borrowed slice.',
        fixes: [
          good('str-from', 6, '    match from_utf8(buf) {', '`str::from_utf8` reads the borrowed bytes in place and lends the text back.'),
          bad('to-vec', 6, '    match String::from_utf8(buf.to_vec()) {', 'The bytes are now copied, but `Ok` holds an owned `String`, and the function hands back a borrowed `&str`.'),
          bad('deref', 6, '    match String::from_utf8(*buf) {', '`*buf` is the bytes themselves, a slice with no fixed size, not the owned `Vec` that `String::from_utf8` takes.', MISS.refEverywhere),
        ],
      },
    ],
  },
  {
    id: 'parent-upgrade',
    kcs: [E, S],
    title: 'Read a radix node\'s parent, if it still exists',
    domain: 'PrefixCache',
    base: rs`
      use std::rc::{Rc, Weak};

      struct Node {
          parent: Weak<Node>,
          ids: Vec<u32>,
      }

      fn parent_len(n: &Node) -> usize {
          match n.parent.upgrade() {
              Some(p) => p.ids.len(),
              None => 0,
          }
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: 'A child holds a `Weak` link, so it never keeps its parent alive. `upgrade` gives `Some` with an `Rc` handle while the parent exists and `None` once eviction freed it, and the `match` says what `None` means.',
      },
      {
        id: 'no-upgrade',
        edit: { line: 9, text: '    match n.parent {' },
        expect: { code: 'E0308', line: 10 },
        why: 'A `Weak` is not an `Option`: the `Some` and `None` arms only fit what `upgrade` returns.',
        fixes: [
          good('upgrade', 9, '    match n.parent.upgrade() {', '`upgrade` asks whether the parent still exists and answers with an `Option`, which the arms match.'),
          bad('get', 9, '    match n.parent.get() {', 'A `Weak` has no `get`: the only way to reach the parent is `upgrade`, which may answer that it is gone.'),
          bad('some-weak', 9, '    match Some(&n.parent) {', 'Wrapping the link in `Some` does not check that the parent exists: a `Weak` has no `ids` to read until `upgrade` succeeds.'),
        ],
      },
      {
        id: 'drop-none',
        edit: { line: 11, text: '        Some(_) => 1,' },
        expect: { code: 'E0004', line: 9 },
        why: 'Both arms now match `Some`, so an evicted parent, the `None` case, has no arm.',
        fixes: [
          good('none-zero', 11, '        None => 0,', 'An evicted parent counts as no cached tokens, and every case is covered.'),
          drift('wild-one', 11, '        _ => 1,', 'An evicted parent now counts as one cached token.', MISS.wildcardSafe),
          bad('none-len', 11, '        None => p.ids.len(),', 'There is no `p` when the parent is gone: `None` carries nothing to read.'),
        ],
      },
      {
        id: 'move-out',
        edit: { line: 10, text: '        Some(p) => p.ids.into_iter().len(),' },
        expect: { code: 'E0507', line: 10 },
        why: '`p` is one `Rc` handle among the parent\'s owners, so `into_iter` cannot take the parent\'s `ids` away from the others.',
        fixes: [
          good('len', 10, '        Some(p) => p.ids.len(),', 'The length is readable through the handle; nothing has to move.'),
          cloned('clone-ids', 10, '        Some(p) => p.ids.clone().len(),', 'It copies every token id of the parent just to count them.'),
          bad('drain', 10, '        Some(p) => p.ids.drain(..).len(),', '`drain` would empty the list, and data behind an `Rc` is shared, so one handle cannot change it.'),
        ],
      },
    ],
  },
  {
    id: 'router-choose',
    kcs: [I, E],
    title: 'Route to the warmest worker within the load guard',
    domain: 'Router',
    base: rs`
      struct Worker {
          load: u32,
          hit: usize,
      }

      fn choose(ws: &[Worker]) -> Option<usize> {
          let min = ws.iter()
              .map(|w| w.load).min()?;
          ws.iter()
              .enumerate()
              .filter(|(_, w)| w.load <= min + 4)
              .max_by_key(|(_, w)| w.hit)
              .map(|(i, _)| i)
      }
    `,
    variants: [
      {
        id: 'base',
        expect: 'compiles',
        why: '`min()` gives `None` for an empty fleet, and `?` returns it at once. The chain does nothing until `max_by_key` pulls it through. `max_by_key` answers with an `Option` because a chain may yield nothing; here the least-loaded worker always passes the guard, so it is `Some`.',
      },
      {
        id: 'unwrap-tail',
        edit: { line: 13, text: '        .map(|(i, _)| i).unwrap()' },
        expect: { code: 'E0308', line: 9 },
        why: '`unwrap` takes the index out of the `Option`, and the function promises an `Option<usize>`.',
        fixes: [
          good('keep-option', 13, '        .map(|(i, _)| i)', 'The chain already answers with an `Option<usize>`, which is the return type.'),
          bad('unwrap-or', 13, '        .map(|(i, _)| i).unwrap_or(0)', 'That gives a plain `usize`, and the function promises an `Option<usize>`.', MISS.unwrapHandles),
          bad('some-and', 13, '        .is_some_and(|w| w.0 > 0)', '`is_some_and` answers yes or no, not which worker to route to.'),
        ],
      },
      {
        id: 'worker-out',
        edit: { line: 13, text: '        .map(|(_, w)| w)' },
        expect: { code: 'E0308', line: 9 },
        why: 'The chain now ends with a borrowed `&Worker`, and the function returns the worker\'s index.',
        fixes: [
          good('index', 13, '        .map(|(i, _)| i)', 'Keeping the index from `enumerate` gives the `Option<usize>` the caller routes by.'),
          drift('hit', 13, '        .map(|(_, w)| w.hit)', 'It returns the winner\'s cached-prefix length, not its index, so the caller routes to the wrong worker.'),
          bad('deref', 13, '        .map(|(_, w)| *w)', 'That is a whole `Worker`, still not an index, and it cannot be moved out of the borrowed slice.', MISS.refEverywhere),
        ],
      },
      {
        id: 'own-workers',
        edit: { line: 6, text: 'fn choose(ws: &[Worker]) -> Option<Worker> {' },
        expect: { code: 'E0308', line: 9 },
        why: 'The chain ends with an index from `enumerate`, and the signature now promises a whole `Worker`.',
      },
    ],
  },
]
