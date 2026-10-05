import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t5-l2-strawberry-token-count-depends-on-the-space',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t5.l2'],
  title: 'Whether "strawberry" is one token depends on the space before it; models miscount its letters either way',
  before:
    'The T5.L2 quiz key said: "Intra-token blindness: "strawberry" is a single id — the model never sees the characters inside it".',
  after:
    'After a space, " strawberry" is one token in GPT-2, cl100k and o200k. With none it is three (cl100k str|aw|berry; GPT-2 and o200k st|raw|berry), five when quoted. Either way the model gets ids for multi-letter chunks, never letters.',
  why: 'The key stated a context-dependent fact as universal. A leading space is part of the token, so one word has several encodings. The mechanism holds for any of them: letters are not part of the model input.',
  source: {
    url: 'https://github.com/openai/tiktoken',
    title: 'OpenAI tiktoken 0.14 on gpt2, cl100k_base and o200k_base: " strawberry" is 1 token, "strawberry" is 3 (str|aw|berry on cl100k, st|raw|berry on gpt2 and o200k), inside quote marks it is 5 (checked 2026-10)',
  },
  items: [
    {
      q: 'In GPT-2, cl100k and o200k, how does a leading space change what a model receives for "strawberry"?',
      options: [
        'One id in any context, with the characters inside that single id hidden from the model',
        'One id with a leading space and three chunks without it, with no letters either way',
        'Three chunks in any context, with the characters inside each chunk visible to the model',
        'Three chunks with a leading space and one id without it, with no letters either way',
      ],
      correct: [1],
      why: [
        'That was the old key, and it holds only after a space. Bare "strawberry" splits into three pieces (str|aw|berry on cl100k, st|raw|berry on GPT-2 and o200k), so one id is not true in any context.',
        'Right: " strawberry" is one token and bare "strawberry" is three pieces in all three vocabularies. Either way the model gets ids for multi-letter chunks, so counting letters inside a chunk must be memorized or reasoned out.',
        'After a space the word is a single token, so three chunks is not true in any context. Even when it splits, the model gets an id per chunk, not the letters inside it.',
        'The direction is reversed: a leading space belongs to the token, so " strawberry" is one id while the bare word splits into three. The letters stay hidden in both cases.',
      ],
    },
  ],
} satisfies Erratum
