import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t7-l5-planner-targets-ttft-itl',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t7.l5'],
  title: 'Dynamo\'s Planner targets TTFT and ITL SLAs and also scales on queue and KV signals',
  before:
    'T7.L5 said the Planner "scales on queue depth and age rather than TTFT", and the queue-shed-degrade order was presented as the Planner\'s own behavior.',
  after:
    'Dynamo\'s Planner can target TTFT and ITL SLAs; its load mode uses queue-depth and KV-utilization thresholds. Queue, then shed, then degrade is this course\'s design ladder, not a policy the Dynamo docs prescribe.',
  why: 'Queue signals lead measured TTFT, which is why a planner acts on them, but that is not a choice between queue and TTFT. The shed-and-degrade ladder is a recommendation, so it is no longer attributed to Dynamo.',
  source: {
    url: 'https://docs.nvidia.com/dynamo/latest/planner/planner_intro.html',
    title: 'NVIDIA Dynamo docs: Planner (SLA targets on TTFT and ITL; queue-depth and KV-utilization thresholds)',
  },
  items: [
    {
      q: 'Which statement about how Dynamo\'s Planner chooses its scaling signals is accurate?',
      options: [
        'It ignores TTFT and ITL and scales on queue depth, leaving the load balancer to enforce latency targets',
        'It scales on measured TTFT and adds workers after the SLO is breached, since engines expose no queue metrics',
        'It targets TTFT and ITL SLAs, and its load mode scales on queue depth and KV utilization ahead of latency',
        'It ships a built-in overload policy of queueing, shedding and degrading, with no TTFT or ITL targets',
      ],
      correct: [2],
      why: [
        'The docs describe SLA targets on TTFT and ITL, so latency targets are central to the Planner rather than left to a load balancer. Queue depth is one input, not the only one.',
        'Measured TTFT lags the queue by the queueing time, and the Planner reads queued-request status and KV utilization from engines. Waiting for a breach would add workers too late.',
        'Right: it can target TTFT and ITL SLAs, and the load mode uses queue-depth and KV-utilization thresholds. Those signals move before measured TTFT does, so capacity can arrive earlier.',
        'The Planner docs do not describe load shedding or output degradation. Queue, shed, then degrade is a design ladder to decide in advance, not a documented Dynamo setting.',
      ],
    },
  ],
} satisfies Erratum
