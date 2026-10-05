//! kslab — the kernelspace forge lab kit.
//!
//! ABI between student Rust code (compiled to `wasm32-unknown-unknown`) and
//! the in-browser runner. Deliberately **no wasm-bindgen and zero
//! dependencies, zero imports**: the whole contract is a handful of exported
//! functions and one JSON document. Students need nothing but `rustup target
//! add wasm32-unknown-unknown` — no wasm-pack, no npm, no version dance.
//!
//! ```text
//!   ks_alloc(len) -> ptr              host allocates a buffer in module memory
//!   ks_free(ptr, len)                 host releases a buffer it allocated
//!   ks_run(in_ptr, in_len) -> u64     runs the lab's checks; returns
//!                                     (out_ptr << 32) | out_len
//!   ks_abi_version() -> u32           2 (template v2; absent means v1)
//!   ks_panic_msg() -> u64             the last panic's text, readable after a trap
//!   ks_trace_drain() -> u64           takes the trace buffer (kslab::trace!)
//! ```
//!
//! ## ABI v2 (template v2, docs/specs/wave-1.md §12)
//!
//! `ks_run`'s input is a few lines:
//!
//! ```text
//!   v 2              the host speaks ABI v2
//!   list             reply with the checks' metadata; runs no student code
//!   only <id>        run just this check (repeatable)
//!   seed <u32>       seeded checks draw their inputs from this seed
//! ```
//!
//! Replies:
//!
//! ```json
//! list → { "lab": "rust-allocator", "version": 2, "abi": 2,
//!          "checks": [ { "id": "align", "label": "…", "stage": 2, "seeded": true } ] }
//! run  → { "lab": "rust-allocator", "version": 2, "abi": 2,
//!          "checks": [ { "id": "align", "label": "…", "pass": true, "msg": "…", "seed": 41 } ] }
//! ```
//!
//! **Empty input is v1**: every check on its default seed, and the v1 report
//! below. So v1 hosts and `cargo test` keep working unchanged.
//!
//! The host runs each check in a fresh instance of one compiled module. When a
//! check panics (`todo!()` in unfinished code) the module traps; the host then
//! calls `ks_panic_msg()` on that same instance, which a trap does not poison,
//! and shows "not implemented yet" with the panic text. A half-written
//! allocator should fail loudly, one check at a time, not silently.
//!
//! A v2 crate opts in with `kslab::export_abi_v2!();`. The version export is a
//! macro, not a kit function, so a crate still on the v1 template never claims
//! v2 just by linking this kit.
//!
//! ## ABI v1 (still served)
//!
//! ```json
//! { "lab": "rust-allocator", "version": 1,
//!   "checks": [ { "id": "align", "label": "…", "pass": true, "msg": "…" } ] }
//! ```
//!
//! The same check functions back `cargo test`, so the browser and the
//! terminal always agree — one source of truth, in Rust.

use std::cell::RefCell;

/// The ABI this kit speaks (`ks_abi_version`).
pub const ABI_VERSION: u32 = 2;
/// `ks_panic_msg` returns at most this many characters.
pub const PANIC_CAP: usize = 500;
/// `kslab::trace!` keeps at most this many bytes until the host drains it.
pub const TRACE_CAP: usize = 16 * 1024;

thread_local! {
    /// Output staging buffer. Single-threaded wasm — a RefCell, not a lock.
    /// The host reads the report out of module memory immediately after
    /// `ks_run` returns, before any other call.
    static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    /// The last panic's text, kept for `ks_panic_msg` after the trap.
    static PANIC: RefCell<String> = const { RefCell::new(String::new()) };
    /// Lines from `kslab::trace!`, pulled by the host (`ks_trace_drain`), never pushed.
    static TRACE: RefCell<TraceBuf> = const { RefCell::new(TraceBuf { text: String::new(), dropped: 0 }) };
}

struct TraceBuf {
    text: String,
    dropped: u32,
}

#[no_mangle]
pub extern "C" fn ks_alloc(len: u32) -> u32 {
    let mut buf = Vec::<u8>::with_capacity(len as usize);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr as u32
}

/// # Safety
/// Only ever called by the host with (ptr, len) pairs produced by `ks_alloc`.
#[no_mangle]
pub unsafe extern "C" fn ks_free(ptr: u32, len: u32) {
    if ptr != 0 {
        drop(Vec::from_raw_parts(ptr as *mut u8, len as usize, len as usize));
    }
}

