import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseWh40kPipelineFlag, runWh40kSourcePipeline, WH40K_DEFAULT_PIPELINE_OPTIONS } from './pipeline'
import { buildWh40kRules } from './rules'

const countBy = <T>(items: T[], key: (item: T) => string): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => (left < right ? -1 : 1)))
}

const run = async (): Promise<void> => {
  const values = process.argv.slice(2)
  const options = { ...WH40K_DEFAULT_PIPELINE_OPTIONS }
  let output = `.cache/wh40k11e/rules/${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index]
    if (parseWh40kPipelineFlag(options, flag, values[index + 1])) index += 1
    else if (flag === '--output' && values[index + 1]) output = values[++index]
    else throw new Error(`Unknown argument: ${flag}`)
  }

  const { review, decoded, linked, reviewed } = await runWh40kSourcePipeline(options)
  if (reviewed.status === 'blocked') {
    throw new Error(`Source review ${review.revision} is blocked; run data:wh40k11e:review for its findings`)
  }
  const { rules, unresolved } = buildWh40kRules(decoded.records, linked, reviewed)
  const matched = rules.filter(rule => rule.gameMode === 'matched-play')
  const report = {
    schemaVersion: 1,
    revision: review.revision,
    totals: {
      rules: rules.length,
      byKind: countBy(rules, rule => rule.kind),
      byGameMode: countBy(rules, rule => rule.gameMode),
      matchedPlayByTimingSource: countBy(matched, rule => rule.timingSource),
      matchedPlayByTimingKind: countBy(matched, rule => rule.timingKind),
    },
    unresolved,
    rules,
  }
  const resolved = path.resolve(output)
  await mkdir(path.dirname(resolved), { recursive: true })
  await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })

  console.log(`40K rules from ${review.revision}: ${rules.length}`)
  console.log(`  by kind: ${JSON.stringify(report.totals.byKind)}`)
  console.log(`  by game mode: ${JSON.stringify(report.totals.byGameMode)}`)
  console.log(`  matched play timing source: ${JSON.stringify(report.totals.matchedPlayByTimingSource)}`)
  console.log(`  matched play timing kind: ${JSON.stringify(report.totals.matchedPlayByTimingKind)}`)
  console.log(
    `  unresolved (all modes): ${unresolved.length} ${JSON.stringify(countBy(unresolved, item => item.kind))}`
  )
  console.log(`40K rules: ${resolved}`)

  const ungated = matched.filter(rule => rule.timingKind === 'unclassified')
  if (ungated.length) {
    for (const rule of ungated)
      console.error(`  unresolved matched-play timing: ${rule.sourceRecordId} ${rule.name}`)
    console.error(
      `${ungated.length} matched-play rule(s) need a reviewed timing; add timingOverrides or ignoredRules`
    )
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
