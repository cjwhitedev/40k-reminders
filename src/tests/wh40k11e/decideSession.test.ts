import { describe, expect, it, vi } from 'vitest'
import { sourceRecordId } from '../../aos4/domain'
import { runWh40kDecisionSession, type Wh40kPromptIo } from '../../wh40k11e/data/decideSession'
import type { Wh40kDecisionCandidate } from '../../wh40k11e/data/decisions'
import type { Wh40kSourceReview } from '../../wh40k11e/data/review'

const review: Wh40kSourceReview = {
  schemaVersion: 1,
  revision: 'test',
  inputs: {
    bsdata: { repository: 'r/r', commit: 'a'.repeat(40) },
    wahapediaExports: [],
    officialDocuments: [],
  },
  decoderDiagnosticPolicies: [],
  classificationPolicies: [],
  linkDispositions: [],
  timingOverrides: [],
  ignoredRules: [],
}

const candidate = (
  key: string,
  text: string,
  overrides: Partial<Wh40kDecisionCandidate> = {}
): Wh40kDecisionCandidate => ({
  sourceRecordId: sourceRecordId('wahapedia-wh40k11e', key),
  recordChecksum: `${key}-checksum`,
  name: key,
  label: 'Ability',
  where: 'Adeptus Custodes',
  text,
  why: 'unresolved',
  ...overrides,
})

const scripted = (answers: string[]): Wh40kPromptIo & { printed: string[] } => {
  const printed: string[] = []
  return {
    printed,
    ask: async () => {
      if (!answers.length) throw new Error('ran out of scripted answers')
      return answers.shift() as string
    },
    print: text => printed.push(text),
  }
}

const session = (candidates: Wh40kDecisionCandidate[], answers: string[], start = review) => {
  const save = vi.fn(async () => undefined)
  const io = scripted(answers)
  return {
    save,
    io,
    result: runWh40kDecisionSession({
      reviewPath: 'review.json',
      review: start,
      candidates,
      earlierByName: new Map(),
      date: '2026-10-06',
      io,
      save,
    }),
  }
}

