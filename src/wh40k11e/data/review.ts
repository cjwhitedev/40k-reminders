import type { SourceRecordId } from '../../aos4/domain'
import type { Wh40kWahapediaDecodeResult } from './wahapedia/decode'
import { compareCodeUnits } from './wahapedia/decode'
import type {
  Wh40kLinkDiagnosticCode,
  Wh40kSourceClassification,
  Wh40kWahapediaLinkedDataset,
} from './wahapedia/link'

export type Wh40kReviewContext = 'current' | 'legends' | 'forge-world' | 'excluded'

export interface Wh40kPinnedArtifact {
  url: string
  checksum: string
}

export interface Wh40kOfficialEvidence {
  url: string
  page: number
  /** Must appear on the extracted page text once whitespace is collapsed. */
  quote: string
}

export interface Wh40kLinkDisposition {
  id: string
  match: {
    code: Wh40kLinkDiagnosticCode
    field: string
    values?: string[]
    sourceRecordIds?: SourceRecordId[]
  }
  expectedCount: number
  action: 'exclude-records' | 'army-rule' | 'assign-classification'
  classification?: Wh40kSourceClassification
  reason: string
  officialEvidence?: Wh40kOfficialEvidence[]
}

export interface Wh40kSourceReview {
  schemaVersion: 1
  revision: string
  inputs: {
    bsdata: { repository: string; commit: string }
    wahapediaExports: Wh40kPinnedArtifact[]
    officialDocuments: Wh40kPinnedArtifact[]
  }
  decoderDiagnosticPolicies: Array<{ code: string; reason: string }>
  classificationPolicies: Array<{
    classification: Wh40kSourceClassification
    context: Wh40kReviewContext
    reason: string
  }>
  linkDispositions: Wh40kLinkDisposition[]
}

export type Wh40kReviewFindingCode =
  | 'input-mismatch'
  | 'decoder-error'
  | 'undispositioned-decoder-warning'
  | 'undispositioned-diagnostic'
  | 'multiply-dispositioned-diagnostic'
  | 'disposition-count-mismatch'
  | 'invalid-disposition'
  | 'missing-classification-policy'
  | 'evidence-document-not-pinned'
  | 'evidence-not-found'

export interface Wh40kReviewFinding {
  code: Wh40kReviewFindingCode
  message: string
}

export interface Wh40kReviewedSources {
  status: 'reviewed' | 'blocked'
  findings: Wh40kReviewFinding[]
  dispositions: Array<{ id: string; action: Wh40kLinkDisposition['action']; matched: number }>
  excludedSourceRecordIds: SourceRecordId[]
  armyRuleSourceRecordIds: SourceRecordId[]
  classificationOverrides: Array<{
    sourceRecordId: SourceRecordId
    classification: Wh40kSourceClassification
  }>
  contexts: Record<Wh40kReviewContext, number>
}

export const normalizeEvidenceText = (text: string): string => text.replace(/\s+/g, ' ').trim()

export const evidencePageKey = (url: string, page: number): string => `${url}#page=${page}`

const pinnedSet = (artifacts: Wh40kPinnedArtifact[]): string[] =>
  artifacts.map(artifact => `${artifact.url} ${artifact.checksum}`).sort(compareCodeUnits)

