/**
 * Hardware atlas (PLAN-100X §5.2 S2): one row per chip, every number derived from the claims
 * registry so a spec lives in one place. Consumers: RooflineSim, KvCacheSim, Fleet Week Act III.
 * Units match the sims: GB, GB/s and GFLOP/s. A field is absent when no claim backs it.
 */
import { claimNumber } from './claims'

export interface HardwareRow {
  id: string
  name: string
  hbmGb?: number
  hbmBwGBs?: number
  bf16DenseGflops?: number
  /** Claim ids behind each field, for ClaimValue popovers. */
  claims: { hbmGb?: string; hbmBwGBs?: string; bf16DenseGflops?: string }
}

export const ATLAS: HardwareRow[] = [
  {
    id: 'h100',
    name: 'H100',
    hbmGb: claimNumber('hw.h100-sxm.hbm-capacity'),
    hbmBwGBs: claimNumber('hw.h100-sxm.hbm-bw', 1000),
    bf16DenseGflops: claimNumber('hw.h100-sxm.bf16-dense', 1000),
    claims: {
      hbmGb: 'hw.h100-sxm.hbm-capacity',
      hbmBwGBs: 'hw.h100-sxm.hbm-bw',
      bf16DenseGflops: 'hw.h100-sxm.bf16-dense',
    },
  },
  {
    id: 'b200',
    name: 'B200',
    hbmGb: claimNumber('hw.b200.hbm-capacity'),
    hbmBwGBs: claimNumber('hw.b200.hbm-bw', 1000),
    bf16DenseGflops: claimNumber('hw.b200.bf16-dense', 1000),
    claims: {
      hbmGb: 'hw.b200.hbm-capacity',
      hbmBwGBs: 'hw.b200.hbm-bw',
      bf16DenseGflops: 'hw.b200.bf16-dense',
    },
  },
  {
    // The evidence base has a per-GPU bandwidth but no dense BF16 figure or per-GPU capacity.
    id: 'b300',
    name: 'B300',
    hbmBwGBs: claimNumber('hw.b300.hbm-bw', 1000),
    claims: { hbmBwGBs: 'hw.b300.hbm-bw' },
  },
  {
    id: 'tpu7x',
    name: 'TPU7x',
    hbmBwGBs: claimNumber('hw.tpu7x.hbm-bw'),
    bf16DenseGflops: claimNumber('hw.tpu7x.bf16', 1000),
    claims: { hbmBwGBs: 'hw.tpu7x.hbm-bw', bf16DenseGflops: 'hw.tpu7x.bf16' },
  },
]

export function atlasRow(id: string): HardwareRow {
  const row = ATLAS.find((r) => r.id === id)
  if (!row) throw new Error(`unknown atlas row: ${id}`)
  return row
}
