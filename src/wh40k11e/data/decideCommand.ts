import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { WH40K_RUNTIME_PATH } from '../generate/runtime'
import type { Wh40kDecisionCandidate } from './decisions'
import { stampWh40kDecisions } from './decisions'
import {
  buildWh40kDecisionContext,
  readWh40kReview,
  runWh40kDecisionSession,
  saveWh40kReview,
  type Wh40kPromptIo,
} from './decideSession'
import {
  parseWh40kPipelineFlag,
  runWh40kSourcePipeline,
  WH40K_DEFAULT_PIPELINE_OPTIONS,
  type Wh40kPipelineOptions,
  type Wh40kPipelineResult,
} from './pipeline'

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
export const readWh40kPreviousRuleText = async (): Promise<Map<string, string>> => {
  try {
    const runtime = JSON.parse(await readFile(WH40K_RUNTIME_PATH, 'utf8')) as {
      catalog: { rules: Array<{ sourceRecordId: string; text: string }> }
    }
    return new Map(runtime.catalog.rules.map(rule => [rule.sourceRecordId, rule.text]))
  } catch {
    return new Map()
  }
}

/** Review findings the prompts cannot settle; stale decisions are what the prompts are for. */
export const otherWh40kFindings = (result: Wh40kPipelineResult) =>
  result.reviewed.findings.filter(item => item.code !== 'stale-rule-decision')

/**
 * Decides every changed and unresolved rule, saving after each answer. Returns false if the
 * person quit or skipped something, so callers know the review is not finished.
 */
export const decideWh40kPending = async (
  options: Wh40kPipelineOptions,
  io: Wh40kPromptIo,
  pick?: (context: ReturnType<typeof buildWh40kDecisionContext>) => Wh40kDecisionCandidate[]
): Promise<boolean> => {
  const result = await runWh40kSourcePipeline(options)
  const context = buildWh40kDecisionContext(result, await readWh40kPreviousRuleText())
  const candidates = pick ? pick(context) : context.pending
  if (!candidates.length) {
    io.print('Nothing to decide.')
    return true
  }
  io.print(`${candidates.length} rule(s) to decide. Answers are saved to ${options.review} as you go.`)
  const session = await runWh40kDecisionSession({
    reviewPath: options.review,
    review: await readWh40kReview(options.review),
    candidates,
    earlierByName: context.earlierByName,
    date: today(),
    io,
  })
  io.print(`\nDecided ${session.decided}; skipped ${session.skipped.length}.`)
  return !session.quit && session.skipped.length === 0
}

const run = async (): Promise<void> => {
  const values = process.argv.slice(2)
  const options = { ...WH40K_DEFAULT_PIPELINE_OPTIONS }
  const rules: string[] = []
  let stamp = false
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index]
    if (parseWh40kPipelineFlag(options, flag, values[index + 1])) index += 1
    else if (flag === '--rule' && values[index + 1]) rules.push(values[++index])
    else if (flag === '--stamp') stamp = true
    else throw new Error(`Unknown argument: ${flag}`)
  }

  if (stamp) {
    const result = await runWh40kSourcePipeline(options)
    const { checksums } = buildWh40kDecisionContext(result)
    const stamped = stampWh40kDecisions(await readWh40kReview(options.review), checksums, {
      onlyMissing: true,
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
    const done = await decideWh40kPending(
      options,
      io,
      rules.length ? context => context.matching(rules) : undefined
    )
    console.log(
      done
        ? 'Next: yarn data:wh40k11e:generate:write, then the checks in CONTRIBUTING.md section 3.'
        : 'Run yarn data:wh40k11e:decide again to finish the rest.'
    )
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
