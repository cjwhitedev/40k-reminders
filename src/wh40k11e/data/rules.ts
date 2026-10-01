import type { SourceRecordId } from '../../aos4/domain'
import { normalizeSourceText } from '../../aos4/normalize/text'
import type {
  Wh40kCatalog,
  Wh40kDatasheet,
  Wh40kDetachment,
  Wh40kRule,
  Wh40kRuleKind,
  Wh40kRuleScope,
  Wh40kTimingKind,
} from '../domain/rules'
import type { Wh40kTiming } from '../domain/timing'
import { parseWh40kAbilityTiming } from '../normalize/ability'
import { WH40K_SOURCE_TEXT_OPTIONS } from '../normalize/sourceText'
import { parseWh40kRuleTiming } from '../normalize/when'
import type { Wh40kReviewedSources } from './review'
import { compareCodeUnits, type Wh40kWahapediaRecord } from './wahapedia/decode'
import type { Wh40kLinkedDatasheet, Wh40kWahapediaLinkedDataset } from './wahapedia/link'

export type { Wh40kRule, Wh40kRuleKind, Wh40kRuleScope } from '../domain/rules'

export interface Wh40kRuleBuildResult {
  rules: Wh40kRule[]
  unresolved: Array<{ sourceRecordId: SourceRecordId; kind: Wh40kRuleKind; name: string; reason: string }>
}

type Records = Record<string, Wh40kWahapediaRecord[]>

const safeText = (html: string): string => normalizeSourceText(html, WH40K_SOURCE_TEXT_OPTIONS).text

const numberOrUndefined = (value: string): number | undefined =>
  /^\d+$/.test(value.trim()) ? Number(value) : undefined

