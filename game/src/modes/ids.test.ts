import { describe, expect, it } from 'vitest'
import { MODE_IDS } from './ids.ts'
import { MODES } from './modes.ts'

describe('MODE_IDS', () => {
  it('names every registered mode, in the registry’s order (the screens list modes in it)', () => {
    expect(Object.keys(MODES)).toEqual([...MODE_IDS])
  })
})
