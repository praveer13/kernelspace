import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReadOnlyBanner from '../../src/components/ledger/ReadOnlyBanner'
import { READ_ONLY_REASONS, readOnlyNote } from '../../src/lib/ledger/read-only'
import type { ReadOnlyReason } from '../../src/lib/ledger/types'

const REASONS: ReadOnlyReason[] = ['newer-schema', 'snapshot-newer', 'newer-idb', 'versionchange']

/** The banner as a learner reads it: tags stripped, the one escaped apostrophe restored. */
const readBanner = (reason?: ReadOnlyReason): string =>
  renderToStaticMarkup(createElement(ReadOnlyBanner, { reason }))
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

describe('the read-only banner says which guard reason latched the tab (spec §8.7, §9.3)', () => {
  test('every reason has its own note, and only the two that involve another tab say so', () => {
    expect(Object.keys(READ_ONLY_REASONS).sort()).toEqual([...REASONS].sort())
    expect(new Set(Object.values(READ_ONLY_REASONS)).size).toBe(REASONS.length)
    for (const reason of REASONS) {
      expect(/another tab/i.test(READ_ONLY_REASONS[reason])).toBe(reason === 'newer-schema' || reason === 'versionchange')
      expect(READ_ONLY_REASONS[reason]).toMatch(/^[A-Z].*\.$/) // a whole sentence
      expect(READ_ONLY_REASONS[reason]).toMatch(/Reload to (update|keep saving)\.$/) // that says what to do
    }
  })

  test('the banner shows the note for the reason it is given, not a fixed sentence', () => {
    for (const reason of REASONS) expect(readBanner(reason)).toBe(`read-only · ${READ_ONLY_REASONS[reason]} reload`)
    expect(readBanner('snapshot-newer')).not.toContain('another tab')
    expect(readBanner('newer-idb')).not.toContain('another tab')
  })

  test('a status that names no reason is read as a newer bundle in another tab', () => {
    expect(readOnlyNote(undefined)).toBe(READ_ONLY_REASONS['newer-schema'])
    expect(readBanner()).toContain(READ_ONLY_REASONS['newer-schema'])
  })
})
