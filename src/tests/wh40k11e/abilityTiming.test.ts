import { describe, expect, it } from 'vitest'
import type { Wh40kTiming } from '../../wh40k11e/domain/timing'
import { borrowWh40kStratagemTiming, parseWh40kAbilityTiming } from '../../wh40k11e/normalize/ability'

describe('borrowWh40kStratagemTiming', () => {
  const endOf = (phase: 'movement' | 'charge'): Wh40kTiming => ({
    raw: `End of your opponent's ${phase} phase.`,
    windows: [{ kind: 'turn-phase', phase, moment: 'end', perspective: 'opponent' }],
  })
  const stratagems = new Map<string, Wh40kTiming>([
    ['rapid ingress', endOf('movement')],
    ['heroic intervention', endOf('charge')],
    [
      'command re-roll',
      { raw: 'Any phase.', windows: [{ kind: 'any-phase', moments: ['during'], perspective: 'either' }] },
    ],
  ])
  const borrow = (text: string) => {
    const parsed = parseWh40kAbilityTiming(text)
    return borrowWh40kStratagemTiming(parsed.opening, stratagems, parsed.usage)
  }

  it('times a rule that uses a named Core stratagem when that stratagem is used', () => {
    expect(
      borrow(
        'Once per battle round, you can target one model with this ability with the Rapid Ingress Stratagem for 0CP.'
      )
    ).toEqual({
      windows: endOf('movement').windows,
      raw: 'Used with the Rapid Ingress Stratagem',
      usage: { limit: 1, period: 'battle-round' },
    })
    expect(
      borrow(
        'You can target this unit with the Rapid Ingress/Heroic Intervention stratagem, regardless of any other uses of that stratagem this phase.'
      )?.windows
    ).toEqual([...endOf('movement').windows, ...endOf('charge').windows])
    expect(
      borrow('When you target this unit with the Heroic Intervention stratagem, that use is -1 CP.')?.windows
    ).toEqual(endOf('charge').windows)
  })

  it('leaves other reactions, unknown stratagems and any-phase stratagems alone', () => {
    expect(
      borrow(
        'Each time an enemy unit ends a charge move, you can target this unit with the Heroic Intervention stratagem.'
      )
    ).toBeUndefined()
    expect(borrow('You can target this unit with the Go To Ground stratagem for 0CP.')).toBeUndefined()
    expect(
      borrow('Once per battle, you can target this unit with the Command Re-roll Stratagem for 0CP.')
    ).toBeUndefined()
  })
})

