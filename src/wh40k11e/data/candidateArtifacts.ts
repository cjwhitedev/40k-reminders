import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { assertArtifactChecksum } from '../../aos4/data/artifact'
import { FileArtifactCache } from '../../aos4/data/cache'
import type { ArtifactManifestEntry } from '../../aos4/data/manifest'
import type { Wh40kCandidateArtifact } from './candidate'

export const WH40K_ARTIFACT_CACHE_DIRECTORY = path.join('.cache', 'wh40k11e', 'artifacts')

export interface VerifiedCandidateArtifact extends Wh40kCandidateArtifact {
  bytes: Uint8Array
  manifestEntry: ArtifactManifestEntry
}

type JsonRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readJsonRecord = async (filePath: string): Promise<JsonRecord> => {
  const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.artifacts)) {
    throw new Error(`Invalid candidate file: ${filePath}`)
  }
  return parsed
}

/**
 * Load a candidate's artifacts for the given adapter versions, requiring each provenance entry to
 * match its manifest entry and each cached byte string to match its SHA-256.
 */
export const loadVerifiedCandidateArtifacts = async (
  candidateDirectory: string,
  adapterVersions: string[],
  cacheDirectory: string = WH40K_ARTIFACT_CACHE_DIRECTORY
): Promise<{ provenance: JsonRecord; artifacts: VerifiedCandidateArtifact[] }> => {
  const directory = path.resolve(candidateDirectory)
  const manifest = await readJsonRecord(path.join(directory, 'candidate-manifest.json'))
  const provenance = await readJsonRecord(path.join(directory, 'candidate-provenance.json'))
  const manifestEntries = (manifest.artifacts as unknown[]).filter(isRecord)
  const cache = new FileArtifactCache(cacheDirectory)

  const artifacts: VerifiedCandidateArtifact[] = []
  for (const artifact of (provenance.artifacts as unknown[]).filter(isRecord)) {
    if (typeof artifact.adapterVersion !== 'string' || !adapterVersions.includes(artifact.adapterVersion))
      continue
    if (typeof artifact.url !== 'string' || typeof artifact.checksum !== 'string') {
      throw new Error(`Candidate provenance entry is missing a URL or checksum in ${directory}`)
    }
    const entry = manifestEntries.find(candidate => candidate.requestUrl === artifact.url)
    if (!entry || entry.adapterVersion !== artifact.adapterVersion || entry.checksum !== artifact.checksum) {
      throw new Error(`Candidate provenance does not match its manifest for ${artifact.url}`)
    }
    const bytes = await cache.get(artifact.checksum)
    if (!bytes) throw new Error(`Artifact cache is missing ${artifact.checksum} (${artifact.url})`)
    assertArtifactChecksum(bytes, artifact.checksum, 'cache-corrupt')
    artifacts.push({
      ...(artifact as unknown as Wh40kCandidateArtifact),
      bytes,
      manifestEntry: entry as unknown as ArtifactManifestEntry,
    })
  }
  return { provenance, artifacts }
}
