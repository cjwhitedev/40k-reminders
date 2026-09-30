import type { SourceRecordId } from '../../../aos4/domain'
import { compareCodeUnits, type Wh40kWahapediaExportFile, type Wh40kWahapediaRecord } from './decode'

export type Wh40kSourceClassification =
  'current' | 'legends' | 'forge-world' | 'previous-edition' | 'unsourced' | 'unclassified'

// Source.csv carries no explicit context field; edition and publication name are the only signals.
export const classifyWahapediaSource = (
  source: Record<string, string> | undefined
): Wh40kSourceClassification => {
  if (!source) return 'unsourced'
  if (source.edition === '11') return 'current'
  if (source.edition === '10') return 'previous-edition'
  if (source.edition === '0' && source.name.endsWith('(Warhammer Legends)')) return 'legends'
  if (source.edition === '0' && source.name.endsWith('(Forge World)')) return 'forge-world'
  return 'unclassified'
}

export type Wh40kLinkDiagnosticCode =
  'dangling-reference' | 'ambiguous-reference' | 'missing-reference' | 'unclassified-source'

export interface Wh40kLinkDiagnostic {
  code: Wh40kLinkDiagnosticCode
  severity: 'error' | 'warning'
  file: Wh40kWahapediaExportFile
  line: number
  field: string
  value: string
  message: string
}

export interface Wh40kLinkedDatasheet {
  record: Wh40kWahapediaRecord
  classification: Wh40kSourceClassification
  models: Wh40kWahapediaRecord[]
  wargear: Wh40kWahapediaRecord[]
  abilities: Array<{ record: Wh40kWahapediaRecord; shared?: Wh40kWahapediaRecord }>
  keywords: Wh40kWahapediaRecord[]
  composition: Wh40kWahapediaRecord[]
  costs: Wh40kWahapediaRecord[]
  options: Wh40kWahapediaRecord[]
  /** Datasheets this leader can be attached to. */
  leads: SourceRecordId[]
  stratagems: SourceRecordId[]
  enhancements: SourceRecordId[]
  detachmentAbilities: SourceRecordId[]
}

export interface Wh40kWahapediaLinkedDataset {
  status: 'blocked' | 'candidate-review-required'
  datasheets: Wh40kLinkedDatasheet[]
  diagnostics: Wh40kLinkDiagnostic[]
}

type Records = Record<Wh40kWahapediaExportFile, Wh40kWahapediaRecord[]>

interface Reference {
  from: Wh40kWahapediaExportFile
  field: string
  to: Wh40kWahapediaExportFile
  /** A blank value means "none" (e.g. a core stratagem has no faction), not a broken link. */
  nullable?: boolean
}

const REFERENCES: Reference[] = [
  { from: 'Abilities.csv', field: 'faction_id', to: 'Factions.csv', nullable: true },
  { from: 'Datasheets.csv', field: 'faction_id', to: 'Factions.csv' },
  { from: 'Datasheets.csv', field: 'source_id', to: 'Source.csv' },
  { from: 'Detachment_abilities.csv', field: 'faction_id', to: 'Factions.csv' },
  { from: 'Detachment_abilities.csv', field: 'detachment_id', to: 'Detachments.csv' },
  { from: 'Detachments.csv', field: 'faction_id', to: 'Factions.csv' },
  { from: 'Detachments_chapter_dp.csv', field: 'detachment_id', to: 'Detachments.csv' },
  { from: 'Enhancements.csv', field: 'faction_id', to: 'Factions.csv' },
  { from: 'Enhancements.csv', field: 'detachment_id', to: 'Detachments.csv' },
  { from: 'Stratagems.csv', field: 'faction_id', to: 'Factions.csv', nullable: true },
  { from: 'Stratagems.csv', field: 'detachment_id', to: 'Detachments.csv', nullable: true },
  {
    from: 'Datasheets_detachment_abilities.csv',
    field: 'detachment_ability_id',
    to: 'Detachment_abilities.csv',
  },
  { from: 'Datasheets_enhancements.csv', field: 'enhancement_id', to: 'Enhancements.csv' },
  { from: 'Datasheets_stratagems.csv', field: 'stratagem_id', to: 'Stratagems.csv' },
  { from: 'Datasheets_leader.csv', field: 'leader_id', to: 'Datasheets.csv' },
  { from: 'Datasheets_leader.csv', field: 'attached_id', to: 'Datasheets.csv' },
  ...(
    [
      'Datasheets_abilities.csv',
      'Datasheets_detachment_abilities.csv',
      'Datasheets_enhancements.csv',
      'Datasheets_keywords.csv',
      'Datasheets_models.csv',
      'Datasheets_models_cost.csv',
      'Datasheets_options.csv',
      'Datasheets_stratagems.csv',
      'Datasheets_unit_composition.csv',
      'Datasheets_wargear.csv',
    ] as const
  ).map(from => ({ from, field: 'datasheet_id', to: 'Datasheets.csv' as const })),
]

const indexById = (records: Wh40kWahapediaRecord[]): Map<string, Wh40kWahapediaRecord> =>
  new Map(records.map(record => [record.values.id, record]))

const groupBy = (records: Wh40kWahapediaRecord[], field: string): Map<string, Wh40kWahapediaRecord[]> => {
  const groups = new Map<string, Wh40kWahapediaRecord[]>()
  for (const record of records) {
    const group = groups.get(record.values[field]) ?? []
    group.push(record)
    groups.set(record.values[field], group)
  }
  return groups
}

