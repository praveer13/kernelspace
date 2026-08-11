import { Link } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowRight, Check, Download, Flame, HardDrive, Package, Terminal } from 'lucide-react'
import { RUST_ZERO_LABS, SYSTEMS_FORGE_LABS } from '@/data/labs'
import { getTrack } from '@/lib/tracks'
import { useProgress, XP } from '@/lib/progress'
import { cn } from '@/lib/utils'

const STEPS = [
  {
    icon: Download,
    title: 'get the lab',
    body: 'Download the template crate — or open the repo in Codespaces / a dev container. One file has TODO(you) markers. Only that file is yours.',
  },
  {
    icon: Terminal,
    title: 'make it green',
    body: 'Run cargo test until every check passes on your machine. The terminal and this site run the identical suite — green here means green there.',
  },
  {
    icon: Package,
    title: 'drop the wasm',
    body: 'cargo build --release --target wasm32-unknown-unknown, then drop the .wasm on the lab page. Your code runs in your browser, in a sandbox. Nothing is uploaded.',
  },
]

const LAB_GROUPS = [
  {
    id: 'rust-zero',
    eyebrow: 'Track R · Rust Zero',
    title: 'Compiler-driven micro-drills',
    body: 'Ten small crates, one per lesson. Finish the TODO functions and let rustc teach the ownership rule at the exact line that breaks it.',
    labs: RUST_ZERO_LABS,
  },
  {
    id: 'systems',
    eyebrow: 'Systems Forge',
    title: 'Portfolio labs',
    body: 'Build the components under a serving engine. Each lab names the Rust Zero readiness path that makes its implementation vocabulary familiar.',
    labs: SYSTEMS_FORGE_LABS,
  },
] as const

export default function Forge() {
  const labs = useProgress((s) => s.labs)
  return (
    <div className="mx-auto max-w-app px-6 pb-24 pt-24 lg:px-12">
      {/* hero */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto max-w-2xl text-center"
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          the forge · local-only labs
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-text-1 sm:text-5xl">
          Real Rust. Your machine.
          <br />
          Zero servers.
        </h1>
        <p className="mt-5 text-body-lg text-text-2">
          The lessons explain systems. The forge makes you build them: actual Rust crates with
          one file marked <span className="font-mono text-[0.9em] text-text-1">TODO(you)</span>,
          graded by checks that run identically in your terminal and in your browser. No account,
          no upload — your code never leaves your machine.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2 font-mono text-[11px] text-text-3">
          {['no backend', 'no wasm-pack', 'no account', 'honor system'].map((chip) => (
            <span key={chip} className="rounded-full border border-line px-2.5 py-1">
              {chip}
            </span>
          ))}
        </div>
      </motion.div>

      {/* how it works */}
      <div className="mt-16 grid gap-4 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <motion.div
            key={s.title}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-lg border border-line bg-surface-1 p-5"
          >
            <div className="flex items-center gap-2.5">
              <s.icon className="h-4 w-4 text-accent" />
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
                step {i + 1}
              </p>
            </div>
            <p className="mt-3 font-mono text-sm text-text-1">{s.title}</p>
            <p className="mt-2 text-body-sm text-text-2">{s.body}</p>
          </motion.div>
        ))}
      </div>

      {/* labs */}
      {LAB_GROUPS.map((group, groupIndex) => (
        <section key={group.id} className="mt-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
            {group.eyebrow}
          </p>
          <div className="mt-2 max-w-2xl">
            <h2 className="font-display text-h3 text-text-1">{group.title}</h2>
            <p className="mt-2 text-body-sm text-text-2">{group.body}</p>
          </div>
          <div className="mt-5 space-y-3">
            {group.labs.map((lab, i) => {
              const done = labs[lab.id]?.done ?? false
              const track = getTrack(lab.trackId)
              const requiredChecks = lab.checks.filter((check) => !check.optional).length
              const optionalChecks = lab.checks.length - requiredChecks
              const delayIndex = groupIndex === 0 ? i : RUST_ZERO_LABS.length + i
              return (
                <motion.div
                  key={lab.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.2 + delayIndex * 0.035, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Link
                    to={`/forge/${lab.id}`}
                    className="group flex items-center gap-5 rounded-lg border border-line bg-surface-1 p-5 transition-colors duration-150 hover:border-accent/50"
                  >
                    <span
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-md border font-mono text-sm',
                        done
                          ? 'border-accent/60 bg-accent/10 text-accent'
                          : 'border-line bg-ink text-text-3',
                      )}
                    >
                      {done ? <Check className="h-4 w-4" /> : String(lab.index).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-text-1">{lab.title}</p>
                        <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-text-3">
                          {track?.code ?? lab.trackId}
                        </span>
                        {lab.readiness && (
                          <span className="rounded border border-amber/35 bg-amber/5 px-1.5 py-0.5 font-mono text-[10px] text-amber">
                            {lab.readiness.label}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-body-sm text-text-2">{lab.hook}</p>
                    </div>
                    <div className="hidden shrink-0 items-center gap-4 font-mono text-[11px] text-text-3 sm:flex">
                      <span>
                        {requiredChecks} checks
                        {optionalChecks > 0 ? ` + ${optionalChecks} advanced` : ''}
                      </span>
                      <span>~{lab.minutes} min</span>
                      <span className="text-accent">+{XP.lab} XP</span>
                      <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-1" />
                    </div>
                  </Link>
                </motion.div>
              )
            })}
          </div>
        </section>
      ))}

      {/* honesty box */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.45 }}
        className="mt-12 flex items-start gap-3 rounded-lg border border-line bg-surface-1 p-5"
      >
        <Flame className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
        <p className="text-body-sm text-text-2">
          <span className="text-text-1">Grading is the honor system.</span> The checks live in the
          crate — read them, that&apos;s allowed. The site trusts the module you drop; your real
          portfolio artifact is the repo with your commit history (README has the two-line
          `git init` ritual — do it on day one). Your site progress lives in localStorage;
          snapshot it anytime from{' '}
          <Link to="/progress" className="text-accent underline">
            Progress → data ownership
          </Link>
          .
        </p>
      </motion.div>

      <p className="mt-8 text-center font-mono text-[11px] text-text-3">
        <HardDrive className="mr-1.5 inline h-3.5 w-3.5" />
        everything runs locally — progress lives in your browser&apos;s localStorage
      </p>
    </div>
  )
}
