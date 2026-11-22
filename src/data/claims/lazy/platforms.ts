import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * Wave 0 lazy group: the platform status claims (t3 lane: Dynamo transport, Chromium, Android and WASI). Empty until the lane that owns it adds its claims here, under the ids its
 * line in `LAZY_GROUP_HOMES` (`homes.ts`) names. The group is registered once by K0-D0, so no two lanes edit `all.ts`
 * or `homes.ts`. A lane adds claims only to this file.
 */
export const PLATFORMS_CLAIMS: Claim[] = [
  {
    id: 'status.dynamo.transport',
    kind: 'status',
    value: 'TCP',
    label: 'Dynamo default transport',
    source: {
      url: 'https://raw.githubusercontent.com/ai-dynamo/dynamo/v1.6.2/README.md',
      title: 'NVIDIA Dynamo README at v1.6.2',
      quote: 'Dynamo uses TCP for inter-component communication.',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 60,
    boundary:
      'README at v1.6.2: etcd and NATS are "Not required" for local development and Kubernetes ("K8s-native discovery; TCP request plane"), and "KV-aware routing does not require NATS". NATS JetStream-backed modes exist as an opt-in. The README does not name the event plane default, so the course does not either.',
    pin: { repo: 'ai-dynamo/dynamo', ref: 'v1.6.2' },
  },
  {
    id: 'status.chromium.memory-safety-share',
    kind: 'status',
    value: 70,
    unit: '%',
    label: 'Chromium memory-unsafe share',
    source: {
      url: 'https://www.chromium.org/Home/chromium-security/memory-safety/',
      title: 'Chromium Security: Memory safety',
      quote: 'Around 70% of our high severity security bugs are memory unsafety problems (that is, mistakes with C/ C++ pointers).',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 60,
    boundary:
      'Chromium only: "Analysis based on 912 high or critical severity security bugs since 2015, affecting the Stable channel." It is not a share of all C/C++ CVEs. Microsoft\'s similar figure was not re-read, so the course does not attribute this one to Microsoft.',
  },
  {
    id: 'status.android.memory-safety-share',
    kind: 'status',
    value: 'below 20',
    unit: '%',
    label: 'Android memory-safety share',
    source: {
      url: 'https://blog.google/security/rust-in-android-move-fast-fix-things/',
      title: 'Google Security Blog: Rust in Android, move fast and fix things (2025-11-13)',
      quote: 'memory safety vulnerabilities falling below 20% of total vulnerabilities for the first time',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 60,
    boundary:
      'Google says the data covers first-party and third-party code changes to the Android platform across C, C++, Java, Kotlin and Rust, published before the end of 2025, with the 90-day patch window leaving results very likely close to final. It is the platform total, not a measurement of Rust alone.',
  },
]

registerClaims(PLATFORMS_CLAIMS)
