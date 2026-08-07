//! kslab — the kernelspace forge lab kit.
//!
//! ABI between student Rust code (compiled to `wasm32-unknown-unknown`) and
//! the in-browser runner. Deliberately **no wasm-bindgen and zero
//! dependencies**: the whole contract is three exported functions and one
//! JSON document. Students need nothing but `rustup target add
//! wasm32-unknown-unknown` — no wasm-pack, no npm, no version dance.
//!
//! ```text
//!   ks_alloc(len) -> ptr              host allocates a buffer in module memory
//!   ks_free(ptr, len)                 host releases a buffer it allocated
//!   ks_run(in_ptr, in_len) -> u64     runs the lab's self-check suite; returns
//!                                     (out_ptr << 32) | out_len
//! ```
//!
//! `ks_run` ignores its input for check-style labs (the traces are compiled
//! in) and returns a JSON report in module memory:
//!
//! ```json
//! { "lab": "rust-allocator", "version": 1,
//!   "checks": [ { "id": "align", "label": "…", "pass": true, "msg": "…" } ] }
//! ```
//!
//! The same check functions back `cargo test`, so the browser and the
//! terminal always agree — one source of truth, in Rust.
//!
//! Panics (e.g. `todo!()` in unfinished code) trap; the host catches the trap
//! and renders it as "not implemented yet". That is a feature: a half-written
//! allocator should fail loudly, not silently.

use std::cell::RefCell;

thread_local! {
    /// Output staging buffer. Single-threaded wasm — a RefCell, not a lock.
    /// The host reads the report out of module memory immediately after
    /// `ks_run` returns, before any other call.
    static OUT: RefCell<Vec<u8>> = RefCell::new(Vec::new());
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
}
