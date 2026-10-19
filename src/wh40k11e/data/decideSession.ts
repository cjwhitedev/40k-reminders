import { readFile, writeFile } from 'node:fs/promises'
import { format, resolveConfig } from 'prettier'
import type { SourceRecordId } from '../../aos4/domain'
import { normalizeSourceText } from '../../aos4/normalize/text'
import { WH40K_SOURCE_TEXT_OPTIONS } from '../normalize/sourceText'
import {
  addWh40kDecision,
  decisionOfWh40kEntry,
  defaultWh40kReason,
  describeWh40kDecision,
  describeWh40kWindow,
  findWh40kDecisionEntry,
  hintWh40kPhase,
  parseWh40kWindowsInput,
  sameWh40kWording,
  stampWh40kDecisions,
  suggestWh40kDecision,
  WH40K_IGNORE_GROUPS,
  type Wh40kDecision,
  type Wh40kDecisionCandidate,
  type Wh40kDecisionSuggestion,
} from './decisions'
import type { Wh40kPipelineResult } from './pipeline'
import type { Wh40kSourceReview } from './review'
import { buildWh40kRules } from './rules'
import type { Wh40kWahapediaRecord } from './wahapedia/decode'

export interface Wh40kPromptIo {
  ask: (question: string) => Promise<string>
  print: (text: string) => void
}

export const readWh40kReview = async (reviewPath: string): Promise<Wh40kSourceReview> =>
  JSON.parse(await readFile(reviewPath, 'utf8')) as Wh40kSourceReview

/** Writes the review file formatted the way the pre-commit hook would leave it. */
export const saveWh40kReview = async (reviewPath: string, review: Wh40kSourceReview): Promise<void> => {
  const options = (await resolveConfig(reviewPath)) ?? {}
  // Indented input: Prettier keeps an object expanded when its source was.
  await writeFile(
    reviewPath,
    await format(JSON.stringify(review, null, 2), { ...options, filepath: reviewPath }),
    'utf8'
  )
}

const FILE_LABELS: Record<string, string> = {
  'Stratagems.csv': 'Stratagem',
  'Abilities.csv': 'Ability',
  'Detachment_abilities.csv': 'Detachment rule',
  'Enhancements.csv': 'Enhancement',
  'Datasheets_abilities.csv': 'Datasheet ability',
}

