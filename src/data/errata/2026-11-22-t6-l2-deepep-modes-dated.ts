import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t6-l2-deepep-modes-dated',
  date: '2026-11-22',
  kind: 'changed',
  lessons: ['t6.l2'],
  title: 'DeepEP no longer has two modes: V2 unified its API, V2.5 removed V1',
  before: 'The lesson said DeepEP ships two dispatch modes, normal and low-latency, and described write-with-immediate delivery and pre-registered buffers for decode.',
  after: 'The two kernel sets describe DeepEP V1. V2 unified the APIs into one EPBuffer and V2.5 removed V1. The write-with-immediate detail is in no README we read, so it is cut.',
  why: 'The bandwidth-versus-latency trade still holds, but a learner installing DeepEP today finds one interface, not two protocols, and no source for the registered-buffer detail.',
  source: {
    url: 'https://github.com/deepseek-ai/DeepEP/blob/f6aa38fe06cd4a0489e7730365d4e0114970a2f3/README.md',
    title: 'DeepEP README (News and New features)',
  },
} satisfies Erratum
