import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { build } from 'esbuild'

// The v2 sweep hash in headless Chromium (docs/specs/s5.md §8.4, S5-15, gate B9). tests/physics/sweep-hash.ts runs EngineV2
// on the six golden configurations and hashes their stats(); Bun pins the hash in tests/physics/sweep-hash.test.ts. Here the
// same file is bundled with esbuild (installed with vite) into an IIFE, evaluated on about:blank (no app, no server, no
// secure origin, so the file carries its own sha256) and compared with the same fixture. Firefox and WebKit are checked by
// hand with this bundle (`node -e` below) and recorded in the PR body, since the config runs Chromium only.

const SOURCE = fileURLToPath(new URL('../tests/physics/sweep-hash.ts', import.meta.url))
const FIXTURE = fileURLToPath(new URL('../tests/fixtures/physics/v2-sweep-hash.json', import.meta.url))

interface Hash { rev: string; sha256: string; configs: { row: string; tp: number; c: number; isl: number; osl: number; seed: number; sha256: string }[] }

test('the v2 sweep hash computed in Chromium equals the fixture Bun pins', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Firefox and WebKit are checked by hand (S5-15)')
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Hash & { header: string }
  const out = await build({
    entryPoints: [SOURCE],
    bundle: true,
    format: 'iife',
    globalName: 'SweepHash',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  })
  const bundle = out.outputFiles[0].text

  await page.goto('about:blank')
  await page.addScriptTag({ content: bundle })
  const hash = await page.evaluate(() => (window as unknown as { SweepHash: { sweepHash(): unknown } }).SweepHash.sweepHash())

  // the browser engine is the one that ran it, not Bun
  expect(await page.evaluate(() => navigator.userAgent)).toContain('Chrome')
  expect(hash).toEqual({ rev: fixture.rev, sha256: fixture.sha256, configs: fixture.configs })
})