/// The last panic's text (≤ 500 characters), empty when nothing panicked.
/// Safe to call after a trap: it only borrows what the trap left unborrowed.
#[no_mangle]
pub extern "C" fn ks_panic_msg() -> u64 {
    let msg = PANIC.with(|p| p.try_borrow().map(|p| p.clone()).unwrap_or_default());
    try_emit(msg.as_bytes())
}

/// Take the trace buffer and clear it. A note at the end counts the lines the
/// 16 KiB cap dropped.
#[no_mangle]
pub extern "C" fn ks_trace_drain() -> u64 {
    let text = TRACE.with(|t| match t.try_borrow_mut() {
        Ok(mut t) => {
            let mut text = std::mem::take(&mut t.text);
            if t.dropped > 0 {
                text.push_str(&format!("… {} trace lines dropped (16 KiB buffer)\n", t.dropped));
                t.dropped = 0;
            }
            text
        }
        Err(_) => String::new(),
    });
    try_emit(text.as_bytes())
}

/// Declares `ks_abi_version() -> 2`. A crate on template v2 invokes it once in
/// its `lib.rs`, next to `ks_run`.
#[macro_export]
macro_rules! export_abi_v2 {
    () => {
        #[no_mangle]
        pub extern "C" fn ks_abi_version() -> u32 {
            $crate::ABI_VERSION
        }
    };
}

/* ------------------------------ report ------------------------------ */

pub struct Check {
    pub id: &'static str,
    pub label: &'static str,
    pub pass: bool,
    pub msg: String,
}

impl Check {
    pub fn pass(id: &'static str, label: &'static str, msg: impl Into<String>) -> Check {
        Check { id, label, pass: true, msg: msg.into() }
    }
    pub fn fail(id: &'static str, label: &'static str, msg: impl Into<String>) -> Check {
        Check { id, label, pass: false, msg: msg.into() }
    }
}

pub struct Report {
    pub lab: &'static str,
    pub version: u32,
    pub checks: Vec<Check>,
}

/// Serialize the report into the staging buffer and return its
/// (ptr << 32) | len for the host.
pub fn emit(report: &Report) -> u64 {
    emit_str_inner(|out| write_report(out, report))
}

/// Stage an arbitrary string response (runtime/invoke ABI) and return its
/// (ptr << 32) | len for the host.
pub fn emit_str(s: &str) -> u64 {
    emit_str_inner(|out| out.extend_from_slice(s.as_bytes()))
}

fn emit_str_inner(write: impl FnOnce(&mut Vec<u8>)) -> u64 {
    OUT.with(|out| {
        let mut out = out.borrow_mut();
        out.clear();
        write(&mut out);
        let ptr = out.as_ptr() as u64;
        (ptr << 32) | out.len() as u64
    })
}

/// Like `emit_str`, but returns 0 (an empty reply) instead of panicking when a
/// trap left the staging buffer borrowed.
fn try_emit(bytes: &[u8]) -> u64 {
    OUT.with(|out| match out.try_borrow_mut() {
        Ok(mut out) => {
            out.clear();
            out.extend_from_slice(bytes);
            let ptr = out.as_ptr() as u64;
            (ptr << 32) | out.len() as u64
        }
        Err(_) => 0,
    })
}

/* ----------------------------- ABI v2 ------------------------------- */

/// What a check receives: the seed to draw from, and whether the host drew it
/// at grade time (`fresh`) or the check runs on its default seed.
pub struct Ctx {
    pub seed: u32,
    pub fresh: bool,
}

/// One check, as the crate declares it in `static CHECKS`.
pub struct CheckDef {
    pub id: &'static str,
    pub label: &'static str,
    /// F2 stage (1 = the two-minute win). Must match `src/data/labs.ts`.
    pub stage: u8,
    /// Draws its inputs from `ctx.seed`. Unseeded checks ignore the seed line.
    pub seeded: bool,
    /// The seed `cargo test` and seedless runs use.
    pub default_seed: u32,
    pub run: fn(&Ctx) -> Check,
}

/// A lab: its id (with `@reference` on a `--features reference` build), its
/// content version and its checks in grading order.
pub struct Lab {
    pub id: &'static str,
    pub version: u32,
    pub checks: &'static [CheckDef],
}

impl Lab {
    /// Run one check by id on `seed` (its default seed when None or when the
    /// check is unseeded). For `cargo test` and the kit's own tests.
    pub fn run_check(&self, id: &str, seed: Option<u32>) -> Option<Check> {
        let def = self.checks.iter().find(|c| c.id == id)?;
        Some((def.run)(&ctx_for(def, seed)))
    }
}

