import type { SourceRecordId } from '../../aos4/domain'
import type { Wh40kGameWindow, Wh40kTiming } from '../domain/timing'
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

export type Wh40kReviewedTimingKind = 'timed' | 'reaction' | 'passive'

/** A reviewed timing for rules the parser cannot read, e.g. core abilities or irregular WHEN clauses. */
export interface Wh40kTimingOverride {
  id: string
  sourceRecordIds: SourceRecordId[]
  kind: Wh40kReviewedTimingKind
  windows?: Wh40kGameWindow[]
  trigger?: string
  usage?: Wh40kTiming['usage']
  reason: string
  officialEvidence?: Wh40kOfficialEvidence[]
  /** Each record's `recordChecksum` when the decision was made; a different checksum means its text changed. */
  fingerprints?: Record<string, string>
}

/** Records that are not reminders, e.g. the Core Rules move and shoot types Wahapedia files as stratagems. */
export interface Wh40kIgnoredRules {
  id: string
  sourceRecordIds: SourceRecordId[]
  reason: string
  fingerprints?: Record<string, string>
}

/** The Army Faction keywords a faction's army declares, which "If your Army Faction is X" rules test. */
export interface Wh40kArmyFactionKeywords {
  factionId: string
  keywords: string[]
  reason: string
}

