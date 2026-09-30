import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractGamesWorkshopPdfText } from '../../aos4/data/gamesWorkshop/pdfText'
import {
  WH40K_BSDATA_ADAPTER_VERSION,
  WH40K_GAMES_WORKSHOP_ADAPTER_VERSION,
  WH40K_WAHAPEDIA_EXPORT_ADAPTER_VERSION,
} from './candidate'
import { loadVerifiedCandidateArtifacts } from './candidateArtifacts'
import { applyWh40kSourceReview, evidencePageKey, type Wh40kSourceReview } from './review'
import { decodeWh40kWahapediaExports, type Wh40kWahapediaExportInputs } from './wahapedia/decode'
import { linkWh40kWahapediaRecords } from './wahapedia/link'

const nextValue = (values: string[], index: number, flag: string): string => {
  const value = values[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

const run = async (): Promise<void> => {
  const values = process.argv.slice(2)
  const options = {
    review: '',
    bsdataCandidate: '',
    wahapediaCandidate: '',
    officialCandidate: '',
    output: `.cache/wh40k11e/review/${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  }
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index]
    if (flag === '--review') options.review = nextValue(values, index++, flag)
    else if (flag === '--bsdata-candidate') options.bsdataCandidate = nextValue(values, index++, flag)
    else if (flag === '--wahapedia-candidate') options.wahapediaCandidate = nextValue(values, index++, flag)
    else if (flag === '--official-candidate') options.officialCandidate = nextValue(values, index++, flag)
    else if (flag === '--output') options.output = nextValue(values, index++, flag)
    else throw new Error(`Unknown argument: ${flag}`)
  }
  if (
    !options.review ||
    !options.bsdataCandidate ||
    !options.wahapediaCandidate ||
    !options.officialCandidate
  ) {
    throw new Error(
      '--review, --bsdata-candidate, --wahapedia-candidate, and --official-candidate are required'
    )
  }

  const review = JSON.parse(await readFile(options.review, 'utf8')) as Wh40kSourceReview
  const bsdata = await loadVerifiedCandidateArtifacts(options.bsdataCandidate, [WH40K_BSDATA_ADAPTER_VERSION])
  const wahapedia = await loadVerifiedCandidateArtifacts(options.wahapediaCandidate, [
    WH40K_WAHAPEDIA_EXPORT_ADAPTER_VERSION,
  ])
  const official = await loadVerifiedCandidateArtifacts(options.officialCandidate, [
    WH40K_GAMES_WORKSHOP_ADAPTER_VERSION,
  ])

  const decoded = decodeWh40kWahapediaExports(
    Object.fromEntries(
      wahapedia.artifacts.map(artifact => [
        new URL(artifact.url).pathname.split('/').pop(),
        { bytes: artifact.bytes, checksum: artifact.checksum },
      ])
    ) as Wh40kWahapediaExportInputs
  )
  const linked = linkWh40kWahapediaRecords(decoded.records)

  const evidencePages = new Map<string, string>()
  const citedUrls = new Set(
    review.linkDispositions.flatMap(disposition => (disposition.officialEvidence ?? []).map(item => item.url))
  )
  for (const artifact of official.artifacts.filter(item => citedUrls.has(item.url))) {
    const extracted = await extractGamesWorkshopPdfText(
      {
        bytes: artifact.bytes,
        artifact: artifact.manifestEntry,
        download: {
          externalId: artifact.checksum,
          title: path.basename(new URL(artifact.url).pathname),
          url: artifact.url,
          categories: [],
          gameSystems: ['warhammer-40000'],
          topics: [],
          discoveryMethod: 'page-link',
        },
      },
      { maxPages: 400, maxTextBytes: 32 * 1024 * 1024, timeoutMs: 120_000 }
    )
    if (!extracted.document) {
      throw new Error(
        `Could not extract ${artifact.url}: ${extracted.diagnostics.map(item => item.message).join('; ')}`
      )
    }
    for (const page of extracted.document.pages)
      evidencePages.set(evidencePageKey(artifact.url, page.page), page.text)
  }

  const bsdataPin = bsdata.provenance.bsdata as { repository: string; commit: string }
  const reviewed = applyWh40kSourceReview({
    review,
    bsdata: bsdataPin,
    wahapediaExports: wahapedia.artifacts.map(artifact => ({
      url: artifact.url,
      checksum: artifact.checksum,
    })),
    officialDocuments: official.artifacts.map(artifact => ({
      url: artifact.url,
      checksum: artifact.checksum,
    })),
    decoded,
    linked,
    evidencePages,
  })

  const output = path.resolve(options.output)
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(
    output,
    `${JSON.stringify({ schemaVersion: 1, revision: review.revision, review: options.review, ...reviewed }, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' }
  )
  console.log(`Review ${review.revision}: ${reviewed.status}`)
  for (const disposition of reviewed.dispositions) {
    console.log(`  ${disposition.id}: ${disposition.action}, ${disposition.matched} record(s)`)
  }
  console.log(`  contexts: ${JSON.stringify(reviewed.contexts)}`)
  reviewed.findings.forEach(item => console.log(`  FINDING ${item.code}: ${item.message}`))
  console.log(`40K source review: ${output}`)
  if (reviewed.status === 'blocked')
    throw new Error(`Review is blocked by ${reviewed.findings.length} finding(s)`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
