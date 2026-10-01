import type { Wh40kCatalog } from '../domain/rules'
import type { Wh40kRuntime } from '../domain/runtime'
import runtimeJson from './runtime.json'

// Written by `yarn data:wh40k11e:generate:write`; never edit runtime.json by hand.
export const WH40K_RUNTIME = runtimeJson as unknown as Wh40kRuntime

export const WH40K_CATALOG: Wh40kCatalog = WH40K_RUNTIME.catalog
