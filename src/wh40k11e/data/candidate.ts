import { createArtifactManifest, findArtifactEntry, type ArtifactManifest } from '../../aos4/data/manifest'
import type { AcquireArtifactRequest, AcquireArtifactResult } from '../../aos4/data/command'

export const WH40K_GAMES_WORKSHOP_ADAPTER_VERSION = 'wh40k-games-workshop-pdf/1'
export const WH40K_WAHAPEDIA_ADAPTER_VERSION = 'wh40k-wahapedia-html/1'
export const WH40K_WAHAPEDIA_EXPORT_ADAPTER_VERSION = 'wh40k-wahapedia-export/1'
export const WH40K_WAHAPEDIA_SPEC_ADAPTER_VERSION = 'wh40k-wahapedia-spec/1'

const wahapediaRequestShape = (url: string): { adapterVersion: string; allowedMediaTypes: string[] } => {
  const pathname = new URL(url).pathname.toLowerCase()
  if (pathname.endsWith('.csv')) {
    return { adapterVersion: WH40K_WAHAPEDIA_EXPORT_ADAPTER_VERSION, allowedMediaTypes: ['text/csv'] }
  }
  if (pathname.endsWith('.xlsx')) {
    return {
      adapterVersion: WH40K_WAHAPEDIA_SPEC_ADAPTER_VERSION,
      allowedMediaTypes: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/octet-stream',
      ],
    }
  }
  return { adapterVersion: WH40K_WAHAPEDIA_ADAPTER_VERSION, allowedMediaTypes: ['text/html'] }
}
export const WH40K_BSDATA_ADAPTER_VERSION = 'wh40k-bsdata-json/1'

export interface Wh40kCandidateOptions {
  officialUrls: string[]
  wahapediaUrls: string[]
  bsdataRepository: string
  bsdataRef: string
  bsdataPaths: string[]
  officialUrlsFile?: string
  wahapediaUrlsFile?: string
  bsdataPathsFile?: string
  outputDirectory: string
  acceptedManifest?: ArtifactManifest
  acceptedManifestPath?: string
  offline: boolean
  pauseMs: number
}

export interface Wh40kCandidateArtifact {
  source: 'games-workshop' | 'wahapedia' | 'bsdata'
  url: string
  path?: string
  adapterVersion: string
  checksum: string
  byteLength: number
  mediaType: string
  retrievedAt: string
}

export interface Wh40kCandidateProvenance {
  schemaVersion: 1
  status: 'candidate-review-required'
  retrievedAt: string
  sourcePolicy: {
    gamesWorkshop: 'authoritative'
    wahapedia: 'preferred-secondary'
    bsdata: 'preferred-secondary'
  }
  bsdata: { repository: string; commit: string } | null
  artifacts: Wh40kCandidateArtifact[]
}

export interface Wh40kCandidateResult {
  manifest: ArtifactManifest
  provenance: Wh40kCandidateProvenance
}

interface CandidateRequest {
  source: Wh40kCandidateArtifact['source']
  url: string
  path?: string
  request: Omit<AcquireArtifactRequest, 'candidateManifest'>
}

