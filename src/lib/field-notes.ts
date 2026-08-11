export interface FieldNoteEntry {
  id: string
  title: string
  summary: string
  source: string
  href: string
  published: string
  verified: string
  lessons: string[]
  tags: string[]
}

export interface FieldNotesDocument {
  schemaVersion: 1
  quarter: string
  generatedAt: string
  entries: FieldNoteEntry[]
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)

const isEntry = (value: unknown): value is FieldNoteEntry => {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.summary === 'string' &&
    typeof entry.source === 'string' &&
    typeof entry.href === 'string' &&
    entry.href.startsWith('https://') &&
    typeof entry.published === 'string' &&
    typeof entry.verified === 'string' &&
    /^\d{4}-\d{2}$/.test(entry.verified) &&
    isStringArray(entry.lessons) &&
    isStringArray(entry.tags)
  )
}

export function isFieldNotesDocument(value: unknown): value is FieldNotesDocument {
  if (!value || typeof value !== 'object') return false
  const document = value as Record<string, unknown>
  return (
    document.schemaVersion === 1 &&
    typeof document.quarter === 'string' &&
    /^\d{4}-Q[1-4]$/.test(document.quarter) &&
    typeof document.generatedAt === 'string' &&
    !Number.isNaN(Date.parse(document.generatedAt)) &&
    Array.isArray(document.entries) &&
    document.entries.length > 0 &&
    document.entries.every(isEntry)
  )
}

export async function loadFieldNotes(path = '/field-notes.json'): Promise<FieldNotesDocument> {
  const response = await fetch(path, { cache: 'no-store' })
  if (!response.ok) throw new Error(`field notes fetch failed: ${response.status}`)
  const value: unknown = await response.json()
  if (!isFieldNotesDocument(value)) throw new Error('field notes artifact is malformed')
  return value
}
