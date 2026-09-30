import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FileArtifactCache } from '../../aos4/data/cache'
import { acquireArtifact, type AcquireArtifactRequest } from '../../aos4/data/command'
import { createPinnedHttpsTransport, readResponseBody, requestWithTimeout } from '../../aos4/data/http'
import { serializeArtifactManifest, type ArtifactManifest } from '../../aos4/data/manifest'
import { resolveDnsAddresses, validateAcquisitionUrl, type UrlPolicy } from '../../aos4/data/urlPolicy'
import {
  acquireWh40kCandidate,
  mergeWh40kCandidateFileInputs,
  parseWh40kCandidateArguments,
} from './candidate'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readManifest = async (filePath: string): Promise<ArtifactManifest> => {
  const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.artifacts)) {
    throw new Error(`Invalid artifact manifest: ${filePath}`)
  }
  for (const entry of parsed.artifacts) {
    if (
      !isRecord(entry) ||
      typeof entry.requestUrl !== 'string' ||
      typeof entry.finalUrl !== 'string' ||
      !Array.isArray(entry.redirectChain) ||
      !entry.redirectChain.every(value => typeof value === 'string') ||
      typeof entry.retrievedAt !== 'string' ||
      typeof entry.adapterVersion !== 'string' ||
      typeof entry.mediaType !== 'string' ||
      !Number.isInteger(entry.byteLength) ||
      typeof entry.checksum !== 'string' ||
      !/^[0-9a-f]{64}$/.test(entry.checksum)
    ) {
      throw new Error(`Invalid artifact manifest entry in ${filePath}`)
    }
  }
  return parsed as unknown as ArtifactManifest
}

const readStringList = async (filePath: string | undefined): Promise<string[]> => {
  if (!filePath) return []
  const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
  if (!Array.isArray(parsed) || !parsed.every(value => typeof value === 'string')) {
    throw new Error(`Expected a JSON array of strings: ${filePath}`)
  }
  return parsed.map(value => value.trim()).filter(Boolean)
}

const verifyBsDataCommit = async (
  repository: string,
  ref: string,
  transport: ReturnType<typeof createPinnedHttpsTransport>,
  policy: UrlPolicy
): Promise<void> => {
  const url = `https://api.github.com/repos/${repository}/commits/${ref}`
  const validated = await validateAcquisitionUrl(url, policy)
  const response = await requestWithTimeout(
    transport,
    {
      url: validated.url,
      headers: { accept: 'application/vnd.github+json', 'user-agent': '40k-reminders-data-pipeline' },
      approvedAddresses: validated.approvedAddresses,
    },
    30_000
  )
  if (response.status !== 200) {
    throw new Error(`GitHub commit lookup for ${ref} returned HTTP ${response.status}`)
  }
  const commit = JSON.parse(new TextDecoder().decode(await readResponseBody(response, 4 * 1024 * 1024))) as {
    sha?: string
  }
  if (commit.sha !== ref) throw new Error(`GitHub returned ${commit.sha ?? '(no SHA)'} for ${ref}`)
}

const run = async (): Promise<void> => {
  const parsedOptions = parseWh40kCandidateArguments(process.argv.slice(2))
  const options = mergeWh40kCandidateFileInputs(parsedOptions, {
    officialUrls: await readStringList(parsedOptions.officialUrlsFile),
    wahapediaUrls: await readStringList(parsedOptions.wahapediaUrlsFile),
    bsdataPaths: await readStringList(parsedOptions.bsdataPathsFile),
  })
  const transport = createPinnedHttpsTransport()
  const policy: UrlPolicy = {
    allowedHosts: [
      'www.warhammer-community.com',
      'assets.warhammer-community.com',
      'wahapedia.ru',
      'api.github.com',
      'raw.githubusercontent.com',
    ],
    resolveAddresses: resolveDnsAddresses,
  }
  const acceptedManifest = options.acceptedManifestPath
    ? await readManifest(options.acceptedManifestPath)
    : undefined
  if (!options.offline && options.bsdataPaths.length) {
    await verifyBsDataCommit(options.bsdataRepository, options.bsdataRef, transport, policy)
  }

  const result = await acquireWh40kCandidate(
    { ...options, ...(acceptedManifest ? { acceptedManifest } : {}) },
    {
      acquire: (request: AcquireArtifactRequest) =>
        acquireArtifact(request, {
          transport,
          cache: new FileArtifactCache(path.join('.cache', 'wh40k11e', 'artifacts')),
          now: () => new Date().toISOString(),
          policy,
        }),
      now: () => new Date().toISOString(),
    }
  )

  const outputDirectory = path.resolve(options.outputDirectory)
  await mkdir(path.dirname(outputDirectory), { recursive: true })
  await mkdir(outputDirectory)
  await writeFile(
    path.join(outputDirectory, 'candidate-manifest.json'),
    serializeArtifactManifest(result.manifest),
    {
      encoding: 'utf8',
      flag: 'wx',
    }
  )
  await writeFile(
    path.join(outputDirectory, 'candidate-provenance.json'),
    `${JSON.stringify(result.provenance, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' }
  )
  console.log(`40K candidate manifest: ${path.join(outputDirectory, 'candidate-manifest.json')}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
