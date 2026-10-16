import type { Wh40kReminderViewModel } from './reminders'

const COLUMNS = ['Moment', 'Rule', 'Type', 'Turn', 'Cost', 'Limit', 'From', 'Text', 'Note'] as const

/**
 * One CSV cell. Text a spreadsheet would read as a formula (=, +, -, @ or a control character first)
 * is prefixed with an apostrophe, so opening the file can never run rule text as a formula.
 */
const cell = (value: string): string => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const textOf = (reminder: Wh40kReminderViewModel): string =>
  reminder.sections
    .flatMap(section => [
      ...(section.label || section.text
        ? [`${section.label ? `${section.label.toUpperCase()}: ` : ''}${section.text}`]
        : []),
      ...(section.items ?? []).map(item => `• ${item}`),
    ])
    .join('\n')

/** The visible reminders as a spreadsheet: one row per rule, in game order, notes included. */
export const formatWh40kRemindersCsv = (reminders: Wh40kReminderViewModel[]): string => {
  const rows = reminders
    .filter(reminder => !reminder.hidden)
    .map(reminder => {
      const tags = (tone: string) =>
        reminder.tags
          .filter(tag => tag.tone === tone)
          .map(tag => tag.label)
          .join(', ')
      return [
        reminder.windowLabel,
        reminder.name,
        tags('provenance'),
        reminder.tags.find(tag => tag.tone === 'turn-your' || tag.tone === 'turn-enemy')?.label ?? '',
        tags('cost'),
        tags('usage'),
        tags('source'),
        textOf(reminder),
        reminder.note ?? '',
      ]
    })
  // A byte-order mark so Excel opens the file as UTF-8 rather than mangling apostrophes and dashes.
  return `\ufeff${[[...COLUMNS], ...rows].map(row => row.map(cell).join(',')).join('\r\n')}\r\n`
}
