/* Written by scripts/build-rust-items.ts from bank/seed.json; do not edit. verify:rust-items fails when it is stale. */
import type { ServedGroup } from '../types'

export { SNIPPETS } from '../snippets/seed'

/** By snippet and variant in authored order: what rustc did after each fix ('compiles' or <code>@<line>), null for a variant without fixes. */
export const AFTER: ServedGroup['AFTER'] = [
  [null,["compiles","compiles","E0499@7"],null,null,null],
  [null,["compiles","compiles","E0502@8","E0502@8"],null,null,null],
  [null,["compiles","compiles","E0382@9"],null,null],
  [null,["compiles","compiles","E0596@7"],null,null],
  [null,["compiles","E0499@4","E0308@5"],null,null,null],
  [null,null,["compiles","E0515@7","E0658@7"],null,null],
  [null,["compiles","compiles","E0597@5"],null,null,null],
  [null,["compiles","compiles","BorrowMutError@11"],null,null,null],
  [null,["compiles","compiles","E0506@9"],null,null,null],
  [null,null,null,null],
]