export const linkWh40kWahapediaRecords = (records: Records): Wh40kWahapediaLinkedDataset => {
  const diagnostics: Wh40kLinkDiagnostic[] = []
  const diagnose = (
    code: Wh40kLinkDiagnosticCode,
    severity: Wh40kLinkDiagnostic['severity'],
    record: Wh40kWahapediaRecord,
    field: string,
    message: string
  ) =>
    diagnostics.push({
      code,
      severity,
      file: record.file,
      line: record.line,
      field,
      value: record.values[field],
      message: `${record.file} line ${record.line}: ${message}`,
    })

  const ids = new Map<Wh40kWahapediaExportFile, Set<string>>()
  const idsOf = (file: Wh40kWahapediaExportFile): Set<string> => {
    const cached = ids.get(file)
    if (cached) return cached
    const created = new Set(records[file].map(record => record.values.id))
    ids.set(file, created)
    return created
  }
  for (const reference of REFERENCES) {
    for (const record of records[reference.from]) {
      const value = record.values[reference.field]
      if (!value) {
        if (!reference.nullable) {
          diagnose('missing-reference', 'error', record, reference.field, `${reference.field} is blank`)
        }
      } else if (!idsOf(reference.to).has(value)) {
        diagnose(
          'dangling-reference',
          'error',
          record,
          reference.field,
          `${reference.field}=${value} has no ${reference.to} record`
        )
      }
    }
  }

  const sources = indexById(records['Source.csv'])
  const abilitiesById = groupBy(records['Abilities.csv'], 'id')
  const byDatasheet = (file: Wh40kWahapediaExportFile) => groupBy(records[file], 'datasheet_id')
  const children = {
    abilities: byDatasheet('Datasheets_abilities.csv'),
    detachmentAbilities: byDatasheet('Datasheets_detachment_abilities.csv'),
    enhancements: byDatasheet('Datasheets_enhancements.csv'),
    keywords: byDatasheet('Datasheets_keywords.csv'),
    models: byDatasheet('Datasheets_models.csv'),
    costs: byDatasheet('Datasheets_models_cost.csv'),
    options: byDatasheet('Datasheets_options.csv'),
    stratagems: byDatasheet('Datasheets_stratagems.csv'),
    composition: byDatasheet('Datasheets_unit_composition.csv'),
    wargear: byDatasheet('Datasheets_wargear.csv'),
    leads: groupBy(records['Datasheets_leader.csv'], 'leader_id'),
  }
  const idToRecordId = (file: Wh40kWahapediaExportFile) => {
    const index = indexById(records[file])
    return (id: string) => index.get(id)?.sourceRecordId
  }
  const datasheetRecordId = idToRecordId('Datasheets.csv')
  const stratagemRecordId = idToRecordId('Stratagems.csv')
  const enhancementRecordId = idToRecordId('Enhancements.csv')
  const detachmentAbilityRecordId = idToRecordId('Detachment_abilities.csv')
  const resolved = (ids: Array<SourceRecordId | undefined>): SourceRecordId[] =>
    ids.filter((id): id is SourceRecordId => Boolean(id))

  const datasheets = [...records['Datasheets.csv']]
    .sort((left, right) => compareCodeUnits(left.values.id, right.values.id))
    .map((record): Wh40kLinkedDatasheet => {
      const id = record.values.id
      const source = sources.get(record.values.source_id)
      const classification = classifyWahapediaSource(record.values.source_id ? source?.values : undefined)
      if (classification === 'unclassified') {
        diagnose(
          'unclassified-source',
          'warning',
          record,
          'source_id',
          `source ${JSON.stringify(source?.values.name)} (edition ${source?.values.edition}) has no classification rule`
        )
      }

      const abilities = (children.abilities.get(id) ?? []).map(ability => {
        const sharedId = ability.values.ability_id
        if (!sharedId) return { record: ability }
        const candidates = abilitiesById.get(sharedId) ?? []
        const factionMatches = candidates.filter(
          shared => shared.values.faction_id === record.values.faction_id
        )
        const universal = candidates.filter(shared => !shared.values.faction_id)
        const matches = factionMatches.length ? factionMatches : universal.length ? universal : candidates
        if (matches.length !== 1) {
          diagnose(
            'ambiguous-reference',
            'error',
            ability,
            'ability_id',
            `ability_id=${sharedId} matches ${matches.length} Abilities.csv records for faction ${record.values.faction_id}`
          )
          return { record: ability }
        }
        return { record: ability, shared: matches[0] }
      })

      return {
        record,
        classification,
        models: children.models.get(id) ?? [],
        wargear: children.wargear.get(id) ?? [],
        abilities,
        keywords: children.keywords.get(id) ?? [],
        composition: children.composition.get(id) ?? [],
        costs: children.costs.get(id) ?? [],
        options: children.options.get(id) ?? [],
        leads: resolved(
          (children.leads.get(id) ?? []).map(lead => datasheetRecordId(lead.values.attached_id))
        ),
        stratagems: resolved(
          (children.stratagems.get(id) ?? []).map(link => stratagemRecordId(link.values.stratagem_id))
        ),
        enhancements: resolved(
          (children.enhancements.get(id) ?? []).map(link => enhancementRecordId(link.values.enhancement_id))
        ),
        detachmentAbilities: resolved(
          (children.detachmentAbilities.get(id) ?? []).map(link =>
            detachmentAbilityRecordId(link.values.detachment_ability_id)
          )
        ),
      }
    })

  diagnostics.sort(
    (left, right) =>
      compareCodeUnits(left.file, right.file) ||
      left.line - right.line ||
      compareCodeUnits(left.field, right.field) ||
      compareCodeUnits(left.code, right.code)
  )
  return {
    status: diagnostics.some(diagnostic => diagnostic.severity === 'error')
      ? 'blocked'
      : 'candidate-review-required',
    datasheets,
    diagnostics,
  }
}
