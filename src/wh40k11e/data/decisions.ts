import type { SourceRecordId } from '../../aos4/domain'
import { WH40K_TURN_PHASES, type Wh40kGameWindow } from '../domain/timing'
import { parseWh40kAbilityTiming } from '../normalize/ability'
import { withoutListMarkers } from '../normalize/sourceText'
import { extractWhenClause, parseWh40kWhen } from '../normalize/when'
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

const FRAMING = /^(?:the following are special move types|(?:maximum distance|set-up distance|eligible if):)/i

const yourPhase = (phase: (typeof WH40K_TURN_PHASES)[number]['id']): Wh40kGameWindow => ({
  kind: 'turn-phase',
  phase,
  moment: 'during',
  perspective: 'your',
})
const MOVEMENT_PHASE = yourPhase('movement')

const PHASE_HINTS: Array<{ pattern: RegExp; window: Wh40kGameWindow; because: string }> = [
  {
    pattern:
      /\b(?:dis)?embark|\bingress move|\bdeep strike|\breinforcements\b|\b(?:normal|advance|fall-back) move|\bselected to move\b/i,
    window: MOVEMENT_PHASE,
    because: 'it is about moving or disembarking',
  },
  {
    pattern: /\branged attack|\bshoot|\[assault\]/i,
    window: yourPhase('shooting'),
    because: 'it is about shooting',
  },
  { pattern: /\bcharge\b/i, window: yourPhase('charge'), because: 'it is about charging' },
  {
    pattern: /\bmelee attack|\bselected to fight|\bfights?\b|\bpile-in|\bconsolidat/i,
    window: { kind: 'turn-phase', phase: 'fight', moment: 'during', perspective: 'either' },
    because: 'it is about fighting',
  },
  {
    pattern: /\bbattle-shock|\bcommand points?\b|\b\d?CP\b|\borders?\b/i,
    window: yourPhase('command'),
    because: 'it is about the Command phase',
  },
]

/** The phase a rule's wording points at first, e.g. "ranged attack" to your Shooting phase; for the timed menu's default. */
export const hintWh40kPhase = (text: string): { window: Wh40kGameWindow; because: string } | undefined =>
  PHASE_HINTS.map(hint => ({ hint, at: text.search(hint.pattern) }))
    .filter(item => item.at >= 0)
    .sort((left, right) => left.at - right.at)[0]?.hint
// "You can select the assault doctrine one additional time per battle": an extra Combat Doctrines pick.
const EXTRA_DOCTRINE = /\bdoctrines?\b[^.]*\bone additional time\b/i

/**
 * Suggests a decision for the prompt to offer as its Enter default; nothing is applied without a
 * person accepting it. An earlier decision for a rule of the same name wins over wording patterns,
 * and a rule whose wording matches nothing is suggested as always active.
 */
