import { describe, expect, it } from 'vitest'
import { sourceRecordId, type SourceRecordId } from '../../aos4/domain'
import type { Wh40kCatalog, Wh40kRule } from '../../wh40k11e/domain/rules'
import { groupWh40kReminders, projectWh40kReminders } from '../../wh40k11e/reminders/projectReminders'
import { selectWh40kRules } from '../../wh40k11e/select/selectRules'

const id = (key: string): SourceRecordId => sourceRecordId('test', key)

const rule = (key: string, overrides: Partial<Wh40kRule>): Wh40kRule => ({
  sourceRecordId: id(key),
  kind: 'datasheet-ability',
  name: key,
  text: `${key} text`,
  scope: { kind: 'all-armies' },
  gameMode: 'matched-play',
  timingKind: 'passive',
  timingSource: 'printed',
  ...overrides,
})

const phase = (
  phase: 'command' | 'shooting' | 'fight',
  perspective: 'your' | 'opponent' | 'either' = 'your'
) => ({
  kind: 'turn-phase' as const,
  phase,
  moment: 'during' as const,
  perspective,
})

const catalog: Wh40kCatalog = {
  factions: [{ id: 'SM', name: 'Space Marines' }],
  detachments: [
    { id: 'D1', name: 'Gladius', factionId: 'SM', gameMode: 'matched-play' },
    { id: 'D2', name: 'Boarding Strike', factionId: 'SM', gameMode: 'boarding-actions' },
  ],
  datasheets: [
    {
      sourceRecordId: id('captain'),
      name: 'Captain',
      factionId: 'SM',
      context: 'current',
      sharedRules: [{ ruleId: id('oath') }, { ruleId: id('fnp'), parameter: '5+' }],
    },
    {
      sourceRecordId: id('lieutenant'),
      name: 'Lieutenant',
      factionId: 'SM',
      context: 'current',
      sharedRules: [{ ruleId: id('oath') }],
    },
    { sourceRecordId: id('old'), name: 'Legends Hero', factionId: 'SM', context: 'legends', sharedRules: [] },
  ],
  rules: [
    rule('command-reroll', {
      kind: 'core-stratagem',
      name: 'Command Re-roll',
      timingKind: 'timed',
      timing: {
        windows: [{ kind: 'any-phase', moments: ['during'], perspective: 'either' }],
        raw: 'Any phase.',
      },
      cost: { kind: 'command-points', value: 1 },
    }),
    rule('oath', {
      kind: 'army-rule',
      name: 'Oath of Moment',
      scope: { kind: 'faction', factionId: 'SM' },
      timingKind: 'timed',
      timing: { windows: [{ ...phase('command'), moment: 'start' }], raw: 'start of your Command phase' },
    }),
    rule('chapters', { kind: 'army-rule', name: 'Chapters', scope: { kind: 'faction', factionId: 'SM' } }),
    rule('fnp', {
      kind: 'core-ability',
      name: 'Feel No Pain',
      timingKind: 'reaction',
      timingSource: 'reviewed',
    }),
    rule('gladius', {
      kind: 'detachment-rule',
      name: 'Combat Doctrines',
      scope: { kind: 'detachment', factionId: 'SM', detachmentId: 'D1' },
      timingKind: 'timed',
      timing: { windows: [phase('command')], raw: 'your Command phase' },
    }),
    rule('armour', {
      kind: 'stratagem',
      name: 'Armour of Contempt',
      scope: { kind: 'detachment', factionId: 'SM', detachmentId: 'D1' },
      timingKind: 'timed',
      timing: { windows: [phase('shooting', 'opponent'), phase('fight', 'either')], raw: 'x' },
    }),
    rule('boarding', {
      kind: 'stratagem',
      name: 'Breach',
      scope: { kind: 'detachment', factionId: 'SM', detachmentId: 'D2' },
      gameMode: 'boarding-actions',
    }),
    rule('artificer', {
      kind: 'enhancement',
      name: 'Artificer Armour',
      scope: { kind: 'detachment', factionId: 'SM', detachmentId: 'D1' },
    }),
    rule('captain-shield', {
      name: 'Storm Shield',
      scope: { kind: 'datasheet', datasheetId: id('captain') },
      text: 'Add 1 to Wounds.',
    }),
    rule('lieutenant-shield', {
      name: 'Storm shield',
      scope: { kind: 'datasheet', datasheetId: id('lieutenant') },
      text: 'Add 1 to Wounds.',
    }),
    rule('captain-odd', {
      name: 'Odd Rule',
      scope: { kind: 'datasheet', datasheetId: id('captain') },
      timingKind: 'unclassified',
      timingSource: 'unresolved',
    }),
  ],
}

