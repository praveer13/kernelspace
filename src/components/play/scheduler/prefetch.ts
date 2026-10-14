/**
 * Starts lazy chunks ahead of need and says whether they all arrived. It never rejects: a prefetch is a head start,
 * so a chunk that fails offline here must not be an unhandled rejection. The component that needs the chunk loads
 * it again and shows the failure (Play.tsx's AfterDebrief). Its own file so Play.tsx exports only components.
 */
export async function prefetchAll(loaders: ReadonlyArray<() => Promise<unknown>>): Promise<boolean> {
  try {
    await Promise.all(loaders.map((load) => load()))
    return true
  } catch {
    return false
  }
}
