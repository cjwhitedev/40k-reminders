import { describe, expect, it } from 'vitest'
import { artifactId, sourceRecordId } from '../../aos4/domain'
import type { BsDataCatalogueIndex } from '../../wh40k11e/data/bsdata/catalogues'
import { compareWh40kSources, normalizeUnitName, type Wh40kFactionMap } from '../../wh40k11e/data/compare'
import type { Wh40kLinkedDatasheet, Wh40kWahapediaLinkedDataset } from '../../wh40k11e/data/wahapedia/link'

const sheet = (id: string, name: string, factionId: string, virtual = 'false'): Wh40kLinkedDatasheet => ({
  record: {
    file: 'Datasheets.csv',
    line: 2,
    values: { id, name, faction_id: factionId, virtual },
    artifactId: artifactId('0'.repeat(64)),
    sourceRecordId: sourceRecordId('test', id),
    recordChecksum: '0'.repeat(64),
  },
  classification: 'current',
  models: [],
  wargear: [],
  abilities: [],
  keywords: [],
  composition: [],
  costs: [],
  options: [],
  leads: [],
  stratagems: [],
  enhancements: [],
  detachmentAbilities: [],
})

const selection = (
  catalogueId: string,
  sourceCatalogueId: string,
  targetId: string,
  definitionName: string,
  definitionType = 'unit'
): BsDataCatalogueIndex['selections'][number] => ({
  catalogueId,
  catalogueName: catalogueId,
  sourceCatalogueId,
  linkId: `link-${targetId}`,
  linkName: definitionName,
  targetId,
  definitionCatalogueId: sourceCatalogueId,
  definitionCatalogueName: sourceCatalogueId,
  definitionName,
  definitionType,
  definitionPath: `${sourceCatalogueId}.json`,
  definitionChecksum: '0'.repeat(64),
})

const factionMap: Wh40kFactionMap = {
  schemaVersion: 1,
  bsdataCommit: '0'.repeat(40),
  factions: [
    {
      wahapediaFactionId: 'SM',
      bsdataCatalogues: [
        { id: 'sm', name: 'Space Marines' },
        { id: 'ba', name: 'Blood Angels' },
      ],
    },
  ],
}

describe('normalizeUnitName', () => {
  it('folds typography and strips a trailing provenance tag, but not spelling', () => {
    expect(normalizeUnitName('Watch Captain  Artemis')).toBe('watch captain artemis')
    expect(normalizeUnitName('Martial Ka’tah [Legends]')).toBe("martial ka'tah")
    expect(normalizeUnitName('Hell Blade')).not.toBe(normalizeUnitName('Hellblade'))
  })
})

describe('compareWh40kSources', () => {
  it('matches by faction, dedupes units offered by several catalogues, and ignores imported allies', () => {
    const wahapedia: Wh40kWahapediaLinkedDataset = {
      status: 'candidate-review-required',
      diagnostics: [],
      datasheets: [
        sheet('1', 'Intercessor Squad', 'SM'),
        sheet('2', 'Tarantula Air Defence Battery', 'SM'),
        sheet('3', 'Example Wargear', 'SM', 'true'),
        sheet('4', 'Termagants', 'TYR'),
      ],
    }
    const bsdata = {
      selections: [
        selection('sm', 'sm', 'u-int', 'Intercessor Squad'),
        selection('ba', 'sm', 'u-int', 'Intercessor Squad'),
        selection('sm', 'sm', 'u-tar', 'Tarantula Air Defense Battery [Legends]'),
        selection('sm', 'agents', 'u-inq', 'Inquisitor'),
        selection('sm', 'sm', 'u-opt', 'Show/Hide Options', 'upgrade'),
      ],
    } as BsDataCatalogueIndex

    const result = compareWh40kSources(wahapedia, bsdata, factionMap)

    expect(result.totals).toEqual({ matched: 1, 'wahapedia-only': 1, 'bsdata-only': 1, ambiguous: 0 })
    expect(
      result.units.map(unit => [unit.normalizedName, unit.outcome, unit.bsdata.map(entry => entry.tag)])
    ).toEqual([
      ['intercessor squad', 'matched', [null]],
      ['tarantula air defence battery', 'wahapedia-only', []],
      ['tarantula air defense battery', 'bsdata-only', ['Legends']],
    ])
  })
})