export const applyWh40kSourceReview = (input: {
  review: Wh40kSourceReview
  bsdata: { repository: string; commit: string }
  wahapediaExports: Wh40kPinnedArtifact[]
  officialDocuments: Wh40kPinnedArtifact[]
  decoded: Wh40kWahapediaDecodeResult
  linked: Wh40kWahapediaLinkedDataset
  /** Extracted official page text keyed by `evidencePageKey`. */
  evidencePages: Map<string, string>
}): Wh40kReviewedSources => {
  const { review, decoded, linked } = input
  const findings: Wh40kReviewFinding[] = []
  const finding = (code: Wh40kReviewFindingCode, message: string) => findings.push({ code, message })

  if (
    review.inputs.bsdata.repository !== input.bsdata.repository ||
    review.inputs.bsdata.commit !== input.bsdata.commit
  ) {
    finding(
      'input-mismatch',
      `Review is bound to BSData ${review.inputs.bsdata.commit}, candidate is ${input.bsdata.commit}`
    )
  }
  if (
    JSON.stringify(pinnedSet(review.inputs.wahapediaExports)) !==
    JSON.stringify(pinnedSet(input.wahapediaExports))
  ) {
    finding('input-mismatch', 'Review is bound to a different set of Wahapedia export checksums')
  }
  const officialPinned = new Set(pinnedSet(input.officialDocuments))
  for (const document of review.inputs.officialDocuments) {
    if (!officialPinned.has(`${document.url} ${document.checksum}`)) {
      finding(
        'input-mismatch',
        `Official document ${document.url} is not in the candidate at checksum ${document.checksum}`
      )
    }
  }

  for (const diagnostic of decoded.diagnostics) {
    if (diagnostic.severity === 'error') finding('decoder-error', diagnostic.message)
  }
  const decoderPolicies = new Set(review.decoderDiagnosticPolicies.map(policy => policy.code))
  for (const code of Array.from(
    new Set(decoded.diagnostics.filter(item => item.severity === 'warning').map(item => item.code))
  )) {
    if (!decoderPolicies.has(code))
      finding('undispositioned-decoder-warning', `No policy covers decoder warning ${code}`)
  }

  const reviewedDocuments = new Set(review.inputs.officialDocuments.map(document => document.url))
  const coveredBy = new Map<string, string[]>()
  const result: Omit<Wh40kReviewedSources, 'status' | 'findings' | 'contexts'> = {
    dispositions: [],
    excludedSourceRecordIds: [],
    armyRuleSourceRecordIds: [],
    classificationOverrides: [],
  }
  const errors = linked.diagnostics.filter(diagnostic => diagnostic.severity === 'error')

  for (const disposition of review.linkDispositions) {
    const { match } = disposition
    const matched = errors.filter(
      diagnostic =>
        diagnostic.code === match.code &&
        diagnostic.field === match.field &&
        (!match.values || match.values.includes(diagnostic.value)) &&
        (!match.sourceRecordIds || match.sourceRecordIds.includes(diagnostic.sourceRecordId))
    )
    if (!match.values && !match.sourceRecordIds) {
      finding('invalid-disposition', `${disposition.id} must match by values or sourceRecordIds`)
    }
    if (matched.length !== disposition.expectedCount) {
      finding(
        'disposition-count-mismatch',
        `${disposition.id} expects ${disposition.expectedCount} diagnostics but matches ${matched.length}`
      )
    }
    if ((disposition.action === 'assign-classification') !== Boolean(disposition.classification)) {
      finding(
        'invalid-disposition',
        `${disposition.id} has a classification only when its action assigns one`
      )
    }
    for (const evidence of disposition.officialEvidence ?? []) {
      const page = input.evidencePages.get(evidencePageKey(evidence.url, evidence.page))
      if (!reviewedDocuments.has(evidence.url)) {
        finding('evidence-document-not-pinned', `${disposition.id} cites unpinned document ${evidence.url}`)
      } else if (
        page === undefined ||
        !normalizeEvidenceText(page).includes(normalizeEvidenceText(evidence.quote))
      ) {
        finding(
          'evidence-not-found',
          `${disposition.id} quote is not on page ${evidence.page} of ${evidence.url}`
        )
      }
    }

    for (const diagnostic of matched) {
      const key = `${diagnostic.sourceRecordId} ${diagnostic.field}`
      coveredBy.set(key, [...(coveredBy.get(key) ?? []), disposition.id])
      if (disposition.action === 'exclude-records')
        result.excludedSourceRecordIds.push(diagnostic.sourceRecordId)
      if (disposition.action === 'army-rule') result.armyRuleSourceRecordIds.push(diagnostic.sourceRecordId)
      if (disposition.action === 'assign-classification' && disposition.classification) {
        result.classificationOverrides.push({
          sourceRecordId: diagnostic.sourceRecordId,
          classification: disposition.classification,
        })
      }
    }
    result.dispositions.push({ id: disposition.id, action: disposition.action, matched: matched.length })
  }

  for (const diagnostic of errors) {
    const ids = coveredBy.get(`${diagnostic.sourceRecordId} ${diagnostic.field}`) ?? []
    if (!ids.length) finding('undispositioned-diagnostic', diagnostic.message)
    else if (ids.length > 1) {
      finding('multiply-dispositioned-diagnostic', `${diagnostic.message} is covered by ${ids.join(', ')}`)
    }
  }

  const overrides = new Map(
    result.classificationOverrides.map(item => [item.sourceRecordId, item.classification])
  )
  const excluded = new Set(result.excludedSourceRecordIds)
  const policies = new Map(
    review.classificationPolicies.map(policy => [policy.classification, policy.context])
  )
  const contexts: Record<Wh40kReviewContext, number> = {
    current: 0,
    legends: 0,
    'forge-world': 0,
    excluded: 0,
  }
  const missingPolicies = new Set<string>()
  for (const sheet of linked.datasheets) {
    const classification = overrides.get(sheet.record.sourceRecordId) ?? sheet.classification
    const context = excluded.has(sheet.record.sourceRecordId) ? 'excluded' : policies.get(classification)
    if (!context) missingPolicies.add(classification)
    else contexts[context] += 1
  }
  for (const classification of Array.from(missingPolicies)) {
    finding('missing-classification-policy', `No context policy covers ${classification} datasheets`)
  }

  const sortIds = (ids: SourceRecordId[]) => Array.from(new Set(ids)).sort(compareCodeUnits)
  findings.sort(
    (left, right) => compareCodeUnits(left.code, right.code) || compareCodeUnits(left.message, right.message)
  )
  return {
    status: findings.length ? 'blocked' : 'reviewed',
    findings,
    dispositions: result.dispositions,
    excludedSourceRecordIds: sortIds(result.excludedSourceRecordIds),
    armyRuleSourceRecordIds: sortIds(result.armyRuleSourceRecordIds),
    classificationOverrides: [...result.classificationOverrides].sort((left, right) =>
      compareCodeUnits(left.sourceRecordId, right.sourceRecordId)
    ),
    contexts,
  }
}
