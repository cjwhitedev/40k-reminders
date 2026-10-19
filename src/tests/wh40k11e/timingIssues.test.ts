import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sourceRecordId } from '../../aos4/domain'
import { WH40K_COMMON_TIMINGS } from '../../wh40k11e/data/decideSession'
import { describeWh40kDecision, type Wh40kDecisionCandidate } from '../../wh40k11e/data/decisions'
import { noteOfWh40kTimingIssue, parseWh40kTimingIssue } from '../../wh40k11e/data/timingIssues'

const body = [
  '### Rule',
  '',
  'Deep Strike',
  '',
  '### Army',
  '',
  'Tyranids › Invasion Fleet',
  '',
  '### Where it shows now',
  '',
  'Reactions',
  '',
  '### Where it belongs',
  '',
  'Your Movement Phase',
  '',
  '### Why',
  '',
  'Deep strike should be at end of movement phase',
  '',
  '### Rule ID',
  '',
  'source-record:wahapedia-wh40k11e:Abilities.csv%3A000008343%3A',
  '',
  '### Maintainer command',
  '',
  '```shell',
  'yarn data:decide --rule "source-record:wahapedia-wh40k11e:Abilities.csv%3A000008343%3A"',
  '```',
].join('\r\n')

const issue = parseWh40kTimingIssue({
  number: 3,
  html_url: 'https://github.com/o/r/issues/3',
  title: '[TIMING] Deep Strike',
  body,
  user: { login: 'Gutskitter' },
})

const candidate = (overrides: Partial<Wh40kDecisionCandidate> = {}): Wh40kDecisionCandidate => ({
  sourceRecordId: sourceRecordId('wahapedia-wh40k11e', 'Abilities.csv:000008343:'),
  recordChecksum: 'c',
  name: 'Deep Strike',
  label: 'Ability',
  where: 'All armies',
  text: 'Each time this unit makes an ingress move, it can be set up anywhere.',
  why: 'requested',
  current: { ownerId: 'core-deep-strike', summary: 'reaction: "Each time this unit makes an ingress move"' },
  ...overrides,
})

describe('timing suggestion issues', () => {
  it('reads the issue form fields', () => {
    expect(issue).toEqual({
      number: 3,
      url: 'https://github.com/o/r/issues/3',
      title: '[TIMING] Deep Strike',
      author: 'Gutskitter',
      ruleId: 'source-record:wahapedia-wh40k11e:Abilities.csv%3A000008343%3A',
      suggested: 'Your Movement Phase',
      why: 'Deep strike should be at end of movement phase',
    })
    expect(
      parseWh40kTimingIssue({ number: 4, html_url: 'u', title: 't', body: '### Why\n\n_No response_' })
    ).toEqual({ number: 4, url: 'u', title: 't', author: 'someone' })
  })

  it("offers the tester's pick as the Enter default, with their reason and link shown", () => {
    const note = noteOfWh40kTimingIssue(issue, candidate())
    expect(note.lines).toEqual([
      'Issue #3 from Gutskitter: Your Movement Phase',
      '  Deep strike should be at end of movement phase',
      '  https://github.com/o/r/issues/3',
    ])
    expect(note.suggestion?.decision).toMatchObject({
      kind: 'timed',
      windows: [{ kind: 'turn-phase', phase: 'movement', moment: 'during', perspective: 'your' }],
    })
    const elsewhere = noteOfWh40kTimingIssue(
      { ...issue, suggested: 'Somewhere else (explain below)' },
      candidate()
    )
    expect(elsewhere.suggestion).toBeUndefined()
  })

  it('does not suggest the timing a rule already has', () => {
    const summary = describeWh40kDecision({
      kind: 'timed',
      windows: [{ kind: 'turn-phase', phase: 'movement', moment: 'during', perspective: 'your' }],
      reason: '',
    })
    const note = noteOfWh40kTimingIssue(issue, candidate({ current: { ownerId: 'x', summary } }))
    expect(note.suggestion).toBeUndefined()
    expect(note.lines[0]).toBe('Issue #3 from Gutskitter: Your Movement Phase (it is already timed that way)')
  })

  it('keeps the issue form choices in step with the decide prompt', () => {
    const template = readFileSync('.github/ISSUE_TEMPLATE/timing.yml', 'utf8')
    for (const [label] of WH40K_COMMON_TIMINGS) expect(template).toContain(`- ${label}\n`)
  })

  it('strips terminal escape sequences from issue text', () => {
    const sneaky = parseWh40kTimingIssue({
      number: 5,
      html_url: 'u',
      title: '\u001b[2J[TIMING] x',
      body: '### Why\n\nfine\u001b]0;owned\u0007 text',
    })
    expect(sneaky.title).toBe('[2J[TIMING] x')
    expect(sneaky.why).toBe('fine]0;owned text')
  })
})