describe('runWh40kDecisionSession', () => {
  it('accepts a suggestion, takes a typed timing, and saves after each answer', async () => {
    const { result, save } = session(
      [
        candidate('Blast', 'Each time this unit shoots, add 1 to Hit rolls.'),
        candidate('Tally', 'Keep a tally of destroyed models.'),
      ],
      ['', 't', 'end of your Fight phase', 'y']
    )
    const { review: decided, decided: count, quit } = await result

    expect(quit).toBe(false)
    expect(count).toBe(2)
    expect(save).toHaveBeenCalledTimes(2)
    expect(decided.timingOverrides?.map(entry => [entry.id, entry.kind])).toEqual([
      ['blast', 'reaction'],
      ['tally', 'timed'],
    ])
    expect(decided.timingOverrides?.[1].windows).toEqual([
      { kind: 'turn-phase', phase: 'fight', moment: 'end', perspective: 'your' },
    ])
    expect(decided.timingOverrides?.[1].fingerprints).toEqual({
      [candidate('Tally', '').sourceRecordId]: 'Tally-checksum',
    })
  })

  it('keeps a changed decision with a fresh fingerprint', async () => {
    const changed = candidate('Oath', 'New wording.', {
      why: 'changed',
      current: { ownerId: 'oath', summary: 'always active', text: 'Old wording.' },
    })
    const start = {
      ...review,
      timingOverrides: [
        {
          id: 'oath',
          sourceRecordIds: [changed.sourceRecordId],
          kind: 'passive' as const,
          reason: 'r',
          fingerprints: { [changed.sourceRecordId]: 'stale' },
        },
      ],
    }
    const { result, io } = session([changed], [''], start)
    const decided = (await result).review

    expect(decided.timingOverrides?.[0].fingerprints).toEqual({ [changed.sourceRecordId]: 'Oath-checksum' })
    expect(io.printed.join('\n')).toContain('Old wording.')
  })

  it('offers numbered timings, with Enter taking the timing the wording points at', async () => {
    const { result, io } = session(
      [
        candidate(
          'Gaze',
          'Select one enemy unit within 6" that this unit could make a ranged attack against.'
        ),
        candidate('Pod', 'When this unit is set up and its passengers have disembarked, they can act.'),
      ],
      ['t', '', 't', '4']
    )
    const decided = (await result).review.timingOverrides ?? []

    expect(io.printed.join('\n')).toContain("4) Opponent's Movement Phase")
    expect(decided.map(entry => entry.windows)).toEqual([
      [{ kind: 'turn-phase', phase: 'shooting', moment: 'during', perspective: 'your' }],
      [{ kind: 'turn-phase', phase: 'movement', moment: 'during', perspective: 'opponent' }],
    ])
  })

  it('skips and quits without losing answers already saved', async () => {
    const { result, save } = session(
      [candidate('A', 'Keep a tally.'), candidate('B', 'Keep a tally.'), candidate('C', 'Keep a tally.')],
      ['s', 'p', 'q']
    )
    const outcome = await result

    expect(outcome.skipped).toEqual([candidate('A', '').sourceRecordId])
    expect(outcome.decided).toBe(1)
    expect(outcome.quit).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('applies one answer to every copy of the same rule, in one entry', async () => {
    const copy = (key: string, where: string, text = 'Keep a tally of destroyed models.') =>
      candidate(key, text, { name: 'Inviolable Transport', where })
    const { result, io } = session(
      [
        copy('SM', 'Space Marines › Mastodon'),
        copy('CSM', 'Chaos Space Marines › Mastodon', 'Keep a  tally of DESTROYED models.'),
        copy('DG', 'Death Guard › Mastodon', 'Different wording.'),
      ],
      ['p', 's']
    )
    const outcome = await result

    expect(io.printed.join('\n')).toContain('also covers the same rule on: Chaos Space Marines › Mastodon')
    expect(outcome.decided).toBe(2)
    expect(outcome.skipped).toEqual([copy('DG', '').sourceRecordId])
    expect(outcome.review.timingOverrides).toHaveLength(1)
    expect(outcome.review.timingOverrides?.[0]).toMatchObject({
      id: 'inviolable-transport',
      kind: 'passive',
      sourceRecordIds: [copy('SM', '').sourceRecordId, copy('CSM', '').sourceRecordId],
    })
  })

  it('shows a note, takes its suggestion on Enter, and lists only new decisions as changed', async () => {
    const asked = candidate('Deep Strike', 'Each time this unit makes an ingress move, set it up.', {
      why: 'requested',
      current: { ownerId: 'deep-strike', summary: 'reaction: "Each time this unit makes an ingress move"' },
    })
    const kept = candidate('Scouts', 'In the Resolve Pre-battle Abilities step, move.', {
      why: 'requested',
      current: { ownerId: 'scouts', summary: 'timed: before the battle' },
    })
    const save = vi.fn(async () => undefined)
    const io = scripted(['', 'k'])
    const outcome = await runWh40kDecisionSession({
      reviewPath: 'review.json',
      review: {
        ...review,
        timingOverrides: [
          { id: 'deep-strike', sourceRecordIds: [asked.sourceRecordId], kind: 'reaction', reason: 'r' },
          { id: 'scouts', sourceRecordIds: [kept.sourceRecordId], kind: 'passive', reason: 'r' },
        ],
      },
      candidates: [asked, kept],
      earlierByName: new Map(),
      date: '2026-10-19',
      io,
      save,
      notes: new Map([
        [
          asked.sourceRecordId,
          {
            lines: ['Issue #3 from Gutskitter: Your Movement Phase'],
            suggestion: {
              decision: {
                kind: 'timed',
                windows: [{ kind: 'turn-phase', phase: 'movement', moment: 'during', perspective: 'your' }],
                reason: 'r',
              },
              because: 'issue #3 asks for it',
            },
          },
        ],
      ]),
    })

    expect(io.printed.join('\n')).toContain('  Issue #3 from Gutskitter: Your Movement Phase')
    expect(outcome.changed).toEqual([asked.sourceRecordId])
    expect(outcome.decided).toBe(2)
    expect(outcome.review.timingOverrides?.find(entry => entry.kind === 'timed')?.windows).toEqual([
      { kind: 'turn-phase', phase: 'movement', moment: 'during', perspective: 'your' },
    ])
  })
})
