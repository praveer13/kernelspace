/**
 * KC ids that more than one Wave 1 task depends on (docs/specs/wave-1.md §4.2).
 *
 * This is a contract, fixed before parallel work: the generator families, the placement walk, the
 * sim-task registry, the block-placement play and the lab 01 check tags all name these ids, while
 * task B2 authors the full graph in src/data/kc/*. B2 must define every id below (verify-kc fails
 * otherwise) and may add others freely. Renaming one later needs a KcMigration row.
 *
 * Wave 2 adds the 31 ids that the other PRs tag (docs/specs/wave-2.md §4.2, task 2a-06): the families
 * goodput, cost, memory, spec, sig and compile, the labs 02-03 checks, the scheduler play, the attention
 * zoo and the fault catalogue. 2a-11 may add KCs but never renames these.
 * Wave 3 adds `rasterL2Reuse` (docs/specs/wave-3.md §4.3, task 3a-09), then the cube's three other level KCs (3b-01) and the EPLB play's two (3b-02).
 * Stretch adds `attentionFfnSplit`, t6.l12's KC (wave-3.md §16.2, task 3s-03).
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

  /* ---- Wave 3 (§4.3): the tiling cube's raster level ---- */
  rasterL2Reuse: 't4.raster-l2-reuse',
  /* ---- Wave 3 (3b-01): the cube's other levels, named here so the play's KCs are all in the contract (verify-plays reads it) ---- */
  sharedMemoryScratchpad: 't4.shared-memory-scratchpad',
  occupancy: 't4.occupancy',
  flashAttentionBlocking: 't4.flashattention-blocking',
  /* ---- Wave 3 (3b-02): the EPLB play's KCs, named here so verify-plays finds them in the contract ---- */
  expertLoadBalance: 't6.expert-load-balance',
  allToAll: 't6.all-to-all',
  /* ---- Wave 3 stretch (3s-03): t6.l12, attention-FFN disaggregation ---- */
  attentionFfnSplit: 't6.attention-ffn-split',

  /* ---- kv family, KvCacheSim tasks, Boot ---- */
  kvCapacity: 't5.kv-capacity',
  gqaKvHeads: 't5.gqa-kv-heads',
  batchingThroughput: 't5.batching-throughput',

  /* ---- R KCs that lab 01's readiness (R1-R5) and the braid rely on ---- */
  ownershipMoves: 'r.ownership-moves',
  enumsOptionResult: 'r.enums-option-result',

  /* ---- Wave 2 (§4.2): R pairing edges, compile bank and F4 ---- */
  permissions: 'r.permissions',
  analyzerLimits: 'r.analyzer-limits',
  unsafeBoundaries: 't3.unsafe-boundaries',

  /* ---- Wave 2: memory family (T4, T6) ---- */
  quantizedBytes: 't4.quantized-bytes',
  moeActiveParams: 't6.moe-active-params',
  parallelMemory: 't6.parallel-memory',
  fp4Capacity: 't6.fp4-capacity',
  loraAdapterBytes: 't6.lora-adapter-bytes',

  /* ---- Wave 2: labs 02 (kv-block-manager) and 03 (bpe-tokenizer) checks ---- */
  tokenizerBytes: 't5.tokenizer-bytes',
  bpeMerges: 't5.bpe-merges',
  blockTables: 't5.block-tables',
  blockRefcounts: 't5.block-refcounts',
  kvCopyOnWrite: 't5.kv-copy-on-write',

  /* ---- Wave 2: attention zoo, prefix router, scheduler play, faults, spec family ---- */
  attentionVariants: 't5.attention-variants',
  kvReadsVsCapacity: 't5.kv-reads-vs-capacity',
  prefixRouting: 't5.prefix-routing',
  continuousBatching: 't5.continuous-batching',
  admissionHeadroom: 't5.admission-headroom',
  schedOrder: 't5.sched-order',
  prefillDecodeInterference: 't5.prefill-decode-interference',
  speculativeDecoding: 't5.speculative-decoding',
  specAcceptance: 't6.spec-acceptance',

  /* ---- Wave 2: cost family ---- */
  epEconomics: 't6.ep-economics',
  agentPrefixLocality: 't6.agent-prefix-locality',
  costPerMtok: 't7.cost-per-mtok',

  /* ---- Wave 2: goodput family, Daily burn, signature items ---- */
  sloErrorBudget: 't7.slo-error-budget',
  goodput: 't7.goodput',
  goodputCurve: 't7.goodput-curve',
  paretoFrontier: 't7.pareto-frontier',
  capacityPlanning: 't7.capacity-planning',
  incidentDiagnosis: 't7.incident-diagnosis',
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
