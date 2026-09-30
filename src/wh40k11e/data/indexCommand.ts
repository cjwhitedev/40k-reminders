import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { indexBsDataCatalogues } from './bsdata/catalogues'
import { WH40K_BSDATA_ADAPTER_VERSION } from './candidate'
import { loadVerifiedCandidateArtifacts } from './candidateArtifacts'

interface Arguments {
  candidateDirectory: string
  output: string
}

const nextValue = (values: string[], index: number, flag: string): string => {
  const value = values[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

export const parseWh40kIndexArguments = (values: string[]): Arguments => {
  const parsed: Arguments = {
    candidateDirectory: '',
    output: `.cache/wh40k11e/index/${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--candidate') {
      parsed.candidateDirectory = nextValue(values, index, value)
      index += 1
    } else if (value === '--output') {
      parsed.output = nextValue(values, index, value)
      index += 1
    } else {
      throw new Error(`Unknown argument: ${value}`)
    }
  }
  if (!parsed.candidateDirectory) throw new Error('--candidate is required')
  return parsed
}

const run = async (): Promise<void> => {
  const options = parseWh40kIndexArguments(process.argv.slice(2))
  const candidateDirectory = path.resolve(options.candidateDirectory)
  const { provenance, artifacts } = await loadVerifiedCandidateArtifacts(candidateDirectory, [
    WH40K_BSDATA_ADAPTER_VERSION,
  ])
  if (!artifacts.length) throw new Error('Candidate contains no BSData JSON artifacts')

  const index = indexBsDataCatalogues(
    artifacts.map(artifact => {
      if (!artifact.path) throw new Error(`BSData candidate artifact has no path: ${artifact.url}`)
      return { path: artifact.path, checksum: artifact.checksum, bytes: artifact.bytes }
    })
  )
  const report = {
    schemaVersion: 1,
    status: index.status,
    candidateDirectory,
    bsdata: provenance.bsdata ?? null,
    index,
  }
  const output = path.resolve(options.output)
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(`40K catalogue index: ${output}`)
  if (index.status === 'blocked') {
    throw new Error(`Catalogue index is blocked by ${index.diagnostics.length} source diagnostic(s)`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
