// npm run a11y -- [--routes /,/today] [--widths 360,1280] [--fixture file.html] [--skip-build] [--fail-on serious]
//
// The accessibility harness (docs/specs/wave-2.md §22.2): builds the app, serves it with `vite preview`, runs axe
// (WCAG 2.0 to 2.2, A and AA) through @axe-core/playwright at each width, and prints the violations by route, width
// and impact. Exit 1 when any violation is at or above --fail-on (default serious, so serious and critical);
// exit 0 when there is none; exit 2 when the harness itself could not run (build, server, browser, navigation).
//
// --fixture <file.html> checks a local page instead of the app (no build, no server): the harness's own proof that
// it fails on a real violation (e2e/fixtures/bad-contrast.html). It repeats and combines with --routes.
// Browsers come from `npx playwright install chromium`; PW_CHROMIUM_EXECUTABLE points at another binary
// (the same variable playwright.config.ts reads), for hosts where the downloaded one cannot start.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AxeBuilder } from '@axe-core/playwright'
import { chromium } from '@playwright/test'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Routes that exist today. A task that adds a page adds it here, or passes --routes for its own check;
// later spec §22.2 routes (/daily, /play/scheduler, /errors, /forge/kv-block-manager, ...) join when they land.
const DEFAULT_ROUTES = [
  '/',
  '/boot',
  '/today',
  '/progress',
  '/curriculum',
  '/tracks/t5',
  '/lesson/t5.l4',
  '/lesson/r.l3',
  '/lab/roofline',
  '/forge/rust-allocator',
  '/fleet',
  '/freshness',
  '/week',
  '/lab/kv-calc',
]
const DEFAULT_WIDTHS = [360, 1280]
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const IMPACTS = ['critical', 'serious', 'moderate', 'minor']

// A harness failure (exit 2) is thrown, never process.exit()ed, so the browser and the preview server are always stopped.
class HarnessError extends Error {}
function fail(message) {
  throw new HarnessError(message)
}

function parseArgs(argv) {
  const opts = { routes: [], widths: [], fixtures: [], skipBuild: false, failOn: 'serious' }
  const value = (i, flag) => {
    if (i + 1 >= argv.length) fail(`${flag} needs a value`)
    return argv[i + 1]
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--routes') opts.routes.push(...value(i++, arg).split(',').filter(Boolean))
    else if (arg === '--widths') opts.widths.push(...value(i++, arg).split(',').filter(Boolean).map(Number))
    else if (arg === '--fixture') opts.fixtures.push(value(i++, arg))
    else if (arg === '--fail-on') opts.failOn = value(i++, arg)
    else if (arg === '--skip-build') opts.skipBuild = true
    else fail(`unknown argument ${arg}`)
  }
  for (const route of opts.routes) if (!route.startsWith('/')) fail(`route ${route} must start with /`)
  for (const w of opts.widths) if (!Number.isInteger(w) || w < 200 || w > 4000) fail(`bad width ${w}`)
  if (!IMPACTS.includes(opts.failOn)) fail(`--fail-on is one of ${IMPACTS.join(', ')}`)
  for (const f of opts.fixtures) if (!existsSync(path.resolve(repoRoot, f))) fail(`no fixture at ${f}`)
  if (opts.widths.length === 0) opts.widths = DEFAULT_WIDTHS
  // fixtures alone mean "prove the harness": the app's routes only run when asked for or when nothing else is
  if (opts.routes.length === 0 && opts.fixtures.length === 0) opts.routes = DEFAULT_ROUTES
  return opts
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitForServer(url, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) fail('vite preview exited before it was ready')
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  fail(`vite preview did not answer at ${url} within ${timeoutMs / 1000} s`)
}

function build() {
  console.log('a11y: building (npm run build)')
  const res = spawnSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  if (res.status !== 0) fail('the build failed')
}

async function startPreview() {
  const port = await freePort()
  const bin = path.join(repoRoot, 'node_modules', '.bin', 'vite')
  const child = spawn(bin, ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: repoRoot,
    stdio: 'ignore',
  })
  const base = `http://127.0.0.1:${port}`
  await waitForServer(`${base}/`, child)
  return { base, stop: () => child.kill() }
}

async function checkPage(browser, label, url, width) {
  const context = await browser.newContext({ viewport: { width, height: 800 } })
  try {
    const page = await context.newPage()
    const res = await page.goto(url, { waitUntil: 'load' })
    if (res && !res.ok()) throw new Error(`HTTP ${res.status()}`)
    // lazy routes and the ledger load after the first paint; settle, but a page that keeps polling still gets checked
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    // axe measures contrast with the fonts that will be used, so wait for them first
    await page.evaluate(() => document.fonts.ready)
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
    return violations.map((v) => ({
      route: label,
      width,
      impact: v.impact ?? 'minor',
      id: v.id,
      help: v.help,
      nodes: v.nodes.length,
      target: v.nodes[0] ? v.nodes[0].target.join(' ') : '',
    }))
  } finally {
    await context.close()
  }
}

function report(rows, checked, failOn) {
  const rank = (impact) => IMPACTS.indexOf(impact)
  rows.sort((a, b) => rank(a.impact) - rank(b.impact) || a.route.localeCompare(b.route) || a.width - b.width)
  for (const impact of IMPACTS) {
    const group = rows.filter((r) => r.impact === impact)
    if (group.length === 0) continue
    console.log(`\n${impact.toUpperCase()} (${group.length})`)
    for (const r of group) {
      console.log(`  ${r.route}  ${r.width}px  ${r.id}  ${r.nodes} node${r.nodes === 1 ? '' : 's'}  ${r.help}`)
      console.log(`    first: ${r.target}`)
    }
  }
  const counts = IMPACTS.map((i) => `${rows.filter((r) => r.impact === i).length} ${i}`).join(', ')
  const blocking = rows.filter((r) => rank(r.impact) <= rank(failOn))
  console.log(`\na11y: ${checked} page${checked === 1 ? '' : 's'} checked; ${counts}`)
  console.log(blocking.length > 0 ? `a11y: FAIL (${blocking.length} at ${failOn} or worse)` : `a11y: ok (none at ${failOn} or worse)`)
  return blocking.length === 0
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  let preview = null
  let browser = null
  const rows = []
  let checked = 0
  try {
    if (opts.routes.length > 0) {
      if (!opts.skipBuild) build()
      else if (!existsSync(path.join(repoRoot, 'dist', 'index.html'))) fail('--skip-build needs an existing dist/')
      preview = await startPreview()
    }
    const executablePath = process.env.PW_CHROMIUM_EXECUTABLE || undefined
    browser = await chromium.launch({ executablePath })
    const targets = [
      ...opts.routes.map((r) => ({ label: r, url: `${preview.base}${r}` })),
      ...opts.fixtures.map((f) => ({ label: f, url: pathToFileURL(path.resolve(repoRoot, f)).href })),
    ]
    for (const t of targets) {
      for (const width of opts.widths) {
        try {
          rows.push(...(await checkPage(browser, t.label, t.url, width)))
          checked++
        } catch (err) {
          fail(`${t.label} at ${width}px: ${err instanceof Error ? err.message : err}`)
        }
      }
    }
  } finally {
    if (browser) await browser.close()
    if (preview) preview.stop()
  }
  return report(rows, checked, opts.failOn) ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`a11y: ${err instanceof HarnessError ? err.message : (err?.stack ?? err)}`)
    process.exit(2)
  },
)
