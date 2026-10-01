import type { Wh40kCatalog } from '../domain/rules'
import {
  createWh40kArmyDocument,
  deserializeWh40kArmyDocument,
  serializeWh40kArmyDocument,
  WH40K_DEFAULT_FACTION_ID,
  type Wh40kArmyDocument,
} from '../state/armyDocument'

export const WH40K_ARMY_STORAGE_KEY = 'wh40k-reminders:wh40k11e:army:v1'

export interface LoadWh40kArmyDocumentResult {
  document: Wh40kArmyDocument
  source: 'default' | 'storage' | 'reset'
}

export const createDefaultWh40kArmyDocument = (catalog: Wh40kCatalog): Wh40kArmyDocument =>
  createWh40kArmyDocument(catalog, WH40K_DEFAULT_FACTION_ID)

export const loadWh40kArmyDocument = (
  storage: Storage,
  catalog: Wh40kCatalog
): LoadWh40kArmyDocumentResult => {
  const serialized = storage.getItem(WH40K_ARMY_STORAGE_KEY)
  if (!serialized) return { document: createDefaultWh40kArmyDocument(catalog), source: 'default' }
  const document = deserializeWh40kArmyDocument(serialized, catalog)
  if (document) return { document, source: 'storage' }
  storage.removeItem(WH40K_ARMY_STORAGE_KEY)
  return { document: createDefaultWh40kArmyDocument(catalog), source: 'reset' }
}

export const saveWh40kArmyDocument = (storage: Storage, document: Wh40kArmyDocument): void => {
  storage.setItem(WH40K_ARMY_STORAGE_KEY, serializeWh40kArmyDocument(document))
}
