import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t4-l5-workgroup-dispatch-limit-and-staged-race',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t4.l5'],
  title: 'One WebGPU dispatch dimension holds 65,535 workgroups, and the playground stages the barrier race',
  before: 'A 16M-float vector add was shown as one dispatch of 65,536 workgroups, and the playground was said to reproduce a missing-barrier race you can watch.',
  after:
    'The 65,536 workgroups must be launched in two dimensions (256 x 256), since the default limit is 65,535 per dimension. The playground counts barriers and stages a deterministic wrong sum; it does not run a race.',
  why: 'A one-dimensional dispatch of 65,536 fails validation on default limits. The playground never runs your shader for the barrier case, so it shows a symptom, not a race.',
  source: {
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedLimits',
    title: 'MDN GPUSupportedLimits: maxComputeWorkgroupsPerDimension 65535',
  },
} satisfies Erratum
