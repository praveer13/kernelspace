import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't5.l2',
  slug: 'tokenization',
  trackId: 't5',
  index: 2,
  title: 'Tokenization & BPE',
  minutes: 20,
  hook: 'Why tokens, not words: the BPE algorithm, the cost model it creates, and the edge cases that bite production systems.',
  exercise: 'sim',
  simId: 'sim-engine',
  blocks: [
    {
      type: 'prose',
      md: `Models don't read text — they read sequences of integer **token ids**, each indexing a row of the embedding table. The **tokenizer** is the deterministic, model-specific compiler that turns bytes into those ids, and it shapes everything downstream: how much text fits the context window, what generation costs, which languages are cheap, and why "Strawberry has 3 r's" stumps models that can prove theorems. For a systems engineer, the tokenizer is the *unit of billing*: every capacity, latency, and cost number in T5 is priced in these little integers.

The dominant algorithm is **BPE — byte-pair encoding** (GPT-2 through GPT-4-class, LLaMA's SentencePiece-BPE variants): start with a 256-symbol alphabet of raw bytes, then repeatedly merge the most frequent adjacent pair into a new symbol, ~50k–256k times, until you have a vocabulary. Common strings become single tokens; rare ones decompose into bytes. Elegant, lossless (any byte sequence is representable), and greedy.`,
    },
    {
      type: 'code',
      filename: 'bpe.py — train a toy tokenizer in 15 lines',
      lang: 'python',
      code: `from collections import Counter

def bpe_train(corpus: list[bytes], vocab_size: int):
    # every word starts as a tuple of raw bytes
    vocab = {w: tuple(w) for w in corpus}
    merges = []
    while 256 + len(merges) < vocab_size:
        pairs = Counter(p for s in vocab.values() for p in zip(s, s[1:]))
        if not pairs:
            break
        best = pairs.most_common(1)[0][0]           # most frequent pair
        merges.append(best)
        for w, s in vocab.items():                   # merge it everywhere
            out, i = [], 0
            while i < len(s):
                if i + 1 < len(s) and (s[i], s[i+1]) == best:
                    out.append(best); i += 2
                else:
                    out.append(s[i]); i += 1
            vocab[w] = tuple(out)
    return merges    # apply in order at encode time (greedy longest-first)`,
      chips: ['greedy merge', '256-byte floor', 'lossless'],
    },
    {
      type: 'prose',
      md: `## The systems-relevant consequences

**Tokens ≠ words.** Rough English average: ~0.75 words/token (4 chars). "unbelievable" might be one token; a rare surname might be five. *Never* estimate cost in words — tokenize a representative sample and count.

**The context window is a token budget, not a text budget.** A 128k-token window holds ~90k English words of prose, but far less of something token-inefficient: code with heavy indentation, non-Latin scripts (many tokenizers spend 2–5 tokens per CJK character — text can be *longer* in tokens than UTF-8 bytes), base64, URLs, or long numbers (which often split per-digit — one reason arithmetic is hard for models).

**Tokenization is on the hot path — but it's not the bottleneck you think.** Encoding is fast (µs–ms); what matters is *counting*: billing, truncation, and context management all need exact token counts per request, which means running the tokenizer (or a cached count) per message. Under-specify this and you get the classic production bug: truncated context, silent quality loss, confused users.

**Edge cases with teeth:** trailing whitespace and capitalization are *different tokens* (" hello" vs "hello" — models learn sentence-initial forms separately); token boundaries blind the model to intra-token characters (the strawberry problem: "strawberry" is one token; the model never sees its letters); and tokenizer **version skew** — same model name, different tokenizer revision — changes token counts and breaks caches. Pin the tokenizer like you pin the model.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '~0.75', label: 'words/token (EN)', hint: 'Rule of thumb for English prose; varies wildly by content type.' },
        { value: '128k', label: 'vocab (LLaMA-3)', hint: 'Embedding rows = vocab size; a real memory line item (128k × 4096 × 2 B ≈ 1 GB).' },
        { value: '2–5×', label: 'CJK token inflation', hint: 'Per-character tokenization vs byte-efficient English — pricing differs by language.' },
        { value: '1', label: 'token = 1 decode step', hint: 'Every generated token is a full forward pass. Tokens are literally time.' },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `BPE is your **dictionary compression** — same LZ78 family DNA: frequent substrings earn short codes (single ids), rare ones stay long (byte sequences). The vocabulary is a static dictionary learned from a corpus, which makes it exactly as future-proof as your gzip dictionary: new slang, new languages, new emoji decompose inefficiently until someone retrains. And token counting for billing is your **UTF-8 byte-vs-codepoint lesson** all over again: the unit users see (words/characters) is not the unit the system prices (tokens/codepoints) — mismatch there has bitten every API product.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `Two serving traps. **(1) Prefix caching breaks on token boundaries:** cached KV is keyed by *token* prefix — an extra leading space changes the tokenization and misses the entire cache (TTFT doubles for no visible reason). Normalize before caching. **(2) Streaming detokenization:** a multi-byte token may span SSE chunks; decode incrementally with a stateful detokenizer or you'll ship mojibake to clients. Both are one-line bugs with week-long debugging sessions attached.`,
    },
    {
      type: 'prose',
      md: `## In the simulator

Type anything and watch it tokenize live: merge highlights, token ids, the byte floor for rare strings. Then run the cost experiments — same meaning in English vs CJK vs base64 — and watch token counts (read: latency and dollars) diverge. The toy engine in T5.L9 and the capstone both start here: tokenizer first, because every downstream number is denominated in its output.`,
    },
    {
      type: 'exercise',
      simId: 'sim-engine',
      machine: 'tokenizer',
      title: 'Tokenizer lab',
      tasks: [
        'Tokenize "unbelievable" vs a rare surname: count tokens; explain the split via BPE merges.',
        'Compare identical meaning in English, Japanese, and base64: measure tokens per byte.',
        'Find a word where one leading space changes the token count — the prefix-cache footgun, live.',
        'Estimate the 128k-context word capacity for prose vs source code; defend both numbers.',
      ],
      note: `Tokens are the currency of the whole stack: capacity (KV per token), latency (one step per token), cost (bytes per token). Engineers who estimate in words get surprised; engineers who tokenize samples do not.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'BPE builds its vocabulary by…',
          options: [
            'Splitting text at word boundaries',
            'Starting from 256 byte symbols and greedily merging the most frequent adjacent pair, ~vocab-size times',
            'Clustering embeddings',
            'Using a fixed dictionary of English words',
          ],
          correct: [1],
          explanation:
            'Bottom-up merging from the byte floor: frequent strings compress into single ids, rare ones decompose to bytes. Lossless, deterministic, and corpus-shaped.',
        },
        {
          q: 'Why should cost/latency estimates never be done in words?',
          options: [
            'Words are deprecated',
            'The words-per-token ratio varies by content (≈0.75 for English prose, far worse for code/CJK/base64) — tokenize a representative sample instead',
            'Tokenizers are nondeterministic',
            'Models bill per character',
          ],
          correct: [1],
          explanation:
            'The billed and scheduled unit is the token. Content-type swings of 2–5× in tokens/word are normal; a words-based capacity plan is a guess with extra steps.',
        },
        {
          q: 'A single leading space changing a prompt can break prefix caching because…',
          options: [
            'Spaces are stripped by the model',
            'KV caches are keyed by token ids, and the space changes the tokenization — the shared prefix no longer matches at the token level',
            'GPU caches are case-sensitive',
            'The embedding table is ordered',
          ],
          correct: [1],
          explanation:
            'Cache hits require token-id equality, not text similarity. Normalize/standardize prompts before caching; this is the most common silent TTFT regression in production.',
        },
        {
          q: 'The "strawberry problem" (models struggling to count letters) follows from…',
          options: [
            'Weak training data',
            'Intra-token blindness: "strawberry" is a single id — the model never sees the characters inside it',
            'Attention over letters',
            'BF16 precision loss',
          ],
          correct: [1],
          explanation:
            'Tokens are opaque atoms; sub-token structure is invisible at inference. Character-level tasks fight the tokenizer, not the model — a system-level explanation for a famous failure.',
        },
      ],
    },
  ],
}

export default lesson
