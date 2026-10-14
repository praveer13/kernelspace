/**
 * What a practice band is (docs/specs/wave-3.md §4.2). `src/lib/world/bands/<playId>.ts` exports
 * `band(read)`; verify-plays discovers the modules by readdir and passes the loader, so nothing in this folder
 * touches the file system: a band that needs a trace file asks `read` for it by its path from the repo root.
 */

/** Reads one file of the repo by its path from the repo root (for example `public/traces/…json`). */
export type BandRead = (repoPath: string) => Promise<string>

/** Whether the play's practice trace is in band, and the line that says why. */
export interface BandResult {
  ok: boolean
  detail: string
}
