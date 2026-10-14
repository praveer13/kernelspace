/**
 * bundle-plays — finds a play's chunk in a Vite manifest (used by verify-bundle.ts; tested in tests/plays/scheduler.test.ts).
 *
 * A play is a lazy import in the registry, so its chunk is normally filed under the play's source path. When
 * another chunk imports modules the play holds (the scheduler's Compose and card import the play's shared code),
 * Vite hoists the play into a chunk named `_Play-<hash>.js` and drops the `src` key, so the source path finds
 * nothing and a gate that skipped the play would report the page without it. Three finds, in order:
 *   1. the manifest key is the source path;
 *   2. the chunk the play's own lazy siblings (same folder) are imported from: the dynamic entry that names a
 *      sibling in its `dynamicImports` (Compose and ProductionCard, for the scheduler);
 *   3. the one dynamic entry with the play's file name that the page's closure imports lazily, once the plays
 *      found by 1 and 2 are set aside.
 * Anything else is an error, never a quiet skip.
 *
 * A play that has no source file yet (a route budgeted before its task lands) is the one deliberate skip:
 * `playSkip` says so before any chunk lookup, because find 3 would otherwise hand a missing play the
 * scheduler's hoisted `_Play-*` chunk and report the scheduler's figure under the new route.
 */

export interface PlayManifestChunk {
  file: string
  name?: string
  src?: string
  isDynamicEntry?: boolean
  imports?: string[]
  dynamicImports?: string[]
}

type PlayManifest = Record<string, PlayManifestChunk>

/** Every manifest key reachable from `root` by static imports, root first. */
function staticClosure(manifest: PlayManifest, root: string): string[] {
  const seen = new Set<string>()
  const visit = (key: string) => {
    if (seen.has(key) || !manifest[key]) return
    seen.add(key)
    for (const dep of manifest[key].imports ?? []) visit(dep)
  }
  visit(root)
  return [...seen]
}

/** The line verify-bundle prints for a play row whose source file does not exist yet, or undefined when the play exists. Checked before any chunk lookup. */
export function playSkip(route: string, playSrc: string, exists: (src: string) => boolean): string | undefined {
  return exists(playSrc) ? undefined : `skip ${route}: ${playSrc} does not exist yet`
}

/**
 * A play row's chunk, or the skip line when its source file does not exist yet. The existence check comes first, so a
 * missing play never reaches `playChunkKey`'s by-name fallback. `key` is undefined when an existing play has no chunk.
 */
export function resolvePlay(
  manifest: PlayManifest,
  route: string,
  playSrc: string,
  pageKey: string,
  allPlaySrcs: readonly string[],
  exists: (src: string) => boolean,
): { skip: string } | { key: string | undefined } {
  const skip = playSkip(route, playSrc, exists)
  return skip ? { skip } : { key: playChunkKey(manifest, playSrc, pageKey, allPlaySrcs) }
}

/** The manifest key of the chunk holding `playSrc`, or undefined when the manifest has none. `pageKey` is the page that mounts the plays. */
export function playChunkKey(manifest: PlayManifest, playSrc: string, pageKey: string, allPlaySrcs: readonly string[] = [playSrc]): string | undefined {
  if (manifest[playSrc]) return playSrc

  const dir = playSrc.slice(0, playSrc.lastIndexOf('/') + 1)
  const lazy = new Set<string>()
  for (const key of staticClosure(manifest, pageKey)) for (const dyn of manifest[key].dynamicImports ?? []) lazy.add(dyn)
  // A play is lazy from the page's closure, or from a chunk that closure lazy-loads (PlayBlock reaches both plays).
  for (const key of [...lazy]) for (const k of staticClosure(manifest, key)) for (const dyn of manifest[k].dynamicImports ?? []) lazy.add(dyn)

  const hoisted = [...lazy].filter((k) => manifest[k]?.isDynamicEntry && !manifest[k].src)
  const bySibling = hoisted.filter((k) => (manifest[k].dynamicImports ?? []).some((d) => d.startsWith(dir)))
  if (bySibling.length === 1) return bySibling[0]
  if (bySibling.length > 1) return undefined

  const name = playSrc.split('/').pop()!.replace(/\.[^.]+$/, '')
  const claimed = new Set(allPlaySrcs.filter((s) => s !== playSrc && manifest[s]).map((s) => manifest[s].file))
  const byName = hoisted.filter((k) => manifest[k].name === name && !claimed.has(manifest[k].file))
  return byName.length === 1 ? byName[0] : undefined
}
