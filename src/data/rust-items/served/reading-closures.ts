/* Written by scripts/build-rust-items.ts from bank/reading-closures.json; do not edit. verify:rust-items fails when it is stale. */
import type { ServedGroup } from '../types'

export { SNIPPETS } from '../snippets/reading-closures'

/** By snippet and variant in authored order: what rustc did after each fix ('compiles' or <code>@<line>), null for a variant without fixes. */
export const AFTER: ServedGroup['AFTER'] = [
  [null,["compiles","E0596@9","E0308@11"],["compiles","E0308@11","E0308@11"],null],
  [null,null,["compiles","E0596@9","E0596@9"],["compiles","E0502@9","E0382@9"],["compiles","E0382@11","E0382@11"]],
  [null,["compiles","E0382@3","compiles"],["compiles","E0594@11","E0382@3"],["compiles","compiles","E0614@11"]],
  [null,["compiles","compiles","compiles"],["compiles","E0596@7","E0596@7"],null],
  [null,null,["compiles","compiles","E0382@11"],["compiles","E0596@11","compiles"]],
  [null,["compiles","E0373@4","E0373@4"],null,["compiles","E0308@7","E0308@7"]],
  [null,["compiles","E0277@2","compiles"],null,["compiles","E0277@2","compiles"]],
  [null,["compiles","E0515@11","E0308@11"],["compiles","E0308@11","E0596@8"],null],
]
