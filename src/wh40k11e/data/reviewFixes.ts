import type { SourceRecordId } from '../../aos4/domain'
import type { Wh40kPipelineResult } from './pipeline'
import type {
  Wh40kLinkDisposition,
  Wh40kOfficialEvidence,
  Wh40kReviewContext,
  Wh40kReviewFinding,
  Wh40kSourceReview,
} from './review'
import type { Wh40kLinkDiagnostic } from './wahapedia/link'
import { compareCodeUnits } from './wahapedia/decode'

/**
 * A review finding the update command can settle by asking one question. The first choice is the
 * Enter default; a choice without `apply` leaves the review alone (the finding then needs a hand edit).
 */
export interface Wh40kReviewFix {
  lines: string[]
  question: string
  choices: Array<{ key: string; label: string; apply?: (review: Wh40kSourceReview) => Wh40kSourceReview }>
}

export interface Wh40kReviewFixInput {
  review: Wh40kSourceReview
  findings: Wh40kReviewFinding[]
  linkErrors: Wh40kLinkDiagnostic[]
  decoderWarnings: Array<{ code: string; message: string }>
  datasheets: Array<{ sourceRecordId: SourceRecordId; name: string; classification: string }>
  date: string
}

export const wh40kReviewFixInputOf = (result: Wh40kPipelineResult, date: string): Wh40kReviewFixInput => ({
  review: result.review,
  findings: result.reviewed.findings,
  linkErrors: result.linked.diagnostics.filter(item => item.severity === 'error'),
  decoderWarnings: result.decoded.diagnostics.filter(item => item.severity === 'warning'),
  datasheets: result.linked.datasheets.map(sheet => ({
    sourceRecordId: sheet.record.sourceRecordId,
    name: sheet.record.values.name,
    classification: sheet.classification,
  })),
  date,
})

const SAMPLE = 8
const sample = (items: string[]): string[] =>
  items.length > SAMPLE ? [...items.slice(0, SAMPLE), `...and ${items.length - SAMPLE} more`] : items
const yesNo = (
  apply: (review: Wh40kSourceReview) => Wh40kSourceReview,
  yes = 'yes',
  no = 'no, I will edit the file'
) => [
  { key: 'y', label: yes, apply },
  { key: 'n', label: no },
]
const messagesOf = (input: Wh40kReviewFixInput, code: Wh40kReviewFinding['code']) =>
  input.findings.filter(item => item.code === code).map(item => item.message)

const covers = (disposition: Wh40kLinkDisposition, diagnostic: Wh40kLinkDiagnostic): boolean =>
  disposition.match.code === diagnostic.code &&
  disposition.match.field === diagnostic.field &&
  (!disposition.match.values || disposition.match.values.includes(diagnostic.value)) &&
  (!disposition.match.sourceRecordIds ||
    disposition.match.sourceRecordIds.includes(diagnostic.sourceRecordId))

/** New rows pointing at records Wahapedia does not publish: leave them out, one exclusion per field. */
const uncoveredLinks = (input: Wh40kReviewFixInput): Wh40kReviewFix | undefined => {
  const uncovered = input.linkErrors.filter(
    diagnostic => !input.review.linkDispositions.some(disposition => covers(disposition, diagnostic))
  )
  if (!uncovered.length) return undefined
  const groups = new Map<string, Wh40kLinkDiagnostic[]>()
  for (const diagnostic of uncovered) {
    const key = `${diagnostic.code}|${diagnostic.field}`
    groups.set(key, [...(groups.get(key) ?? []), diagnostic])
  }
  const taken = new Set(input.review.linkDispositions.map(item => item.id))
  const added = Array.from(groups.values()).map((diagnostics): Wh40kLinkDisposition => {
    const { code, field } = diagnostics[0]
    let id = `${code}-${field.replace(/_/g, '-')}-${input.date}`
    for (let suffix = 2; taken.has(id); suffix += 1)
      id = `${code}-${field.replace(/_/g, '-')}-${input.date}-${suffix}`
    taken.add(id)
    return {
      id,
      match: {
        code,
        field,
        sourceRecordIds: Array.from(new Set(diagnostics.map(item => item.sourceRecordId))).sort(
          compareCodeUnits
        ),
      },
      expectedCount: diagnostics.length,
      action: 'exclude-records',
      reason: `Rows whose ${field} points at a record Wahapedia does not publish (${code}), first seen in the ${input.date} refresh. Left out until Wahapedia links them.`,
    }
  })
  return {
    lines: [
      `${uncovered.length} row(s) point at records Wahapedia does not publish, so they cannot be placed:`,
      ...sample(uncovered.map(item => `  ${item.message}`)),
    ],
    question: 'Leave those rows out?',
    choices: yesNo(review => ({ ...review, linkDispositions: [...review.linkDispositions, ...added] })),
  }
}

