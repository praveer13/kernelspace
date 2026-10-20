/* Written by scripts/build-rust-items.ts from bank/reading-enums.json; do not edit. verify:rust-items fails when it is stale. */
import type { ServedGroup } from '../types'

export { SNIPPETS } from '../snippets/reading-enums'

/** By snippet and variant in authored order: what rustc did after each fix ('compiles' or <code>@<line>), null for a variant without fixes. */
export const AFTER: ServedGroup['AFTER'] = [
  [null,["compiles","compiles","E0277@15"],["compiles","E0308@15","compiles"],["compiles","compiles","compiles"]],
  [null,["compiles","compiles","E0004@2"],["compiles","E0308@3","E0614@3"],null],
  [null,null,["compiles","compiles","E0164@9"],null],
  [null,["compiles","compiles","E0004@11"],["compiles","compiles","E0425@12"],null],
  [null,["compiles","compiles","E0382@10"],["compiles","compiles","E0382@11"],null],
  [null,["compiles","E0308@15","compiles"],["compiles","E0277@13","E0277@13"],["compiles","E0308@15","E0308@15"]],
  [null,["compiles","E0599@8","E0308@8"],["compiles","compiles","E0596@8"],null],
  [null,["compiles","E0308@7","E0308@7"],["compiles","compiles","E0308@8"],null,["compiles","E0308@7","E0308@6"]],
  [null,["compiles","E0599@9","E0609@10"],["compiles","compiles","E0425@11"],["compiles","compiles","E0596@10"]],
  [null,["compiles","E0308@9","E0308@9"],["compiles","compiles","E0308@9"],null],
]
