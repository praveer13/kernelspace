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
//!
//! Template v2: every check runs on its own, in a fresh copy of your module,
//! and a `todo!()` traps only the checks that reach it. Four checks keep their
//! fixed warm-up case and then draw more from the seed: `valid_acceptance`
//! (random valid documents cut at random bytes), `earliest_rejection` (one
//! corruption per round, with the byte the harness knows is first), `token_mask`
//! (a random half-written document and a random vocabulary, graded against a
//! brute-force search over the whole language) and `compile_cache` (random
//! schemas, rewritten with other key orders and whitespace). `cargo test` runs
//! them on their default seeds and on 32 extra seeds.
//!
//! Which check catches which mistake:
//!
//! ```text
//!   schema_compile      a compile that fails on a nested schema, or lowers
//!                       it to fewer than 5 or more than 128 states
//!   valid_acceptance    escapes and whitespace refused, or Complete reported
//!                       before the closing brace
//!   earliest_rejection  a rejection reported at the end of its token, one that
//!                       is forgotten, integer bounds and leading zeros, enum
//!                       values, object keys, text after the closing brace
//!   token_mask          a mask that looks at the first byte of each token
//!   mask_overhead       (native runs only) 512 tokens masked in over 10 ms
//!   compile_cache       a cache keyed by the source text instead of the schema
//! ```

mod grammar;
mod schema;

use grammar::{CompiledGrammar, GrammarCache, MatchStatus, Matcher};
use kslab::{Check, CheckDef, Ctx, Lab, Rng};
use schema::parse_schema;
use std::rc::Rc;

/// The checks, in grading order. Ids and labels match `src/data/labs.ts`;
/// stages are the F2 order of play (1 = the two-minute win).
pub static CHECKS: [CheckDef; 6] = [
    CheckDef { id: "schema_compile", label: SCHEMA_COMPILE, stage: 1, seeded: false, default_seed: 0, run: check_schema_compile },
    CheckDef { id: "valid_acceptance", label: VALID_ACCEPTANCE, stage: 2, seeded: true, default_seed: 0xACCE97, run: check_valid_acceptance },
    CheckDef { id: "earliest_rejection", label: EARLIEST_REJECTION, stage: 2, seeded: true, default_seed: 0x4E1EC7, run: check_earliest_rejection },
    CheckDef { id: "token_mask", label: TOKEN_MASK, stage: 3, seeded: true, default_seed: 0x70CE45, run: check_token_mask },
    CheckDef { id: "mask_overhead", label: MASK_OVERHEAD, stage: 4, seeded: false, default_seed: 0, run: check_mask_overhead },
    CheckDef { id: "compile_cache", label: COMPILE_CACHE, stage: 4, seeded: true, default_seed: 0xCAC4E, run: check_compile_cache },
];

#[cfg(not(feature = "reference"))]
const LAB_ID: &str = "xgrammar-lite";
/// A `--features reference` build names itself, and earns no credit anywhere.
#[cfg(feature = "reference")]
const LAB_ID: &str = "xgrammar-lite@reference";

pub static LAB: Lab = Lab { id: LAB_ID, version: 2, checks: &CHECKS };

const SCHEMA_COMPILE: &str = "JSON Schema lowers to a finite pushdown program";
const VALID_ACCEPTANCE: &str = "valid nested JSON is accepted across token boundaries";
const EARLIEST_REJECTION: &str = "invalid output rejects at the earliest byte";
const TOKEN_MASK: &str = "mask validates whole BPE tokens, not first characters";
const MASK_OVERHEAD: &str = "512-token mask stays in the microsecond regime";
const COMPILE_CACHE: &str = "semantic grammar cache reuses compiled programs";

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

/// The schema the rejection rounds corrupt documents of.
const EVENT_SCHEMA: &str = r#"{"type":"object","properties":{"id":{"type":"integer","minimum":0,"maximum":100},"tag":{"type":"string","enum":["alpha","beta","gamma"]},"ok":{"type":"boolean"}},"required":["id","tag","ok"],"additionalProperties":false}"#;
const TAGS: [&str; 3] = ["alpha", "beta", "gamma"];

