import { describe, expect, it } from 'vitest'
import { windowOrder } from '../../wh40k11e/domain/timing'
import { extractWhenClause, parseWh40kRuleTiming, parseWh40kWhen } from '../../wh40k11e/normalize/when'

describe('parseWh40kWhen', () => {
  it('parses phase windows with owner, moment, and trigger', () => {
    expect(parseWh40kWhen('Your Shooting phase.')).toEqual({
      windows: [{ kind: 'turn-phase', phase: 'shooting', moment: 'during', perspective: 'your' }],
      raw: 'Your Shooting phase.',
    })
    expect(parseWh40kWhen('End of your opponent’s Fight phase.')?.windows).toEqual([
      { kind: 'turn-phase', phase: 'fight', moment: 'end', perspective: 'opponent' },
    ])
    expect(parseWh40kWhen('Fight phase, just after an enemy unit has selected its targets.')).toMatchObject({
      windows: [{ kind: 'turn-phase', phase: 'fight', moment: 'during', perspective: 'either' }],
      trigger: 'just after an enemy unit has selected its targets',
    })
  })

  it('expands alternatives, including a shared owner across two phases', () => {
    expect(
      parseWh40kWhen('Your opponent’s Shooting phase or the Fight phase, just after an enemy unit has shot.')
        ?.windows
    ).toEqual([
      { kind: 'turn-phase', phase: 'shooting', moment: 'during', perspective: 'opponent' },
      { kind: 'turn-phase', phase: 'fight', moment: 'during', perspective: 'either' },
    ])
    expect(parseWh40kWhen('Your opponent’s Movement or Charge phase.')?.windows).toEqual([
      { kind: 'turn-phase', phase: 'movement', moment: 'during', perspective: 'opponent' },
      { kind: 'turn-phase', phase: 'charge', moment: 'during', perspective: 'opponent' },
    ])
  })

  it('parses turn steps, any-phase windows, and named phase steps', () => {
    expect(parseWh40kWhen('End of your opponent’s turn.')?.windows).toEqual([
      { kind: 'turn-step', step: 'end-of-turn', perspective: 'opponent' },
    ])
    expect(parseWh40kWhen('Start or end of any phase.')?.windows).toEqual([
      { kind: 'any-phase', moments: ['start'], perspective: 'either' },
      { kind: 'any-phase', moments: ['end'], perspective: 'either' },
    ])
    expect(parseWh40kWhen('Start of the Battle-shock step of your Command phase.')).toMatchObject({
      windows: [{ kind: 'turn-phase', phase: 'command', moment: 'during', perspective: 'your' }],
      trigger: 'Start of the Battle-shock step',
    })
  })

  it('reads the 11th-edition codex spellings: slashes, a missing comma, and ", or" alternatives', () => {
    const movementOrCharge = [
      { kind: 'turn-phase', phase: 'movement', moment: 'during', perspective: 'your' },
      { kind: 'turn-phase', phase: 'charge', moment: 'during', perspective: 'your' },
    ]
    expect(
      parseWh40kWhen('Your Movement/Charge phase, when a friendly Ravenwing unit is selected to move.')
    ).toMatchObject({
      windows: movementOrCharge,
      trigger: 'when a friendly Ravenwing unit is selected to move',
      raw: 'Your Movement/Charge phase, when a friendly Ravenwing unit is selected to move.',
    })
    expect(parseWh40kWhen('Your Movement or your Charge phase.')?.windows).toEqual(movementOrCharge)
    expect(parseWh40kWhen('Your Shooting phase when a KILL TEAM unit is selected to shoot.')).toMatchObject({
      windows: [{ kind: 'turn-phase', phase: 'shooting', moment: 'during', perspective: 'your' }],
      trigger: 'when a KILL TEAM unit is selected to shoot',
    })
    expect(
      parseWh40kWhen('Your Shooting phase, or the Fight phase, when a friendly unit is selected to attack.')
        ?.windows
    ).toEqual([
      { kind: 'turn-phase', phase: 'shooting', moment: 'during', perspective: 'your' },
      { kind: 'turn-phase', phase: 'fight', moment: 'during', perspective: 'either' },
    ])
    expect(
      parseWh40kWhen(
        'End of the Fight phase, or your opponent’s Shooting phase, just after an enemy unit has selected its targets.'
      )?.windows
    ).toEqual([
      { kind: 'turn-phase', phase: 'fight', moment: 'end', perspective: 'either' },
      { kind: 'turn-phase', phase: 'shooting', moment: 'during', perspective: 'opponent' },
    ])
    expect(parseWh40kWhen('Your opponent’s Shooting phase orthe Fight phase.')?.windows).toHaveLength(2)
    expect(parseWh40kWhen('Start of any phase (excluding the Command phase).')?.windows).toEqual([
      { kind: 'any-phase', moments: ['start'], perspective: 'either' },
    ])
    expect(parseWh40kWhen('Start/end of your Movement phase.')?.windows).toEqual([
      { kind: 'turn-phase', phase: 'movement', moment: 'start', perspective: 'your' },
      { kind: 'turn-phase', phase: 'movement', moment: 'end', perspective: 'your' },
    ])
    expect(parseWh40kWhen('Start of your opponent’s Reinforcements step.')).toMatchObject({
      windows: [{ kind: 'turn-phase', phase: 'movement', moment: 'during', perspective: 'opponent' }],
      trigger: 'Start of the Reinforcements step',
    })
  })

  it('leaves clauses outside the grammar unresolved rather than guessing', () => {
    expect(parseWh40kWhen('Whenever your opponent hesitates.')).toBeUndefined()
    expect(parseWh40kWhen('Your Shooting-ish phase.')).toBeUndefined()
    expect(parseWh40kWhen('Any phase, or whenever you like.')).toBeUndefined()
  })
})