fn ctx_for(def: &CheckDef, seed: Option<u32>) -> Ctx {
    match seed {
        Some(s) if def.seeded => Ctx { seed: s, fresh: true },
        _ => Ctx { seed: def.default_seed, fresh: false },
    }
}

/// The `ks_run` body of a template-v2 crate:
///
/// ```ignore
/// #[no_mangle]
/// pub extern "C" fn ks_run(p: u32, l: u32) -> u64 {
///     kslab::run(unsafe { kslab::input(p, l) }, &LAB)
/// }
/// ```
pub fn run(input: &[u8], lab: &Lab) -> u64 {
    install_panic_hook();
    let reply = respond(input, lab);
    emit_str(&reply)
}

/// View the host's input buffer.
///
/// # Safety
/// `(ptr, len)` must describe a buffer the host filled through `ks_alloc`.
pub unsafe fn input<'a>(ptr: u32, len: u32) -> &'a [u8] {
    if len == 0 {
        return &[];
    }
    std::slice::from_raw_parts(ptr as *const u8, len as usize)
}

/// Record the panic's text for `ks_panic_msg`. Only on wasm: natively,
/// `cargo test` keeps Rust's own panic output.
pub fn install_panic_hook() {
    #[cfg(target_arch = "wasm32")]
    std::panic::set_hook(Box::new(|info| {
        // "panicked at src/allocator.rs:46:9:\nnot yet implemented: …" → one line
        let msg = clip(&info.to_string().replacen(":\n", ": ", 1), PANIC_CAP);
        PANIC.with(|p| {
            if let Ok(mut p) = p.try_borrow_mut() {
                *p = msg;
            }
        });
    }));
}

/// At most `max` characters of `s`, cut on a character boundary.
pub fn clip(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => s[..i].to_string(),
        None => s.to_string(),
    }
}

struct Request<'a> {
    list: bool,
    only: Vec<&'a str>,
    seed: Option<u32>,
    /// Any recognised line. Without one the input is v1 (every check, v1 report).
    v2: bool,
}

fn parse(input: &[u8]) -> Request<'_> {
    let text = std::str::from_utf8(input).unwrap_or("");
    let mut req = Request { list: false, only: Vec::new(), seed: None, v2: false };
    for line in text.lines() {
        let mut it = line.split_whitespace();
        match (it.next(), it.next()) {
            (Some("v"), Some(_)) => req.v2 = true,
            (Some("list"), _) => {
                req.list = true;
                req.v2 = true;
            }
            (Some("only"), Some(id)) => {
                req.only.push(id);
                req.v2 = true;
            }
            (Some("seed"), Some(s)) => {
                req.seed = s.parse::<u32>().ok();
                req.v2 = true;
            }
            _ => {}
        }
    }
    req
}

/// The reply `run` stages, as a string (natively testable: no pointers).
pub fn respond(input: &[u8], lab: &Lab) -> String {
    let req = parse(input);
    if !req.v2 {
        let checks = lab.checks.iter().map(|c| (c.run)(&ctx_for(c, None))).collect();
        let mut out = Vec::new();
        write_report(&mut out, &Report { lab: lab.id, version: lab.version, checks });
        return String::from_utf8(out).unwrap_or_default();
    }
    let mut s = String::new();
    s.push_str("{\"lab\":\"");
    s.push_str(&json_escape(lab.id));
    s.push_str("\",\"version\":");
    s.push_str(&lab.version.to_string());
    s.push_str(",\"abi\":");
    s.push_str(&ABI_VERSION.to_string());
    s.push_str(",\"checks\":[");
    if req.list {
        for (i, c) in lab.checks.iter().enumerate() {
            if i > 0 {
                s.push(',');
            }
            s.push_str("{\"id\":\"");
            s.push_str(&json_escape(c.id));
            s.push_str("\",\"label\":\"");
            s.push_str(&json_escape(c.label));
            s.push_str("\",\"stage\":");
            s.push_str(&c.stage.to_string());
            s.push_str(",\"seeded\":");
            s.push_str(if c.seeded { "true" } else { "false" });
            s.push('}');
        }
        s.push_str("]}");
        return s;
    }
    let selected: Vec<&CheckDef> = if req.only.is_empty() {
        lab.checks.iter().collect()
    } else {
        req.only.iter().filter_map(|id| lab.checks.iter().find(|c| c.id == *id)).collect()
    };
    for (i, def) in selected.iter().enumerate() {
        let ctx = ctx_for(def, req.seed);
        let check = (def.run)(&ctx);
        if i > 0 {
            s.push(',');
        }
        s.push_str("{\"id\":\"");
        s.push_str(&json_escape(def.id));
        s.push_str("\",\"label\":\"");
        s.push_str(&json_escape(def.label));
        s.push_str("\",\"pass\":");
        s.push_str(if check.pass { "true" } else { "false" });
        s.push_str(",\"msg\":\"");
        s.push_str(&json_escape(&check.msg));
        s.push('"');
        if def.seeded {
            s.push_str(",\"seed\":");
            s.push_str(&ctx.seed.to_string());
        }
        s.push('}');
    }
    s.push(']');
    let unknown: Vec<&str> = req.only.iter().copied().filter(|id| !lab.checks.iter().any(|c| c.id == *id)).collect();
    if !unknown.is_empty() {
        s.push_str(",\"unknown\":[");
        for (i, id) in unknown.iter().enumerate() {
            if i > 0 {
                s.push(',');
            }
            s.push('"');
            s.push_str(&json_escape(id));
            s.push('"');
        }
        s.push(']');
    }
    s.push('}');
    s
}

