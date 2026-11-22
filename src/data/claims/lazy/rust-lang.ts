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
    value: 'as of Rust 1.100.0, Nov 2026',
    label: 'Polonius Alpha is not yet on stable Rust: the conditional-return borrow is still rejected',
    source: {
      url: 'https://blog.rust-lang.org/2026/08/04/enabling-polonius-alpha-on-nightly/',
      title: 'Enabling Polonius Alpha on nightly (Rust blog, 2026-08-04)',
      quote: 'Then, we are aiming to stabilize prior to the end of the year!',
      row: 'Polonius Alpha is enabled on nightly only; stable 1.100.0 (2026-11-12) release notes name no borrow-checker change',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 45,
    boundary:
      'Holds for stable Rust up to 1.100.0 (2026-11-12): the conditional return (r.l4 get_or_insert, r.l9 cached) is E0502 there, checked on rustc 1.96.0, and the 1.100.0 RELEASES.md does not mention Polonius. Polonius Alpha is on by default on nightly only. When it stabilises, this sentence turns false and so do the items resting on that limit: the r.l4 quiz question on the conditional return, the r.l9 cached example and the compile-bank items built on it (pinned to rustc 1.96.0, which keeps rejecting it). The r.l3, r.l4, r.l8 and r.l9 permission diagrams stay drawn with Aquascope on nightly-2026-05-01, which predates Polonius on nightly.',
  },
]

registerClaims(RUST_LANG_CLAIMS)
