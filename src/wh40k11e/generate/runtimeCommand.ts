import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseWh40kPipelineFlag,
  runWh40kSourcePipeline,
  WH40K_DEFAULT_PIPELINE_OPTIONS,
} from '../data/pipeline'
import { buildWh40kCatalog, buildWh40kRules } from '../data/rules'
import { buildWh40kRuntime, serializeWh40kRuntime, WH40K_RUNTIME_PATH } from './runtime'

const run = async (): Promise<void> => {
  const values = process.argv.slice(2)
  const options = { ...WH40K_DEFAULT_PIPELINE_OPTIONS }
  let write = false
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index]
    if (parseWh40kPipelineFlag(options, flag, values[index + 1])) index += 1
    else if (flag === '--write') write = true
    else throw new Error(`Unknown argument: ${flag}`)
  }

  const { review, decoded, linked, reviewed } = await runWh40kSourcePipeline(options)
  if (reviewed.status === 'blocked') {
    throw new Error(`Source review ${review.revision} is blocked; run data:wh40k11e:review for its findings`)
  }
  const { rules } = buildWh40kRules(decoded.records, linked, reviewed)
  const runtime = buildWh40kRuntime(review, buildWh40kCatalog(decoded.records, linked, reviewed, rules))
  const serialized = serializeWh40kRuntime(runtime)
  const target = path.resolve(WH40K_RUNTIME_PATH)
  const { catalog } = runtime
  const summary = `${catalog.factions.length} factions, ${catalog.detachments.length} detachments, ${catalog.datasheets.length} datasheets, ${catalog.rules.length} rules`

  if (write) {
    await writeFile(target, serialized, 'utf8')
    console.log(`40K runtime from ${review.revision} written: ${summary}`)
    return
  }
  const current = await readFile(target, 'utf8').catch(() => '')
  if (current !== serialized) {
    console.error(`${WH40K_RUNTIME_PATH} differs from ${review.revision}; run data:wh40k11e:generate:write`)
    process.exitCode = 1
    return
  }
  console.log(`40K runtime matches ${review.revision}: ${summary}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
