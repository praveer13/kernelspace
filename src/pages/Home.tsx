import { Suspense, lazy, useEffect } from 'react'
import { Link } from 'react-router'
import { motion, useReducedMotion } from 'framer-motion'
import Lenis from 'lenis'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  TrendingDown,
  Database,
  Gauge,
  BookOpen,
  Eye,
  Hammer,
  Wrench,
  ArrowRight,
  Play,
} from 'lucide-react'
import MemoryGrid from '@/components/home/MemoryGrid'
import ScrollStory from '@/components/home/ScrollStory'
import SimShowcase from '@/components/home/SimShowcase'
import TrackCard from '@/components/TrackCard'
import CodeBlock from '@/components/CodeBlock'
import { LinkButton } from '@/components/Button'
import { TRACKS, CAPSTONE, ORDERED_LESSON_IDS } from '@/lib/tracks'
import {
  useProgress,
  selectDoneLessons,
  rankForXp,
  TOTAL_LESSONS,
} from '@/lib/progress'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

const ParticleField = lazy(() => import('@/components/home/ParticleField'))

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

/* ------------------------------- Lenis -------------------------------- */

function useLenis() {
  const reduced = useReducedMotion()
  useEffect(() => {
    if (reduced) return
    const lenis = new Lenis({ autoRaf: true, lerp: 0.11 })
    lenis.on('scroll', ScrollTrigger.update)
    return () => lenis.destroy()
  }, [reduced])
}

/* -------------------------------- Hero --------------------------------- */

const H1_WORDS: Array<{ w: string; grad: boolean }> = [
  { w: 'From', grad: false },
  { w: 'cache', grad: true },
  { w: 'lines', grad: true },
  { w: 'to', grad: false },
  { w: 'continuous', grad: true },
  { w: 'batching.', grad: true },
]

const META_CHIPS = ['6 tracks', '40 lessons', '9 simulators', '100% in-browser']

