import { appendFile, readFile } from 'node:fs/promises'
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

const run = async (): Promise<void> => {
  const args = process.argv.slice(2)
  const value = (flag: string) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : undefined
  }
  const candidate = value('--candidate')
  if (!candidate) throw new Error('Usage: yarn data:wh40k11e:watch --candidate <dir> [--review <file>]')
  const reviewPath = value('--review') ?? WH40K_DEFAULT_PIPELINE_OPTIONS.review
  const review: unknown = JSON.parse(await readFile(reviewPath, 'utf8'))
  const manifest: unknown = JSON.parse(
    await readFile(path.join(candidate, 'candidate-manifest.json'), 'utf8')
  )
  const result = checkWh40kWahapediaUpdate(review, manifest)
  const lastUpdate = (await readFile(path.join('.cache', 'wh40k11e', 'artifacts', result.current), 'utf8'))
    .replace(/\s+/g, ' ')
    .trim()

  console.log(
    result.changed
      ? `Wahapedia has changed since ${reviewPath} was reviewed. Last update: ${lastUpdate}`
      : `Wahapedia is unchanged since ${reviewPath} was reviewed. Last update: ${lastUpdate}`
  )
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `changed=${result.changed}\nlast_update=${lastUpdate}\nreview=${reviewPath}\n`
    )
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
