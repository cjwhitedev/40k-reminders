import { createHash } from 'node:crypto'
import { artifactId, sourceRecordId, type ArtifactId, type SourceRecordId } from '../../../aos4/domain'
import { parsePipeDelimited, type DelimitedRow } from '../../../aos4/data/wahapedia/delimited'

export const WH40K_WAHAPEDIA_PROVIDER = 'wahapedia-wh40k11e' as const

export const WH40K_WAHAPEDIA_EXPORTS = {
  'Abilities.csv': {
    headers: ['id', 'name', 'legend', 'faction_id', 'description'],
    key: ['id', 'faction_id'],
    // Universal core abilities (Deep Strike, Stealth, ...) belong to no faction.
    optional: ['faction_id'],
  },
  'Datasheets.csv': {
    headers: [
      'id',
      'name',
      'faction_id',
      'source_id',
      'legend',
      'role',
      'loadout',
      'transport',
      'virtual',
      'is_support',
      'leader_head',
      'leader_footer',
      'damaged_w',
      'damaged_description',
      'link',
    ],
    key: ['id'],
  },
  'Datasheets_abilities.csv': {
    headers: ['datasheet_id', 'line', 'ability_id', 'model', 'name', 'description', 'type', 'parameter'],
    key: ['datasheet_id', 'line'],
  },
  'Datasheets_detachment_abilities.csv': {
    headers: ['datasheet_id', 'detachment_ability_id'],
    key: ['datasheet_id', 'detachment_ability_id'],
  },
  'Datasheets_enhancements.csv': {
    headers: ['datasheet_id', 'enhancement_id'],
    key: ['datasheet_id', 'enhancement_id'],
  },
  'Datasheets_keywords.csv': {
    headers: ['datasheet_id', 'keyword', 'model', 'is_faction_keyword'],
    key: ['datasheet_id', 'keyword', 'model'],
    optional: ['model'],
  },
  'Datasheets_leader.csv': { headers: ['leader_id', 'attached_id'], key: ['leader_id', 'attached_id'] },
  'Datasheets_models.csv': {
    headers: [
      'datasheet_id',
      'line',
      'name',
      'M',
      'T',
      'Sv',
      'inv_sv',
      'inv_sv_descr',
      'W',
      'Ld',
      'OC',
      'base_size',
      'base_size_descr',
    ],
    key: ['datasheet_id', 'line'],
  },
  'Datasheets_models_cost.csv': {
    headers: ['datasheet_id', 'line', 'description', 'cost'],
    key: ['datasheet_id', 'line'],
  },
  'Datasheets_options.csv': {
    headers: ['datasheet_id', 'line', 'button', 'description'],
    key: ['datasheet_id', 'line'],
  },
  'Datasheets_stratagems.csv': {
    headers: ['datasheet_id', 'stratagem_id'],
    key: ['datasheet_id', 'stratagem_id'],
  },
  'Datasheets_unit_composition.csv': {
    headers: ['datasheet_id', 'line', 'description'],
    key: ['datasheet_id', 'line'],
  },
  'Datasheets_wargear.csv': {
    headers: [
      'datasheet_id',
      'line',
      'line_in_wargear',
      'dice',
      'name',
      'description',
      'range',
      'type',
      'A',
      'BS_WS',
      'S',
      'AP',
      'D',
    ],
    // `line` is blank on about a fifth of rows, so the profile name and type complete the key.
    key: ['datasheet_id', 'line', 'line_in_wargear', 'name', 'type'],
    optional: ['line', 'line_in_wargear'],
  },
  'Detachment_abilities.csv': {
    headers: ['id', 'faction_id', 'name', 'legend', 'description', 'detachment', 'detachment_id'],
    key: ['id'],
  },
  'Detachments.csv': {
    headers: ['id', 'faction_id', 'name', 'legend', 'type', 'dp', 'force_disposition'],
    key: ['id'],
  },
  'Detachments_chapter_dp.csv': {
    headers: ['detachment_id', 'keyword', 'dp'],
    key: ['detachment_id', 'keyword'],
  },
  'Enhancements.csv': {
    headers: [
      'faction_id',
      'name',
      'id',
      'cost',
      'detachment',
      'detachment_id',
      'upgrade',
      'legend',
      'description',
      'support_leader',
    ],
    key: ['id'],
  },
  'Factions.csv': { headers: ['id', 'name', 'link'], key: ['id'] },
  'Last_update.csv': { headers: ['last_update'], key: ['last_update'] },
  'Source.csv': {
    headers: ['id', 'name', 'type', 'edition', 'version', 'errata_date', 'errata_link'],
    key: ['id'],
  },
  'Stratagems.csv': {
    headers: [
      'faction_id',
      'name',
      'id',
      'type',
      'cp_cost',
      'legend',
      'turn',
      'phase',
      'detachment',
      'detachment_id',
      'description',
    ],
    key: ['id'],
  },
} as const satisfies Record<
  string,
  { headers: readonly string[]; key: readonly string[]; optional?: readonly string[] }
