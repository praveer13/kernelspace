/**
 * KC ids that more than one Wave 1 task depends on (docs/specs/wave-1.md §4.2).
 *
 * This is a contract, fixed before parallel work: the generator families, the placement walk, the
 * sim-task registry, the block-placement play and the lab 01 check tags all name these ids, while
 * task B2 authors the full graph in src/data/kc/*. B2 must define every id below (verify-kc fails
 * otherwise) and may add others freely. Renaming one later needs a KcMigration row.
 */

export const KC = {
  /* ---- threshold KCs: the placement walk probes these, Today serves them first ---- */
  locality: 't0.locality',
  externalFrag: 't1.external-frag',
  addressTranslation: 't2.address-translation',
  admissionScheduling: 't2.admission-scheduling',
  boundClassification: 't4.bound-classification',
  kvBytesPerToken: 't5.kv-bytes-per-token',

  /* ---- the Rust-reading anchor ---- */
  borrowRules: 'r.borrow-rules',

  /* ---- frag family, AllocatorSim tasks, the block-placement play, lab 01 ---- */
  internalFrag: 't1.internal-frag',
  fixedBlocks: 't1.fixed-blocks',
  allocatorContract: 't1.allocator-contract',
  splitCoalesce: 't1.split-coalesce',
  placementPolicy: 't1.placement-policy',
  alignment: 't1.alignment',

  /* ---- roofline family, RooflineSim tasks, Boot ---- */
  ridgePoint: 't4.ridge-point',
  decodeBandwidth: 't4.decode-bandwidth',
  tilingIntensity: 't4.tiling-intensity',

  /* ---- kv family, KvCacheSim tasks, Boot ---- */
  kvCapacity: 't5.kv-capacity',
  gqaKvHeads: 't5.gqa-kv-heads',
  batchingThroughput: 't5.batching-throughput',

  /* ---- R KCs that lab 01's readiness (R1-R5) and the braid rely on ---- */
  ownershipMoves: 'r.ownership-moves',
  enumsOptionResult: 'r.enums-option-result',
} as const

export type ContractKcId = (typeof KC)[keyof typeof KC]

/** The six threshold KCs, in placement order (curriculum order of their introducing lessons). */
export const THRESHOLD_KCS = [
  KC.locality,
  KC.externalFrag,
  KC.addressTranslation,
  KC.admissionScheduling,
  KC.boundClassification,
  KC.kvBytesPerToken,
] as const

/** Placement's seventh probe: read Rust (predict moves and borrow errors). */
export const RUST_ANCHOR_KC = KC.borrowRules
