/** Open the global command palette (listened for in CommandPalette). */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent('ks:command-palette'))
}
