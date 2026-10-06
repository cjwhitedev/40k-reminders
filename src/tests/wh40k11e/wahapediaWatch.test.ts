import { describe, expect, it } from 'vitest'
import { checkWh40kWahapediaUpdate, WH40K_LAST_UPDATE_URL } from '../../wh40k11e/data/watchCommand'

const review = (checksum: string) => ({
  inputs: { wahapediaExports: [{ url: WH40K_LAST_UPDATE_URL, checksum }] },
})
const manifest = (checksum: string) => ({ artifacts: [{ requestUrl: WH40K_LAST_UPDATE_URL, checksum }] })

describe('Wahapedia update watch', () => {
  it('reports no change when Last_update.csv matches the reviewed one', () => {
    expect(checkWh40kWahapediaUpdate(review('a'.repeat(64)), manifest('a'.repeat(64)))).toEqual({
      changed: false,
      pinned: 'a'.repeat(64),
      current: 'a'.repeat(64),
    })
  })

  it('reports a change when Wahapedia has published a new update', () => {
    expect(checkWh40kWahapediaUpdate(review('a'.repeat(64)), manifest('b'.repeat(64))).changed).toBe(true)
  })

  it('fails loudly when either side is missing Last_update.csv', () => {
    expect(() => checkWh40kWahapediaUpdate({ inputs: { wahapediaExports: [] } }, manifest('a'))).toThrow(
      /review file does not pin/
    )
    expect(() => checkWh40kWahapediaUpdate(review('a'), { artifacts: [] })).toThrow(/candidate has no/)
  })
})
