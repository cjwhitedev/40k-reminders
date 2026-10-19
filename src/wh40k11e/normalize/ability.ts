import { normalizeSourceText } from '../../aos4/normalize/text'
import { WH40K_SOURCE_TEXT_OPTIONS, withoutListMarkers } from './sourceText'
import type { Wh40kGameWindow, Wh40kTiming, Wh40kUsagePeriod } from '../domain/timing'
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
// The whole rule is "(While ..., ) <ranged weapons/attacks> have [ASSAULT]"; a rule that also grants something else is not.
const ONLY_ASSAULT =
  /^(?:(?:while|whilst|if)\b[^.]*?,\s*)?(?:(?!\band\b)[^.,\n])*\b(?:ranged (?:attacks|weapons)|weapons)\b(?:(?!\band\b)[^.\n])*\b(?:have|has)\s+(?:the\s+)?\[assault\](?:\s+ability)?\.?$/i
const PASSIVE_SUBJECT =
  /^[^,.:;]{1,80}? (?:units?|models?) (?:from your army|with this ability) (?:have|has|gain|gains|are eligible|is eligible|can ignore)\b/i
// "Eligible to shoot and declare a charge in a turn in which it Advanced" matters in those phases, not all game.
const AFTER_MOVING =
  /\beligible to (shoot|declare a charge)(?: and (shoot|declare a charge))? in a turn in which (?:it|they|that unit|this unit) (?:advanced|fell back)\b(?: or (?:advanced|fell back)\b)?/i
const USES_STRATAGEM =
  /^(?:(?:when|each time|every time|whenever) (?:you (?:target|select)|this [a-z]+ is (?:targeted|selected))|you can (?:target|use))\b/i

const NAMED_PHASE =
  /\b(until )?(?:the )?(?:(start|end) of )?(?:the [a-z-]+ step of )?(your opponent's|your|either player's|the|each|that)? ?(?:(?:first|second|third|next)(?:,? (?:or )?(?:first|second|third))* )?(command|movement|shooting|charge|fight) phase\b/gi
const MAKES_ATTACK = /([^.]*?\b(?:each|every) time\b[^.]*?)\bmakes? an? (ranged |melee )?attack\b/i
const SELECTED_TO =
  /([^.]*?\b(?:each|every) time\b[^.]*?)\bis selected to (shoot|fight)(?: or (shoot|fight))?\b/i
const CHARGED_THIS_TURN = /\b(?:made a charge move|charged) this turn\b/i
const CHARGE_MOVE = /\b(?:makes?|making) a charge move\b/i
const BATTLE_SHOCK =
  /([^.]*?\b(?:each|every) time\b[^.,]*?)\b(?:takes?|fails?|passes?) an? battle-shock test\b/i

const phaseWindow = (
  phase: 'command' | 'movement' | 'shooting' | 'charge' | 'fight',
  perspective: 'your' | 'opponent' | 'either',
  moment: 'start' | 'during' | 'end' = 'during'
): Wh40kGameWindow => ({ kind: 'turn-phase', phase, moment, perspective })

const PHASE_ORDER = ['command', 'movement', 'shooting', 'charge', 'fight']
const MOMENT_ORDER = ['start', 'during', 'end']

/**
 * The phases a standing rule names anywhere in its text, for rules that open like a standing effect
 * ("While ...", "The bearer ...") but matter at set moments. Durations ("until the end of your next
 * Command phase") are not moments. A rule of more than one sentence keeps an Always active window
 * too, since the rest of it may be a standing effect.
 */
