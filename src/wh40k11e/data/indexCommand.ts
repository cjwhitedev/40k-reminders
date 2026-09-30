import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FileArtifactCache } from '../../aos4/data/cache'
import { assertArtifactChecksum } from '../../aos4/data/artifact'
import type { ArtifactManifest } from '../../aos4/data/manifest'
import { WH40K_BSDATA_ADAPTER_VERSION } from './candidate'
import { indexBsDataCatalogues, type BsDataCatalogueInput } from './bsdata/catalogues'

type JsonRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readJson = async (filePath: string): Promise<unknown> => JSON.parse(await readFile(filePath, 'utf8'))

const readArtifactManifest = async (filePath: string): Promise<ArtifactManifest> => {
  const parsed = await readJson(filePath)
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.artifacts)) {
    throw new Error(`Invalid artifact manifest: ${filePath}`)
  }
  for (const entry of parsed.artifacts) {
    if (
      !isRecord(entry) ||
      typeof entry.requestUrl !== 'string' ||
      typeof entry.adapterVersion !== 'string' ||
      typeof entry.checksum !== 'string' ||
      !/^[0-9a-f]{64}$/.test(entry.checksum)
    ) {
      throw new Error(`Invalid artifact manifest entry in ${filePath}`)
    }
  }
  return parsed as unknown as ArtifactManifest
}

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
  const manifestPath = path.join(candidateDirectory, 'candidate-manifest.json')
  const provenancePath = path.join(candidateDirectory, 'candidate-provenance.json')
  const manifest = await readArtifactManifest(manifestPath)
  const provenance = await readJson(provenancePath)
  if (!isRecord(provenance) || provenance.schemaVersion !== 1 || !Array.isArray(provenance.artifacts)) {
    throw new Error(`Invalid candidate provenance: ${provenancePath}`)
  }

  const bsdataArtifacts = provenance.artifacts.filter(
    (artifact): artifact is JsonRecord => isRecord(artifact) && artifact.source === 'bsdata'
  )
  if (!bsdataArtifacts.length) throw new Error('Candidate contains no BSData JSON artifacts')

  const cache = new FileArtifactCache(path.join('.cache', 'wh40k11e', 'artifacts'))
  const inputs: BsDataCatalogueInput[] = []
  for (const artifact of bsdataArtifacts) {
    if (
      typeof artifact.path !== 'string' ||
      typeof artifact.url !== 'string' ||
      artifact.adapterVersion !== WH40K_BSDATA_ADAPTER_VERSION ||
      typeof artifact.checksum !== 'string'
    ) {
      throw new Error('BSData candidate provenance is missing a path, URL, adapter, or checksum')
    }
    const entry = manifest.artifacts.find(candidate => candidate.requestUrl === artifact.url)
    if (
      !entry ||
      entry.adapterVersion !== WH40K_BSDATA_ADAPTER_VERSION ||
      entry.checksum !== artifact.checksum
    ) {
      throw new Error(`BSData provenance does not match candidate manifest for ${artifact.path}`)
    }
    const bytes = await cache.get(entry.checksum)
    if (!bytes) throw new Error(`Artifact cache is missing ${entry.checksum} (${artifact.path})`)
    assertArtifactChecksum(bytes, entry.checksum, 'cache-corrupt')
    inputs.push({ path: artifact.path, checksum: entry.checksum, bytes })
  }

  const index = indexBsDataCatalogues(inputs)
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