fn compiled(source: &str) -> Result<Rc<CompiledGrammar>, String> {
    let schema = parse_schema(source)?;
    CompiledGrammar::compile(&schema).map(Rc::new)
}

/* ----------------------- the harness's own model --------------------- */

/// A document as the harness shows it in a failure message: escaped, and cut.
fn show(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let shown = format!("{:?}", kslab::clip(&text, 70));
    if text.chars().count() > 70 {
        format!("{shown}…")
    } else {
        shown
    }
}

/// Cut `bytes` into 2–6 non-empty tokens at random places.
fn split<'a>(rng: &mut Rng, bytes: &'a [u8]) -> Vec<&'a [u8]> {
    let cuts = rng.range(1, 5).min(bytes.len().saturating_sub(1));
    let mut at: Vec<usize> = (0..cuts).map(|_| rng.range(1, bytes.len() - 1)).collect();
    at.sort_unstable();
    at.dedup();
    let mut parts = Vec::new();
    let mut from = 0;
    for cut in at {
        parts.push(&bytes[from..cut]);
        from = cut;
    }
    parts.push(&bytes[from..]);
    parts
}

fn ws(rng: &mut Rng, out: &mut Vec<u8>) {
    match rng.below(6) {
        0 => out.push(b' '),
        1 => out.push(b'\n'),
        _ => {}
    }
}

