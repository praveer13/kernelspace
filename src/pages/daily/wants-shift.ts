/**
 * Whether a `?shift=` value asks for the On-Call pilot's shift (docs/specs/wave-3.md §16.6). `/daily` reads it before it
 * loads anything of the shift: the shift's code (`world/shift`, the note card) is one chunk that only a shift visit
 * downloads (`shift-kit`). `world/shift` keeps its own `shiftRequested` for the code that already has the module, and
 * tests/world/shift.test.ts holds that the two agree on every value, so `?shift=3` is the only one that turns it on.
 */
export const wantsShift = (raw: string | null): boolean => raw === '3'
