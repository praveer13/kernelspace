/**
 * Handoff between devices (docs/specs/wave-1.md §6.6), the file form: "Send to my other device" downloads
 * `kernelspace-delta-<date>.json`, an export v3 holding only what changed since the last handoff, and the other
 * device imports it with merge (existing preview and undo). The delta itself is the engine's
 * `exportV3({sinceAt})`; this module is the pure part around it: which instant to ask for, what the file is
 * called, what marker to write afterwards, and how many events are still waiting. QR handoff is Wave 2.
 */

import { stableStringify } from '@/lib/ledger/stable'
import type { ExportV3, IsoInstant, LedgerEvent } from '@/lib/ledger/types'

/** The working record `handoff:last`: when the last delta was made and how many events it held. */
export type HandoffMarker = { at: IsoInstant; events: number } // a type, not an interface: it is stored as JSON

/** The marker from a working record's value, or null when it is missing or malformed. */
export function parseHandoffMarker(value: unknown): HandoffMarker | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { at, events } = value as Record<string, unknown>
  if (typeof at !== 'string' || at.length !== 24 || Number.isNaN(Date.parse(at))) return null
  return { at, events: typeof events === 'number' && Number.isFinite(events) && events >= 0 ? Math.floor(events) : 0 }
}

/** `ExportOptions.sinceAt` for the next delta: the last handoff's instant, or undefined (everything) the first time. */
export const handoffSince = (last: HandoffMarker | null): IsoInstant | undefined => last?.at

/** `kernelspace-delta-2026-10-05.json`, from the export's `exportedAt`. */
export const deltaFileName = (exportedAt: IsoInstant): string => `kernelspace-delta-${exportedAt.slice(0, 10)}.json`

export interface DeltaFile {
  name: string
  /** Deterministic text (sorted keys), the same bytes `serializeExport` makes. */
  text: string
  /** What to write to `handoff:last` once the download is handed to the browser. */
  marker: HandoffMarker
}

/** The download for a delta export. */
export function deltaFile(file: ExportV3): DeltaFile {
  return {
    name: deltaFileName(file.exportedAt),
    text: stableStringify(file),
    marker: { at: file.exportedAt, events: file.events.length },
  }
}

export interface PendingOptions {
  last?: HandoffMarker | null
  /** The last full export (`LedgerStatus.lastExportAt`): a backup also holds those events, so they are not "waiting". */
  lastExportAt?: IsoInstant
  /** Count only events this device wrote; merged-in events came from the other device. */
  device?: string
}

/** Events newer than both the last handoff and the last export. With neither, every event counts. */
export function pendingHandoff(events: Iterable<LedgerEvent>, opts: PendingOptions = {}): number {
  const a = opts.last?.at ?? ''
  const b = opts.lastExportAt ?? ''
  const since = a > b ? a : b
  const seen = new Set<string>()
  for (const e of events) {
    if (e.at > since && (opts.device === undefined || e.dev === opts.device)) seen.add(e.id)
  }
  return seen.size
}

/** "12 events not yet handed off", or null when nothing is waiting. */
export function handoffLabel(pending: number): string | null {
  if (pending <= 0) return null
  return `${pending} ${pending === 1 ? 'event' : 'events'} not yet handed off`
}
