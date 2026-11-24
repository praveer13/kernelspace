/**
 * Display-only typography. `curlyQuotes` turns a straight double quote into an opening quote at the start of a word
 * (the start of the text, or after whitespace, an opening bracket, a dash, a hyphen or a slash) and into a closing quote
 * everywhere else (after a letter, a digit, a sign such as ×, or closing punctuation).
 * The heading face draws a straight quote as a closing curl; published errata are never edited, so the page does this.
 */
export function curlyQuotes(s: string): string {
  return s.replace(/"/g, (_q, offset: number) => (offset === 0 || /[\s([{–—\-/]/.test(s[offset - 1] ?? '') ? '“' : '”'))
}
