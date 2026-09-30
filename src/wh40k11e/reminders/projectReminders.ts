import type { SourceRecordId } from '../../aos4/domain'
import type { Wh40kRule } from '../domain/rules'
import {
  windowOrder,
  WH40K_TURN_PHASES,
  type Wh40kGameWindow,
  type Wh40kPerspective,
  type Wh40kTiming,
} from '../domain/timing'
import type { Wh40kSelectedRule, Wh40kSelectionCause } from '../select/selectRules'

export type Wh40kReminderLane = 'timed' | 'reaction' | 'passive' | 'unresolved'

export type Wh40kReminderWindow = Wh40kGameWindow | { kind: 'reaction' } | { kind: 'unresolved' }

export interface Wh40kReminder {
  /** Stable across rewording: derived from the rule's source identity and its timing window. */
  id: string
  ruleId: SourceRecordId
  /** Every rule this reminder stands for; identical copies on several units share one reminder. */
  ruleIds: SourceRecordId[]
  name: string
  text: string
  kind: Wh40kRule['kind']
  lane: Wh40kReminderLane
  window: Wh40kReminderWindow
  groupKey: string
  trigger?: string
  usage?: Wh40kTiming['usage']
  cost?: Wh40kRule['cost']
  condition?: string
  causes: Wh40kSelectionCause[]
}

export interface Wh40kReminderGroup {
  key: string
  label: string
  reminders: Wh40kReminder[]
}

const PERSPECTIVE_ORDER: Record<Wh40kPerspective, number> = { your: 0, either: 1, opponent: 2 }
const LANE_ORDER: Record<Wh40kReminderLane, number> = { timed: 0, reaction: 1, passive: 2, unresolved: 3 }

const phaseName = (phase: string) => WH40K_TURN_PHASES.find(item => item.id === phase)?.name ?? phase
const ordinal = (round: number) =>
  ['First', 'Second', 'Third', 'Fourth', 'Fifth'][round - 1] ?? `Round ${round}`

/** Reminders group by moment of the game; whose turn it is stays on each reminder. */
export const reminderGroupKey = (window: Wh40kReminderWindow): string => {
  switch (window.kind) {
    case 'pre-battle':
      return `pre-battle:${window.step}`
    case 'battle':
      return `battle:${window.moment}`
    case 'battle-round':
      return `battle-round:${window.moment}${window.round ? `:${window.round}` : ''}`
    case 'turn-step':
      return `turn:${window.step}`
    case 'turn-phase':
      return `phase:${window.phase}:${window.moment}`
    case 'any-phase':
      return `any-phase:${window.moments.join('+')}`
    default:
      return window.kind
  }
}

export const reminderGroupLabel = (window: Wh40kReminderWindow): string => {
  switch (window.kind) {
    case 'pre-battle':
      return `Before the battle: ${window.step}`
    case 'battle':
      return window.moment === 'start' ? 'Start of the battle' : 'End of the battle'
    case 'battle-round': {
      const which = window.round ? `${ordinal(window.round)} battle round` : 'battle round'
      return `${window.moment === 'start' ? 'Start' : 'End'} of the ${which}`
    }
    case 'turn-step':
      return window.step === 'start-of-turn' ? 'Start of turn' : 'End of turn'
    case 'turn-phase': {
      const name = `${phaseName(window.phase)} phase`
      return window.moment === 'start'
        ? `Start of the ${name}`
        : window.moment === 'end'
          ? `End of the ${name}`
          : name
    }
    case 'any-phase':
      return window.moments.includes('start')
        ? 'Start of any phase'
        : window.moments.includes('end')
          ? 'End of any phase'
          : 'Any phase'
    case 'always':
      return 'Always active'
    case 'reaction':
      return 'Reactions'
    case 'unresolved':
      return 'Timing needs review'
  }
}

const ORDER_REACTION = 950
const ORDER_UNRESOLVED = 1100

const orderOf = (window: Wh40kReminderWindow): number =>
  window.kind === 'reaction'
    ? ORDER_REACTION
    : window.kind === 'unresolved'
      ? ORDER_UNRESOLVED
      : windowOrder(window)

