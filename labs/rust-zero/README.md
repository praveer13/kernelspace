# Rust Zero drill workspace

Ten rustlings-style crates form Track R. Each crate has one student file,
`src/exercises.rs`, and six checks backed by the shared `harness` crate.

The template intentionally compiles with `todo!()` bodies and fails at run
time. Replace the TODOs, run `cargo test -p rust-zero-rN`, then build the
same package for `wasm32-unknown-unknown` and drop its artifact on the
matching Forge page.

These drills teach only the Rust required by the systems labs. They are not
a language tour and do not add third-party dependencies.
