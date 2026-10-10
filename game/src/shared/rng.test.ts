import { describe, expect, it } from 'vitest'
import { createRng } from './rng.ts'

// Every seeded stream in the game (gameplay, items, the bots' guns) rests on these draws.
describe('createRng', () => {
  it('draws the same first ten numbers from seed 1234', () => {
    const draw = createRng(1234)
    expect(Array.from({ length: 10 }, draw)).toEqual([
      0.07329497812315822, 0.7034119898453355, 0.9028560190927237, 0.9705493662040681, 0.04096397617831826, 0.11776310740970075, 0.1617849813774228,
      0.8027570187114179, 0.3989296858198941, 0.12749109929427505,
    ])
  })
})
