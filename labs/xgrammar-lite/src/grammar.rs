//! grammar.rs — forge lab 08 · THE ONLY FILE YOU EDIT
//!
//! Mission: compile the harness's JSON Schema AST into a pushdown matcher,
//! then ask that matcher which *tokenizer tokens* are legal next. A token is
//! an arbitrary byte string: it may cross a quote, colon, comma, and several
//! grammar states. Masking only its first character is incorrect.
//!
//! Supported schema subset (parsed for you in schema.rs): canonical objects
//! whose properties are all required, strings/string enums, bounded integers,
//! booleans, and bounded homogeneous arrays. Whitespace is legal JSON.
//!
//! Intended shape:
//!   1. `compile` lowers recursive Schema nodes into an arena/program.
//!   2. Matcher state is an instruction pointer plus a stack of return /
//!      array/object frames — a pushdown automaton, not a regex.
//!   3. `accept_token` consumes every byte and records the earliest rejected
//!      byte. Rejection is sticky.
//!   4. `token_mask` clones the current matcher per vocabulary token and
//!      accepts a token iff its whole byte string leaves a viable prefix.
//!   5. GrammarCache keys the normalized Schema, not the source formatting,
//!      and returns the same Rc on a semantic cache hit.
//!
//! Build it in four stages. Each one turns specific checks green. Go in
//! order: a later stage reuses what an earlier one built. Look for the
//! `STAGE` markers below; the signatures never change.
//!
//!   STAGE 1  schema_compile                 `CompiledGrammar::compile` and
//!                                           `state_count`
//!   STAGE 2  valid_acceptance,              `Matcher::new`, `accept_token`
//!            earliest_rejection             and `status`: bytes, one token
//!                                           at a time
//!   STAGE 3  token_mask                     `token_mask`: whole tokens, run
//!                                           on a clone of the matcher
//!   STAGE 4  mask_overhead, compile_cache   a mask that is fast, and
//!                                           `GrammarCache`
//!
//! Check a stage on your machine with `cargo test <check id>`, for example
//! `cargo test schema_compile`. A `todo!()` traps only the checks that reach
//! it. Stage 2 never calls `token_mask` or `GrammarCache`, so leave those as
//! `todo!` until their stage.
//!
//! Which check catches which mistake:
//!
//! ```text
//!   schema_compile      a compile that fails on a nested schema, or lowers
//!                       it to fewer than 5 or more than 128 states
//!   valid_acceptance    a string escape or JSON whitespace refused, or
//!                       Complete reported while the root object is still open
//!   earliest_rejection  a rejection reported at the end of its token, or one
//!                       that is forgotten by the next token; an integer past
//!                       its bounds or with a leading zero; a boolean checked
//!                       on its first byte only; an enum value or object key
//!                       the schema does not list; text after the closing
//!                       brace
//!   token_mask          a mask that looks at the first byte of each token:
//!                       it lets through a token that starts well and ends in
//!                       garbage, and blocks one that crosses several states
//!   mask_overhead       a correct mask that is slow (native runs only): 512
//!                       tokens must take under 10 ms. The browser run checks
//!                       the mask's shape
//!   compile_cache       a cache keyed by the source text instead of the
//!                       schema, or none at all: another key order or
//!                       whitespace must return the same Rc
//! ```

use crate::schema::{parse_schema, Schema};
use std::collections::HashMap;
use std::rc::Rc;

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MatchStatus {
    Prefix,
    Complete,
    Rejected { byte: usize },
}

impl MatchStatus {
    pub fn is_rejected(self) -> bool {
        matches!(self, Self::Rejected { .. })
    }
}

pub struct CompiledGrammar {
    // TODO(you): compiled nodes / byte classes / root program counter.
    _private: (),
}

impl CompiledGrammar {
    // STAGE 1 · schema_compile
    //   Lower the recursive Schema into states: an arena of nodes for the
    //   object, its keys, the array and the leaves. A nested schema should
    //   come to between 5 and 128 states.
    pub fn compile(schema: &Schema) -> Result<Self, String> {
        let _ = schema;
        todo!("lower the recursive schema into pushdown-machine states")
    }

    // STAGE 1 · schema_compile
    pub fn state_count(&self) -> usize {
        todo!("return the number of compiled schema states")
    }
}

#[derive(Clone)]
pub struct Matcher {
    // TODO(you): Rc<CompiledGrammar>, consumed bytes, stack/state, status.
    _private: (),
}

impl Matcher {
    // STAGE 2 · valid_acceptance, earliest_rejection
    //   The root state, nothing consumed, status Prefix.
    pub fn new(grammar: Rc<CompiledGrammar>) -> Self {
        let _ = grammar;
        todo!("create a matcher at the root state")
    }

    // STAGE 2 · valid_acceptance
    //   Feed every byte through the machine, across quotes, colons, commas
    //   and nested frames; Complete only at the closing brace.
    // STAGE 2 · earliest_rejection
    //   On the first byte the grammar cannot take, record its offset from the
    //   start of the document, not of the token. Once rejected, stay rejected.
    pub fn accept_token(&mut self, token: &[u8]) -> MatchStatus {
        let _ = token;
        todo!("consume every byte; rejection reports the earliest global offset")
    }

    // STAGE 3 · token_mask
    //   For each vocabulary entry: clone the matcher, run the WHOLE token,
    //   and allow it iff the clone is not Rejected.
    // STAGE 4 · mask_overhead
    //   No new rule: the same mask must stay cheap. Clone the small stack,
    //   not the compiled grammar behind the Rc.
    pub fn token_mask(&self, vocabulary: &[&str]) -> Vec<bool> {
        let _ = vocabulary;
        todo!("speculatively run each whole tokenizer token")
    }

    // STAGE 2 · valid_acceptance, earliest_rejection
    pub fn status(&self) -> MatchStatus {
        todo!("return Prefix, Complete, or sticky Rejected")
    }

    pub fn can_end(&self) -> bool {
        self.status() == MatchStatus::Complete
    }
}

pub struct GrammarCache {
    // TODO(you): Schema -> Rc<CompiledGrammar>, plus hit/compile counters.
    _entries: HashMap<Schema, Rc<CompiledGrammar>>,
}

impl GrammarCache {
    pub fn new() -> Self {
        Self {
            _entries: HashMap::new(),
        }
    }

    // STAGE 4 · compile_cache
    //   Key on the parsed Schema, so formatting and key order do not matter.
    //   A hit returns the same Rc and counts a hit; a miss compiles once.
    pub fn get_or_compile(&mut self, source: &str) -> Result<Rc<CompiledGrammar>, String> {
        let _ = parse_schema(source)?;
        todo!("reuse a semantic Schema hit; compile and insert only on a miss")
    }

    pub fn len(&self) -> usize {
        todo!("return the number of semantic schemas cached")
    }

    pub fn compilations(&self) -> usize {
        todo!("return cache misses compiled")
    }

    pub fn hits(&self) -> usize {
        todo!("return cache hits")
    }
}

impl Default for GrammarCache {
    fn default() -> Self {
        Self::new()
    }
}
