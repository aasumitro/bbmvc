import { describe, expect, it } from 'vitest'
import { EFFECTS, ITEMS } from './items.ts'

describe('the item catalogue', () => {
  // The supply shares each machine's effects in this order (supply.ts share): the wire's JSON as before.
  it('lists the timed items in its own order', () => {
    expect(EFFECTS).toEqual(['repair', 'speed', 'armor', 'damage'])
  })

  it.each(Object.entries(ITEMS))('%s has a label and a colour', (_, item) => {
    expect(item.label).not.toBe('')
    expect(item.color).toMatch(/^#[0-9a-f]{6}$/)
  })
})