describe('parseWh40kRuleTiming', () => {
  it('reads the WHEN clause from safe text and reports a missing one', () => {
    const result = parseWh40kRuleTiming(
      '<b>WHEN:</b> Your Command phase.<br><br><b>TARGET:</b> One unit.<br><br><b>EFFECT:</b> Gain 1CP.'
    )
    expect(result.when).toBe('Your Command phase.')
    expect(result.timing?.windows).toEqual([
      { kind: 'turn-phase', phase: 'command', moment: 'during', perspective: 'your' },
    ])
    expect(result.diagnostics).toEqual([])
    expect(parseWh40kRuleTiming('<b>EFFECT:</b> Move 6".').diagnostics.map(item => item.code)).toEqual([
      'missing-when',
    ])
  })

  it('flags unsafe markup instead of passing it through', () => {
    const result = parseWh40kRuleTiming('<b>WHEN:</b> Any phase.<script>alert(1)</script>')
    expect(result.text).not.toContain('alert')
    expect(result.diagnostics.map(item => item.code)).toEqual(['unsafe-source-text'])
  })

  it('stops the WHEN clause at the next section label', () => {
    expect(extractWhenClause('WHEN: Your Shooting phase. TARGET: One unit.')).toBe('Your Shooting phase.')
  })
})

describe('windowOrder', () => {
  it('orders a turn from start to end', () => {
    const ordered = [
      { kind: 'always' } as const,
      { kind: 'turn-phase', phase: 'fight', moment: 'during', perspective: 'your' } as const,
      { kind: 'turn-phase', phase: 'command', moment: 'end', perspective: 'your' } as const,
      { kind: 'turn-phase', phase: 'command', moment: 'start', perspective: 'your' } as const,
      { kind: 'battle-round', moment: 'start' } as const,
    ].sort((left, right) => windowOrder(left) - windowOrder(right))
    expect(
      ordered.map(window => (window.kind === 'turn-phase' ? `${window.phase}:${window.moment}` : window.kind))
    ).toEqual(['battle-round', 'command:start', 'command:end', 'fight:during', 'always'])
  })
})
