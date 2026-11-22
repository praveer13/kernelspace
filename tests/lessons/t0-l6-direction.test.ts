import { describe, expect, test } from 'bun:test'
import lesson from '@/data/lessons/t0/flame-graphs'

const text = JSON.stringify(lesson)

describe('t0.l6 call direction', () => {
  test('rule 2 says the bar below called the bar above', () => {
    expect(text).toContain('The bar below called the bar above')
    expect(text).not.toContain('The bar above called the bar below')
  })
  test('every statement about callers agrees', () => {
    expect(text).not.toMatch(/bar above (called|calls)/i)
    expect(text).not.toMatch(/bar below was called/i)
    expect(text).toContain('the bar above was called by the bar below')
  })
  test('wait bars are tied to wall-clock profiles', () => {
    expect(text).toContain('-e wall')
    expect(text).toContain('on-CPU')
  })
})