/** Decoder warnings of a new kind: the decoder already skipped what they describe. */
const decoderWarnings = (input: Wh40kReviewFixInput): Wh40kReviewFix | undefined => {
  const codes = messagesOf(input, 'undispositioned-decoder-warning').map(
    message => message.split(' ').pop() as string
  )
  if (!codes.length) return undefined
  const examples = codes.map(code => input.decoderWarnings.find(item => item.code === code)?.message ?? code)
  return {
    lines: [
      'The decoder reports new kinds of warning (it skipped the rows they describe):',
      ...sample(examples.map(text => `  ${text}`)),
    ],
    question: 'Accept them?',
    choices: yesNo(review => ({
      ...review,
      decoderDiagnosticPolicies: [
        ...review.decoderDiagnosticPolicies,
        ...codes.map((code, index) => ({
          code,
          reason: `First seen in the ${input.date} refresh: ${examples[index]}`,
        })),
      ],
    })),
  }
}

/** Datasheets from a kind of source no policy places yet, such as a new edition. */
const classifications = (input: Wh40kReviewFixInput): Wh40kReviewFix[] =>
  messagesOf(input, 'missing-classification-policy').map(message => {
    const classification = message.match(/covers (\S+) datasheets/)?.[1] ?? ''
    const sheets = input.datasheets.filter(sheet => sheet.classification === classification)
    const place = (context: Wh40kReviewContext, why: string) => (review: Wh40kSourceReview) => ({
      ...review,
      classificationPolicies: [
        ...review.classificationPolicies,
        {
          classification: classification as never,
          context,
          reason: `${why} (decided in the ${input.date} refresh).`,
        },
      ],
    })
    return {
      lines: [
        `${sheets.length} datasheet(s) cite a source Wahapedia files as "${classification}":`,
        ...sample(sheets.map(sheet => `  ${sheet.name}`)),
      ],
      question: 'Where do they belong?',
      choices: [
        {
          key: 'x',
          label: 'leave them out',
          apply: place('excluded', 'Not shown until their source is clear'),
        },
        { key: 'c', label: 'current rules', apply: place('current', 'Shown with the current rules') },
        { key: 'l', label: 'Legends', apply: place('legends', 'Shown only when Legends are allowed') },
      ],
    }
  })

/** The same rule decided twice: keep one decision. */
const duplicates = (input: Wh40kReviewFixInput): Wh40kReviewFix[] =>
  messagesOf(input, 'duplicate-rule-decision').map(message => {
    const [, id, earlier, later] = message.match(/^(\S+) is decided by (\S+) and (\S+)$/) ?? []
    const without = (ownerId: string) => (review: Wh40kSourceReview) =>
      removeFromEntry(review, ownerId, id as SourceRecordId)
    return {
      lines: [`One rule is decided twice, by "${earlier}" and "${later}": ${id}`],
      question: 'Which decision stays?',
      choices: [
        { key: 'l', label: `"${later}"`, apply: without(earlier) },
        { key: 'e', label: `"${earlier}"`, apply: without(later) },
      ],
    }
  })

