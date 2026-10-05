import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t5-l2-cjk-tokens-bounded-by-utf8-bytes',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t5.l2'],
  title: 'A byte-level tokenizer never spends more tokens on a CJK character than its UTF-8 bytes',
  before:
    'T5.L2 said "many tokenizers spend 2–5 tokens per CJK character — text can be longer in tokens than UTF-8 bytes", and its stat chip showed "2–5×" CJK token inflation.',
  after:
    'Every token covers at least one byte, so a CJK character costs at most as many tokens as its UTF-8 bytes: 3 for everyday ones (4 for rare ones). tiktoken gave 1 to 3 for a single everyday character on gpt2, cl100k_base and o200k_base.',
  why: 'The old figure suggested tokens could outnumber bytes. Byte-level BPE starts from single bytes, so every token covers at least one byte, which caps a 3-byte character at 3 tokens and any text at its byte count.',
  source: {
    url: 'https://github.com/openai/tiktoken',
    title: 'OpenAI tiktoken (byte-level BPE), 3,000 random characters per block: ideographs, kana and Hangul took 1 to 3 tokens each on gpt2, cl100k_base and o200k_base, 4-byte ideographs 3 to 4 (checked 2026-10)',
  },
  items: [
    {
      q: 'What is the most tokens a byte-level BPE tokenizer can ever spend on one everyday CJK character?',
      options: [
        'Up to 5 tokens, as rare characters split into many small pieces and a text can exceed its byte count',
        'Up to 3 tokens, as every token covers at least one byte',
        'Up to 2 tokens, as the vocabulary holds most characters whole and splits the rest in two',
        'Up to 1 token, as the vocabulary holds an entry for every character',
      ],
      correct: [1],
      why: [
        'That is the old figure. A token covers at least one byte, so a 3-byte character cannot cost more than 3 tokens, and a text cannot have more tokens than bytes.',
        'Right: byte-level BPE starts from single bytes, so the worst case is one token per byte, 3 for an everyday CJK character. Merges can shrink that, and tiktoken gave 1 to 3 for a single character on gpt2, cl100k_base and o200k_base.',
        'Two is typical for common characters in some vocabularies, but it is not a bound. tiktoken needed 3 tokens for some characters on gpt2, cl100k_base and o200k_base.',
        'Not every character has its own entry. tiktoken averaged 1.9 to 2.7 tokens per random ideograph, because rarer ones fall back to two or three byte pieces.',
      ],
    },
  ],
} satisfies Erratum
