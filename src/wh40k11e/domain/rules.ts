import type { SourceRecordId } from '../../aos4/domain'
import type { Wh40kTiming } from './timing'

export type Wh40kRuleKind =
  | 'core-stratagem'
  | 'stratagem'
  | 'army-rule'
  | 'detachment-rule'
  | 'enhancement'
  | 'core-ability'
  | 'datasheet-ability'

export type Wh40kRuleScope =
  | { kind: 'all-armies' }
  | { kind: 'faction'; factionId: string }
  | { kind: 'detachment'; factionId: string; detachmentId: string }
  | { kind: 'datasheet'; datasheetId: SourceRecordId }

export type Wh40kRuleCost = { kind: 'command-points'; value: number } | { kind: 'points'; value: number }

export type Wh40kTimingKind = 'timed' | 'reaction' | 'passive' | 'unclassified'

export type Wh40kGameMode = 'matched-play' | 'boarding-actions'

/** Opens each printed list item in rule text, e.g. Command Re-roll's list of rolls. */
export const WH40K_LIST_ITEM_MARKER = '• '

export interface Wh40kRule {
  sourceRecordId: SourceRecordId
  kind: Wh40kRuleKind
  name: string
  text: string
  scope: Wh40kRuleScope
  /** Boarding Actions detachments are a separate game mode, never offered in matched play. */
  gameMode: Wh40kGameMode
  cost?: Wh40kRuleCost
  timingKind: Wh40kTimingKind
  timing?: Wh40kTiming
  timingSource: 'printed' | 'reviewed' | 'unresolved'
  /** A core ability's printed parameter, e.g. "5+" for Feel No Pain 5+. */
  parameter?: string
  /** Enhancement eligibility the rule is printed with, e.g. "Warlord model only". */
  condition?: string
  /** The printed "If your Army Faction is X" gate; the rule applies only to an army declaring X. */
  armyFaction?: string
}

export type Wh40kDatasheetContext = 'current' | 'legends'

export interface Wh40kDatasheet {
  sourceRecordId: SourceRecordId
  name: string
  factionId: string
  context: Wh40kDatasheetContext
  /** Shared core and army rules this datasheet carries, with any printed parameter. */
  sharedRules: Array<{ ruleId: SourceRecordId; parameter?: string }>
}

export interface Wh40kDetachment {
  id: string
  name: string
  factionId: string
  gameMode: Wh40kGameMode
}

export interface Wh40kFaction {
  id: string
  name: string
  /** Reviewed Army Faction keywords this faction's army declares. */
  armyFactionKeywords: string[]
}

/** Everything army selection and reminder projection need, independent of any source format. */
export interface Wh40kCatalog {
  factions: Wh40kFaction[]
  detachments: Wh40kDetachment[]
  datasheets: Wh40kDatasheet[]
  rules: Wh40kRule[]
}