describe('selectWh40kRules', () => {
  it('selects core, army-wide, detachment, enhancement, and unit rules with their causes', () => {
    const result = selectWh40kRules(catalog, {
      factionId: 'SM',
      detachmentId: 'D1',
      datasheetIds: [id('captain'), id('lieutenant')],
      enhancementIds: [id('artificer')],
    })
    const names = result.selected.map(entry => entry.rule.name).sort()

    expect(result.diagnostics).toEqual([])
    expect(names).toEqual([
      'Armour of Contempt',
      'Artificer Armour',
      'Chapters',
      'Combat Doctrines',
      'Command Re-roll',
      'Feel No Pain',
      'Oath of Moment',
      'Odd Rule',
      'Storm Shield',
      'Storm shield',
    ])
    expect(result.selected.find(entry => entry.rule.name === 'Oath of Moment')?.causes).toHaveLength(2)
    expect(result.selected.find(entry => entry.rule.name === 'Feel No Pain')?.causes).toEqual([
      { kind: 'datasheet', datasheetId: id('captain'), parameter: '5+' },
    ])
  })

  it('rejects Legends units without the opt-in, Boarding Actions detachments, and foreign enhancements', () => {
    const result = selectWh40kRules(catalog, {
      factionId: 'SM',
      detachmentId: 'D2',
      datasheetIds: [id('old')],
      enhancementIds: [id('artificer')],
    })
    expect(result.diagnostics.map(item => item.code)).toEqual([
      'detachment-not-matched-play',
      'enhancement-outside-detachment',
      'legends-not-allowed',
    ])
    expect(result.selected.some(entry => entry.rule.gameMode !== 'matched-play')).toBe(false)
    expect(
      selectWh40kRules(catalog, { factionId: 'SM', datasheetIds: [id('old')], allowsLegends: true })
        .diagnostics
    ).toEqual([])
  })
})

describe('projectWh40kReminders', () => {
  const reminders = projectWh40kReminders(
    selectWh40kRules(catalog, {
      factionId: 'SM',
      detachmentId: 'D1',
      datasheetIds: [id('captain'), id('lieutenant')],
    }).selected
  )

  it('emits one reminder per window in game order, then reactions, passives, and unresolved', () => {
    expect(groupWh40kReminders(reminders).map(group => group.label)).toEqual([
      'Start of the Command phase',
      'Command phase',
      'Shooting phase',
      'Fight phase',
      'Any phase',
      'Reactions',
      'Always active',
      'Timing needs review',
    ])
    expect(
      reminders.filter(reminder => reminder.name === 'Armour of Contempt').map(reminder => reminder.groupKey)
    ).toEqual(['phase:shooting:during', 'phase:fight:during'])
  })

  it('merges exact-text copies from different units into one reminder that keeps both sources', () => {
    const shields = reminders.filter(reminder => reminder.name.toLowerCase() === 'storm shield')
    expect(shields).toHaveLength(1)
    expect(shields[0].ruleIds).toEqual([id('captain-shield'), id('lieutenant-shield')])
    expect(shields[0].causes).toHaveLength(2)
  })
})
