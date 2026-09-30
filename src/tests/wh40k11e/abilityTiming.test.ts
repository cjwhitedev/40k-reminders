import { describe, expect, it } from 'vitest'
import { parseWh40kAbilityTiming } from '../../wh40k11e/normalize/ability'

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

  it('leaves unfamiliar openers unclassified for review', () => {
    const result = parseWh40kAbilityTiming(
      'ADEPTUS ASTARTES units from your army are eligible to declare a charge.'
    )
    expect(result.kind).toBe('unclassified')
    expect(result.diagnostics.map(item => item.code)).toEqual(['unclassified-timing'])
  })
})
