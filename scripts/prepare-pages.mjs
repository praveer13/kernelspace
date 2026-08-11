import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = path.join(repoRoot, 'dist')
const indexHtml = await readFile(path.join(distRoot, 'index.html'), 'utf8')

const staticRoutes = [
  'curriculum',
  'lab',
  'glossary',
  'progress',
  'capstone',
  'forge',
  'fleet',
  'week',
  'leaderboard',
  'field-notes',
]

const trackIds = ['r', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']
const simulatorIds = [
  'memory-grid',
  'allocator',
  'paging',
  'roofline',
  'wgsl',
  'quantizer',
  'kv-calc',
  'batching',
  'engine',
]

function safeArtifactId(fileName, extension) {
  if (!fileName.endsWith(extension)) return null
  const id = fileName.slice(0, -extension.length)
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) {
    throw new Error(`unsafe route id derived from ${fileName}`)
  }
  return id
}

async function artifactIds(directory, extension) {
  const entries = await readdir(path.join(distRoot, directory), { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => safeArtifactId(entry.name, extension))
    .filter((id) => id !== null)
}

const lessonIds = await artifactIds('lessons-md', '.md')
const forgeIds = await artifactIds('labs', '.zip')
const routes = new Set([
  ...staticRoutes,
  ...trackIds.map((id) => `tracks/${id}`),
  ...lessonIds.map((id) => `lesson/${id}`),
  ...simulatorIds.map((id) => `lab/${id}`),
  ...forgeIds.map((id) => `forge/${id}`),
])

for (const route of [...routes].sort()) {
  const routeDirectory = path.resolve(distRoot, route)
  if (!routeDirectory.startsWith(`${distRoot}${path.sep}`)) {
    throw new Error(`route escaped dist: ${route}`)
  }
  await mkdir(routeDirectory, { recursive: true })
  await writeFile(path.join(routeDirectory, 'index.html'), indexHtml)
}

// Unknown paths still boot React Router's own not-found experience.
await writeFile(path.join(distRoot, '404.html'), indexHtml)

console.log(
  `Prepared ${routes.size} GitHub Pages route shells ` +
    `(${lessonIds.length} lessons, ${forgeIds.length} Forge labs).`,
)
