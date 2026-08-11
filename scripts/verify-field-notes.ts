import { readFile } from 'node:fs/promises'
import { ALL_LESSONS, lessonById } from '../src/data/lessons'
import { isFieldNotesDocument } from '../src/lib/field-notes'

const raw = await readFile(new URL('../public/field-notes.json', import.meta.url), 'utf8')
const value: unknown = JSON.parse(raw)
if (!isFieldNotesDocument(value)) throw new Error('public/field-notes.json failed schema validation')

const ids = new Set<string>()
for (const entry of value.entries) {
  if (ids.has(entry.id)) throw new Error(`duplicate field-note id: ${entry.id}`)
  ids.add(entry.id)
  for (const lessonId of entry.lessons) {
    if (!lessonById(lessonId)) throw new Error(`${entry.id} references unknown lesson ${lessonId}`)
  }
}

const sensitiveIds = new Set([
  't5.l6',
  't5.l8',
  't5.l9',
  ...ALL_LESSONS.filter((lesson) => lesson.trackId === 't6' || lesson.trackId === 't7').map(
    (lesson) => lesson.id,
  ),
])

for (const id of sensitiveIds) {
  const lesson = lessonById(id)
  if (!lesson?.verifiedAt || !/^\d{4}-\d{2}$/.test(lesson.verifiedAt)) {
    throw new Error(`${id} is landscape-sensitive but has no valid verifiedAt marker`)
  }
}

const newestAllowed = value.generatedAt.slice(0, 7)
for (const lesson of ALL_LESSONS.filter((item) => item.verifiedAt)) {
  if (lesson.verifiedAt! > newestAllowed) {
    throw new Error(`${lesson.id} verification ${lesson.verifiedAt} is newer than feed ${newestAllowed}`)
  }
}

console.log(
  `field notes ok: ${value.entries.length} entries · ${sensitiveIds.size} sensitive lessons · ${value.quarter}`,
)
