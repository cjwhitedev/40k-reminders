import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Wh40kRuntime } from '../domain/runtime'
import { buildWh40kRuntime, serializeWh40kRuntime, WH40K_RUNTIME_PATH } from '../generate/runtime'
import { compareWh40kRuntimes, formatWh40kChangeReport, formatWh40kCommitMessage } from './changeReport'
import { createWh40kTerminalIo, decideWh40kPending, otherWh40kFindings, today } from './decideCommand'
import {
  buildWh40kDecisionContext,
  readWh40kReview,
  saveWh40kReview,
  type Wh40kPromptIo,
} from './decideSession'
import { refreshWh40kReviewInputs, removeWh40kDecision, stampWh40kDecisions } from './decisions'
import {
  runWh40kSourcePipeline,
  WH40K_DEFAULT_PIPELINE_OPTIONS,
  WH40K_PIPELINE_CONFIG_PATH,
  type Wh40kPipelineOptions,
} from './pipeline'
import type { Wh40kPinnedArtifact } from './review'
import { buildWh40kCatalog, buildWh40kRules } from './rules'

const CANDIDATES = path.join('.cache', 'wh40k11e', 'candidates')
const REPORTS = path.join('.cache', 'wh40k11e', 'reports')
const BSDATA_REPOSITORY = 'BSData/wh40k-11e'

interface Flags {
  fetch: boolean
  force: boolean
  gitCheck: boolean
  commit: boolean
  /** A Wahapedia export candidate fetched elsewhere (the handoff doc), used instead of downloading. */
  wahapediaCandidate?: string
}

const step = (title: string) => console.log(`\n━━ ${title} ━━`)

// vite-node sets NODE_ENV=development and VITE_* variables; a child `vite build` must not inherit them.
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key !== 'NODE_ENV' && !key.startsWith('VITE_'))
)

const run = (command: string, args: string[]): number =>
  spawnSync(command, args, { stdio: 'inherit', env: childEnv }).status ?? 1

const capture = (command: string, args: string[]): string =>
  (spawnSync(command, args, { encoding: 'utf8', env: childEnv }).stdout ?? '').trim()

const yes = async (io: Wh40kPromptIo, question: string, fallback = true): Promise<boolean> => {
  const answer = (await io.ask(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase()
  return answer ? answer.startsWith('y') : fallback
}

interface CandidateProvenance {
  bsdata?: { repository: string; commit: string }
  artifacts: Array<{ url: string; checksum: string; source: string }>
}

const readProvenance = async (directory: string): Promise<CandidateProvenance> =>
  JSON.parse(await readFile(path.join(directory, 'candidate-provenance.json'), 'utf8')) as CandidateProvenance

const pins = (provenance: CandidateProvenance, source: string): Wh40kPinnedArtifact[] =>
  provenance.artifacts
    .filter(artifact => artifact.source === source)
    .map(artifact => ({ url: artifact.url, checksum: artifact.checksum }))

const freshDirectory = (name: string): string => {
  let directory = path.join(CANDIDATES, `${today()}-${name}`)
  for (let suffix = 2; existsSync(directory); suffix += 1)
    directory = path.join(CANDIDATES, `${today()}-${name}-${suffix}`)
  return directory
}

const fetchCandidate = (directory: string, args: string[]) => {
  if (run('yarn', ['-s', 'data:wh40k11e:candidate', ...args, '--output', directory]) !== 0) {
    throw new Error(`Download failed; nothing was changed. See the error above.`)
  }
}

const latestBsDataCommit = async (): Promise<string> => {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': '40k-reminders-data-pipeline',
    ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  }
  const repo = (await (
    await fetch(`https://api.github.com/repos/${BSDATA_REPOSITORY}`, { headers })
  ).json()) as {
    default_branch?: string
  }
  const commit = (await (
    await fetch(
      `https://api.github.com/repos/${BSDATA_REPOSITORY}/commits/${repo.default_branch ?? 'main'}`,
      {
        headers,
      }
    )
  ).json()) as { sha?: string }
  if (!commit.sha || !/^[0-9a-f]{40}$/.test(commit.sha))
    throw new Error('Could not read the latest BSData commit')
  return commit.sha
}

const sameSet = (left: Wh40kPinnedArtifact[], right: Wh40kPinnedArtifact[]): boolean => {
  const key = (items: Wh40kPinnedArtifact[]) =>
    JSON.stringify(items.map(item => `${item.url} ${item.checksum}`).sort())
  return key(left) === key(right)
}

/** 1. Refuse to start on anything but an up-to-date, clean master. */
const checkGit = () => {
  step('1. Checking git')
  const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch !== 'master') throw new Error(`Switch to master first (on ${branch}).`)
  if (capture('git', ['status', '--porcelain'])) throw new Error('Commit or stash your changes first.')
  if (run('git', ['fetch', '-q', 'origin']) !== 0) throw new Error('git fetch failed.')
  const behind = Number(capture('git', ['rev-list', '--count', 'HEAD..origin/master']))
  if (behind > 0) throw new Error(`master is ${behind} commit(s) behind origin; run git pull first.`)
  console.log('On an up-to-date, clean master.')
}

