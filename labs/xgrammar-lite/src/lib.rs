//! xgrammar-lite — forge lab 08.
//!
//! Compile a practical JSON Schema subset into a pushdown matcher and use
//! that matcher to build the mask over lab 03-style BPE tokens. The harness
//! supplies schema parsing and adversarial token vocabularies; the student
//! owns the compiled machine, incremental state, whole-token simulation,
//! earliest rejection, and semantic compile cache.
//!
//! ┌────────────────────────────────────────────────────────────────┐
//! │  YOU EDIT:   src/grammar.rs     (the only file with TODO(you)) │
//! │  DO NOT EDIT schema.rs/lib.rs — parser + six grading checks.   │
//! └────────────────────────────────────────────────────────────────┘

mod grammar;
mod schema;

use grammar::{CompiledGrammar, GrammarCache, MatchStatus, Matcher};
use kslab::{Check, Report};
use schema::parse_schema;
use std::rc::Rc;

const PROFILE_SCHEMA: &str = r#"{
  "type": "object",
  "properties": {
    "name": {"type": "string"},
    "scores": {
      "type": "array",
      "items": {"type": "integer", "minimum": 0, "maximum": 100},
      "minItems": 1,
      "maxItems": 4
    },
    "active": {"type": "boolean"}
  },
  "required": ["name", "scores", "active"],
  "additionalProperties": false
}"#;

const TOOL_SCHEMA: &str = r#"{
  "type":"object",
  "properties":{
    "kind":{"type":"string","enum":["tool","answer"]},
    "count":{"type":"integer","minimum":0,"maximum":99}
  },
  "required":["kind","count"],
  "additionalProperties":false
}"#;

fn compiled(source: &str) -> Result<Rc<CompiledGrammar>, String> {
    let schema = parse_schema(source)?;
    CompiledGrammar::compile(&schema).map(Rc::new)
}

/// 1. The compiler handles nested schema nodes and rejects unsupported
/// object semantics rather than silently accepting a broader language.
pub fn check_schema_compile() -> Check {
    const ID: &str = "schema_compile";
    const LABEL: &str = "JSON Schema lowers to a finite pushdown program";
    let schema = match parse_schema(PROFILE_SCHEMA) {
        Ok(schema) => schema,
        Err(error) => return Check::fail(ID, LABEL, format!("harness schema failed: {error}")),
    };
    let grammar = match CompiledGrammar::compile(&schema) {
        Ok(grammar) => grammar,
        Err(error) => return Check::fail(ID, LABEL, format!("compile failed: {error}")),
    };
    if grammar.state_count() < 5 || grammar.state_count() > 128 {
        return Check::fail(
            ID,
            LABEL,
            format!(
                "nested object/array schema should compile to 5..128 states, got {}",
                grammar.state_count()
            ),
        );
    }

    let optional = r#"{
      "type":"object",
      "properties":{"required":{"type":"string"},"optional":{"type":"boolean"}},
      "required":["required"],
      "additionalProperties":false
    }"#;
    if parse_schema(optional).is_ok() {
        return Check::fail(
            ID,
            LABEL,
            "unsupported optional-property semantics were silently broadened",
        );
    }
    Check::pass(
        ID,
        LABEL,
        format!(
            "{} compiled states; unsupported semantics fail closed",
            grammar.state_count()
        ),
    )
}

