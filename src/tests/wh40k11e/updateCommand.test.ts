import { describe, expect, it } from 'vitest'
import { changedWh40kFiles } from '../../wh40k11e/data/updateCommand'

describe('changedWh40kFiles', () => {
  it('keeps the first path whole when its status code starts with a space', () => {
    expect(
      changedWh40kFiles(
        ' M data/wh40k11e/pipeline.json\n D data/wh40k11e/reviews/sources-2026-09-30.json\n?? data/wh40k11e/reviews/sources-2026-10-16.json\nR  old.ts -> new.ts\n'
      )
    ).toEqual([
      'data/wh40k11e/pipeline.json',
      'data/wh40k11e/reviews/sources-2026-09-30.json',
      'data/wh40k11e/reviews/sources-2026-10-16.json',
      'new.ts',
    ])
  })
})