/// Plain pieces of a string value, and the escapes the grammar allows.
const PLAIN_PIECES: [&str; 5] = ["a", "Z", "7", " ", "-"];
const ESCAPES: [&str; 5] = [r"\n", r#"\""#, r"\\", r"\u00e9", r"\t"];

/// A random document valid for `PROFILE_SCHEMA`, with whitespace between tokens
/// and the escape `ESCAPES[escape % 5]` somewhere in its name.
fn profile_doc(rng: &mut Rng, escape: usize) -> Vec<u8> {
    let mut o = Vec::new();
    o.push(b'{');
    ws(rng, &mut o);
    o.extend_from_slice(br#""name""#);
    ws(rng, &mut o);
    o.push(b':');
    ws(rng, &mut o);
    o.push(b'"');
    let pieces = rng.range(0, 8);
    let escape_at = rng.below(pieces + 1);
    for i in 0..=pieces {
        if i == escape_at {
            o.extend_from_slice(ESCAPES[escape % 5].as_bytes());
        }
        if i < pieces {
            let all = PLAIN_PIECES.len() + ESCAPES.len();
            let k = rng.below(all);
            o.extend_from_slice(if k < PLAIN_PIECES.len() { PLAIN_PIECES[k] } else { ESCAPES[k - PLAIN_PIECES.len()] }.as_bytes());
        }
    }
    o.push(b'"');
    ws(rng, &mut o);
    o.push(b',');
    ws(rng, &mut o);
    o.extend_from_slice(br#""scores""#);
    ws(rng, &mut o);
    o.push(b':');
    ws(rng, &mut o);
    o.push(b'[');
    ws(rng, &mut o);
    for i in 0..rng.range(1, 4) {
        if i > 0 {
            ws(rng, &mut o);
            o.push(b',');
            ws(rng, &mut o);
        }
        o.extend_from_slice(rng.below(101).to_string().as_bytes());
    }
    ws(rng, &mut o);
    o.push(b']');
    ws(rng, &mut o);
    o.push(b',');
    ws(rng, &mut o);
    o.extend_from_slice(br#""active""#);
    ws(rng, &mut o);
    o.push(b':');
    ws(rng, &mut o);
    o.extend_from_slice(if rng.below(2) == 0 { b"true".as_slice() } else { b"false".as_slice() });
    ws(rng, &mut o);
    o.push(b'}');
    o
}

/// Every document of `TOOL_SCHEMA` written without whitespace: the language, enumerated.
fn tool_docs() -> Vec<String> {
    ["tool", "answer"]
        .iter()
        .flat_map(|kind| (0..100).map(move |n| format!(r#"{{"kind":"{kind}","count":{n}}}"#)))
        .collect()
}

/// The first byte of `text` after which no integer in 0..=100 can still be written
/// the way `text` is. Found the slow way: try every integer.
fn int_reject_offset(text: &str) -> Option<usize> {
    (1..=text.len()).find(|&k| !(0..=100).any(|v: u32| v.to_string().starts_with(&text[..k]))).map(|k| k - 1)
}

/// Likewise for the quoted `TAGS` variants.
fn tag_reject_offset(text: &str) -> Option<usize> {
    (1..=text.len()).find(|&k| !TAGS.iter().any(|t| format!("\"{t}\"").starts_with(&text[..k]))).map(|k| k - 1)
}

/* ------------------------------ checks ------------------------------ */

/// 1. The compiler handles nested schema nodes and rejects unsupported
/// object semantics rather than silently accepting a broader language.
pub fn check_schema_compile(_: &Ctx) -> Check {
    const ID: &str = "schema_compile";
    const LABEL: &str = SCHEMA_COMPILE;
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
/// boundaries; only the final fragment makes the matcher complete. The fixed
/// document first, then six random ones cut at random bytes, each with one of
/// the five escapes. Seeded: the documents, their whitespace, and where they are cut.
pub fn check_valid_acceptance(ctx: &Ctx) -> Check {
    const ID: &str = "valid_acceptance";
    const LABEL: &str = VALID_ACCEPTANCE;
    let grammar = match compiled(PROFILE_SCHEMA) {
        Ok(grammar) => grammar,
        Err(error) => return Check::fail(ID, LABEL, error),
    };
    let mut matcher = Matcher::new(Rc::clone(&grammar));
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

    let mut rng = Rng::seeded(ctx.seed);
    let first_escape = rng.below(5);
    for round in 0..6 {
        let doc = profile_doc(&mut rng, first_escape + round);
        let parts = split(&mut rng, &doc);
        let mut matcher = Matcher::new(Rc::clone(&grammar));
        let mut fed = 0;
        for (index, part) in parts.iter().enumerate() {
            let status = matcher.accept_token(part);
            fed += part.len();
            if status.is_rejected() {
                return Check::fail(
                    ID,
                    LABEL,
                    format!(
                        "round {round}: a valid document was rejected after {fed} of {} bytes ({status:?}): {}",
                        doc.len(),
                        show(&doc)
                    ),
                );
            }
            if index + 1 < parts.len() && status == MatchStatus::Complete {
                return Check::fail(ID, LABEL, format!("round {round}: Complete after {fed} of {} bytes: {}", doc.len(), show(&doc)));
            }
        }
        if !matcher.can_end() {
            return Check::fail(
                ID,
                LABEL,
                format!("round {round}: all {} bytes fed but the status is {:?}: {}", doc.len(), matcher.status(), show(&doc)),
            );
        }
    }
    Check::pass(
        ID,
        LABEL,
        "nested array, escapes, whitespace, integer bounds and booleans accepted, in the fixed document and six random ones",
    )
}

/// One corrupted document and the byte the matcher must name.
fn corrupt(rng: &mut Rng, kind: usize) -> (&'static str, Vec<u8>, usize) {
    let id = rng.below(101);
    let tag = TAGS[rng.below(3)];
    let ok = if rng.below(2) == 0 { "true" } else { "false" };
    let doc = format!(r#"{{"id":{id},"tag":"{tag}","ok":{ok}}}"#);
    let id_at = 6; // after {"id":
    let tag_at = doc.find("\"tag\":").unwrap_or(0) + 6;
    let ok_at = doc.find("\"ok\":").unwrap_or(0) + 5;
    match kind % 11 {
        0 => {
            // one letter of a key replaced
            let key = ["id", "tag", "ok"][rng.below(3)];
            let at = doc.find(&format!("\"{key}\"")).unwrap_or(0) + 1 + rng.below(key.len());
            let mut bytes = doc.into_bytes();
            bytes[at] = b'X';
            ("a misspelled key", bytes, at)
        }
        1 => {
            let at = ok_at + 1 + rng.below(ok.len() - 1);
            let mut bytes = doc.into_bytes();
            bytes[at] = b'x';
            ("a broken boolean literal", bytes, at)
        }
        2 | 8 | 9 => {
            let (what, bad) = match kind % 11 {
                2 => ("an integer above the maximum", (101 + rng.below(899)).to_string()),
                8 => ("a negative integer", format!("-{}", 1 + rng.below(99))),
                _ => ("an integer with a leading zero", format!("0{}", 1 + rng.below(99))),
            };
            let at = id_at + int_reject_offset(&bad).unwrap_or(0);
            let text = format!(r#"{{"id":{bad},"tag":"{tag}","ok":{ok}}}"#);
            (what, text.into_bytes(), at)
        }
        3 | 10 => {
            let (what, bad) = if kind % 11 == 3 {
                let mut letters = tag.as_bytes().to_vec();
                let at = rng.below(letters.len());
                letters[at] = b'X';
                ("an enum value with one wrong letter", String::from_utf8_lossy(&letters).into_owned())
            } else {
                ("a string that is not an enum value", ["delta", "alp", "alphabet", "gam", "betas"][rng.below(5)].to_string())
            };
            let quoted = format!("\"{bad}\"");
            let at = tag_at + tag_reject_offset(&quoted).unwrap_or(0);
            let text = format!(r#"{{"id":{id},"tag":{quoted},"ok":{ok}}}"#);
            (what, text.into_bytes(), at)
        }
        4 => {
            let comma = if rng.below(2) == 0 { doc.find(",\"tag\"") } else { doc.find(",\"ok\"") }.unwrap_or(0);
            let mut bytes = doc.into_bytes();
            bytes.remove(comma);
            ("a missing comma", bytes, comma)
        }
        5 => {
            let at = doc.len();
            let mut bytes = doc.into_bytes();
            bytes.push(b'x');
            ("text after the closing brace", bytes, at)
        }
        6 => {
            let text = format!(r#"{{"id":true,"tag":"{tag}","ok":{ok}}}"#);
            ("a boolean where an integer belongs", text.into_bytes(), id_at)
        }
        _ => {
            // kind 7
            let text = format!(r#"{{"id":{id},"tag":7,"ok":{ok}}}"#);
            ("a number where a string belongs", text.into_bytes(), tag_at)
        }
    }
}

/// 3. Invalid output is rejected at the first impossible byte, not at the
/// end of a token or after the complete document has been buffered. The
/// fixed case first, then one corruption of each of eleven kinds, alternately fed as one
/// token and cut at random bytes. Seeded: the document, the corruption and
/// the cuts; the expected byte comes from the harness's own enumeration.
pub fn check_earliest_rejection(ctx: &Ctx) -> Check {
    const ID: &str = "earliest_rejection";
    const LABEL: &str = EARLIEST_REJECTION;
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

    let grammar = match compiled(EVENT_SCHEMA) {
        Ok(grammar) => grammar,
        Err(error) => return Check::fail(ID, LABEL, error),
    };
    let mut rng = Rng::seeded(ctx.seed);
    // eleven rounds, eleven kinds of corruption, in an order drawn from the seed
    let first_kind = rng.below(11);
    for round in 0..11 {
        let (what, doc, bad) = corrupt(&mut rng, first_kind + round);
        let parts = if round % 2 == 0 { vec![doc.as_slice()] } else { split(&mut rng, &doc) };
        let mut matcher = Matcher::new(Rc::clone(&grammar));
        let (mut from, mut seen) = (0, None);
        for part in &parts {
            let to = from + part.len();
            let status = matcher.accept_token(part);
            if let Some(first) = seen {
                if status != first {
                    return Check::fail(ID, LABEL, format!("round {round}: the rejection was not sticky: {first:?}, then {status:?}"));
                }
            } else if to <= bad {
                if status.is_rejected() {
                    return Check::fail(
                        ID,
                        LABEL,
                        format!("round {round} ({what}): rejected a valid prefix ({status:?}); the first bad byte is {bad}: {}", show(&doc)),
                    );
                }
            } else if status != (MatchStatus::Rejected { byte: bad }) {
                return Check::fail(
                    ID,
                    LABEL,
                    format!("round {round} ({what}): expected rejection at byte {bad}, got {status:?}: {}", show(&doc)),
                );
            } else {
                seen = Some(status);
            }
            from = to;
        }
    }
    Check::pass(
        ID,
        LABEL,
        format!("rejected the opening quote at byte {expected}, and eleven kinds of corruption at their first bad byte"),
    )
}

/// 4. A BPE token is a byte string, not a character. Legal tokens may cross
/// several punctuation states; a token with a legal first byte may still be
/// illegal before it ends. The fixed vocabulary first, then four random
/// half-written documents with 24 random tokens each. Seeded: the states and
/// the tokens; the expected mask is a search of the 200 documents the schema
/// allows (written without whitespace).
pub fn check_token_mask(ctx: &Ctx) -> Check {
    const ID: &str = "token_mask";
    const LABEL: &str = TOKEN_MASK;
    let grammar = match compiled(TOOL_SCHEMA) {
        Ok(grammar) => grammar,
        Err(error) => return Check::fail(ID, LABEL, error),
    };
    let mut matcher = Matcher::new(Rc::clone(&grammar));
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

    let docs = tool_docs();
    let mut rng = Rng::seeded(ctx.seed);
    for round in 0..4 {
        let doc = &docs[rng.below(docs.len())];
        let cut = rng.range(0, doc.len() - 1);
        let consumed = &doc[..cut];
        let mut matcher = Matcher::new(Rc::clone(&grammar));
        if cut > 0 && matcher.accept_token(consumed.as_bytes()).is_rejected() {
            return Check::fail(ID, LABEL, format!("round {round}: the valid prefix {} was rejected", show(consumed.as_bytes())));
        }
        let continuing: Vec<&String> = docs.iter().filter(|d| d.starts_with(consumed)).collect();
        let mut owned: Vec<String> = Vec::new();
        for i in 0..24 {
            let token = if i % 3 == 2 {
                // a slice from anywhere: usually wrong here
                let d = &docs[rng.below(docs.len())];
                let at = rng.below(d.len());
                d[at..(at + rng.range(1, 14)).min(d.len())].to_string()
            } else {
                // a continuation of this very prefix, sometimes with one byte changed
                let d = continuing[rng.below(continuing.len())];
                let mut t = d[cut..(cut + rng.range(1, 14)).min(d.len())].as_bytes().to_vec();
                if rng.below(3) == 0 {
                    let at = rng.below(t.len());
                    t[at] = b"{}\":,0123456789xz"[rng.below(17)];
                }
                String::from_utf8_lossy(&t).into_owned()
            };
            owned.push(token);
        }
        let vocab: Vec<&str> = owned.iter().map(String::as_str).collect();
        let want: Vec<bool> = vocab.iter().map(|t| docs.iter().any(|d| d.starts_with(&format!("{consumed}{t}")))).collect();
        let before = matcher.status();
        let got = matcher.token_mask(&vocab);
        if got.len() != want.len() {
            return Check::fail(ID, LABEL, format!("round {round}: the mask has {} entries for {} tokens", got.len(), want.len()));
        }
        if let Some(i) = (0..want.len()).find(|&i| got[i] != want[i]) {
            return Check::fail(
                ID,
                LABEL,
                format!(
                    "round {round}: after {} the token {} is {} but the mask says {}",
                    show(consumed.as_bytes()),
                    show(vocab[i].as_bytes()),
                    if want[i] { "legal" } else { "illegal" },
                    if got[i] { "legal" } else { "illegal" }
                ),
            );
        }
        if matcher.status() != before {
            return Check::fail(ID, LABEL, format!("round {round}: token_mask changed the matcher it was called on"));
        }
    }
    Check::pass(
        ID,
        LABEL,
        "multi-state token allowed; bad suffix and wrong literal masked; four random states agree with a search of the language",
    )
}

/// 5. Mask generation remains a per-step microsecond operation on a small
/// production-shaped vocabulary. wasm32 runs the same semantic workload;
/// native tests additionally enforce the wall-clock budget.
pub fn check_mask_overhead(_: &Ctx) -> Check {
    const ID: &str = "mask_overhead";
    const LABEL: &str = MASK_OVERHEAD;
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

/* ------------------------- random schemas, cache --------------------- */

#[derive(Clone)]
enum Ty {
    Int(i64, i64),
    Bool,
    Str,
    Enum(Vec<&'static str>),
    /// integer items in lo..=hi, minItems, maxItems
    Arr(i64, i64, usize, usize),
}

const FIELD_NAMES: [&str; 8] = ["id", "name", "kind", "count", "ok", "score", "tags", "user"];
const WORDS: [&str; 6] = ["red", "green", "blue", "cyan", "pink", "gray"];

fn gen_fields(rng: &mut Rng) -> Vec<(&'static str, Ty)> {
    let mut names: Vec<&'static str> = FIELD_NAMES.to_vec();
    let mut fields = Vec::new();
    for _ in 0..rng.range(2, 4) {
        let name = names.remove(rng.below(names.len()));
        let ty = match rng.below(5) {
            0 => {
                let lo = rng.below(50) as i64;
                Ty::Int(lo, lo + rng.range(1, 500) as i64)
            }
            1 => Ty::Bool,
            2 => Ty::Str,
            3 => {
                let mut words: Vec<&'static str> = WORDS.to_vec();
                Ty::Enum((0..3).map(|_| words.remove(rng.below(words.len()))).collect())
            }
            _ => {
                let lo = rng.below(10) as i64;
                let min = rng.below(2);
                Ty::Arr(lo, lo + rng.range(1, 90) as i64, min, min + rng.range(1, 4))
            }
        };
        fields.push((name, ty));
    }
    fields
}

fn shuffled<T>(rng: &mut Rng, items: &mut [T]) {
    for i in (1..items.len()).rev() {
        items.swap(i, rng.below(i + 1));
    }
}

/// `{"k": v, …}` with the pairs optionally in another order and with whitespace.
fn object_text(rng: &mut Rng, mut pairs: Vec<(&str, String)>, variant: bool) -> String {
    if variant {
        shuffled(rng, &mut pairs);
    }
    let sep = |rng: &mut Rng| if variant { [" ", "\n  ", ""][rng.below(3)] } else { "" };
    let mut out = String::from("{");
    for (i, (k, v)) in pairs.iter().enumerate() {
        if i > 0 {
            out.push(',');
            out.push_str(sep(rng));
        }
        out.push_str(&format!("\"{k}\":{}{v}", sep(rng)));
    }
    out.push('}');
    out
}

fn node_text(rng: &mut Rng, ty: &Ty, variant: bool) -> String {
    match ty {
        Ty::Int(lo, hi) => object_text(rng, vec![("type", "\"integer\"".into()), ("minimum", lo.to_string()), ("maximum", hi.to_string())], variant),
        Ty::Bool => object_text(rng, vec![("type", "\"boolean\"".into())], variant),
        Ty::Str => object_text(rng, vec![("type", "\"string\"".into())], variant),
        Ty::Enum(words) => {
            let mut words = words.clone();
            if variant {
                shuffled(rng, &mut words);
            }
            let list = words.iter().map(|w| format!("\"{w}\"")).collect::<Vec<_>>().join(",");
            object_text(rng, vec![("type", "\"string\"".into()), ("enum", format!("[{list}]"))], variant)
        }
        Ty::Arr(lo, hi, min, max) => {
            let item = node_text(rng, &Ty::Int(*lo, *hi), variant);
            object_text(
                rng,
                vec![("type", "\"array\"".into()), ("items", item), ("minItems", min.to_string()), ("maxItems", max.to_string())],
                variant,
            )
        }
    }
}

/// The schema for `fields`. `variant` rewrites it without changing what it means:
/// other keyword order, other `required` order, other enum order, whitespace.
fn schema_text(rng: &mut Rng, fields: &[(&'static str, Ty)], variant: bool) -> String {
    // `properties` keeps its order: it is the order the object is written in.
    let props: Vec<String> = fields.iter().map(|(name, ty)| format!("\"{name}\":{}", node_text(rng, ty, variant))).collect();
    let mut required: Vec<String> = fields.iter().map(|(name, _)| format!("\"{name}\"")).collect();
    if variant {
        shuffled(rng, &mut required);
    }
    object_text(
        rng,
        vec![
            ("type", "\"object\"".into()),
            ("properties", format!("{{{}}}", props.join(","))),
            ("required", format!("[{}]", required.join(","))),
            ("additionalProperties", "false".into()),
        ],
        variant,
    )
}

/// 6. Equivalent schema source strings hit one normalized compile entry and
/// return the same Rc; a genuinely different schema compiles once more. The
/// fixed pair first, then a random schema, three rewrites of it, and a second
/// schema that differs by one extra field. Seeded: both schemas and every rewrite.
pub fn check_compile_cache(ctx: &Ctx) -> Check {
    const ID: &str = "compile_cache";
    const LABEL: &str = COMPILE_CACHE;
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

    let mut rng = Rng::seeded(ctx.seed);
    let a_fields = gen_fields(&mut rng);
    let mut b_fields = a_fields.clone();
    let spare = FIELD_NAMES.iter().find(|n| !a_fields.iter().any(|(name, _)| name == *n)).copied().unwrap_or("spare");
    b_fields.push((spare, Ty::Bool));
    let mut cache = GrammarCache::new();
    // (fields, rewritten?, expected entries, compiles, hits after this call)
    let calls: [(&[(&str, Ty)], bool, usize, usize, usize); 6] = [
        (&a_fields, false, 1, 1, 0),
        (&a_fields, true, 1, 1, 1),
        (&a_fields, true, 1, 1, 2),
        (&b_fields, false, 2, 2, 2),
        (&b_fields, true, 2, 2, 3),
        (&a_fields, true, 2, 2, 4),
    ];
    let (mut a_rc, mut b_rc): (Option<Rc<CompiledGrammar>>, Option<Rc<CompiledGrammar>>) = (None, None);
    for (n, (fields, variant, len, compiles, hits)) in calls.iter().enumerate() {
        let text = schema_text(&mut rng, fields, *variant);
        let grammar = match cache.get_or_compile(&text) {
            Ok(grammar) => grammar,
            Err(error) => return Check::fail(ID, LABEL, format!("call {n}: {error}: {}", show(text.as_bytes()))),
        };
        let slot = if fields.len() == a_fields.len() { &mut a_rc } else { &mut b_rc };
        let same = slot.get_or_insert_with(|| Rc::clone(&grammar));
        if !Rc::ptr_eq(same, &grammar) || cache.len() != *len || cache.compilations() != *compiles || cache.hits() != *hits {
            return Check::fail(
                ID,
                LABEL,
                format!(
                    "call {n}: want entries={len} compiles={compiles} hits={hits} and the same Rc per meaning; got entries={} compiles={} hits={} same_rc={}: {}",
                    cache.len(),
                    cache.compilations(),
                    cache.hits(),
                    Rc::ptr_eq(same, &grammar),
                    show(text.as_bytes())
                ),
            );
        }
    }
    if let (Some(a), Some(b)) = (&a_rc, &b_rc) {
        if Rc::ptr_eq(a, b) {
            return Check::fail(ID, LABEL, "two different schemas share one compiled program");
        }
    }
    Check::pass(
        ID,
        LABEL,
        "whitespace/key-order variants reused the same Rc; a random schema and a changed one each compiled once",
    )
}

/// The full suite on default seeds, in grading order (v1 report order).
pub fn self_checks() -> Vec<Check> {
    CHECKS.iter().map(|c| (c.run)(&Ctx { seed: c.default_seed, fresh: false })).collect()
}

/* ------------------------------ probe ------------------------------- */

/// `probe <seed>`: decode a `TOOL_SCHEMA` document through YOUR matcher. At
/// each step the mask over a 64-token vocabulary (whole-document fragments and
/// single characters) is computed, and a seeded pick among the legal tokens is
/// accepted, until the matcher completes. One line: the steps, how many tokens
/// were legal at each, and the text. Deterministic for a given seed and matcher.
pub fn probe(seed: u32) -> String {
    let grammar = match compiled(TOOL_SCHEMA) {
        Ok(grammar) => grammar,
        Err(error) => return format!("err {error}"),
    };
    let docs = tool_docs();
    let mut rng = Rng::seeded(seed);
    let mut owned: Vec<String> = "{}\":,0123456789tolanswerkindc".chars().map(String::from).collect();
    while owned.len() < 64 {
        let d = &docs[rng.below(docs.len())];
        let at = rng.below(d.len());
        owned.push(d[at..(at + rng.range(2, 10)).min(d.len())].to_string());
    }
    let vocab: Vec<&str> = owned.iter().map(String::as_str).collect();
    let mut matcher = Matcher::new(grammar);
    let mut text = String::new();
    let mut legal_per_step = Vec::new();
    for _ in 0..40 {
        let mask = matcher.token_mask(&vocab);
        let legal: Vec<usize> = (0..vocab.len()).filter(|&i| mask[i]).collect();
        legal_per_step.push(legal.len().to_string());
        if legal.is_empty() {
            return format!("err no legal token after {}", show(text.as_bytes()));
        }
        let pick = vocab[legal[rng.below(legal.len())]];
        text.push_str(pick);
        if matcher.accept_token(pick.as_bytes()).is_rejected() {
            return format!("err the mask allowed {} but accept_token rejected it", show(pick.as_bytes()));
        }
        if matcher.can_end() {
            break;
        }
    }
    format!(
        "steps={} complete={} legal_per_step={} text={}",
        legal_per_step.len(),
        matcher.can_end(),
        legal_per_step.join(","),
        show(text.as_bytes())
    )
}

/* ------------------------------ wasm ABI ---------------------------- */

kslab::export_abi_v2!();

#[no_mangle]
pub extern "C" fn ks_run(in_ptr: u32, in_len: u32) -> u64 {
    kslab::run(unsafe { kslab::input(in_ptr, in_len) }, &LAB)
}

/// The runtime bridge: `probe <seed>` (see `probe`).
#[no_mangle]
pub extern "C" fn ks_invoke(in_ptr: u32, in_len: u32) -> u64 {
    kslab::install_panic_hook();
    let cmd = std::str::from_utf8(unsafe { kslab::input(in_ptr, in_len) }).unwrap_or("");
    let mut it = cmd.split_whitespace();
    let reply = match (it.next(), it.next().map(str::parse::<u32>)) {
        (Some("probe"), Some(Ok(seed))) => probe(seed),
        _ => format!("err unknown command {:?} (try: probe <seed>)", kslab::clip(cmd.trim(), 40)),
    };
    kslab::emit_str(&reply)
}
