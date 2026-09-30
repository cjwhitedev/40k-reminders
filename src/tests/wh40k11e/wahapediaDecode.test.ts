import { describe, expect, it } from 'vitest'
import {
  decodeWh40kWahapediaExports,
  WH40K_WAHAPEDIA_EXPORT_FILES,
  WH40K_WAHAPEDIA_EXPORTS,
  type Wh40kWahapediaExportFile,
  type Wh40kWahapediaExportInputs,
} from '../../wh40k11e/data/wahapedia/decode'

const csv = (file: Wh40kWahapediaExportFile, rows: string[]): string =>
  `\uFEFF${[`${WH40K_WAHAPEDIA_EXPORTS[file].headers.join('|')}|`, ...rows].join('\r\n')}\r\n`

const inputs = (overrides: Partial<Record<Wh40kWahapediaExportFile, string>>): Wh40kWahapediaExportInputs =>
  Object.fromEntries(
    WH40K_WAHAPEDIA_EXPORT_FILES.map((file, index) => [
      file,
      {
        bytes: new TextEncoder().encode(overrides[file] ?? csv(file, [])),
        checksum: index.toString(16).padStart(64, '0'),
      },
    ])
  )

const codes = (result: ReturnType<typeof decodeWh40kWahapediaExports>) =>
  result.diagnostics.map(diagnostic => `${diagnostic.file}:${diagnostic.code}`)

describe('decodeWh40kWahapediaExports', () => {
  it('rejoins a record whose field held a raw line break, keeping its first line and raw bytes', () => {
    const result = decodeWh40kWahapediaExports(
      inputs({
        'Stratagems.csv': csv('Stratagems.csv', [
          'AdM|TARGETERS|000010748005|Wargear Stratagem|1|Routines identify targets for',
          'rapid elimination. |Your turn|Shooting phase|Eradication Cohort|000001143|<b>WHEN:</b> Shooting.|',
        ]),
      })
    )

    expect(result.status).toBe('candidate-review-required')
    expect(result.records['Stratagems.csv']).toHaveLength(1)
    expect(result.records['Stratagems.csv'][0]).toMatchObject({
      line: 2,
      values: { legend: 'Routines identify targets for\nrapid elimination. ', phase: 'Shooting phase' },
      sourceRecordId: 'source-record:wahapedia-wh40k11e:Stratagems.csv%3A000010748005',
    })
  })

  it('keys shared abilities by faction and accepts universal abilities with no faction', () => {
    const result = decodeWh40kWahapediaExports(
      inputs({
        'Abilities.csv': csv('Abilities.csv', [
          '000000705|Synapse||GC|Text.|',
          '000000705|Synapse||TYR|Text.|',
          '000000100|Deep Strike|||Text.|',
        ]),
      })
    )

    expect(result.status).toBe('candidate-review-required')
    expect(result.records['Abilities.csv'].map(record => record.values.faction_id)).toEqual(['GC', 'TYR', ''])
  })

  it('drops byte-identical repeats with a warning but blocks on conflicting records', () => {
    const result = decodeWh40kWahapediaExports(
      inputs({
        'Datasheets_leader.csv': csv('Datasheets_leader.csv', [
          '000000001|000000002|',
          '000000001|000000002|',
        ]),
        'Factions.csv': csv('Factions.csv', ['AM|Astra Militarum|a|', 'AM|Astra Militarum|b|']),
      })
    )

    expect(result.status).toBe('blocked')
    expect(result.records['Datasheets_leader.csv']).toHaveLength(1)
    expect(codes(result)).toEqual([
      'Datasheets_leader.csv:duplicate-identical-record',
      'Factions.csv:duplicate-record-key',
    ])
  })

  it('ignores empty wargear and keyword placeholders and keys wargear rows whose line is blank', () => {
    const result = decodeWh40kWahapediaExports(
      inputs({
        'Datasheets_keywords.csv': csv('Datasheets_keywords.csv', [
          '000000568|||true|',
          '000000568|Infantry||false|',
        ]),
        'Datasheets_wargear.csv': csv('Datasheets_wargear.csv', [
          '000000087||1||||||0|-|-|0|-|',
          '000003582||1||Bolt pistol|pistol|12|Ranged|1|4|4|0|1|',
          '000003582||1||Khornate eviscerator||Melee|Melee|3|3|8|-2|2|',
        ]),
      })
    )

    expect(result.status).toBe('candidate-review-required')
    expect(result.records['Datasheets_wargear.csv'].map(record => record.values.name)).toEqual([
      'Bolt pistol',
      'Khornate eviscerator',
    ])
    expect(result.records['Datasheets_keywords.csv'].map(record => record.values.keyword)).toEqual([
      'Infantry',
    ])
    expect(codes(result)).toEqual([
      'Datasheets_keywords.csv:empty-placeholder-record',
      'Datasheets_wargear.csv:empty-placeholder-record',
    ])
  })

  it('blocks on header drift and on a missing export', () => {
    const drifted = inputs({ 'Factions.csv': '\uFEFFid|name|url|\r\nAM|Astra Militarum|x|\r\n' })
    delete drifted['Source.csv']
    const result = decodeWh40kWahapediaExports(drifted)

    expect(result.status).toBe('blocked')
    expect(codes(result)).toEqual(['Factions.csv:header-drift', 'Source.csv:missing-export'])
  })
})
