import { describe, expect, it } from 'vitest'
import { WH40K_CATALOG } from '../../wh40k11e/generated/catalog'
import { selectWh40kRules } from '../../wh40k11e/select/selectRules'
import { createWh40kArmyDocument } from '../../wh40k11e/state/armyDocument'
import {
  createWh40kBuilderViewModel,
  WH40K_UNIT_SECTIONS,
  wh40kUnitSection,
} from '../../wh40k11e/view/builder'
import type { Wh40kReminderViewModel } from '../../wh40k11e/view/reminders'
import { formatWh40kRemindersCsv } from '../../wh40k11e/view/remindersCsv'

const marines = () => createWh40kArmyDocument(WH40K_CATALOG, 'SM')
const sheet = (name: string) =>
  WH40K_CATALOG.datasheets.find(item => item.factionId === 'SM' && item.name === name)!
const armyRuleNames = (selection: Parameters<typeof selectWh40kRules>[1]) =>
  selectWh40kRules(WH40K_CATALOG, selection)
    .selected.filter(item => item.rule.kind === 'army-rule')
    .map(item => item.rule.name)

describe('tester feedback, 2026-10-16', () => {
  it('gives a Chapter its own army rule only when the army is that Chapter', () => {
    const plain = armyRuleNames({ factionId: 'SM', datasheetIds: [] })
    expect(plain).not.toContain('Heirs of Sigismund')
    expect(plain).not.toContain('Sons of Russ')
    // Which general army rules remain is a review decision, so only check that some do.
    expect(plain.length).toBeGreaterThan(0)

    expect(armyRuleNames({ factionId: 'SM', datasheetIds: [], subFaction: 'Black Templars' })).toContain(
      'Heirs of Sigismund'
    )
    const helbrecht = armyRuleNames({
      factionId: 'SM',
      datasheetIds: [sheet('High Marshal Helbrecht').sourceRecordId],
    })
    expect(helbrecht).toContain('Heirs of Sigismund')
    expect(helbrecht).not.toContain('Sons of Russ')
  })

  it('times Narthecium in the Command phase rather than always active', () => {
    const narthecium = WH40K_CATALOG.rules.find(
      rule => rule.name === 'Narthecium' && rule.kind === 'datasheet-ability'
    )!
    expect(narthecium.timingKind).toBe('timed')
    expect(narthecium.timing?.windows[0]).toMatchObject({
      kind: 'turn-phase',
      phase: 'command',
      perspective: 'your',
    })
  })

  it('groups units by type with leaders first', () => {
    expect(wh40kUnitSection('Infantry Epic Hero')).toBe('Epic Heroes')
    expect(wh40kUnitSection('Mounted Character')).toBe('Characters')
    expect(wh40kUnitSection('Dedicated Transports')).toBe('Dedicated Transports')
    expect(wh40kUnitSection('Vehicle')).toBe('Other units')
    const sections = createWh40kBuilderViewModel(WH40K_CATALOG, marines())
      .groups[0].options.filter(option => !option.overlay)
      .map(option => WH40K_UNIT_SECTIONS.indexOf(option.section as (typeof WH40K_UNIT_SECTIONS)[number]))
    expect(sections).toEqual([...sections].sort((left, right) => left - right))
    expect(new Set(sections).size).toBeGreaterThan(3)
  })

  it('exports visible reminders as CSV that a spreadsheet cannot run as formulas', () => {
    const reminder = (overrides: Partial<Wh40kReminderViewModel>): Wh40kReminderViewModel => ({
      id: 'r',
      name: 'Armour of Contempt',
      windowKey: 'reaction',
      windowLabel: 'Reactions',
      tags: [
        { label: 'Stratagem', tone: 'provenance', description: '' },
        { label: '1 CP', tone: 'cost', description: '' },
      ],
      sections: [
        {
          label: 'When',
          text: 'Your opponent\'s Shooting phase, "just after" an enemy unit has selected targets.',
        },
      ],
      effect: '',
      hidden: false,
      sourceRecordIndexes: [],
      ruleId: 'r',
      timingIssue: { army: '', current: '' },
      ...overrides,
    })
    const csv = formatWh40kRemindersCsv([
      reminder({ note: '=HYPERLINK("x")' }),
      reminder({ id: 'hidden', name: 'Hidden', hidden: true }),
      reminder({
        id: 'list',
        name: 'Command Re-roll',
        sections: [{ text: 'Re-roll one of:', items: ['Hit roll', 'Wound roll'] }],
      }),
    ])
    const lines = csv.replace(/^\ufeff/, '').split('\r\n')

    expect(lines[0]).toBe('Moment,Rule,Type,Turn,Cost,Limit,From,Text,Note')
    expect(lines[1]).toBe(
      'Reactions,Armour of Contempt,Stratagem,,1 CP,,,"WHEN: Your opponent\'s Shooting phase, ""just after"" an enemy unit has selected targets.","\'=HYPERLINK(""x"")"'
    )
    expect(csv).not.toContain('Hidden')
    expect(csv).toContain('"Re-roll one of:\n• Hit roll\n• Wound roll"')
  })
})

describe('tester feedback, 2026-10-19 timing issues', () => {
  const coreRule = (name: string) =>
    WH40K_CATALOG.rules.find(rule => rule.name === name && rule.scope.kind === 'all-armies')!
  const endOfOpponentMovement = {
    kind: 'turn-phase',
    phase: 'movement',
    moment: 'end',
    perspective: 'opponent',
  }

  it("lists the Lictor's Pheromone Trail with Rapid Ingress, not under Reactions (#2)", () => {
    const lictor = WH40K_CATALOG.datasheets.find(item => item.factionId === 'TYR' && item.name === 'Lictor')!
    const trail = WH40K_CATALOG.rules.find(
      rule =>
        rule.name === 'Pheromone Trail' &&
        rule.scope.kind === 'datasheet' &&
        rule.scope.datasheetId === lictor.sourceRecordId
    )!
    expect(trail.timingKind).toBe('timed')
    expect(trail.timing?.windows).toEqual(coreRule('Rapid Ingress').timing?.windows)
    expect(trail.timing?.windows).toEqual([endOfOpponentMovement])
  })

  it('lists Deep Strike in your Movement phase and with Rapid Ingress (#3)', () => {
    expect(coreRule('Deep Strike').timing?.windows).toEqual([
      { kind: 'turn-phase', phase: 'movement', moment: 'during', perspective: 'your' },
      endOfOpponentMovement,
    ])
  })
})
