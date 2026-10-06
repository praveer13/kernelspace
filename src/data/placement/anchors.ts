/**
 * The Rust-reading anchor (docs/specs/wave-1.md §4.4, §7.1; PLAN-100X §4.D).
 *
 * Placement's seventh probe: read four short programs and say which error rustc gives, or that it
 * compiles. Solid on these means R is offered as test-outs instead of lessons, so each item asks for a
 * prediction a learner can only make from the borrow rules (the anchor KC is `r.borrow-rules`).
 *
 * - Refs are `item:<id>`. Every item shares one option set, so no option text can hint at a key; the
 *   keys are E0499, E0502, E0382 and "it compiles", one each.
 * - The stem is one line (code is shown inline, statements separated by semicolons), valid inside `main`.
 * - `explanation` ends with the Java analogue. The walk shows it after the answer, never before.
 * - Gated like the errata items by `bun run verify:items`; tagged and counted by `bun run verify:kc`.
 */

import type { AuthoredItem } from '@/lib/items/types'

const ASK = 'Which error does rustc give for this code inside main, or does it compile? '

/** Same four options in every anchor; authored order is E0499, E0502, E0382, compiles. */
const OPTIONS = [
  'E0499: a second &mut borrow starts while the first is still live',
  'E0502: a &mut borrow starts while a shared borrow is still live',
  'E0382: a value is used after it was moved out of its binding',
  'It compiles: a borrow ends at its last use, giving 0 errors from rustc',
]

export const R_ANCHORS: AuthoredItem[] = [
  {
    id: 'r.anchor.e0499-1',
    q: {
      q: `${ASK}let mut s = String::from("a"); let a = &mut s; let b = &mut s; a.push('x'); b.push('y');`,
      options: OPTIONS,
      correct: [0],
      explanation:
        'Two &mut borrows of s are live together, because a is still used after b exists. Java analogue: both a and b would be references to one StringBuilder, and the interleaved appends are legal there. Rust refuses the second writer at compile time, since two writers at once is how a data race starts.',
      why: [
        'Right: a is used after b is created, so both &mut borrows of s are live at once. Rustc reports E0499, cannot borrow s as mutable more than once.',
        'E0502 needs one shared & borrow and one &mut borrow. Both borrows here are &mut, so the code gets E0499 instead.',
        'E0382 is a use after a move. Nothing moves here: &mut s lends s, and s keeps ownership of its buffer.',
        'It would compile if a were last used before b was created. The push through a runs after b exists, so the two borrows overlap.',
      ],
    },
    kcs: ['r.borrow-rules'],
  },
  {
    id: 'r.anchor.e0502-1',
    q: {
      q: `${ASK}let mut v = vec![1, 2, 3]; let first = &v[0]; v.push(4); println!("{first}");`,
      options: OPTIONS,
      correct: [1],
      explanation:
        'first is a shared borrow that println still uses after v.push(4) needs &mut v. Java analogue: an Iterator over an ArrayList throws ConcurrentModificationException when the list grows underneath it. E0502 is that same check made before the program runs, and it also covers a reference left dangling by a reallocation.',
      why: [
        'E0499 needs two &mut borrows. first is a shared borrow, so the conflict with the push is E0502, not E0499.',
        'Right: first is read by println after the push needs &mut v. A reader and a writer overlap, which is E0502, and push could reallocate and leave first dangling.',
        'Nothing moves: &v[0] and the push both borrow v, and v is still usable. The error is about overlapping borrows, not about ownership.',
        'It would compile if the println came before the push, ending the shared borrow early. first is used after the push, so that borrow is still live.',
      ],
    },
    kcs: ['r.borrow-rules'],
  },
  {
    id: 'r.anchor.e0382-1',
    q: {
      q: `${ASK}fn consume(s: String) {} let name = String::from("hi"); consume(name); println!("{name}");`,
      options: OPTIONS,
      correct: [2],
      explanation:
        'consume(name) moves the String into the function, so name is dead when println uses it. Java analogue: Java has no move, so after consume(name) the caller still holds a usable reference to the same object. Rust makes the callee the sole owner and rejects the stale name.',
      why: [
        'E0499 is about two &mut borrows. This code takes no reference at all: name is passed by value.',
        'E0502 needs a reference that is still live across a conflicting borrow. No reference exists here, because consume takes the String itself.',
        'Right: passing name by value moves the String into consume, so println borrows a moved value. Rustc reports E0382, borrow of moved value.',
        'It would compile if String were Copy, or if consume took a reference. By value it moves, and the later println uses the dead binding.',
      ],
    },
    kcs: ['r.borrow-rules', 'r.ownership-moves'],
  },
  {
    id: 'r.anchor.compiles-1',
    q: {
      q: `${ASK}let mut s = String::from("hi"); let r = &s; println!("{r}"); s.push('!'); println!("{s}");`,
      options: OPTIONS,
      correct: [3],
      explanation:
        'r is last used in the first println, so its borrow ends there and the push finds no live reader. Java analogue: Java would let you read s through r and then append to it, with no rule about borrows. Rust accepts this program for the same reason it rejects the others: it checks which borrows are still live at each use.',
      why: [
        'Only the push needs &mut s, and r is a shared borrow that has already ended. No two &mut borrows overlap here.',
        'This is the classic wrong guess. r is last used in the first println, before the push, so the shared borrow is over and the push does not conflict.',
        'Nothing moves: &s lends s, and s keeps its ownership. It is used again after the push without any error.',
        'Right: r is not used after the first println, so its borrow ends there and not at the closing brace. The push then borrows s mutably with no live reader.',
      ],
    },
    kcs: ['r.borrow-rules'],
  },
]