/* ------------------------------ trace ------------------------------- */

/// Append one line to the trace buffer the host drains after a check. Lines
/// past the 16 KiB cap are counted, not kept.
pub fn trace(line: &str) {
    TRACE.with(|t| {
        if let Ok(mut t) = t.try_borrow_mut() {
            if t.text.len() + line.len() + 1 > TRACE_CAP {
                t.dropped += 1;
            } else {
                t.text.push_str(line);
                t.text.push('\n');
            }
        }
    });
}

/// `kslab::trace!("alloc({size}) -> {off}")`: one line into the trace buffer.
#[macro_export]
macro_rules! trace {
    ($($arg:tt)*) => {
        $crate::trace(&::std::format!($($arg)*))
    };
}

/* ------------------------------- rng -------------------------------- */

/// xorshift64* seeded through splitmix64, so neighbouring seeds (41, 42)
/// still give unrelated streams. No `rand` dependency; identical in the
/// browser and in `cargo test`.
pub struct Rng(u64);

impl Rng {
    pub fn seeded(seed: u32) -> Rng {
        let mut z = (seed as u64).wrapping_add(0x9E37_79B9_7F4A_7C15);
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        // xorshift's one fixed point is 0
        Rng(if z == 0 { 0x2545_F491_4F6C_DD1D } else { z })
    }
    /// The next 64 random bits (the labs' existing name, kept on purpose).
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    /// 0..n (n ≥ 1)
    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
    /// lo..=hi
    pub fn range(&mut self, lo: usize, hi: usize) -> usize {
        lo + self.below(hi - lo + 1)
    }
}

