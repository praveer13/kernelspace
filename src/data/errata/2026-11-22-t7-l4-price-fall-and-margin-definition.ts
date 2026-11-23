import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t7-l4-price-fall-and-margin-definition',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t7.l4'],
  title: 'No source gives an 80% API price fall; DeepSeek\'s 545% is profit over cost, and the cache hit paid about a quarter of input revenue',
  before: 'API prices fell ~80% in a year because competition found the same arithmetic; DeepSeek\'s 545% was a "margin"; its 56.3% hit rate paid for more than half the input margin.',
  after: 'Epoch AI measures the price of a fixed capability falling 9x to 900x a year; no source gives 80%. 545% is DeepSeek\'s cost profit margin (profit over cost; 84.5% gross). Cache hits were about 25% of input revenue.',
  why: 'A fall in the price of a capability is not a fall in a model\'s list price: DeepSeek\'s flagship lists a higher peak output price than R1. Profit over cost and gross margin are different ratios.',
  source: {
    url: 'https://epoch.ai/data-insights/llm-inference-price-trends',
    title: 'Epoch AI: LLM inference prices have fallen rapidly but unequally across tasks (12 March 2025)',
  },
} satisfies Erratum
