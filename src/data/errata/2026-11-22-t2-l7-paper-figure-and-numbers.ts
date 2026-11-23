import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t2-l7-paper-figure-and-numbers',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t2.l7'],
  title: 'The PagedAttention exam reads the paper in its own numbering, and Figure 8 is the fork() diagram',
  before:
    'The lesson cited Figure 4 as the fork() diagram, called vLLM\'s throughput win "up to ~24x FasterTransformer and ~3.5x Orca", and numbered the paper\'s sections §1-2, §3 and §4 by its own count.',
  after:
    'Figure 4 is the vLLM system overview; copy-on-write is Figure 8. The paper reports up to 22x higher request rates than FasterTransformer; 24x and 3.5x are the 2023 launch post. Preemption is §4.5, the kernel cost §7.1.',
  why: 'A learner who opens the paper looked for fork() in the wrong figure and for sections that are not there. The 24x and 3.5x came from the launch post, whose baselines differ from the paper.',
  source: {
    url: 'https://arxiv.org/abs/2309.06180',
    title: 'Kwon et al., Efficient Memory Management for Large Language Model Serving with PagedAttention (SOSP 2023)',
  },
} satisfies Erratum
