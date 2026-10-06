/**
 * F3d zero-install lanes (docs/specs/wave-2.md §16.1-16.2; task 2c-07): the four setup commands, the per-lab Codespaces
 * link with its billing note read from the claims registry, the lab-scoped devcontainers, and a deterministic .tar.gz
 * beside every zip with the same members. Interaction (the tab keyboard path) has no DOM here; a browser checks it.
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SetupLanes } from '../../src/components/forge/SetupLanes'
import { claimNumber } from '../../src/data/claims'
import { FORGE_LABS } from '../../src/data/labs'
import {
  CODESPACES_FREE_HOURS_CLAIM,
  artifactPaths,
  codespacesUrl,
  setupTabs,
  tarballPath,
} from '../../src/lib/forge/setup'
import { memberDrift, readTar, readZip, tarName } from '../../scripts/verify-guardrails'

const ROOT = join(import.meta.dir, '../..')
const ORIGIN = 'https://example.test'
const lab = FORGE_LABS.find((l) => l.id === 'kv-block-manager')!
const drill = FORGE_LABS.find((l) => l.id === 'rust-zero-r1')!

function render(l = lab): string {
  const g = globalThis as { window?: unknown }
  const had = 'window' in g
  const before = g.window
  g.window = { location: { origin: ORIGIN } }
  try {
    return renderToStaticMarkup(createElement(SetupLanes, { lab: l })).replaceAll('<!-- -->', '')
  } finally {
    if (had) g.window = before
    else delete g.window
  }
}

describe('the four setup commands', () => {
  const tabs = setupTabs(lab, ORIGIN)
  const byId = Object.fromEntries(tabs.map((t) => [t.id, t]))

  test('POSIX, tar, PowerShell and WSL, in that order', () => {
    expect(tabs.map((t) => t.id)).toEqual(['posix', 'tar', 'powershell', 'wsl'])
  })

  test('POSIX is the command Wave 1 shipped', () => {
    expect(byId.posix.command).toBe(
      'test ! -e kv-block-manager && curl -fsSL https://example.test/labs/kv-block-manager.zip -o kv-block-manager.zip && ' +
        'mkdir kv-block-manager && unzip -q kv-block-manager.zip -d kv-block-manager && cd kv-block-manager/kv-block-manager',
    )
  })

  test('tar pipes the .tar.gz into tar xz, inside a folder it makes first', () => {
    expect(byId.tar.command).toContain('curl -fsSL https://example.test/labs/kv-block-manager.tar.gz | tar xz')
    expect(byId.tar.command.startsWith('mkdir kv-block-manager && cd kv-block-manager && curl')).toBe(true)
    expect(byId.tar.command.endsWith('&& cd kv-block-manager')).toBe(true)
  })

  test('PowerShell is iwr, Expand-Archive and cd, with no POSIX-only tool', () => {
    expect(byId.powershell.command).toBe(
      'iwr https://example.test/labs/kv-block-manager.zip -OutFile kv-block-manager.zip; ' +
        'Expand-Archive kv-block-manager.zip kv-block-manager; cd kv-block-manager/kv-block-manager',
    )
    expect(byId.powershell.command).not.toMatch(/curl|unzip|&&|test /)
  })

  test('WSL runs the POSIX command, after installing its two tools, and says to stay off /mnt/c', () => {
    expect(byId.wsl.command).toContain(byId.posix.command)
    expect(byId.wsl.command.startsWith('sudo apt install -y curl unzip && ')).toBe(true)
    expect(byId.wsl.note).toContain('/mnt/c')
  })

  test('a Rust Zero drill enters its nested crate in every command', () => {
    for (const t of setupTabs(drill, ORIGIN)) expect(t.command).toContain('rust-zero/r1-bindings')
  })

  test('every command names a file that exists in public/labs', () => {
    for (const l of FORGE_LABS) {
      expect(existsSync(join(ROOT, 'public', l.zip))).toBe(true)
      expect(existsSync(join(ROOT, 'public', tarballPath(l.zip)))).toBe(true)
    }
  })
})

describe('the artifact path is the workspace root’s target/', () => {
  test('a systems lab: one folder above its crate', () => {
    expect(artifactPaths(lab)).toEqual({
      fromWorkspace: 'kv-block-manager/target/wasm32-unknown-unknown/release/kv_block_manager.wasm',
      fromCrate: '../target/wasm32-unknown-unknown/release/kv_block_manager.wasm',
    })
  })

  test('a Rust Zero drill: two folders above', () => {
    expect(artifactPaths(drill).fromCrate).toBe('../../target/wasm32-unknown-unknown/release/rust_zero_r1.wasm')
  })

  test('the page shows both', () => {
    const html = render()
    expect(html).toContain('kv-block-manager/target/wasm32-unknown-unknown/release/kv_block_manager.wasm')
    expect(html).toContain('../target/wasm32-unknown-unknown/release/kv_block_manager.wasm')
    expect(html).toContain('workspace root’s')
  })
})

describe('the Codespaces link and billing note', () => {
  const html = render()

  test('each lab links its own devcontainer', () => {
    expect(codespacesUrl('kv-block-manager')).toBe(
      'https://codespaces.new/praveer13/kernelspace?devcontainer_path=.devcontainer/labs/kv-block-manager/devcontainer.json',
    )
    expect(html).toContain(`href="${codespacesUrl('kv-block-manager')}"`)
    expect(render(drill)).toContain(`href="${codespacesUrl('rust-zero-r1')}"`)
  })

  test('the note quotes the claim, not a literal', () => {
    const hours = claimNumber(CODESPACES_FREE_HOURS_CLAIM)
    expect(hours).toBeGreaterThan(0)
    expect(html).toContain(`Codespaces bills your GitHub account (`)
    expect(html).toContain(`${hours} core-hours`)
    expect(html).toContain('a month free)')
    // the source has no 120 of its own, in the component or the helpers
    for (const f of ['src/components/forge/SetupLanes.tsx', 'src/lib/forge/setup.ts']) {
      expect(readFileSync(join(ROOT, f), 'utf8')).not.toMatch(/\b120\b/)
    }
  })

  test('the claim is a quoted, sourced one, so the popover has something to show', () => {
    expect(html).toContain('Show source')
  })

  test('no boot time is quoted', () => {
    expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/\bminutes?\b|\bseconds?\b|boot/i)
  })
})

describe('lab-scoped devcontainers', () => {
  for (const l of FORGE_LABS) {
    test(`${l.id} builds only its own crate and opens its TODO file`, () => {
      const path = join(ROOT, '.devcontainer/labs', l.id, 'devcontainer.json')
      expect(existsSync(path)).toBe(true)
      const dc = JSON.parse(readFileSync(path, 'utf8'))
      const crate = l.crateDir ?? l.id
      const pkg = /^name\s*=\s*"([^"]+)"/m.exec(readFileSync(join(ROOT, 'labs', crate, 'Cargo.toml'), 'utf8'))![1]
      expect(dc.image).toBe('mcr.microsoft.com/devcontainers/rust:1-bookworm')
      expect(dc.postCreateCommand).toContain('rustup target add wasm32-unknown-unknown')
      expect(dc.postCreateCommand).toMatch(new RegExp(`cargo [a-z ]*-p ${pkg}( |$)`))
      expect(dc.postCreateCommand).not.toMatch(/--workspace|--all\b/)
      expect(dc.customizations.codespaces.openFiles).toEqual([`labs/${crate}/${l.editFile}`])
      expect(existsSync(join(ROOT, 'labs', crate, l.editFile))).toBe(true)
    })
  }

  test('the repo-wide devcontainer is untouched: it still builds the whole labs workspace', () => {
    const dc = JSON.parse(readFileSync(join(ROOT, '.devcontainer/devcontainer.json'), 'utf8'))
    expect(dc.postCreateCommand).toContain('cd labs && cargo build')
  })
})

describe('the .tar.gz beside every zip', () => {
  test('holds the zip’s members, in order, with the same bytes; only files, root-owned modes, nothing private', () => {
    for (const l of FORGE_LABS) {
      const zipPath = join(ROOT, 'public', l.zip)
      const tarPath = join(ROOT, 'public', tarballPath(l.zip))
      const zip = readZip(zipPath)
      const tar = readTar(tarPath)
      const files = new Map([...tar].map(([n, m]) => [n, m.data]))
      expect(memberDrift(zip, files)).toEqual([])
      expect(tarName(`${l.id}.zip`)).toBe(`${l.id}.tar.gz`)
      expect(tar.get('.claude/hooks/ks-guard.sh')!.mode & 0o111).not.toBe(0)
      expect(tar.get('Cargo.toml')!.mode).toBe(0o644)
      for (const n of tar.keys()) expect(n).not.toMatch(/(^|\/)(_solutions|target)(\/|$)|\.(wasm|rlib|rmeta)$/)
    }
  })

  test('pack-labs twice gives the same bytes', () => {
    const a = mkdtempSync(join(tmpdir(), 'ks-tar-a-'))
    const b = mkdtempSync(join(tmpdir(), 'ks-tar-b-'))
    try {
      for (const dir of [a, b]) {
        const r = spawnSync('python3', [join(ROOT, 'scripts/pack-labs.py'), '--out', dir], { cwd: ROOT, encoding: 'utf8' })
        expect(r.status).toBe(0)
      }
      for (const l of FORGE_LABS) {
        const name = tarName(l.zip.split('/').pop()!)
        expect(readFileSync(join(a, name)).equals(readFileSync(join(b, name)))).toBe(true)
      }
    } finally {
      rmSync(a, { recursive: true, force: true })
      rmSync(b, { recursive: true, force: true })
    }
  }, 120_000)
})