/** Everything the prompts need about the current sources, built once per pipeline run. */
export const buildWh40kDecisionContext = (
  result: Wh40kPipelineResult,
  previousText: ReadonlyMap<string, string> = new Map()
) => {
  const { decoded, linked, reviewed, review } = result
  const records = new Map<string, Wh40kWahapediaRecord>(
    Object.values(decoded.records).flatMap(list =>
      list.map(record => [record.sourceRecordId, record] as const)
    )
  )
  const factions = new Map(
    (decoded.records['Factions.csv'] ?? []).map(record => [record.values.id, record.values.name])
  )
  const detachments = new Map(
    (decoded.records['Detachments.csv'] ?? []).map(record => [record.values.id, record.values.name])
  )
  const datasheets = new Map(linked.datasheets.map(sheet => [sheet.record.values.id, sheet.record.values]))

  const describe = (
    sourceRecordId: string,
    why: Wh40kDecisionCandidate['why']
  ): Wh40kDecisionCandidate | undefined => {
    const record = records.get(sourceRecordId)
    if (!record) return undefined
    const values = record.values
    const sheet = values.datasheet_id ? datasheets.get(values.datasheet_id) : undefined
    const factionId = values.faction_id || sheet?.faction_id
    const where = [
      factionId ? (factions.get(factionId) ?? factionId) : 'All armies',
      values.detachment_id ? detachments.get(values.detachment_id) : undefined,
      sheet?.name,
    ]
      .filter(Boolean)
      .join(' › ')
    const decided = findWh40kDecisionEntry(review, record.sourceRecordId)
    const current = decided
      ? {
          ownerId: decided.entry.id,
          summary: describeWh40kDecision(decisionOfWh40kEntry(decided.entry, decided.section)),
          ...(previousText.has(sourceRecordId) ? { text: previousText.get(sourceRecordId) } : {}),
        }
      : undefined
    return {
      sourceRecordId: record.sourceRecordId,
      recordChecksum: record.recordChecksum,
      name: values.name || sheet?.name || record.sourceRecordId,
      label: FILE_LABELS[record.file] ?? record.file,
      where,
      text: normalizeSourceText(values.description ?? '', WH40K_SOURCE_TEXT_OPTIONS).text,
      why,
      ...(current ? { current } : {}),
    }
  }

  const { rules } = buildWh40kRules(decoded.records, linked, reviewed)
  const changedIds = new Set(
    reviewed.decisionChecks.filter(check => check.status === 'changed').map(check => check.sourceRecordId)
  )
  const pending = [
    ...Array.from(changedIds).map(id => describe(id, 'changed')),
    ...rules
      .filter(rule => rule.gameMode === 'matched-play' && rule.timingKind === 'unclassified')
      .filter(rule => !changedIds.has(rule.sourceRecordId))
      .map(rule => describe(rule.sourceRecordId, 'unresolved')),
  ].filter((candidate): candidate is Wh40kDecisionCandidate => Boolean(candidate))

  const earlierByName = new Map<string, { ownerId: string; decision: Wh40kDecision }>()
  const pendingIds = new Set(pending.map(candidate => candidate.sourceRecordId))
  for (const [section, entries] of [
    ['timingOverrides', review.timingOverrides ?? []],
    ['ignoredRules', review.ignoredRules ?? []],
  ] as const) {
    for (const entry of entries) {
      for (const id of entry.sourceRecordIds) {
        const name = records.get(id)?.values.name?.trim().toLowerCase()
        if (!name || pendingIds.has(id) || earlierByName.has(name)) continue
        earlierByName.set(name, { ownerId: entry.id, decision: decisionOfWh40kEntry(entry, section) })
      }
    }
  }

  const checksums = new Map(Array.from(records, ([id, record]) => [id, record.recordChecksum]))
  const names = new Map(
    Array.from(records, ([id, record]) => [id, record.values.name ?? ''] as const).filter(([, name]) => name)
  )
  /** Rule records named by source record ID or by rule name (any case). */
  const matching = (wanted: string[]): Wh40kDecisionCandidate[] => {
    const keys = new Set(wanted.map(value => value.trim().toLowerCase()))
    return Array.from(records.values())
      .filter(record => FILE_LABELS[record.file] && record.values.description)
      .filter(
        record =>
          keys.has(record.sourceRecordId.toLowerCase()) ||
          keys.has((record.values.name ?? '').trim().toLowerCase())
      )
      .map(record => describe(record.sourceRecordId, 'requested'))
      .filter((candidate): candidate is Wh40kDecisionCandidate => Boolean(candidate))
  }
  return { pending, earlierByName, checksums, names, describe, matching }
}

/** The timings most rules use, offered by number when a rule is marked timed: a label, and the phrase it parses as. */
const COMMON_TIMINGS = [
  ['Start of Your Command Phase', 'start of your Command phase'],
  ['Your Command Phase', 'your Command phase'],
  ['Your Movement Phase', 'your Movement phase'],
  ["Opponent's Movement Phase", "your opponent's Movement phase"],
  ['Your Shooting Phase', 'your Shooting phase'],
  ["Opponent's Shooting Phase", "your opponent's Shooting phase"],
  ['Your Charge Phase', 'your Charge phase'],
  ["Opponent's Charge Phase", "your opponent's Charge phase"],
  ['Fight Phase (either player)', 'the Fight phase'],
  ['Your Shooting Phase or Fight Phase', 'your Shooting phase or the Fight phase'],
  ['End of Any Phase', 'end of any phase'],
  ['Start of the Battle Round', 'start of the battle round'],
  ['Before the Battle (Declare Battle Formations)', 'before the battle: Declare Battle Formations step'],
] as const

const wrap = (text: string, indent = '    ', width = Math.min(process.stdout.columns || 100, 110)): string =>
  text
    .split('\n')
    .map(line => {
      const words = line.split(' ')
      const out: string[] = []
      let current = ''
      for (const word of words) {
        if (current && (indent + current + ' ' + word).length > width) {
          out.push(indent + current)
          current = word
        } else current = current ? `${current} ${word}` : word
      }
      out.push(indent + current)
      return out.join('\n')
    })
    .join('\n')

