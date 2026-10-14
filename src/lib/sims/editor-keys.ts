/**
 * The WGSL editor's Tab rule (WCAG 2.1.2 No Keyboard Trap). Tab indents, which would trap a keyboard user in the
 * textarea, so Escape releases the next Tab and Shift+Tab always moves focus. The release lasts until the next
 * key, a Tab or the editor losing focus, so a Tab pressed after coming back to the editor indents again.
 *
 * Pure, so tests/sims/wgsl-keys.test.ts can run the sequences without a DOM.
 */

export type EditorKeyAction = 'indent' | 'pass'

export interface EditorKeyStep {
  /** `indent`: the editor inserts two spaces and cancels the key. `pass`: the browser handles the key (focus moves on Tab). */
  action: EditorKeyAction
  /** Whether the next plain Tab moves focus out. */
  released: boolean
}

export function editorKey(released: boolean, key: string, shiftKey: boolean): EditorKeyStep {
  if (key === 'Escape') return { action: 'pass', released: true }
  // a modifier pressed on its way to Shift+Tab is not a keystroke in the text
  if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return { action: 'pass', released }
  if (key !== 'Tab') return { action: 'pass', released: false }
  if (shiftKey || released) return { action: 'pass', released: false }
  return { action: 'indent', released: false }
}

/** The editor lost focus: the release does not carry over to the next visit. */
export function editorBlur(): boolean {
  return false
}