function Hero() {
  const reduced = useReducedMotion()
  const lessons = useProgress((s) => s.lessons)
  const done = useProgress(selectDoneLessons)
  const xp = useProgress((s) => s.xp)
  const rank = rankForXp(xp)
  const nextId = ORDERED_LESSON_IDS.find((id) => lessons[id]?.status !== 'done') ?? null
  const returning = done > 0

  const [nextTrack, nextLesson] = nextId ? nextId.split('.') : ['t0', 'l1']
  const nextTrackMeta = TRACKS.find((t) => t.id === nextTrack)

  const showParticles =
    !reduced && typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches

  return (
    <section className="relative flex min-h-[max(720px,calc(100dvh-4rem))] items-center overflow-hidden">
      {/* background layers */}
      <div aria-hidden className="absolute inset-0 bg-blueprint" />
      {showParticles && (
        <Suspense fallback={null}>
          <ParticleField />
        </Suspense>
      )}
      <div aria-hidden className="absolute inset-0 bg-grad-radial-glow" />

      <div className="relative mx-auto grid w-full max-w-app items-center gap-12 px-6 py-16 lg:grid-cols-[55%_45%] lg:px-12">
        {/* Left — copy */}
        <div>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.4, ease: EASE }}
            className="section-label"
          >
            {'// systems programming for llm serving'}
          </motion.p>

          <motion.h1
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.045, delayChildren: 0.25 } } }}
            className="mt-5 font-display text-[42px] font-bold leading-[1.02] tracking-[-0.03em] text-text-1 md:text-display-xl"
          >
            {H1_WORDS.map((word, i) => (
              <motion.span
                key={i}
                variants={{
                  hidden: { opacity: 0, y: 24 },
                  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
                }}
                className={`mr-[0.28em] inline-block last:mr-0 ${word.grad ? 'text-grad-brand' : ''}`}
              >
                {word.w}
              </motion.span>
            ))}
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5, ease: EASE }}
          >
            <p className="mt-6 max-w-[52ch] text-body-lg text-text-2">
              The interactive course that takes backend engineers from "I deploy APIs" to
              reading the vLLM paper, reasoning about PagedAttention, and understanding why
              NVIDIA rewrote their serving stack in Rust. No prior systems knowledge required.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {META_CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-line bg-surface-1/70 px-3 py-1 font-mono text-[11px] text-text-3"
                >
                  {chip}
                </span>
              ))}
            </div>
          </motion.div>

          {returning && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.75, duration: 0.4, ease: EASE }}
              className="mt-7 flex max-w-md items-center gap-3 rounded-md border border-line bg-surface-1/80 px-3.5 py-2.5"
            >
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${(done / TOTAL_LESSONS) * 100}%` }}
                />
              </div>
              <span className="whitespace-nowrap font-mono text-[11px] text-text-3">
                {done}/{TOTAL_LESSONS} lessons · {rank.name}
              </span>
            </motion.div>
          )}

          <motion.div
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.8 } } }}
            className="mt-8 flex flex-wrap items-center gap-4"
          >
            <motion.div variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } } }}>
              {returning && nextId ? (
                <LinkButton to={`/lesson/${nextId}`} icon={Play}>
                  {`Resume: ${nextTrackMeta?.code ?? 'T0'} · Lesson ${nextLesson?.slice(1) ?? '1'}`}
                </LinkButton>
              ) : (
                <LinkButton to="/tracks/t0" icon={ArrowRight}>
                  Start at Track 0
                </LinkButton>
              )}
            </motion.div>
            <motion.div variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } } }}>
              <LinkButton to="/lab" variant="secondary">
                Explore the lab
              </LinkButton>
            </motion.div>
            <motion.span
              variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } } }}
              className="hidden items-center gap-2 rounded-full border border-line px-3 py-1.5 font-mono text-[11px] text-text-3 sm:flex"
            >
              <kbd className="text-text-2">⌘K</kbd> to search
            </motion.span>
          </motion.div>
        </div>

        {/* Right — interactive memory grid */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.7, duration: 0.8, ease: EASE }}
          className="mx-auto w-full max-w-[520px]"
        >
          <MemoryGrid />
        </motion.div>
      </div>

      {/* scroll cue */}
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-3">scroll</span>
        <span className="h-6 w-px origin-top animate-scroll-cue bg-text-3" />
      </div>
    </section>
  )
}

/* --------------------------- Latency marquee --------------------------- */

const MARQUEE: Array<[string, string]> = [
  ['L1 cache', '0.5 ns'],
  ['L2', '7 ns'],
  ['DRAM', '100 ns'],
  ['NVMe', '150 µs'],
  ['H100 HBM3', '3.35 TB/s'],
  ['PCIe Gen5', '64 GB/s'],
  ['KV cache @70B', '0.31 MB/token'],
  ['decode', 'bandwidth-bound'],
  ['NVLink', '900 GB/s'],
  ['TLB hit', '~1 ns'],
  ['prefill', 'compute-bound'],
  ['context switch', '1 µs'],
]

function LatencyMarquee() {
  return (
    <section
      aria-label="Latency and bandwidth reference numbers"
      className="pause-on-hover relative h-[72px] overflow-hidden border-y border-line bg-surface-1/60"
    >
      <div className="mask-edge-x flex h-full items-center overflow-hidden">
        <div className="flex w-max animate-marquee items-center whitespace-nowrap">
          {[0, 1].map((half) => (
            <div key={half} className="flex items-center gap-8 pr-8" aria-hidden={half === 1}>
              {MARQUEE.map(([label, value], i) => (
                <span
                  key={i}
                  className="flex items-center gap-2 font-mono text-xs transition-transform duration-150 hover:-translate-y-0.5"
                >
                  <span className="text-text-3">{label}</span>
                  <span className="text-text-3">—</span>
                  <span className="text-accent">{value}</span>
                  <span className="pl-6 text-text-3">·</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------ Problem -------------------------------- */

const PAINS = [
  {
    icon: TrendingDown,
    title: 'One request = one idle GPU.',
    body: 'Static batching wastes 60%+ of a $30k accelerator. The fix is an idea from 1962: preemptive scheduling.',
    foot: 'track 5 · continuous batching',
    color: '#FB7185',
  },
  {
    icon: Database,
    title: 'OOM with memory to spare.',
    body: "KV caches fragment GPU memory exactly like malloc fragments a heap. vLLM's PagedAttention is literally virtual memory.",
    foot: 'track 1 · allocators → track 5',
    color: '#FBBF24',
  },
  {
    icon: Gauge,
    title: 'Why is decode slow on a supercomputer?',
    body: "Autoregressive decoding reads gigabytes of weights per token. It's bandwidth-bound — a roofline problem, not a compute problem.",
    foot: 'track 4 · roofline model',
    color: '#A78BFA',
  },
]

function Problem() {
  return (
    <section className="mx-auto max-w-app px-6 py-28 lg:px-12">
      <div className="grid gap-12 lg:grid-cols-[35%_65%]">
        <div className="lg:sticky lg:top-[120px] lg:self-start">
          <p className="section-label">0x01 — the problem</p>
          <h2 className="mt-4 font-display text-h2 text-text-1 md:text-display-lg">
            Your backend instincts fail at the GPU.
          </h2>
          <p className="mt-4 max-w-sm text-body text-text-2">
            You can ship web apps. LLMs break your intuitions — the failure modes are
            fifty years old and wearing new clothes.
          </p>
        </div>

        <div className="space-y-6">
          {PAINS.map((pain, i) => (
            <motion.article
              key={pain.title}
              initial={{ opacity: 0, y: 48 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-20% 0px' }}
              transition={{ delay: i * 0.12, duration: 0.7, ease: EASE }}
              className="group rounded-lg border border-line bg-surface-1 p-6 transition-colors duration-180 hover:border-line-bright"
            >
              <div className="flex items-start gap-4">
                <span
                  className="mt-0.5 text-text-3 transition-colors duration-150 group-hover:text-[var(--pain-color)]"
                  style={{ '--pain-color': pain.color } as React.CSSProperties}
                >
                  <pain.icon size={22} strokeWidth={1.75} />
                </span>
                <div>
                  <h3 className="font-display text-h4 text-text-1">{pain.title}</h3>
                  <p className="mt-2 text-body text-text-2">{pain.body}</p>
                  <p className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-text-3">
                    <svg width="14" height="8" viewBox="0 0 14 8" aria-hidden>
                      <motion.path
                        d="M0 4 H12 M9 1 L12.5 4 L9 7"
                        fill="none"
                        stroke="#3EF2A4"
                        strokeWidth="1.2"
                        initial={{ pathLength: 0 }}
                        whileInView={{ pathLength: 1 }}
                        viewport={{ once: true, margin: '-20% 0px' }}
                        transition={{ delay: i * 0.12 + 0.5, duration: 0.4 }}
                      />
                    </svg>
                    {pain.foot}
                  </p>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ------------------------- Curriculum preview -------------------------- */

function CapstoneCard() {
  const stepsDone = useProgress((s) => s.capstone.stepsDone.length)
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-15% 0px' }}
      transition={{ delay: 6 * 0.08, duration: 0.6, ease: EASE }}
      className="lg:col-span-2"
    >
      <Link to="/capstone" className="group relative block overflow-hidden rounded-lg p-px">
        {/* slow 6s conic gradient-border rotation — the only perpetual motion here */}
        <span
          aria-hidden
          className="absolute inset-[-120%] animate-spin-slow bg-[conic-gradient(from_0deg,#3EF2A4,#22D3EE,#A78BFA,#3EF2A4)]"
        />
        <span className="relative flex flex-col gap-6 rounded-lg bg-surface-1 p-6 md:flex-row md:items-center md:justify-between">
          <span>
            <span className="flex items-center gap-3">
              <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-medium text-grad-brand">
                {CAPSTONE.code}
              </span>
              <CAPSTONE.glyph size={20} strokeWidth={1.75} className="text-accent" />
            </span>
            <span className="mt-4 block font-display text-h4 text-text-1">
              {CAPSTONE.name}
            </span>
            <span className="mt-1.5 block text-body-sm text-text-2">{CAPSTONE.promise}</span>
            <span className="mt-3 block font-mono text-[11px] text-text-3">
              7 guided steps · tokenize → batch → measure
              {stepsDone > 0 && <span className="text-accent"> · {stepsDone}/7 done</span>}
            </span>
          </span>

          {/* mini architecture glyph with flowing dashes */}
          <svg viewBox="0 0 300 60" className="w-full max-w-[300px] shrink-0" aria-hidden>
            {['tok', 'embed', 'forward', 'sampler'].map((label, i) => {
              const x = 6 + i * 76
              return (
                <g key={label}>
                  <rect
                    x={x}
                    y={16}
                    width={64}
                    height={28}
                    rx={4}
                    fill="#111722"
                    stroke="#2C3A4F"
                    strokeWidth={1}
                  />
                  <text
                    x={x + 32}
                    y={33}
                    textAnchor="middle"
                    fontSize={9}
                    fontFamily="'JetBrains Mono', monospace"
                    fill="#A3B0C2"
                  >
                    {label}
                  </text>
                  {i < 3 && (
                    <line
                      x1={x + 64}
                      y1={30}
                      x2={x + 76}
                      y2={30}
                      stroke="#3EF2A4"
                      strokeWidth={1.25}
                      strokeDasharray="4 4"
                      className="animate-dash-flow"
                    />
                  )}
                </g>
              )
            })}
          </svg>
        </span>
      </Link>
    </motion.div>
  )
}

function CurriculumPreview() {
  return (
    <section className="mx-auto max-w-app px-6 py-28 lg:px-12">
      <div className="mx-auto max-w-2xl text-center">
        <p className="section-label">0x02 — curriculum</p>
        <h2 className="mt-4 font-display text-h2 text-text-1 md:text-display-lg">
          The full stack, bottom to top.
        </h2>
        <p className="mt-4 text-body text-text-2">
          Six tracks. One address space. Start wherever your gaps are — everything is
          unlocked, but the order is the point.
        </p>
      </div>

      <div className="mt-14 grid gap-5 lg:grid-cols-2">
        {TRACKS.map((track, i) => (
          <motion.div
            key={track.id}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ delay: i * 0.08, duration: 0.6, ease: EASE }}
          >
            <TrackCard track={track} />
          </motion.div>
        ))}
        <CapstoneCard />
      </div>

      <p className="mt-8 text-center">
        <Link
          to="/curriculum"
          className="font-mono text-xs text-text-3 transition-colors duration-150 hover:text-accent"
        >
          open the full curriculum →
        </Link>
      </p>
    </section>
  )
}

/* ----------------------------- Lab section ----------------------------- */

function LabShowcase() {
  return (
    <section className="py-28">
      <div className="mx-auto mb-10 flex max-w-app items-end justify-between gap-6 px-6 lg:px-12">
        <div>
          <p className="section-label">0x03 — the lab</p>
          <h2 className="mt-4 font-display text-h2 text-text-1 md:text-display-lg">
            Nine simulators. Zero installs.
          </h2>
          <p className="mt-3 max-w-lg text-body text-text-2">
            Learn by breaking things — every idea ships with a machine you can poke.
          </p>
        </div>
        <Link
          to="/lab"
          className="hidden shrink-0 font-mono text-xs text-text-2 transition-colors duration-150 hover:text-accent md:block"
        >
          open the lab →
        </Link>
      </div>
      <SimShowcase />
    </section>
  )
}

/* -------------------------------- Method ------------------------------- */

const METHOD = [
  {
    icon: BookOpen,
    title: 'Read',
    body: 'Dense, analogy-first prose. Every concept anchored to a JVM/Python runtime you already know.',
  },
  {
    icon: Eye,
    title: 'See',
    body: 'Watch the machine: every idea ships with a live visualization.',
  },
  {
    icon: Hammer,
    title: 'Break',
    body: 'Segfault a pointer. Fragment a heap. Starve a scheduler. On purpose.',
  },
  {
    icon: Wrench,
    title: 'Build',
    body: 'Assemble it all into a working toy inference engine.',
  },
]

function Method() {
  return (
    <section id="method" className="mx-auto max-w-app scroll-mt-24 px-6 py-28 lg:px-12">
      <div className="mx-auto max-w-2xl text-center">
        <p className="section-label">0x04 — the loop</p>
        <h2 className="mt-4 font-display text-h2 text-text-1 md:text-display-lg">
          Read. See. Break. Build.
        </h2>
      </div>

      <div className="relative mt-14 grid gap-10 lg:grid-cols-4 lg:gap-6">
        {/* dashed connector with animated dash flow */}
        <svg
          aria-hidden
          className="absolute left-0 right-0 top-7 hidden h-px w-full lg:block"
          preserveAspectRatio="none"
        >
          <line
            x1="0"
            y1="0"
            x2="100%"
            y2="0"
            stroke="#2C3A4F"
            strokeWidth="1"
            strokeDasharray="6 6"
            className="animate-dash-flow"
          />
        </svg>
        {METHOD.map((step, i) => (
          <motion.div
            key={step.title}
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ delay: i * 0.1, duration: 0.5, ease: EASE }}
            className="relative"
          >
            <motion.span
              initial={{ scale: 0.8 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true, margin: '-15% 0px' }}
              transition={{ delay: i * 0.1 + 0.15, type: 'spring', stiffness: 260, damping: 16 }}
              className="relative z-10 flex h-14 w-14 items-center justify-center rounded-lg border border-line bg-surface-1 text-accent"
            >
              <step.icon size={22} strokeWidth={1.75} />
            </motion.span>
            <p className="mt-5 font-mono text-[11px] text-text-3">0{i + 1}</p>
            <h3 className="mt-1 font-display text-h4 text-text-1">{step.title}</h3>
            <p className="mt-2 text-body-sm text-text-2">{step.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

/* --------------------------- Code compare teaser ------------------------ */

const SNIPPETS = [
  {
    label: 'Python',
    lang: 'python',
    code: `def array_sum(xs):
    total = 0
    for x in xs:        # GC-tracked objects
        total += x      # every int is a heap box
    return total

