import { describe, expect, it } from 'vitest'
import { sourceRecordId } from '../../aos4/domain'
import {
  addWh40kDecision,
  defaultWh40kReason,
  parseWh40kWindowsInput,
  refreshWh40kReviewInputs,
  removeWh40kDecision,
  stampWh40kDecisions,
  suggestWh40kDecision,
  type Wh40kDecision,
} from '../../wh40k11e/data/decisions'
import type { Wh40kSourceReview } from '../../wh40k11e/data/review'

const id = (name: string) => sourceRecordId('wahapedia-wh40k11e', `Abilities.csv:${name}`)

const review = (overrides: Partial<Wh40kSourceReview> = {}): Wh40kSourceReview => ({
  schemaVersion: 1,
  revision: 'wh40k11e-sources-2026-09-30',
  inputs: {
    bsdata: { repository: 'BSData/wh40k-11e', commit: 'a'.repeat(40) },
    wahapediaExports: [{ url: 'https://wahapedia.ru/wh40k11ed/Abilities.csv', checksum: 'b'.repeat(64) }],
    officialDocuments: [],
  },
  decoderDiagnosticPolicies: [],
  classificationPolicies: [],
  linkDispositions: [],
  timingOverrides: [],
  ignoredRules: [],
  ...overrides,
})

const noEarlier = new Map<string, { ownerId: string; decision: Wh40kDecision }>()
const suggest = (text: string, name = 'Some Rule') => suggestWh40kDecision({ name, text }, noEarlier)

describe('suggestWh40kDecision', () => {
  it('suggests timings from the opening phrase', () => {
    expect(suggest('In your Shooting phase, select one enemy unit.')?.decision).toMatchObject({
      kind: 'timed',
      windows: [{ kind: 'turn-phase', phase: 'shooting', moment: 'during', perspective: 'your' }],
    })
    expect(suggest('Each time a model in this unit is destroyed, roll one D6.')?.decision).toEqual({
      kind: 'reaction',
      trigger: 'Each time a model in this unit is destroyed',
      reason: defaultWh40kReason('Each time a model in this unit is destroyed, roll one D6.'),
    })
    expect(suggest('While this model is leading a unit, add 1 to Hit rolls.')?.decision.kind).toBe('passive')
    expect(suggest('In the Deploy Armies step, set this unit up anywhere.')?.decision).toMatchObject({
      kind: 'timed',
      windows: [{ kind: 'pre-battle', step: 'Deploy Armies step' }],
    })
  })

  it('suggests ignoring designer notes and army-building rules', () => {
    expect(suggest("Designer's Note: this means that ...")?.decision).toMatchObject({
      kind: 'ignore',
      groupId: 'designers-note',
    })
    expect(suggest('Your army can include one CULTIST MOB unit.')?.decision).toMatchObject({
      kind: 'ignore',
      groupId: 'army-building',
    })
  })

  it('reads past list markers and prefers an earlier decision for the same name', () => {
    expect(suggest('• This unit has Stealth.')?.decision.kind).toBe('passive')
    const earlier = new Map([
      ['oath of moment', { ownerId: 'oath', decision: { kind: 'passive', reason: 'r' } as const }],
    ])
    expect(suggestWh40kDecision({ name: 'Oath of Moment', text: 'Each time ...' }, earlier)).toMatchObject({
      decision: { kind: 'passive' },
      because: expect.stringContaining('oath'),
    })
  })

  it('offers nothing it cannot read', () => {
    expect(suggest('Keep a tally of destroyed enemy models.')).toBeUndefined()
  })
})

describe('parseWh40kWindowsInput', () => {
  it('reads WHEN-style phrases and before-the-battle steps', () => {
    expect(parseWh40kWindowsInput('start of your Command phase')).toEqual([
      { kind: 'turn-phase', phase: 'command', moment: 'start', perspective: 'your' },
    ])
    expect(parseWh40kWindowsInput('your Shooting phase or the Fight phase')).toHaveLength(2)
    expect(parseWh40kWindowsInput('end of any phase')).toEqual([
      { kind: 'any-phase', moments: ['end'], perspective: 'either' },
    ])
    expect(parseWh40kWindowsInput('before the battle: Deploy Armies step')).toEqual([
      { kind: 'pre-battle', step: 'Deploy Armies step' },
    ])
    expect(parseWh40kWindowsInput('whenever it feels right')).toBeUndefined()
  })
})

