type JsonRecord = Record<string, unknown>

export interface BsDataCatalogueInput {
  path: string
  checksum: string
  bytes: Uint8Array
}

export interface BsDataCatalogueDiagnostic {
  code:
    | 'invalid-json'
    | 'invalid-document'
    | 'invalid-catalogue'
    | 'unresolved-catalogue-link'
    | 'unresolved-entry-link'
    | 'ambiguous-entry-link'
  severity: 'error'
  message: string
  path?: string
}

export interface BsDataCatalogueIndex {
  schemaVersion: 1
  status: 'blocked' | 'candidate-review-required'
  gameSystems: Array<{ id: string; name: string; path: string; checksum: string; entryCount: number }>
  catalogues: Array<{
    id: string
    name: string
    library: boolean
    path: string
    checksum: string
    entryCount: number
  }>
  selections: Array<{
    catalogueId: string
    catalogueName: string
    /** The catalogue whose root entries carry this selection; differs from `catalogueId` when imported. */
    sourceCatalogueId: string
    linkId: string
    linkName: string
    targetId: string
    definitionCatalogueId: string
    definitionCatalogueName: string
    definitionName: string
    definitionType: string | null
    definitionPath: string
    definitionChecksum: string
  }>
  diagnostics: BsDataCatalogueDiagnostic[]
}

interface CatalogueDocument {
  id: string
  name: string
  gameSystemId: string
  library: boolean
  path: string
  checksum: string
  catalogueLinks: JsonRecord[]
  entryLinks: JsonRecord[]
  rootEntries: JsonRecord[]
  definitions: EntryDefinition[]
}

type OfferedSelection = Omit<BsDataCatalogueIndex['selections'][number], 'catalogueId' | 'catalogueName'>

interface EntryDefinition {
  id: string
  name: string
  type: string | null
  catalogueId: string
  catalogueName: string
  path: string
  checksum: string
}

interface GameSystemDocument {
  gameSystem: { id: string; name: string; path: string; checksum: string; entryCount: number }
  definitions: EntryDefinition[]
}

const SELECTION_COLLECTIONS = [
  'selectionEntries',
  'sharedSelectionEntries',
  'selectionEntryGroups',
  'sharedSelectionEntryGroups',
] as const

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringField = (record: JsonRecord, key: string): string | undefined =>
  typeof record[key] === 'string' && record[key].trim() ? (record[key] as string).trim() : undefined

const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

const collectDefinitions = (
  catalogue: JsonRecord,
  document: Pick<CatalogueDocument, 'id' | 'name' | 'path' | 'checksum'>
): EntryDefinition[] => {
  const definitions: EntryDefinition[] = []
  const visit = (value: unknown): void => {
    if (!isRecord(value)) return
    const id = stringField(value, 'id')
    const name = stringField(value, 'name')
    if (id && name) {
      definitions.push({
        id,
        name,
        type: stringField(value, 'type') ?? null,
        catalogueId: document.id,
        catalogueName: document.name,
        path: document.path,
        checksum: document.checksum,
      })
    }
    for (const key of SELECTION_COLLECTIONS) {
      const children = value[key]
      if (Array.isArray(children)) children.forEach(visit)
    }
  }
  for (const key of SELECTION_COLLECTIONS) {
    const entries = catalogue[key]
    if (Array.isArray(entries)) entries.forEach(visit)
  }
  return definitions
}