# The interpreter owns every byte.
# You never see a pointer —
# but the cache misses are real.
# 1B ints/s? Try 40M.`,
  },
  {
    label: 'Java',
    lang: 'java',
    code: `public static long arraySum(long[] xs) {
    long total = 0;
    for (long x : xs) {   // JIT unrolls this
        total += x;       // bounds check per access
    }
    return total;
}
// GC owns the heap. The JIT hides
// the cost — right up until it can't.
// (Ask any low-latency team.)`,
  },
  {
    label: 'C',
    lang: 'c',
    chip: 'no GC · pointer arithmetic',
    code: `#include <stddef.h>

long array_sum(const long *xs, size_t n) {
    long total = 0;
    for (size_t i = 0; i < n; i++) {
        total += xs[i];   // raw pointer arithmetic
    }
    return total;         // no GC, no bounds check
}                         // just you and the cache.`,
  },
  {
    label: 'Rust',
    lang: 'rust',
    chip: 'no GC · pointer arithmetic',
    code: `fn array_sum(xs: &[i64]) -> i64 {
    let mut total = 0;
    for x in xs {        // iterator → ptr arithmetic
        total += x;      // borrow checker proves it safe
    }
    total
}
// Same machine code as C.
// Safety proven at compile time.`,
  },
]