/// 2. Valid nested JSON can arrive in BPE fragments that cut across grammar
/// boundaries; only the final fragment makes the matcher complete.
pub fn check_valid_acceptance() -> Check {
    const ID: &str = "valid_acceptance";
    const LABEL: &str = "valid nested JSON is accepted across token boundaries";
    let grammar = match compiled(PROFILE_SCHEMA) {
        Ok(grammar) => grammar,
        Err(error) => return Check::fail(ID, LABEL, error),
    };
    let mut matcher = Matcher::new(grammar);
    let tokens: &[&[u8]] = &[
        br#"{"name"#,
        br#"":"Ada\nLovelace","scores":["#,
        b"99,8",
        br#"7,100],"active":tr"#,
        b"ue}",
    ];
    for (index, token) in tokens.iter().enumerate() {
        let status = matcher.accept_token(token);
        if status.is_rejected() {
            return Check::fail(
                ID,
                LABEL,
                format!("valid stream rejected after token {index}: {status:?}"),
            );
        }
        if index + 1 < tokens.len() && status == MatchStatus::Complete {
            return Check::fail(ID, LABEL, format!("accepted too early after token {index}"));
        }
    }
    if !matcher.can_end() {
        return Check::fail(ID, LABEL, format!("final status is {:?}", matcher.status()));
    }
    Check::pass(
        ID,
        LABEL,
        "nested array, escape, integer bounds, and boolean accepted",
    )
}

