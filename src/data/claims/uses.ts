/**
 * One place a claim is rendered (Wave 1 stage 0, task K3-1): the lesson, the block type and the field. The generated
 * `uses.generated.json` maps a claim id to its places; verify-claims, the freshness job (K3-6) and errata (K3-9) read it,
 * so a changed claim names the lessons it feeds without a scan.
 */
import uses from './uses.generated.json'

export interface ClaimUse {
  lesson: string
  block: string
  field: string
}

/** The places a claim is rendered, or an empty list. */
export const useByClaim = (id: string): ClaimUse[] => (uses as Record<string, ClaimUse[]>)[id] ?? []
