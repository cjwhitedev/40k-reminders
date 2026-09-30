import { describe, expect, it } from 'vitest'
import { createArtifactManifest } from '../../aos4/data/manifest'
import {
  acquireWh40kCandidate,
  mergeWh40kCandidateFileInputs,
  parseWh40kCandidateArguments,
  WH40K_GAMES_WORKSHOP_ADAPTER_VERSION,
} from '../../wh40k11e/data/candidate'
const commit = '4eedf7d80cae4baef20bdc117563c1357499482c'

describe('40K source candidate intake', () => {
  it('requires pinned BSData paths and restricts source URL hosts', () => {
    expect(() => parseWh40kCandidateArguments(['--bsdata-path', 'Imperium - Astra Militarum.json'])).toThrow(
      '--bsdata-ref must be a full 40-character commit SHA'
    )
    expect(() => parseWh40kCandidateArguments(['--official-url', 'https://example.com/rules.pdf'])).toThrow(
      '--official-url must use HTTPS'
    )
    expect(() =>
      parseWh40kCandidateArguments(['--bsdata-ref', commit, '--bsdata-path', '../rules.json'])
    ).toThrow('--bsdata-path must be a repository-relative path')
  })

  it('merges explicit JSON locator lists through the same host and path checks', () => {
    const options = parseWh40kCandidateArguments([
      '--official-urls-file',
      'official.json',
      '--wahapedia-urls-file',
      'wahapedia.json',
      '--bsdata-paths-file',
      'bsdata.json',
      '--bsdata-ref',
      commit,
    ])
    const merged = mergeWh40kCandidateFileInputs(options, {
      officialUrls: ['https://assets.warhammer-community.com/core.pdf'],
      wahapediaUrls: ['https://wahapedia.ru/wh40k11ed/the-rules/core-rules/'],
      bsdataPaths: ['Zeta.json', 'Alpha.json'],
    })

    expect(merged.officialUrls).toEqual(['https://assets.warhammer-community.com/core.pdf'])
    expect(merged.wahapediaUrls).toEqual(['https://wahapedia.ru/wh40k11ed/the-rules/core-rules/'])
    expect(merged.bsdataPaths).toEqual(['Alpha.json', 'Zeta.json'])
    expect(() =>
      mergeWh40kCandidateFileInputs(options, { officialUrls: ['https://example.com/x.pdf'] })
    ).toThrow('--official-url must use HTTPS')
  })

  it('records all three source classes in deterministic, review-required output', async () => {
    const options = parseWh40kCandidateArguments([
      '--bsdata-path',
      'Zeta.json',
      '--official-url',
      'https://assets.warhammer-community.com/rules.pdf',
      '--wahapedia-url',
      'https://wahapedia.ru/wh40k11ed/the-rules/core-rules/',
      '--bsdata-path',
      'Alpha.json',
      '--bsdata-ref',
      commit,
      '--pause-ms',
      '0',
    ])
    const requests: string[] = []
    const result = await acquireWh40kCandidate(options, {
      now: () => '2026-09-30T12:00:00.000Z',
      acquire: async request => {
        requests.push(request.url)
        const entry = {
          requestUrl: request.url,
          finalUrl: request.url,
          redirectChain: [],
          retrievedAt: '2026-09-30T12:00:00.000Z',
          adapterVersion: request.adapterVersion,
          mediaType: request.allowedMediaTypes[0],
          byteLength: 0,
          checksum: 'a'.repeat(64),
        }
        return {
          bytes: new Uint8Array(),
          entry,
          candidateManifest: createArtifactManifest([...(request.candidateManifest?.artifacts ?? []), entry]),
          changed: true,
        }
      },
    })

    expect(requests.map(url => new URL(url).hostname)).toEqual([
      'assets.warhammer-community.com',
      'wahapedia.ru',
      'raw.githubusercontent.com',
      'raw.githubusercontent.com',
    ])
    expect(result.provenance).toMatchObject({
      status: 'candidate-review-required',
      sourcePolicy: {
        gamesWorkshop: 'authoritative',
        wahapedia: 'preferred-secondary',
        bsdata: 'preferred-secondary',
      },
      bsdata: { repository: 'BSData/wh40k-11e', commit },
    })
    expect(
      result.provenance.artifacts.filter(artifact => artifact.source === 'bsdata').map(item => item.path)
    ).toEqual(['Alpha.json', 'Zeta.json'])
    expect(result.manifest.artifacts).toHaveLength(4)
  })

  it('acquires Wahapedia CSV exports as CSV and pages as HTML', async () => {
    const options = parseWh40kCandidateArguments([
      '--wahapedia-url',
      'https://wahapedia.ru/wh40k11ed/Datasheets.csv',
      '--wahapedia-url',
      'https://wahapedia.ru/wh40k11ed/the-rules/core-rules/',
      '--pause-ms',
      '0',
    ])
    const mediaTypes: Record<string, string[]> = {}
    await acquireWh40kCandidate(options, {
      now: () => '2026-09-30T12:00:00.000Z',
      acquire: async request => {
        mediaTypes[request.url] = request.allowedMediaTypes
        const entry = {
          requestUrl: request.url,
          finalUrl: request.url,
          redirectChain: [],
          retrievedAt: '2026-09-30T12:00:00.000Z',
          adapterVersion: request.adapterVersion,
          mediaType: request.allowedMediaTypes[0],
          byteLength: 0,
          checksum: 'c'.repeat(64),
        }
        return {
          bytes: new Uint8Array(),
          entry,
          candidateManifest: createArtifactManifest([entry]),
          changed: true,
        }
      },
    })

    expect(mediaTypes).toEqual({
      'https://wahapedia.ru/wh40k11ed/Datasheets.csv': ['text/csv'],
      'https://wahapedia.ru/wh40k11ed/the-rules/core-rules/': ['text/html'],
    })
  })

  it('replays only adapter-compatible artifacts from an accepted manifest', async () => {
    const url = 'https://assets.warhammer-community.com/core-rules.pdf'
    const entry = {
      requestUrl: url,
      finalUrl: url,
      redirectChain: [],
      retrievedAt: '2026-09-30T12:00:00.000Z',
      adapterVersion: WH40K_GAMES_WORKSHOP_ADAPTER_VERSION,
      mediaType: 'application/pdf',
      byteLength: 0,
      checksum: 'b'.repeat(64),
    }
    const acceptedManifest = createArtifactManifest([entry])
    const options = {
      ...parseWh40kCandidateArguments([
        '--official-url',
        url,
        '--accepted-manifest',
        'accepted.json',
        '--offline',
        '--pause-ms',
        '0',
      ]),
      acceptedManifest,
    }

    const result = await acquireWh40kCandidate(options, {
      now: () => '2026-09-30T12:00:00.000Z',
      acquire: async request => {
        expect(request.offline).toBe(true)
        expect(request.acceptedManifest).toEqual(acceptedManifest)
        return {
          bytes: new Uint8Array(),
          entry,
          candidateManifest: acceptedManifest,
          changed: false,
        }
      },
    })

    expect(result.manifest).toEqual(acceptedManifest)
    await expect(
      acquireWh40kCandidate(
        {
          ...options,
          acceptedManifest: createArtifactManifest([{ ...entry, adapterVersion: 'wrong-adapter/1' }]),
        },
        {
          now: () => '2026-09-30T12:00:00.000Z',
          acquire: async () => {
            throw new Error('must not acquire')
          },
        }
      )
    ).rejects.toThrow('no compatible artifact')
  })
})
