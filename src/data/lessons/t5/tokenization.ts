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

**Edge cases with teeth:** trailing whitespace and capitalization are *different tokens* (" hello" vs "hello" — models learn sentence-initial forms separately); token boundaries blind the model to intra-token characters (the strawberry problem: the model receives ids for multi-letter chunks, never the letters inside them, so counting the r's is a memorization problem, not a lookup); and tokenizer **version skew** — same model name, different tokenizer revision — changes token counts and breaks caches. Pin the tokenizer like you pin the model.`,
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

Type anything and watch it tokenize live: merge highlights, token ids, the byte floor for rare strings. Then run the cost experiments — same meaning in English vs CJK vs base64 — and watch token counts (read: latency and dollars) diverge. The toy engine in T5.L10 and the capstone both start here: tokenizer first, because every downstream number is denominated in its output.`,
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
            'Splitting text on whitespace and keeping the most common words as entries with rare words spelled out letter by letter',
            'Starting from single byte symbols and repeatedly merging the most frequent adjacent pair into a new vocabulary entry',
            'Clustering embeddings of substrings and giving each cluster a single id for substrings with similar meaning',
            'Applying a hand-written list of English prefixes and suffixes and splitting other languages into many small pieces',
          ],
          correct: [1],
          explanation:
            'Bottom-up merging from the byte floor: frequent strings compress into single ids, rare ones decompose to bytes. Lossless, deterministic, and shaped by the training corpus.',
          why: [
            'That is a word-level vocabulary with a character fallback. BPE has no word list: it starts from bytes and learns multi-byte pieces from pair frequencies.',
            'Right: each merge replaces the most frequent adjacent pair with a new symbol. About vocab-size minus 256 merges are learned, so any byte string remains encodable.',
            'BPE never looks at meaning. Merges depend only on how often adjacent symbols co-occur in the corpus; embeddings are trained afterwards, per token id.',
            'Nothing is hand-written. Poor splits for other languages come from those languages being rare in the training corpus, not from linguistic rules.',
          ],
        },
        {
          q: 'Why should cost and latency estimates never be done in words?',
          options: [
            'Tokenizers are nondeterministic, so the same text can cost a different number of tokens on each request even with a pinned version',
            'Words per token shifts with content type and falls sharply for code and non-Latin scripts, so a traffic sample gives the number',
            'Providers bill per character, so the character count is the right estimate for cost while tokens matter for context limits',
            'The context window is measured in bytes, so byte length is the right estimate while word counts under-report non-Latin scripts',
          ],
          correct: [1],
          explanation:
            'The billed and scheduled unit is the token. Content-type swings of 2-5x in tokens per word are normal, so a words-based capacity plan is a guess with extra steps.',
          why: [
            'Tokenization is a deterministic function of the text and tokenizer version. Counts differ across versions or models, which is why you pin the tokenizer, not per request.',
            'Right: the words-per-token ratio is content-dependent, so no constant converts words to cost. Tokenizing a sample from your real traffic gives the number you need.',
            'APIs price and limit by tokens, and each decode step is one token. Characters per token also varies by content, so character counts mislead too.',
            'The window counts tokens. A token covers at least one byte, so bytes only give an upper bound on token count, and the ratio still varies by script.',
          ],
        },
        {
          q: 'A single leading space changing a prompt can break prefix caching because…',
          options: [
            'The extra space adds a token, and the prefix cache matches prompts of equal length rather than shared blocks',
            'The cache is keyed by token ids, and the space re-tokenizes the start of the prompt and breaks the shared prefix',
            'The server hashes the raw prompt string, and the model strips the leading space before the stored entry is built',
            'Whitespace changes the embedding of the first token, and the cache stores embeddings that are lost for that one entry',
          ],
          correct: [1],
          explanation:
            'Cache hits require token-id equality, not text similarity. Because each block hash chains the blocks before it, one changed id at the start misses every later block. Normalize prompts before caching; this is a common silent TTFT regression.',
          why: [
            'Matching is by prefix, block by block, and prompts of different lengths share blocks all the time. Length is not the test; token-id equality of the leading blocks is.',
            'Right: prefix caching matches token-id blocks, and the space changes the first ids. Each block hash includes the preceding blocks, so all later blocks miss too.',
            'Models do not strip the space; it becomes part of a different token. The miss comes from different token ids, not from a string-versus-text mismatch between layers.',
            'The cache holds K/V per layer, not embeddings, and causal attention carries the changed first token into every later position, so every later block\'s K/V differs as well.',
          ],
        },
        {
          q: 'The "strawberry problem" (models struggling to count letters) follows from…',
          options: [
            'Too little text about spelling in the training data, so more data would teach the model the letters inside each token',
            'The model receiving ids for multi-letter chunks, so the letters inside a chunk stay out of its input',
            'Attention being blind to character order, so the model sees which letters appear but not their counts',
            'Counting needing a sequential loop, so one forward pass cannot express it even for single characters',
          ],
          correct: [1],
          explanation:
            'Tokens are opaque ids for multi-character chunks; the characters inside them never reach the model. Letter-level tasks fight the tokenizer, not the model, a system-level explanation for a famous failure.',
          why: [
            'Spelling data helps a model memorize token spellings, but the input still carries no letters. The structural cause is the tokenizer, so data alone does not remove it.',
            'Right: the model sees only token ids, each standing for a chunk of several letters. Letter counts must be memorized per token or worked out step by step.',
            'Attention never sees characters. It operates on token embeddings with position information, so there is no letter-level view to be order-blind about.',
            'A forward pass attends over every position at once, and spelling the word out step by step helps token models count. The obstacle is letters hidden inside tokens, not a missing loop.',
          ],
        },
      ],
    },
  ],
}

export default lesson
