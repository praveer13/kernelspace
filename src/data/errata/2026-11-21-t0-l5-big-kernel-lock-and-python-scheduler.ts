import type { Erratum } from './schema'

export default {
  id: '2026-11-21-t0-l5-big-kernel-lock-and-python-scheduler',
  date: '2026-11-21',
  kind: 'error',
  lessons: ['t0.l5'],
  title: 'No T2 lesson teaches the big kernel lock, and vLLM schedules each step in Python',
  before: 'The GIL lesson sent you to T2 for the big kernel lock trade-off, and said serving stacks keep the hot data plane out of Python entirely.',
  after:
    'The big kernel lock is taught in the first lesson of the tier. vLLM v0.34.0 runs its per-step Scheduler.schedule in Python; the GPU kernels and byte-moving paths are C++, CUDA or Rust.',
  why: 'The pointer led nowhere, and "out of Python entirely" is false for vLLM, whose scheduling loop is Python. What leaves Python is the kernels and the data movement.',
  source: {
    url: 'https://raw.githubusercontent.com/vllm-project/vllm/v0.34.0/vllm/v1/core/sched/scheduler.py',
    title: 'vLLM v0.34.0 source: vllm/v1/core/sched/scheduler.py (class Scheduler, def schedule)',
  },
} satisfies Erratum
