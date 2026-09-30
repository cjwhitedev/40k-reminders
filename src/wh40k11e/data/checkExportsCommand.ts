import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertArtifactChecksum } from '../../aos4/data/artifact'
import { FileArtifactCache } from '../../aos4/data/cache'
import { discoverWahapediaExportUrls } from '../../aos4/review/wahapediaObservation'
import { WH40K_WAHAPEDIA_EXPORT_ADAPTER_VERSION, WH40K_WAHAPEDIA_SPEC_ADAPTER_VERSION } from './candidate'

export interface WahapediaExportCoverage {
  published: string[]
  missing: string[]
  unpublished: string[]
}

export const wahapediaExportCoverage = (
  specificationBytes: Uint8Array,
  fetchedUrls: string[]
): WahapediaExportCoverage => {
  const published = discoverWahapediaExportUrls(specificationBytes)
  const fetched = new Set(fetchedUrls)
  return {
    published,
    missing: published.filter(url => !fetched.has(url)),
    unpublished: Array.from(fetched)
      .filter(url => !published.includes(url))
      .sort(),
  }
}

interface ProvenanceArtifact {
  url: string
  adapterVersion: string
  checksum: string
}

const readArtifacts = async (candidateDirectory: string): Promise<ProvenanceArtifact[]> => {
  const provenancePath = path.join(candidateDirectory, 'candidate-provenance.json')
  const parsed: unknown = JSON.parse(await readFile(provenancePath, 'utf8'))
  const artifacts = (parsed as { artifacts?: unknown }).artifacts
  if (
    !Array.isArray(artifacts) ||
    !artifacts.every(
      artifact =>
        typeof artifact?.url === 'string' &&
        typeof artifact?.adapterVersion === 'string' &&
        typeof artifact?.checksum === 'string'
    )
  ) {
    throw new Error(`Invalid candidate provenance: ${provenancePath}`)
  }
  return artifacts as ProvenanceArtifact[]
}

const nextValue = (values: string[], index: number, flag: string): string => {
  const value = values[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

const run = async (): Promise<void> => {
  const values = process.argv.slice(2)
  let specCandidate = ''
  let exportsCandidate = ''
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === '--spec-candidate') specCandidate = nextValue(values, index++, values[index])
    else if (values[index] === '--exports-candidate')
      exportsCandidate = nextValue(values, index++, values[index])
    else throw new Error(`Unknown argument: ${values[index]}`)
  }
  if (!specCandidate || !exportsCandidate) {
    throw new Error('--spec-candidate and --exports-candidate are required')
  }

  const specs = (await readArtifacts(path.resolve(specCandidate))).filter(
    artifact => artifact.adapterVersion === WH40K_WAHAPEDIA_SPEC_ADAPTER_VERSION
  )
  if (specs.length !== 1) throw new Error(`Expected one export specification, found ${specs.length}`)
  const bytes = await new FileArtifactCache(path.join('.cache', 'wh40k11e', 'artifacts')).get(
    specs[0].checksum
  )
  if (!bytes) throw new Error(`Artifact cache is missing the export specification ${specs[0].checksum}`)
  assertArtifactChecksum(bytes, specs[0].checksum, 'cache-corrupt')

  const fetched = (await readArtifacts(path.resolve(exportsCandidate)))
    .filter(artifact => artifact.adapterVersion === WH40K_WAHAPEDIA_EXPORT_ADAPTER_VERSION)
    .map(artifact => artifact.url)
  const coverage = wahapediaExportCoverage(bytes, fetched)
  console.log(
    `Specification publishes ${coverage.published.length} CSV exports; candidate has ${fetched.length}.`
  )
  coverage.missing.forEach(url => console.log(`  missing from candidate: ${url}`))
  coverage.unpublished.forEach(url => console.log(`  not in specification: ${url}`))
  if (coverage.missing.length || coverage.unpublished.length) {
    throw new Error('Candidate CSV exports do not match the published specification')
  }
  console.log('Candidate CSV exports match the published specification.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
