import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { byId } from '../../src/data/claims'
import { BOOT_CLAIMS, deriveBoot, fmt } from '../../src/lib/boot/model'
import Catch from '../../src/pages/boot/Catch'

/** The step as a learner reads it, tags stripped. It reads the claims when it renders, so the registry is what moves it. */
const readStep = (): string =>
  renderToStaticMarkup(createElement(Catch, { model: deriveBoot(), guess: null, commit: () => {}, next: () => {} }))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')

describe('Boot copy follows the claims', () => {
  test('step 4 states the KV cache per token in KiB from the claim, in both places', () => {
    const claim = byId[BOOT_CLAIMS.kvPerToken]
    const original = claim.value
    try {
      // Two values, so a figure typed into the copy can match one of them at most.
      for (const bytes of [131_072, 262_144]) {
        claim.value = bytes
        const kib = fmt.kib(bytes)
        const page = readStep()
        expect(page).toContain(`${bytes.toLocaleString('en-US')} bytes/token (${kib}) of cache`)
        expect(page).toContain(`left at ${kib} per token`)
      }
    } finally {
      claim.value = original
    }
    expect(readStep()).toContain('(128 KiB) of cache')
  })
})
