import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseWh40kPipelineFlag,
  runWh40kSourcePipeline,
  WH40K_DEFAULT_PIPELINE_OPTIONS,
  type Wh40kPipelineOptions,
} from '../data/pipeline'
import { buildWh40kCatalog, buildWh40kRules } from '../data/rules'
import { buildWh40kRuntime, serializeWh40kRuntime, WH40K_RUNTIME_PATH } from './runtime'

/** The runtime the current sources and review produce, serialized as it is committed. */
export const buildWh40kRuntimeFile = async (options: Wh40kPipelineOptions) => {
  const { review, decoded, linked, reviewed } = await runWh40kSourcePipeline(options)
  if (reviewed.status === 'blocked') {
    throw new Error(`Source review ${review.revision} is blocked; run data:review for its findings`)
  }
  const { rules } = buildWh40kRules(decoded.records, linked, reviewed)
  const runtime = buildWh40kRuntime(review, buildWh40kCatalog(decoded.records, linked, reviewed, rules))
  const { catalog } = runtime
  return {
    revision: review.revision,
    serialized: serializeWh40kRuntime(runtime),
    summary: `${catalog.factions.length} factions, ${catalog.detachments.length} detachments, ${catalog.datasheets.length} datasheets, ${catalog.rules.length} rules`,
  }
}

export const writeWh40kRuntimeFile = async (options: Wh40kPipelineOptions): Promise<void> => {
  const { revision, serialized, summary } = await buildWh40kRuntimeFile(options)
  await writeFile(path.resolve(WH40K_RUNTIME_PATH), serialized, 'utf8')
  console.log(`40K runtime from ${revision} written: ${summary}`)
}

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

  if (write) {
    await writeWh40kRuntimeFile(options)
    return
  }
  const { revision, serialized, summary } = await buildWh40kRuntimeFile(options)
  const current = await readFile(path.resolve(WH40K_RUNTIME_PATH), 'utf8').catch(() => '')
  if (current !== serialized) {
    console.error(`${WH40K_RUNTIME_PATH} differs from ${revision}; run data:generate:write`)
    process.exitCode = 1
    return
  }
  console.log(`40K runtime matches ${revision}: ${summary}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
