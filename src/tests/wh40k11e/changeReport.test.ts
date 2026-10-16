import { describe, expect, it } from 'vitest'
import { sourceRecordId } from '../../aos4/domain'
import {
  compareWh40kRuntimes,
  formatWh40kChangeReport,
  formatWh40kCommitMessage,
  isEmptyWh40kChangeReport,
} from '../../wh40k11e/data/changeReport'
import type { Wh40kRule } from '../../wh40k11e/domain/rules'
import type { Wh40kRuntime } from '../../wh40k11e/domain/runtime'

const rule = (key: string, overrides: Partial<Wh40kRule> = {}): Wh40kRule => ({
  sourceRecordId: sourceRecordId('wahapedia-wh40k11e', key),
  kind: 'stratagem',
  name: key,
  text: `${key} text`,
  scope: { kind: 'faction', factionId: 'AC' },
  gameMode: 'matched-play',
  timingKind: 'passive',
  timingSource: 'printed',
  ...overrides,
})

const runtime = (revision: string, rules: Wh40kRule[], datasheets: string[] = []): Wh40kRuntime =>
  ({
    schemaVersion: 1,
    revision,
    attribution: 'Powered by Wahapedia',
    sources: {},
    catalog: {
      factions: [
        { id: 'AC', name: 'Adeptus Custodes', armyFactionKeywords: [] },
        { id: 'SM', name: 'Space Marines', armyFactionKeywords: [] },
      ],
      detachments: [],
      datasheets: datasheets.map(name => ({
        sourceRecordId: sourceRecordId('wahapedia-wh40k11e', `sheet-${name}`),
        name,
        factionId: 'SM',
        context: 'current',
        sharedRules: [],
      })),
      rules,
    },
  }) as unknown as Wh40kRuntime

describe('compareWh40kRuntimes', () => {
  it('lists added, removed, reworded, and retimed rules by faction', () => {
    const before = runtime(
      'old',
      [rule('Kept'), rule('Gone'), rule('Reworded'), rule('Retimed')],
      ['Captain']
    )
    const after = runtime(
      'new',
      [
        rule('Kept'),
        rule('Reworded', { text: 'new words' }),
        rule('Retimed', { timingKind: 'reaction' }),
        rule('Fresh', { scope: { kind: 'all-armies' } }),
      ],
      ['Captain', 'Lieutenant']
    )
    const report = compareWh40kRuntimes(before, after)

    expect(report.factions).toEqual([
      {
        factionId: 'AC',
        factionName: 'Adeptus Custodes',
        added: [],
        removed: ['Gone'],
        reworded: ['Reworded'],
        retimed: ['Retimed'],
      },
      { factionId: '*', factionName: 'All armies', added: ['Fresh'], removed: [], reworded: [], retimed: [] },
    ])
    expect(report.datasheets).toEqual({ added: ['Lieutenant'], removed: [] })
    expect(formatWh40kCommitMessage(report)).toBe(
      'Refresh rules data to new\n\nDatasheets: 1 added, 0 removed\nAdeptus Custodes: 1 removed, 1 reworded, 1 retimed\nAll armies: 1 added\n'
    )
    expect(formatWh40kChangeReport(report)).toContain(
      '## Adeptus Custodes (1 removed, 1 reworded, 1 retimed)'
    )
  })

  it('reports no change when nothing moved', () => {
    const same = runtime('a', [rule('Kept')])
    const report = compareWh40kRuntimes(same, { ...same, revision: 'b' })
    expect(isEmptyWh40kChangeReport(report)).toBe(true)
    expect(formatWh40kChangeReport(report)).toContain('No rules, datasheets, or detachments changed.')
  })

  it('ignores key order, which differs between the committed file and a fresh build', () => {
    const timing = {
      windows: [{ kind: 'turn-phase', phase: 'fight', moment: 'end', perspective: 'your' }],
      raw: 'r',
    }
    const sorted = {
      raw: 'r',
      windows: [{ moment: 'end', kind: 'turn-phase', perspective: 'your', phase: 'fight' }],
    }
    const report = compareWh40kRuntimes(
      runtime('a', [rule('Timed', { timingKind: 'timed', timing: sorted as never })]),
      runtime('b', [rule('Timed', { timingKind: 'timed', timing: timing as never })])
    )
    expect(isEmptyWh40kChangeReport(report)).toBe(true)
  })
})