/* --------------------------- tiny JSON ------------------------------ */
/* A report is a fixed shape; a 60-line writer beats two dependencies and  */
/* 30 s of first-build compile time.                                       */

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn write_report(out: &mut Vec<u8>, r: &Report) {
    let mut s = String::new();
    s.push_str("{\"lab\":\"");
    s.push_str(&json_escape(r.lab));
    s.push_str("\",\"version\":");
    s.push_str(&r.version.to_string());
    s.push_str(",\"checks\":[");
    for (i, c) in r.checks.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str("{\"id\":\"");
        s.push_str(&json_escape(c.id));
        s.push_str("\",\"label\":\"");
        s.push_str(&json_escape(c.label));
        s.push_str("\",\"pass\":");
        s.push_str(if c.pass { "true" } else { "false" });
        s.push_str(",\"msg\":\"");
        s.push_str(&json_escape(&c.msg));
        s.push_str("\"}");
    }
    s.push_str("]}");
    out.extend_from_slice(s.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_is_valid_shape() {
        let r = Report {
            lab: "kit-self-test",
            version: 1,
            checks: vec![
                Check::pass("a", "alpha", "ok"),
                Check::fail("b", "beta", "quote \" newline\n"),
            ],
        };
        let mut buf = Vec::new();
        write_report(&mut buf, &r);
        let s = String::from_utf8(buf).unwrap();
        assert!(s.starts_with("{\"lab\":\"kit-self-test\""));
        assert!(s.contains("\"pass\":true"));
        assert!(s.contains("\\\""));
        assert!(s.contains("\\n"));
    }

    fn fixed(_: &Ctx) -> Check {
        Check::pass("fixed", "fixed input", "ok")
    }
    fn seeded(ctx: &Ctx) -> Check {
        let mut rng = Rng::seeded(ctx.seed);
        let v = rng.below(100);
        if ctx.fresh {
            Check::pass("seeded", "seeded input", format!("fresh {}", v))
        } else {
            Check::fail("seeded", "seeded input", format!("default {}", v))
        }
    }
    fn todo(_: &Ctx) -> Check {
        todo!("not reached by list")
    }

    static CHECKS: [CheckDef; 3] = [
        CheckDef { id: "fixed", label: "fixed input", stage: 1, seeded: false, default_seed: 0, run: fixed },
        CheckDef { id: "seeded", label: "seeded input", stage: 2, seeded: true, default_seed: 7, run: seeded },
        CheckDef { id: "todo", label: "unfinished", stage: 2, seeded: false, default_seed: 0, run: todo },
    ];
    static LAB: Lab = Lab { id: "kit-self-test", version: 3, checks: &CHECKS };

    #[test]
    fn list_runs_no_check_and_reports_stages() {
        let s = respond(b"v 2\nlist\n", &LAB);
        assert_eq!(
            s,
            "{\"lab\":\"kit-self-test\",\"version\":3,\"abi\":2,\"checks\":[\
             {\"id\":\"fixed\",\"label\":\"fixed input\",\"stage\":1,\"seeded\":false},\
             {\"id\":\"seeded\",\"label\":\"seeded input\",\"stage\":2,\"seeded\":true},\
             {\"id\":\"todo\",\"label\":\"unfinished\",\"stage\":2,\"seeded\":false}]}"
        );
    }

    #[test]
    fn only_runs_one_check_with_the_seed() {
        let s = respond(b"v 2\nonly seeded\nseed 41\n", &LAB);
        assert!(s.contains("\"abi\":2"));
        assert!(s.contains("\"id\":\"seeded\""));
        assert!(s.contains("\"pass\":true"));
        assert!(s.contains("\"seed\":41"));
        assert!(!s.contains("\"id\":\"fixed\""));
    }

    #[test]
    fn a_seedless_run_uses_the_default_seed_and_unseeded_checks_ignore_seeds() {
        let s = respond(b"v 2\nonly seeded\n", &LAB);
        assert!(s.contains("\"seed\":7"));
        assert!(s.contains("\"pass\":false"));
        let f = respond(b"v 2\nonly fixed\nseed 99\n", &LAB);
        assert!(!f.contains("\"seed\""));
    }

    #[test]
    fn unknown_ids_are_named() {
        let s = respond(b"v 2\nonly nope\n", &LAB);
        assert!(s.contains("\"checks\":[]"));
        assert!(s.contains("\"unknown\":[\"nope\"]"));
    }

    #[test]
    fn empty_input_is_the_v1_report() {
        static TWO: [CheckDef; 2] = [
            CheckDef { id: "fixed", label: "fixed input", stage: 1, seeded: false, default_seed: 0, run: fixed },
            CheckDef { id: "seeded", label: "seeded input", stage: 2, seeded: true, default_seed: 7, run: seeded },
        ];
        static V1: Lab = Lab { id: "kit-self-test", version: 3, checks: &TWO };
        let s = respond(b"", &V1);
        assert!(s.starts_with("{\"lab\":\"kit-self-test\",\"version\":3,\"checks\":["));
        assert!(!s.contains("\"abi\""));
        assert!(!s.contains("\"seed\""));
        assert!(s.contains("default "));
    }

    #[test]
    fn rng_is_deterministic_and_seeds_differ() {
        let a: Vec<u64> = (0..4).map({
            let mut r = Rng::seeded(42);
            move |_| r.next()
        }).collect();
        let b: Vec<u64> = (0..4).map({
            let mut r = Rng::seeded(42);
            move |_| r.next()
        }).collect();
        let c = Rng::seeded(43).next();
        assert_eq!(a, b);
        assert_ne!(a[0], c);
        let mut r = Rng::seeded(0);
        assert_ne!(r.next(), 0);
        for _ in 0..1000 {
            let v = r.range(16, 32);
            assert!((16..=32).contains(&v));
        }
    }

    #[test]
    fn trace_caps_at_16_kib_and_counts_drops() {
        let line = "x".repeat(1000);
        for _ in 0..20 {
            trace(&line);
        }
        let kept = TRACE.with(|t| t.borrow().text.len());
        assert!(kept <= TRACE_CAP);
        assert_eq!(TRACE.with(|t| t.borrow().dropped), 4);
        trace!("{} + {}", 1, 2);
        assert_eq!(TRACE.with(|t| t.borrow().dropped), 4);
    }

    #[test]
    fn clip_cuts_on_a_char_boundary() {
        assert_eq!(clip("héllo", 2), "hé");
        assert_eq!(clip("abc", 500), "abc");
        assert_eq!(clip(&"é".repeat(600), PANIC_CAP).chars().count(), PANIC_CAP);
    }
}
