import { normalizeSourceText } from '../../aos4/normalize/text'
import { WH40K_SOURCE_TEXT_OPTIONS, withoutListMarkers } from './sourceText'
import type { Wh40kTiming, Wh40kUsagePeriod } from '../domain/timing'
import { expandWh40kPhaseLists, parseWh40kWhen } from './when'

export type Wh40kAbilityTimingKind = 'timed' | 'reaction' | 'passive' | 'unclassified'

export interface Wh40kAbilityTimingResult {
  /** The safe plain-text rule, with any enhancement eligibility line removed. */
  text: string
  /** The text after the eligibility line, usage limit and any leading condition, which decided `kind`. */
  opening: string
  kind: Wh40kAbilityTimingKind
  timing?: Wh40kTiming
  usage?: Wh40kTiming['usage']
  /** Eligibility printed before an enhancement's rule, e.g. "Warlord model only." */
  eligibility?: string
  /** Army faction condition an army rule opens with, e.g. "ADEPTUS ASTARTES". */
  armyFaction?: string
  diagnostics: Array<{
    code: 'unsafe-source-text' | 'unclassified-timing'
    severity: 'error'
    message: string
  }>
}

const ELIGIBILITY = /^([^.\n]{1,160}? only(?: \([^)\n]*\))?)\.\s*/i
const ARMY_FACTION = /^if your army faction is ([^,]+),\s*/i
const USAGE =
  /^\(?(once|twice) per (battle round|battle|turn|phase)(?: for each [^,]+)?(?:, per (?:unit|army|player|model))?\)?[,:]?\s*/i
const TIMED =
  /^(?:(?:in|at|during) |(?=(?:the )?(?:start|end) of ))([^,]+?)(?: \([^)]*\))?(?:,| (?=you can\b))/i
// A named step outside any phase ("the Read Mission Objectives step") is a pre-battle step; steps
// inside a phase ("the Battle-shock step of your Command phase") are parsed as phase windows.
const PRE_BATTLE =
  /^(?:in|at the start of|at the end of|during|before the battle, in) the ((?:[a-z-]+ ){1,4}step)\b(?! of)/i
