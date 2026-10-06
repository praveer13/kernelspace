/**
 * verify-rust-items — the compile-bank checks of docs/specs/wave-2.md §15.2 (fast gate, no rustc).
 *
 * Reserved by the scaffold (2a-03): until 2c-04 lands the snippet schema and the bank, there is
 * nothing to check, so it exits 0 with "pending: 2c-04" and then blocks like the rest. The finished
 * script checks the schema, that each bank's source hashes match its snippets, the phone limits,
 * at least 3 snippets per error code in the final bank (a warning until 2c-18 freezes it) and the
 * verdict quota (about 25 % of verdict items have "compiles" as the key).
 *
 *   bun scripts/verify-rust-items.ts
 */

console.log('verify-rust-items: pending: 2c-04')
