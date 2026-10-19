import { captureWh40kCommand } from './gitSteps'
import { WH40K_COMMON_TIMINGS, type Wh40kDecisionNote } from './decideSession'
import {
  defaultWh40kReason,
  describeWh40kDecision,
  parseWh40kWindowsInput,
  type Wh40kDecisionCandidate,
  type Wh40kDecisionSuggestion,
} from './decisions'

/** The label .github/ISSUE_TEMPLATE/timing.yml puts on every "Suggest a timing change" issue. */
export const WH40K_TIMING_ISSUE_LABEL = 'timing-suggestion'

export interface Wh40kTimingIssue {
  number: number
  url: string
  title: string
  author: string
  ruleId?: string
  suggested?: string
  why?: string
}

// Anyone can open an issue; escape sequences in it must not reach the maintainer's terminal.
// eslint-disable-next-line no-control-regex
const printable = (text: string): string => text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '')

/** One `### Heading` section of an issue-form body; GitHub writes `_No response_` for blank fields. */
const formField = (body: string, heading: string): string | undefined => {
  const match = body.match(new RegExp(`^### ${heading}[ \\t]*\\n([\\s\\S]*?)(?=^### |(?![\\s\\S]))`, 'm'))
  const value = match?.[1].trim()
  return value && value !== '_No response_' ? value : undefined
}

export const parseWh40kTimingIssue = (issue: {
  number: number
  html_url: string
  title: string
  body?: string | null
  user?: { login: string } | null
}): Wh40kTimingIssue => {
  const body = printable((issue.body ?? '').replace(/\r\n/g, '\n'))
  const ruleId = formField(body, 'Rule ID')
  const suggested = formField(body, 'Where it belongs')
  const why = formField(body, 'Why')
  return {
    number: issue.number,
    url: issue.html_url,
    title: printable(issue.title),
    author: printable(issue.user?.login ?? 'someone'),
    ...(ruleId ? { ruleId } : {}),
    ...(suggested ? { suggested } : {}),
    ...(why ? { why } : {}),
  }
}

/** owner/name of the origin remote, e.g. cjwhitedev/40k-reminders. */
export const wh40kOriginRepo = (): string | undefined =>
  captureWh40kCommand('git', ['remote', 'get-url', 'origin']).match(
    /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/
  )?.[1]

/** Open timing suggestions, read from GitHub's public API, so no GitHub login is needed. */
export const fetchWh40kTimingIssues = async (): Promise<Wh40kTimingIssue[]> => {
  const repo = wh40kOriginRepo()
  if (!repo) throw new Error('The origin remote is not a GitHub repository.')
  const response = await fetch(
    `https://api.github.com/repos/${repo}/issues?state=open&labels=${WH40K_TIMING_ISSUE_LABEL}&per_page=100`,
    { headers: { accept: 'application/vnd.github+json' } }
  )
  if (!response.ok) throw new Error(`GitHub answered ${response.status} when listing timing suggestions.`)
  const items = (await response.json()) as Array<
    Parameters<typeof parseWh40kTimingIssue>[0] & { pull_request?: unknown }
  >
  return items.filter(item => !item.pull_request).map(parseWh40kTimingIssue)
}

/** The tester's pick from the form, as a decision; "Somewhere else" and "Not a reminder" need a person. */
export const suggestionOfWh40kTimingIssue = (
  issue: Wh40kTimingIssue,
  candidate: Wh40kDecisionCandidate
): Wh40kDecisionSuggestion | undefined => {
  const reason = defaultWh40kReason(candidate.text)
  const because = `issue #${issue.number} asks for it`
  const listed = WH40K_COMMON_TIMINGS.find(([label]) => label === issue.suggested)
  if (listed) {
    const windows = parseWh40kWindowsInput(listed[1])
    return windows ? { decision: { kind: 'timed', windows, reason }, because } : undefined
  }
  if (issue.suggested?.startsWith('Reaction')) {
    const trigger = candidate.text.replace(/^•\s*/, '').split(/,\s/)[0].replace(/\.$/, '')
    return { decision: { kind: 'reaction', trigger, reason }, because }
  }
  if (issue.suggested?.startsWith('Always active')) return { decision: { kind: 'passive', reason }, because }
  return undefined
}

/** What the decide prompt shows for an issue: who asked, for what, why, and where to reply. */
export const noteOfWh40kTimingIssue = (
  issue: Wh40kTimingIssue,
  candidate: Wh40kDecisionCandidate
): Wh40kDecisionNote => {
  const suggestion = suggestionOfWh40kTimingIssue(issue, candidate)
  const same = suggestion && describeWh40kDecision(suggestion.decision) === candidate.current?.summary
  return {
    lines: [
      `Issue #${issue.number} from ${issue.author}: ${issue.suggested ?? 'no suggestion'}${same ? ' (it is already timed that way)' : ''}`,
      ...(issue.why ? issue.why.split('\n').map(line => `  ${line}`) : []),
      `  ${issue.url}`,
    ],
    ...(suggestion && !same ? { suggestion } : {}),
  }
}

/** A one-line nudge for data:update; silent when GitHub cannot be reached. */
export const reportWh40kTimingIssues = async (print: (text: string) => void): Promise<void> => {
  const issues = await fetchWh40kTimingIssues().catch(() => [])
  if (issues.length)
    print(
      `\n${issues.length} timing suggestion(s) from testers are open on GitHub. Run yarn data:decide --issues to go through them.`
    )
}
