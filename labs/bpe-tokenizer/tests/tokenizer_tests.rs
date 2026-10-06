//! The browser and these tests run the same six checks (see src/lib.rs).
//! `cargo test` failing here = the site would fail too. One source of truth.
//!
//! Each check runs on its default seed, and every seeded check also runs on
//! 32 extra seeds, so a solution green here is green on the site's fresh seeds.

use bpe_tokenizer as lab;

macro_rules! lab_test {
    ($name:ident) => {
        #[test]
        fn $name() {
            let c = lab::LAB.run_check(stringify!($name), None).expect("check id is in CHECKS");
            assert!(c.pass, "[{}] {} — {}", c.id, c.label, c.msg);
        }
    };
}

lab_test!(bytes_are_ids);
lab_test!(merge_priority);
lab_test!(leftmost_nonoverlap);
lab_test!(roundtrip);
lab_test!(robust_decode);
lab_test!(contract);

/// 32 fixed seeds, spread over the u32 range (a Weyl sequence).
fn extra_seeds() -> impl Iterator<Item = u32> {
    (1..=32u32).map(|i| i.wrapping_mul(0x9E37_79B9))
}

#[test]
fn seeded_checks_pass_on_32_extra_seeds() {
    for def in lab::CHECKS.iter().filter(|c| c.seeded) {
        for seed in extra_seeds() {
            let c = lab::LAB.run_check(def.id, Some(seed)).expect("check id is in CHECKS");
            assert!(c.pass, "[{} seed {}] {} — {}", c.id, seed, c.label, c.msg);
        }
    }
}

/// The `ks_invoke` bridge the Fleet's token-count check drives. It calls your encode, so on the template
/// `count` traps ("not implemented yet") like an unfinished check; with a working tokenizer it answers
/// exactly as `labs/README.md` documents.
fn hex(text: &str) -> String {
    text.bytes().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn bridge_counts_the_48_merge_table() {
    let tk = lab::Tokenizer::new(lab::train_bpe(lab::CORPUS, 48));
    let texts = [
        "the user waits for the first token while the scheduler batches the stream",
        "hello world, hello world, hello",
        "emoji: 🦀🚀 and cjk: 推し活 and accents: naïve café",
        "— em-dash, “quotes”, and a newline\ninside",
        "aaaa",
        "x",
        "",
    ];
    for text in texts {
        let want = tk.encode(text).len().to_string();
        assert_eq!(lab::invoke(&format!("count {}", hex(text))), want, "count of {text:?}");
    }
    assert_eq!(lab::invoke(&format!("count {}", hex(texts[0]))), "34", "the contract text is 34 ids");
    assert_eq!(lab::invoke("count"), "0", "no hex is the empty text");
    assert_eq!(lab::invoke(&format!("count {}", hex("🦀"))), "4", "four bytes the table never merges");
    assert_eq!(
        lab::invoke(&format!("count {}", hex("The scheduler").to_uppercase())),
        lab::invoke(&format!("count {}", hex("The scheduler"))),
        "hex digits in either case"
    );
}

#[test]
fn bridge_rejects_bad_commands() {
    for cmd in ["count 4", "count zz", "count ff", "count c3", "count 41 42", "nope", ""] {
        assert!(lab::invoke(cmd).starts_with("err"), "{cmd:?} should be an error, got {:?}", lab::invoke(cmd));
    }
    assert!(lab::invoke("probe x").starts_with("err"));
}

#[test]
fn bridge_probe_matches_the_function() {
    for seed in [0, 1, 7, 0xC0FFEE] {
        assert_eq!(lab::invoke(&format!("probe {seed}")), lab::probe(seed));
    }
}