/** 2. Download the newest sources and bind a new review file to them. */
const fetchAndRefresh = async (
  current: Wh40kPipelineOptions,
  flags: Flags
): Promise<Wh40kPipelineOptions | undefined> => {
  step('2. Downloading sources')
  const review = await readWh40kReview(current.review)

  // Decisions made before fingerprints existed are stamped against the text they were made with.
  if (
    [current.bsdataCandidate, current.wahapediaCandidate, current.officialCandidate].every(dir =>
      existsSync(dir)
    )
  ) {
    const before = buildWh40kDecisionContext(await runWh40kSourcePipeline(current))
    const stamped = stampWh40kDecisions(review, before.checksums, { onlyMissing: true })
    if (stamped.stamped) {
      Object.assign(review, stamped.review)
      console.log(`Stamped ${stamped.stamped} older decision(s) with the text they were made against.`)
    }
  }

  const wahapediaDirectory = flags.wahapediaCandidate ?? freshDirectory('wahapedia-exports')
  if (flags.wahapediaCandidate) console.log(`Using the Wahapedia exports in ${wahapediaDirectory}.`)
  else {
    fetchCandidate(wahapediaDirectory, [
      '--wahapedia-urls-file',
      'data/wh40k11e/wahapedia-export-urls.json',
      '--pause-ms',
      '1000',
    ])
  }

  const officialUrls = JSON.parse(await readFile('data/wh40k11e/official-urls.json', 'utf8')) as string[]
  // The review pins only the PDFs it quotes, so compare the URL list with what was downloaded.
  const downloadedOfficial = existsSync(current.officialCandidate)
    ? new Set(pins(await readProvenance(current.officialCandidate), 'games-workshop').map(item => item.url))
    : new Set<string>()
  const reuseOfficial =
    downloadedOfficial.size === officialUrls.length && officialUrls.every(url => downloadedOfficial.has(url))
  let officialDirectory = current.officialCandidate
  if (!reuseOfficial) {
    officialDirectory = freshDirectory('official')
    fetchCandidate(officialDirectory, ['--official-urls-file', 'data/wh40k11e/official-urls.json'])
  } else console.log('Official PDF list unchanged; reusing the downloaded PDFs.')

  const wahapediaExports = pins(await readProvenance(wahapediaDirectory), 'wahapedia')
  const officialDocuments = reuseOfficial
    ? review.inputs.officialDocuments
    : pins(await readProvenance(officialDirectory), 'games-workshop')

  // The rules come from Wahapedia and the official PDFs; BSData, a cross-check that commits most
  // days, only moves along with a real refresh.
  const unchanged = sameSet(wahapediaExports, review.inputs.wahapediaExports) && reuseOfficial
  if (unchanged && !flags.force) {
    if (!flags.wahapediaCandidate) await rm(wahapediaDirectory, { recursive: true, force: true })
    if (officialDirectory !== current.officialCandidate)
      await rm(officialDirectory, { recursive: true, force: true })
    console.log(`\nWahapedia and the official PDFs are unchanged since ${review.revision}. Nothing to do.`)
    return undefined
  }

  const bsdataCommit = await latestBsDataCommit()
  let bsdataDirectory = current.bsdataCandidate
  if (!existsSync(bsdataDirectory) || bsdataCommit !== review.inputs.bsdata.commit) {
    bsdataDirectory = freshDirectory('bsdata')
    fetchCandidate(bsdataDirectory, [
      '--bsdata-ref',
      bsdataCommit,
      '--bsdata-paths-file',
      'data/wh40k11e/bsdata-paths.json',
    ])
  } else console.log(`BSData unchanged at ${bsdataCommit.slice(0, 7)}; reusing it.`)
  const bsdata = (await readProvenance(bsdataDirectory)).bsdata ?? {
    repository: BSDATA_REPOSITORY,
    commit: bsdataCommit,
  }

  step('3. Starting a new review')
  const date = today()
  let reviewPath = `data/wh40k11e/reviews/sources-${date}.json`
  for (let suffix = 2; reviewPath !== current.review && existsSync(reviewPath); suffix += 1) {
    reviewPath = `data/wh40k11e/reviews/sources-${date}-${suffix}.json`
  }
  const revision = `wh40k11e-${path.basename(reviewPath, '.json')}`
  await saveWh40kReview(
    reviewPath,
    refreshWh40kReviewInputs(review, revision, { bsdata, wahapediaExports, officialDocuments })
  )
  if (reviewPath !== current.review) await rm(current.review, { force: true })

  const next: Wh40kPipelineOptions = {
    review: reviewPath,
    bsdataCandidate: bsdataDirectory,
    wahapediaCandidate: wahapediaDirectory,
    officialCandidate: officialDirectory,
  }
  await writeFile(WH40K_PIPELINE_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  console.log(`${reviewPath} is bound to the new sources; every earlier decision carried over.`)
  return next
}

/** 4. Settle what the review reports, prompting where a person has to decide. */
const settleReview = async (options: Wh40kPipelineOptions, io: Wh40kPromptIo): Promise<boolean> => {
  step('4. Reviewing')
  for (;;) {
    const result = await runWh40kSourcePipeline(options)
    const findings = otherWh40kFindings(result)
    if (findings.length) {
      let review = await readWh40kReview(options.review)
      const gone = findings
        .filter(item => item.code === 'unknown-record')
        .map(item => item.message.split(' names unknown ')[1])
        .filter(Boolean)
      if (
        gone.length &&
        (await yes(io, `${gone.length} decision(s) name rules Wahapedia removed. Drop them?`))
      ) {
        for (const id of gone) review = removeWh40kDecision(review, id as never)
      }
      const factions = findings
        .filter(
          item => item.code === 'invalid-army-faction-keywords' && item.message.startsWith('No Army Faction')
        )
        .map(item => item.message.split(' for ').pop() as string)
      for (const factionId of factions) {
        const name = result.decoded.records['Factions.csv'].find(record => record.values.id === factionId)
          ?.values.name
        const fallback = (name ?? factionId).toUpperCase()
        const typed = (
          await io.ask(
            `New faction ${name ?? factionId}: Army Faction keyword(s), comma-separated [${fallback}]: `
          )
        ).trim()
        review = {
          ...review,
          armyFactionKeywords: [
            ...(review.armyFactionKeywords ?? []),
            {
              factionId,
              keywords: (typed || fallback)
                .split(',')
                .map(word => word.trim().toUpperCase())
                .filter(Boolean),
              reason: 'Faction keyword on its datasheets, confirmed during a data refresh.',
            },
          ],
        }
      }
      await saveWh40kReview(options.review, review)
      const left = otherWh40kFindings(await runWh40kSourcePipeline(options))
      if (left.length) {
        left.forEach(item => io.print(`  FINDING ${item.code}: ${item.message}`))
        io.print(`\nThese need an edit to ${options.review} by hand (CONTRIBUTING.md section 8).`)
        const answer = await io.ask('Edit it, then press Enter to check again, or q to stop: ')
        if (answer.trim().toLowerCase() === 'q') return false
        continue
      }
    }
    const done = await decideWh40kPending(options, io)
    if (!done) return false
    const after = await runWh40kSourcePipeline(options)
    if (after.reviewed.status === 'reviewed') {
      const unstamped = after.reviewed.decisionChecks.filter(check => check.status === 'unstamped').length
      if (unstamped)
        io.print(
          `Note: ${unstamped} decision record(s) have no fingerprint; run yarn data:wh40k11e:decide --stamp after checking them.`
        )
      return true
    }
  }
}

/** 5–6. Regenerate the runtime and report what changed. */
const generate = async (options: Wh40kPipelineOptions): Promise<string> => {
  step('5. Generating the rules file')
  const { review, decoded, linked, reviewed } = await runWh40kSourcePipeline(options)
  const { rules } = buildWh40kRules(decoded.records, linked, reviewed)
  const after = buildWh40kRuntime(review, buildWh40kCatalog(decoded.records, linked, reviewed, rules))
  const before = JSON.parse(await readFile(WH40K_RUNTIME_PATH, 'utf8')) as Wh40kRuntime
  await writeFile(WH40K_RUNTIME_PATH, serializeWh40kRuntime(after), 'utf8')
  console.log(`${WH40K_RUNTIME_PATH} written from ${review.revision}.`)

  step('6. What changed')
  const report = compareWh40kRuntimes(before, after)
  await mkdir(REPORTS, { recursive: true })
  const reportPath = path.join(REPORTS, `${review.revision}.md`)
  const messagePath = path.join(REPORTS, `${review.revision}.commit.txt`)
  await writeFile(reportPath, formatWh40kChangeReport(report), 'utf8')
  await writeFile(messagePath, formatWh40kCommitMessage(report), 'utf8')
  console.log(formatWh40kCommitMessage(report))
  console.log(`Full list: ${reportPath}`)
  return messagePath
}

const parseFlags = (values: string[]): Flags => {
  const flags: Flags = { fetch: true, force: false, gitCheck: true, commit: true }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--no-fetch') flags.fetch = false
    else if (value === '--force') flags.force = true
    else if (value === '--skip-git-check') flags.gitCheck = false
    else if (value === '--no-commit') flags.commit = false
    else if (value === '--wahapedia-candidate' && values[index + 1])
      flags.wahapediaCandidate = values[++index]
    else throw new Error(`Unknown argument: ${value}`)
  }
  return flags
}