/// 3. Invalid output is rejected at the first impossible byte, not at the
/// end of a token or after the complete document has been buffered.
pub fn check_earliest_rejection() -> Check {
    const ID: &str = "earliest_rejection";
    const LABEL: &str = "invalid output rejects at the earliest byte";
    let grammar = match compiled(
        r#"{"type":"object","properties":{"id":{"type":"integer"},"ok":{"type":"boolean"}},"required":["id","ok"],"additionalProperties":false}"#,
    ) {
        Ok(grammar) => grammar,
        Err(error) => return Check::fail(ID, LABEL, error),
    };
    let mut matcher = Matcher::new(grammar);
    let first = br#"{"id":12,"ok":"#;
    if matcher.accept_token(first).is_rejected() {
        return Check::fail(ID, LABEL, "valid prefix rejected before the bad value");
    }
    let expected = first.len();
    let status = matcher.accept_token(br#""no"}"#);
    if status != (MatchStatus::Rejected { byte: expected }) {
        return Check::fail(
            ID,
            LABEL,
            format!("expected rejection at byte {expected}, got {status:?}"),
        );
    }
    if matcher.accept_token(b"ignored") != status {
        return Check::fail(ID, LABEL, "rejection was not sticky");
    }
    Check::pass(
        ID,
        LABEL,
        format!("rejected the opening quote at byte {expected}"),
    )
}

/// 4. A BPE token is a byte string, not a character. Legal tokens may cross
/// several punctuation states; a token with a legal first byte may still be
/// illegal before it ends.
pub fn check_token_mask() -> Check {
    const ID: &str = "token_mask";
    const LABEL: &str = "mask validates whole BPE tokens, not first characters";
    let grammar = match compiled(TOOL_SCHEMA) {
        Ok(grammar) => grammar,
        Err(error) => return Check::fail(ID, LABEL, error),
    };
    let mut matcher = Matcher::new(grammar);
    if matcher.accept_token(br#"{"kind":"#).is_rejected() {
        return Check::fail(ID, LABEL, "setup prefix rejected");
    }
    let vocab = [
        r#""tool""#,
        r#""answer","count":"#,
        "null",
        r#""tool","count":7}"#,
        r#""tool"}garbage"#,
        r#""to"#,
    ];
    let expected = [true, true, false, true, false, true];
    let actual = matcher.token_mask(&vocab);
    if actual != expected {
        return Check::fail(ID, LABEL, format!("expected {expected:?}, got {actual:?}"));
    }
    if matcher.accept_token(vocab[3].as_bytes()) != MatchStatus::Complete {
        return Check::fail(
            ID,
            LABEL,
            "multi-state token was mask-legal but not accepted",
        );
    }
    Check::pass(
        ID,
        LABEL,
        "multi-state token allowed; bad suffix and wrong literal masked",
    )
}

/// 5. Mask generation remains a per-step microsecond operation on a small
/// production-shaped vocabulary. wasm32 runs the same semantic workload;
/// native tests additionally enforce the wall-clock budget.
pub fn check_mask_overhead() -> Check {
    const ID: &str = "mask_overhead";
    const LABEL: &str = "512-token mask stays in the microsecond regime";
    let grammar = match compiled(TOOL_SCHEMA) {
        Ok(grammar) => grammar,
        Err(error) => return Check::fail(ID, LABEL, error),
    };
    let mut matcher = Matcher::new(grammar);
    matcher.accept_token(br#"{"kind":"#);

    let owned: Vec<String> = (0..512)
        .map(|index| match index % 97 {
            0 => r#""tool","count":7}"#.to_string(),
            1 => r#""answer""#.to_string(),
            _ => format!("bad_token_{index}"),
        })
        .collect();
    let vocab: Vec<&str> = owned.iter().map(String::as_str).collect();
    let mask = matcher.token_mask(&vocab);
    if mask.len() != 512 || !mask.iter().any(|allowed| *allowed) {
        return Check::fail(ID, LABEL, "mask shape or legal-token set is wrong");
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::Instant;
        let rounds = 40u128;
        let started = Instant::now();
        for _ in 0..rounds {
            std::hint::black_box(matcher.token_mask(&vocab));
        }
        let per_mask_us = started.elapsed().as_micros().div_ceil(rounds);
        if per_mask_us > 10_000 {
            return Check::fail(
                ID,
                LABEL,
                format!(
                    "{per_mask_us} µs per 512-token mask exceeds the 10,000 µs debug-build ceiling"
                ),
            );
        }
        return Check::pass(ID, LABEL, format!("{per_mask_us} µs per 512-token mask"));
    }

    #[cfg(target_arch = "wasm32")]
    Check::pass(ID, LABEL, "512 whole-token candidates evaluated in-browser")
}

/// 6. Equivalent schema source strings hit one normalized compile entry and
/// return the same Rc; a genuinely different schema compiles once more.
pub fn check_compile_cache() -> Check {
    const ID: &str = "compile_cache";
    const LABEL: &str = "semantic grammar cache reuses compiled programs";
    let mut cache = GrammarCache::new();
    let first = match cache.get_or_compile(TOOL_SCHEMA) {
        Ok(grammar) => grammar,
        Err(error) => return Check::fail(ID, LABEL, error),
    };
    let equivalent = r#"{
      "type":"object", "properties": {
        "kind": {"enum":["answer","tool"],"type":"string"},
        "count":{"maximum":99,"minimum":0,"type":"integer"}
      }, "required":["kind","count"], "additionalProperties":false
    }"#;
    let second = match cache.get_or_compile(equivalent) {
        Ok(grammar) => grammar,
        Err(error) => return Check::fail(ID, LABEL, error),
    };
    if !Rc::ptr_eq(&first, &second)
        || cache.len() != 1
        || cache.compilations() != 1
        || cache.hits() != 1
    {
        return Check::fail(
            ID,
            LABEL,
            format!(
                "equivalent schema missed: entries={} compiles={} hits={} same_rc={}",
                cache.len(),
                cache.compilations(),
                cache.hits(),
                Rc::ptr_eq(&first, &second)
            ),
        );
    }
    if cache.get_or_compile(r#"{"type":"boolean"}"#).is_err()
        || cache.len() != 2
        || cache.compilations() != 2
    {
        return Check::fail(
            ID,
            LABEL,
            "a distinct boolean schema was not compiled exactly once",
        );
    }
    Check::pass(
        ID,
        LABEL,
        "whitespace/key-order variant reused the same Rc; one miss compiled",
    )
}

pub fn self_checks() -> Vec<Check> {
    vec![
        check_schema_compile(),
        check_valid_acceptance(),
        check_earliest_rejection(),
        check_token_mask(),
        check_mask_overhead(),
        check_compile_cache(),
    ]
}

#[no_mangle]
pub extern "C" fn ks_run(_in_ptr: u32, _in_len: u32) -> u64 {
    let report = Report {
        lab: "xgrammar-lite",
        version: 1,
        checks: self_checks(),
    };
    kslab::emit(&report)
}
