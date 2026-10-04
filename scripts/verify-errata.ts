import { readdir } from 'node:fs/promises'
import { ALL_LESSONS } from '../src/data/lessons'

const dir = new URL('../src/data/errata/', import.meta.url)
const lessonIds = new Set(ALL_LESSONS.map((lesson) => lesson.id))
const files = (await readdir(dir)).filter((name) => name.endsWith('.ts') && name !== 'schema.ts').sort()

const MAX_FIELD = 240
const MAX_WHY_WORDS = 40
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const isRealDate = (value: string): boolean => {
  if (!DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

// A day of slack so a contributor ahead of UTC can date a fix on their local "today".
const latestAllowed = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

const problems: string[] = []

for (const file of files) {
  const stem = file.slice(0, -'.ts'.length)
  const fail = (message: string) => problems.push(`${file}: ${message}`)
  const module: { default?: unknown } = await import(new URL(file, dir).href)
  const value = module.default
  if (!value || typeof value !== 'object') {
    fail('must default-export an Erratum object')
    continue
  }
  const entry = value as Record<string, unknown>

  if (entry.id !== stem) fail(`id ${JSON.stringify(entry.id)} must equal the file name "${stem}"`)

  if (typeof entry.date !== 'string' || !isRealDate(entry.date)) {
    fail(`date ${JSON.stringify(entry.date)} must be a real YYYY-MM-DD date`)
  } else {
    if (entry.date > latestAllowed) fail(`date ${entry.date} is in the future`)
    if (!stem.startsWith(`${entry.date}-`)) fail(`file name must start with the date ${entry.date}`)
  }

  if (entry.kind !== 'error' && entry.kind !== 'changed') fail(`kind ${JSON.stringify(entry.kind)} must be 'error' or 'changed'`)

  if (!Array.isArray(entry.lessons) || entry.lessons.length === 0) {
    fail('lessons must be a non-empty array of lesson ids')
  } else {
    for (const id of entry.lessons) {
      if (typeof id !== 'string' || !lessonIds.has(id)) fail(`unknown lesson id ${JSON.stringify(id)}`)
    }
  }

  for (const key of ['title', 'before', 'after'] as const) {
    const text = entry[key]
    if (typeof text !== 'string' || text.trim() === '') fail(`${key} must be a non-empty string`)
    else if (text.length > MAX_FIELD) fail(`${key} is ${text.length} characters (max ${MAX_FIELD})`)
  }

  if (entry.why !== undefined) {
    if (typeof entry.why !== 'string' || entry.why.trim() === '') fail('why, when present, must be a non-empty string')
    else if (entry.why.trim().split(/\s+/).length > MAX_WHY_WORDS) fail(`why is over ${MAX_WHY_WORDS} words`)
  }

  if (entry.source !== undefined) {
    const source = entry.source as Record<string, unknown> | null
    if (
      !source ||
      typeof source.url !== 'string' ||
      !source.url.startsWith('https://') ||
      typeof source.title !== 'string' ||
      source.title.trim() === ''
    ) {
      fail('source, when present, needs an https url and a title')
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  throw new Error(`${problems.length} erratum problem(s)`)
}

console.log(`errata ok: ${files.length} entries`)