const main = async (): Promise<void> => {
  const flags = parseFlags(process.argv.slice(2))
  const io = createWh40kTerminalIo()
  try {
    if (flags.gitCheck && flags.fetch) checkGit()
    let options: Wh40kPipelineOptions | undefined = { ...WH40K_DEFAULT_PIPELINE_OPTIONS }
    if (flags.fetch) {
      options = await fetchAndRefresh(options, flags)
      if (!options) return
    } else step('2–3. Using the sources already named in data/wh40k11e/pipeline.json')

    if (!(await settleReview(options, io))) {
      io.print(
        '\nStopped; your answers so far are saved. Continue with: yarn data:wh40k11e:update --no-fetch'
      )
      process.exitCode = 1
      return
    }
    const messagePath = await generate(options)

    step('7. Checking the site (lint, types, build, tests)')
    if (run('yarn', ['prepush']) !== 0) {
      io.print('\nThe checks failed; fix them, then continue with: yarn data:wh40k11e:update --no-fetch')
      process.exitCode = 1
      return
    }

    step('8. Spot-check')
    io.print('Run `yarn start` in another terminal and look over a few of the armies listed above.')
    await io.ask('Press Enter when you are happy with them. ')

    if (process.env.WH40K_CACHE_BACKUP_DIR) {
      const archive = path.join(process.env.WH40K_CACHE_BACKUP_DIR, `wh40k11e-cache-${today()}.tgz`)
      if (run('tar', ['-czf', archive, path.join('.cache', 'wh40k11e')]) === 0)
        io.print(`Backed up the source cache to ${archive}.`)
    } else {
      io.print(
        'Back up the source cache somewhere safe (CONTRIBUTING.md section 5), or set WH40K_CACHE_BACKUP_DIR to do it here.'
      )
    }

    if (flags.commit && (await yes(io, 'Commit the refreshed data?'))) {
      run('git', ['add', '-A', 'data/wh40k11e', WH40K_RUNTIME_PATH])
      if (run('git', ['commit', '-q', '-F', messagePath]) === 0)
        io.print('\nCommitted. Push when ready: git push origin master')
    } else {
      io.print(`\nNot committed. The suggested message is in ${messagePath}.`)
    }
  } finally {
    io.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