function CodeTeaser() {
  return (
    <section className="mx-auto max-w-app px-6 py-28 lg:px-12">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <p className="section-label">0x05 — we speak your language first</p>
          <h3 className="mt-4 font-display text-h2 text-text-1">
            Every concept, in a language you know — then in the one you're learning.
          </h3>
          <p className="mt-4 max-w-md text-body text-text-2">
            Snippets open in Python/Java, then slide to C/Rust. Watch the same idea lose
            its garbage collector.
          </p>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15% 0px' }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <CodeBlock filename="array_sum — 4 ways" tabs={SNIPPETS} autoAdvanceMs={3500} />
        </motion.div>
      </div>
    </section>
  )
}

/* --------------------------------- FAQ ---------------------------------- */

const FAQS = [
  {
    q: 'I only know Python/TypeScript. Is this for me?',
    a: 'Yes. Track 0 assumes zero systems knowledge; every analogy anchors to the GC/JIT runtimes you already use every day.',
  },
  {
    q: 'Do I need a GPU?',
    a: 'No. Every simulator is CPU/JS. The WGSL playground uses WebGPU if your browser has it, and simulates the execution otherwise — identical UI.',
  },
  {
    q: 'How long does it take?',
    a: 'Roughly 40–60 hours for all six tracks plus the capstone. Most learners do 2–3 lessons a week.',
  },
  {
    q: 'Is my progress private?',
    a: 'It never leaves your browser. Progress lives in localStorage only; export or import it as JSON anytime from the Progress page.',
  },
  {
    q: 'Why Rust?',
    a: "Because the production stacks did — NVIDIA Dynamo's data plane, Hugging Face tokenizers, SGLang kernels. Track 3 shows why ownership maps so well to serving infrastructure.",
  },
]

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-[800px] scroll-mt-24 px-6 py-28">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-15% 0px' }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <p className="section-label text-center">0x06 — faq</p>
        <h3 className="mt-4 text-center font-display text-h2 text-text-1">
          Questions, answered.
        </h3>
      </motion.div>
      <Accordion type="single" collapsible className="mt-10 space-y-3">
        {FAQS.map((faq, i) => (
          <motion.div
            key={faq.q}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ delay: i * 0.06, duration: 0.4, ease: EASE }}
          >
            <AccordionItem
              value={`faq-${i}`}
              className="rounded-lg border border-line bg-surface-1 px-5 transition-colors duration-150 data-[state=open]:border-line-bright"
            >
              <AccordionTrigger className="py-4 text-left font-display text-[16px] font-medium text-text-1 hover:no-underline">
                {faq.q}
              </AccordionTrigger>
              <AccordionContent className="text-body-sm text-text-2">
                {faq.a}
              </AccordionContent>
            </AccordionItem>
          </motion.div>
        ))}
      </Accordion>
    </section>
  )
}