describe('parseWh40kAbilityTiming', () => {
  it('records an army faction condition and classifies the rule that follows it', () => {
    const result = parseWh40kAbilityTiming(
      'If your Army Faction is ADEPTUS ASTARTES, at the start of your Command phase, select one enemy unit.'
    )
    expect(result).toMatchObject({
      kind: 'timed',
      armyFaction: 'ADEPTUS ASTARTES',
      timing: { windows: [{ kind: 'turn-phase', phase: 'command', moment: 'start', perspective: 'your' }] },
    })
    expect(
      parseWh40kAbilityTiming(
        'If your Army Faction is TYRANIDS, once per battle, in either player’s Command phase, you can unleash it.'
      ).timing
    ).toMatchObject({
      windows: [{ kind: 'turn-phase', phase: 'command', perspective: 'either' }],
      usage: { limit: 1, period: 'battle' },
    })
  })

  it('reads the window after a standing condition rather than calling the rule always active', () => {
    expect(
      parseWh40kAbilityTiming(
        'While this model is leading a unit, in your Command phase, you can return 1 destroyed model to that unit.'
      )
    ).toMatchObject({
      kind: 'timed',
      timing: { windows: [{ kind: 'turn-phase', phase: 'command', moment: 'during', perspective: 'your' }] },
    })
    expect(
      parseWh40kAbilityTiming(
        "While this model is leading a unit, at the end of your opponent's turn, you can remove it."
      ).timing?.windows
    ).toEqual([{ kind: 'turn-step', step: 'end-of-turn', perspective: 'opponent' }])
    expect(parseWh40kAbilityTiming('While this model is leading a unit, add 1 to Hit rolls.').kind).toBe(
      'passive'
    )
    expect(
      parseWh40kAbilityTiming('While this model is leading a unit, at any point, it can do something.').kind
    ).toBe('passive')
  })

  it('reads a timed opener with a usage limit and a specific battle round', () => {
    const result = parseWh40kAbilityTiming(
      'Once per battle, at the start of your first Movement phase, this unit can move.'
    )
    expect(result.kind).toBe('timed')
    expect(result.timing).toMatchObject({
      windows: [{ kind: 'turn-phase', phase: 'movement', moment: 'start', perspective: 'your', round: 1 }],
      usage: { limit: 1, period: 'battle' },
    })
  })

  it('lists both windows for an opener joined by "and", ignoring a trailing restriction note', () => {
    expect(
      parseWh40kAbilityTiming('In your Shooting phase and the Fight phase, re-roll hits.').timing?.windows
    ).toEqual([
      { kind: 'turn-phase', phase: 'shooting', moment: 'during', perspective: 'your' },
      { kind: 'turn-phase', phase: 'fight', moment: 'during', perspective: 'either' },
    ])
    expect(
      parseWh40kAbilityTiming(
        '(Once per battle, per army) At the end of your opponent’s Charge phase (excluding the first battle round), select one unit.'
      ).timing
    ).toMatchObject({
      windows: [{ kind: 'turn-phase', phase: 'charge', moment: 'end', perspective: 'opponent' }],
      usage: { limit: 1, period: 'battle' },
    })
  })

  it('reads pre-battle steps and removes an enhancement eligibility line', () => {
    const result = parseWh40kAbilityTiming(
      'Warlord model only. In the Declare Battle Formations step, set up the bearer’s unit in reserves.',
      { eligibilityLine: true }
    )
    expect(result.eligibility).toBe('Warlord model only')
    expect(result.timing?.windows).toEqual([{ kind: 'pre-battle', step: 'Declare Battle Formations step' }])
  })

  it('classifies reactions and always-on rules by their opener', () => {
    expect(
      parseWh40kAbilityTiming('Each time an attack is allocated to this model, halve the Damage.').kind
    ).toBe('reaction')
    expect(parseWh40kAbilityTiming('While this model is leading a unit, add 1 to Hit rolls.').kind).toBe(
      'passive'
    )
    expect(parseWh40kAbilityTiming('The bearer has the Feel No Pain 5+ ability.').kind).toBe('passive')
  })

  it('reads "Twice per" and per-token limits, stratagem permissions, and standing restrictions', () => {
    expect(
      parseWh40kAbilityTiming(
        'Twice per battle, in your Movement phase, you can select one other friendly Infantry model.'
      ).timing
    ).toMatchObject({ windows: [{ phase: 'movement' }], usage: { limit: 2, period: 'battle' } })
    expect(
      parseWh40kAbilityTiming(
        'Once per battle for each Aspect Shrine token this unit has, you can change the result of one Hit roll.'
      )
    ).toMatchObject({ kind: 'reaction', usage: { limit: 1, period: 'battle' } })
    expect(
      parseWh40kAbilityTiming('You can target this model with the Fire Overwatch Stratagem for 0CP.').kind
    ).toBe('reaction')
    expect(
      parseWh40kAbilityTiming('Once per battle, you can use the Rapid Ingress Stratagem for 0CP.').kind
    ).toBe('reaction')
    expect(
      parseWh40kAbilityTiming('Your army cannot contain both Captain Tycho and Tycho the Lost.').kind
    ).toBe('passive')
    expect(
      parseWh40kAbilityTiming('At the end of each phase, that model regains all of its lost wounds.').timing
        ?.windows
    ).toEqual([{ kind: 'any-phase', moments: ['end'], perspective: 'either' }])
  })

  it('treats keyword-subject standing rules as always active', () => {
    expect(
      parseWh40kAbilityTiming(
        'Kroot models from your army have a 6+ invulnerable save against melee attacks.'
      ).kind
    ).toBe('passive')
    expect(
      parseWh40kAbilityTiming('TRAITOR GUARDSMEN SQUAD units from your army gain the BATTLELINE keyword.')
        .kind
    ).toBe('passive')
  })

  it('does not treat an army-building permission as a reaction', () => {
    expect(
      parseWh40kAbilityTiming(
        'You can use the ADEPTUS TITANICUS datasheets in this document to represent models.'
      ).kind
    ).toBe('unclassified')
  })

  it('times a rule whose whole effect is granting [ASSAULT] in your Shooting phase (Core Rules 24.04, 10.05)', () => {
    const shooting = [{ kind: 'turn-phase', phase: 'shooting', moment: 'during', perspective: 'your' }]
    for (const text of [
      'This unit’s ranged attacks have [ASSAULT].',
      'While this model is leading a unit, ranged weapons equipped by models in that unit have the [ASSAULT] ability.',
      'The bearer’s ranged weapons have the [assault] ability.',
    ]) {
      const result = parseWh40kAbilityTiming(text)
      expect(result.kind).toBe('timed')
      expect(result.timing?.windows).toEqual(shooting)
    }
    for (const text of [
      'While this model is leading a unit, add 3" to the Move characteristic of models in that unit and ranged weapons equipped by models in that unit have the [ASSAULT] ability.',
      'The bearer’s ranged weapons have the [ASSAULT] ability. In addition, once per battle, in the Fight phase, the bearer can fight first.',
      'While a friendly unit is within 6" of this model, ranged weapons equipped by models in that unit have the [ASSAULT] and [LETHAL HITS] abilities.',
    ]) {
      expect(parseWh40kAbilityTiming(text).kind).toBe('passive')
    }
  })

  it('leaves unfamiliar openers unclassified for review', () => {
    const result = parseWh40kAbilityTiming(
      'Keep a tally of how many enemy models are destroyed by this unit.'
    )
    expect(result.kind).toBe('unclassified')
    expect(result.diagnostics.map(item => item.code)).toEqual(['unclassified-timing'])
  })

  it('drops the core-rule heading and flavour, and keeps list items marked', () => {
    const result = parseWh40kAbilityTiming(
      '<div class="abNameWrap"><div class="abName">LEADER<span class="h_number">24.22</span></div></div>' +
        '<p class="ShowFluff abLegend">Mighty heroes fight at the forefront of battle.</p>' +
        'Before the battle, in the Muster Armies step, select a bodyguard unit.'
    )
    expect(result.text).toBe('Before the battle, in the Muster Armies step, select a bodyguard unit.')
    expect(result.kind).toBe('timed')
  })

  it('reads the timing of a rule that opens with a list', () => {
    const result = parseWh40kAbilityTiming(
      '<ul><li>This unit has Stealth.</li><li>This unit has Scouts 6".</li></ul>'
    )
    expect(result.text).toBe('• This unit has Stealth.\n• This unit has Scouts 6".')
    expect(result.kind).toBe('passive')
  })
})