>

export type Wh40kWahapediaExportFile = keyof typeof WH40K_WAHAPEDIA_EXPORTS

export const WH40K_WAHAPEDIA_EXPORT_FILES = Object.keys(
  WH40K_WAHAPEDIA_EXPORTS
).sort() as Wh40kWahapediaExportFile[]

export interface Wh40kWahapediaRecord {
  file: Wh40kWahapediaExportFile
  /** First physical line of the record; later lines belong to it when a field held a raw line break. */
  line: number
  values: Record<string, string>
  artifactId: ArtifactId
  sourceRecordId: SourceRecordId
  recordChecksum: string
}

export type Wh40kWahapediaDiagnosticCode =
  | 'missing-export'
  | 'invalid-utf8'
  | 'delimited-syntax'
  | 'header-drift'
  | 'row-column-count'
  | 'missing-key-field'
  | 'duplicate-identical-record'
  | 'duplicate-record-key'
  | 'empty-placeholder-record'

export interface Wh40kWahapediaDiagnostic {
  code: Wh40kWahapediaDiagnosticCode
  severity: 'error' | 'warning'
  file: Wh40kWahapediaExportFile
  line?: number
  message: string
}

export interface Wh40kWahapediaDecodeResult {
  status: 'blocked' | 'candidate-review-required'
  records: Record<Wh40kWahapediaExportFile, Wh40kWahapediaRecord[]>
  diagnostics: Wh40kWahapediaDiagnostic[]
}

export type Wh40kWahapediaExportInputs = Partial<
  Record<Wh40kWahapediaExportFile, { bytes: Uint8Array; checksum: string }>
>

// Every published row ends with `|`; a row without it continues on the next physical line.
const joinContinuedRows = (rows: DelimitedRow[]): DelimitedRow[] =>
  rows.reduce<DelimitedRow[]>((logical, row) => {
    const previous = logical.at(-1)
    if (previous && !previous.raw.endsWith('|')) {
      previous.values = [
        ...previous.values.slice(0, -1),
        `${previous.values.at(-1)}\n${row.values[0]}`,
        ...row.values.slice(1),
      ]
      previous.raw = `${previous.raw}${previous.lineEnding}${row.raw}`
      previous.lineEnding = row.lineEnding
    } else {
      logical.push({ ...row, values: [...row.values] })
    }
    return logical
  }, [])

