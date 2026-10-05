import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t5-l2-strawberry-is-not-one-token',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t5.l2'],
  title: 'Models miscount letters because they see token ids, not because "strawberry" is one token',
  before:
    'The T5.L2 quiz key said the strawberry problem follows from "strawberry" being a single token id, so the model never sees its letters.',
  after:
    'Common GPT-style and Llama BPE vocabularies split "strawberry" into several multi-letter pieces. The cause is the same: the model receives ids for chunks, and the letters inside a chunk are never visible to it.',
  why: 'A wrong example invites a learner to check one tokenizer and doubt the whole lesson. The mechanism holds for any split: letters are not part of the model input.',
  source: {
    url: 'https://github.com/openai/tiktoken',
    title: 'OpenAI tiktoken, run on "strawberry" with no leading space: cl100k_base gives str|aw|berry, o200k_base and gpt2 give st|raw|berry (checked 2026-10)',
  },
  items: [
    {
      q: 'A model counts the r letters in "strawberry" wrongly. Which statement about its input is correct?',
      options: [
        'It receives the word as individual letters, but attention spreads weight over them too evenly to count each one',
        'It receives ids for multi-letter chunks, so no letter-level view of the word is part of its input',
        'It receives the whole word as one token id, which is why it cannot see any letters inside it at all',
        'It receives the letters as bytes, but BF16 rounding blurs which letter is which',
      ],
      correct: [1],
      why: [
        'Letters are not the input unit. A byte-pair tokenizer merges them into chunks before the model sees anything.',
        'Right: the input is a sequence of ids for multi-letter pieces, and counting letters inside a piece must be memorized or reasoned out.',
        'Common tokenizers split this word into several pieces. A single id is not needed for the failure: any multi-letter chunk hides its letters.',
        'Bytes are merged into tokens before embedding, and BF16 precision does not decide letter identity. The model never gets per-letter inputs here.',
      ],
    },
  ],
} satisfies Erratum
