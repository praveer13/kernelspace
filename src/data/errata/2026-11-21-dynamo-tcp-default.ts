import type { Erratum } from './schema'

export default {
  id: '2026-11-21-dynamo-tcp-default',
  date: '2026-11-21',
  kind: 'changed',
  lessons: ['t3.l6'],
  title: 'Dynamo carries requests over TCP by default; NATS is optional',
  before: 'The Dynamo case study named NATS as the message bus of the data plane, and its hook led with "NATS messaging".',
  after: "Dynamo's README (v1.6.2): it uses TCP for inter-component communication, etcd and NATS are not required on Kubernetes, and KV-aware routing does not require NATS.",
  why: 'Dynamo moved from NATS and etcd to a TCP request plane with Kubernetes-native discovery. A learner who sets up a Dynamo cluster should not expect to run a broker.',
  source: {
    url: 'https://raw.githubusercontent.com/ai-dynamo/dynamo/v1.6.2/README.md',
    title: 'NVIDIA Dynamo README at v1.6.2',
  },
  items: [
    {
      q: 'In a default Dynamo deployment on Kubernetes, how do its components talk to each other?',
      options: [
        'Over TCP, with Kubernetes-native discovery and no broker at all',
        'Through a NATS broker that every deployment must run alongside the workers',
        'Through an etcd cluster that carries every request between the workers',
        'Over RDMA verbs for every message, including the small control requests',
      ],
      correct: [0],
      why: [
        'Right: the README says Dynamo uses TCP for inter-component communication, and lists etcd and NATS as not required on Kubernetes.',
        'NATS is an optional backend for some event-backed modes. The default request path does not need a broker.',
        'etcd was an earlier discovery option; on Kubernetes the cluster resources handle discovery, so etcd is not required.',
        'RDMA moves the KV blocks through NIXL. The control and request messages ride TCP.',
      ],
    },
  ],
} satisfies Erratum
