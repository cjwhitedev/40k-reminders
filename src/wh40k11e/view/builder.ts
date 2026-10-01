import type { Wh40kCatalog } from '../domain/rules'
import type { Wh40kArmyDocument } from '../state/armyDocument'

export interface Wh40kBuilderOption {
  id: string
  name: string
  selected: boolean
  available: boolean
  overlay?: 'legends'
}

export type Wh40kBuilderGroupKey = 'datasheet' | 'detachment' | 'enhancement'

export interface Wh40kBuilderGroup {
  key: Wh40kBuilderGroupKey
  title: string
  mobileTitle?: string
  options: Wh40kBuilderOption[]
}

export interface Wh40kBuilderViewModel {
  factions: Array<{ label: string; value: string }>
  groups: Wh40kBuilderGroup[]
}

const byName = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name, 'en') || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)

/** The faction picker and the army's selection cards: Units, Detachment, then the detachment's Enhancements. */
export const createWh40kBuilderViewModel = (
  catalog: Wh40kCatalog,
  document: Wh40kArmyDocument
): Wh40kBuilderViewModel => {
  const datasheetIds = new Set(document.datasheetIds)
  const enhancementIds = new Set(document.enhancementIds)

  const datasheets = catalog.datasheets
    .filter(sheet => sheet.factionId === document.factionId)
    .map(sheet => ({
      id: sheet.sourceRecordId as string,
      name: sheet.name,
      selected: datasheetIds.has(sheet.sourceRecordId),
      available: true,
      ...(sheet.context === 'legends' ? { overlay: 'legends' as const } : {}),
    }))
    .sort(byName)

  const detachments = catalog.detachments
    .filter(item => item.factionId === document.factionId && item.gameMode === 'matched-play')
    .map(item => ({
      id: item.id,
      name: item.name,
      selected: item.id === document.detachmentId,
      available: true,
    }))
    .sort(byName)

  const enhancements = document.detachmentId
    ? catalog.rules
        .filter(
          rule =>
            rule.kind === 'enhancement' &&
            rule.gameMode === 'matched-play' &&
            rule.scope.kind === 'detachment' &&
            rule.scope.detachmentId === document.detachmentId
        )
        .map(rule => ({
          id: rule.sourceRecordId as string,
          name: rule.name,
          selected: enhancementIds.has(rule.sourceRecordId),
          available: true,
        }))
        .sort(byName)
    : []

  return {
    factions: [...catalog.factions].sort(byName).map(faction => ({ label: faction.name, value: faction.id })),
    groups: [
      { key: 'datasheet', title: 'Units', options: datasheets },
      { key: 'detachment', title: 'Detachment', options: detachments },
      ...(enhancements.length
        ? [{ key: 'enhancement' as const, title: 'Enhancements', options: enhancements }]
        : []),
    ],
  }
}