export const namedWh40kMoments = (
  text: string,
  printed = text
): { windows: Wh40kGameWindow[]; clue: string } | undefined => {
  const found: Array<{ window: Wh40kGameWindow; clue: string }> = []
  // "each time an enemy model ..." or "While an enemy unit is ..., each time that unit ...".
  const enemyIn = (prefix: string) => {
    const at = prefix.search(/\b(?:each|every) time\b(?![\s\S]*\b(?:each|every) time\b)/i)
    const before = prefix.slice(0, at)
    const subject = prefix.slice(at).replace(/^(?:each|every) time\s*/i, '')
    return (
      /\benemy\b/i.test(subject) || (/^(?:that|those|such)\b/i.test(subject) && /\benemy\b/i.test(before))
    )
  }
  for (const match of Array.from(text.matchAll(NAMED_PHASE))) {
    if (match[1]) continue
    const owner = (match[3] ?? 'the').toLowerCase()
    const parsed = parseWh40kWhen(
      `${match[2] ? `${match[2]} of ` : ''}${owner === 'each' || owner === 'that' ? 'the' : owner} ${match[4]} phase`
    )
    parsed?.windows.forEach(window => found.push({ window, clue: match[0].trim() }))
  }
  const attack = text.match(MAKES_ATTACK)
  if (attack) {
    const side = enemyIn(attack[1]) ? 'opponent' : 'your'
    const kind = attack[2]?.trim().toLowerCase()
    if (kind !== 'melee') found.push({ window: phaseWindow('shooting', side), clue: attack[0] })
    if (kind !== 'ranged') found.push({ window: phaseWindow('fight', 'either'), clue: attack[0] })
  }
  const selected = text.match(SELECTED_TO)
  if (selected) {
    for (const verb of [selected[2], selected[3]].filter(Boolean).map(verb => verb.toLowerCase())) {
      found.push({
        window:
          verb === 'shoot'
            ? phaseWindow('shooting', enemyIn(selected[1]) ? 'opponent' : 'your')
            : phaseWindow('fight', 'either'),
        clue: selected[0],
      })
    }
  }
  const charged = text.match(CHARGED_THIS_TURN)
  if (charged) found.push({ window: phaseWindow('fight', 'your'), clue: charged[0] })
  const chargeMove = text.match(CHARGE_MOVE)
  if (chargeMove) found.push({ window: phaseWindow('charge', 'your'), clue: chargeMove[0] })
  const shock = text.match(BATTLE_SHOCK)
  if (shock) {
    found.push({
      window: phaseWindow('command', enemyIn(shock[1]) ? 'opponent' : 'your'),
      clue: shock[0].trim(),
    })
  }
  if (!found.length) return undefined
  const key = (window: Wh40kGameWindow) => JSON.stringify(window)
  const coveredByEither = (window: Wh40kGameWindow) =>
    window.kind === 'turn-phase' &&
    window.perspective !== 'either' &&
    found.some(({ window: other }) => key(other) === key({ ...window, perspective: 'either' }))
  const rank = (window: Wh40kGameWindow) =>
    window.kind === 'turn-phase'
      ? PHASE_ORDER.indexOf(window.phase) * 3 + MOMENT_ORDER.indexOf(window.moment)
      : -1
  const windows = found
    .map(item => item.window)
    .filter((window, index, all) => all.findIndex(other => key(other) === key(window)) === index)
    .filter(window => !coveredByEither(window))
    .sort((left, right) => rank(left) - rank(right))
  // A list introduced by "... have:" belongs to that sentence.
  const sentences = printed
    .replace(/:[ \t]*(?:\n•[^\n]*)+/g, '.')
    .split(/[.!?]\s+|\n+/)
    .filter(sentence => /[a-z]/i.test(sentence)).length
  return { windows: sentences > 1 ? [{ kind: 'always' }, ...windows] : windows, clue: found[0].clue }
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A rule whose opening sentence uses a named Core stratagem ("you can target this unit with the
 * Rapid Ingress Stratagem for 0CP") is remembered when that stratagem is, so it borrows the
 * stratagem's windows. "Any phase" stratagems stay reactions: they would show in every phase.
 */
export const borrowWh40kStratagemTiming = (
  opening: string,
  stratagems: ReadonlyMap<string, Wh40kTiming>,
  usage?: Wh40kTiming['usage']
): Wh40kTiming | undefined => {
  if (!stratagems.size || !USES_STRATAGEM.test(opening)) return undefined
  const names = Array.from(stratagems.keys()).map(escapeRegExp).join('|')
  const sentence = opening.split(/\.(?:\s|$)/)[0]
  const named = sentence.match(new RegExp(`\\bthe ((?:${names})(?:/(?:${names}))*) stratagem\\b`, 'i'))
  if (!named) return undefined
  const borrowed = named[1].split('/').map(name => stratagems.get(name.toLowerCase()) as Wh40kTiming)
  if (borrowed.some(timing => timing.windows.some(window => window.kind === 'any-phase'))) return undefined
  const trigger = borrowed.length === 1 ? borrowed[0].trigger : undefined
  return {
    windows: borrowed.flatMap(timing => timing.windows),
    raw: `Used with the ${named[1]} Stratagem`,
    ...(trigger ? { trigger } : {}),
    ...(usage ? { usage } : {}),
  }
}

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
  if (PASSIVE.test(rest) || PASSIVE_SUBJECT.test(rest)) {
    if (ONLY_ASSAULT.test(rest.trim())) {
      const timing: Wh40kTiming = {
        windows: [{ kind: 'turn-phase', phase: 'shooting', moment: 'during', perspective: 'your' }],
        raw: 'Grants [ASSAULT], used for assault shooting in your Shooting phase (Core Rules 24.04, 10.05)',
        ...(usage ? { usage } : {}),
      }
      return { ...base, kind: 'timed', timing, diagnostics }
    }
    const afterMoving = rest.match(AFTER_MOVING)
    if (afterMoving) {
      const verbs = [afterMoving[1], afterMoving[2]].map(verb => verb?.toLowerCase())
      const timing: Wh40kTiming = {
        windows: (['shoot', 'declare a charge'] as const)
          .filter(verb => verbs.includes(verb))
          .map(verb => ({
            kind: 'turn-phase',
            phase: verb === 'shoot' ? 'shooting' : 'charge',
            moment: 'during',
            perspective: 'your',
          })),
        raw: `Is ${afterMoving[0]}`,
        ...(usage ? { usage } : {}),
      }
      return { ...base, kind: 'timed', timing, diagnostics }
    }
    const named = namedWh40kMoments(rest, text)
    if (named) {
      const timing: Wh40kTiming = {
        windows: named.windows,
        raw: `Names a moment: ${named.clue}`,
        ...(usage ? { usage } : {}),
      }
      return { ...base, kind: 'timed', timing, diagnostics }
    }
    return { ...base, kind: 'passive', diagnostics }
  }

  diagnostics.push({
    code: 'unclassified-timing',
    severity: 'error',
    message: `Opening phrase is not a recognized timing: ${rest.slice(0, 80)}`,
  })
  return { ...base, kind: 'unclassified', diagnostics }
}
