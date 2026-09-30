// Turn structure from the official 11th-edition Core Rules: a battle round is start of battle round,
// both players' turns, then end of battle round (07.01-07.03); each turn is the Start of Turn step,
// five phases in order, then the End of Turn step (07.02).
export const WH40K_TURN_PHASES = [
  { id: 'command', name: 'Command', order: 1 },
  { id: 'movement', name: 'Movement', order: 2 },
  { id: 'shooting', name: 'Shooting', order: 3 },
  { id: 'charge', name: 'Charge', order: 4 },
  { id: 'fight', name: 'Fight', order: 5 },
] as const

export type Wh40kPhaseId = (typeof WH40K_TURN_PHASES)[number]['id']

const PHASE_IDS = new Set<string>(WH40K_TURN_PHASES.map(phase => phase.id))

export const isWh40kPhaseId = (value: string): value is Wh40kPhaseId => PHASE_IDS.has(value)

/** Whose turn the window falls in, relative to the player using the rule. */
export type Wh40kPerspective = 'your' | 'opponent' | 'either'

export type Wh40kMoment = 'start' | 'during' | 'end'

export type Wh40kGameWindow =
  | { kind: 'pre-battle'; step: string }
  | { kind: 'battle'; moment: 'start' | 'end' }
  | { kind: 'battle-round'; moment: 'start' | 'end'; round?: number }
  | { kind: 'turn-step'; step: 'start-of-turn' | 'end-of-turn'; perspective: Wh40kPerspective }
  | {
      kind: 'turn-phase'
      phase: Wh40kPhaseId
      moment: Wh40kMoment
      perspective: Wh40kPerspective
      round?: number
    }
  | { kind: 'any-phase'; moments: Wh40kMoment[]; perspective: Wh40kPerspective }
  | { kind: 'always' }

export type Wh40kUsagePeriod = 'phase' | 'turn' | 'battle-round' | 'battle'

export interface Wh40kTiming {
  /** A rule usable in several windows ("your Shooting phase or the Fight phase") lists each. */
  windows: Wh40kGameWindow[]
  /** The event inside the window that triggers the rule, kept as printed text. */
  trigger?: string
  /** A printed "Once per ..." limit. */
  usage?: { limit: 1; period: Wh40kUsagePeriod }
  raw: string
}

const MOMENT_ORDER: Record<Wh40kMoment, number> = { start: 0, during: 1, end: 2 }

/** Sort key placing a window in game order; lower keys come earlier in a turn. */
export const windowOrder = (window: Wh40kGameWindow): number => {
  switch (window.kind) {
    case 'pre-battle':
      return -10
    case 'battle':
      return window.moment === 'start' ? 0 : 900
    case 'battle-round':
      return window.moment === 'start' ? 10 : 800
    case 'turn-step':
      return window.step === 'start-of-turn' ? 20 : 700
    case 'turn-phase': {
      const phase = WH40K_TURN_PHASES.find(item => item.id === window.phase)?.order ?? 0
      return 100 * phase + MOMENT_ORDER[window.moment]
    }
    case 'any-phase':
      return 600
    case 'always':
      return 1000
  }
}
