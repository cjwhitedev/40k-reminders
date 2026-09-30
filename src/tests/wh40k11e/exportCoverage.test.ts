import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { wahapediaExportCoverage } from '../../wh40k11e/data/checkExportsCommand'

const specification = (targets: string[]): Uint8Array => {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet(targets.map(target => [target.split('/').pop()]))
  targets.forEach((target, row) => {
    sheet[XLSX.utils.encode_cell({ r: row, c: 0 })].l = { Target: target }
  })
  XLSX.utils.book_append_sheet(workbook, sheet, 'EN')
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))
}

describe('wahapediaExportCoverage', () => {
  it('reports exports the specification publishes but the candidate lacks, and the reverse', () => {
    const coverage = wahapediaExportCoverage(
      specification([
        'https://wahapedia.ru/wh40k11ed/Datasheets.csv',
        'https://wahapedia.ru/wh40k11ed/Factions.csv',
      ]),
      ['https://wahapedia.ru/wh40k11ed/Factions.csv', 'https://wahapedia.ru/wh40k11ed/Guessed.csv']
    )

    expect(coverage).toEqual({
      published: [
        'https://wahapedia.ru/wh40k11ed/Datasheets.csv',
        'https://wahapedia.ru/wh40k11ed/Factions.csv',
      ],
      missing: ['https://wahapedia.ru/wh40k11ed/Datasheets.csv'],
      unpublished: ['https://wahapedia.ru/wh40k11ed/Guessed.csv'],
    })
  })
})
