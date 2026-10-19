import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { WH40K_RUNTIME_PATH } from '../generate/runtime'
import { writeWh40kRuntimeFile } from '../generate/runtimeCommand'
import type { Wh40kDecisionCandidate } from './decisions'
import { sameWh40kWording, stampWh40kDecisions } from './decisions'
import { commitAndPushWh40kData, runWh40kCommand } from './gitSteps'
import {
  buildWh40kDecisionContext,
  readWh40kReview,
  runWh40kDecisionSession,
  saveWh40kReview,
  type Wh40kDecisionNote,
  type Wh40kPromptIo,
} from './decideSession'
import {
  parseWh40kPipelineFlag,
  runWh40kSourcePipeline,
  WH40K_DEFAULT_PIPELINE_OPTIONS,
  type Wh40kPipelineOptions,
  type Wh40kPipelineResult,
} from './pipeline'
import { fetchWh40kTimingIssues, noteOfWh40kTimingIssue, type Wh40kTimingIssue } from './timingIssues'

const sameId = (left: string, right: string | undefined): boolean =>
  left.toLowerCase() === right?.trim().toLowerCase()

export const today = (): string => new Date().toISOString().slice(0, 10)

/**
 * Prompts on the terminal; `close` must run before the process can exit. Lines typed or piped in
 * ahead of a prompt are queued rather than dropped, and closed input (Ctrl+D, Ctrl+C, end of a
 * pipe) stops the session; every answer before it is already saved.
 */
export const createWh40kTerminalIo = (): Wh40kPromptIo & { close: () => void } => {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
  })
  const queued: string[] = []
  const waiting: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = []
  let closed = false
  terminal.on('line', line => {
    const next = waiting.shift()
    if (next) next.resolve(line)
    else queued.push(line)
  })
  terminal.on('close', () => {
    closed = true
    waiting.splice(0).forEach(next => next.reject(new Error('Input closed; answers so far are saved.')))
  })
  return {
    ask: question => {
      process.stdout.write(question)
      if (queued.length) return Promise.resolve(queued.shift() as string)
      if (closed) return Promise.reject(new Error('Input closed; answers so far are saved.'))
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }))
    },
    print: text => console.log(text),
    close: () => terminal.close(),
  }
}

/** Rule text from the committed runtime, to show what a changed decision was made against. */
export const readWh40kPreviousRuleText = async (): Promise<Map<string, string>> =>
  new Map(Array.from(await readPreviousRules(), rule => [rule.sourceRecordId, rule.text]))

/** Rule names from the committed runtime, to follow a rule Wahapedia renumbers. */
export const readWh40kPreviousRuleNames = async (): Promise<Map<string, string>> =>
  new Map(Array.from(await readPreviousRules(), rule => [rule.sourceRecordId, rule.name]))

const readPreviousRules = async (): Promise<
  Array<{ sourceRecordId: string; name: string; text: string }>
> => {
  try {
    const runtime = JSON.parse(await readFile(WH40K_RUNTIME_PATH, 'utf8')) as {
      catalog: { rules: Array<{ sourceRecordId: string; name: string; text: string }> }
    }
    return runtime.catalog.rules
  } catch {
    return []
  }
}

/** Review findings the prompts cannot settle; stale decisions are what the prompts are for. */
export const otherWh40kFindings = (result: Wh40kPipelineResult) =>
  result.reviewed.findings.filter(item => item.code !== 'stale-rule-decision')

/**
 * Decides every changed and unresolved rule, saving after each answer. `done` is false if the
 * person quit or skipped something, so callers know the review is not finished.
 */
export const decideWh40kPending = async (
  options: Wh40kPipelineOptions,
  io: Wh40kPromptIo,
  pick?: (context: ReturnType<typeof buildWh40kDecisionContext>) => Wh40kDecisionCandidate[],
  notes?: ReadonlyMap<string, Wh40kDecisionNote>
): Promise<{ done: boolean; changed: string[] }> => {
  const result = await runWh40kSourcePipeline(options)
  const context = buildWh40kDecisionContext(result, await readWh40kPreviousRuleText())
  let candidates = pick ? pick(context) : context.pending
  let review = await readWh40kReview(options.review)
  const reformatted = pick
    ? []
    : candidates.filter(
        item =>
          item.why === 'changed' &&
          item.current?.text !== undefined &&
          sameWh40kWording(item.current.text, item.text)
      )
  if (reformatted.length) {
    io.print(`${reformatted.length} decided rule(s) changed only in spacing or capital letters:`)
    reformatted.forEach(item => io.print(`  ${item.name} (${item.where}): ${item.current?.summary}`))
    const answer = (await io.ask('Keep those decisions? [Y/n] ')).trim().toLowerCase()
    if (!answer || answer.startsWith('y')) {
      const ids = new Set(reformatted.map(item => item.sourceRecordId))
      review = stampWh40kDecisions(review, context.checksums, {
        onlyMissing: false,
        sourceRecordIds: ids,
      }).review
      await saveWh40kReview(options.review, review)
      candidates = candidates.filter(item => !ids.has(item.sourceRecordId))
    }
  }
  if (!candidates.length) {
    io.print('Nothing to decide.')
    return { done: true, changed: [] }
  }
  io.print(`${candidates.length} rule(s) to decide. Answers are saved to ${options.review} as you go.`)
  const session = await runWh40kDecisionSession({
    reviewPath: options.review,
    review,
    candidates,
    earlierByName: context.earlierByName,
    date: today(),
    io,
    ...(notes ? { notes } : {}),
  })
  io.print(`\nDecided ${session.decided}; skipped ${session.skipped.length}.`)
  return { done: !session.quit && session.skipped.length === 0, changed: session.changed }
}

