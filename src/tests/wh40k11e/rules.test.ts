import { describe, expect, it } from 'vitest'
import { artifactId, sourceRecordId, type SourceRecordId } from '../../aos4/domain'
import type { Wh40kReviewedSources } from '../../wh40k11e/data/review'
import { buildWh40kRules } from '../../wh40k11e/data/rules'
import {
  WH40K_WAHAPEDIA_EXPORT_FILES,
  WH40K_WAHAPEDIA_EXPORTS,
  type Wh40kWahapediaExportFile,
  type Wh40kWahapediaRecord,
} from '../../wh40k11e/data/wahapedia/decode'
import type { Wh40kLinkedDatasheet } from '../../wh40k11e/data/wahapedia/link'

const record = (
  file: Wh40kWahapediaExportFile,
  key: string,
  values: Record<string, string>
): Wh40kWahapediaRecord => {
  const headers: readonly string[] = WH40K_WAHAPEDIA_EXPORTS[file].headers
  return {
    file,
    line: 2,
    values: Object.fromEntries(headers.map(header => [header, values[header] ?? ''])),
    artifactId: artifactId('0'.repeat(64)),
    sourceRecordId: sourceRecordId('test', `${file}:${key}`),
    recordChecksum: '0'.repeat(64),
  }
}

const when = (clause: string) => `<b>WHEN:</b> ${clause}<br><b>EFFECT:</b> Something happens.`

const records = {
  ...Object.fromEntries(WH40K_WAHAPEDIA_EXPORT_FILES.map(file => [file, []])),
  'Stratagems.csv': [
    record('Stratagems.csv', 'core', {
      id: 'S1',
      name: 'COMMAND RE-ROLL',
      cp_cost: '1',
      description: when('Any phase.'),
    }),
    record('Stratagems.csv', 'det', {
      id: 'S2',
      name: 'ARMOUR OF CONTEMPT',
      faction_id: 'SM',
      detachment_id: 'D1',
      cp_cost: '1',
      description: when('Your opponent’s Shooting phase.'),
    }),
    record('Stratagems.csv', 'boarding', {
      id: 'S3',
      name: 'BREACH',
      faction_id: 'SM',
      detachment_id: 'D2',
      cp_cost: '2',
      description: when('Your Movement phase.'),
    }),
    record('Stratagems.csv', 'typo', {
      id: 'S4',
      name: 'TYPO',
      faction_id: 'SM',
      detachment_id: 'D1',
      cp_cost: '1',
      description: when('Your opponents Charge phase.'),
    }),
    record('Stratagems.csv', 'move', {
      id: 'S5',
      name: 'NORMAL MOVE',
      type: 'Movement Ability',
      description: 'MAXIMUM DISTANCE: M.',
    }),
  ],
  'Detachments.csv': [
    record('Detachments.csv', 'd1', { id: 'D1', name: 'Gladius', faction_id: 'SM' }),
    record('Detachments.csv', 'd2', {
      id: 'D2',
      name: 'Boarding Strike',
      faction_id: 'SM',
      type: 'Boarding Actions',
    }),
  ],
  'Abilities.csv': [
    record('Abilities.csv', 'oath', {
      id: 'A1',
      name: 'Oath of Moment',
      faction_id: 'SM',
      description:
        'If your Army Faction is ADEPTUS ASTARTES, at the start of your Command phase, select one enemy unit.',
    }),
    record('Abilities.csv', 'fnp', { id: 'A2', name: 'Feel No Pain', description: 'FEEL NO PAIN 24.12' }),
  ],
  'Enhancements.csv': [
    record('Enhancements.csv', 'e1', {
      id: 'E1',
      name: 'Artificer Armour',
      faction_id: 'SM',
      detachment_id: 'D1',
      cost: '10',
      description: 'Adeptus Astartes model only. The bearer has a 2+ Save.',
    }),
  ],
} as unknown as Record<Wh40kWahapediaExportFile, Wh40kWahapediaRecord[]>

