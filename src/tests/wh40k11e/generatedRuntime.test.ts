import { describe, expect, it } from 'vitest'
import type { SourceRecordId } from '../../aos4/domain'
import type { Wh40kCatalog, Wh40kRule } from '../../wh40k11e/domain/rules'
import { validateWh40kCatalog } from '../../wh40k11e/domain/validateCatalog'
import { WH40K_CATALOG, WH40K_RUNTIME } from '../../wh40k11e/generated/catalog'
import { projectWh40kReminders } from '../../wh40k11e/reminders/projectReminders'
import { selectWh40kRules } from '../../wh40k11e/select/selectRules'

const rule = (overrides: Partial<Wh40kRule>): Wh40kRule => ({
  sourceRecordId: 'source-record:test:rule' as SourceRecordId,
  kind: 'army-rule',
  name: 'Test rule',
  text: 'While this unit is on the battlefield, add 1 to Hit rolls.',
  scope: { kind: 'faction', factionId: 'AC' },
  gameMode: 'matched-play',
  timingKind: 'passive',
  timingSource: 'printed',
  ...overrides,
})

const catalog = (rules: Wh40kRule[]): Wh40kCatalog => ({
  factions: [{ id: 'AC', name: 'Adeptus Custodes' }],
  detachments: [],
  datasheets: [],
  rules,
})

describe('validateWh40kCatalog', () => {
  it('accepts a consistent catalog', () => {
    expect(validateWh40kCatalog(catalog([rule({})]))).toEqual([])
  })

  it('reports duplicate IDs, dangling scopes, and matched-play rules without timing', () => {
    expect(
      validateWh40kCatalog(
        catalog([
          rule({}),
          rule({}),
          rule({
            sourceRecordId: 'source-record:test:orphan' as SourceRecordId,
            scope: { kind: 'detachment', factionId: 'XX', detachmentId: 'missing' },
            timingKind: 'unclassified',
            timingSource: 'unresolved',
          }),
        ])
      )
    ).toEqual([
      'duplicate rule source-record:test:rule',
      'rule source-record:test:orphan names unknown faction XX',
      'rule source-record:test:orphan names unknown detachment missing',
      'matched-play rule source-record:test:orphan has no reviewed timing',
    ])
  })
})

describe('checked-in 40K runtime', () => {
  it('carries Wahapedia attribution and its pinned inputs', () => {
    expect(WH40K_RUNTIME.schemaVersion).toBe(1)
    expect(WH40K_RUNTIME.attribution).toBe('Powered by Wahapedia')
    expect(WH40K_RUNTIME.sources.bsdata.commit).toMatch(/^[0-9a-f]{40}$/)
    for (const source of [
      ...WH40K_RUNTIME.sources.wahapediaExports,
      ...WH40K_RUNTIME.sources.officialDocuments,
    ]) {
      expect(source.checksum).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('passes catalog integrity', () => {
    expect(validateWh40kCatalog(WH40K_CATALOG)).toEqual([])
  })

  it('projects a Custodes army to reminders without unresolved timing', () => {
    const detachment = WH40K_CATALOG.detachments.find(
      item => item.factionId === 'AC' && item.name === 'Shield Host' && item.gameMode === 'matched-play'
    )
    const guard = WH40K_CATALOG.datasheets.find(
      item => item.factionId === 'AC' && item.name === 'Custodian Guard'
    )
    expect(detachment).toBeDefined()
    expect(guard).toBeDefined()

    const selection = selectWh40kRules(WH40K_CATALOG, {
      factionId: 'AC',
      detachmentId: detachment!.id,
      datasheetIds: [guard!.sourceRecordId],
      enhancementIds: [],
      allowsLegends: false,
    })
    const reminders = projectWh40kReminders(selection.selected)
    expect(selection.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(reminders.length).toBeGreaterThan(10)
    expect(reminders.filter(item => item.lane === 'unresolved')).toEqual([])
    expect(reminders.map(item => item.name)).toContain('Praesidium Shield')
  })
})
