import type { SourceRecordId } from '../../aos4/domain'
import type { Wh40kCatalog, Wh40kRule } from '../domain/rules'

export interface Wh40kArmySelection {
  factionId: string
  detachmentId?: string
  datasheetIds: SourceRecordId[]
  /** Chosen enhancement rules; enhancements are optional picks, not granted by the detachment. */
  enhancementIds?: SourceRecordId[]
  allowsLegends?: boolean
}

export type Wh40kSelectionCause =
  | { kind: 'core' }
  | { kind: 'army-faction'; factionId: string }
  | { kind: 'detachment'; detachmentId: string }
  | { kind: 'enhancement' }
  | { kind: 'datasheet'; datasheetId: SourceRecordId; parameter?: string }

export interface Wh40kSelectedRule {
  rule: Wh40kRule
  causes: Wh40kSelectionCause[]
}

export type Wh40kSelectionDiagnosticCode =
  | 'unknown-faction'
  | 'unknown-detachment'
  | 'detachment-outside-faction'
  | 'detachment-not-matched-play'
  | 'unknown-datasheet'
  | 'legends-not-allowed'
  | 'datasheet-outside-faction'
  | 'unknown-enhancement'
  | 'enhancement-outside-detachment'

export interface Wh40kSelectionDiagnostic {
  code: Wh40kSelectionDiagnosticCode
  severity: 'error' | 'warning'
  message: string
}

export interface Wh40kSelectionResult {
  selected: Wh40kSelectedRule[]
  diagnostics: Wh40kSelectionDiagnostic[]
}

const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

/**
 * Resolve an army to the matched-play rules that apply to it: core stratagems, army-wide faction
 * rules, the detachment's rules and stratagems, chosen enhancements, and each unit's own and shared
 * abilities. Each rule records every cause that selected it.
 */
export const selectWh40kRules = (
  catalog: Wh40kCatalog,
  selection: Wh40kArmySelection
): Wh40kSelectionResult => {
  const diagnostics: Wh40kSelectionDiagnostic[] = []
  const diagnose = (code: Wh40kSelectionDiagnosticCode, severity: 'error' | 'warning', message: string) =>
    diagnostics.push({ code, severity, message })
  const selected = new Map<SourceRecordId, Wh40kSelectedRule>()
  const rules = new Map(catalog.rules.map(rule => [rule.sourceRecordId, rule]))
  const select = (rule: Wh40kRule | undefined, cause: Wh40kSelectionCause) => {
    if (!rule || rule.gameMode !== 'matched-play') return
    const entry = selected.get(rule.sourceRecordId) ?? { rule, causes: [] }
    entry.causes.push(cause)
    selected.set(rule.sourceRecordId, entry)
  }

  if (!catalog.factions.some(faction => faction.id === selection.factionId)) {
    diagnose('unknown-faction', 'error', `Unknown faction ${selection.factionId}`)
  }

  for (const rule of catalog.rules) {
    if (rule.kind === 'core-stratagem') select(rule, { kind: 'core' })
  }

  // Army rules no datasheet carries (e.g. Space Marine Chapters) apply to the whole army.
  const carried = new Set(catalog.datasheets.flatMap(sheet => sheet.sharedRules.map(shared => shared.ruleId)))
  for (const rule of catalog.rules) {
    if (
      rule.kind === 'army-rule' &&
      rule.scope.kind === 'faction' &&
      rule.scope.factionId === selection.factionId &&
      !carried.has(rule.sourceRecordId)
    ) {
      select(rule, { kind: 'army-faction', factionId: selection.factionId })
    }
  }

  const detachment = catalog.detachments.find(item => item.id === selection.detachmentId)
  if (selection.detachmentId && !detachment) {
    diagnose('unknown-detachment', 'error', `Unknown detachment ${selection.detachmentId}`)
  } else if (detachment) {
    if (detachment.factionId !== selection.factionId) {
      diagnose(
        'detachment-outside-faction',
        'error',
        `${detachment.name} belongs to faction ${detachment.factionId}`
      )
    }
    if (detachment.gameMode !== 'matched-play') {
      diagnose(
        'detachment-not-matched-play',
        'error',
        `${detachment.name} is a ${detachment.gameMode} detachment`
      )
    }
    for (const rule of catalog.rules) {
      if (
        (rule.kind === 'detachment-rule' || rule.kind === 'stratagem') &&
        rule.scope.kind === 'detachment' &&
        rule.scope.detachmentId === detachment.id
      ) {
        select(rule, { kind: 'detachment', detachmentId: detachment.id })
      }
    }
  }

  for (const enhancementId of selection.enhancementIds ?? []) {
    const rule = rules.get(enhancementId)
    if (!rule || rule.kind !== 'enhancement') {
      diagnose('unknown-enhancement', 'error', `Unknown enhancement ${enhancementId}`)
    } else if (rule.scope.kind !== 'detachment' || rule.scope.detachmentId !== detachment?.id) {
      diagnose(
        'enhancement-outside-detachment',
        'error',
        `${rule.name} is not an enhancement of the chosen detachment`
      )
    } else {
      select(rule, { kind: 'enhancement' })
    }
  }

  const datasheets = new Map(catalog.datasheets.map(sheet => [sheet.sourceRecordId, sheet]))
  const ownRules = new Map<SourceRecordId, Wh40kRule[]>()
  for (const rule of catalog.rules) {
    if (rule.scope.kind !== 'datasheet') continue
    ownRules.set(rule.scope.datasheetId, [...(ownRules.get(rule.scope.datasheetId) ?? []), rule])
  }
  for (const datasheetId of selection.datasheetIds) {
    const sheet = datasheets.get(datasheetId)
    if (!sheet) {
      diagnose('unknown-datasheet', 'error', `Unknown or excluded datasheet ${datasheetId}`)
      continue
    }
    if (sheet.context === 'legends' && !selection.allowsLegends) {
      diagnose(
        'legends-not-allowed',
        'error',
        `${sheet.name} is a Legends datasheet and the army does not allow Legends`
      )
      continue
    }
    if (sheet.factionId !== selection.factionId) {
      diagnose('datasheet-outside-faction', 'warning', `${sheet.name} belongs to faction ${sheet.factionId}`)
    }
    for (const rule of ownRules.get(datasheetId) ?? []) select(rule, { kind: 'datasheet', datasheetId })
    for (const shared of sheet.sharedRules) {
      select(rules.get(shared.ruleId), {
        kind: 'datasheet',
        datasheetId,
        ...(shared.parameter ? { parameter: shared.parameter } : {}),
      })
    }
  }

  return {
    selected: Array.from(selected.values()).sort((left, right) =>
      compare(left.rule.sourceRecordId, right.rule.sourceRecordId)
    ),
    diagnostics,
  }
}
