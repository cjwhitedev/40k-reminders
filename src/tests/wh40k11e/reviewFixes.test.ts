import { describe, expect, it } from 'vitest'
import { sourceRecordId } from '../../aos4/domain'
import type { Wh40kSourceReview } from '../../wh40k11e/data/review'
import { planWh40kReviewFixes, type Wh40kReviewFixInput } from '../../wh40k11e/data/reviewFixes'
import type { Wh40kLinkDiagnostic } from '../../wh40k11e/data/wahapedia/link'

const id = (key: string) => sourceRecordId('wahapedia-wh40k11e', key)

const review: Wh40kSourceReview = {
  schemaVersion: 1,
  revision: 'test',
  inputs: {
    bsdata: { repository: 'r/r', commit: 'a'.repeat(40) },
    wahapediaExports: [],
    officialDocuments: [],
  },
  decoderDiagnosticPolicies: [],
  classificationPolicies: [],
  linkDispositions: [
    {
      id: 'old',
      match: { code: 'dangling-reference', field: 'datasheet_id', values: ['X'] },
      expectedCount: 1,
      action: 'exclude-records',
      reason: 'r',
      officialEvidence: [{ url: 'https://example.com/a.pdf', page: 3, quote: 'q' }],
    },
  ],
  timingOverrides: [
    { id: 'early', sourceRecordIds: [id('A')], kind: 'passive', reason: 'r', names: { [id('A')]: 'A' } },
  ],
  ignoredRules: [{ id: 'late', sourceRecordIds: [id('A'), id('B')], reason: 'r' }],
  subFactionKeywords: [
    {
      factionId: 'SM',
      label: 'Chapter',
      keywords: ['Blood Angels', 'Lamenters'],
      reason: 'r',
      armyRules: { Lamenters: [id('L')] },
    },
  ],
}

const link = (key: string, field: string, value: string): Wh40kLinkDiagnostic => ({
  code: 'dangling-reference',
  severity: 'error',
  file: 'Datasheets_abilities.csv',
  line: 1,
  sourceRecordId: id(key),
  field,
  value,
  message: `${key} ${field} points at missing ${value}`,
})

const input = (overrides: Partial<Wh40kReviewFixInput>): Wh40kReviewFixInput => ({
  review,
  findings: [],
  linkErrors: [],
  decoderWarnings: [],
  datasheets: [],
  date: '2026-10-19',
  ...overrides,
})

/** Applies every fix's Enter default, as pressing Enter would. */
const enterThrough = (fixInput: Wh40kReviewFixInput) =>
  planWh40kReviewFixes(fixInput).reduce((current, fix) => fix.choices[0].apply?.(current) ?? current, review)

describe('planWh40kReviewFixes', () => {
  it('asks nothing when the review has nothing it can settle', () => {
    expect(planWh40kReviewFixes(input({ linkErrors: [link('R1', 'datasheet_id', 'X')] }))).toEqual([])
  })

  it('leaves out rows pointing at unpublished records, one exclusion per field', () => {
    const fixed = enterThrough(
      input({
        linkErrors: [
          link('R1', 'datasheet_id', 'X'),
          link('R2', 'datasheet_id', 'Y'),
          link('R3', 'datasheet_id', 'Z'),
          link('R4', 'stratagem_id', 'S'),
        ],
      })
    )
    expect(fixed.linkDispositions.slice(1)).toEqual([
      expect.objectContaining({
        id: 'dangling-reference-datasheet-id-2026-10-19',
        match: { code: 'dangling-reference', field: 'datasheet_id', sourceRecordIds: [id('R2'), id('R3')] },
        expectedCount: 2,
        action: 'exclude-records',
      }),
      expect.objectContaining({ id: 'dangling-reference-stratagem-id-2026-10-19', expectedCount: 1 }),
    ])
  })

  it('accepts new decoder warnings and leaves new kinds of source out by default', () => {
    const fixed = enterThrough(
      input({
        findings: [
          {
            code: 'undispositioned-decoder-warning',
            message: 'No policy covers decoder warning duplicate-record-key',
          },
          {
            code: 'missing-classification-policy',
            message: 'No context policy covers unclassified datasheets',
          },
        ],
        decoderWarnings: [{ code: 'duplicate-record-key', message: 'Datasheets.csv repeats key 7' }],
        datasheets: [{ sourceRecordId: id('D'), name: 'Mystery Tank', classification: 'unclassified' }],
      })
    )
    expect(fixed.decoderDiagnosticPolicies).toEqual([
      { code: 'duplicate-record-key', reason: expect.stringContaining('Datasheets.csv repeats key 7') },
    ])
    expect(fixed.classificationPolicies).toEqual([
      { classification: 'unclassified', context: 'excluded', reason: expect.any(String) },
    ])
  })

  it('keeps the later of two decisions for one rule, and drops quotes from an updated PDF', () => {
    const fixed = enterThrough(
      input({
        findings: [
          { code: 'duplicate-rule-decision', message: `${id('A')} is decided by early and late` },
          { code: 'evidence-not-found', message: 'old quote is not on page 3 of https://example.com/a.pdf' },
        ],
      })
    )
    expect(fixed.timingOverrides).toEqual([])
    expect(fixed.ignoredRules?.[0].sourceRecordIds).toEqual([id('A'), id('B')])
    expect(fixed.linkDispositions[0].officialEvidence).toBeUndefined()
  })

  it('removes a Chapter keyword no datasheet carries any more, with its army rules', () => {
    const fixed = enterThrough(
      input({
        findings: [
          {
            code: 'invalid-sub-faction-keywords',
            message: 'No SM datasheet carries the faction keyword Lamenters',
          },
        ],
      })
    )
    expect(fixed.subFactionKeywords?.[0]).toMatchObject({ keywords: ['Blood Angels'], armyRules: {} })
  })
})
