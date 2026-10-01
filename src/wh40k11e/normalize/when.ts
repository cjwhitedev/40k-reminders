import { normalizeSourceText } from '../../aos4/normalize/text'
import { WH40K_SOURCE_TEXT_OPTIONS, withoutListMarkers } from './sourceText'
import type {
  Wh40kGameWindow,
  Wh40kMoment,
  Wh40kPerspective,
  Wh40kPhaseId,
  Wh40kTiming,
} from '../domain/timing'

export type Wh40kWhenDiagnosticCode = 'missing-when' | 'unparsed-when' | 'unsafe-source-text'

export interface Wh40kWhenDiagnostic {
  code: Wh40kWhenDiagnosticCode
  severity: 'error' | 'warning'
  message: string
}

export interface Wh40kWhenResult {
  /** The safe plain-text rule, with markup removed. */
  text: string
  when?: string
  timing?: Wh40kTiming
  diagnostics: Wh40kWhenDiagnostic[]
}

/** The WHEN clause of a rule printed in the official WHEN / TARGET / EFFECT format. */
export const extractWhenClause = (text: string): string | undefined => {
  const match = text.match(/\bWHEN:\s*([\s\S]*?)(?=\b(?:TARGET|EFFECT|RESTRICTIONS?):|$)/)
  const clause = match?.[1].replace(/\s+/g, ' ').trim()
  return clause || undefined
}

const PHASES = '(command|movement|shooting|charge|fight)'
const OWNER = "(your opponent's|your|either player's|each player's|the|any)"

const perspectiveOf = (owner: string | undefined): Wh40kPerspective =>
  owner === 'your' ? 'your' : owner === "your opponent's" ? 'opponent' : 'either'

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth']

const PART = new RegExp(
  `^(?:the )?(?:(start|end) of )?(?:${OWNER} )?(?:(first |second |third |fourth |fifth )?${PHASES} phase|(phase)|(turn)|(first |second |third |fourth |fifth )?(battle round)|(battle))$`
)
const STEP_PART = new RegExp(
  `^(?:the )?(?:(start|end) of )?(?:the )?([a-z-]+) step of (?:${OWNER} )?${PHASES} phase$`
)

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1)

// A named step ("the Battle-shock step of your Command phase") falls in its stated phase; the
// step wording is kept as trigger text rather than validated, since stratagems print step names
// the Core Rules no longer use.
const parsePart = (
  part: string
): Wh40kGameWindow | { namedStep: string; window: Wh40kGameWindow } | undefined => {
  const step = part.match(STEP_PART)
  if (step) {
    const [, momentText, stepName, owner, phase] = step
    return {
      namedStep: `${momentText ? `${capitalize(momentText)} of the ` : ''}${capitalize(stepName)} step`,
      window: {
        kind: 'turn-phase',
        phase: phase as Wh40kPhaseId,
        moment: 'during',
        perspective: perspectiveOf(owner),
      },
    }
  }
  const match = part.match(PART)
  if (!match) return undefined
  const [, momentText, owner, phaseOrdinal, phase, anyPhase, turn, ordinal, battleRound, battle] = match
  const moment: Wh40kMoment = momentText === 'start' ? 'start' : momentText === 'end' ? 'end' : 'during'
  const perspective = perspectiveOf(owner)
  const roundOf = (value: string | undefined) => ORDINALS.indexOf(value?.trim() ?? '') + 1
  if (phase) {
    const round = roundOf(phaseOrdinal)
    return {
      kind: 'turn-phase',
      phase: phase as Wh40kPhaseId,
      moment,
      perspective,
      ...(round ? { round } : {}),
    }
  }
  if (anyPhase && owner === 'any') return { kind: 'any-phase', moments: [moment], perspective: 'either' }
  if (turn && moment !== 'during') {
    return { kind: 'turn-step', step: moment === 'start' ? 'start-of-turn' : 'end-of-turn', perspective }
  }
  if (battleRound && moment !== 'during') {
    const round = roundOf(ordinal)
    return { kind: 'battle-round', moment, ...(round ? { round } : {}) }
  }
  if (battle && moment !== 'during') return { kind: 'battle', moment }
  return undefined
}

/**
 * Parse a WHEN clause into game windows. Only the official clause grammar is accepted; anything
 * else stays unresolved for review rather than being coerced into a nearby window.
 */
export const parseWh40kWhen = (clause: string): Wh40kTiming | undefined => {
  const normalized = clause
    .replace(/[‘’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '')
    .toLowerCase()
  const comma = normalized.indexOf(',')
  // "End of the Fight phase, or your opponent's Shooting phase, ..." puts an alternative after the comma.
  if (comma >= 0 && /^,\s*or\b/.test(normalized.slice(comma))) return undefined
  const head = comma >= 0 ? normalized.slice(0, comma) : normalized
  const trigger =
    comma >= 0
      ? clause
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\.$/, '')
          .slice(comma + 1)
          .trim()
      : undefined

  const expanded = head
    .replace(new RegExp(`(?:${OWNER} )?${PHASES} or ${PHASES} phase`, 'g'), (_, owner, first, second) => {
      const prefix = owner ? `${owner} ` : ''
      return `${prefix}${first} phase or ${prefix}${second} phase`
    })
    .replace(/^start or end of any phase$/, 'start of any phase or end of any phase')

  const windows: Wh40kGameWindow[] = []
  const steps: string[] = []
  for (const part of expanded.split(/ or /)) {
    const parsed = parsePart(part.trim())
    if (!parsed) return undefined
    if ('namedStep' in parsed) {
      windows.push(parsed.window)
      steps.push(parsed.namedStep)
    } else {
      windows.push(parsed)
    }
  }
  if (!windows.length) return undefined
  const combinedTrigger = [...steps, trigger].filter(Boolean).join('; ')
  return {
    windows,
    ...(combinedTrigger ? { trigger: combinedTrigger } : {}),
    raw: clause.replace(/\s+/g, ' ').trim(),
  }
}

/** Normalize a Wahapedia rule description to safe text and parse its WHEN clause. */
export const parseWh40kRuleTiming = (descriptionHtml: string): Wh40kWhenResult => {
  const source = normalizeSourceText(descriptionHtml, WH40K_SOURCE_TEXT_OPTIONS)
  const diagnostics: Wh40kWhenDiagnostic[] = source.diagnostics
    .filter(diagnostic => diagnostic.severity === 'error')
    .map(diagnostic => ({ code: 'unsafe-source-text', severity: 'error', message: diagnostic.message }))
  const when = extractWhenClause(withoutListMarkers(source.text))
  if (!when) {
    diagnostics.push({ code: 'missing-when', severity: 'error', message: 'Rule text has no WHEN clause' })
    return { text: source.text, diagnostics }
  }
  const timing = parseWh40kWhen(when)
  if (!timing) {
    diagnostics.push({
      code: 'unparsed-when',
      severity: 'error',
      message: `WHEN clause is outside the grammar: ${when}`,
    })
  }
  return { text: source.text, when, ...(timing ? { timing } : {}), diagnostics }
}