const run = async (): Promise<void> => {
  const values = process.argv.slice(2)
  const options = { ...WH40K_DEFAULT_PIPELINE_OPTIONS }
  const rules: string[] = []
  let stamp = false
  let fromIssues = false
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index]
    if (parseWh40kPipelineFlag(options, flag, values[index + 1])) index += 1
    else if (flag === '--rule' && values[index + 1]) rules.push(values[++index])
    else if (flag === '--stamp') stamp = true
    else if (flag === '--issues') fromIssues = true
    else throw new Error(`Unknown argument: ${flag}`)
  }

  let issues: Wh40kTimingIssue[] = []
  if (fromIssues) {
    issues = await fetchWh40kTimingIssues()
    if (!issues.length) {
      console.log('No timing suggestions are open on GitHub.')
      return
    }
    for (const issue of issues.filter(item => !item.ruleId))
      console.log(`#${issue.number} ${issue.title} has no rule ID; read it on GitHub: ${issue.url}`)
    issues = issues.filter(issue => issue.ruleId)
    rules.push(...issues.map(issue => issue.ruleId as string))
    if (!rules.length) return
  }

  if (stamp) {
    const result = await runWh40kSourcePipeline(options)
    const { checksums, names } = buildWh40kDecisionContext(result)
    const stamped = stampWh40kDecisions(await readWh40kReview(options.review), checksums, {
      onlyMissing: true,
      names,
    })
    await saveWh40kReview(options.review, stamped.review)
    console.log(`Stamped ${stamped.stamped} decision record(s) in ${options.review} with their current text.`)
    return
  }

  const preview = await runWh40kSourcePipeline(options)
  const blocking = otherWh40kFindings(preview)
  if (blocking.length) {
    blocking.forEach(item => console.error(`  FINDING ${item.code}: ${item.message}`))
    throw new Error(`Fix these review findings in ${options.review} first (CONTRIBUTING.md section 8).`)
  }

  const io = createWh40kTerminalIo()
  try {
    let picked: string[] = []
    const notes = new Map<string, Wh40kDecisionNote>()
    const { done, changed } = await decideWh40kPending(
      options,
      io,
      rules.length
        ? context => {
            const matched = context.matching(rules)
            picked = Array.from(new Set(matched.map(candidate => candidate.name)))
            for (const issue of issues) {
              const candidate = matched.find(item => sameId(item.sourceRecordId, issue.ruleId))
              if (candidate) notes.set(candidate.sourceRecordId, noteOfWh40kTimingIssue(issue, candidate))
              else
                io.print(
                  `#${issue.number} ${issue.title}: its rule is not in the current sources (renamed or removed?). ${issue.url}`
                )
            }
            return matched
          }
        : undefined,
      notes
    )
    const fixed = issues.filter(issue => changed.some(id => sameId(id, issue.ruleId)))
    const kept = issues.filter(issue => !fixed.includes(issue))
    if (kept.length) {
      io.print('\nThese suggestions did not change anything; reply on GitHub and close them:')
      kept.forEach(issue => io.print(`  #${issue.number} ${issue.title}: ${issue.url}`))
    }
    if (!done) {
      io.print('Run yarn data:decide again to finish the rest; runtime.json is regenerated when it finishes.')
      return
    }
    // data:update regenerates in its own step, with the change report.
    await writeWh40kRuntimeFile(options)
    io.print('\nChecking the site (lint, types, build, tests)...')
    if (runWh40kCommand('yarn', ['prepush']) !== 0) {
      io.print('\nThe checks failed; fix them, then commit the review file and runtime.json.')
      process.exitCode = 1
      return
    }
    const subject = picked.length ? `Retime ${picked.join(', ')}` : 'Decide rule timings'
    // GitHub closes an issue when a commit saying "Fixes #n" reaches master.
    const closes = fixed.map(issue => `Fixes #${issue.number}`).join('\n')
    const message = `${subject} in ${path.basename(options.review)}${closes ? `\n\n${closes}` : ''}`
    if (
      !(await commitAndPushWh40kData(
        io,
        ['-m', message],
        fixed.length
          ? `GitHub is publishing the site and closing ${fixed.map(issue => `#${issue.number}`).join(', ')}.`
          : undefined
      ))
    )
      io.print('\nNot committed; the review file and runtime.json are ready when you are.')
  } finally {
    io.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
