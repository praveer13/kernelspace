/**
 * Claim tokens (Wave 1 stage 0, task K3-1): `[[c:<id>]]` renders the value with its unit from the lesson snapshot,
 * `|pin` renders the cite, the export prints the value plus the claim id, and an id with no snapshot text is an error.
 */
import { describe, expect, test } from 'bun:test'
import { createElement, Fragment, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { formatClaimValue, getClaim } from '@/data/claims'
import { claimText, claimTokenText, replaceClaimTokens } from '@/lib/claim-tokens'
import { claimTokensIn } from '@/lib/claim-token-syntax'
import { LESSON_TOKEN_CLAIMS } from '../../scripts/gen-lesson-claims'
import { renderInline } from '../../src/pages/lesson/markdown'

const render = (node: ReactNode): string =>
  renderToString(createElement(MemoryRouter, null, createElement(Fragment, null, node)))

const BLOCK = 'production.vllm.block-size'

describe('the claim token', () => {
  test('its value comes from the generated token map and equals the registry formatter', () => {
    expect(LESSON_TOKEN_CLAIMS).toContain(BLOCK)
    expect(claimText(BLOCK)).toBe(formatClaimValue(getClaim(BLOCK)))
    expect(claimText(BLOCK)).toBe('64 tokens/block')
  })

  test('the plain token renders the value with its unit; |pin adds the release and read date', () => {
    const plain = render(renderInline(`vLLM's default is [[c:${BLOCK}]] today`))
    expect(plain).toContain('64 tokens/block')
    expect(plain).toContain('show its source')
    const pin = render(renderInline(`vLLM's default is [[c:${BLOCK}|pin]] today`))
    expect(pin).toContain('64 tokens/block as of vLLM v0.34.0, read 2026-11-21')
  })

  test('the export prints the value with the claim that dates it', () => {
    expect(replaceClaimTokens(`default [[c:${BLOCK}]]`)).toBe(`default 64 tokens/block (claim ${BLOCK}, read 2026-11-21)`)
    expect(replaceClaimTokens(`default [[c:${BLOCK}|pin]]`)).toBe(
      `default 64 tokens/block as of vLLM v0.34.0, read 2026-11-21 (claim ${BLOCK})`,
    )
    expect(claimTokenText(BLOCK, false)).toBe(`64 tokens/block (claim ${BLOCK}, read 2026-11-21)`)
  })

  test('a claim with no token text is an error, so the snapshot cannot silently drift', () => {
    expect(() => claimText('hw.h100-sxm.hbm-bw')).toThrow(/not in claims.tokens.generated/)
    expect(() => claimText('no.such.claim')).toThrow(/not in claims.tokens.generated/)
  })

  test('a claim token inside bold or emphasis is still a link-like token; inline code stays literal', () => {
    const bold = render(renderInline(`**default [[c:${BLOCK}]] now**`))
    expect(bold).toContain('64 tokens/block')
    expect(bold).toContain('<strong')
    const code = render(renderInline('`[[c:' + BLOCK + ']]` and [[c:' + BLOCK + ']]'))
    expect(code).toContain('>[[c:' + BLOCK + ']]</code>')
    expect(code).toContain('64 tokens/block')
  })

  test('an export leaves fenced and inline code literal', () => {
    const md = `prose [[c:${BLOCK}]]\n\n\`\`\`\n[[c:${BLOCK}]]\n\`\`\`\n\n\`[[c:${BLOCK}]]\` inline`
    const out = replaceClaimTokens(md)
    expect(out).toContain('prose 64 tokens/block (claim')
    expect(out).toContain('```\n[[c:' + BLOCK + ']]\n```')
    expect(out).toContain('`[[c:' + BLOCK + ']]` inline')
  })

  test('the two token families do not collide', () => {
    expect(claimTokensIn('[[l:t5.l7]]')).toEqual([])
    expect(claimTokensIn('[[c:production.vllm.block-size]]')).toEqual([{ id: BLOCK, pin: false }])
    expect(claimTokensIn('[[c:production.vllm.block-size|pin]]')).toEqual([{ id: BLOCK, pin: true }])
  })
})