const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .replace(/(^|[\s(-])([a-z])/g, (_, gap: string, letter: string) => gap + letter.toUpperCase())

/**
 * Build one rule per reminder-relevant record in the reviewed current dataset, with its scope,
 * safe text, cost, and timing. Excluded, ignored, and non-current records are left out.
 */
export const buildWh40kRules = (
  records: Records,
  linked: Wh40kWahapediaLinkedDataset,
  reviewed: Wh40kReviewedSources
): Wh40kRuleBuildResult => {
  const excluded = new Set([...reviewed.excludedSourceRecordIds, ...reviewed.ignoredSourceRecordIds])
  const armyRules = new Set(reviewed.armyRuleSourceRecordIds)
  const detachments = new Map(records['Detachments.csv'].map(record => [record.values.id, record]))
  const rules: Wh40kRule[] = []
  const unresolved: Wh40kRuleBuildResult['unresolved'] = []

  const add = (
    record: Wh40kWahapediaRecord,
    rule: Omit<Wh40kRule, 'sourceRecordId' | 'timingKind' | 'timing' | 'timingSource' | 'gameMode'>,
    parsed: { kind: Wh40kTimingKind; timing?: Wh40kTiming; reason?: string },
    gameMode: Wh40kRule['gameMode'] = 'matched-play'
  ) => {
    const override = reviewed.timingOverrides.get(record.sourceRecordId)
    const timing: Wh40kTiming | undefined = override
      ? override.windows
        ? {
            windows: override.windows,
            raw: override.reason,
            ...(override.trigger ? { trigger: override.trigger } : {}),
            ...(override.usage ? { usage: override.usage } : {}),
          }
        : undefined
      : parsed.timing
    const timingKind = override ? override.kind : parsed.kind
    const timingSource = override ? 'reviewed' : timingKind === 'unclassified' ? 'unresolved' : 'printed'
    if (timingSource === 'unresolved') {
      unresolved.push({
        sourceRecordId: record.sourceRecordId,
        kind: rule.kind,
        name: rule.name,
        reason: parsed.reason ?? 'unclassified timing',
      })
    }
    rules.push({
      sourceRecordId: record.sourceRecordId,
      ...rule,
      gameMode,
      timingKind,
      ...(timing ? { timing } : {}),
      timingSource,
    })
  }

  const prose = (html: string, eligibilityLine = false) => {
    const parsed = parseWh40kAbilityTiming(html, { eligibilityLine })
    return {
      parsed: {
        kind: parsed.kind,
        ...(parsed.timing ? { timing: parsed.timing } : {}),
        ...(parsed.diagnostics[0] ? { reason: parsed.diagnostics[0].message } : {}),
      },
      text: parsed.text,
      gates: {
        ...(parsed.eligibility ? { condition: parsed.eligibility } : {}),
        ...(parsed.armyFaction ? { armyFaction: parsed.armyFaction } : {}),
      },
    }
  }

  const detachmentMode = (detachmentId: string): Wh40kRule['gameMode'] =>
    detachments.get(detachmentId)?.values.type === 'Boarding Actions' ? 'boarding-actions' : 'matched-play'

  for (const record of records['Stratagems.csv']) {
    if (excluded.has(record.sourceRecordId)) continue
    const values = record.values
    const cost = numberOrUndefined(values.cp_cost)
    if (armyRules.has(record.sourceRecordId)) {
      // Reviewed army-rule rows (e.g. Aeldari Agile Manoeuvres) print TRIGGER/EFFECT, not WHEN.
      const text = safeText(values.description)
      add(
        record,
        {
          kind: 'army-rule',
          name: titleCase(values.name),
          text,
          scope: { kind: 'faction', factionId: values.faction_id },
        },
        /^TRIGGER:/.test(text)
          ? { kind: 'reaction' }
          : { kind: 'unclassified', reason: 'army rule without TRIGGER' }
      )
      continue
    }
    const parsed = parseWh40kRuleTiming(values.description)
    const scope: Wh40kRuleScope = values.detachment_id
      ? { kind: 'detachment', factionId: values.faction_id, detachmentId: values.detachment_id }
      : values.faction_id
        ? { kind: 'faction', factionId: values.faction_id }
        : { kind: 'all-armies' }
    add(
      record,
      {
        kind: scope.kind === 'all-armies' ? 'core-stratagem' : 'stratagem',
        name: titleCase(values.name),
        text: parsed.text,
        scope,
        ...(cost !== undefined ? { cost: { kind: 'command-points', value: cost } } : {}),
      },
      parsed.timing
        ? { kind: 'timed', timing: parsed.timing }
        : { kind: 'unclassified', reason: parsed.diagnostics[0]?.message ?? 'no timing' },
      values.detachment_id ? detachmentMode(values.detachment_id) : 'matched-play'
    )
  }

  for (const record of records['Abilities.csv']) {
    if (excluded.has(record.sourceRecordId)) continue
    const values = record.values
    if (!values.faction_id) {
      // Universal core abilities: Wahapedia prints the Core Rules section, so timing is reviewed.
      add(
        record,
        {
          kind: 'core-ability',
          name: values.name,
          text: safeText(values.description),
          scope: { kind: 'all-armies' },
        },
        { kind: 'unclassified', reason: 'core ability timing requires review' }
      )
      continue
    }
    const { parsed, text, gates } = prose(values.description)
    add(
      record,
      {
        kind: 'army-rule',
        name: values.name,
        text,
        scope: { kind: 'faction', factionId: values.faction_id },
        ...gates,
      },
      parsed
    )
  }

  for (const record of records['Detachment_abilities.csv']) {
    if (excluded.has(record.sourceRecordId)) continue
    const values = record.values
    const { parsed, text, gates } = prose(values.description)
    add(
      record,
      {
        kind: 'detachment-rule',
        name: values.name,
        text,
        scope: { kind: 'detachment', factionId: values.faction_id, detachmentId: values.detachment_id },
        ...gates,
      },
      parsed,
      detachmentMode(values.detachment_id)
    )
  }

  for (const record of records['Enhancements.csv']) {
    if (excluded.has(record.sourceRecordId)) continue
    const values = record.values
    const { parsed, text, gates } = prose(values.description, true)
    const cost = numberOrUndefined(values.cost)
    add(
      record,
      {
        kind: 'enhancement',
        name: values.name,
        text,
        scope: { kind: 'detachment', factionId: values.faction_id, detachmentId: values.detachment_id },
        ...(cost !== undefined ? { cost: { kind: 'points', value: cost } } : {}),
        ...gates,
      },
      parsed,
      detachmentMode(values.detachment_id)
    )
  }

  const byId = new Map(linked.datasheets.map(sheet => [sheet.record.sourceRecordId, sheet]))
  const offeredDatasheets = Array.from(reviewed.datasheetContexts)
    .filter(([, context]) => context !== 'excluded')
    .map(([datasheetId]) => datasheetId)
    .sort(compareCodeUnits)
  for (const datasheetId of offeredDatasheets) {
    const sheet = byId.get(datasheetId) as Wh40kLinkedDatasheet
    for (const { record, shared } of sheet.abilities) {
      if (excluded.has(record.sourceRecordId)) continue
      // Shared core and faction abilities are rules of their own; the datasheet only references them.
      if (shared) continue
      const { parsed, text, gates } = prose(record.values.description)
      add(
        record,
        {
          kind: 'datasheet-ability',
          name: record.values.name,
          text,
          scope: { kind: 'datasheet', datasheetId },
          ...(record.values.parameter ? { parameter: record.values.parameter } : {}),
          ...gates,
        },
        parsed
      )
    }
  }

  rules.sort((left, right) => compareCodeUnits(left.sourceRecordId, right.sourceRecordId))
  unresolved.sort((left, right) => compareCodeUnits(left.sourceRecordId, right.sourceRecordId))
  return { rules, unresolved }
}

/** The source-independent catalog army selection and reminders consume. */
export const buildWh40kCatalog = (
  records: Records,
  linked: Wh40kWahapediaLinkedDataset,
  reviewed: Wh40kReviewedSources,
  rules: Wh40kRule[]
): Wh40kCatalog => {
  const ruleIds = new Set(rules.map(rule => rule.sourceRecordId))
  const datasheets: Wh40kDatasheet[] = []
  for (const sheet of linked.datasheets) {
    const context = reviewed.datasheetContexts.get(sheet.record.sourceRecordId)
    if (context !== 'current' && context !== 'legends') continue
    datasheets.push({
      sourceRecordId: sheet.record.sourceRecordId,
      name: sheet.record.values.name,
      factionId: sheet.record.values.faction_id,
      context,
      sharedRules: sheet.abilities.flatMap(({ record, shared }) =>
        shared && ruleIds.has(shared.sourceRecordId)
          ? [
              {
                ruleId: shared.sourceRecordId,
                ...(record.values.parameter ? { parameter: record.values.parameter } : {}),
              },
            ]
          : []
      ),
    })
  }
  const detachments: Wh40kDetachment[] = records['Detachments.csv'].map(record => ({
    id: record.values.id,
    name: record.values.name,
    factionId: record.values.faction_id,
    gameMode: record.values.type === 'Boarding Actions' ? 'boarding-actions' : 'matched-play',
  }))
  return {
    factions: records['Factions.csv']
      .map(record => ({
        id: record.values.id,
        name: record.values.name,
        armyFactionKeywords: reviewed.armyFactionKeywords.get(record.values.id) ?? [],
      }))
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
    detachments: detachments.sort((left, right) => compareCodeUnits(left.id, right.id)),
    datasheets: datasheets.sort((left, right) => compareCodeUnits(left.sourceRecordId, right.sourceRecordId)),
    rules,
  }
}
