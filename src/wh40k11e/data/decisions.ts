import type { SourceRecordId } from '../../aos4/domain'
import { WH40K_TURN_PHASES, type Wh40kGameWindow } from '../domain/timing'
import { withoutListMarkers } from '../normalize/sourceText'
import { parseWh40kWhen } from '../normalize/when'
import type { Wh40kIgnoredRules, Wh40kPinnedArtifact, Wh40kSourceReview, Wh40kTimingOverride } from './review'
import { compareCodeUnits } from './wahapedia/decode'

export type Wh40kDecision =
  | { kind: 'timed'; windows: Wh40kGameWindow[]; reason: string }
  | { kind: 'reaction'; trigger: string; reason: string }
  | { kind: 'passive'; reason: string }
  /** Added to the ignore entry `groupId`, created with `reason` if it does not exist yet. */
  | { kind: 'ignore'; groupId: string; reason: string }

/** A rule waiting for a human decision, with what the prompt shows about it. */
export interface Wh40kDecisionCandidate {
  sourceRecordId: SourceRecordId
  recordChecksum: string
  name: string
  label: string
  where: string
  text: string
  why: 'unresolved' | 'changed' | 'requested'
  /** The decision it has now, for a changed or requested rule. */
  current?: { ownerId: string; summary: string; text?: string }
}

export interface Wh40kDecisionSuggestion {
  decision: Wh40kDecision
  because: string
}

export const WH40K_IGNORE_GROUPS = [
  {
    key: 'army-building',
    label: 'Army building (what an army may include, or keywords at muster)',
    reason:
      'Only decides what an army may include or which keywords units carry at muster; nothing to remind in play.',
  },
  {
    key: 'designers-note',
    label: "Designer's Note (clarification or advice)",
    reason: "A Designer's Note: clarification or advice that explains a rule rather than adding one.",
  },
  {
    key: 'framing',
    label: 'Framing text with no playable rule of its own',
    reason: 'No playable rule of its own: introduction or framing text for the rules around it.',
  },
] as const

const PHASE_NAMES = Object.fromEntries(WH40K_TURN_PHASES.map(phase => [phase.id, phase.name]))
const PERSPECTIVE_TEXT = { your: 'your', opponent: "your opponent's", either: 'either player’s' } as const
const ORDINAL_TEXT = ['', 'first ', 'second ', 'third ', 'fourth ', 'fifth ']

/** One window in plain words, e.g. "start of your Command phase". */
export const describeWh40kWindow = (window: Wh40kGameWindow): string => {
  switch (window.kind) {
    case 'pre-battle':
      return `before the battle (${window.step})`
    case 'battle':
      return `${window.moment} of the battle`
    case 'battle-round':
      return `${window.moment} of the ${ORDINAL_TEXT[window.round ?? 0]}battle round`
    case 'turn-step':
      return `${window.step === 'start-of-turn' ? 'start' : 'end'} of ${PERSPECTIVE_TEXT[window.perspective]} turn`
    case 'turn-phase': {
      const moment = window.moment === 'during' ? '' : `${window.moment} of `
      const round = window.round ? ` (${ORDINAL_TEXT[window.round].trim()} battle round)` : ''
      return `${moment}${PERSPECTIVE_TEXT[window.perspective]} ${PHASE_NAMES[window.phase]} phase${round}`
    }
    case 'any-phase':
      return `${window.moments.map(moment => (moment === 'during' ? 'during' : `${moment} of`)).join(' or ')} any phase`
    case 'always':
      return 'always'
  }
}

export const describeWh40kDecision = (decision: Wh40kDecision): string => {
  switch (decision.kind) {
    case 'timed':
      return `timed: ${decision.windows.map(describeWh40kWindow).join(' or ')}`
    case 'reaction':
      return `reaction: "${decision.trigger}"`
    case 'passive':
      return 'always active'
    case 'ignore':
      return `not a reminder (${decision.groupId})`
  }
}

/**
 * Reads a typed timing: anything the WHEN-clause grammar accepts ("start of your Command phase",
 * "your Shooting phase or the Fight phase", "end of any phase"), or "before the battle: <step>".
 */
export const parseWh40kWindowsInput = (input: string): Wh40kGameWindow[] | undefined => {
  const trimmed = input.trim()
  const preBattle = trimmed.match(/^(?:before the battle|pre-?battle)\s*(?::\s*(.+))?$/i)
  if (preBattle) {
    const step = preBattle[1]?.trim()
    return [{ kind: 'pre-battle', step: step ? step.replace(/\bstep$/i, 'step') : 'Before the battle' }]
  }
  return parseWh40kWhen(trimmed)?.windows
}

const opening = (text: string): string => withoutListMarkers(text).replace(/\s+/g, ' ').trim()

/** The quoted opening the reasons in the review file use, e.g. `Wahapedia text: 'At the start ...'`. */
export const defaultWh40kReason = (text: string): string => {
  const quote = opening(text)
  return `Wahapedia text: '${quote.length > 160 ? `${quote.slice(0, 157).trimEnd()}...` : quote}'`
}

