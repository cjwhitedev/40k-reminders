import { describe, expect, it } from 'vitest'
import { artifactId, sourceRecordId } from '../../aos4/domain'
import {
  WH40K_WAHAPEDIA_EXPORT_FILES,
  WH40K_WAHAPEDIA_EXPORTS,
  type Wh40kWahapediaExportFile,
  type Wh40kWahapediaRecord,
} from '../../wh40k11e/data/wahapedia/decode'
import { classifyWahapediaSource, linkWh40kWahapediaRecords } from '../../wh40k11e/data/wahapedia/link'

let line = 1
const record = (file: Wh40kWahapediaExportFile, values: Record<string, string>): Wh40kWahapediaRecord => {
  const headers: readonly string[] = WH40K_WAHAPEDIA_EXPORTS[file].headers
  const full = Object.fromEntries(headers.map(header => [header, values[header] ?? '']))
  line += 1
  return {
    file,
    line,
    values: full,
    artifactId: artifactId('0'.repeat(64)),
    sourceRecordId: sourceRecordId('test', `${file}:${line}`),
    recordChecksum: '0'.repeat(64),
  }
}

const dataset = (rows: Wh40kWahapediaRecord[]) =>
  Object.fromEntries(
    WH40K_WAHAPEDIA_EXPORT_FILES.map(file => [file, rows.filter(row => row.file === file)])
  ) as Record<Wh40kWahapediaExportFile, Wh40kWahapediaRecord[]>

const base = [
  record('Factions.csv', { id: 'TYR', name: 'Tyranids' }),
  record('Factions.csv', { id: 'GC', name: 'Genestealer Cults' }),
  record('Source.csv', { id: 'S11', name: 'Tyranids', edition: '11' }),
  record('Datasheets.csv', { id: 'D1', name: 'Hive Tyrant', faction_id: 'TYR', source_id: 'S11' }),
  record('Datasheets.csv', { id: 'D2', name: 'Termagants', faction_id: 'TYR', source_id: 'S11' }),
]

describe('classifyWahapediaSource', () => {
  it('classifies by edition and publication name, and never guesses', () => {
    expect(classifyWahapediaSource({ edition: '11', name: 'Tyranids' })).toBe('current')
    expect(classifyWahapediaSource({ edition: '10', name: 'Deathwatch' })).toBe('previous-edition')
    expect(classifyWahapediaSource({ edition: '0', name: 'Orks (Warhammer Legends)' })).toBe('legends')
    expect(classifyWahapediaSource({ edition: '0', name: 'Orks (Forge World)' })).toBe('forge-world')
    expect(classifyWahapediaSource({ edition: '0', name: 'Orks' })).toBe('unclassified')
    expect(classifyWahapediaSource(undefined)).toBe('unsourced')
  })
})

describe('linkWh40kWahapediaRecords', () => {
  it('links a datasheet to its children, leader targets, and faction-matched shared ability', () => {
    const linked = linkWh40kWahapediaRecords(
      dataset([
        ...base,
        record('Abilities.csv', { id: 'A1', name: 'Synapse', faction_id: 'GC' }),
        record('Abilities.csv', { id: 'A1', name: 'Synapse', faction_id: 'TYR' }),
        record('Abilities.csv', { id: 'A2', name: 'Deep Strike' }),
        record('Datasheets_abilities.csv', { datasheet_id: 'D1', line: '1', ability_id: 'A1' }),
        record('Datasheets_abilities.csv', { datasheet_id: 'D1', line: '2', ability_id: 'A2' }),
        record('Datasheets_abilities.csv', { datasheet_id: 'D1', line: '3', name: 'Will of the Hive Mind' }),
        record('Datasheets_models.csv', { datasheet_id: 'D1', line: '1', name: 'Hive Tyrant' }),
        record('Datasheets_leader.csv', { leader_id: 'D1', attached_id: 'D2' }),
      ])
    )

    expect(linked.status).toBe('candidate-review-required')
    const tyrant = linked.datasheets.find(sheet => sheet.record.values.id === 'D1')!
    expect(tyrant.classification).toBe('current')
    expect(tyrant.models).toHaveLength(1)
    expect(
      tyrant.abilities.map(ability => ability.shared?.values.faction_id ?? ability.record.values.name)
    ).toEqual(['TYR', '', 'Will of the Hive Mind'])
    expect(tyrant.leads).toEqual([base[4].sourceRecordId])
  })

  it('blocks on dangling and missing references but allows blank nullable ones', () => {
    const linked = linkWh40kWahapediaRecords(
      dataset([
        ...base,
        record('Datasheets.csv', { id: 'D3', name: 'Unsourced', faction_id: 'TYR' }),
        record('Datasheets_wargear.csv', { datasheet_id: 'GONE', name: 'Lascannon', type: 'Ranged' }),
        record('Stratagems.csv', { id: 'ST1', name: 'Core stratagem' }),
        record('Stratagems.csv', {
          id: 'ST2',
          name: 'Army stratagem',
          faction_id: 'TYR',
          detachment_id: 'NOPE',
        }),
      ])
    )

    expect(linked.status).toBe('blocked')
    expect(
      linked.diagnostics.map(diagnostic => `${diagnostic.code} ${diagnostic.field}=${diagnostic.value}`)
    ).toEqual([
      'missing-reference source_id=',
      'dangling-reference datasheet_id=GONE',
      'dangling-reference detachment_id=NOPE',
    ])
    expect(linked.datasheets.find(sheet => sheet.record.values.id === 'D3')?.classification).toBe('unsourced')
  })
})
