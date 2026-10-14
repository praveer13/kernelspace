/**
 * The WGSL editor is escapable by keyboard (WCAG 2.1.2, wave-2.md §12, 2b-08 minors): Tab indents, Escape then Tab
 * moves focus out, Shift+Tab always does, and the release does not survive the editor losing focus. The rule is
 * src/lib/sims/editor-keys.ts; the source checks pin that WgslSim wires it, resets on blur and shows the hint.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorBlur, editorKey } from '../../src/lib/sims/editor-keys'

const ROOT = join(import.meta.dir, '..', '..')

/** Plays keys through the rule the way WgslSim's handler does; returns what each key did. */
function play(keys: { key: string; shift?: boolean; blur?: boolean }[]): string[] {
  let released = false
  const out: string[] = []
  for (const k of keys) {
    if (k.blur) {
      released = editorBlur()
      out.push('blur')
      continue
    }
    const step = editorKey(released, k.key, k.shift ?? false)
    released = step.released
    out.push(step.action === 'indent' ? 'indent' : k.key === 'Tab' ? 'focus moves' : 'typed')
  }
  return out
}

describe('WGSL editor keys', () => {
  test('Tab indents', () => {
    expect(play([{ key: 'Tab' }, { key: 'Tab' }])).toEqual(['indent', 'indent'])
  })

  test('Escape then Tab moves focus out', () => {
    expect(play([{ key: 'Escape' }, { key: 'Tab' }])).toEqual(['typed', 'focus moves'])
  })

  test('the release is used up by that Tab: back in the editor, Tab indents again', () => {
    expect(play([{ key: 'Escape' }, { key: 'Tab' }, { key: 'Tab' }])).toEqual(['typed', 'focus moves', 'indent'])
  })

  test('Shift+Tab always moves focus, without Escape', () => {
    expect(play([{ key: 'Tab', shift: true }])).toEqual(['focus moves'])
  })

  test('typing between Escape and Tab cancels the release', () => {
    expect(play([{ key: 'Escape' }, { key: 'a' }, { key: 'Tab' }])).toEqual(['typed', 'typed', 'indent'])
  })

  test('a modifier on the way to Shift+Tab does not cancel the release', () => {
    expect(play([{ key: 'Escape' }, { key: 'Shift' }, { key: 'Tab' }])).toEqual(['typed', 'typed', 'focus moves'])
    expect(play([{ key: 'Escape' }, { key: 'Shift' }, { key: 'Tab', shift: true }, { key: 'Tab' }])).toEqual([
      'typed',
      'typed',
      'focus moves',
      'indent',
    ])
  })

  test('blur resets the release: Escape, leave by mouse, come back, Tab indents', () => {
    expect(play([{ key: 'Escape' }, { key: '', blur: true }, { key: 'Tab' }])).toEqual(['typed', 'blur', 'indent'])
    expect(editorBlur()).toBe(false)
  })
})

describe('WgslSim wiring', () => {
  const src = readFileSync(join(ROOT, 'src', 'components', 'sims', 'WgslSim.tsx'), 'utf8')
  const textarea = /<textarea\b[\s\S]*?\n\s*\/>/.exec(src)?.[0] ?? ''

  test('the editor handles keys through the rule, resets on blur and points at the hint', () => {
    expect(textarea).toContain('onKeyDown={onEditorKey}')
    expect(textarea).toMatch(/onBlur=\{\(\) => \{\s*tabReleased\.current = editorBlur\(\)/)
    expect(textarea).toContain('aria-describedby="wgsl-editor-hint"')
    expect(src).toMatch(/const step = editorKey\(tabReleased\.current, e\.key, e\.shiftKey\)/)
  })

  test('a visible hint names the way out', () => {
    const hint = /<p id="wgsl-editor-hint"([^>]*)>([\s\S]*?)<\/p>/.exec(src)
    expect(hint).not.toBeNull()
    expect(hint![1]).not.toContain('sr-only')
    expect(hint![1]).not.toContain('hidden')
    expect(hint![2]).toMatch(/Esc/)
    expect(hint![2]).toMatch(/Tab/)
  })
})
