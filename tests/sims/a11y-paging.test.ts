/**
 * The default VmPagingSim view passes axe at 360, 320 and 1280 px (wave-2 final review F12; `npm run a11y -- --routes
 * /lab/paging,/lab/paging?machine=contention,/lab/batching` is the browser proof). axe needs a browser, so these
 * checks pin the causes by source and by arithmetic on the design tokens:
 *   - the eviction-policy Select trigger is a combobox, which takes its name from a label (button-name, critical);
 *   - page, frame, TLB and disk cells carry text at full text-3, not text-3/30 or /50 (color-contrast, serious);
 *   - the virtual-page buttons keep 40 px tracks in a narrow stage instead of overlapping (target-size, serious);
 *   - BatchingSim's row and queue entrances move without fading, so labels never pass through a low-contrast frame.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')
const paging = read('src', 'components', 'sims', 'VmPagingSim.tsx')
const batching = read('src', 'components', 'sims', 'BatchingSim.tsx')
const tailwind = read('tailwind.config.js')

const token = (name: string): string => {
  const m = new RegExp(`'?${name}'?: '(#[0-9A-Fa-f]{6})'`).exec(tailwind)
  if (!m) throw new Error(`no token ${name}`)
  return m[1]
}
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('VmPagingSim axe causes', () => {
  test('the eviction-policy trigger is named by its visible label', () => {
    const trigger = /<SelectTrigger\b([^>]*)>/.exec(paging)
    expect(trigger).not.toBeNull()
    const labelledby = /aria-labelledby="([^"]+)"/.exec(trigger![1])?.[1]
    expect(labelledby).toBeDefined()
    const label = new RegExp(`<p id="${labelledby}"[^>]*>([^<]+)</p>`).exec(paging)
    expect(label?.[1].trim()).toBe('eviction policy')
  })

  test('no text in the sim is dimmed with a text-text-3 opacity modifier', () => {
    expect(paging.match(/text-text-3\/\d+/g) ?? []).toEqual([])
  })

  test('text-3 reads at 4.5:1 on every surface the cells use', () => {
    for (const bg of ['ink', 'surface-1', 'surface-2']) {
      expect(contrast(token('text-3'), token(bg))).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('the virtual-page buttons sit on fixed 40 px tracks, so a narrow stage cannot overlap them', () => {
    expect(paging).toContain('grid-cols-[repeat(4,2.5rem)]')
    expect(paging).not.toMatch(/grid w-fit grid-cols-4/)
    expect(paging).toMatch(/data-vpn=\{vpn\}[\s\S]{0,400}h-10 w-10/)
  })
})

describe('BatchingSim entrance animation', () => {
  test('the engine rows and the queue chips do not animate opacity', () => {
    const rows = /<motion\.div\b[\s\S]*?className="flex items-center gap-2"/.exec(batching)?.[0] ?? ''
    const chips = /<motion\.span\b[\s\S]*?title=\{`r\$\{r\.id\}/.exec(batching)?.[0] ?? ''
    expect(rows).toContain('exit={')
    expect(chips).toContain('animate={{ scale: 1 }}')
    for (const block of [rows, chips]) {
      expect(block).not.toMatch(/opacity\s*:/)
    }
  })
})
