import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { extractGamesWorkshopPdfText } from '../../aos4/data/gamesWorkshop/pdfText'
import {
  WH40K_BSDATA_ADAPTER_VERSION,
  WH40K_GAMES_WORKSHOP_ADAPTER_VERSION,
  WH40K_WAHAPEDIA_EXPORT_ADAPTER_VERSION,
} from './candidate'
import { loadVerifiedCandidateArtifacts } from './candidateArtifacts'
import {
  applyWh40kSourceReview,
  evidencePageKey,
  type Wh40kReviewedSources,
  type Wh40kSourceReview,
} from './review'
import {
  decodeWh40kWahapediaExports,
  type Wh40kWahapediaDecodeResult,
  type Wh40kWahapediaExportInputs,
} from './wahapedia/decode'
import { linkWh40kWahapediaRecords, type Wh40kWahapediaLinkedDataset } from './wahapedia/link'

export interface Wh40kPipelineOptions {
  review: string
  bsdataCandidate: string
  wahapediaCandidate: string
  officialCandidate: string
}

/** The reviewed inputs the 40K commands default to; each is a checksum-bound candidate or review. */
export const WH40K_DEFAULT_PIPELINE_OPTIONS: Wh40kPipelineOptions = {
  review: 'data/wh40k11e/reviews/sources-2026-09-30.json',
  bsdataCandidate: '.cache/wh40k11e/candidates/2026-09-30-initial',
  wahapediaCandidate: '.cache/wh40k11e/candidates/wahapedia-exports-2',
  officialCandidate: '.cache/wh40k11e/candidates/official-2026-09-30',
}

export interface Wh40kPipelineResult {
  review: Wh40kSourceReview
  decoded: Wh40kWahapediaDecodeResult
  linked: Wh40kWahapediaLinkedDataset
  reviewed: Wh40kReviewedSources
}

export const parseWh40kPipelineFlag = (
  options: Wh40kPipelineOptions,
  flag: string,
  value: string | undefined
): boolean => {
  const keys: Record<string, keyof Wh40kPipelineOptions> = {
    '--review': 'review',
    '--bsdata-candidate': 'bsdataCandidate',
    '--wahapedia-candidate': 'wahapediaCandidate',
    '--official-candidate': 'officialCandidate',
  }
  const key = keys[flag]
  if (!key) return false
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  options[key] = value
  return true
}

/** Load the verified candidates, decode and link Wahapedia, and apply the checksum-bound review. */
export const runWh40kSourcePipeline = async (options: Wh40kPipelineOptions): Promise<Wh40kPipelineResult> => {
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
    [...review.linkDispositions, ...(review.timingOverrides ?? [])].flatMap(decision =>
      (decision.officialEvidence ?? []).map(item => item.url)
    )
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
      { maxPages: 400, maxTextBytes: 32 * 1024 * 1024, timeoutMs: 300_000 }
    )
    if (!extracted.document) {
      throw new Error(
        `Could not extract ${artifact.url}: ${extracted.diagnostics.map(item => item.message).join('; ')}`
      )
    }
    for (const page of extracted.document.pages) {
      evidencePages.set(evidencePageKey(artifact.url, page.page), page.text)
    }
  }

  const reviewed = applyWh40kSourceReview({
    review,
    bsdata: bsdata.provenance.bsdata as { repository: string; commit: string },
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
  return { review, decoded, linked, reviewed }
}
