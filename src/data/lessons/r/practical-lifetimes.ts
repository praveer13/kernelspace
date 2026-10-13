import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 'r.l9',
  slug: 'rust-practical-lifetimes',
  trackId: 'r',
  index: 9,
  title: 'Practical Lifetimes',
  minutes: 31,
  hook: 'Read lifetime syntax as a contract between references, then build the exact borrowed Block used later in T3.',
  exercise: 'code',
  blocks: [
    {
      type: 'prose',
      md: `The compiler tracks three permissions on every path (a variable, a field, an element): **Read (R)** to look at it, **Write (W)** to change it and **Own (O)** to move or drop it. \`let\` gives R and O, and \`let mut\` adds W. A borrow lends permissions for a while:

- **&x** gives the reference R and takes W and O from \`x\` until the reference's last use. \`x\` keeps R, so readers are welcome.
- **&mut x** takes R, W and O from \`x\`, so the reference is the only way in.

A **lifetime** is the answer to "how long does the lender stay reduced?" It is counted in the code that uses the reference, from the borrow to its last use, not to the closing brace. Rust infers it in ordinary calls. You write **'a** when a signature or a type must say which loan a reference continues.

An annotation does not keep a value alive and does not change runtime behavior. It names a relationship the compiler must prove: an output reference came from particular inputs, or a struct holding a reference cannot outlive its source.`,
    },
    {
      type: 'code',
      filename: 'longer.rs',
      lang: 'rust',
      code: `fn main() {
    let prompt = String::from("system: be brief");
    let mut reply = String::from("ok");
    let winner = longer(&prompt, &reply);
    reply.push('!');
    println!("{prompt} {reply} {winner}");
}

fn longer<'a>(left: &'a str, right: &'a str) -> &'a str {
    if left.len() >= right.len() { left } else { right }
}`,
      chips: ["one 'a on both inputs", 'the result is a loan on both', 'push needs W, and the loan took it'],
      permissions: { trace: 'longer-loan' },
      alt: {
        java: `static String longer(String left, String right) {
    return left.length() >= right.length() ? left : right;
}

String prompt = "system: be brief";
StringBuilder reply = new StringBuilder("ok");
String winner = longer(prompt, reply.toString());
reply.append('!');
System.out.println(prompt + " " + reply + " " + winner);`,
        python: `def longer(left, right):
    return left if len(left) >= len(right) else right

prompt = "system: be brief"
reply = "ok"
winner = longer(prompt, reply)
reply += "!"
print(prompt, reply, winner)`,
      },
      align: [
        {
          q: 'The Java and Python versions run and print system: be brief ok! system: be brief. Which Rust line does the compiler reject, and which permission is missing there?',
          options: [
            "Line 5, `reply.push('!')`: it needs Write, and `reply` lost it to the loan `winner` holds",
            "Line 5, `reply.push('!')`: it needs Own, and `reply` handed that over to `winner` on line 4",
            'Line 4, `longer(&prompt, &reply)`: it needs Own of both strings, and a plain call cannot take Own',
            'Line 6, `println!`: it needs Write on `winner`, and a returned reference holds Read only',
          ],
          correct: [0],
          explanation:
            'Line 4 lends Read on both strings, so each lender loses Write and Own until `winner` is last used on line 6. The push on line 5 needs Write and finds only Read.',
          why: [
            "Right: the signature makes `winner` a loan on both inputs, so `reply` is down to Read while `winner` lives. `push` needs Read and Write, which is E0502. At run time `winner` is `prompt`'s text, but the compiler reads the signature, not the run.",
            "`push` takes `&mut self` and moves nothing, so it never asks for Own. `reply` did lose Own to the loan, but the permission the push needs and lacks is Write.",
            'A `&` borrow needs only Read, and both strings hold it on line 4. Taking a reference never needs Own; it takes Write and Own away from the lender instead.',
            'Printing needs only Read, and `winner` holds it. The error is earlier: line 5 changes a string that `winner` may still point into.',
          ],
          kcs: ['r.lifetimes', 'r.borrow-rules'],
        },
      ],
    },
    {
      type: 'prose',
      md: `## Read the contract from the caller's side

Line 4 of the diagram is the whole lesson. Because both inputs carry the same **'a**, the result is a loan on both: \`reply\` drops from R, W and O to R, \`prompt\` from R and O to R, and both stay reduced for as long as \`winner\` is used. The loan spans the overlap in which both inputs stay valid, because either one might be chosen.

At run time \`winner\` is \`prompt\`'s text, so the push on line 5 would hurt nothing. The compiler still refuses it, because it reads the signature and not the run. A different input, with \`reply\` longer, would leave \`winner\` pointing into a buffer that \`push\` may have moved. The contract has to hold for every call.

Elision writes the contract for you when it is obvious. With one input reference, the output is a loan on that input:`,
    },
    {
      type: 'code',
      filename: 'elision.rs',
      lang: 'rust',
      code: `fn prefix(input: &str, n: usize) -> &str {
    &input[..input.len().min(n)] // elision infers the relationship
}

// the same signature with the relationship written out
fn prefix_written<'a>(input: &'a str, n: usize) -> &'a str {
    &input[..input.len().min(n)]
}`,
      chips: ['one input: the output borrows from it', 'writing it out changes nothing'],
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Do not annotate by superstition',
      md: `Adding the same lifetime to every reference claims that unrelated loans must overlap, which over-constrains callers. Start with elision, read the compiler's missing-relationship message, and name only the relationship callers need.`,
    },
    {
      type: 'prose',
      md: `## Where a loan ends: a drop needs Own

Every closing brace drops the variables declared inside it, and a drop needs Own. A live shared loan has taken Own from its lender, so a lender cannot be dropped while anyone still holds a reference to it. That is E0597, \`reply\` does not live long enough:`,
    },
    {
      type: 'code',
      filename: 'scope_end.rs',
      lang: 'rust',
      code: `// longer is the function above
fn main() {
    let prompt = String::from("system: be brief");
    let winner;
    {
        let reply = String::from("ok");
        winner = longer(&prompt, &reply);
    } // reply is dropped here, and a drop needs Own
    println!("{winner}"); // winner is a loan on reply that is still live
}`,
      chips: ['the closing brace needs Own', 'the live loan took Own', 'E0597'],
    },
    {
      type: 'prose',
      md: `Java and Python have no such error because the reference itself keeps the object alive, so \`reply\` would simply live on. In Rust the owner decides how long a value lives, and a reference never extends it. If the result really must outlive its inputs, an annotation cannot make that safe, because annotations only describe loans. Hand back Own instead: return owned data.`,
    },
    {
      type: 'code',
      filename: 'longer_owned.rs',
      lang: 'rust',
      code: `fn main() {
    let prompt = String::from("system: be brief");
    let mut reply = String::from("ok");
    let winner = longer_owned(&prompt, &reply);
    reply.push('!');
    println!("{prompt} {reply} {winner}");
}

fn longer_owned(left: &str, right: &str) -> String {
    if left.len() >= right.len() { left.to_string() } else { right.to_string() }
}`,
      chips: ['to_string copies into a new owner', 'the loan ends when the call returns', 'the same main now compiles'],
      permissions: { trace: 'longer-owned' },
    },
    {
      type: 'prose',
      md: `Compare line 5 here with line 5 above. The result is a \`String\` with its own R and O, so nothing is lent past the call, \`reply\` keeps R, W and O and the push is allowed. The price is a copy. \`'static\` does not help, because the compiler checks that claim and a borrow from a shorter-lived input cannot satisfy it. A \`Box\` around the reference still holds the original loan.

## A struct that holds a loan: Block<'a>

A struct that stores a reference stores a loan. **Block<'a>** says that a Block is valid only while the slice it views is, and that the slice's owner stays without W and O for as long as any Block is in use. It owns no token storage; it is a checked view. Leave the parameter off and rustc reports E0106, missing lifetime specifier. Its methods repeat the parameter, as in \`impl<'a> Block<'a>\`.`,
    },
    {
      type: 'code',
      filename: 'block.rs',
      lang: 'rust',
      code: `struct Block<'a> {
    tokens: &'a [u32],
}

fn main() {
    let mut tokens = vec![1, 2, 3];
    let block = Block { tokens: &tokens };
    tokens.push(4);
    println!("{:?}", block.tokens.first());
}`,
      chips: ["'a: this Block is a loan on its slice", 'building a Block takes W and O from tokens', 'E0502 at the push'],
      permissions: { trace: 'block-push' },
      alt: {
        java: `record Block(List<Integer> tokens) {}

List<Integer> tokens = new ArrayList<>(List.of(1, 2, 3));
Block block = new Block(tokens);
tokens.add(4);
System.out.println(block.tokens().get(0));`,
        python: `class Block:
    def __init__(self, tokens):
        self.tokens = tokens

tokens = [1, 2, 3]
block = Block(tokens)
tokens.append(4)
print(block.tokens[0])`,
      },
      align: [
        {
          q: "The Java and Python versions run, because their Block holds the whole list. In Rust, what does the `'a` on `Block<'a>` record that Java's field type does not?",
          options: [
            'That a Block is a loan, so `tokens` lacks Write and Own while a Block lives',
            'That a Block owns its tokens, so `tokens` gives up Own to the Block as soon as it is built',
            'That a Block keeps the tokens alive, so a later `push` cannot free the old buffer behind it',
            'That a Block copies the slice, so later changes to `tokens` never reach the Block',
          ],
          correct: [0],
          explanation:
            "The parameter says the Block borrows. While one is in use, `tokens` has Read but lost Write and Own, so the push on line 8 is E0502. Java's field holds the list object and not its buffer, so `add` can grow the list without leaving the Block pointing at a moved buffer.",
          why: [
            'Right: `Block { tokens: &tokens }` lends Read and takes Write and Own from `tokens` until the Block is last used. `push` needs Write, and that is what the parameter makes visible.',
            'A Block holds `&[u32]`, a reference, so building one moves nothing. `tokens` keeps Own and only loses it temporarily, while the loan is live.',
            'Nothing keeps a borrowed value alive. The owner `tokens` still decides when the buffer is freed or moved, and the `push` would reallocate it. That danger is why the compiler rejects the push.',
            'A slice is a pointer and a length into the original, not a copy. Changes to `tokens` would show through it, which is the reason the loan blocks the push.',
          ],
          kcs: ['r.lifetimes', 'r.slices'],
        },
      ],
    },
    {
      type: 'prose',
      md: `Move the push below the print and the same program compiles: the Block's last use ends the loan, and \`tokens\` gets W and O back. The diagram shows the push needing R and W and finding R only. That one difference is E0502. The [Error Museum](/errors) keeps E0502, E0597 and E0106 with their diagrams and fixes.

## When the checker is stricter than the program

Each rejection above had a run that goes wrong: a push moves a buffer under a live reference, and a drop frees a value that a live reference points into. Not every rejection has one. The checker is sound but incomplete: it never accepts an unsafe program and it sometimes rejects a safe one. When it says no, ask whether you can name the execution that breaks. If you can, fix the design. If you cannot, you have met an analyzer limit.

The classic limit is a conditional return:`,
    },
    {
      type: 'code',
      filename: 'conditional_return.rs',
      lang: 'rust',
      code: `use std::collections::HashMap;

// rejected: E0502 at the insert
fn cached(map: &mut HashMap<u32, String>, key: u32) -> &String {
    if let Some(hit) = map.get(&key) {
        return hit;
    }
    map.insert(key, String::from("computed"));
    &map[&key]
}

// accepted: one call asks the question and answers it
fn cached_entry(map: &mut HashMap<u32, String>, key: u32) -> &String {
    map.entry(key).or_insert_with(|| String::from("computed"))
}`,
      chips: ['a safe program the checker cannot prove', 'restructure, do not clone or reach for unsafe'],
    },
    {
      type: 'prose',
      md: `On the path where \`get\` finds a value, \`hit\` is returned, so its loan must last as long as the caller's reference. Today's compiler applies that to the whole function, including the path where \`get\` found nothing and no reference exists. So the insert finds \`*map\` without W, although no run breaks. A more precise analysis, Polonius, accepts it, and stable rustc does not yet. Look the key up once with \`entry\` and the question is settled before any reference is returned. [R4](/lesson/r.l4) lists the other limits you will meet early.

## Prove borrowed views

The [R9 Forge drill](/forge/rust-zero-r9) returns subslices, chooses between borrowed strings, defines **Block<'a>**, separates two unrelated lifetimes, and replaces an impossible escaping reference with owned data. T3.L1 picks up this Block, so after the drill it is a reminder, not a cliff.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: "What does the `'a` in `fn longer<'a>(left: &'a str, right: &'a str) -> &'a str` do?",
          options: [
            "At run time it keeps both strings alive until `'a` ends, so neither owner ever has to drop them",
            "At run time it adds a count like Rc, and each lender gets its permissions back when it hits zero",
            'Nothing at run time, so it shows the compiler how long each loan lasts and how long a lender stays reduced',
            "At run time it stores a scope tag in the reference, and the lender's permissions return once it is checked",
          ],
          correct: [2],
          explanation:
            'Lifetimes are proof metadata erased after type checking. They never keep a referenced value alive; they say how long a loan lasts.',
          why: [
            "Annotations never extend or move a value. The owner still drops it when its scope ends, and a reference still live then is rejected with E0597.",
            'Reference counting is Rc and Arc, with a real counter. A lifetime parameter is erased after checking and adds no counter to the value.',
            'Right: lifetimes generate no code. They let the compiler prove how long each loan lasts, and so how long each lender is without W and O.',
            'No scope tag or run-time check exists; a reference is a plain pointer. A dangling use is rejected at compile time, before there is a run.',
          ],
          kcs: ['r.lifetimes'],
        },
        {
          q: 'A block ends with `winner = longer(&prompt, &reply)` assigned inside it, and `println!("{winner}")` comes after the closing brace. Which permission does the compiler find missing, and where?',
          options: [
            'Own of `reply` at the closing brace, because the drop needs it and the loan took it',
            'Write on `winner` at the assignment, because it was declared without `mut` and holds a loan',
            'Read of `prompt` at the call, because lending it to `longer` takes its Read away from it',
            'Read of `reply` at the print, because the shared loan took Read from it as well as Write',
          ],
          correct: [0],
          explanation:
            'A closing brace drops what the block declared, and a drop needs Own. `winner` is a live loan on `reply`, and a shared loan takes Write and Own from its lender.',
          why: [
            'Right: `reply` is dropped at the brace, the drop needs Own, and the loan held by `winner` is still live and took it. That is E0597.',
            'Declaring `let winner;` and assigning it once needs no `mut`, since the first assignment is its initialization. The error is at the closing brace, not at the assignment.',
            'A shared borrow leaves the lender its Read: only Write and Own are taken. `prompt` also lives in the outer scope, so nothing is dropped early.',
            'A shared loan takes Write and Own from the lender, never Read, which is why many readers are allowed. Printing `winner` needs only Read and that is fine.',
          ],
          kcs: ['r.lifetimes', 'r.borrow-rules'],
        },
        {
          q: "`let block = Block { tokens: &tokens };` is followed by `tokens.push(4);` and then a use of `block`. Which edit compiles and still prints the first token?",
          options: [
            "Declare the type as `Block<'static>`, so the loan on `tokens` is long enough for the push to run",
            'Move the `push` below the last use of `block`, so the loan ends and `tokens` has Write back',
            'Wrap the `push` in its own `{ }` block, so the push gets a shorter lifetime than the Block',
            'Declare it as `let mut block`, so the Block can give back the Write that it took',
          ],
          correct: [1],
          explanation:
            'The loan lasts to the last use of `block`. After that `tokens` has R, W and O again, and the push is allowed.',
          why: [
            "`'static` would claim the loan lasts forever, which is the opposite of what the push needs. The compiler would also have to prove that claim, and `tokens` is a local that cannot meet it.",
            'Right: a loan ends at the reference\'s last use, not at the closing brace, so `tokens` regains Write and Own. Reordering ends the loan early instead of fighting it.',
            "A nested block only changes where the push's own temporaries are dropped. The loan runs to the Block's last use, which is still after the push, so `tokens` still has Read alone there.",
            "`mut` on a binding gives that binding Write over itself. It has no effect on a permission that a loan took from `tokens`.",
          ],
          kcs: ['r.lifetimes', 'r.slices'],
        },
        {
          q: 'What is the right fix when the result must outlive the input it was computed from?',
          options: [
            "Declare the return as `'static`, so the data stays valid until the program ends",
            'Return owned data such as a String, so the caller gets Own and nothing is lent',
            'Wrap the reference in a Box, so the data gets its own lifetime from the heap',
            'Copy the reference with a plain `let` binding, so it is detached from the input',
          ],
          correct: [1],
          explanation:
            'Annotations can describe valid loans, not create them. When a result needs an independent lifetime, it needs an owner of its own.',
          why: [
            "`'static` is a claim the compiler checks, and a borrow from a shorter-lived input cannot satisfy it. rustc rejects it with a lifetime may not live long enough error.",
            'Right: copy or move the bytes into an owner such as String or Vec. Owned data holds its own O, so it needs no loan and can live as long as needed.',
            'Box<&T> still holds the original loan, so it lives no longer than the input. Boxing moves the pointer to the heap, not the referent.',
            'A shared reference is Copy, so `let r2 = r` only duplicates the pointer, and the copy is the same loan. Only an owning conversion such as to_string or to_vec detaches it.',
          ],
          kcs: ['r.lifetimes'],
        },
      ],
    },
  ],
  kcs: ['r.lifetimes', 'r.slices'],
}

export default lesson
