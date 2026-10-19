import { appendFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WH40K_DEFAULT_PIPELINE_OPTIONS } from './pipeline'

export const WH40K_LAST_UPDATE_URL = 'https://wahapedia.ru/wh40k11ed/Last_update.csv'

export interface Wh40kWahapediaUpdateCheck {
  changed: boolean
  pinned: string
  current: string
}

const checksumFor = (entries: unknown, urlKey: string): string | undefined => {
  if (!Array.isArray(entries)) return undefined
  const entry: unknown = entries.find(
    item =>
      typeof item === 'object' &&
      item !== null &&
      (item as Record<string, unknown>)[urlKey] === WH40K_LAST_UPDATE_URL
  )
  const checksum = (entry as Record<string, unknown> | undefined)?.checksum
  return typeof checksum === 'string' ? checksum : undefined
}

/** Compares the Last_update.csv the review was built from with a freshly fetched one. */
export const checkWh40kWahapediaUpdate = (review: unknown, manifest: unknown): Wh40kWahapediaUpdateCheck => {
  const pinned = checksumFor(
    (review as { inputs?: { wahapediaExports?: unknown } })?.inputs?.wahapediaExports,
    'url'
  )
  if (!pinned) throw new Error(`The review file does not pin ${WH40K_LAST_UPDATE_URL}`)
  const current = checksumFor((manifest as { artifacts?: unknown })?.artifacts, 'requestUrl')
  if (!current) throw new Error(`The candidate has no ${WH40K_LAST_UPDATE_URL}`)
  return { changed: pinned !== current, pinned, current }
}

/** BSData commits since the pinned one count only when they touch a catalogue the pipeline reads. */
export const changedWh40kBsDataFiles = (comparedFiles: unknown, readPaths: string[]): string[] => {
  const wanted = new Set(readPaths)
  return Array.isArray(comparedFiles)
    ? comparedFiles
        .map(file => (file as { filename?: unknown })?.filename)
        .filter((name): name is string => typeof name === 'string' && wanted.has(name))
    : []
}

const githubJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': '40k-reminders-data-watch',
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json()
}

const run = async (): Promise<void> => {
  const args = process.argv.slice(2)
  const value = (flag: string) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : undefined
  }
  const candidate = value('--candidate')
  if (!candidate) {
    throw new Error('Usage: yarn data:watch --candidate <dir> [--review <file>] [--summary <file>]')
  }
  const reviewPath = value('--review') ?? WH40K_DEFAULT_PIPELINE_OPTIONS.review
  const review = JSON.parse(await readFile(reviewPath, 'utf8')) as {
    revision: string
    inputs: { bsdata: { repository: string; commit: string } }
  }
  const manifest: unknown = JSON.parse(
    await readFile(path.join(candidate, 'candidate-manifest.json'), 'utf8')
  )
  const wahapedia = checkWh40kWahapediaUpdate(review, manifest)
  const lastUpdate = (await readFile(path.join('.cache', 'wh40k11e', 'artifacts', wahapedia.current), 'utf8'))
    .replace(/\s+/g, ' ')
    .trim()

  const { repository, commit } = review.inputs.bsdata
  const repo = (await githubJson(`https://api.github.com/repos/${repository}`)) as { default_branch: string }
  const compared = (await githubJson(
    `https://api.github.com/repos/${repository}/compare/${commit}...${repo.default_branch}`
  )) as { ahead_by: number; files?: unknown }
  const readPaths = JSON.parse(await readFile('data/wh40k11e/bsdata-paths.json', 'utf8')) as string[]
  const bsdataFiles = changedWh40kBsDataFiles(compared.files, readPaths)

  const lines = [
    wahapedia.changed
      ? `- **Wahapedia** has published a new update (\`${lastUpdate}\`).`
      : `- Wahapedia: unchanged (\`${lastUpdate}\`).`,
    bsdataFiles.length
      ? `- BSData (cross-check only) has ${compared.ahead_by} new commit(s) touching ${bsdataFiles.length} catalogue(s) we read; the update takes its latest commit.`
      : `- BSData (cross-check only): no changes to the catalogues we read.`,
  ]
  // BSData commits most days, and the rules are built from Wahapedia, so only Wahapedia raises an alert.
  const changed = wahapedia.changed
  console.log(`Sources ${changed ? 'have changed' : 'are unchanged'} since ${review.revision}:`)
  lines.forEach(line => console.log(line))

  const summary = value('--summary')
  if (summary) {
    await writeFile(
      summary,
      `The rules data sources have changed since \`${review.revision}\` was reviewed:\n\n${lines.join('\n')}\n\n` +
        'On a machine on the latest `master`, run `yarn data:update` (CONTRIBUTING.md section 8), then push. ' +
        'Close this issue once the refreshed data is on `master`.\n',
      'utf8'
    )
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
