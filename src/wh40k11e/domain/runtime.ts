import type { Wh40kCatalog } from './rules'

export interface Wh40kRuntimeSource {
  url: string
  checksum: string
}

/** The checked-in product the app loads: the reviewed catalog plus the pinned inputs it came from. */
export interface Wh40kRuntime {
  schemaVersion: 1
  /** The source review revision the catalog was generated from. */
  revision: string
  attribution: 'Powered by Wahapedia'
  sources: {
    bsdata: { repository: string; commit: string }
    wahapediaExports: Wh40kRuntimeSource[]
    officialDocuments: Wh40kRuntimeSource[]
  }
  catalog: Wh40kCatalog
}