/** Faction keywords that split one faction's units into groups a player picks from, e.g. Chapters. */
export interface Wh40kSubFactionKeywords {
  factionId: string
  /** What one group is called, e.g. "Chapter". */
  label: string
  /** As Wahapedia prints them on datasheets, e.g. "Blood Angels". */
  keywords: string[]
  reason: string
  /** Army rules that belong to one group only, by keyword, e.g. a Chapter's own army rule. */
  armyRules?: Record<string, SourceRecordId[]>
  armyRulesReason?: string
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
  timingOverrides?: Wh40kTimingOverride[]
  ignoredRules?: Wh40kIgnoredRules[]
  armyFactionKeywords?: Wh40kArmyFactionKeywords[]
  subFactionKeywords?: Wh40kSubFactionKeywords[]
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
  | 'unknown-record'
  | 'duplicate-rule-decision'
  | 'invalid-army-faction-keywords'
  | 'invalid-sub-faction-keywords'
  | 'invalid-timing-override'
  | 'stale-rule-decision'

export interface Wh40kReviewFinding {
  code: Wh40kReviewFindingCode
  message: string
}

/** A timing or ignore decision whose record is not the one it was made against. */
export interface Wh40kDecisionCheck {
  ownerId: string
  sourceRecordId: SourceRecordId
  /** `changed`: the record's text moved on since the decision. `unstamped`: no fingerprint to compare. */
  status: 'changed' | 'unstamped'
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
  timingOverrides: Map<SourceRecordId, Wh40kTimingOverride>
  ignoredSourceRecordIds: SourceRecordId[]
  datasheetContexts: Map<SourceRecordId, Wh40kReviewContext>
  armyFactionKeywords: Map<string, string[]>
  subFactions: Map<string, { label: string; keywords: string[] }>
  /** Army rules that apply only to one sub-faction, e.g. Heirs of Sigismund to Black Templars. */
  subFactionArmyRules: Map<SourceRecordId, string>
  contexts: Record<Wh40kReviewContext, number>
  decisionChecks: Wh40kDecisionCheck[]
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
  const verifyEvidence = (ownerId: string, evidenceList: Wh40kOfficialEvidence[] | undefined) => {
    for (const evidence of evidenceList ?? []) {
      const page = input.evidencePages.get(evidencePageKey(evidence.url, evidence.page))
      if (!reviewedDocuments.has(evidence.url)) {
        finding('evidence-document-not-pinned', `${ownerId} cites unpinned document ${evidence.url}`)
      } else if (
        page === undefined ||
        !normalizeEvidenceText(page).includes(normalizeEvidenceText(evidence.quote))
      ) {
        finding('evidence-not-found', `${ownerId} quote is not on page ${evidence.page} of ${evidence.url}`)
      }
    }
  }
  const coveredBy = new Map<string, string[]>()
  const result: Omit<
    Wh40kReviewedSources,
    | 'status'
    | 'findings'
    | 'contexts'
    | 'timingOverrides'
    | 'ignoredSourceRecordIds'
    | 'datasheetContexts'
    | 'armyFactionKeywords'
    | 'subFactions'
    | 'subFactionArmyRules'
    | 'decisionChecks'
  > = {
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
    verifyEvidence(disposition.id, disposition.officialEvidence)

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
  const datasheetContexts = new Map<SourceRecordId, Wh40kReviewContext>()
  for (const sheet of linked.datasheets) {
    const classification = overrides.get(sheet.record.sourceRecordId) ?? sheet.classification
    const context = excluded.has(sheet.record.sourceRecordId) ? 'excluded' : policies.get(classification)
    if (!context) missingPolicies.add(classification)
    else {
      contexts[context] += 1
      datasheetContexts.set(sheet.record.sourceRecordId, context)
    }
  }
  for (const classification of Array.from(missingPolicies)) {
    finding('missing-classification-policy', `No context policy covers ${classification} datasheets`)
  }

  const knownRecords = new Map(
    Object.values(decoded.records).flatMap(records =>
      records.map(record => [record.sourceRecordId, record.recordChecksum] as const)
    )
  )
  const decidedBy = new Map<SourceRecordId, string>()
  const decisionChecks: Wh40kDecisionCheck[] = []
  const decide = (
    ownerId: string,
    sourceRecordIds: SourceRecordId[],
    fingerprints: Record<string, string> | undefined
  ) => {
    for (const sourceRecordId of sourceRecordIds) {
      const checksum = knownRecords.get(sourceRecordId)
      if (checksum === undefined) finding('unknown-record', `${ownerId} names unknown ${sourceRecordId}`)
      else if (!fingerprints?.[sourceRecordId]) {
        decisionChecks.push({ ownerId, sourceRecordId, status: 'unstamped' })
      } else if (fingerprints[sourceRecordId] !== checksum) {
        decisionChecks.push({ ownerId, sourceRecordId, status: 'changed' })
        finding('stale-rule-decision', `${ownerId} was decided against different text for ${sourceRecordId}`)
      }
      const earlier = decidedBy.get(sourceRecordId)
      if (earlier)
        finding('duplicate-rule-decision', `${sourceRecordId} is decided by ${earlier} and ${ownerId}`)
      decidedBy.set(sourceRecordId, ownerId)
    }
  }
  const timingOverrides = new Map<SourceRecordId, Wh40kTimingOverride>()
  for (const override of review.timingOverrides ?? []) {
    decide(override.id, override.sourceRecordIds, override.fingerprints)
    verifyEvidence(override.id, override.officialEvidence)
    if ((override.kind === 'timed') !== Boolean(override.windows?.length)) {
      finding('invalid-timing-override', `${override.id} lists windows exactly when its kind is timed`)
    }
    for (const sourceRecordId of override.sourceRecordIds) timingOverrides.set(sourceRecordId, override)
  }
  const ignoredSourceRecordIds: SourceRecordId[] = []
  for (const ignored of review.ignoredRules ?? []) {
    decide(ignored.id, ignored.sourceRecordIds, ignored.fingerprints)
    ignoredSourceRecordIds.push(...ignored.sourceRecordIds)
  }

  // Every faction needs an explicit decision, or its "If your Army Faction is X" rules cannot be gated.
  const factionIds = new Set((decoded.records['Factions.csv'] ?? []).map(record => record.values.id))
  const armyFactionKeywords = new Map<string, string[]>()
  for (const entry of review.armyFactionKeywords ?? []) {
    if (!factionIds.has(entry.factionId))
      finding(
        'invalid-army-faction-keywords',
        `Army Faction keywords name unknown faction ${entry.factionId}`
      )
    if (armyFactionKeywords.has(entry.factionId))
      finding('invalid-army-faction-keywords', `Army Faction keywords repeat faction ${entry.factionId}`)
    armyFactionKeywords.set(entry.factionId, entry.keywords)
  }
  for (const factionId of Array.from(factionIds).sort(compareCodeUnits)) {
    if (!armyFactionKeywords.has(factionId))
      finding('invalid-army-faction-keywords', `No Army Faction keywords are reviewed for ${factionId}`)
  }

  // A listed keyword no datasheet of the faction carries is a typo or a removed group.
  const printedKeywords = new Map<string, Set<string>>()
  for (const sheet of linked.datasheets) {
    const keywords = printedKeywords.get(sheet.record.values.faction_id) ?? new Set<string>()
    for (const keyword of sheet.keywords) {
      if (keyword.values.is_faction_keyword === 'true') keywords.add(keyword.values.keyword.toLowerCase())
    }
    printedKeywords.set(sheet.record.values.faction_id, keywords)
  }
  const subFactions = new Map<string, { label: string; keywords: string[] }>()
  const subFactionArmyRules = new Map<SourceRecordId, string>()
  for (const entry of review.subFactionKeywords ?? []) {
    if (!factionIds.has(entry.factionId) || subFactions.has(entry.factionId)) {
      finding(
        'invalid-sub-faction-keywords',
        `Sub-faction keywords name unknown or repeated faction ${entry.factionId}`
      )
      continue
    }
    for (const keyword of entry.keywords) {
      if (!printedKeywords.get(entry.factionId)?.has(keyword.toLowerCase()))
        finding(
          'invalid-sub-faction-keywords',
          `No ${entry.factionId} datasheet carries the faction keyword ${keyword}`
        )
    }
    subFactions.set(entry.factionId, { label: entry.label, keywords: entry.keywords })
    for (const [keyword, ruleIds] of Object.entries(entry.armyRules ?? {})) {
      if (!entry.keywords.includes(keyword))
        finding(
          'invalid-sub-faction-keywords',
          `${entry.factionId} army rules name unlisted group ${keyword}`
        )
      for (const ruleId of ruleIds) {
        if (!knownRecords.has(ruleId))
          finding('invalid-sub-faction-keywords', `${keyword} army rules name unknown ${ruleId}`)
        subFactionArmyRules.set(ruleId, keyword)
      }
    }
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
    timingOverrides,
    ignoredSourceRecordIds: sortIds(ignoredSourceRecordIds),
    datasheetContexts,
    armyFactionKeywords,
    subFactions,
    subFactionArmyRules,
    contexts,
    decisionChecks,
  }
}
