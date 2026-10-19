/**
 * How the physics tab prints numbers (docs/specs/s5.md §8.3; S5-11): one place for the formatter its report values and
 * claim chips share, and for the report's own strings. A plain module, so the component files export only components.
 */

/** A number as text: `digits` decimals, thousands separators, a real minus sign, and `+` when asked. */
export function fmtNum(x: number, digits: number, sign = false): string {
  const text = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  const zero = Number(text.replace(/,/g, '')) === 0
  return (x < 0 && !zero ? '−' : sign && x > 0 && !zero ? '+' : '') + text
}

/**
 * A report string (a gate's detail, a dropped point's reason) with the thousands separators the rest of the tab prints:
 * each whole number of four digits or more is grouped, and nothing else changes. A decimal, a date ("2026-10-18") and a
 * digit run inside a longer token stay as written, so the grouped text reads back to the file's string with the commas removed.
 */
export function groupThousands(s: string): string {
  return s.replace(/(?<![\w.,-])\d{4,}(?![\w-]|[.,]\d)/g, (n) => Number(n).toLocaleString('en-US'))
}
