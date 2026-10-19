import type { Wh40kCatalog } from '../domain/rules'
import { createWh40kArmyDocument, type Wh40kArmyDocument } from '../state/armyDocument'

/**
 * A typical 2000-point Gladius Task Force list, priced from Wahapedia's 2026-10-16 points (first
 * unit of each kind; 1975 points plus a 20-point enhancement). Tests use it, and the /sm-test page
 * opens it. After a codex change, swap any unit reported missing for a similar one.
 */
export const WH40K_TYPICAL_SPACE_MARINES = {
  detachment: 'Gladius Task Force',
  enhancements: ['Adept of the Codex'],
  units: [
    'Captain In Terminator Armour', // 90
    'Lieutenant', // 50
    'Librarian', // 75
    'Chaplain', // 60
    'Apothecary', // 45
    'Intercessor Squad', // 170 (10)
    'Assault Intercessor Squad', // 170 (10)
    'Terminator Squad', // 190 (5)
    'Hellblaster Squad', // 115 (5)
    'Bladeguard Veteran Squad', // 180 (6)
    'Infiltrator Squad', // 85 (5)
    'Inceptor Squad', // 130 (3)
    'Scout Squad', // 65 (5)
    'Redemptor Dreadnought', // 170
    'Ballistus Dreadnought', // 150
    'Gladiator Lancer', // 160
    'Impulsor', // 70
  ],
}

export const typicalSpaceMarineArmy = (catalog: Wh40kCatalog): Wh40kArmyDocument => {
  const { detachment: detachmentName, enhancements, units } = WH40K_TYPICAL_SPACE_MARINES
  const detachment = catalog.detachments.find(
    item => item.factionId === 'SM' && item.name === detachmentName && item.gameMode === 'matched-play'
  )
  const sheets = units.map(name =>
    catalog.datasheets.find(
      item => item.factionId === 'SM' && item.context === 'current' && item.name === name
    )
  )
  const picked = enhancements.map(name =>
    catalog.rules.find(
      rule =>
        rule.kind === 'enhancement' &&
        rule.name === name &&
        rule.scope.kind === 'detachment' &&
        rule.scope.detachmentId === detachment?.id
    )
  )
  const missing = [
    ...(detachment ? [] : [detachmentName]),
    ...units.filter((_, index) => !sheets[index]),
    ...enhancements.filter((_, index) => !picked[index]),
  ]
  if (missing.length) {
    throw new Error(
      `The typical Space Marines army needs updating; not in the catalog: ${missing.join(', ')}`
    )
  }
  return {
    ...createWh40kArmyDocument(catalog, 'SM'),
    detachmentId: detachment!.id,
    datasheetIds: sheets.map(sheet => sheet!.sourceRecordId),
    enhancementIds: picked.map(rule => rule!.sourceRecordId),
  }
}
