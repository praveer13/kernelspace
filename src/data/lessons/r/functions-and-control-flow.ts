import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 'r.l2',
  slug: 'rust-functions-and-control-flow',
  trackId: 'r',
  index: 2,
  title: 'Functions, Control Flow & Match',
  minutes: 26,
  hook: 'Write ordinary logic in Rust: typed functions, value-returning branches, loops, and your first exhaustive match.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `Rust functions make their contracts visible: parameter and return types are written down, while local types are usually inferred. Control flow is expression-oriented, so **if** and **match** can compute values without temporary mutable variables.

This lesson stays ownership-free on purpose. First make the syntax boring; moves and borrows arrive next.`,
    },
    {
      type: 'prose',
      md: `## Four loops, one exit value

Use **for item in iterator** for bounded traversal, **while condition** when the condition owns the shape, and **loop** for an explicit state machine. A **break value** can return a result from loop. Ranges are half-open by default: **0..n** visits zero through n − 1.

Rust has no truthiness. Conditions must be **bool**, which removes an entire family of “empty string means false” surprises.`,
    },
    {
      type: 'code',
      filename: 'control.rs',
      lang: 'rust',
      code: `fn classify_load(active: usize, capacity: usize) -> &'static str {
    match (active, capacity) {
        (_, 0) => "disabled",
        (0, _) => "idle",
        (a, c) if a >= c => "full",
        _ => "open",
    }
}

fn first_power_above(limit: u32) -> u32 {
    let mut n = 1;
    loop {
        if n > limit { break n; }
        n *= 2;
    }
}`,
      chips: ['match is exhaustive', 'guards refine arms', 'break can carry a value'],
    },
    {
      type: 'callout',
      variant: 'info',
      title: 'Exhaustiveness is a maintenance tool',
      md: `A Java switch or Python match can quietly ignore a newly added case. Rust requires every possibility to be covered. The wildcard arm **_** is useful, but named arms are better when adding a new enum variant should force every consumer to reconsider its behavior.`,
    },
    {
      type: 'prose',
      md: `## Drill the shapes

The [R2 Forge drill](/forge/rust-zero-r2) asks for six pure functions: a branch expression, range sum, while-based search, loop with a break value, tuple match, and guarded match. None needs allocation or borrowing. If ownership appears in an error, you have made the solution more complicated than the problem.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'What property makes match especially useful with enums?',
          options: [
            'Arms fall through to the next arm, so each one must end with an explicit break',
            'It must cover each variant, so a new variant breaks every incomplete match',
            'It requires a trailing wildcard arm in every match, however many variants the enum has',
            'It raises a runtime error when no arm matches the value',
          ],
          correct: [1],
          explanation:
            'Exhaustive matching means a new variant produces useful compiler errors at every decision point that needs updating.',
          why: [
            'Rust arms never fall through. The first matching arm runs and the match ends, so there is no break keyword to forget.',
            'Right: exhaustiveness is checked at compile time. Adding a variant makes every match that omits it fail with E0004, which lists the missing pattern.',
            'No wildcard is required when all variants are named. A wildcard is allowed but hides new variants, which is why named arms give better compiler help.',
            'An uncovered case is rejected before the program runs, with E0004. There is no runtime match failure to find by testing.',
          ],
        },
        {
          q: 'What values does 0..4 produce?',
          options: [
            '0, 1, 2, 3 and the upper bound 4 is excluded',
            '0, 1, 2, 3, 4 and both ends are included',
            '1, 2, 3, 4 and counting starts at one',
            '0, 1, 2, 3 in a for loop and 0 through 4 in a slice index',
          ],
          correct: [0],
          explanation:
            'Standard ranges exclude the upper bound. Use 0..=4 for an inclusive range.',
          why: [
            'Right: a..b is half-open, covering a up to b - 1. The inclusive form is a..=b, so 0..4 yields four values and ends at 3.',
            'Ruby\'s 0..4 is inclusive, but Rust uses 0..=4 for that. Plain 0..4 stops at 3, so this carries a Ruby habit over wrongly.',
            'Rust ranges start at whatever the left bound says, here 0. Nothing in the language is one-based, and the upper bound is the excluded end.',
            'Slice ranges follow the same half-open rule, so v[0..4] selects four elements, indexes 0 to 3. No context makes the end inclusive.',
          ],
        },
        {
          q: 'How can an infinite loop compute a value?',
          options: [
            'A return statement is the way a loop hands back a value',
            'A break can carry the result of the loop as in break n',
            'Its last body expression becomes the loop value like a block tail',
            'It needs a declared type on the loop before break carries a value',
          ],
          correct: [1],
          explanation:
            'A loop expression can end with break value; the loop then evaluates to that value.',
          why: [
            'return would exit the whole function, not produce the loop\'s value. Only loop can break with a value: it evaluates to it, while for and while give ().',
            'Right: break n ends a loop and makes the whole loop expression evaluate to n. It works for loop only, because for and while may exit without producing a value.',
            'A loop repeats its body, so no single tail value exists. The value comes only from a break expression that exits the loop.',
            'No such syntax exists. The type is inferred from the break value, and every break in the loop must supply the same type.',
          ],
        },
      ],
    },
  ],
}

export default lesson
