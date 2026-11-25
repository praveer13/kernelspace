/**
 * The syntax of a claim token (Wave 1 stage 0, task K3-1): `[[c:<id>]]` for the value and unit, `[[c:<id>|pin]]` for the
 * cite. Pure syntax only — no claim data — so the registry generator, the gates, the renderer and the export agree on one
 * pattern without importing the snapshot or the claims registry.
 */
export const CLAIM_TOKEN_SOURCE = '\\[\\[c:[a-z0-9._-]+(?:\\|pin)?\\]\\]'

const CLAIM_TOKEN = new RegExp(`\\[\\[c:([a-z0-9._-]+)(?:\\|(pin))?\\]\\]`, 'g')

/** A regex over claim tokens, whose one capture group is the id and second is `pin`. */
export const claimTokenPattern = (): RegExp => new RegExp(`\\[\\[c:([a-z0-9._-]+)(?:\\|(pin))?\\]\\]`, 'g')

/** The claim tokens in a text, in order, as the id and whether it asks for the cite. */
export function claimTokensIn(text: string): { id: string; pin: boolean }[] {
  return [...text.matchAll(CLAIM_TOKEN)].map((m) => ({ id: m[1]!, pin: m[2] === 'pin' }))
}