const nextValue = (values: string[], index: number, flag: string): string => {
  const value = values[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

const secureUrl = (value: string, flag: string, allowedHosts: string[]): string => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${flag} must be a valid HTTPS URL`)
  }
  if (parsed.protocol !== 'https:' || !allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new Error(`${flag} must use HTTPS on ${allowedHosts.join(' or ')}`)
  }
  return parsed.toString()
}

const normalizedPaths = (paths: string[]): string[] => {
  const normalized = paths.map(value => value.trim())
  if (
    normalized.some(
      value =>
        !value ||
        value.startsWith('/') ||
        value.includes('\\') ||
        value.split('/').some(part => !part || part === '.' || part === '..')
    )
  ) {
    throw new Error('--bsdata-path must be a repository-relative path without dot segments')
  }
  return Array.from(new Set(normalized)).sort()
}

const normalizedUrls = (urls: string[], flag: string, hosts: string[]): string[] =>
  Array.from(new Set(urls.map(url => secureUrl(url, flag, hosts)))).sort()

export const parseWh40kCandidateArguments = (values: string[]): Wh40kCandidateOptions => {
  const parsed: Wh40kCandidateOptions = {
    officialUrls: [],
    wahapediaUrls: [],
    bsdataRepository: 'BSData/wh40k-11e',
    bsdataRef: '',
    bsdataPaths: [],
    outputDirectory: `.cache/wh40k11e/candidates/${new Date().toISOString().replace(/[:.]/g, '-')}`,
    offline: false,
    pauseMs: 250,
  }

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--official-url') {
      parsed.officialUrls.push(
        secureUrl(nextValue(values, index, value), value, [
          'www.warhammer-community.com',
          'assets.warhammer-community.com',
        ])
      )
      index += 1
    } else if (value === '--wahapedia-url') {
      parsed.wahapediaUrls.push(secureUrl(nextValue(values, index, value), value, ['wahapedia.ru']))
      index += 1
    } else if (value === '--bsdata-repository') {
      parsed.bsdataRepository = nextValue(values, index, value)
      index += 1
    } else if (value === '--bsdata-ref') {
      parsed.bsdataRef = nextValue(values, index, value).toLowerCase()
      index += 1
    } else if (value === '--bsdata-path') {
      parsed.bsdataPaths.push(nextValue(values, index, value))
      index += 1
    } else if (value === '--official-urls-file') {
      parsed.officialUrlsFile = nextValue(values, index, value)
      index += 1
    } else if (value === '--wahapedia-urls-file') {
      parsed.wahapediaUrlsFile = nextValue(values, index, value)
      index += 1
    } else if (value === '--bsdata-paths-file') {
      parsed.bsdataPathsFile = nextValue(values, index, value)
      index += 1
    } else if (value === '--output') {
      parsed.outputDirectory = nextValue(values, index, value)
      index += 1
    } else if (value === '--accepted-manifest') {
      parsed.acceptedManifestPath = nextValue(values, index, value)
      index += 1
    } else if (value === '--pause-ms') {
      const pauseMs = Number(nextValue(values, index, value))
      if (!Number.isInteger(pauseMs) || pauseMs < 0 || pauseMs > 10_000) {
        throw new Error('--pause-ms must be an integer between 0 and 10000')
      }
      parsed.pauseMs = pauseMs
      index += 1
    } else if (value === '--offline') {
      parsed.offline = true
    } else {
      throw new Error(`Unknown argument: ${value}`)
    }
  }

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(parsed.bsdataRepository)) {
    throw new Error('--bsdata-repository must be an owner/name pair')
  }
  parsed.bsdataPaths = normalizedPaths(parsed.bsdataPaths)
  parsed.officialUrls = Array.from(new Set(parsed.officialUrls)).sort()
  parsed.wahapediaUrls = Array.from(new Set(parsed.wahapediaUrls)).sort()
  if ((parsed.bsdataPaths.length || parsed.bsdataPathsFile) && !/^[0-9a-f]{40}$/.test(parsed.bsdataRef)) {
    throw new Error('--bsdata-ref must be a full 40-character commit SHA when --bsdata-path is used')
  }
  if (!parsed.bsdataPaths.length && !parsed.bsdataPathsFile && parsed.bsdataRef) {
    throw new Error('--bsdata-ref requires at least one --bsdata-path')
  }
  if (parsed.offline && !parsed.acceptedManifestPath) {
    throw new Error('--offline requires --accepted-manifest')
  }
  if (
    !parsed.officialUrls.length &&
    !parsed.wahapediaUrls.length &&
    !parsed.bsdataPaths.length &&
    !parsed.officialUrlsFile &&
    !parsed.wahapediaUrlsFile &&
    !parsed.bsdataPathsFile
  ) {
    throw new Error('Provide at least one --official-url, --wahapedia-url, or --bsdata-path')
  }
  return parsed
}

export const mergeWh40kCandidateFileInputs = (
  options: Wh40kCandidateOptions,
  files: { officialUrls?: string[]; wahapediaUrls?: string[]; bsdataPaths?: string[] }
): Wh40kCandidateOptions => {
  const officialUrls = normalizedUrls(
    [...options.officialUrls, ...(files.officialUrls ?? [])],
    '--official-url',
    ['www.warhammer-community.com', 'assets.warhammer-community.com']
  )
  const wahapediaUrls = normalizedUrls(
    [...options.wahapediaUrls, ...(files.wahapediaUrls ?? [])],
    '--wahapedia-url',
    ['wahapedia.ru']
  )
  const bsdataPaths = normalizedPaths([...options.bsdataPaths, ...(files.bsdataPaths ?? [])])
  if (bsdataPaths.length && !/^[0-9a-f]{40}$/.test(options.bsdataRef)) {
    throw new Error('--bsdata-ref must be a full 40-character commit SHA when BSData paths are loaded')
  }
  if (!officialUrls.length && !wahapediaUrls.length && !bsdataPaths.length) {
    throw new Error('Source locator files contain no candidate inputs')
  }
  return { ...options, officialUrls, wahapediaUrls, bsdataPaths }
}

const pinnedBsDataUrl = (repository: string, ref: string, filePath: string): string =>
  `https://raw.githubusercontent.com/${repository}/${ref}/${filePath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`

const candidateRequests = (options: Wh40kCandidateOptions): CandidateRequest[] => [
  ...options.officialUrls.map(url => ({
    source: 'games-workshop' as const,
    url,
    request: {
      url,
      adapterVersion: WH40K_GAMES_WORKSHOP_ADAPTER_VERSION,
      allowedMediaTypes: ['application/pdf'],
      maxBytes: 64 * 1024 * 1024,
      timeoutMs: 120_000,
      maxRedirects: 5,
    },
  })),
  ...options.wahapediaUrls.map(url => ({
    source: 'wahapedia' as const,
    url,
    request: {
      url,
      ...wahapediaRequestShape(url),
      maxBytes: 32 * 1024 * 1024,
      timeoutMs: 30_000,
      maxRedirects: 5,
    },
  })),
  ...options.bsdataPaths.map(path => {
    const url = pinnedBsDataUrl(options.bsdataRepository, options.bsdataRef, path)
    return {
      source: 'bsdata' as const,
      url,
      path,
      request: {
        url,
        adapterVersion: WH40K_BSDATA_ADAPTER_VERSION,
        allowedMediaTypes: ['application/json', 'text/plain'],
        maxBytes: 32 * 1024 * 1024,
        timeoutMs: 60_000,
        maxRedirects: 3,
      },
    }
  }),
]

export const acquireWh40kCandidate = async (
  options: Wh40kCandidateOptions,
  dependencies: {
    acquire: (request: AcquireArtifactRequest) => Promise<AcquireArtifactResult>
    now: () => string
    wait?: (milliseconds: number) => Promise<void>
  }
): Promise<Wh40kCandidateResult> => {
  if (options.offline && !options.acceptedManifest) {
    throw new Error('Offline replay requires a parsed accepted manifest')
  }
  const requests = candidateRequests(options)
  const wait =
    dependencies.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  let manifest = createArtifactManifest()
  const artifacts: Wh40kCandidateArtifact[] = []

  for (let index = 0; index < requests.length; index += 1) {
    const candidate = requests[index]
    if (options.offline) {
      const accepted = findArtifactEntry(options.acceptedManifest, candidate.url)
      if (!accepted || accepted.adapterVersion !== candidate.request.adapterVersion) {
        throw new Error(`Offline manifest has no compatible artifact for ${candidate.url}`)
      }
    }
    const result = await dependencies.acquire({
      ...candidate.request,
      candidateManifest: manifest,
      ...(options.acceptedManifest ? { acceptedManifest: options.acceptedManifest } : {}),
      ...(options.offline ? { offline: true } : {}),
    })
    manifest = result.candidateManifest
    artifacts.push({
      source: candidate.source,
      url: candidate.url,
      ...(candidate.path ? { path: candidate.path } : {}),
      adapterVersion: result.entry.adapterVersion,
      checksum: result.entry.checksum,
      byteLength: result.entry.byteLength,
      mediaType: result.entry.mediaType,
      retrievedAt: result.entry.retrievedAt,
    })
    if (index < requests.length - 1 && options.pauseMs > 0) await wait(options.pauseMs)
  }

  return {
    manifest,
    provenance: {
      schemaVersion: 1,
      status: 'candidate-review-required',
      retrievedAt: dependencies.now(),
      sourcePolicy: {
        gamesWorkshop: 'authoritative',
        wahapedia: 'preferred-secondary',
        bsdata: 'preferred-secondary',
      },
      bsdata: options.bsdataPaths.length
        ? { repository: options.bsdataRepository, commit: options.bsdataRef }
        : null,
      artifacts,
    },
  }
}
