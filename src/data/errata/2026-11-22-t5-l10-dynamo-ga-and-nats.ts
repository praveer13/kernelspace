import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t5-l10-dynamo-ga-and-nats',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t5.l10'],
  title: 'Dynamo did not "go GA (v1.3)", and NATS and etcd are not required',
  before:
    'The Dynamo paragraph said it "went GA (v1.3)", and the trade-offs said Dynamo comes "with NATS, etcd, and transfer fabric of its own". The KVBM removal target was also given wrongly; an earlier correction fixes that.',
  after:
    'The v1.0.0 notes (2026-03-13) call it "the first major release"; v1.3.0 says nothing of GA. The README at v1.6.2 says Dynamo uses TCP between components and lists etcd and NATS as not required on Kubernetes.',
  why: 'Say what the release notes say, not a milestone they never name. A learner sizing a Dynamo cluster should not budget a broker or a key-value store that the default deployment does not run.',
  source: {
    url: 'https://github.com/ai-dynamo/dynamo/releases/tag/v1.0.0',
    title: 'NVIDIA Dynamo v1.0.0 release notes',
  },
} satisfies Erratum
