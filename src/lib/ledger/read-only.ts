/**
 * What a read-only tab tells the learner, in plain words: one note per guard reason (spec §8.7, §9.3).
 * The banner under the navbar and the /progress note share these, so they never disagree about why the
 * tab stopped saving. Each note ends with what to do. Plain strings only, so either can load without the other.
 */

import type { ReadOnlyReason } from './types'

export const READ_ONLY_REASONS: Record<ReadOnlyReason, string> = {
  'newer-schema': 'A newer version of kernelspace is using your data in another tab, so this tab is read-only. Reload to update.',
  'snapshot-newer': 'A newer version of kernelspace has saved to this browser, so this tab is read-only. Reload to update.',
  'newer-idb': "This browser's database was upgraded by a newer version of kernelspace, so this tab is read-only. Reload to update.",
  versionchange: 'Another tab upgraded the database, so this tab is read-only. Reload to keep saving.',
}

/** The note for a ledger status. A status that names no reason is read as the commonest one, a newer bundle in another tab. */
export const readOnlyNote = (reason: ReadOnlyReason | undefined): string => READ_ONLY_REASONS[reason ?? 'newer-schema']
