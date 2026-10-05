/**
 * verify-plays: the canvas-mirror check of docs/specs/wave-1.md §10.5 (C11 adds the play checks of §11.5).
 *
 * Every file in src/components/sims that renders a `<canvas>` must either render `<SimMirror` or carry the
 * waiver comment on a line of its own:
 *
 *   // a11y-mirror-pending: wave 2
 *
 * The waiver lives in the sim's own file so each task removes its own. A file that renders a mirror and
 * still carries the waiver fails (a stale waiver hides the next regression). The waiver list is printed:
 * Wave 1 exits with six (BatchingSim, ContentionLab, MatrixBench, QuantizerSim, SchedulerLab, WgslSim).
 * Canvases outside src/components/sims are out of scope (the Lab gallery previews sit in an aria-hidden
 * wrapper; Home's two canvases are labelled role="img" previews).
 *
 *   bun run verify:plays
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const WAIVER = '// a11y-mirror-pending: wave 2'

export interface CanvasFinding {
  file: string
  canvases: number
  status: 'mirrored' | 'waived' | 'missing' | 'stale-waiver'
}

/** Source without comments, so a `<canvas>` or `<SimMirror` named in prose or a doc comment counts for nothing. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** One finding per file that renders a canvas. */
export function checkCanvasMirrors(files: readonly { file: string; text: string }[]): CanvasFinding[] {
  const out: CanvasFinding[] = []
  for (const { file, text } of files) {
    const code = stripComments(text)
    const canvases = (code.match(/<canvas[\s>/]/g) ?? []).length
    if (canvases === 0) continue
    const mirrored = /<SimMirror[\s>/]/.test(code)
    const waived = text.split('\n').some((line) => line.trim() === WAIVER)
    const status = mirrored ? (waived ? 'stale-waiver' : 'mirrored') : waived ? 'waived' : 'missing'
    out.push({ file, canvases, status })
  }
  return out
}

function main(): void {
  const dir = join(import.meta.dir, '..', 'src', 'components', 'sims')
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .sort()
    .map((f) => ({ file: `src/components/sims/${f}`, text: readFileSync(join(dir, f), 'utf8') }))
  const findings = checkCanvasMirrors(files)
  const failures: string[] = []

  for (const f of findings) {
    if (f.status === 'missing') failures.push(`${f.file}: renders <canvas> with no <SimMirror> and no "${WAIVER}" comment`)
    if (f.status === 'stale-waiver') failures.push(`${f.file}: renders <SimMirror> but still carries "${WAIVER}"; remove the waiver`)
  }

  const waived = findings.filter((f) => f.status === 'waived')
  const mirrored = findings.filter((f) => f.status === 'mirrored')
  console.log(`verify-plays: canvas mirrors: ${findings.length} sims render a canvas; ${mirrored.length} mirrored, ${waived.length} waived`)
  for (const f of mirrored) console.log(`  mirrored  ${f.file}`)
  for (const f of waived) console.log(`  waived    ${f.file}`)

  if (failures.length > 0) {
    for (const m of failures) console.error(`verify-plays: ${m}`)
    process.exit(1)
  }
  console.log('verify-plays: ok')
}

if (import.meta.main) main()
