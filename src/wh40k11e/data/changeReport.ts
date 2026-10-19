import { stableCompactJson } from '../../aos4/generate/serialization'
import type { Wh40kCatalog, Wh40kRule } from '../domain/rules'
import type { Wh40kRuntime } from '../domain/runtime'
import { compareCodeUnits } from './wahapedia/decode'

export interface Wh40kFactionChanges {
  factionId: string
  factionName: string
  added: string[]
  removed: string[]
  reworded: string[]
  retimed: string[]
}

export interface Wh40kChangeReport {
  fromRevision: string
  toRevision: string
  factions: Wh40kFactionChanges[]
  datasheets: { added: string[]; removed: string[] }
  detachments: { added: string[]; removed: string[] }
}

const ALL_ARMIES = '*'

const factionOf = (rule: Wh40kRule, catalog: Wh40kCatalog): string => {
  switch (rule.scope.kind) {
    case 'all-armies':
      return ALL_ARMIES
    case 'faction':
    case 'detachment':
      return rule.scope.factionId
    case 'datasheet': {
      const datasheetId = rule.scope.datasheetId
      return catalog.datasheets.find(sheet => sheet.sourceRecordId === datasheetId)?.factionId ?? ALL_ARMIES
    }
  }
}

// The committed runtime is written with sorted keys and a fresh build is not, so compare key-order-free.
const timingKey = (rule: Wh40kRule): string =>
  stableCompactJson([rule.timingKind, rule.timing?.windows ?? null, rule.timing?.trigger ?? null])

const diffNamed = <T>(before: T[], after: T[], key: (item: T) => string, name: (item: T) => string) => {
  const beforeKeys = new Set(before.map(key))
  const afterKeys = new Set(after.map(key))
  return {
    added: after
      .filter(item => !beforeKeys.has(key(item)))
      .map(name)
      .sort(compareCodeUnits),
    removed: before
      .filter(item => !afterKeys.has(key(item)))
      .map(name)
      .sort(compareCodeUnits),
  }
}

/** What a data refresh changed, grouped by faction, for choosing which armies to spot-check. */
export const compareWh40kRuntimes = (before: Wh40kRuntime, after: Wh40kRuntime): Wh40kChangeReport => {
  const factions = new Map<string, Wh40kFactionChanges>()
  const names = new Map(
    [...before.catalog.factions, ...after.catalog.factions].map(faction => [faction.id, faction.name])
  )
  const bucket = (factionId: string) => {
    let entry = factions.get(factionId)
    if (!entry) {
      entry = {
        factionId,
        factionName: factionId === ALL_ARMIES ? 'All armies' : (names.get(factionId) ?? factionId),
        added: [],
        removed: [],
        reworded: [],
        retimed: [],
      }
      factions.set(factionId, entry)
    }
    return entry
  }

  const beforeRules = new Map(before.catalog.rules.map(rule => [rule.sourceRecordId, rule]))
  const afterRules = new Map(after.catalog.rules.map(rule => [rule.sourceRecordId, rule]))
  for (const rule of after.catalog.rules) {
    const old = beforeRules.get(rule.sourceRecordId)
    const changes = bucket(factionOf(rule, after.catalog))
    if (!old) changes.added.push(rule.name)
    else {
      if (old.text !== rule.text) changes.reworded.push(rule.name)
      if (timingKey(old) !== timingKey(rule)) changes.retimed.push(rule.name)
    }
  }
  for (const rule of before.catalog.rules) {
    if (!afterRules.has(rule.sourceRecordId)) bucket(factionOf(rule, before.catalog)).removed.push(rule.name)
  }

  const changed = Array.from(factions.values())
    .filter(entry => entry.added.length + entry.removed.length + entry.reworded.length + entry.retimed.length)
    .map(entry => ({
      ...entry,
      added: entry.added.sort(compareCodeUnits),
      removed: entry.removed.sort(compareCodeUnits),
      reworded: entry.reworded.sort(compareCodeUnits),
      retimed: entry.retimed.sort(compareCodeUnits),
    }))
    .sort((left, right) => compareCodeUnits(left.factionName, right.factionName))

  return {
    fromRevision: before.revision,
    toRevision: after.revision,
    factions: changed,
    datasheets: diffNamed(
      before.catalog.datasheets,
      after.catalog.datasheets,
      sheet => sheet.sourceRecordId,
      sheet => sheet.name
    ),
    detachments: diffNamed(
      before.catalog.detachments,
      after.catalog.detachments,
      detachment => detachment.id,
      detachment => detachment.name
    ),
  }
}

const countLine = (entry: Wh40kFactionChanges): string =>
  [
    entry.added.length && `${entry.added.length} added`,
    entry.removed.length && `${entry.removed.length} removed`,
    entry.reworded.length && `${entry.reworded.length} reworded`,
    entry.retimed.length && `${entry.retimed.length} retimed`,
  ]
    .filter(Boolean)
    .join(', ')

export const isEmptyWh40kChangeReport = (report: Wh40kChangeReport): boolean =>
  !report.factions.length &&
  !report.datasheets.added.length &&
  !report.datasheets.removed.length &&
  !report.detachments.added.length &&
  !report.detachments.removed.length

/** The full report as Markdown. */
export const formatWh40kChangeReport = (report: Wh40kChangeReport): string => {
  const lines = [`# Rules data: ${report.fromRevision} → ${report.toRevision}`, '']
  if (isEmptyWh40kChangeReport(report)) lines.push('No rules, datasheets, or detachments changed.', '')
  const list = (title: string, items: string[]) => {
    if (items.length) lines.push(`- ${title}: ${items.join(', ')}`)
  }
  if (report.datasheets.added.length || report.datasheets.removed.length) {
    lines.push('## Datasheets', '')
    list('Added', report.datasheets.added)
    list('Removed', report.datasheets.removed)
    lines.push('')
  }
  if (report.detachments.added.length || report.detachments.removed.length) {
    lines.push('## Detachments', '')
    list('Added', report.detachments.added)
    list('Removed', report.detachments.removed)
    lines.push('')
  }
  for (const entry of report.factions) {
    lines.push(`## ${entry.factionName} (${countLine(entry)})`, '')
    list('Added', entry.added)
    list('Removed', entry.removed)
    list('Reworded', entry.reworded)
    list('Timing changed', entry.retimed)
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

/** A commit message: a subject line, then one line per faction. */
export const formatWh40kCommitMessage = (
  report: Wh40kChangeReport,
  subject = `Refresh rules data to ${report.toRevision}`
): string => {
  const body = [
    ...(report.datasheets.added.length || report.datasheets.removed.length
      ? [`Datasheets: ${report.datasheets.added.length} added, ${report.datasheets.removed.length} removed`]
      : []),
    ...(report.detachments.added.length || report.detachments.removed.length
      ? [
          `Detachments: ${report.detachments.added.length} added, ${report.detachments.removed.length} removed`,
        ]
      : []),
    ...report.factions.map(entry => `${entry.factionName}: ${countLine(entry)}`),
  ]
  return `${subject}\n${body.length ? `\n${body.join('\n')}\n` : ''}`
}
