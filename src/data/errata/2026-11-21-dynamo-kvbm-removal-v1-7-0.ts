import type { Erratum } from './schema'

export default {
  id: '2026-11-21-dynamo-kvbm-removal-v1-7-0',
  date: '2026-11-21',
  kind: 'changed',
  lessons: ['t5.l10', 't6.l3'],
  title: 'Dynamo now targets KVBM removal for v1.7.0; v1.6.0 and v1.6.2 still ship it',
  before:
    'Dynamo v1.5.0 (2026-09-21) deprecated KVBM, removal targeted for v1.6.0.',
  after:
    'Dynamo v1.5.0 (2026-09-21) deprecated KVBM. Its notes now target removal for v1.7.0; they read v1.6.0 on 2026-10-06. v1.6.0 (2026-10-22) and v1.6.2 (2026-11-05) still ship it. Build on the engine\'s native KV offloading.',
  why: 'Release notes can change after a release, and a deprecation target is a plan, not a removal. Check the release you deploy before assuming a component is gone.',
  supersedes: '2026-10-04-dynamo-kvbm-deprecated',
  source: {
    url: 'https://github.com/ai-dynamo/dynamo/releases/tag/v1.5.0',
    title: 'NVIDIA Dynamo v1.5.0 release notes (KVBM is deprecated, removal targeted for v1.7.0)',
  },
  items: [
    {
      q: 'The Dynamo v1.5.0 notes deprecate KVBM and target its removal for v1.7.0. Dynamo v1.6.2 is out. What do you expect from v1.6.2?',
      options: [
        'KVBM is still shipped, so deprecation did not remove it',
        'KVBM is gone, because a deprecated component leaves in the next release',
        'KVBM is gone, because v1.6 was the removal target in the notes',
        'KVBM has moved into NIXL, which now owns block placement',
      ],
      correct: [0],
      why: [
        'Right: removal was targeted for v1.7.0, and v1.6.0 and v1.6.2 still ship KVBM. New work should still use the engine\'s native KV offloading.',
        'Deprecation does not say when removal happens. The notes now name v1.7.0, two feature releases after v1.5.0.',
        'The notes said v1.6.0 when this course first read them; they now say v1.7.0, and v1.6.0 and v1.6.2 both ship KVBM.',
        'NIXL moves bytes between memories and nodes. It does not own block placement, and KVBM was never moved into it.',
      ],
    },
  ],
} satisfies Erratum