/* ------------------------------- Final CTA ------------------------------ */

function FinalCta() {
  return (
    <section className="relative flex min-h-[480px] items-center overflow-hidden border-t border-line">
      <div aria-hidden className="absolute inset-0 bg-blueprint" />
      <div
        aria-hidden
        className="absolute inset-0 animate-breathe bg-[radial-gradient(50%_50%_at_50%_50%,rgba(62,242,164,.06),transparent_70%)]"
      />
      <div className="relative mx-auto max-w-2xl px-6 py-24 text-center">
        <p className="section-label">0x0A — begin</p>
        <motion.h2
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-20% 0px' }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
          className="mt-4 font-display text-h2 text-text-1 md:text-display-lg"
        >
          {['The', 'machine', 'is', 'waiting.'].map((w) => (
            <motion.span
              key={w}
              variants={{
                hidden: { opacity: 0, y: 24 },
                show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
              }}
              className="mr-[0.28em] inline-block last:mr-0"
            >
              {w}
            </motion.span>
          ))}
        </motion.h2>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-20% 0px' }}
          transition={{ delay: 0.2, duration: 0.5, ease: EASE }}
        >
          <p className="mt-4 text-body-lg text-text-2">
            Free. Static. Yours. Open Track 0 and touch your first cache line.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <LinkButton to="/tracks/t0" icon={ArrowRight}>
              Start learning
            </LinkButton>
            <LinkButton to="/curriculum" variant="secondary">
              Browse the curriculum
            </LinkButton>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

/* --------------------------------- Page --------------------------------- */

export default function Home() {
  useLenis()
  return (
    <>
      <Hero />
      <LatencyMarquee />
      <Problem />
      <ScrollStory />
      <CurriculumPreview />
      <LabShowcase />
      <Method />
      <CodeTeaser />
      <Faq />
      <FinalCta />
    </>
  )
}
