/* Written by scripts/build-rust-items.ts from bank/reading-pointers.json; do not edit. verify:rust-items fails when it is stale. */
import type { ServedGroup } from '../types'

export { SNIPPETS } from '../snippets/reading-pointers'

/** By snippet and variant in authored order: what rustc did after each fix ('compiles' or <code>@<line>), null for a variant without fixes. */
export const AFTER: ServedGroup['AFTER'] = [
  [null,["compiles","E0594@10","E0596@10"],["compiles","E0308@11","E0599@9"],null],
  [null,["compiles","compiles","E0507@10"],["compiles","E0308@10","E0308@10"],null],
  [null,["compiles","E0521@8","E0277@8"],["compiles","compiles","E0373@8"],null],
  [null,["compiles","E0277@7","E0599@9"],["compiles","E0507@7","E0599@9"],null],
  [null,["compiles","compiles","E0596@12"],["compiles","compiles","E0308@8"],null],
  [null,["compiles","E0609@11","E0609@11"],["compiles","E0373@11","E0373@11"],null],
  [null,["compiles","compiles","E0308@11"],["compiles","E0596@11","E0599@11"]],
  [["compiles","E0507@8","E0277@8"],["compiles","E0507@8","E0277@8"],null],
  [null,["compiles","compiles","E0277@7"],null,["compiles","compiles","E0507@7"]],
]
