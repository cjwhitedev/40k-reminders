import type { Wh40kCatalog } from './rules'

/** Integrity problems that must keep a catalog out of runtime; an empty list means it is usable. */
export const validateWh40kCatalog = (catalog: Wh40kCatalog): string[] => {
  const problems: string[] = []
  const unique = (label: string, ids: string[]): Set<string> => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) problems.push(`duplicate ${label} ${id}`)
      seen.add(id)
    }
    return seen
  }
  const factions = unique(
    'faction',
    catalog.factions.map(item => item.id)
  )
  const detachments = unique(
    'detachment',
    catalog.detachments.map(item => item.id)
  )
  const datasheets = unique(
    'datasheet',
    catalog.datasheets.map(item => item.sourceRecordId)
  )
  const rules = unique(
    'rule',
    catalog.rules.map(item => item.sourceRecordId)
  )

  for (const detachment of catalog.detachments) {
    if (!factions.has(detachment.factionId))
      problems.push(`detachment ${detachment.id} names unknown faction ${detachment.factionId}`)
  }
  for (const datasheet of catalog.datasheets) {
    if (!factions.has(datasheet.factionId))
      problems.push(`datasheet ${datasheet.sourceRecordId} names unknown faction ${datasheet.factionId}`)
    for (const shared of datasheet.sharedRules) {
      if (!rules.has(shared.ruleId))
        problems.push(`datasheet ${datasheet.sourceRecordId} carries unknown rule ${shared.ruleId}`)
    }
  }
  for (const rule of catalog.rules) {
    const { scope } = rule
    if ((scope.kind === 'faction' || scope.kind === 'detachment') && !factions.has(scope.factionId))
      problems.push(`rule ${rule.sourceRecordId} names unknown faction ${scope.factionId}`)
    if (scope.kind === 'detachment' && !detachments.has(scope.detachmentId))
      problems.push(`rule ${rule.sourceRecordId} names unknown detachment ${scope.detachmentId}`)
    if (scope.kind === 'datasheet' && !datasheets.has(scope.datasheetId))
      problems.push(`rule ${rule.sourceRecordId} names unknown datasheet ${scope.datasheetId}`)
    if (rule.gameMode === 'matched-play' && rule.timingKind === 'unclassified')
      problems.push(`matched-play rule ${rule.sourceRecordId} has no reviewed timing`)
    if (rule.timingKind === 'timed' && !rule.timing?.windows.length)
      problems.push(`timed rule ${rule.sourceRecordId} has no window`)
  }
  return problems
}
