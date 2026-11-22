import type { Erratum } from './schema'

export default {
  id: '2026-11-21-dynamo-case-study-70-percent',
  date: '2026-11-21',
  kind: 'error',
  lessons: ['t3.l6'],
  title: "The 70% figure is Chromium's, and Dynamo's Kubernetes operator is Go",
  before: 'The case study labelled 70% as the share of C/C++ CVEs (Microsoft/Google), and said Python handles Kubernetes integration.',
  after: "70% is Chromium's share of high-severity security bugs that are memory unsafety (912 bugs since 2015). Dynamo's Kubernetes operator is Go; KV bytes move through NIXL, a C++ library.",
  why: 'The figure comes from one codebase, not all C/C++ CVEs, and Microsoft was not re-read. Android fell below 20% after moving new code to Rust. The operator module is Go.',
  source: {
    url: 'https://www.chromium.org/Home/chromium-security/memory-safety/',
    title: 'Chromium Security: Memory safety',
  },
  items: [
    {
      q: "What does Chromium's 70% memory-safety figure measure?",
      options: [
        'Its high or critical security bugs that come from memory unsafety',
        'All the CVEs that Microsoft and Google have filed against C and C++ software',
        'Android vulnerabilities that remain memory-safety bugs after adopting Rust',
        'Chromium crashes that a garbage-collected language would have prevented',
      ],
      correct: [0],
      why: [
        "Right: it is Chromium's own count of high or critical severity security bugs, not an industry-wide share.",
        "It is one project's analysis, not a count of all C and C++ CVEs.",
        'The Android figure is a different one: memory-safety vulnerabilities fell below 20% of the total in 2025.',
        'The page counts security bugs, and reads them as mistakes with C and C++ pointers; it makes no claim about crashes.',
      ],
    },
  ],
} satisfies Erratum
