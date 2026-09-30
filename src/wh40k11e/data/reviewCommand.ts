import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseWh40kPipelineFlag, runWh40kSourcePipeline, WH40K_DEFAULT_PIPELINE_OPTIONS } from './pipeline'

const run = async (): Promise<void> => {
  const values = process.argv.slice(2)
  const options = { ...WH40K_DEFAULT_PIPELINE_OPTIONS }
  let output = `.cache/wh40k11e/review/${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index]
    if (parseWh40kPipelineFlag(options, flag, values[index + 1])) index += 1
    else if (flag === '--output' && values[index + 1]) output = values[++index]
    else throw new Error(`Unknown argument: ${flag}`)
  }

  const { review, reviewed } = await runWh40kSourcePipeline(options)
  const report = {
    schemaVersion: 1,
    revision: review.revision,
    review: options.review,
    ...reviewed,
    timingOverrides: Array.from(reviewed.timingOverrides.keys())
      .sort()
      .map(sourceRecordId => ({
        sourceRecordId,
        override: reviewed.timingOverrides.get(sourceRecordId)?.id,
      })),
    datasheetContexts: Object.fromEntries(Array.from(reviewed.datasheetContexts).sort()),
  }
  const resolved = path.resolve(output)
  await mkdir(path.dirname(resolved), { recursive: true })
  await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(`Review ${review.revision}: ${reviewed.status}`)
  for (const disposition of reviewed.dispositions) {
    console.log(`  ${disposition.id}: ${disposition.action}, ${disposition.matched} record(s)`)
  }
  console.log(`  contexts: ${JSON.stringify(reviewed.contexts)}`)
  console.log(
    `  timing overrides: ${reviewed.timingOverrides.size} record(s); ignored rules: ${reviewed.ignoredSourceRecordIds.length}`
  )
  reviewed.findings.forEach(item => console.log(`  FINDING ${item.code}: ${item.message}`))
  console.log(`40K source review: ${resolved}`)
  if (reviewed.status === 'blocked')
    throw new Error(`Review is blocked by ${reviewed.findings.length} finding(s)`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