const firstClause = (text: string): string => opening(text).split(/,\s/)[0].replace(/\.$/, '')

const ARMY_BUILDING =
  /^(?:your army can include|you can include|you cannot include|your army cannot (?:include|contain)|if your army includes|this model (?:can|must) be your warlord|this unit can be included|each detachment can only include|you can only include)/i
const PRE_BATTLE =
  /^(?:before the battle|at the start of the battle,|during deployment|when you set up (?:your army|this unit) during deployment|in the (?:declare battle formations|deploy armies|redeploy units|determine first turn|muster armies) step)/i
const REACTION =
  /^(?:once per (?:battle|battle round|turn|phase),\s*)?(?:each time|every time|when|whenever|after|just after|before|the first time)\b/i
const TIMED = /^(?:once per (?:battle|battle round|turn|phase),\s*)?(?:in|at|during) ([^,]+?),/i
const PASSIVE =
  /^(?:while|whilst|if|this (?:unit|model)|models in|the bearer|each model|add \d|subtract \d|improve|[^,.]{1,60} (?:units?|models?) from your army (?:have|has|gain|can))\b/i

/**
 * Suggests a decision for the prompt to offer. Nothing is applied without a person accepting it.
 * An earlier decision for a rule of the same name wins over wording patterns.
 */
