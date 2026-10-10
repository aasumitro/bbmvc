import { describe, expect, it } from 'vitest'
import { DIFFICULTIES } from './difficulty.ts'

describe('DIFFICULTIES', () => {
  it('lists easy, normal and hard in that order (the wire and CUSTOM.skills go by these keys)', () => {
    expect(Object.keys(DIFFICULTIES)).toEqual(['easy', 'normal', 'hard'])
  })
})
