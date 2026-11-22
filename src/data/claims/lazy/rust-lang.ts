import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * Wave 0 lazy group: the Rust language status claims (rust lane). Claims are added only to this file, under the ids its
 * line in `LAZY_GROUP_HOMES` (`homes.ts`) names. The group is registered once by K0-D0, so no two lanes edit `all.ts`
 * or `homes.ts`.
 */
export const RUST_LANG_CLAIMS: Claim[] = [
  {
    id: 'status.rust.polonius',
    kind: 'status',
    value: 'no stable release through Rust 1.100.0, Nov 2026, ships Polonius',
    label: 'Polonius is not on stable Rust: the conditional-return borrow is still rejected',
    source: {
      url: 'https://raw.githubusercontent.com/rust-lang/rust/1.100.0/RELEASES.md',
      title: 'Rust RELEASES.md at tag 1.100.0',
      quote: 'Version 1.100.0 (2026-11-12)',
      row: 'Line 1 heads the 1.100.0 notes; no line of the file, for any release, mentions Polonius',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 45,
    boundary:
      'Stable Rust up to 1.100.0 (2026-11-12): RELEASES.md at that tag never mentions Polonius. Polonius Alpha is on nightly only; the Rust blog (https://blog.rust-lang.org/2026/08/04/enabling-polonius-alpha-on-nightly/, 2026-08-04) says "Then, we are aiming to stabilize prior to the end of the year!", hence the short TTL. The conditional return (r.l4 get_or_insert, r.l9 cached) was compiled with E0502 on rustc 1.96.0 and compiles with -Zpolonius=next on nightly-2026-05-01; it was not compiled on 1.100.0. When Polonius stabilises, this sentence turns false and so do the items resting on that limit: the r.l4 quiz question on the conditional return, the r.l9 cached example and the compile-bank items built on it (pinned to rustc 1.96.0, which keeps rejecting it). The r.l3, r.l4, r.l8 and r.l9 permission diagrams stay drawn with Aquascope on nightly-2026-05-01, which predates Polonius on nightly.',
  },
]

registerClaims(RUST_LANG_CLAIMS)
