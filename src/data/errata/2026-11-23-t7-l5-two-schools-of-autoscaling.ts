import type { Erratum } from './schema'

export default {
  id: '2026-11-23-t7-l5-two-schools-of-autoscaling',
  date: '2026-11-23',
  kind: 'changed',
  lessons: ['t7.l5'],
  title: 'T7.L5 sets two schools of autoscaling side by side, and ModelExpress copies over RDMA',
  before:
    'T7.L5 set the Planner against "HPA on a custom metric", called ModelExpress a Rust loader, and named weight-sharing an "NVLink copy over network pull".',
  after:
    'Dynamo scales with a Planner; llm-d scales each role through KEDA and the HPA it manages. ModelExpress copies weights from a serving peer over NIXL RDMA; its engine loaders are a Python package and its client CLI is Rust.',
  why: 'llm-d runs KEDA reading vLLM metrics, one ScaledObject per role, so HPA is a real stack, not a straw man. The ModelExpress README names the mechanism, a peer-to-peer RDMA copy, and its Python package of engine loaders.',
  source: {
    url: 'https://github.com/ai-dynamo/modelexpress/blob/v0.8.0/README.md',
    title: 'ModelExpress v0.8.0 README (P2P RDMA weight transfer; a Python package of engine loaders and a Rust client CLI)',
  },
} satisfies Erratum
