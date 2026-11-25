/**
 * A plain-text field with claim tokens (a panel's "where it breaks", a prequestion's why): the same source popover the
 * markdown renderer draws, without markdown. A field that cannot render a link still names its claim (Wave 1 stage 0,
 * task K3-1).
 */
import { Fragment, createElement, type ReactNode } from 'react'
import { ClaimToken } from '@/components/ClaimToken'

export function ClaimText({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let last = 0
  let key = 0
  const re = /\[\[c:[a-z0-9._-]+(?:\|pin)?\]\]/g
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const [token] = m
    const body = token.slice('[[c:'.length, -']]'.length)
    const [id, mode] = body.split('|')
    parts.push(createElement(ClaimToken, { key: key++, id, pin: mode === 'pin' }))
    last = m.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return createElement(Fragment, null, parts)
}
