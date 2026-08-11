import type { RequestSpec } from './fleet-model'

export type TraceKind = 'recorded' | 'synthetic-profile' | 'local-derived'

export interface TraceRequest {
  t: number
  p: number
  o: number
}

/** Versioned, provenance-carrying replay artifact in public/traces. */
export interface TraceArtifact {
  schemaVersion: 1
  id: string
  name: string
  kind: TraceKind
  source: string
  sourceRevision: string
  sourceSha256?: string
  license: string
  attribution: string
  note: string
  sampling: Record<string, unknown>
  requestCount: number
  requestSha256: string
  requests: TraceRequest[]
}

export type FleetTrafficId = 'synthetic' | 'kimi' | 'burstgpt' | 'lmsys-shape'

export interface FleetTrafficProfile {
  id: FleetTrafficId
  label: string
  shortLabel: string
  kind: 'synthetic' | TraceKind
  artifactUrl?: string
  description: string
  config: {
    numBlocks: number
    blockSize: number
    maxRunning: number
    sloTtft: number
    prefillChunk: number
  }
  intakeCap: number
  drainPerTick: number
}

export const FLEET_TRAFFIC_PROFILES: readonly FleetTrafficProfile[] = [
  {
    id: 'synthetic',
    label: 'Kernelspace synthetic baseline',
    shortLabel: 'synthetic',
    kind: 'synthetic',
    description: '240 fixed-seed requests over 900 ticks.',
    config: { numBlocks: 256, blockSize: 16, maxRunning: 16, sloTtft: 40, prefillChunk: 128 },
    intakeCap: 32,
    drainPerTick: 8,
  },
  {
    id: 'kimi',
    label: 'Kimi conversation production',
    shortLabel: 'kimi-prod',
    kind: 'recorded',
    artifactUrl: '/traces/kimi-conversation.json',
    description: 'Mooncake FAST\'25, first ten minutes; Apache-2.0.',
    config: { numBlocks: 2048, blockSize: 16, maxRunning: 64, sloTtft: 40, prefillChunk: 128 },
    intakeCap: 48,
    drainPerTick: 16,
  },
  {
    id: 'burstgpt',
    label: 'BurstGPT production burst',
    shortLabel: 'burstgpt',
    kind: 'recorded',
    artifactUrl: '/traces/burstgpt-v2-busiest-hour.json',
    description: 'BurstGPT v2.0 busiest aligned hour; CC-BY-4.0.',
    config: { numBlocks: 256, blockSize: 16, maxRunning: 8, sloTtft: 40, prefillChunk: 128 },
    intakeCap: 32,
    drainPerTick: 8,
  },
  {
    id: 'lmsys-shape',
    label: 'LMSYS published aggregate shape',
    shortLabel: 'lmsys-shape',
    kind: 'synthetic-profile',
    artifactUrl: '/traces/lmsys-chat-1m-published-shape.json',
    description: 'Published token means only; synthetic timing; no LMSYS rows.',
    config: { numBlocks: 2048, blockSize: 16, maxRunning: 64, sloTtft: 120, prefillChunk: 128 },
    intakeCap: 64,
    drainPerTick: 16,
  },
]

export function getFleetTrafficProfile(id: FleetTrafficId): FleetTrafficProfile {
  const profile = FLEET_TRAFFIC_PROFILES.find((item) => item.id === id)
  if (!profile) throw new Error(`unknown Fleet traffic profile: ${id}`)
  return profile
}

const textEncoder = new TextEncoder()

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`trace ${key} must be a non-empty string`)
  return value
}

/** Validate provenance, row bounds, ordering, count, and replay checksum. */
export async function parseTraceArtifact(value: unknown): Promise<TraceArtifact> {
  if (!isPlainObject(value)) throw new Error('trace root must be an object')
  if (value.schemaVersion !== 1) throw new Error(`unsupported trace schemaVersion: ${String(value.schemaVersion)}`)

  const kind = value.kind
  if (kind !== 'recorded' && kind !== 'synthetic-profile' && kind !== 'local-derived') {
    throw new Error(`unsupported trace kind: ${String(kind)}`)
  }
  if (!isPlainObject(value.sampling)) throw new Error('trace sampling must be an object')
  if (!Array.isArray(value.requests) || value.requests.length === 0 || value.requests.length > 50_000) {
    throw new Error('trace requests must contain 1..50,000 rows')
  }

  let previousTick = -1
  const requests: TraceRequest[] = value.requests.map((row, index) => {
    if (!isPlainObject(row)) throw new Error(`trace request ${index} must be an object`)
    const t = row.t
    const p = row.p
    const o = row.o
    if (!Number.isInteger(t) || (t as number) < 0 || (t as number) > 10_000_000) {
      throw new Error(`trace request ${index} has invalid arrival tick`)
    }
    if (!Number.isInteger(p) || (p as number) < 1 || (p as number) > 1_000_000) {
      throw new Error(`trace request ${index} has invalid prompt tokens`)
    }
    if (!Number.isInteger(o) || (o as number) < 1 || (o as number) > 1_000_000) {
      throw new Error(`trace request ${index} has invalid output tokens`)
    }
    if ((t as number) < previousTick) throw new Error(`trace requests are not arrival-sorted at row ${index}`)
    previousTick = t as number
    return { t: t as number, p: p as number, o: o as number }
  })

  if (!Number.isInteger(value.requestCount) || value.requestCount !== requests.length) {
    throw new Error(`trace requestCount ${String(value.requestCount)} does not match ${requests.length} rows`)
  }
  const requestSha256 = requiredString(value, 'requestSha256').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(requestSha256)) throw new Error('trace requestSha256 must be 64 lowercase hex characters')
  const actual = await sha256Hex(JSON.stringify(requests))
  if (actual !== requestSha256) throw new Error(`trace request checksum mismatch: got ${actual}`)

  const sourceSha256 = value.sourceSha256
  if (sourceSha256 !== undefined && (typeof sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sourceSha256))) {
    throw new Error('trace sourceSha256 must be 64 lowercase hex characters when present')
  }

  return {
    schemaVersion: 1,
    id: requiredString(value, 'id'),
    name: requiredString(value, 'name'),
    kind,
    source: requiredString(value, 'source'),
    sourceRevision: requiredString(value, 'sourceRevision'),
    ...(sourceSha256 ? { sourceSha256 } : {}),
    license: requiredString(value, 'license'),
    attribution: requiredString(value, 'attribution'),
    note: requiredString(value, 'note'),
    sampling: value.sampling,
    requestCount: requests.length,
    requestSha256,
    requests,
  }
}

export function traceToRequestStream(artifact: TraceArtifact): RequestSpec[] {
  return artifact.requests.map((row, index) => ({
    id: index + 1,
    arrival: row.t,
    prompt: row.p,
    output: row.o,
  }))
}

export async function loadTraceArtifact(url: string): Promise<TraceArtifact> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`trace fetch failed: ${response.status}`)
  return parseTraceArtifact(await response.json())
}

/** Load, validate, checksum, and adapt a trace artifact to the Fleet stream. */
export async function loadTraceStream(url: string): Promise<RequestSpec[]> {
  return traceToRequestStream(await loadTraceArtifact(url))
}