const perspectiveOf = (window: Wh40kReminderWindow): number =>
  'perspective' in window ? PERSPECTIVE_ORDER[window.perspective] : PERSPECTIVE_ORDER.either

const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

// Several units can print the same ability as separate records; only exact text copies merge.
const mergeIdenticalReminders = (reminders: Wh40kReminder[]): Wh40kReminder[] => {
  const merged = new Map<string, Wh40kReminder>()
  for (const reminder of reminders) {
    const perspective = 'perspective' in reminder.window ? reminder.window.perspective : ''
    const key = [
      reminder.groupKey,
      perspective,
      reminder.name.toLowerCase(),
      reminder.text,
      reminder.trigger ?? '',
    ].join('\u0000')
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, reminder)
      continue
    }
    const keepFirst = compare(existing.ruleId, reminder.ruleId) <= 0
    const primary = keepFirst ? existing : reminder
    merged.set(key, {
      ...primary,
      ruleIds: Array.from(new Set([...existing.ruleIds, ...reminder.ruleIds])).sort(compare),
      causes: [...existing.causes, ...reminder.causes],
    })
  }
  return Array.from(merged.values())
}

/**
 * Project selected rules to reminders: one per timing window for timed rules, and one each in
 * the reaction, always-active, or needs-review group for everything else, so no selected rule
 * silently disappears.
 */
export const projectWh40kReminders = (selected: Wh40kSelectedRule[]): Wh40kReminder[] => {
  const reminders: Wh40kReminder[] = []
  for (const { rule, causes } of selected) {
    const lane: Wh40kReminderLane =
      rule.timingKind === 'timed' && rule.timing?.windows.length
        ? 'timed'
        : rule.timingKind === 'reaction'
          ? 'reaction'
          : rule.timingKind === 'passive'
            ? 'passive'
            : 'unresolved'
    const windows: Wh40kReminderWindow[] =
      lane === 'timed'
        ? rule.timing!.windows
        : [
            lane === 'reaction'
              ? { kind: 'reaction' }
              : lane === 'passive'
                ? { kind: 'always' }
                : { kind: 'unresolved' },
          ]
    for (const window of windows) {
      const groupKey = reminderGroupKey(window)
      const perspective = 'perspective' in window ? `:${window.perspective}` : ''
      reminders.push({
        id: `reminder:${rule.sourceRecordId}@${groupKey}${perspective}`,
        ruleId: rule.sourceRecordId,
        ruleIds: [rule.sourceRecordId],
        name: rule.name,
        text: rule.text,
        kind: rule.kind,
        lane,
        window,
        groupKey,
        ...(rule.timing?.trigger ? { trigger: rule.timing.trigger } : {}),
        ...(rule.timing?.usage ? { usage: rule.timing.usage } : {}),
        ...(rule.cost ? { cost: rule.cost } : {}),
        ...(rule.condition ? { condition: rule.condition } : {}),
        causes,
      })
    }
  }
  return mergeIdenticalReminders(reminders).sort(
    (left, right) =>
      orderOf(left.window) - orderOf(right.window) ||
      compare(left.groupKey, right.groupKey) ||
      LANE_ORDER[left.lane] - LANE_ORDER[right.lane] ||
      perspectiveOf(left.window) - perspectiveOf(right.window) ||
      compare(left.name, right.name) ||
      compare(left.id, right.id)
  )
}

/** Group ordered reminders by moment of the game for display. */
export const groupWh40kReminders = (reminders: Wh40kReminder[]): Wh40kReminderGroup[] => {
  const groups: Wh40kReminderGroup[] = []
  for (const reminder of reminders) {
    const last = groups.at(-1)
    if (last && last.key === reminder.groupKey) last.reminders.push(reminder)
    else
      groups.push({
        key: reminder.groupKey,
        label: reminderGroupLabel(reminder.window),
        reminders: [reminder],
      })
  }
  return groups
}