describe('recording decisions', () => {
  const rule = { sourceRecordId: id('1'), recordChecksum: 'c'.repeat(64), name: 'Rites of Battle' }

  it('adds a stamped timing override with a unique id', () => {
    const taken = review({
      timingOverrides: [{ id: 'rites-of-battle', sourceRecordIds: [id('0')], kind: 'passive', reason: 'r' }],
    })
    const next = addWh40kDecision(taken, rule, { kind: 'passive', reason: 'standing' }, '2026-10-06')
    expect(next.timingOverrides?.[1]).toEqual({
      id: 'rites-of-battle-2',
      sourceRecordIds: [rule.sourceRecordId],
      kind: 'passive',
      reason: 'standing',
      fingerprints: { [rule.sourceRecordId]: rule.recordChecksum },
    })
  })

  it('groups ignored rules by dated preset and replaces an earlier decision for the same rule', () => {
    const decided = addWh40kDecision(review(), rule, { kind: 'passive', reason: 'r' }, '2026-10-06')
    const first = addWh40kDecision(
      decided,
      rule,
      { kind: 'ignore', groupId: 'army-building', reason: 'army' },
      '2026-10-06'
    )
    const second = addWh40kDecision(
      first,
      { ...rule, sourceRecordId: id('2'), name: 'Other' },
      { kind: 'ignore', groupId: 'army-building', reason: 'army' },
      '2026-10-06'
    )
    expect(second.timingOverrides).toEqual([])
    expect(second.ignoredRules).toEqual([
      {
        id: 'army-building-2026-10-06',
        sourceRecordIds: [rule.sourceRecordId, id('2')],
        reason: 'army',
        fingerprints: { [rule.sourceRecordId]: rule.recordChecksum, [id('2')]: rule.recordChecksum },
      },
    ])
  })

  it('removes a record and drops an entry left empty', () => {
    const two = review({
      ignoredRules: [
        { id: 'group', sourceRecordIds: [id('1'), id('2')], reason: 'r', fingerprints: { [id('1')]: 'x' } },
      ],
      timingOverrides: [{ id: 'solo', sourceRecordIds: [id('3')], kind: 'passive', reason: 'r' }],
    })
    const next = removeWh40kDecision(removeWh40kDecision(two, id('1')), id('3'))
    expect(next.ignoredRules).toEqual([
      { id: 'group', sourceRecordIds: [id('2')], reason: 'r', fingerprints: {} },
    ])
    expect(next.timingOverrides).toEqual([])
  })

  it('stamps only missing fingerprints unless asked to restamp', () => {
    const entry = {
      id: 'e',
      sourceRecordIds: [id('1'), id('2')],
      kind: 'passive' as const,
      reason: 'r',
      fingerprints: { [id('1')]: 'old' },
    }
    const checksums = new Map([
      [id('1'), 'new'],
      [id('2'), 'two'],
    ])
    const missing = stampWh40kDecisions(review({ timingOverrides: [entry] }), checksums, {
      onlyMissing: true,
    })
    expect(missing.stamped).toBe(1)
    expect(missing.review.timingOverrides?.[0].fingerprints).toEqual({ [id('1')]: 'old', [id('2')]: 'two' })
    expect(
      stampWh40kDecisions(review({ timingOverrides: [entry] }), checksums, { onlyMissing: false }).stamped
    ).toBe(2)
  })

  it('binds a review to new inputs and keeps every decision', () => {
    const decided = review({ ignoredRules: [{ id: 'keep', sourceRecordIds: [id('1')], reason: 'r' }] })
    const next = refreshWh40kReviewInputs(decided, 'wh40k11e-sources-2026-10-06', {
      bsdata: { repository: 'BSData/wh40k-11e', commit: 'd'.repeat(40) },
      wahapediaExports: [
        { url: 'https://wahapedia.ru/wh40k11ed/Stratagems.csv', checksum: 'e'.repeat(64) },
        { url: 'https://wahapedia.ru/wh40k11ed/Abilities.csv', checksum: 'f'.repeat(64) },
      ],
      officialDocuments: [],
    })
    expect(next.revision).toBe('wh40k11e-sources-2026-10-06')
    expect(next.inputs.bsdata.commit).toBe('d'.repeat(40))
    expect(next.inputs.wahapediaExports.map(item => item.url.split('/').pop())).toEqual([
      'Abilities.csv',
      'Stratagems.csv',
    ])
    expect(next.ignoredRules).toEqual(decided.ignoredRules)
  })
})
