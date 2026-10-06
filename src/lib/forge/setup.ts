/**
 * The setup commands a learner pastes to get a lab (docs/specs/wave-2.md §16.1-16.2): one per platform, the
 * workspace-rooted artifact path and the per-lab Codespaces link. Pure strings, so the page and its tests share them.
 *
 * Every archive's root is a Cargo workspace (pack-labs.py writes its Cargo.toml), so cargo puts `target/` at that root,
 * one folder above the crate, not inside it.
 */

import type { ForgeLab } from '@/data/labs'

export const CODESPACES_REPO = 'praveer13/kernelspace'

/** The claim the billing note's free core-hours come from (src/data/claims/prices.ts); the number is never typed here. */
export const CODESPACES_FREE_HOURS_CLAIM = 'price.codespaces.free-core-hours'

export const MSVC_BUILD_TOOLS_URL = 'https://visualstudio.microsoft.com/visual-cpp-build-tools/'

export type SetupTabId = 'posix' | 'tar' | 'powershell' | 'wsl'

export interface SetupTab {
  id: SetupTabId
  label: string
  /** where the command runs and what it needs */
  platform: string
  command: string
  /** one sentence under the command */
  note: string
  /** extra lines, rendered as a list under the note */
  extra?: string[]
}

/** `/labs/<id>.zip` to `/labs/<id>.tar.gz`: pack-labs.py writes one beside every zip with the same members. */
export const tarballPath = (zip: string) => zip.replace(/\.zip$/, '.tar.gz')

/** The lab's crate directory relative to the workspace root (the folder the archive extracts to). */
export const crateOf = (lab: ForgeLab) => lab.crateDir ?? lab.id

/** The drop-me .wasm as cargo writes it: under the workspace root's target/, and the same file seen from inside the crate. */
export function artifactPaths(lab: ForgeLab): { fromWorkspace: string; fromCrate: string } {
  const up = '../'.repeat(crateOf(lab).split('/').length)
  return { fromWorkspace: `${lab.id}/${lab.artifact}`, fromCrate: `${up}${lab.artifact}` }
}

export function codespacesUrl(labId: string): string {
  return `https://codespaces.new/${CODESPACES_REPO}?devcontainer_path=.devcontainer/labs/${labId}/devcontainer.json`
}

export function setupTabs(lab: ForgeLab, origin: string): SetupTab[] {
  const zipName = lab.zip.split('/').pop() ?? `${lab.id}.zip`
  const zipUrl = new URL(lab.zip, origin).href
  const tarUrl = new URL(tarballPath(lab.zip), origin).href
  const crate = crateOf(lab)
  const dir = lab.id
  const posix =
    `test ! -e ${dir} && ` +
    `curl -fsSL ${zipUrl} -o ${zipName} && ` +
    `mkdir ${dir} && ` +
    `unzip -q ${zipName} -d ${dir} && ` +
    `cd ${dir}/${crate}`
  return [
    {
      id: 'posix',
      label: 'POSIX',
      platform: 'macOS, Linux, or WSL · requires curl and unzip',
      command: posix,
      note: 'Creates a fresh folder and enters the exercise crate. It stops if that folder already exists.',
    },
    {
      id: 'tar',
      label: 'tar',
      platform: 'macOS, Linux, Windows 10+ in cmd.exe · requires curl and tar, which Windows 10+ ships',
      command: `mkdir ${dir} && cd ${dir} && curl -fsSL ${tarUrl} | tar xz && cd ${crate}`,
      note: 'The archive has no top-level folder, so this makes one first. mkdir fails if the folder exists, and nothing is unpacked.',
      extra: ['In Windows PowerShell 5, curl is an alias for Invoke-WebRequest: use the PowerShell tab there.'],
    },
    {
      id: 'powershell',
      label: 'PowerShell',
      platform: 'Windows PowerShell or PowerShell 7 · nothing to install',
      command: `iwr ${zipUrl} -OutFile ${zipName}; Expand-Archive ${zipName} ${dir}; cd ${dir}/${crate}`,
      note: 'Downloads the ZIP, expands it into a new folder and enters the exercise crate. Expand-Archive refuses to overwrite files you already have.',
    },
    {
      id: 'wsl',
      label: 'WSL',
      platform: 'Ubuntu in WSL · use the POSIX command',
      command: `sudo apt install -y curl unzip && ${posix}`,
      note: 'Run it inside the Linux shell, with the lab under your Linux home (~), not under /mnt/c.',
      extra: [
        'Install Rust inside WSL with the Linux rustup line (rustup.rs). The Windows Build Tools are not needed there.',
        'Open the folder from the Linux shell with `code .` (VS Code’s WSL extension).',
      ],
    },
  ]
}