export interface Wh40kDecisionSessionResult {
  review: Wh40kSourceReview
  decided: number
  skipped: SourceRecordId[]
  quit: boolean
}

/**
 * Walks through each pending rule in the terminal and saves the review file after every answer,
 * so quitting part way loses nothing.
 */
export const runWh40kDecisionSession = async (input: {
  reviewPath: string
  review: Wh40kSourceReview
  candidates: Wh40kDecisionCandidate[]
  earlierByName: ReadonlyMap<string, { ownerId: string; decision: Wh40kDecision }>
  date: string
  io: Wh40kPromptIo
  save?: (reviewPath: string, review: Wh40kSourceReview) => Promise<void>
}): Promise<Wh40kDecisionSessionResult> => {
  const { io, candidates, date } = input
  const save = input.save ?? saveWh40kReview
  let review = input.review
  let decided = 0
  const skipped: SourceRecordId[] = []

  const askDecision = async (
    candidate: Wh40kDecisionCandidate,
    choice: string
  ): Promise<Wh40kDecision | undefined> => {
    const reason = async (fallback: string) => (await io.ask(`  Reason [${fallback}]: `)).trim() || fallback
    if (choice === 't') {
      const suggested = suggestWh40kDecision(candidate, new Map())
      const hint = hintWh40kPhase(candidate.text)
      const fallback =
        suggested.decision.kind === 'timed'
          ? { windows: suggested.decision.windows, because: suggested.because }
          : hint
            ? { windows: [hint.window], because: hint.because }
            : { windows: parseWh40kWindowsInput(COMMON_TIMINGS[0][1]) ?? [], because: 'the first choice' }
      const fallbackText = fallback.windows.map(describeWh40kWindow).join(' or ')
      io.print('  When?')
      COMMON_TIMINGS.forEach(([label], index) => io.print(`    ${String(index + 1).padStart(2)}) ${label}`))
      for (;;) {
        const typed = (
          await io.ask(
            `  Number, or type a timing like a WHEN: line ('end of your opponent's Charge phase'), b to go back\n  [Enter] ${fallbackText} (${fallback.because}) > `
          )
        ).trim()
        if (typed.toLowerCase() === 'b') return undefined
        const listed = /^\d+$/.test(typed) ? COMMON_TIMINGS[Number(typed) - 1]?.[1] : undefined
        const windows = !typed ? fallback.windows : parseWh40kWindowsInput(listed ?? typed)
        if (!windows?.length) {
          io.print('  Could not read that; pick a number or use the wording a WHEN: line would use.')
          continue
        }
        if (typed && !listed) {
          const answer = await io.ask(`  → ${windows.map(describeWh40kWindow).join(' or ')}. Right? [Y/n] `)
          if (answer.trim().toLowerCase().startsWith('n')) continue
        }
        return { kind: 'timed', windows, reason: await reason(defaultWh40kReason(candidate.text)) }
      }
    }
    if (choice === 'r') {
      const fallback = candidate.text.replace(/^•\s*/, '').split(/,\s/)[0].replace(/\.$/, '')
      const trigger = (await io.ask(`  What triggers it? [${fallback}]: `)).trim() || fallback
      return { kind: 'reaction', trigger, reason: await reason(defaultWh40kReason(candidate.text)) }
    }
    if (choice === 'p') return { kind: 'passive', reason: await reason(defaultWh40kReason(candidate.text)) }
    if (choice === 'n') {
      const suggested = suggestWh40kDecision(candidate, new Map()).decision
      const fallback =
        suggested.kind === 'ignore'
          ? Math.max(1, WH40K_IGNORE_GROUPS.findIndex(group => group.key === suggested.groupId) + 1)
          : 1
      WH40K_IGNORE_GROUPS.forEach((group, index) => io.print(`    ${index + 1}) ${group.label}`))
      io.print(`    ${WH40K_IGNORE_GROUPS.length + 1}) Something else`)
      const picked = Number((await io.ask(`  Which? [${fallback}] `)).trim() || fallback)
      const group = WH40K_IGNORE_GROUPS[picked - 1]
      if (group) return { kind: 'ignore', groupId: group.key, reason: group.reason }
      if (picked !== WH40K_IGNORE_GROUPS.length + 1) return undefined
      const why = (await io.ask('  Why is it not a reminder? ')).trim()
      return why ? { kind: 'ignore', groupId: `not-a-reminder-${date}`, reason: why } : undefined
    }
    return undefined
  }

  // Identical copies of a rule (same name, wording and current decision) share one prompt.
  const groups: Wh40kDecisionCandidate[][] = []
  for (const candidate of candidates) {
    const group = groups.find(
      ([head]) =>
        head.current?.summary === candidate.current?.summary &&
        head.name.trim().toLowerCase() === candidate.name.trim().toLowerCase() &&
        sameWh40kWording(head.text, candidate.text)
    )
    if (group) group.push(candidate)
    else groups.push([candidate])
  }

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]
    const [candidate, ...copies] = group
    const suggestion =
      candidate.why === 'unresolved'
        ? suggestWh40kDecision(candidate, input.earlierByName)
        : candidate.why === 'changed'
          ? retimed(candidate)
          : undefined
    const heading =
      candidate.why === 'changed'
        ? 'its text changed since it was decided'
        : candidate.why === 'requested'
          ? 'decide again'
          : 'needs a timing'
    io.print(`\n── ${index + 1} of ${groups.length} · ${heading} ──`)
    io.print(`${candidate.label} · ${candidate.where}`)
    io.print(`${candidate.name.toUpperCase()}   (${candidate.sourceRecordId})`)
    io.print(wrap(candidate.text || '(no text)'))
    if (candidate.current) {
      io.print(`  Decided as: ${candidate.current.summary} [${candidate.current.ownerId}]`)
      if (candidate.current.text && candidate.current.text !== candidate.text) {
        io.print('  Text it was decided against:')
        io.print(wrap(candidate.current.text, '      '))
      }
    }
    if (suggestion)
      io.print(`  Suggested: ${describeWh40kDecision(suggestion.decision)}, because ${suggestion.because}`)
    if (copies.length)
      io.print(`  Your answer also covers the same rule on: ${copies.map(other => other.where).join('; ')}`)

    const keepable = Boolean(candidate.current)
    const options = [
      suggestion
        ? `[Enter] ${describeWh40kDecision(suggestion.decision)}`
        : keepable
          ? `[Enter] keep (${candidate.current?.summary})`
          : '',
      keepable && suggestion ? 'k keep' : '',
      't timed',
      'r reaction',
      'p always active',
      'n not a reminder',
      's skip',
      'q save and quit',
    ].filter(Boolean)

    for (;;) {
      const choice = (await io.ask(`  ${options.join(' · ')}\n  > `)).trim().toLowerCase()
      if (choice === 'q') return { review, decided, skipped, quit: true }
      if (choice === 's') {
        skipped.push(...group.map(item => item.sourceRecordId))
        break
      }
      if ((choice === '' && !suggestion && keepable) || (choice === 'k' && keepable)) {
        review = stampWh40kDecisions(
          review,
          new Map(group.map(item => [item.sourceRecordId, item.recordChecksum])),
          {
            onlyMissing: false,
            sourceRecordIds: new Set(group.map(item => item.sourceRecordId)),
          }
        ).review
        await save(input.reviewPath, review)
        decided += group.length
        io.print('  Kept.')
        break
      }
      const decision =
        choice === '' && suggestion ? suggestion.decision : await askDecision(candidate, choice)
      if (!decision) continue
      review = addWh40kDecision(review, group, decision, date)
      await save(input.reviewPath, review)
      decided += group.length
      io.print(`  Saved: ${describeWh40kDecision(decision)}`)
      break
    }
  }
  return { review, decided, skipped, quit: false }
}

/**
 * For a reworded rule: dropping it when it lost its text, or a new timing when its new wording names
 * a time its decision does not; otherwise nothing, so Enter keeps the decision.
 */
const retimed = (candidate: Wh40kDecisionCandidate): Wh40kDecisionSuggestion | undefined => {
  if (!candidate.text.trim()) {
    const empty = suggestWh40kDecision(candidate, new Map())
    return { decision: empty.decision, because: `${empty.because} any more` }
  }
  if (!candidate.current?.text) return undefined
  const fresh = suggestWh40kDecision(candidate, new Map())
  if (fresh.decision.kind !== 'timed' || describeWh40kDecision(fresh.decision) === candidate.current.summary)
    return undefined
  return { decision: fresh.decision, because: `its new wording names a time: ${fresh.because}` }
}
