import { stableCompactJson } from '../../aos4/generate/serialization'
import type { Wh40kSourceReview } from '../data/review'
import type { Wh40kCatalog } from '../domain/rules'
import type { Wh40kRuntime } from '../domain/runtime'
import { validateWh40kCatalog } from '../domain/validateCatalog'

export const WH40K_RUNTIME_PATH = 'src/wh40k11e/generated/runtime.json'

export const buildWh40kRuntime = (review: Wh40kSourceReview, catalog: Wh40kCatalog): Wh40kRuntime => {
  const problems = validateWh40kCatalog(catalog)
  if (problems.length) {
    throw new Error(`40K catalog failed integrity:\n${problems.map(problem => `  ${problem}`).join('\n')}`)
  }
  return {
    schemaVersion: 1,
    revision: review.revision,
    attribution: 'Powered by Wahapedia',
    sources: {
      bsdata: review.inputs.bsdata,
      wahapediaExports: review.inputs.wahapediaExports,
      officialDocuments: review.inputs.officialDocuments,
    },
    catalog,
  }
}

export const serializeWh40kRuntime = (runtime: Wh40kRuntime): string => stableCompactJson(runtime)
