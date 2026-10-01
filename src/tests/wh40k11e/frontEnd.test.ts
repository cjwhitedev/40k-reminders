import { describe, expect, it } from 'vitest'
import { WH40K_CATALOG } from '../../wh40k11e/generated/catalog'
import {
  loadWh40kArmyDocument,
  saveWh40kArmyDocument,
  WH40K_ARMY_STORAGE_KEY,
} from '../../wh40k11e/runtime/armyStorage'
import {
  createWh40kArmyDocument,
  deserializeWh40kArmyDocument,
  serializeWh40kArmyDocument,
  setWh40kReminderPreference,
  type Wh40kArmyDocument,
} from '../../wh40k11e/state/armyDocument'
import { createWh40kBuilderViewModel } from '../../wh40k11e/view/builder'
import { createWh40kReminderViewModels, splitWh40kRuleText } from '../../wh40k11e/view/reminders'

const memoryStorage = (): Storage => {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => Array.from(values.keys())[index] ?? null,
    removeItem: key => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}

const custodes = (): Wh40kArmyDocument => {
  const detachment = WH40K_CATALOG.detachments.find(
    item => item.factionId === 'AC' && item.name === 'Shield Host' && item.gameMode === 'matched-play'
  )!
  const guard = WH40K_CATALOG.datasheets.find(
    item => item.factionId === 'AC' && item.name === 'Custodian Guard'
  )!
  return {
    ...createWh40kArmyDocument(WH40K_CATALOG, 'AC'),
    detachmentId: detachment.id,
    datasheetIds: [guard.sourceRecordId],
  }
}

describe('40K army document', () => {
  it('round-trips a valid army', () => {
    const document = custodes()
    expect(deserializeWh40kArmyDocument(serializeWh40kArmyDocument(document), WH40K_CATALOG)).toEqual(
      document
    )
  })

  it('rejects unknown IDs and units outside the faction rather than translating them', () => {
    const document = custodes()
    const outsider = WH40K_CATALOG.datasheets.find(item => item.factionId !== 'AC')!
    for (const broken of [
      { ...document, factionId: 'NOPE' },
      { ...document, detachmentId: 'missing' },
      { ...document, datasheetIds: [outsider.sourceRecordId] },
      { ...document, enhancementIds: ['source-record:wahapedia-wh40k11e:missing'] },
      { ...document, schemaVersion: 2 },
    ]) {
      expect(deserializeWh40kArmyDocument(JSON.stringify(broken), WH40K_CATALOG)).toBeNull()
    }
    expect(deserializeWh40kArmyDocument('not json', WH40K_CATALOG)).toBeNull()
  })

  it('drops empty reminder preferences', () => {
    const hidden = setWh40kReminderPreference(custodes(), 'reminder:x', { hidden: true })
    expect(hidden.reminderPreferences).toEqual({ 'reminder:x': { hidden: true } })
    expect(setWh40kReminderPreference(hidden, 'reminder:x', { hidden: false }).reminderPreferences).toEqual(
      {}
    )
  })
})

describe('40K army storage', () => {
  it('defaults to Space Marines, then restores what was saved', () => {
    const storage = memoryStorage()
    expect(loadWh40kArmyDocument(storage, WH40K_CATALOG)).toMatchObject({
      source: 'default',
      document: { factionId: 'SM', name: 'Space Marines' },
    })
    saveWh40kArmyDocument(storage, custodes())
    expect(loadWh40kArmyDocument(storage, WH40K_CATALOG)).toEqual({ source: 'storage', document: custodes() })
  })

  it('replaces an unreadable document with a clean one', () => {
    const storage = memoryStorage()
    storage.setItem(WH40K_ARMY_STORAGE_KEY, '{"schemaVersion":1}')
    expect(loadWh40kArmyDocument(storage, WH40K_CATALOG).source).toBe('reset')
    expect(storage.getItem(WH40K_ARMY_STORAGE_KEY)).toBeNull()
  })
})

describe('40K builder view model', () => {
  it('offers Units and Detachment, and Enhancements only once a detachment is chosen', () => {
    const empty = createWh40kBuilderViewModel(WH40K_CATALOG, createWh40kArmyDocument(WH40K_CATALOG, 'AC'))
    expect(empty.groups.map(group => group.title)).toEqual(['Units', 'Detachment'])
    expect(empty.factions.find(faction => faction.value === 'AC')?.label).toBe('Adeptus Custodes')

    const army = createWh40kBuilderViewModel(WH40K_CATALOG, custodes())
    expect(army.groups.map(group => group.title)).toEqual(['Units', 'Detachment', 'Enhancements'])
    expect(army.groups[0].options.filter(option => option.selected).map(option => option.name)).toEqual([
      'Custodian Guard',
    ])
    expect(army.groups[1].options.filter(option => option.selected).map(option => option.name)).toEqual([
      'Shield Host',
    ])
  })

  it('marks Legends datasheets so they list under their own header', () => {
    const faction = WH40K_CATALOG.datasheets.find(sheet => sheet.context === 'legends')!.factionId
    const builder = createWh40kBuilderViewModel(
      WH40K_CATALOG,
      createWh40kArmyDocument(WH40K_CATALOG, faction)
    )
    expect(builder.groups[0].options.some(option => option.overlay === 'legends')).toBe(true)
  })
})

describe('40K reminder view models', () => {
  it('keeps stratagem WHEN/TARGET/EFFECT labels as sections', () => {
    expect(splitWh40kRuleText('WHEN: Fight phase.\nTARGET: One unit.\nEFFECT: Add 1 to Hit rolls.')).toEqual([
      { label: 'When', text: 'Fight phase.' },
      { label: 'Target', text: 'One unit.' },
      { label: 'Effect', text: 'Add 1 to Hit rolls.' },
    ])
  })

  it('groups an army by moment of the game and tags cost, turn, and carrier', () => {
    const reminders = createWh40kReminderViewModels(WH40K_CATALOG, custodes())
    expect(reminders.length).toBeGreaterThan(10)
    const stratagem = reminders.find(item => item.tags.some(tag => tag.tone === 'cost'))!
    expect(stratagem.tags[0].label).toMatch(/Stratagem/)
    const shield = reminders.find(item => item.name === 'Praesidium Shield')!
    expect(shield.windowLabel).toBe('Always active')
    expect(shield.tags.map(tag => tag.label)).toContain('Custodian Guard')
  })

  it('applies hidden, note, and drag order preferences', () => {
    const army = custodes()
    const reminders = createWh40kReminderViewModels(WH40K_CATALOG, army)
    const sizes = new Map<string, number>()
    for (const item of reminders) sizes.set(item.windowKey, (sizes.get(item.windowKey) ?? 0) + 1)
    const largest = Array.from(sizes).sort((left, right) => right[1] - left[1])[0][0]
    const group = reminders.filter(item => item.windowKey === largest)
    expect(group.length).toBeGreaterThan(1)
    const last = group[group.length - 1]
    let next = setWh40kReminderPreference(army, last.id, { order: 0, hidden: true, note: 'Remember this' })
    next = setWh40kReminderPreference(next, group[0].id, { order: 1 })
    const updated = createWh40kReminderViewModels(WH40K_CATALOG, next).filter(
      item => item.windowKey === largest
    )
    expect(updated[0]).toMatchObject({ id: last.id, hidden: true, note: 'Remember this' })
    expect(updated[1].id).toBe(group[0].id)
  })
})
