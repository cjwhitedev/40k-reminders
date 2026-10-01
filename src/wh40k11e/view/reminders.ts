import type { SourceRecordId } from '../../aos4/domain'
import type { Wh40kCatalog, Wh40kRule } from '../domain/rules'
import type { Wh40kUsagePeriod } from '../domain/timing'
import { groupWh40kReminders, projectWh40kReminders, type Wh40kReminder } from '../reminders/projectReminders'
import { selectWh40kRules } from '../select/selectRules'
import type { Wh40kArmyDocument } from '../state/armyDocument'

export type Wh40kReminderTagTone =
  | 'cost'
  | 'kind-active'
  | 'kind-reaction'
  | 'kind-passive'
  | 'turn-your'
  | 'turn-enemy'
  | 'turn-neutral'
  | 'usage'
  | 'source'
  | 'provenance'

export interface Wh40kReminderTag {
  label: string
  tone: Wh40kReminderTagTone
  description: string
}

export interface Wh40kReminderSection {
  label?: string
  text: string
}

export interface Wh40kReminderViewModel {
  id: string
  name: string
  windowKey: string
  windowLabel: string
  tags: Wh40kReminderTag[]
  /** The printed text, one entry per paragraph; stratagems keep their WHEN/TARGET/EFFECT labels. */
  sections: Wh40kReminderSection[]
  effect: string
  hidden: boolean
  note?: string
  order?: number
  /** 40K reminders cite no source records yet; kept for the shared reminder card. */
  sourceRecordIndexes: number[]
}

const KIND_LABEL: Record<Wh40kRule['kind'], string> = {
  'core-stratagem': 'Core Stratagem',
  stratagem: 'Stratagem',
  'army-rule': 'Army Rule',
  'detachment-rule': 'Detachment Rule',
  enhancement: 'Enhancement',
  'core-ability': 'Core Ability',
  'datasheet-ability': 'Ability',
}

const KIND_DESCRIPTION: Record<Wh40kRule['kind'], string> = {
  'core-stratagem': 'A Core Rules stratagem every army can use.',
  stratagem: "One of your detachment's stratagems.",
  'army-rule': "Your army faction's rule.",
  'detachment-rule': "Your detachment's rule.",
  enhancement: 'An enhancement one of your characters carries.',
  'core-ability': 'A Core Rules ability printed on your units.',
  'datasheet-ability': "Printed on a unit's datasheet.",
}

const USAGE_PERIOD: Record<Wh40kUsagePeriod, string> = {
  phase: 'phase',
  turn: 'turn',
  'battle-round': 'battle round',
  battle: 'battle',
}

const LABELLED_LINE = /^([A-Z][A-Z ]{2,20}):\s*(.*)$/

const titleCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase()

export const splitWh40kRuleText = (text: string): Wh40kReminderSection[] =>
  text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const labelled = LABELLED_LINE.exec(line)
      return labelled ? { label: titleCase(labelled[1]), text: labelled[2] } : { text: line }
    })

const perspectiveTag = (reminder: Wh40kReminder): Wh40kReminderTag | undefined => {
  if (!('perspective' in reminder.window)) return undefined
  switch (reminder.window.perspective) {
    case 'your':
      return { label: 'Your turn', tone: 'turn-your', description: 'Only during your own turn.' }
    case 'opponent':
      return { label: 'Opponent turn', tone: 'turn-enemy', description: "Only during your opponent's turn." }
    default:
      return undefined
  }
}

const tagsFor = (reminder: Wh40kReminder, datasheetNames: Map<string, string>): Wh40kReminderTag[] => {
  const tags: Wh40kReminderTag[] = [
    { label: KIND_LABEL[reminder.kind], tone: 'provenance', description: KIND_DESCRIPTION[reminder.kind] },
  ]
  const turn = perspectiveTag(reminder)
  if (turn) tags.push(turn)
  if (reminder.cost?.kind === 'command-points') {
    tags.push({
      label: `${reminder.cost.value} CP`,
      tone: 'cost',
      description: `Costs ${reminder.cost.value} command point${reminder.cost.value === 1 ? '' : 's'} to use.`,
    })
  }
  if (reminder.usage) {
    const period = USAGE_PERIOD[reminder.usage.period]
    tags.push({
      label: `${reminder.usage.limit} / ${period}`,
      tone: 'usage',
      description: `Can be used ${reminder.usage.limit} time${reminder.usage.limit === 1 ? '' : 's'} per ${period}.`,
    })
  }
  const carriers = Array.from(
    new Set(
      reminder.causes.flatMap(cause =>
        cause.kind === 'datasheet' ? [datasheetNames.get(cause.datasheetId) ?? ''] : []
      )
    )
  )
    .filter(Boolean)
    .sort()
  for (const name of carriers) {
    tags.push({ label: name, tone: 'source', description: `Printed on your ${name} datasheet.` })
  }
  return tags
}

/** The army's reminders in game order, with the player's hidden flags, notes, and ordering applied. */
export const createWh40kReminderViewModels = (
  catalog: Wh40kCatalog,
  document: Wh40kArmyDocument
): Wh40kReminderViewModel[] => {
  const selection = selectWh40kRules(catalog, {
    factionId: document.factionId,
    ...(document.detachmentId ? { detachmentId: document.detachmentId } : {}),
    datasheetIds: document.datasheetIds as SourceRecordId[],
    enhancementIds: document.enhancementIds as SourceRecordId[],
    allowsLegends: document.allowsLegends,
  })
  const datasheetNames = new Map<string, string>(
    catalog.datasheets.map(sheet => [sheet.sourceRecordId, sheet.name])
  )
  return groupWh40kReminders(projectWh40kReminders(selection.selected)).flatMap(group =>
    group.reminders
      .map((reminder, index) => {
        const preference = document.reminderPreferences[reminder.id] ?? {}
        const view: Wh40kReminderViewModel = {
          id: reminder.id,
          name: reminder.name,
          windowKey: group.key,
          windowLabel: group.label,
          tags: tagsFor(reminder, datasheetNames),
          sections: [
            ...(reminder.trigger && reminder.lane === 'reaction'
              ? [{ label: 'Trigger', text: reminder.trigger }]
              : []),
            ...splitWh40kRuleText(reminder.text),
          ],
          effect: reminder.text,
          hidden: Boolean(preference.hidden),
          ...(preference.note ? { note: preference.note } : {}),
          ...(preference.order !== undefined ? { order: preference.order } : {}),
          sourceRecordIndexes: [],
        }
        return { view, index }
      })
      // A player's drag order wins inside a group; unordered reminders keep game order after them.
      .sort(
        (left, right) =>
          (left.view.order ?? Number.MAX_SAFE_INTEGER) - (right.view.order ?? Number.MAX_SAFE_INTEGER) ||
          left.index - right.index
      )
      .map(({ view }) => view)
  )
}
