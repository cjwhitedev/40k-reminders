import { spawnSync } from 'node:child_process'
import { WH40K_RUNTIME_PATH } from '../generate/runtime'
import type { Wh40kPromptIo } from './decideSession'

// vite-node sets NODE_ENV=development and VITE_* variables; a child `vite build` must not inherit them.
export const wh40kChildEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key !== 'NODE_ENV' && !key.startsWith('VITE_'))
)

export const runWh40kCommand = (command: string, args: string[]): number =>
  spawnSync(command, args, { stdio: 'inherit', env: wh40kChildEnv }).status ?? 1

export const captureWh40kCommand = (command: string, args: string[]): string =>
  (spawnSync(command, args, { encoding: 'utf8', env: wh40kChildEnv }).stdout ?? '').trim()

export const askWh40kYes = async (io: Wh40kPromptIo, question: string, fallback = true): Promise<boolean> => {
  const answer = (await io.ask(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase()
  return answer ? answer.startsWith('y') : fallback
}

/** The files a data command changes; only these are committed. */
export const WH40K_DATA_PATHS = ['data/wh40k11e', WH40K_RUNTIME_PATH]

/**
 * Offers to commit the rules data (and nothing else) and push it to master. `message` is the
 * argument pair git commit takes, e.g. ['-m', 'text'] or ['-F', file]. Returns whether it committed.
 */
export const commitAndPushWh40kData = async (
  io: Wh40kPromptIo,
  message: [string, string],
  pushedNote = 'GitHub is publishing the site.'
): Promise<boolean> => {
  if (!(await askWh40kYes(io, 'Commit the rules data?'))) return false
  runWh40kCommand('git', ['add', '-A', '--', ...WH40K_DATA_PATHS])
  if (runWh40kCommand('git', ['commit', '-q', ...message, '--', ...WH40K_DATA_PATHS]) !== 0) {
    io.print('\nThe commit failed; see the error above.')
    return false
  }
  if (captureWh40kCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'master') {
    io.print('\nCommitted. This is not master, so push it yourself when ready.')
    return true
  }
  if (!(await askWh40kYes(io, 'Committed. Push to GitHub now (it then rebuilds the site)?'))) {
    io.print('\nPush when ready: git push origin master')
    return true
  }
  // GitHub may have moved on meanwhile; the commit only touches data files, so a rebase is safe.
  const pushed =
    runWh40kCommand('git', ['push', '-q', 'origin', 'master']) === 0 ||
    (runWh40kCommand('git', ['pull', '-q', '--rebase', 'origin', 'master']) === 0 &&
      runWh40kCommand('git', ['push', '-q', 'origin', 'master']) === 0)
  io.print(
    pushed
      ? `\nPushed. ${pushedNote}`
      : '\nThe push failed; run git pull --rebase && git push origin master when it is sorted.'
  )
  return true
}
