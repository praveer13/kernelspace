import { CHAT_TOKENS, fmt } from '@/lib/boot/model'
import type { BootModel } from '@/lib/boot/model'

export interface Option {
  text: string
  why: (m: BootModel) => string
}

/** The rounded wording the heading and the Catch step use ("about 120"); the exact derived count is 119. */
const chatsAbout = (m: BootModel): string => fmt.chats(m.kvTokens / CHAT_TOKENS)

/**
 * Step 5 options, in authored order. The right answer is index 1; what the learner sees is shuffled per
 * visit and the pick is stored by this index. Lengths are kept within 1.3x of each other and the key is
 * not the longest, so length gives nothing away (PLAN-100X item lint; tests/boot/whyBatching.test.ts).
 */
export const OPTIONS: Option[] = [
  {
    text: 'The GPU runs at a higher clock when more users are connected, so every user is served faster than before.',
    why: () => 'Clock speed does not depend on how many people are connected. The gain comes from sharing memory reads, not from running faster.',
  },
  {
    text: 'One pass over the weights now serves every user in the batch; each user still gets one token per step.',
    why: (m) =>
      `Right: a step still reads the weights once (plus every cache), and each user receives one token from it. With ${chatsAbout(m)} users that is ${fmt.tpsRound(m.aggregateTps)} in total, but each user gets about ${Math.round(m.perUserTps)} tok/s, below the ${fmt.tps(m.decodeTps)} of one user alone.`,
  },
  {
    text: 'Batching splits the weights between the users, so each user needs less memory bandwidth and runs faster.',
    why: () => 'The weights are not split. Every step reads all of them once; what the users share is that single read, not a slice of the weights.',
  },
  {
    text: 'Each user is served by their own private set of math units, so every user decodes many times faster.',
    why: () => 'There is one GPU, and the users share its units. Per-user speed actually falls as the batch grows, because each step now reads more bytes and takes longer.',
  },
]
export const CORRECT = 1