const datasheetId = sourceRecordId('test', 'Datasheets.csv:captain')
const sheet = {
  record: record('Datasheets.csv', 'captain', { id: 'DS1', name: 'Captain', faction_id: 'SM' }),
  abilities: [
    {
      record: record('Datasheets_abilities.csv', 'own', {
        datasheet_id: 'DS1',
        line: '1',
        name: 'Rites of Battle',
        description: 'Once per battle round, in your Command phase, gain 1CP.',
      }),
    },
    {
      record: record('Datasheets_abilities.csv', 'shared', {
        datasheet_id: 'DS1',
        line: '2',
        ability_id: 'A1',
      }),
      shared: records['Abilities.csv'][0],
    },
  ],
} as unknown as Wh40kLinkedDatasheet

const reviewed = (overrides: Partial<Wh40kReviewedSources> = {}) =>
  ({
    status: 'reviewed',
    findings: [],
    dispositions: [],
    excludedSourceRecordIds: [],
    armyRuleSourceRecordIds: [],
    classificationOverrides: [],
    timingOverrides: new Map([
      [
        records['Abilities.csv'][1].sourceRecordId,
        { id: 'core-fnp', sourceRecordIds: [], kind: 'reaction', reason: 'Core Rules 24.12' },
      ],
    ]),
    ignoredSourceRecordIds: [records['Stratagems.csv'][4].sourceRecordId],
    datasheetContexts: new Map<SourceRecordId, 'current'>([[datasheetId, 'current']]),
    contexts: { current: 1, legends: 0, 'forge-world': 0, excluded: 0 },
    ...overrides,
  }) as Wh40kReviewedSources

describe('buildWh40kRules', () => {
  const { rules, unresolved } = buildWh40kRules(
    records,
    { status: 'reviewed' as never, datasheets: [sheet], diagnostics: [] },
    reviewed()
  )
  const byName = (name: string) => rules.find(rule => rule.name === name)!

  it('scopes stratagems and marks Boarding Actions detachments as their own game mode', () => {
    expect(byName('Command Re-Roll')).toMatchObject({
      kind: 'core-stratagem',
      scope: { kind: 'all-armies' },
      cost: { kind: 'command-points', value: 1 },
    })
    expect(byName('Armour Of Contempt')).toMatchObject({
      kind: 'stratagem',
      scope: { kind: 'detachment', detachmentId: 'D1' },
      gameMode: 'matched-play',
    })
    expect(byName('Breach').gameMode).toBe('boarding-actions')
  })

  it('reads army-faction conditions, enhancement eligibility and cost, and reviewed core timing', () => {
    expect(byName('Oath of Moment')).toMatchObject({
      kind: 'army-rule',
      armyFaction: 'ADEPTUS ASTARTES',
      timingKind: 'timed',
      timingSource: 'printed',
    })
    expect(byName('Oath of Moment').condition).toBeUndefined()
    expect(byName('Artificer Armour')).toMatchObject({
      kind: 'enhancement',
      condition: 'Adeptus Astartes model only',
      cost: { kind: 'points', value: 10 },
      timingKind: 'passive',
    })
    expect(byName('Feel No Pain')).toMatchObject({
      kind: 'core-ability',
      timingKind: 'reaction',
      timingSource: 'reviewed',
    })
  })

  it('builds only a datasheet’s own abilities, leaves ignored records out, and lists unresolved timing', () => {
    expect(byName('Rites of Battle')).toMatchObject({
      kind: 'datasheet-ability',
      scope: { kind: 'datasheet', datasheetId },
      timing: { usage: { period: 'battle-round' } },
    })
    expect(rules.filter(rule => rule.scope.kind === 'datasheet')).toHaveLength(1)
    expect(rules.some(rule => rule.name === 'Normal Move')).toBe(false)
    expect(unresolved.map(item => item.name)).toEqual(['Typo'])
  })
})