export const suggestWh40kDecision = (
  candidate: Pick<Wh40kDecisionCandidate, 'name' | 'text'>,
  earlierByName: ReadonlyMap<string, { ownerId: string; decision: Wh40kDecision }>
): Wh40kDecisionSuggestion => {
  const earlier = earlierByName.get(candidate.name.trim().toLowerCase())
  if (earlier) {
    return {
      decision: earlier.decision,
      because: `same as the earlier decision for "${candidate.name}" (${earlier.ownerId})`,
    }
  }
  const text = opening(candidate.text)
  const reason = defaultWh40kReason(candidate.text)
  const ignore = (group: (typeof WH40K_IGNORE_GROUPS)[number], because: string): Wh40kDecisionSuggestion => ({
    decision: { kind: 'ignore', groupId: group.key, reason: group.reason },
    because,
  })
  if (!text) return ignore(WH40K_IGNORE_GROUPS[2], 'Wahapedia gives it no text')
  if (/^designer['’]s note/i.test(text))
    return ignore(WH40K_IGNORE_GROUPS[1], "it opens with Designer's Note")
  if (FRAMING.test(text))
    return ignore(WH40K_IGNORE_GROUPS[2], 'it describes move types rather than adding a rule')

  const when = extractWhenClause(text)
  if (when) {
    const timing = parseWh40kWhen(when)
    return timing
      ? {
          decision: { kind: 'timed', windows: timing.windows, reason },
          because: `its WHEN line reads "${when}"`,
        }
      : {
          decision: { kind: 'reaction', trigger: when.replace(/\.$/, ''), reason },
          because: `its WHEN line ("${when}") names no phase the parser knows`,
        }
  }
  if (EXTRA_DOCTRINE.test(text)) {
    return {
      decision: {
        kind: 'timed',
        windows: [{ kind: 'turn-phase', phase: 'command', moment: 'start', perspective: 'your' }],
        reason,
      },
      because: 'it adds a Combat Doctrines pick, which is made at the start of your Command phase',
    }
  }

  const parsed = parseWh40kAbilityTiming(
    candidate.text.replace(/^(\s*)up to (?:once|twice) per [a-z ]+?,\s*/i, '$1').replace(/;/, ','),
    { eligibilityLine: true }
  )
  const rest = opening(parsed.opening)
  if (ARMY_BUILDING.test(rest))
    return ignore(WH40K_IGNORE_GROUPS[0], 'its wording is about building the army')
  if (PRE_BATTLE.test(rest)) {
    const step = rest.match(/in the ((?:[a-z]+ ){1,3}step)/i)?.[1]
    return {
      decision: {
        kind: 'timed',
        windows: [{ kind: 'pre-battle', step: step ?? 'Before the battle' }],
        reason,
      },
      because: 'it happens before the battle',
    }
  }
  const timed = rest.match(TIMED)
  const windows = parsed.timing?.windows ?? (timed ? parseWh40kWhen(timed[1])?.windows : undefined)
  if (windows) {
    return {
      decision: { kind: 'timed', windows, reason },
      because: `it opens with "${parsed.timing?.raw ?? timed?.[0]}"`,
    }
  }
  // Core Rules 18.03: units disembark only in the Movement phase (an emergency disembark aside).
  if (/\bdisembark/i.test(text) && !/\bemergency disembark|\bis destroyed\b/i.test(text)) {
    return {
      decision: { kind: 'timed', windows: [MOVEMENT_PHASE], reason },
      because: 'units disembark only in the Movement phase (Core Rules 18.03)',
    }
  }
  if (parsed.kind === 'reaction' || REACTION.test(rest)) {
    return {
      decision: { kind: 'reaction', trigger: firstClause(rest), reason },
      because: 'it opens with an each time / when / after trigger',
    }
  }
  // "This ability always takes the form Firing Deck X. In your Shooting phase, ..."
  for (const sentence of withoutListMarkers(candidate.text)
    .split(/(?<=[.:])\s+|\n+/)
    .slice(1)) {
    const later = parseWh40kAbilityTiming(sentence.replace(/;/, ','))
    if (later.kind === 'timed' && later.timing) {
      return {
        decision: { kind: 'timed', windows: later.timing.windows, reason },
        because: `a later sentence opens with "${later.timing.raw}"`,
      }
    }
    if (later.kind === 'reaction') {
      return {
        decision: { kind: 'reaction', trigger: firstClause(later.opening), reason },
        because: 'a later sentence opens with an each time / when / after trigger',
      }
    }
  }
  if (/\btarget(?:ed)?\b[^.]*\bwith (?:a|the [a-z' -]+) stratagem\b/i.test(text)) {
    return {
      decision: { kind: 'reaction', trigger: 'When you target this unit with a Stratagem', reason },
      because: 'it changes how a Stratagem is used on this unit',
    }
  }
  if (parsed.kind === 'passive' || PASSIVE.test(rest)) {
    return { decision: { kind: 'passive', reason }, because: 'it describes a standing effect' }
  }
  return {
    decision: { kind: 'passive', reason },
    because: 'nothing in its wording names a time or a trigger, so it reads as a standing effect',
  }
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

type DecisionEntry = {
  sourceRecordIds: SourceRecordId[]
  fingerprints?: Record<string, string>
  names?: Record<string, string>
}

const withoutKey = (record: Record<string, string> | undefined, key: string) => {
  if (!record) return undefined
  const copy = { ...record }
  delete copy[key]
  return copy
}

const withoutRecord = <T extends DecisionEntry>(
  entries: T[] | undefined,
  sourceRecordId: SourceRecordId
): T[] =>
  (entries ?? [])
    .map(entry => {
      if (!entry.sourceRecordIds.includes(sourceRecordId)) return entry
      const fingerprints = withoutKey(entry.fingerprints, sourceRecordId)
      const names = withoutKey(entry.names, sourceRecordId)
      return {
        ...entry,
        sourceRecordIds: entry.sourceRecordIds.filter(id => id !== sourceRecordId),
        ...(fingerprints ? { fingerprints } : {}),
        ...(names ? { names } : {}),
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

type DecisionRecord = Pick<Wh40kDecisionCandidate, 'sourceRecordId' | 'recordChecksum' | 'name'>

/** Wording compared without spacing or capital letters, which Wahapedia reformats without changing a rule. */
export const sameWh40kWording = (left: string, right: string): boolean => {
  const words = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase()
  return words(left) === words(right)
}

/** Records a decision for one rule (or identical copies of it), stamped with the record checksums it was made against. */
export const addWh40kDecision = (
  review: Wh40kSourceReview,
  rule: DecisionRecord | DecisionRecord[],
  decision: Wh40kDecision,
  date: string
): Wh40kSourceReview => {
  const rules = Array.isArray(rule) ? rule : [rule]
  const base = rules.reduce((current, item) => removeWh40kDecision(current, item.sourceRecordId), review)
  const ids = rules.map(item => item.sourceRecordId)
  const fingerprint = Object.fromEntries(rules.map(item => [item.sourceRecordId, item.recordChecksum]))
  const name = Object.fromEntries(rules.map(item => [item.sourceRecordId, item.name]))
  if (decision.kind === 'ignore') {
    const ignoredRules = [...(base.ignoredRules ?? [])]
    const preset = WH40K_IGNORE_GROUPS.some(group => group.key === decision.groupId)
    const groupId = preset ? `${decision.groupId}-${date}` : decision.groupId
    const index = ignoredRules.findIndex(entry => entry.id === groupId)
    if (index >= 0) {
      const entry = ignoredRules[index]
      ignoredRules[index] = {
        ...entry,
        sourceRecordIds: [...entry.sourceRecordIds, ...ids],
        fingerprints: { ...entry.fingerprints, ...fingerprint },
        names: { ...entry.names, ...name },
      }
    } else {
      ignoredRules.push({
        id: groupId,
        sourceRecordIds: ids,
        reason: decision.reason,
        fingerprints: fingerprint,
        names: name,
      })
    }
    return { ...base, ignoredRules }
  }
  const taken = new Set(
    [...(base.timingOverrides ?? []), ...(base.ignoredRules ?? [])].map(entry => entry.id)
  )
  let id = slug(rules[0].name)
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${slug(rules[0].name)}-${suffix}`
  const override: Wh40kTimingOverride = {
    id,
    sourceRecordIds: ids,
    kind: decision.kind,
    ...(decision.kind === 'timed' ? { windows: decision.windows } : {}),
    ...(decision.kind === 'reaction' ? { trigger: decision.trigger } : {}),
    reason: decision.reason,
    fingerprints: fingerprint,
    names: name,
  }
  return { ...base, timingOverrides: [...(base.timingOverrides ?? []), override] }
}

/** Fills in fingerprints and names from the current records; with `onlyMissing`, an existing fingerprint is never replaced. */
export const stampWh40kDecisions = (
  review: Wh40kSourceReview,
  checksums: ReadonlyMap<string, string>,
  options: {
    onlyMissing: boolean
    sourceRecordIds?: ReadonlySet<string>
    names?: ReadonlyMap<string, string>
  }
): { review: Wh40kSourceReview; stamped: number } => {
  let stamped = 0
  const stamp = <T extends DecisionEntry>(entry: T): T => {
    const fingerprints = { ...entry.fingerprints }
    const names = { ...entry.names }
    for (const id of entry.sourceRecordIds) {
      const name = options.names?.get(id)
      if (name && !names[id]) names[id] = name
      const checksum = checksums.get(id)
      if (!checksum || (options.sourceRecordIds && !options.sourceRecordIds.has(id))) continue
      if (options.onlyMissing && fingerprints[id]) continue
      if (fingerprints[id] !== checksum) stamped += 1
      fingerprints[id] = checksum
    }
    return {
      ...entry,
      ...(Object.keys(fingerprints).length ? { fingerprints } : {}),
      ...(Object.keys(names).length ? { names } : {}),
    }
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

/** "Abilities.csv", "000008767", "SM" from `source-record:wahapedia-wh40k11e:Abilities.csv%3A000008767%3ASM`. */
const recordParts = (sourceRecordId: string): string[] =>
  decodeURIComponent(sourceRecordId.slice(sourceRecordId.lastIndexOf(':') + 1)).split(':')

export interface Wh40kRelinkResult {
  review: Wh40kSourceReview
  relinked: Array<{ name: string; from: SourceRecordId; to: SourceRecordId }>
  unmatched: Array<{ name?: string; sourceRecordId: SourceRecordId }>
}

/**
 * Follows rules Wahapedia renumbered: a missing record moves to the one current record in the same
 * export file with the same name (and the same trailing scope, such as the faction, when that is
 * needed to tell several apart). The old fingerprint moves with it, so the rule still comes up for
 * confirmation unless its row is byte-identical.
 */
export const relinkWh40kDecisions = (
  review: Wh40kSourceReview,
  missing: SourceRecordId[],
  current: ReadonlyArray<{ sourceRecordId: SourceRecordId; name: string }>,
  knownNames: ReadonlyMap<string, string> = new Map()
): Wh40kRelinkResult => {
  const nameOf = (id: SourceRecordId): string | undefined =>
    [...(review.timingOverrides ?? []), ...(review.ignoredRules ?? [])].find(entry => entry.names?.[id])
      ?.names?.[id] ?? knownNames.get(id)
  const byFileAndName = new Map<string, Array<{ sourceRecordId: SourceRecordId; scope: string }>>()
  for (const record of current) {
    const parts = recordParts(record.sourceRecordId)
    const key = `${parts[0]}\n${record.name.trim().toLowerCase()}`
    byFileAndName.set(key, [
      ...(byFileAndName.get(key) ?? []),
      { sourceRecordId: record.sourceRecordId, scope: parts[parts.length - 1] },
    ])
  }
  const target = new Map<SourceRecordId, SourceRecordId>()
  const relinked: Wh40kRelinkResult['relinked'] = []
  const unmatched: Wh40kRelinkResult['unmatched'] = []
  for (const id of Array.from(new Set(missing))) {
    const name = nameOf(id)
    const parts = recordParts(id)
    let matches = name ? (byFileAndName.get(`${parts[0]}\n${name.trim().toLowerCase()}`) ?? []) : []
    if (matches.length > 1) matches = matches.filter(match => match.scope === parts[parts.length - 1])
    if (matches.length === 1 && name) {
      target.set(id, matches[0].sourceRecordId)
      relinked.push({ name, from: id, to: matches[0].sourceRecordId })
    } else unmatched.push({ ...(name ? { name } : {}), sourceRecordId: id })
  }

  const move = <T extends DecisionEntry>(entry: T): T => {
    if (!entry.sourceRecordIds.some(id => target.has(id))) return entry
    const rename = (record: Record<string, string> | undefined) =>
      record &&
      Object.fromEntries(
        Object.entries(record).map(([key, value]) => [target.get(key as SourceRecordId) ?? key, value])
      )
    const fingerprints = rename(entry.fingerprints)
    const names = rename(entry.names)
    return {
      ...entry,
      sourceRecordIds: entry.sourceRecordIds.map(id => target.get(id) ?? id),
      ...(fingerprints ? { fingerprints } : {}),
      ...(names ? { names } : {}),
    }
  }
  return {
    review: {
      ...review,
      timingOverrides: review.timingOverrides?.map(move),
      ignoredRules: review.ignoredRules?.map(move),
      subFactionKeywords: review.subFactionKeywords?.map(entry =>
        entry.armyRules
          ? {
              ...entry,
              armyRules: Object.fromEntries(
                Object.entries(entry.armyRules).map(([keyword, ids]) => [
                  keyword,
                  ids.map(id => target.get(id) ?? id),
                ])
              ),
            }
          : entry
      ),
    },
    relinked,
    unmatched,
  }
}

/** Removes a record from the sub-faction army-rule lists, for a rule Wahapedia no longer has. */
export const removeWh40kSubFactionArmyRule = (
  review: Wh40kSourceReview,
  sourceRecordId: SourceRecordId
): Wh40kSourceReview => ({
  ...review,
  subFactionKeywords: review.subFactionKeywords?.map(entry =>
    entry.armyRules
      ? {
          ...entry,
          armyRules: Object.fromEntries(
            Object.entries(entry.armyRules)
              .map(([keyword, ids]) => [keyword, ids.filter(id => id !== sourceRecordId)] as const)
              .filter(([, ids]) => ids.length > 0)
          ),
        }
      : entry
  ),
})

/**
 * Sets each link disposition's expected count to what it matches now. A disposition that matches
 * nothing any more is removed: the rows it excused are gone.
 */
export const updateWh40kDispositionCounts = (
  review: Wh40kSourceReview,
  matched: ReadonlyMap<string, number>
): Wh40kSourceReview => ({
  ...review,
  linkDispositions: review.linkDispositions
    .map(disposition => ({
      ...disposition,
      expectedCount: matched.get(disposition.id) ?? disposition.expectedCount,
    }))
    .filter(disposition => disposition.expectedCount > 0),
})
