import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { indexBsDataCatalogues } from './bsdata/catalogues'
import { WH40K_BSDATA_ADAPTER_VERSION, WH40K_WAHAPEDIA_EXPORT_ADAPTER_VERSION } from './candidate'
import { loadVerifiedCandidateArtifacts } from './candidateArtifacts'
import { compareWh40kSources, type Wh40kFactionMap } from './compare'
import { decodeWh40kWahapediaExports, type Wh40kWahapediaExportInputs } from './wahapedia/decode'
import { linkWh40kWahapediaRecords } from './wahapedia/link'

const nextValue = (values: string[], index: number, flag: string): string => {
  const value = values[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

const countBy = <T>(items: T[], key: (item: T) => string): Record<string, number> =>
  Object.fromEntries(
    Object.entries(
      items.reduce<Record<string, number>>((counts, item) => {
        counts[key(item)] = (counts[key(item)] ?? 0) + 1
        return counts
      }, {})
    ).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  )

const run = async (): Promise<void> => {
  const values = process.argv.slice(2)
  const options = {
    bsdataCandidate: '',
    wahapediaCandidate: '',
    factionMap: 'data/wh40k11e/faction-map.json',
    output: `.cache/wh40k11e/compare/${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  }
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index]
    if (flag === '--bsdata-candidate') options.bsdataCandidate = nextValue(values, index++, flag)
    else if (flag === '--wahapedia-candidate') options.wahapediaCandidate = nextValue(values, index++, flag)
    else if (flag === '--faction-map') options.factionMap = nextValue(values, index++, flag)
    else if (flag === '--output') options.output = nextValue(values, index++, flag)
    else throw new Error(`Unknown argument: ${flag}`)
  }
  if (!options.bsdataCandidate || !options.wahapediaCandidate) {
    throw new Error('--bsdata-candidate and --wahapedia-candidate are required')
  }

  const factionMap = JSON.parse(await readFile(options.factionMap, 'utf8')) as Wh40kFactionMap
  const bsdata = await loadVerifiedCandidateArtifacts(options.bsdataCandidate, [WH40K_BSDATA_ADAPTER_VERSION])
  const bsdataCommit = (bsdata.provenance.bsdata as { commit?: string } | null)?.commit
  if (bsdataCommit !== factionMap.bsdataCommit) {
    throw new Error(
      `Faction map is reviewed against BSData ${factionMap.bsdataCommit}, candidate is ${bsdataCommit}`
    )
  }
  const index = indexBsDataCatalogues(
    bsdata.artifacts.map(artifact => ({
      path: artifact.path ?? artifact.url,
      checksum: artifact.checksum,
      bytes: artifact.bytes,
    }))
  )

  const wahapedia = await loadVerifiedCandidateArtifacts(options.wahapediaCandidate, [
    WH40K_WAHAPEDIA_EXPORT_ADAPTER_VERSION,
  ])
  const exportInputs: Wh40kWahapediaExportInputs = Object.fromEntries(
    wahapedia.artifacts.map(artifact => [
      new URL(artifact.url).pathname.split('/').pop(),
      { bytes: artifact.bytes, checksum: artifact.checksum },
    ])
  )
  const decoded = decodeWh40kWahapediaExports(exportInputs)
  const linked = linkWh40kWahapediaRecords(decoded.records)
  const comparison = compareWh40kSources(linked, index, factionMap)

  const report = {
    schemaVersion: 1,
    status: 'candidate-review-required',
    inputs: {
      bsdataCandidate: path.resolve(options.bsdataCandidate),
      bsdataCommit,
      wahapediaCandidate: path.resolve(options.wahapediaCandidate),
      factionMap: options.factionMap,
    },
    stages: {
      bsdataIndex: { status: index.status, diagnostics: countBy(index.diagnostics, item => item.code) },
      wahapediaDecode: {
        status: decoded.status,
        diagnostics: countBy(decoded.diagnostics, item => `${item.severity} ${item.code}`),
      },
      wahapediaLink: {
        status: linked.status,
        classifications: countBy(linked.datasheets, sheet => sheet.classification),
        diagnostics: countBy(
          linked.diagnostics,
          item => `${item.severity} ${item.code} ${item.file}.${item.field}`
        ),
        blocking: linked.diagnostics.filter(item => item.severity === 'error'),
      },
    },
    comparison,
  }
  const output = path.resolve(options.output)
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })

  console.log(
    `BSData index: ${index.status}; Wahapedia decode: ${decoded.status}; Wahapedia link: ${linked.status}`
  )
  console.log(`Units: ${JSON.stringify(comparison.totals)}`)
  console.log(`40K source comparison: ${output}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
