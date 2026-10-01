import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { groupWh40kReminders, projectWh40kReminders } from '../reminders/projectReminders'
import { selectWh40kRules } from '../select/selectRules'
import { parseWh40kPipelineFlag, runWh40kSourcePipeline, WH40K_DEFAULT_PIPELINE_OPTIONS } from './pipeline'
import { buildWh40kCatalog, buildWh40kRules } from './rules'

const run = async (): Promise<void> => {
  const values = process.argv.slice(2)
  const options = { ...WH40K_DEFAULT_PIPELINE_OPTIONS }
  const army = {
    faction: '',
    detachment: '',
    units: [] as string[],
    enhancements: [] as string[],
    legends: false,
  }
  let output = ''
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index]
    const next = () => {
      const value = values[++index]
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
      return value
    }
    if (parseWh40kPipelineFlag(options, flag, values[index + 1])) index += 1
    else if (flag === '--faction') army.faction = next()
    else if (flag === '--detachment') army.detachment = next()
    else if (flag === '--unit') army.units.push(next())
    else if (flag === '--enhancement') army.enhancements.push(next())
    else if (flag === '--legends') army.legends = true
    else if (flag === '--output') output = next()
    else throw new Error(`Unknown argument: ${flag}`)
  }
  if (!army.faction) throw new Error('--faction is required (a Wahapedia faction id, e.g. AC)')

  const { review, decoded, linked, reviewed } = await runWh40kSourcePipeline(options)
  if (reviewed.status === 'blocked') throw new Error(`Source review ${review.revision} is blocked`)
  const { rules } = buildWh40kRules(decoded.records, linked, reviewed)
  const catalog = buildWh40kCatalog(decoded.records, linked, reviewed, rules)

  // Names are display text; they are resolved to exactly one stable ID here or the command fails.
  const byName = <T>(items: T[], name: (item: T) => string, wanted: string, label: string): T => {
    const matches = items.filter(item => name(item).toLowerCase() === wanted.toLowerCase())
    if (matches.length !== 1) throw new Error(`${label} "${wanted}" matches ${matches.length} entries`)
    return matches[0]
  }
  const factionDetachments = catalog.detachments.filter(
    item => item.factionId === army.faction && item.gameMode === 'matched-play'
  )
  const detachment = army.detachment
    ? byName(factionDetachments, item => item.name, army.detachment, 'Detachment')
    : undefined
  const factionSheets = catalog.datasheets.filter(sheet => sheet.factionId === army.faction)
  const selection = selectWh40kRules(catalog, {
    factionId: army.faction,
    ...(detachment ? { detachmentId: detachment.id } : {}),
    datasheetIds: army.units.map(
      unit => byName(factionSheets, sheet => sheet.name, unit, 'Unit').sourceRecordId
    ),
    enhancementIds: army.enhancements.map(
      name =>
        byName(
          rules.filter(
            rule =>
              rule.kind === 'enhancement' &&
              rule.scope.kind === 'detachment' &&
              rule.scope.detachmentId === detachment?.id
          ),
          rule => rule.name,
          name,
          'Enhancement'
        ).sourceRecordId
    ),
    allowsLegends: army.legends,
  })
  selection.diagnostics.forEach(item =>
    console.log(`${item.severity.toUpperCase()} ${item.code}: ${item.message}`)
  )

  const reminders = projectWh40kReminders(selection.selected)
  const groups = groupWh40kReminders(reminders)
  console.log(
    `\n${army.faction}${detachment ? ` / ${detachment.name}` : ''}: ${selection.selected.length} rules, ${reminders.length} reminders`
  )
  for (const group of groups) {
    console.log(`\n## ${group.label}`)
    for (const reminder of group.reminders) {
      const who = 'perspective' in reminder.window ? ` [${reminder.window.perspective}]` : ''
      const cost = reminder.cost
        ? ` (${reminder.cost.value}${reminder.cost.kind === 'command-points' ? 'CP' : 'pts'})`
        : ''
      const usage = reminder.usage
        ? ` {${reminder.usage.limit === 1 ? 'once' : `${reminder.usage.limit}x`} per ${reminder.usage.period}}`
        : ''
      console.log(`  - ${reminder.name}${cost}${usage}${who} <${reminder.kind}>`)
    }
  }
  if (output) {
    const resolved = path.resolve(output)
    await mkdir(path.dirname(resolved), { recursive: true })
    await writeFile(
      resolved,
      `${JSON.stringify({ schemaVersion: 1, army, diagnostics: selection.diagnostics, groups }, null, 2)}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
      }
    )
    console.log(`\n40K reminders: ${resolved}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
