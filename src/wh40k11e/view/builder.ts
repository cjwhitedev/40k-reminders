import type { Wh40kCatalog } from '../domain/rules'
import type { Wh40kArmyDocument } from '../state/armyDocument'

export interface Wh40kBuilderOption {
  id: string
  name: string
  selected: boolean
  available: boolean
  overlay?: 'legends'
  /** The heading the option lists under, e.g. "Epic Heroes"; units are grouped by type. */
  section?: string
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
  /** The faction's sub-faction filter, e.g. Chapters; absent when it has none. */
  subFactions?: { label: string; options: Array<{ label: string; value: string }> }
  groups: Wh40kBuilderGroup[]
}

const byName = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name, 'en') || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)

/** The unit-type headings, in the order Games Workshop lists an army: leaders first, then the rest. */
export const WH40K_UNIT_SECTIONS = [
  'Epic Heroes',
  'Characters',
  'Battleline',
  'Dedicated Transports',
  'Fortifications',
  'Other units',
] as const

export const wh40kUnitSection = (role: string | undefined): (typeof WH40K_UNIT_SECTIONS)[number] => {
  const value = (role ?? '').toLowerCase()
  if (value.includes('epic hero')) return 'Epic Heroes'
  if (value.includes('character')) return 'Characters'
  if (value.includes('battleline')) return 'Battleline'
  if (value.includes('dedicated transport')) return 'Dedicated Transports'
  if (value.includes('fortification')) return 'Fortifications'
  return 'Other units'
}

const bySection = (left: Wh40kBuilderOption, right: Wh40kBuilderOption) =>
  WH40K_UNIT_SECTIONS.indexOf(left.section as (typeof WH40K_UNIT_SECTIONS)[number]) -
    WH40K_UNIT_SECTIONS.indexOf(right.section as (typeof WH40K_UNIT_SECTIONS)[number]) || byName(left, right)

/** The faction picker and the army's selection cards: Units, Detachment, then the detachment's Enhancements. */
export const createWh40kBuilderViewModel = (
  catalog: Wh40kCatalog,
  document: Wh40kArmyDocument
): Wh40kBuilderViewModel => {
  const datasheetIds = new Set(document.datasheetIds)
  const enhancementIds = new Set(document.enhancementIds)
  const faction = catalog.factions.find(item => item.id === document.factionId)

  // A sub-faction shows its own units and the ones open to every sub-faction; picked units always stay.
  const datasheets = catalog.datasheets
    .filter(sheet => sheet.factionId === document.factionId)
    .filter(
      sheet =>
        !document.subFaction ||
        !sheet.subFactionKeywords?.length ||
        sheet.subFactionKeywords.includes(document.subFaction) ||
        datasheetIds.has(sheet.sourceRecordId)
    )
    .map(sheet => ({
      id: sheet.sourceRecordId as string,
      name: sheet.name,
      selected: datasheetIds.has(sheet.sourceRecordId),
      available: true,
      section: wh40kUnitSection(sheet.role),
      ...(sheet.context === 'legends' ? { overlay: 'legends' as const } : {}),
    }))
    .sort(bySection)

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
    ...(faction?.subFactions
      ? {
          subFactions: {
            label: faction.subFactions.label,
            options: faction.subFactions.keywords.map(keyword => ({ label: keyword, value: keyword })),
          },
        }
      : {}),
    groups: [
      { key: 'datasheet', title: 'Units', options: datasheets },
      { key: 'detachment', title: 'Detachment', options: detachments },
      ...(enhancements.length
        ? [{ key: 'enhancement' as const, title: 'Enhancements', options: enhancements }]
        : []),
    ],
  }
}
