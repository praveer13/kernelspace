import type { Erratum } from './schema'

export default {
  id: '2026-10-04-t1-l5-abi-isa-distractor',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t1.l5'],
  title: 'The x86-64 psABI does define a baseline ISA level, so the quiz distractor was reworded',
  before:
    'Q3 said "which CPU instructions a compiler may emit, such as whether AVX is permitted" simply "confuses ABI with ISA", though the psABI defines baseline features and levels.',
  after:
    'The psABI names a baseline feature set and micro-architecture levels (x86-64-v2 and up). It leaves instruction encodings and semantics to processor manuals, so the distractor asks about those and the why says so.',
  why: 'A distractor that is partly true teaches a false boundary between ABI and ISA. The wrong option should be wrong for a reason the learner can check in the spec.',
  source: {
    url: 'https://gitlab.com/x86-psABIs/x86-64-ABI',
    title: 'System V x86-64 psABI (Low Level System Information: processor architecture and micro-architecture levels)',
  },
} satisfies Erratum
