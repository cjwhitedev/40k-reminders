import { describe, expect, it } from 'vitest'
import { artifactId, sourceRecordId } from '../../aos4/domain'
import { applyWh40kSourceReview, evidencePageKey, type Wh40kSourceReview } from '../../wh40k11e/data/review'
import type { Wh40kWahapediaDecodeResult } from '../../wh40k11e/data/wahapedia/decode'
import type {
  Wh40kLinkDiagnostic,
  Wh40kLinkedDatasheet,
  Wh40kWahapediaLinkedDataset,
} from '../../wh40k11e/data/wahapedia/link'

const bsdata = { repository: 'BSData/wh40k-11e', commit: 'a'.repeat(40) }
const exportPin = { url: 'https://wahapedia.ru/wh40k11ed/Factions.csv', checksum: 'b'.repeat(64) }
const pdf = { url: 'https://assets.warhammer-community.com/pack.pdf', checksum: 'c'.repeat(64) }

const sheet = (id: string, classification: Wh40kLinkedDatasheet['classification']): Wh40kLinkedDatasheet => ({
  record: {
    file: 'Datasheets.csv',
    line: 2,
    values: { id },
    artifactId: artifactId('0'.repeat(64)),
    sourceRecordId: sourceRecordId('test', id),
    recordChecksum: '0'.repeat(64),
  },
  classification,
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

const dangling = (id: string, value: string): Wh40kLinkDiagnostic => ({
  code: 'dangling-reference',
  severity: 'error',
  file: 'Datasheets_wargear.csv',
  line: 2,
  sourceRecordId: sourceRecordId('test', id),
  field: 'datasheet_id',
  value,
  message: `row ${id} points at ${value}`,
})

const review = (overrides: Partial<Wh40kSourceReview> = {}): Wh40kSourceReview => ({
  schemaVersion: 1,
  revision: 'test',
  inputs: { bsdata, wahapediaExports: [exportPin], officialDocuments: [pdf] },
  decoderDiagnosticPolicies: [{ code: 'duplicate-identical-record', reason: 'kept once' }],
  classificationPolicies: [
    { classification: 'current', context: 'current', reason: 'current' },
    { classification: 'unsourced', context: 'excluded', reason: 'unsourced' },
  ],
  linkDispositions: [
    {
      id: 'orphans',
      match: { code: 'dangling-reference', field: 'datasheet_id', values: ['GONE'] },
      expectedCount: 2,
      action: 'exclude-records',
      reason: 'parent removed',
      officialEvidence: [{ url: pdf.url, page: 3, quote: 'Hellflayers only' }],
    },
  ],
  ...overrides,
})

const run = (
  reviewFile: Wh40kSourceReview,
  diagnostics: Wh40kLinkDiagnostic[] = [dangling('w1', 'GONE'), dangling('w2', 'GONE')],
  pageText = 'LEADER\n  Hellflayers   only',
  records = {} as Wh40kWahapediaDecodeResult['records']
) =>
  applyWh40kSourceReview({
    review: reviewFile,
    bsdata,
    wahapediaExports: [exportPin],
    officialDocuments: [pdf],
    decoded: {
      status: 'candidate-review-required',
      records,
      diagnostics: [
        { code: 'duplicate-identical-record', severity: 'warning', file: 'Factions.csv', message: 'dup' },
      ],
    },
    linked: {
      status: 'blocked',
      datasheets: [sheet('D1', 'current'), sheet('D2', 'unsourced')],
      diagnostics,
    } satisfies Wh40kWahapediaLinkedDataset,
    evidencePages: new Map([[evidencePageKey(pdf.url, 3), pageText]]),
  })

describe('applyWh40kSourceReview', () => {
  it('accepts a review that covers every error exactly once with verified evidence', () => {
    const result = run(review())

    expect(result.status).toBe('reviewed')
    expect(result.excludedSourceRecordIds).toEqual([
      sourceRecordId('test', 'w1'),
      sourceRecordId('test', 'w2'),
    ])
    expect(result.contexts).toEqual({ current: 1, legends: 0, 'forge-world': 0, excluded: 1 })
  })

  it('blocks on an undispositioned error and on a stale expected count', () => {
    const result = run(review(), [dangling('w1', 'GONE'), dangling('w2', 'GONE'), dangling('w3', 'OTHER')])

    expect(result.status).toBe('blocked')
    expect(result.findings.map(item => item.code)).toEqual(['undispositioned-diagnostic'])
    expect(run(review(), [dangling('w1', 'GONE')]).findings.map(item => item.code)).toEqual([
      'disposition-count-mismatch',
    ])
  })

  it('blocks when a quote is not on the cited page or an input is not the reviewed one', () => {
    expect(run(review(), undefined, 'a different page').findings.map(item => item.code)).toEqual([
      'evidence-not-found',
    ])
    const moved = review({
      inputs: {
        bsdata: { ...bsdata, commit: 'd'.repeat(40) },
        wahapediaExports: [exportPin],
        officialDocuments: [pdf],
      },
    })
    expect(run(moved).findings.map(item => item.code)).toEqual(['input-mismatch'])
  })

  it('blocks on a classification or decoder warning with no policy', () => {
    const result = run(
      review({ decoderDiagnosticPolicies: [], classificationPolicies: [review().classificationPolicies[0]] })
    )

    expect(result.findings.map(item => item.code)).toEqual([
      'missing-classification-policy',
      'undispositioned-decoder-warning',
    ])
  })

  it('applies timing overrides and ignored rules only to known records decided once', () => {
    const known = sourceRecordId('test', 'ability')
    const moveType = sourceRecordId('test', 'move')
    const records = {
      'Abilities.csv': [{ ...sheet('ability', 'current').record, sourceRecordId: known }],
      'Stratagems.csv': [{ ...sheet('move', 'current').record, sourceRecordId: moveType }],
    } as unknown as Wh40kWahapediaDecodeResult['records']
    const valid = review({
      timingOverrides: [
        {
          id: 'core',
          sourceRecordIds: [known],
          kind: 'timed',
          windows: [{ kind: 'pre-battle', step: 'Deployment' }],
          reason: 'core rule',
          officialEvidence: [{ url: pdf.url, page: 3, quote: 'Hellflayers only' }],
        },
      ],
      ignoredRules: [{ id: 'moves', sourceRecordIds: [moveType], reason: 'core move type' }],
    })
    const result = run(valid, undefined, undefined, records)

    expect(result.status).toBe('reviewed')
    expect(result.timingOverrides.get(known)?.id).toBe('core')
    expect(result.ignoredSourceRecordIds).toEqual([moveType])

    const broken = review({
      timingOverrides: [
        { id: 'unwindowed', sourceRecordIds: [known], kind: 'timed', reason: 'no windows' },
        {
          id: 'ghost',
          sourceRecordIds: [sourceRecordId('test', 'ghost')],
          kind: 'passive',
          reason: 'unknown',
        },
      ],
      ignoredRules: [{ id: 'twice', sourceRecordIds: [known], reason: 'also ignored' }],
    })
    expect(run(broken, undefined, undefined, records).findings.map(item => item.code)).toEqual([
      'duplicate-rule-decision',
      'invalid-timing-override',
      'unknown-record',
    ])
  })
})