const decodeFile = (
  file: Wh40kWahapediaExportFile,
  input: { bytes: Uint8Array; checksum: string },
  diagnostics: Wh40kWahapediaDiagnostic[]
): Wh40kWahapediaRecord[] => {
  const definition = WH40K_WAHAPEDIA_EXPORTS[file]
  const { headers, key } = definition
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes)
  } catch {
    diagnostics.push({ code: 'invalid-utf8', severity: 'error', file, message: `${file} is not valid UTF-8` })
    return []
  }

  const parsed = parsePipeDelimited(source)
  parsed.diagnostics.forEach(diagnostic =>
    diagnostics.push({
      code: 'delimited-syntax',
      severity: 'error',
      file,
      line: diagnostic.line,
      message: `${file} line ${diagnostic.line}: ${diagnostic.message}`,
    })
  )

  const [header, ...body] = parsed.rows
  if (
    !header ||
    header.values.length !== headers.length ||
    header.values.some((value, index) => value !== headers[index])
  ) {
    diagnostics.push({
      code: 'header-drift',
      severity: 'error',
      file,
      line: header?.line,
      message: `${file} headers ${JSON.stringify(header?.values ?? [])} do not match ${JSON.stringify(headers)}`,
    })
    return []
  }

  const records: Wh40kWahapediaRecord[] = []
  const seen = new Map<string, string>()
  for (const row of joinContinuedRows(body)) {
    if (row.values.length !== headers.length) {
      diagnostics.push({
        code: 'row-column-count',
        severity: 'error',
        file,
        line: row.line,
        message: `${file} line ${row.line} has ${row.values.length} columns; expected ${headers.length}`,
      })
      continue
    }
    const values = Object.fromEntries(headers.map((name, index) => [name, row.values[index]]))

    const placeholder =
      (file === 'Datasheets_wargear.csv' && !values.name && !values.description && !values.type) ||
      (file === 'Datasheets_keywords.csv' && !values.keyword && !values.model)
    if (placeholder) {
      diagnostics.push({
        code: 'empty-placeholder-record',
        severity: 'warning',
        file,
        line: row.line,
        message: `${file} line ${row.line} is an empty placeholder and was ignored`,
      })
      continue
    }

    const optional: readonly string[] = 'optional' in definition ? definition.optional : []
    const missing = key.filter(field => !optional.includes(field) && !values[field])
    if (missing.length) {
      diagnostics.push({
        code: 'missing-key-field',
        severity: 'error',
        file,
        line: row.line,
        message: `${file} line ${row.line} is missing key field(s) ${missing.join(', ')}`,
      })
      continue
    }

    const recordKey = key.map(field => values[field]).join(':')
    const previous = seen.get(recordKey)
    if (previous !== undefined) {
      const identical = previous === row.raw
      diagnostics.push({
        code: identical ? 'duplicate-identical-record' : 'duplicate-record-key',
        severity: identical ? 'warning' : 'error',
        file,
        line: row.line,
        message: identical
          ? `${file} line ${row.line} repeats record ${recordKey}`
          : `${file} line ${row.line} conflicts with an earlier record for key ${recordKey}`,
      })
      continue
    }
    seen.set(recordKey, row.raw)

    records.push({
      file,
      line: row.line,
      values,
      artifactId: artifactId(input.checksum),
      sourceRecordId: sourceRecordId(WH40K_WAHAPEDIA_PROVIDER, `${file}:${recordKey}`),
      recordChecksum: createHash('sha256').update(row.raw, 'utf8').digest('hex'),
    })
  }
  return records
}

export const decodeWh40kWahapediaExports = (
  inputs: Wh40kWahapediaExportInputs
): Wh40kWahapediaDecodeResult => {
  const diagnostics: Wh40kWahapediaDiagnostic[] = []
  const records = {} as Record<Wh40kWahapediaExportFile, Wh40kWahapediaRecord[]>
  for (const file of WH40K_WAHAPEDIA_EXPORT_FILES) {
    const input = inputs[file]
    if (!input) {
      diagnostics.push({
        code: 'missing-export',
        severity: 'error',
        file,
        message: `${file} was not supplied`,
      })
      records[file] = []
      continue
    }
    records[file] = decodeFile(file, input, diagnostics)
  }
  diagnostics.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      left.code.localeCompare(right.code)
  )
  return {
    status: diagnostics.some(diagnostic => diagnostic.severity === 'error')
      ? 'blocked'
      : 'candidate-review-required',
    records,
    diagnostics,
  }
}