const parseDocument = (
  input: BsDataCatalogueInput,
  diagnostics: BsDataCatalogueDiagnostic[]
): CatalogueDocument | GameSystemDocument | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.bytes))
  } catch (error) {
    diagnostics.push({
      code: 'invalid-json',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Could not decode JSON document',
      path: input.path,
    })
    return undefined
  }

  if (!isRecord(parsed)) {
    diagnostics.push({
      code: 'invalid-document',
      severity: 'error',
      message: 'Document root must be a JSON object',
      path: input.path,
    })
    return undefined
  }

  const gameSystem = parsed.gameSystem
  if (isRecord(gameSystem)) {
    const id = stringField(gameSystem, 'id')
    const name = stringField(gameSystem, 'name')
    if (!id || !name) {
      diagnostics.push({
        code: 'invalid-document',
        severity: 'error',
        message: 'Game system must have a name and stable id',
        path: input.path,
      })
      return undefined
    }
    const document = { id, name, path: input.path, checksum: input.checksum }
    const definitions = collectDefinitions(gameSystem, {
      ...document,
    })
    return {
      gameSystem: { ...document, entryCount: definitions.length },
      definitions,
    }
  }

  const catalogue = parsed.catalogue
  if (!isRecord(catalogue)) {
    diagnostics.push({
      code: 'invalid-document',
      severity: 'error',
      message: 'Expected a BSData catalogue or game system document',
      path: input.path,
    })
    return undefined
  }
  const id = stringField(catalogue, 'id')
  const name = stringField(catalogue, 'name')
  const gameSystemId = stringField(catalogue, 'gameSystemId')
  if (!id || !name || !gameSystemId) {
    diagnostics.push({
      code: 'invalid-catalogue',
      severity: 'error',
      message: 'Catalogue must have a name and stable id',
      path: input.path,
    })
    return undefined
  }

  const catalogueLinks = catalogue.catalogueLinks ?? []
  const entryLinks = catalogue.entryLinks ?? []
  const rootEntries = catalogue.selectionEntries ?? []
  if (
    !Array.isArray(catalogueLinks) ||
    !catalogueLinks.every(isRecord) ||
    !Array.isArray(entryLinks) ||
    !entryLinks.every(isRecord) ||
    !Array.isArray(rootEntries) ||
    !rootEntries.every(isRecord)
  ) {
    diagnostics.push({
      code: 'invalid-catalogue',
      severity: 'error',
      message: 'Catalogue links, entry links, and selection entries must be arrays of objects when present',
      path: input.path,
    })
    return undefined
  }

  const document = {
    id,
    name,
    gameSystemId,
    library: catalogue.library === true,
    path: input.path,
    checksum: input.checksum,
  }
  return {
    ...document,
    catalogueLinks,
    entryLinks,
    rootEntries,
    definitions: collectDefinitions(catalogue, document),
  }
}

