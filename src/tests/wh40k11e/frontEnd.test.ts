import { describe, expect, it } from 'vitest'
import { WH40K_CATALOG } from '../../wh40k11e/generated/catalog'
import {
  loadWh40kArmyDocument,
  saveWh40kArmyDocument,
  WH40K_ARMY_STORAGE_KEY,
} from '../../wh40k11e/runtime/armyStorage'
import {
  loadWh40kDisplaySettings,
  saveWh40kDisplaySettings,
  WH40K_DEFAULT_DISPLAY_SETTINGS,
  WH40K_DISPLAY_STORAGE_KEY,
  WH40K_TITLE_BAR_COLOURS,
} from '../../wh40k11e/runtime/displaySettings'
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

// Names that exist before and after the 2026-10 Custodes codex (which renamed Custodian Guard).
const custodianGuard = () =>
  WH40K_CATALOG.datasheets.find(
    item => item.factionId === 'AC' && /^Custodian Guard(?: Sodality)?$/.test(item.name)
  )!

const custodes = (): Wh40kArmyDocument => {
  const detachment = WH40K_CATALOG.detachments.find(
    item =>
      item.factionId === 'AC' && item.name === 'Lions of the Emperor' && item.gameMode === 'matched-play'
  )!
  return {
    ...createWh40kArmyDocument(WH40K_CATALOG, 'AC'),
    detachmentId: detachment.id,
    datasheetIds: [custodianGuard().sourceRecordId],
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

describe('40K allies', () => {
  const agent = () =>
    WH40K_CATALOG.datasheets.find(sheet => sheet.factionId === 'AoI' && sheet.context === 'current')!
  const allied = (): Wh40kArmyDocument => ({
    ...custodes(),
    allyFactionIds: ['AoI'],
    datasheetIds: [custodianGuard().sourceRecordId, agent().sourceRecordId],
  })

  it('lists an allied faction’s units under their own heading after the army’s own', () => {
    const units = createWh40kBuilderViewModel(WH40K_CATALOG, allied()).groups[0].options
    const sections = Array.from(new Set(units.map(option => option.section)))
    expect(sections[sections.length - 1]).toBe('Allies: Imperial Agents')
    expect(units.find(option => option.id === agent().sourceRecordId)?.selected).toBe(true)
    const allies = createWh40kBuilderViewModel(WH40K_CATALOG, allied()).groups.find(
      group => group.key === 'ally'
    )!
    expect(allies.options.filter(option => option.selected).map(option => option.name)).toEqual([
      'Imperial Agents',
    ])
    expect(allies.options.some(option => option.name === 'Adeptus Custodes')).toBe(false)
  })

  it('keeps allied units through storage, and rejects another faction’s unit without the ally', () => {
    const document = allied()
    expect(deserializeWh40kArmyDocument(serializeWh40kArmyDocument(document), WH40K_CATALOG)).toEqual(
      document
    )
    const withoutAlly = { ...document }
    delete withoutAlly.allyFactionIds
    expect(deserializeWh40kArmyDocument(JSON.stringify(withoutAlly), WH40K_CATALOG)).toBeNull()
    expect(
      deserializeWh40kArmyDocument(JSON.stringify({ ...document, allyFactionIds: ['AC'] }), WH40K_CATALOG)
    ).toBeNull()
  })

  it('gives allied units their own reminders without an outside-faction warning', () => {
    const reminders = createWh40kReminderViewModels(WH40K_CATALOG, allied())
    expect(reminders.some(item => item.tags.some(tag => tag.label === agent().name))).toBe(true)
  })
})

describe('40K display settings', () => {
  it('defaults to the site colour and black-and-white print, and keeps only listed colours', () => {
    const storage = memoryStorage()
    expect(loadWh40kDisplaySettings(storage)).toEqual(WH40K_DEFAULT_DISPLAY_SETTINGS)
    expect(WH40K_DEFAULT_DISPLAY_SETTINGS.titleBarColour).toBe('#1c7595')
    expect(new Set(WH40K_TITLE_BAR_COLOURS.map(colour => colour.value)).size).toBe(5)

    saveWh40kDisplaySettings(storage, {
      titleBarColour: WH40K_TITLE_BAR_COLOURS[2].value,
      printInColour: true,
    })
    expect(loadWh40kDisplaySettings(storage)).toEqual({
      titleBarColour: WH40K_TITLE_BAR_COLOURS[2].value,
      printInColour: true,
    })
    storage.setItem(
      WH40K_DISPLAY_STORAGE_KEY,
      JSON.stringify({ titleBarColour: 'url(evil)', printInColour: 'yes' })
    )
    expect(loadWh40kDisplaySettings(storage)).toEqual(WH40K_DEFAULT_DISPLAY_SETTINGS)
  })
})

describe('40K builder view model', () => {
  it('offers Units and Detachment, Enhancements only once a detachment is chosen, then Allies', () => {
    const empty = createWh40kBuilderViewModel(WH40K_CATALOG, createWh40kArmyDocument(WH40K_CATALOG, 'AC'))
    expect(empty.groups.map(group => group.title)).toEqual(['Units', 'Detachment', 'Allies'])
    expect(empty.factions.find(faction => faction.value === 'AC')?.label).toBe('Adeptus Custodes')

    const army = createWh40kBuilderViewModel(WH40K_CATALOG, custodes())
    expect(army.groups.map(group => group.title)).toEqual(['Units', 'Detachment', 'Enhancements', 'Allies'])
    expect(army.groups[0].options.filter(option => option.selected).map(option => option.name)).toEqual([
      custodianGuard().name,
    ])
    expect(army.groups[1].options.filter(option => option.selected).map(option => option.name)).toEqual([
      'Lions of the Emperor',
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

  it('narrows Space Marine units to one Chapter plus the units open to every Chapter', () => {
    const units = (subFaction?: string, datasheetIds: string[] = []) => {
      const document = { ...createWh40kArmyDocument(WH40K_CATALOG, 'SM'), datasheetIds }
      const builder = createWh40kBuilderViewModel(
        WH40K_CATALOG,
        subFaction ? { ...document, subFaction } : document
      )
      return { builder, names: builder.groups[0].options.map(option => option.name) }
    }
    const all = units()
    expect(all.builder.subFactions?.label).toBe('Chapter')
    expect(all.builder.subFactions?.options.map(option => option.value)).toContain('Space Wolves')

    const chapterOf = (keyword: string) =>
      WH40K_CATALOG.datasheets
        .filter(sheet => sheet.subFactionKeywords?.includes(keyword))
        .map(sheet => sheet.name)
    const wolves = units('Space Wolves').names
    expect(wolves.length).toBeLessThan(all.names.length)
    expect(wolves).toEqual(expect.arrayContaining(chapterOf('Space Wolves')))
    expect(
      wolves.some(
        name => chapterOf('Blood Angels').includes(name) && !chapterOf('Space Wolves').includes(name)
      )
    ).toBe(false)
    expect(wolves).toContain('Captain')

    const angel = WH40K_CATALOG.datasheets.find(sheet => sheet.subFactionKeywords?.includes('Blood Angels'))!
    expect(units('Space Wolves', [angel.sourceRecordId]).names).toContain(angel.name)
    expect(createWh40kBuilderViewModel(WH40K_CATALOG, custodes()).subFactions).toBeUndefined()
  })

  it('keeps a stored Chapter, and drops one the catalog does not list without losing the army', () => {
    const marines = { ...createWh40kArmyDocument(WH40K_CATALOG, 'SM'), subFaction: 'Blood Angels' }
    expect(deserializeWh40kArmyDocument(JSON.stringify(marines), WH40K_CATALOG)?.subFaction).toBe(
      'Blood Angels'
    )
    const restored = deserializeWh40kArmyDocument(
      JSON.stringify({ ...marines, subFaction: 'Lamenters' }),
      WH40K_CATALOG
    )
    expect(restored).not.toBeNull()
    expect(restored?.subFaction).toBeUndefined()
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

  it('hangs a printed list on the paragraph that introduces it', () => {
    const sections = splitWh40kRuleText(
      'WHEN: Just after you make one of the following rolls:\n• Hit roll\n• Wound roll\nTARGET: That unit.'
    )
    expect(sections).toEqual([
      {
        label: 'When',
        text: 'Just after you make one of the following rolls:',
        items: ['Hit roll', 'Wound roll'],
        compact: true,
      },
      { label: 'Target', text: 'That unit.' },
    ])
  })

  it('keeps a list of full sentences as a bulleted list', () => {
    const sentence = 'Each time this unit makes an attack, re-roll a Hit roll of 1.'
    expect(splitWh40kRuleText(`Select one:\n• ${sentence}\n• ${sentence}`)).toEqual([
      { text: 'Select one:', items: [sentence, sentence] },
    ])
  })

  it('groups an army by moment of the game and tags cost, turn, and carrier', () => {
    const reminders = createWh40kReminderViewModels(WH40K_CATALOG, custodes())
    expect(reminders.length).toBeGreaterThan(10)
    const stratagem = reminders.find(item => item.tags.some(tag => tag.tone === 'cost'))!
    expect(stratagem.tags[0].label).toMatch(/Stratagem/)
    const standing = reminders.find(
      item =>
        item.windowLabel === 'Always active' && item.tags.some(tag => tag.label === custodianGuard().name)
    )
    expect(standing).toBeDefined()
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
