import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t5-l2-bpe-merge-order',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t5.l2'],
  title: 'BPE encoding applies the lowest-rank merge first, not the longest match, and Llama 3 is tiktoken-style',
  before:
    'The T5.L2 listing said merges apply "in order at encode time (greedy longest-first)". The prose said LLaMA\'s models use SentencePiece-BPE variants.',
  after:
    'At encode time, repeatedly apply the merge with the lowest rank that occurs, left to right without overlap. Llama 3 uses a tiktoken-style byte-level BPE.',
  why: 'Longest-match-first is WordPiece. tiktoken\'s educational encoder picks the minimum-rank pair each round, and the Llama 3 tokenizer is built on tiktoken.',
  source: {
    url: 'https://github.com/openai/tiktoken/blob/0.12.0/tiktoken/_educational.py',
    title: 'OpenAI tiktoken 0.12.0, tiktoken/_educational.py, bpe_encode',
  },
} satisfies Erratum
