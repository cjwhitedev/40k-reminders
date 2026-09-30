import { normalizeSourceText } from '../../aos4/normalize/text'
import type { Wh40kTiming, Wh40kUsagePeriod } from '../domain/timing'
import { parseWh40kWhen } from './when'

export type Wh40kAbilityTimingKind = 'timed' | 'reaction' | 'passive' | 'unclassified'

export interface Wh40kAbilityTimingResult {
  /** The safe plain-text rule, with any enhancement eligibility line removed. */
  text: string
  kind: Wh40kAbilityTimingKind
  timing?: Wh40kTiming
  usage?: Wh40kTiming['usage']
  /** Eligibility printed before an enhancement's rule, e.g. "Warlord model only." */
  eligibility?: string
  diagnostics: Array<{
    code: 'unsafe-source-text' | 'unclassified-timing'
    severity: 'error'
    message: string
  }>
}

const ELIGIBILITY = /^([^.\n]{1,160}? only(?: \([^)\n]*\))?)\.\s*/i
const USAGE = /^\(?once per (battle round|battle|turn|phase)(?:, per (?:unit|army|player|model))?\)?[,:]?\s*/i
const TIMED = /^(?:in|at|during) ([^,]+?)(?: \([^)]*\))?,/i
const PRE_BATTLE =
  /^(?:in|at the start of|at the end of|during) the ((?:declare battle formations|deploy armies|redeploy units|determine first turn|muster armies) step)\b/i
const REACTION =
  /^(?:each time|every time|when|whenever|the first time|after|just after|one (?:unit|model) from your army with this ability can use it when)\b/i
const PASSIVE =
  /^(?:while|if|this (?:model|unit)|the bearer|models in (?:this|the bearer's) unit|each model in this unit|friendly|enemy units|ranged weapons|melee weapons|weapons equipped|add \d|subtract \d|you can re-roll|units can|improve|worsen)\b/i

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
  const source = normalizeSourceText(descriptionHtml)
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

  let rest = text.replace(/[‘’`]/g, "'")
  let usage: Wh40kTiming['usage']
  const usageMatch = rest.match(USAGE)
  if (usageMatch) {
    usage = { limit: 1, period: USAGE_PERIODS[usageMatch[1].toLowerCase()] }
    rest = rest.slice(usageMatch[0].length)
  }

  const base = { text, ...(eligibility ? { eligibility } : {}), ...(usage ? { usage } : {}) }
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
  const timed = rest.match(TIMED)
  if (timed) {
    // "In your Shooting phase and the Fight phase" lists two windows, like the WHEN clause's "or".
    const timing = parseWh40kWhen(timed[1].replace(/ and /g, ' or '))
    if (timing) {
      return { ...base, kind: 'timed', timing: { ...timing, ...(usage ? { usage } : {}) }, diagnostics }
    }
  } else if (REACTION.test(rest)) {
    return { ...base, kind: 'reaction', diagnostics }
  } else if (PASSIVE.test(rest)) {
    return { ...base, kind: 'passive', diagnostics }
  }

  diagnostics.push({
    code: 'unclassified-timing',
    severity: 'error',
    message: `Opening phrase is not a recognized timing: ${rest.slice(0, 80)}`,
  })
  return { ...base, kind: 'unclassified', diagnostics }
}