export const indexBsDataCatalogues = (inputs: BsDataCatalogueInput[]): BsDataCatalogueIndex => {
  const diagnostics: BsDataCatalogueDiagnostic[] = []
  const gameSystems: BsDataCatalogueIndex['gameSystems'] = []
  const systemDefinitions: EntryDefinition[] = []
  const catalogues: CatalogueDocument[] = []

  for (const input of [...inputs].sort((left, right) => compare(left.path, right.path))) {
    const document = parseDocument(input, diagnostics)
    if (!document) continue
    if ('gameSystem' in document) {
      gameSystems.push(document.gameSystem)
      systemDefinitions.push(...document.definitions)
    } else catalogues.push(document)
  }

  const catalogueById = new Map<string, CatalogueDocument>()
  for (const catalogue of catalogues) {
    if (catalogueById.has(catalogue.id)) {
      diagnostics.push({
        code: 'invalid-catalogue',
        severity: 'error',
        message: `Catalogue id ${catalogue.id} occurs in more than one input`,
        path: catalogue.path,
      })
    } else {
      catalogueById.set(catalogue.id, catalogue)
    }
  }
  const gameSystemIds = new Set(gameSystems.map(gameSystem => gameSystem.id))

  const definitionsById = new Map<string, EntryDefinition[]>()
  for (const catalogue of catalogues) {
    for (const definition of catalogue.definitions) {
      const definitions = definitionsById.get(definition.id) ?? []
      definitions.push(definition)
      definitionsById.set(definition.id, definitions)
    }
  }
  for (const definition of systemDefinitions) {
    const definitions = definitionsById.get(definition.id) ?? []
    definitions.push(definition)
    definitionsById.set(definition.id, definitions)
  }

  const linkedScope = (catalogue: CatalogueDocument): Set<string> => {
    const linkedCatalogueIds = new Set<string>([catalogue.id])
    if (gameSystemIds.has(catalogue.gameSystemId)) linkedCatalogueIds.add(catalogue.gameSystemId)
    const pending = catalogue.catalogueLinks
      .map(link => stringField(link, 'targetId'))
      .filter((id): id is string => Boolean(id))
    while (pending.length) {
      const linkedId = pending.pop() as string
      if (linkedCatalogueIds.has(linkedId)) continue
      linkedCatalogueIds.add(linkedId)
      const linkedCatalogue = catalogueById.get(linkedId)
      if (!linkedCatalogue) {
        diagnostics.push({
          code: 'unresolved-catalogue-link',
          severity: 'error',
          message: `Catalogue ${catalogue.name} links to missing catalogue ${linkedId}`,
          path: catalogue.path,
        })
        continue
      }
      for (const link of linkedCatalogue.catalogueLinks) {
        const targetId = stringField(link, 'targetId')
        if (targetId) pending.push(targetId)
      }
    }
    return linkedCatalogueIds
  }

  const ownRootsById = new Map<string, OfferedSelection[]>()
  const ownRoots = (catalogue: CatalogueDocument): OfferedSelection[] => {
    const cached = ownRootsById.get(catalogue.id)
    if (cached) return cached
    const linkedCatalogueIds = linkedScope(catalogue)
    const roots: OfferedSelection[] = []
    for (const entry of catalogue.rootEntries) {
      const id = stringField(entry, 'id')
      const name = stringField(entry, 'name')
      if (!id || !name) continue
      roots.push({
        sourceCatalogueId: catalogue.id,
        linkId: id,
        linkName: name,
        targetId: id,
        definitionCatalogueId: catalogue.id,
        definitionCatalogueName: catalogue.name,
        definitionName: name,
        definitionType: stringField(entry, 'type') ?? null,
        definitionPath: catalogue.path,
        definitionChecksum: catalogue.checksum,
      })
    }
    for (const link of catalogue.entryLinks) {
      const targetId = stringField(link, 'targetId')
      if (!targetId) {
        diagnostics.push({
          code: 'unresolved-entry-link',
          severity: 'error',
          message: `Entry link in ${catalogue.name} is missing its target id`,
          path: catalogue.path,
        })
        continue
      }
      const matches = (definitionsById.get(targetId) ?? []).filter(definition =>
        linkedCatalogueIds.has(definition.catalogueId)
      )
      if (matches.length !== 1) {
        diagnostics.push({
          code: matches.length ? 'ambiguous-entry-link' : 'unresolved-entry-link',
          severity: 'error',
          message: matches.length
            ? `Entry link ${targetId} in ${catalogue.name} resolves to ${matches.length} definitions`
            : `Entry link ${targetId} in ${catalogue.name} has no definition in its linked catalogues`,
          path: catalogue.path,
        })
        continue
      }
      const [definition] = matches
      roots.push({
        sourceCatalogueId: catalogue.id,
        linkId: stringField(link, 'id') ?? '',
        linkName: stringField(link, 'name') ?? '',
        targetId,
        definitionCatalogueId: definition.catalogueId,
        definitionCatalogueName: definition.catalogueName,
        definitionName: definition.name,
        definitionType: definition.type,
        definitionPath: definition.path,
        definitionChecksum: definition.checksum,
      })
    }
    ownRootsById.set(catalogue.id, roots)
    return roots
  }

  const offeredRoots = (catalogue: CatalogueDocument): OfferedSelection[] => {
    const visited = new Set<string>()
    const offered: OfferedSelection[] = []
    const pending = [catalogue]
    while (pending.length) {
      const current = pending.pop() as CatalogueDocument
      if (visited.has(current.id)) continue
      visited.add(current.id)
      offered.push(...ownRoots(current))
      for (const link of current.catalogueLinks) {
        const targetId = stringField(link, 'targetId')
        const imported = targetId && link.importRootEntries === true ? catalogueById.get(targetId) : undefined
        if (imported) pending.push(imported)
      }
    }
    return offered
  }

  const selections: BsDataCatalogueIndex['selections'] = []
  for (const catalogue of catalogues) {
    for (const root of offeredRoots(catalogue)) {
      selections.push({ catalogueId: catalogue.id, catalogueName: catalogue.name, ...root })
    }
  }

  const sortedDiagnostics = diagnostics.sort(
    (left, right) =>
      compare(left.path ?? '', right.path ?? '') ||
      compare(left.code, right.code) ||
      compare(left.message, right.message)
  )
  const sortedCatalogues = catalogues
    .map(catalogue => ({
      id: catalogue.id,
      name: catalogue.name,
      library: catalogue.library,
      path: catalogue.path,
      checksum: catalogue.checksum,
      entryCount: catalogue.definitions.length,
    }))
    .sort((left, right) => compare(left.id, right.id) || compare(left.path, right.path))

  return {
    schemaVersion: 1,
    status: sortedDiagnostics.some(diagnostic => diagnostic.severity === 'error')
      ? 'blocked'
      : 'candidate-review-required',
    gameSystems: gameSystems.sort(
      (left, right) => compare(left.id, right.id) || compare(left.path, right.path)
    ),
    catalogues: sortedCatalogues,
    selections: selections.sort(
      (left, right) =>
        compare(left.catalogueId, right.catalogueId) ||
        compare(left.targetId, right.targetId) ||
        compare(left.sourceCatalogueId, right.sourceCatalogueId) ||
        compare(left.linkId, right.linkId) ||
        compare(left.linkName, right.linkName)
    ),
    diagnostics: sortedDiagnostics,
  }
}