/** Quotes from official PDFs that moved or went: the decision stays, resting on Wahapedia's text. */
const evidence = (input: Wh40kReviewFixInput): Wh40kReviewFix | undefined => {
  const missing = [
    ...messagesOf(input, 'evidence-not-found').map(message =>
      message.match(/^(\S+) quote is not on page (\d+) of (\S+)$/)
    ),
    ...messagesOf(input, 'evidence-document-not-pinned').map(message =>
      message.match(/^(\S+) cites unpinned document (\S+)$/)
    ),
  ]
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map(match => ({
      ownerId: match[1],
      page: match.length === 4 ? Number(match[2]) : undefined,
      url: match[match.length - 1],
    }))
  if (!missing.length) return undefined
  const stale = (ownerId: string, item: Wh40kOfficialEvidence) =>
    missing.some(
      gone =>
        gone.ownerId === ownerId &&
        gone.url === item.url &&
        (gone.page === undefined || gone.page === item.page)
    )
  const prune = <T extends { id: string; officialEvidence?: Wh40kOfficialEvidence[] }>(entry: T): T => {
    if (!entry.officialEvidence) return entry
    const kept = entry.officialEvidence.filter(item => !stale(entry.id, item))
    const pruned = { ...entry }
    if (kept.length) pruned.officialEvidence = kept
    else delete pruned.officialEvidence
    return pruned
  }
  return {
    lines: [
      'These decisions quote an official PDF that no longer has that text (the PDF was updated or dropped):',
      ...sample(Array.from(new Set(missing.map(item => `  ${item.ownerId}`)))),
    ],
    question: 'Drop the quotes and keep the decisions?',
    choices: yesNo(review => ({
      ...review,
      linkDispositions: review.linkDispositions.map(prune),
      timingOverrides: review.timingOverrides?.map(prune),
    })),
  }
}

/** A faction, or a sub-faction keyword such as a Chapter, that Wahapedia no longer prints. */
const goneFactions = (input: Wh40kReviewFixInput): Wh40kReviewFix | undefined => {
  const factions = messagesOf(input, 'invalid-army-faction-keywords')
    .map(message => message.match(/^Army Faction keywords name unknown faction (\S+)$/)?.[1])
    .filter((id): id is string => Boolean(id))
  const keywords = messagesOf(input, 'invalid-sub-faction-keywords')
    .map(message => message.match(/^No (\S+) datasheet carries the faction keyword (.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map(match => ({ factionId: match[1], keyword: match[2] }))
  if (!factions.length && !keywords.length) return undefined
  return {
    lines: [
      'Wahapedia no longer has:',
      ...factions.map(id => `  the faction ${id}`),
      ...keywords.map(item => `  any ${item.factionId} datasheet with the keyword ${item.keyword}`),
    ],
    question: 'Remove them from the review?',
    choices: yesNo(review => ({
      ...review,
      armyFactionKeywords: review.armyFactionKeywords?.filter(entry => !factions.includes(entry.factionId)),
      subFactionKeywords: review.subFactionKeywords
        ?.filter(entry => !factions.includes(entry.factionId))
        .map(entry => {
          const gone = new Set(
            keywords.filter(item => item.factionId === entry.factionId).map(item => item.keyword)
          )
          if (!gone.size) return entry
          return {
            ...entry,
            keywords: entry.keywords.filter(keyword => !gone.has(keyword)),
            ...(entry.armyRules
              ? {
                  armyRules: Object.fromEntries(
                    Object.entries(entry.armyRules).filter(([keyword]) => !gone.has(keyword))
                  ),
                }
              : {}),
          }
        }),
    })),
  }
}

const removeFromEntry = (
  review: Wh40kSourceReview,
  ownerId: string,
  sourceRecordId: SourceRecordId
): Wh40kSourceReview => {
  const strip = <
    T extends {
      id: string
      sourceRecordIds: SourceRecordId[]
      fingerprints?: Record<string, string>
      names?: Record<string, string>
    },
  >(
    entries: T[] | undefined
  ) =>
    entries
      ?.map(entry => {
        if (entry.id !== ownerId) return entry
        const drop = (record: Record<string, string> | undefined) =>
          record && Object.fromEntries(Object.entries(record).filter(([key]) => key !== sourceRecordId))
        return {
          ...entry,
          sourceRecordIds: entry.sourceRecordIds.filter(id => id !== sourceRecordId),
          ...(entry.fingerprints ? { fingerprints: drop(entry.fingerprints) } : {}),
          ...(entry.names ? { names: drop(entry.names) } : {}),
        }
      })
      .filter(entry => entry.sourceRecordIds.length > 0)
  return {
    ...review,
    timingOverrides: strip(review.timingOverrides),
    ignoredRules: strip(review.ignoredRules),
  }
}

/** Every question that settles a review finding, in the order the update command asks them. */
export const planWh40kReviewFixes = (input: Wh40kReviewFixInput): Wh40kReviewFix[] =>
  [
    uncoveredLinks(input),
    decoderWarnings(input),
    ...classifications(input),
    ...duplicates(input),
    evidence(input),
    goneFactions(input),
  ].filter((fix): fix is Wh40kReviewFix => Boolean(fix))
