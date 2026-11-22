import { expect, test } from 'bun:test'
import lesson from '@/data/lessons/t0/row-vs-column'

type Block = { type: string; tabs?: { label: string; code: string }[] }

function pythonTab(): string {
  const blocks = (lesson as unknown as { blocks?: Block[]; sections?: Block[] }).blocks ?? []
  const all: Block[] = blocks.length ? blocks : JSON.parse(JSON.stringify(lesson)).sections ?? []
  for (const b of all) {
    const t = b.tabs?.find((x) => x.label === 'Python')
    if (t) return t.code
  }
  throw new Error('no Python tab')
}

test('t0.l3 Python tab sums row and column slices, not single elements', () => {
  const code = pythonTab()
  expect(code).toMatch(/A\[i, :\]\.sum\(\)/)
  expect(code).toMatch(/A\[:, j\]\.sum\(\)/)
  const executable = code.split('\n').filter((l) => !l.trim().startsWith('#'))
  expect(executable.join('\n')).not.toMatch(/A\[i, j\]/)
})
