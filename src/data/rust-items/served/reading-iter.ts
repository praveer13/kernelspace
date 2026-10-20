/* Written by scripts/build-rust-items.ts from bank/reading-iter.json; do not edit. verify:rust-items fails when it is stale. */
import type { ServedGroup } from '../types'

export { SNIPPETS } from '../snippets/reading-iter'

/** By snippet and variant in authored order: what rustc did after each fix ('compiles' or <code>@<line>), null for a variant without fixes. */
export const AFTER: ServedGroup['AFTER'] = [
  [null,["compiles","compiles","E0277@9"],["compiles","compiles","E0277@9"],null],
  [null,["compiles","E0596@7","E0599@7","E0596@7"],null,["compiles","E0308@10","E0308@10"]],
  [null,["compiles","compiles","E0308@7"],["compiles","E0277@10","E0277@10"],null],
  [null,null,["compiles","compiles","E0596@7"],["compiles","compiles","E0507@5"]],
  [null,["compiles","compiles","compiles"],["compiles","E0596@14","compiles"],null],
  [null,null,["compiles","E0308@2","compiles"]],
  [null,["compiles","E0308@8","compiles"],["compiles","E0277@8","E0596@8"],null],
  [null,["compiles","compiles","E0594@7"],["compiles","E0594@7","compiles"],null],
  [null,["compiles","E0596@7","E0277@9"],null,["compiles","E0277@9","E0277@9"]],
]
