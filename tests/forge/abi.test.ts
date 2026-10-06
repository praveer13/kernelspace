import { describe, expect, test } from 'bun:test'
import {
  ABI_COMPAT,
  compatFor,
  LIST_INPUT,
  onlyInput,
  parseListReply,
  parseOnlyReply,
  sameChecks,
  splitLabId,
  trapMessage,
} from '../../src/lib/forge/abi'
import type { ListReply } from '../../src/lib/forge/types'

const list = (checks: unknown[], extra: Record<string, unknown> = {}) => ({ lab: 'rust-allocator', version: 2, abi: 2, checks, ...extra })
const check = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: `${id} label`, stage: 1, seeded: false, ...extra })

describe('the compatibility table (§12.3)', () => {
  test('v1 runs whole-module with no seeds, trace or probe, and earns lab-green at most', () => {
    expect(compatFor(1)).toEqual({
      abi: 1,
      perCheck: false,
      seeds: false,
      trace: false,
      probe: false,
      maxProvenance: 'lab-green',
      note: 'built from the v1 template: rebuild for per-check results',
    })
  })

  test('v2 runs per check with seeds, trace and probe, and can earn unseen', () => {
    expect(compatFor(2)).toMatchObject({ abi: 2, perCheck: true, seeds: true, trace: true, probe: true, maxProvenance: 'unseen' })
  })

  test('a newer module is refused rather than misread', () => {
    expect(compatFor(3)).toBeNull()
    expect(compatFor(0)).toBeNull()
    expect(Object.keys(ABI_COMPAT)).toEqual(['1', '2'])
  })
})

describe('lab ids', () => {
  test('a reference build is identified by its suffix', () => {
    expect(splitLabId('rust-allocator@reference')).toEqual({ lab: 'rust-allocator', reference: true })
    expect(splitLabId('rust-allocator')).toEqual({ lab: 'rust-allocator', reference: false })
    expect(splitLabId('reference')).toEqual({ lab: 'reference', reference: false })
  })
})

describe('ks_run input lines', () => {
  test('list and only, with a seed line only when one is given', () => {
    expect(LIST_INPUT).toBe('v 2\nlist\n')
    expect(onlyInput('align')).toBe('v 2\nonly align\n')
    expect(onlyInput('align', 41)).toBe('v 2\nonly align\nseed 41\n')
    expect(onlyInput('align', 2 ** 32 + 5)).toBe('v 2\nonly align\nseed 5\n')
    expect(onlyInput('align', 0)).toBe('v 2\nonly align\nseed 0\n')
  })
})

describe('the list reply', () => {
  test('a well-formed reply keeps exactly the four fields per check', () => {
    const r = parseListReply(list([check('boot'), check('align', { stage: 2, seeded: true, extra: 1 })]))
    expect(r).toEqual({
      lab: 'rust-allocator',
      version: 2,
      abi: 2,
      checks: [
        { id: 'boot', label: 'boot label', stage: 1, seeded: false },
        { id: 'align', label: 'align label', stage: 2, seeded: true },
      ],
    })
  })

  test('malformed replies name what is wrong', () => {
    expect(parseListReply(null)).toBeString()
    expect(parseListReply(list([check('a')], { abi: 1 }))).toContain('abi 1')
    expect(parseListReply(list([]))).toContain('no checks')
    expect(parseListReply(list([check('a'), check('a')]))).toContain('twice')
    expect(parseListReply(list([check('a', { seeded: 'yes' })]))).toContain('seeded')
    expect(parseListReply(list([check('a', { stage: -1 })]))).toContain('stage')
    expect(parseListReply(list([check('two words')]))).toContain('id')
    expect(parseListReply({ ...list([check('a')]), lab: '' })).toContain('lab id')
  })
})

describe('the only reply', () => {
  const only = (checks: unknown[], extra: Record<string, unknown> = {}) => ({ lab: 'rust-allocator', version: 2, abi: 2, checks, ...extra })

  test('the verdict for the requested check, with its seed when seeded', () => {
    expect(parseOnlyReply(only([{ id: 'align', label: 'x', pass: true, msg: 'ok', seed: 41 }]), 'align', 'rust-allocator')).toEqual({ pass: true, msg: 'ok', seed: 41 })
    expect(parseOnlyReply(only([{ id: 'boot', label: 'x', pass: false, msg: 'no' }]), 'boot', 'rust-allocator')).toEqual({ pass: false, msg: 'no' })
  })

  test('a reply for another check, more checks, another lab or a bad seed is an ABI violation', () => {
    expect(parseOnlyReply(only([{ id: 'boot', label: 'x', pass: true, msg: '' }]), 'align', 'rust-allocator')).toBeString()
    expect(
      parseOnlyReply(only([{ id: 'align', label: 'x', pass: true, msg: '' }, { id: 'boot', label: 'x', pass: true, msg: '' }]), 'align', 'rust-allocator'),
    ).toBeString()
    expect(parseOnlyReply(only([{ id: 'align', label: 'x', pass: true, msg: '' }]), 'align', 'kv-block-manager')).toContain('names lab')
    expect(parseOnlyReply(only([{ id: 'align', label: 'x', pass: true, msg: '', seed: -1 }]), 'align', 'rust-allocator')).toContain('seed')
    expect(parseOnlyReply(only([{ id: 'align', label: 'x', pass: 'yes', msg: '' }]), 'align', 'rust-allocator')).toContain('pass/msg')
  })
})

describe('trap messages', () => {
  test('a todo!() reads as "not implemented yet" with its text and place (the prototype panic)', () => {
    expect(trapMessage('panicked at src/allocator.rs:3:140: not yet implemented: construct your allocator')).toBe(
      'not implemented yet: construct your allocator (src/allocator.rs:3:140)',
    )
    expect(trapMessage('panicked at src/allocator.rs:3:140: not yet implemented')).toBe('not implemented yet (src/allocator.rs:3:140)')
  })

  test('any other panic keeps its text; no text says so', () => {
    expect(trapMessage('panicked at src/allocator.rs:9:5: index out of bounds: the len is 0 but the index is 0')).toBe(
      'panicked at src/allocator.rs:9:5: index out of bounds: the len is 0 but the index is 0',
    )
    expect(trapMessage('oops')).toBe('panicked: oops')
    expect(trapMessage(undefined)).toContain('without a panic message')
    expect(trapMessage('  ')).toContain('without a panic message')
  })
})

describe('sameChecks', () => {
  const a: ListReply = { lab: 'l', version: 1, abi: 2, checks: [{ id: 'x', label: '', stage: 1, seeded: false }] }
  test('same lab and ids in order', () => {
    expect(sameChecks(a, structuredClone(a))).toBe(true)
    expect(sameChecks(a, { ...a, lab: 'm' })).toBe(false)
    expect(sameChecks(a, { ...a, checks: [...a.checks, { id: 'y', label: '', stage: 1, seeded: false }] })).toBe(false)
  })
})
