import type { SourceRecordId } from '../../aos4/domain'
import type { BsDataCatalogueIndex } from './bsdata/catalogues'
import type { Wh40kSourceClassification, Wh40kWahapediaLinkedDataset } from './wahapedia/link'
import { compareCodeUnits } from './wahapedia/decode'

export interface Wh40kFactionMap {
  schemaVersion: 1
  bsdataCommit: string
  factions: Array<{ wahapediaFactionId: string; bsdataCatalogues: Array<{ id: string; name: string }> }>
}

export type Wh40kUnitMatchOutcome = 'matched' | 'wahapedia-only' | 'bsdata-only' | 'ambiguous'

export interface Wh40kUnitComparison {
  factionId: string
  normalizedName: string
  outcome: Wh40kUnitMatchOutcome
  wahapedia: Array<{
    sourceRecordId: SourceRecordId
    name: string
    classification: Wh40kSourceClassification
  }>
  /** BSData bracket suffixes such as `[Legends]` are provenance tags, kept here rather than in the name. */
  bsdata: Array<{ id: string; name: string; type: string | null; tag: string | null }>
}

export interface Wh40kSourceComparison {
  schemaVersion: 1
  status: 'candidate-review-required'
  totals: Record<Wh40kUnitMatchOutcome, number>
  factions: Array<{ factionId: string; totals: Record<Wh40kUnitMatchOutcome, number> }>
  units: Wh40kUnitComparison[]
}

const TAG_PATTERN = /\s*\[([^\]]+)\]\s*$/

// Names are display text; this key only proposes candidate matches for review, never identity.
export const normalizeUnitName = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[‘’`]/g, "'")
    .replace(/[–—‑]/g, '-')
    .replace(TAG_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

const emptyTotals = (): Record<Wh40kUnitMatchOutcome, number> => ({
  matched: 0,
  'wahapedia-only': 0,
  'bsdata-only': 0,
  ambiguous: 0,
})

const UNIT_TYPES = new Set(['unit', 'model'])

export const compareWh40kSources = (
  wahapedia: Wh40kWahapediaLinkedDataset,
  bsdata: BsDataCatalogueIndex,
  factionMap: Wh40kFactionMap
): Wh40kSourceComparison => {
  const units: Wh40kUnitComparison[] = []
  const factions: Wh40kSourceComparison['factions'] = []

  for (const faction of [...factionMap.factions].sort((left, right) =>
    compareCodeUnits(left.wahapediaFactionId, right.wahapediaFactionId)
  )) {
    const catalogueIds = new Set(faction.bsdataCatalogues.map(catalogue => catalogue.id))
    const byName = new Map<string, Pick<Wh40kUnitComparison, 'wahapedia' | 'bsdata'>>()
    const entry = (key: string) => {
      const existing = byName.get(key)
      if (existing) return existing
      const created = { wahapedia: [], bsdata: [] }
      byName.set(key, created)
      return created
    }

    for (const sheet of wahapedia.datasheets) {
      if (
        sheet.record.values.faction_id !== faction.wahapediaFactionId ||
        sheet.record.values.virtual === 'true'
      )
        continue
      entry(normalizeUnitName(sheet.record.values.name)).wahapedia.push({
        sourceRecordId: sheet.record.sourceRecordId,
        name: sheet.record.values.name,
        classification: sheet.classification,
      })
    }

    // Only entries the faction defines itself: imported allies belong to their own faction's row.
    const seenTargets = new Set<string>()
    for (const selection of bsdata.selections) {
      if (
        !catalogueIds.has(selection.catalogueId) ||
        !catalogueIds.has(selection.sourceCatalogueId) ||
        !UNIT_TYPES.has(selection.definitionType ?? '') ||
        seenTargets.has(selection.targetId)
      ) {
        continue
      }
      seenTargets.add(selection.targetId)
      entry(normalizeUnitName(selection.definitionName)).bsdata.push({
        id: selection.targetId,
        name: selection.definitionName,
        type: selection.definitionType,
        tag: selection.definitionName.match(TAG_PATTERN)?.[1] ?? null,
      })
    }

    const totals = emptyTotals()
    for (const [normalizedName, sides] of Array.from(byName)) {
      const outcome: Wh40kUnitMatchOutcome =
        sides.wahapedia.length > 1 || sides.bsdata.length > 1
          ? 'ambiguous'
          : sides.wahapedia.length && sides.bsdata.length
            ? 'matched'
            : sides.wahapedia.length
              ? 'wahapedia-only'
              : 'bsdata-only'
      totals[outcome] += 1
      units.push({
        factionId: faction.wahapediaFactionId,
        normalizedName,
        outcome,
        wahapedia: [...sides.wahapedia].sort((left, right) =>
          compareCodeUnits(left.sourceRecordId, right.sourceRecordId)
        ),
        bsdata: [...sides.bsdata].sort((left, right) => compareCodeUnits(left.id, right.id)),
      })
    }
    factions.push({ factionId: faction.wahapediaFactionId, totals })
  }

  units.sort(
    (left, right) =>
      compareCodeUnits(left.factionId, right.factionId) ||
      compareCodeUnits(left.normalizedName, right.normalizedName)
  )
  const totals = emptyTotals()
  for (const unit of units) totals[unit.outcome] += 1
  return { schemaVersion: 1, status: 'candidate-review-required', totals, factions, units }
}
