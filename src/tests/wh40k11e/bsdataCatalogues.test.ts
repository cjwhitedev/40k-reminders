import { describe, expect, it } from 'vitest'
import { indexBsDataCatalogues, type BsDataCatalogueInput } from '../../wh40k11e/data/bsdata/catalogues'

const input = (path: string, value: unknown, checksum = `checksum-${path}`): BsDataCatalogueInput => ({
  path,
  checksum,
  bytes: new TextEncoder().encode(JSON.stringify(value)),
})

const faction = {
  catalogue: {
    id: 'faction-1',
    name: 'Faction',
    gameSystemId: 'system-1',
    library: false,
    catalogueLinks: [{ name: 'Faction Library', targetId: 'library-1' }],
    entryLinks: [
      { id: 'link-system', name: 'Show Options', targetId: 'system-option', type: 'selectionEntry' },
      { id: 'link-z', name: 'Zeta', targetId: 'unit-z', type: 'selectionEntry' },
      { id: 'link-a', name: 'Alpha', targetId: 'unit-a', type: 'selectionEntry' },
    ],
  },
}

const library = {
  catalogue: {
    id: 'library-1',
    name: 'Faction Library',
    gameSystemId: 'system-1',
    library: true,
    sharedSelectionEntries: [
      { id: 'unit-z', name: 'Zeta', type: 'unit' },
      { id: 'unit-a', name: 'Alpha', type: 'unit' },
    ],
  },
}

const gameSystem = {
  gameSystem: {
    id: 'system-1',
    name: 'Warhammer 40,000',
    sharedSelectionEntries: [{ id: 'system-option', name: 'Show Options', type: 'upgrade' }],
  },
}

describe('indexBsDataCatalogues', () => {
  it('resolves entry links by stable id and sorts output independently of input order', () => {
    const result = indexBsDataCatalogues([
      input('faction.json', faction),
      input('library.json', library),
      input('system.json', gameSystem),
    ])
    const reversed = indexBsDataCatalogues([
      input('system.json', gameSystem),
      input('library.json', library),
      input('faction.json', faction),
    ])

    expect(result.status).toBe('candidate-review-required')
    expect(result.selections.map(selection => selection.targetId)).toEqual([
      'system-option',
      'unit-a',
      'unit-z',
    ])
    expect(result.selections[1]).toMatchObject({
      catalogueId: 'faction-1',
      definitionCatalogueId: 'library-1',
      definitionName: 'Alpha',
      definitionType: 'unit',
    })
    expect(JSON.stringify(result)).toBe(JSON.stringify(reversed))
  })

  it('blocks unresolved links rather than silently dropping them', () => {
    const missing = {
      catalogue: {
        ...faction.catalogue,
        entryLinks: [{ id: 'link-missing', name: 'Missing', targetId: 'not-in-library' }],
      },
    }
    const result = indexBsDataCatalogues([
      input('faction.json', missing),
      input('library.json', library),
      input('system.json', gameSystem),
    ])

    expect(result.status).toBe('blocked')
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unresolved-entry-link', path: 'faction.json' })
    )
  })

  it('offers root entries imported from linked catalogues and defined at the catalogue root', () => {
    const chapter = {
      catalogue: {
        id: 'chapter-1',
        name: 'Chapter',
        gameSystemId: 'system-1',
        catalogueLinks: [
          { name: 'Faction', targetId: 'faction-1', importRootEntries: true },
          { name: 'Faction Library', targetId: 'library-1' },
        ],
        selectionEntries: [{ id: 'unit-chapter', name: 'Chapter Hero', type: 'model' }],
      },
    }
    const result = indexBsDataCatalogues([
      input('chapter.json', chapter),
      input('faction.json', faction),
      input('library.json', library),
      input('system.json', gameSystem),
    ])
    const offered = result.selections.filter(selection => selection.catalogueId === 'chapter-1')

    expect(result.status).toBe('candidate-review-required')
    expect(offered.map(selection => [selection.targetId, selection.sourceCatalogueId])).toEqual([
      ['system-option', 'faction-1'],
      ['unit-a', 'faction-1'],
      ['unit-chapter', 'chapter-1'],
      ['unit-z', 'faction-1'],
    ])
  })
})
