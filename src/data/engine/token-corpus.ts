/**
 * The tokenizer comparison's corpus (docs/specs/wave-2.md §10.5): eight short texts, one per way a tokenizer
 * is surprised. Your engine's `count` and Qwen3's tokenizer both run over these exact strings, so changing a
 * character changes both counts. Qwen3's side is a claim per text (`model.qwen3-tokenizer.tokens-<id>`),
 * counted by `scripts/engine/qwen3-counts.py` at the revision each claim's `pin` names; `tests/claims/pin.test.ts`
 * fails when a text and its claim's recorded hash drift apart.
 */
export interface CorpusText {
  /** Lowercase id, also the suffix of the text's claim: `model.qwen3-tokenizer.tokens-<id>`. */
  id: string
  label: string
  /** What a tokenizer trained on English prose does with it. */
  note: string
  text: string
}

export const TOKEN_CORPUS: readonly CorpusText[] = [
  {
    id: 'prose',
    label: 'English prose',
    note: 'The case tokenizers are built for: common words are one token each.',
    text: 'The scheduler admits the shortest prompt first, but a request that has waited too long goes to the front of the queue.',
  },
  {
    id: 'python',
    label: 'Python',
    note: 'Indentation, keywords and snake_case names.',
    text: 'def goodput(requests, ttft_slo, tpot_slo):\n    ok = [r for r in requests if r.ttft < ttft_slo and r.tpot < tpot_slo]\n    return len(ok) / len(requests)\n',
  },
  {
    id: 'json',
    label: 'JSON',
    note: 'Quotes, braces and keys repeat; punctuation clusters can merge.',
    text: '{"model": "qwen3-0.6b", "messages": [{"role": "user", "content": "Hello"}], "max_tokens": 128, "temperature": 0.0}',
  },
  {
    id: 'numbers',
    label: 'Numbers',
    note: 'Digits are split, not merged, in many vocabularies.',
    text: '3.14159 2718281828 1,000,000 0.000123 -42 1e-5 0xFF 2026-10-05',
  },
  {
    id: 'url',
    label: 'A URL',
    note: 'Few spaces, so a pre-tokenizer has little to split on.',
    text: 'https://example.com/v1/chat/completions?model=qwen3&stream=true#top',
  },
  {
    id: 'chinese',
    label: 'Chinese',
    note: 'No spaces; each character is three UTF-8 bytes.',
    text: '大语言模型的推理成本主要取决于显存带宽和批处理大小。',
  },
  {
    id: 'emoji',
    label: 'Emoji',
    note: 'Four UTF-8 bytes each, and a joined emoji is several code points.',
    text: 'Ship it 🚀 now 😀 team 👩‍💻 done ✅',
  },
  {
    id: 'rust',
    label: 'Rust',
    note: 'Generics, turbofish and format strings.',
    text: 'fn main() {\n    let v: Vec<u32> = (1..=4).collect();\n    println!("{:?}", v.iter().sum::<u32>());\n}\n',
  },
]

/** The corpus's ids in order; the claims and the comparison table both follow it. */
export const TOKEN_CORPUS_IDS: readonly string[] = TOKEN_CORPUS.map((t) => t.id)
