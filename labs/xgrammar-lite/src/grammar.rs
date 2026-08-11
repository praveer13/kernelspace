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
    pub fn compile(schema: &Schema) -> Result<Self, String> {
        let _ = schema;
        todo!("lower the recursive schema into pushdown-machine states")
    }

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
    pub fn new(grammar: Rc<CompiledGrammar>) -> Self {
        let _ = grammar;
        todo!("create a matcher at the root state")
    }

    pub fn accept_token(&mut self, token: &[u8]) -> MatchStatus {
        let _ = token;
        todo!("consume every byte; rejection reports the earliest global offset")
    }

    pub fn token_mask(&self, vocabulary: &[&str]) -> Vec<bool> {
        let _ = vocabulary;
        todo!("speculatively run each whole tokenizer token")
    }

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
