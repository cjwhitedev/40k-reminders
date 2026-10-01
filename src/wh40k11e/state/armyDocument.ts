import type { Wh40kCatalog } from '../domain/rules'

export const WH40K_ARMY_DOCUMENT_SCHEMA_VERSION = 1

export interface Wh40kReminderPreference {
  hidden?: boolean
  note?: string
  order?: number
}

/** A player's 40K army: stable catalog IDs only, so display names can change without breaking it. */
export interface Wh40kArmyDocument {
  schemaVersion: typeof WH40K_ARMY_DOCUMENT_SCHEMA_VERSION
  name: string
  factionId: string
  detachmentId?: string
  datasheetIds: string[]
  enhancementIds: string[]
  allowsLegends: boolean
  reminderPreferences: Record<string, Wh40kReminderPreference>
}

export const WH40K_DEFAULT_FACTION_ID = 'SM'

export const createWh40kArmyDocument = (catalog: Wh40kCatalog, factionId: string): Wh40kArmyDocument => ({
  schemaVersion: WH40K_ARMY_DOCUMENT_SCHEMA_VERSION,
  name: catalog.factions.find(faction => faction.id === factionId)?.name ?? factionId,
  factionId,
  datasheetIds: [],
  enhancementIds: [],
  allowsLegends: false,
  reminderPreferences: {},
})

export const serializeWh40kArmyDocument = (document: Wh40kArmyDocument): string => JSON.stringify(document)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

const isPreference = (value: unknown): value is Wh40kReminderPreference =>
  isRecord(value) &&
  (value.hidden === undefined || typeof value.hidden === 'boolean') &&
  (value.note === undefined || typeof value.note === 'string') &&
  (value.order === undefined || Number.isInteger(value.order))

/**
 * Parse a stored document and check every ID against the catalog. Anything unrecognized returns
 * null so the caller replaces it with a clean document; stored state is never translated.
 */
export const deserializeWh40kArmyDocument = (
  serialized: string,
  catalog: Wh40kCatalog
): Wh40kArmyDocument | null => {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return null
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== WH40K_ARMY_DOCUMENT_SCHEMA_VERSION ||
    typeof value.name !== 'string' ||
    typeof value.factionId !== 'string' ||
    (value.detachmentId !== undefined && typeof value.detachmentId !== 'string') ||
    !isStringArray(value.datasheetIds) ||
    !isStringArray(value.enhancementIds) ||
    typeof value.allowsLegends !== 'boolean' ||
    !isRecord(value.reminderPreferences) ||
    !Object.values(value.reminderPreferences).every(isPreference)
  ) {
    return null
  }
  const { factionId, detachmentId, datasheetIds, enhancementIds } = value
  const detachment = catalog.detachments.find(item => item.id === detachmentId)
  const datasheets = new Map(catalog.datasheets.map(item => [item.sourceRecordId as string, item]))
  const enhancements = new Map(
    catalog.rules
      .filter(rule => rule.kind === 'enhancement')
      .map(rule => [rule.sourceRecordId as string, rule])
  )
  const valid =
    catalog.factions.some(faction => faction.id === factionId) &&
    (detachmentId === undefined ||
      (detachment?.factionId === factionId && detachment.gameMode === 'matched-play')) &&
    datasheetIds.every(id => datasheets.get(id)?.factionId === factionId) &&
    enhancementIds.every(id => {
      const scope = enhancements.get(id)?.scope
      return scope?.kind === 'detachment' && scope.detachmentId === detachmentId
    })
  if (!valid) return null
  return {
    schemaVersion: WH40K_ARMY_DOCUMENT_SCHEMA_VERSION,
    name: value.name,
    factionId,
    ...(typeof detachmentId === 'string' ? { detachmentId } : {}),
    datasheetIds,
    enhancementIds,
    allowsLegends: value.allowsLegends,
    reminderPreferences: value.reminderPreferences as Record<string, Wh40kReminderPreference>,
  }
}

export const setWh40kReminderPreference = (
  document: Wh40kArmyDocument,
  reminderId: string,
  preference: Wh40kReminderPreference
): Wh40kArmyDocument => {
  const next = { ...document.reminderPreferences[reminderId], ...preference }
  if (!next.hidden) delete next.hidden
  if (!next.note) delete next.note
  if (next.order === undefined) delete next.order
  const reminderPreferences = { ...document.reminderPreferences }
  if (Object.keys(next).length) reminderPreferences[reminderId] = next
  else delete reminderPreferences[reminderId]
  return { ...document, reminderPreferences }
}