export const suggestWh40kDecision = (
  candidate: Pick<Wh40kDecisionCandidate, 'name' | 'text'>,
  earlierByName: ReadonlyMap<string, { ownerId: string; decision: Wh40kDecision }>
): Wh40kDecisionSuggestion | undefined => {
  const earlier = earlierByName.get(candidate.name.trim().toLowerCase())
  if (earlier) {
    return {
      decision: earlier.decision,
      because: `same as the earlier decision for "${candidate.name}" (${earlier.ownerId})`,
    }
  }
  const text = opening(candidate.text)
  const reason = defaultWh40kReason(candidate.text)
  if (/^designer['’]s note/i.test(text)) {
    return {
      decision: { kind: 'ignore', groupId: 'designers-note', reason: WH40K_IGNORE_GROUPS[1].reason },
      because: "it opens with Designer's Note",
    }
  }
  if (ARMY_BUILDING.test(text)) {
    return {
      decision: { kind: 'ignore', groupId: 'army-building', reason: WH40K_IGNORE_GROUPS[0].reason },
      because: 'its wording is about building the army',
    }
  }
  if (PRE_BATTLE.test(text)) {
    const step = text.match(/in the ((?:[a-z]+ ){1,3}step)/i)?.[1]
    return {
      decision: {
        kind: 'timed',
        windows: [{ kind: 'pre-battle', step: step ?? 'Before the battle' }],
        reason,
      },
      because: 'it happens before the battle',
    }
  }
  const timed = text.match(TIMED)
  const windows = timed ? parseWh40kWhen(timed[1])?.windows : undefined
  if (windows) {
    return { decision: { kind: 'timed', windows, reason }, because: `it opens with "${timed?.[0]}"` }
  }
  if (REACTION.test(text)) {
    return {
      decision: { kind: 'reaction', trigger: firstClause(text), reason },
      because: 'it opens with an each time / when / after trigger',
    }
  }
  if (PASSIVE.test(text)) {
    return { decision: { kind: 'passive', reason }, because: 'it describes a standing effect' }
  }
  return undefined
}

/** The decision a review entry encodes, for suggesting it again for a rule of the same name. */
export const decisionOfWh40kEntry = (
  entry: Wh40kTimingOverride | Wh40kIgnoredRules,
  section: 'timingOverrides' | 'ignoredRules'
): Wh40kDecision => {
  if (section === 'ignoredRules') return { kind: 'ignore', groupId: entry.id, reason: entry.reason }
  const override = entry as Wh40kTimingOverride
  if (override.kind === 'timed')
    return { kind: 'timed', windows: override.windows ?? [], reason: override.reason }
  if (override.kind === 'reaction') {
    return { kind: 'reaction', trigger: override.trigger ?? '', reason: override.reason }
  }
  return { kind: 'passive', reason: override.reason }
}

export const findWh40kDecisionEntry = (
  review: Wh40kSourceReview,
  sourceRecordId: SourceRecordId
):
  | { section: 'timingOverrides'; entry: Wh40kTimingOverride }
  | { section: 'ignoredRules'; entry: Wh40kIgnoredRules }
  | undefined => {
  const override = review.timingOverrides?.find(entry => entry.sourceRecordIds.includes(sourceRecordId))
  if (override) return { section: 'timingOverrides', entry: override }
  const ignored = review.ignoredRules?.find(entry => entry.sourceRecordIds.includes(sourceRecordId))
  return ignored ? { section: 'ignoredRules', entry: ignored } : undefined
}

const withoutRecord = <
  T extends { sourceRecordIds: SourceRecordId[]; fingerprints?: Record<string, string> },
>(
  entries: T[] | undefined,
  sourceRecordId: SourceRecordId
): T[] =>
  (entries ?? [])
    .map(entry => {
      if (!entry.sourceRecordIds.includes(sourceRecordId)) return entry
      const fingerprints = { ...entry.fingerprints }
      delete fingerprints[sourceRecordId]
      return {
        ...entry,
        sourceRecordIds: entry.sourceRecordIds.filter(id => id !== sourceRecordId),
        ...(entry.fingerprints ? { fingerprints } : {}),
      }
    })
    .filter(entry => entry.sourceRecordIds.length > 0)

/** Takes a record out of whichever decision holds it; an entry left with no records is dropped. */
export const removeWh40kDecision = (
  review: Wh40kSourceReview,
  sourceRecordId: SourceRecordId
): Wh40kSourceReview => ({
  ...review,
  timingOverrides: withoutRecord(review.timingOverrides, sourceRecordId),
  ignoredRules: withoutRecord(review.ignoredRules, sourceRecordId),
})

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'rule'

/** Records a decision for one rule, stamped with the record checksum it was made against. */
export const addWh40kDecision = (
  review: Wh40kSourceReview,
  candidate: Pick<Wh40kDecisionCandidate, 'sourceRecordId' | 'recordChecksum' | 'name'>,
  decision: Wh40kDecision,
  date: string
): Wh40kSourceReview => {
  const base = removeWh40kDecision(review, candidate.sourceRecordId)
  const fingerprint = { [candidate.sourceRecordId]: candidate.recordChecksum }
  if (decision.kind === 'ignore') {
    const ignoredRules = [...(base.ignoredRules ?? [])]
    const preset = WH40K_IGNORE_GROUPS.some(group => group.key === decision.groupId)
    const groupId = preset ? `${decision.groupId}-${date}` : decision.groupId
    const index = ignoredRules.findIndex(entry => entry.id === groupId)
    if (index >= 0) {
      const entry = ignoredRules[index]
      ignoredRules[index] = {
        ...entry,
        sourceRecordIds: [...entry.sourceRecordIds, candidate.sourceRecordId],
        fingerprints: { ...entry.fingerprints, ...fingerprint },
      }
    } else {
      ignoredRules.push({
        id: groupId,
        sourceRecordIds: [candidate.sourceRecordId],
        reason: decision.reason,
        fingerprints: fingerprint,
      })
    }
    return { ...base, ignoredRules }
  }
  const taken = new Set(
    [...(base.timingOverrides ?? []), ...(base.ignoredRules ?? [])].map(entry => entry.id)
  )
  let id = slug(candidate.name)
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${slug(candidate.name)}-${suffix}`
  const override: Wh40kTimingOverride = {
    id,
    sourceRecordIds: [candidate.sourceRecordId],
    kind: decision.kind,
    ...(decision.kind === 'timed' ? { windows: decision.windows } : {}),
    ...(decision.kind === 'reaction' ? { trigger: decision.trigger } : {}),
    reason: decision.reason,
    fingerprints: fingerprint,
  }
  return { ...base, timingOverrides: [...(base.timingOverrides ?? []), override] }
}

/** Fills in fingerprints from the current records; with `onlyMissing`, an existing one is never replaced. */
export const stampWh40kDecisions = (
  review: Wh40kSourceReview,
  checksums: ReadonlyMap<string, string>,
  options: { onlyMissing: boolean; sourceRecordIds?: ReadonlySet<string> }
): { review: Wh40kSourceReview; stamped: number } => {
  let stamped = 0
  const stamp = <T extends { sourceRecordIds: SourceRecordId[]; fingerprints?: Record<string, string> }>(
    entry: T
  ): T => {
    const fingerprints = { ...entry.fingerprints }
    for (const id of entry.sourceRecordIds) {
      const checksum = checksums.get(id)
      if (!checksum || (options.sourceRecordIds && !options.sourceRecordIds.has(id))) continue
      if (options.onlyMissing && fingerprints[id]) continue
      if (fingerprints[id] !== checksum) stamped += 1
      fingerprints[id] = checksum
    }
    return Object.keys(fingerprints).length ? { ...entry, fingerprints } : entry
  }
  return {
    review: {
      ...review,
      timingOverrides: review.timingOverrides?.map(stamp),
      ignoredRules: review.ignoredRules?.map(stamp),
    },
    stamped,
  }
}

/** Binds a review to newly downloaded sources; every decision carries over unchanged. */
export const refreshWh40kReviewInputs = (
  review: Wh40kSourceReview,
  revision: string,
  inputs: {
    bsdata: { repository: string; commit: string }
    wahapediaExports: Wh40kPinnedArtifact[]
    officialDocuments: Wh40kPinnedArtifact[]
  }
): Wh40kSourceReview => ({
  ...review,
  revision,
  inputs: {
    bsdata: { ...inputs.bsdata },
    wahapediaExports: [...inputs.wahapediaExports].sort((left, right) =>
      compareCodeUnits(left.url, right.url)
    ),
    officialDocuments: [...inputs.officialDocuments].sort((left, right) =>
      compareCodeUnits(left.url, right.url)
    ),
  },
})
