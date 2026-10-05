/**
 * giscus ids for the click-to-load discussion (Wave 1, docs/specs/wave-1.md §14.3, owner answer O2).
 * Lessons map to Announcements (only maintainers and giscus open threads); labs map to Q&A (answerable).
 * The ids come from giscus.app and survive a rename of the categories in the GitHub UI. An empty id hides the button.
 */

export const GISCUS_REPO = 'praveer13/kernelspace'
export const GISCUS_REPO_ID = 'R_kgDOTc8vQw'

export type DiscussionKind = 'lesson' | 'lab'

export const GISCUS_CATEGORY: Record<DiscussionKind, { name: string; id: string }> = {
  lesson: { name: 'Announcements', id: 'DIC_kwDOTc8vQ84DHETD' },
  lab: { name: 'Q&A', id: 'DIC_kwDOTc8vQ84DHETF' },
}

export const GISCUS_SRC = 'https://giscus.app/client.js'

/** The "always load on this device" preference; per device, never in the ledger. */
export const GISCUS_PREF_KEY = 'ks:giscus'

/** The `data-*` attributes of the giscus script for one thread, or null when the ids are empty. */
export function giscusAttributes(
  kind: DiscussionKind,
  id: string,
  ids: { repo: string; repoId: string; categories: typeof GISCUS_CATEGORY } = {
    repo: GISCUS_REPO,
    repoId: GISCUS_REPO_ID,
    categories: GISCUS_CATEGORY,
  },
): Record<string, string> | null {
  const category = ids.categories[kind]
  if (!ids.repo || !ids.repoId || !category.id || !id) return null
  return {
    'data-repo': ids.repo,
    'data-repo-id': ids.repoId,
    'data-category': category.name,
    'data-category-id': category.id,
    'data-mapping': 'specific',
    'data-term': `${kind}:${id}`,
    'data-strict': '1',
    'data-reactions-enabled': '0',
    'data-emit-metadata': '0',
    'data-input-position': 'top',
    // The app is dark only (`<html class="dark">`).
    'data-theme': 'dark',
    'data-lang': 'en',
    'data-loading': 'lazy',
  }
}

/** Reads the preference; false where localStorage throws or is blocked. */
export function readAlwaysLoad(): boolean {
  try {
    return globalThis.localStorage?.getItem(GISCUS_PREF_KEY) === '1'
  } catch {
    return false
  }
}

export function writeAlwaysLoad(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.setItem(GISCUS_PREF_KEY, '1')
    else globalThis.localStorage?.removeItem(GISCUS_PREF_KEY)
  } catch {
    // blocked storage: the preference lasts until the page closes
  }
}