const REACTION =
  /^(?:each time|every time|when|whenever|the first time|after|just after|before|one (?:unit|model) from your army with this ability can use it when|you can target|you can use the [a-z' -]{1,40}? stratagem|you can change|at the end of (?:a|the|any) phase in which)\b/i
const PASSIVE =
  /^(?:while|whilst|if|unless otherwise stated|for the purposes of|this (?:model|unit|officer|[a-z-]+ model)\b|this [a-z' -]{1,40}? can issue\b|the bearer|models in (?:this|the bearer's) unit|each model in this unit|friendly|enemy units|attacks that target|ranged weapons|melee weapons|weapons equipped|add \d|subtract \d|you can re-roll|you can ignore|units can|improve|worsen|you cannot include|your army cannot|your army can only include|you cannot re-roll|enemy models cannot|(?:ranged |melee )?attacks that target|(?:the area|certain areas) of the battlefield|in a turn\b|attacks (?:allocated to|made by)|each enemy unit|being (?:engaged|battle-shocked)|the [a-z, ]{1,80}? doctrines? (?:is|are) active)\b/i
// "While this model is leading a unit, in your Command phase, ...": a standing condition before a window.
const CONDITION_CLAUSE = /^(?:while|whilst|if)\b[^.:;]*?,\s*/i
const PASSIVE_SUBJECT =
  /^[^,.:;]{1,80}? (?:units?|models?) (?:from your army|with this ability) (?:have|has|gain|gains|are eligible|is eligible|can ignore)\b/i

const timedWindow = (clause: string): Wh40kTiming | undefined => {
  const timed = clause.match(TIMED)
  if (!timed) return undefined
  // "In your Shooting phase and the Fight phase" lists two windows, like the WHEN clause's "or".
  return parseWh40kWhen(
    timed[1]
      .replace(/ and /g, ' or ')
      .replace(/^the end of each phase$/i, 'end of any phase')
      .replace(/^the start of (?:each|a) phase$/i, 'start of any phase')
  )
}

/** The clause after a leading condition, when that clause opens with a window; otherwise unchanged. */
const afterCondition = (rest: string): string => {
  const condition = rest.match(CONDITION_CLAUSE)
  if (!condition) return rest
  const after = rest.slice(condition[0].length)
  return PRE_BATTLE.test(after) || timedWindow(after) ? after : rest
}

const USAGE_PERIODS: Record<string, Wh40kUsagePeriod> = {
  'battle round': 'battle-round',
  battle: 'battle',
  turn: 'turn',
  phase: 'phase',
}

/**
 * Classify a prose ability, detachment rule, or enhancement by its opening phrase. Only listed
 * openers are recognized; anything else stays unclassified for review instead of being guessed.
 */
export const parseWh40kAbilityTiming = (
  descriptionHtml: string,
  options: { eligibilityLine?: boolean } = {}
): Wh40kAbilityTimingResult => {
  const source = normalizeSourceText(descriptionHtml, WH40K_SOURCE_TEXT_OPTIONS)
  const diagnostics: Wh40kAbilityTimingResult['diagnostics'] = source.diagnostics
    .filter(diagnostic => diagnostic.severity === 'error')
    .map(diagnostic => ({ code: 'unsafe-source-text', severity: 'error', message: diagnostic.message }))

  let text = source.text
  let eligibility: string | undefined
  if (options.eligibilityLine) {
    const match = text.match(ELIGIBILITY)
    if (match) {
      eligibility = match[1]
      text = text.slice(match[0].length)
    }
  }

  let rest = withoutListMarkers(text).replace(/[‘’`]/g, "'")
  let armyFaction: string | undefined
  const armyFactionMatch = rest.match(ARMY_FACTION)
  if (armyFactionMatch) {
    armyFaction = armyFactionMatch[1].trim()
    rest = rest.slice(armyFactionMatch[0].length)
  }
  let usage: Wh40kTiming['usage']
  const usageMatch = rest.match(USAGE)
  if (usageMatch) {
    usage = {
      limit: usageMatch[1].toLowerCase() === 'twice' ? 2 : 1,
      period: USAGE_PERIODS[usageMatch[2].toLowerCase()],
    }
    rest = rest.slice(usageMatch[0].length)
  }
  rest = afterCondition(expandWh40kPhaseLists(rest))

  const base = {
    text,
    opening: rest,
    ...(eligibility ? { eligibility } : {}),
    ...(armyFaction ? { armyFaction } : {}),
    ...(usage ? { usage } : {}),
  }
  const preBattle = rest.match(PRE_BATTLE)
  if (preBattle) {
    const step = preBattle[1].replace(/\b\w/g, letter => letter.toUpperCase()).replace(/ Step$/, ' step')
    const timing: Wh40kTiming = {
      windows: [{ kind: 'pre-battle', step }],
      raw: preBattle[0],
      ...(usage ? { usage } : {}),
    }
    return { ...base, kind: 'timed', timing, diagnostics }
  }
  const timed = timedWindow(rest)
  if (timed) {
    return { ...base, kind: 'timed', timing: { ...timed, ...(usage ? { usage } : {}) }, diagnostics }
  }
  // "At the end of a phase in which this model is destroyed" reads as a window but is a trigger.
  if (REACTION.test(rest)) return { ...base, kind: 'reaction', diagnostics }
  if (PASSIVE.test(rest) || PASSIVE_SUBJECT.test(rest)) return { ...base, kind: 'passive', diagnostics }

  diagnostics.push({
    code: 'unclassified-timing',
    severity: 'error',
    message: `Opening phrase is not a recognized timing: ${rest.slice(0, 80)}`,
  })
  return { ...base, kind: 'unclassified', diagnostics }
}
