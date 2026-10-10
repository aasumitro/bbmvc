import { describe, expect, it } from 'vitest'
import { classic } from './matchSettings.ts'
import { BOT_NAMES } from './roster.ts'
import { MAX_SEATS, MODE_TRAITS } from './traits.ts'

// The numbers that must agree with the traits: the biggest match, a name for
// every bot seat in it, the lobby's sizes, Classic's match.
describe('mode traits', () => {
  it('the biggest match is twelve, as the wire’s slots were', () => {
    expect(MAX_SEATS).toBe(12)
  })

  it('a bot name for every seat of the biggest match', () => {
    expect(BOT_NAMES).toHaveLength(MAX_SEATS)
  })

  it.each([
    ['tdm', [2, 4, 6, 8, 10, 12]],
    ['ffa', [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
  ] as const)('%s: a lobby offers the sizes it did', (mode, sizes) => {
    expect(MODE_TRAITS[mode].sizes).toEqual(sizes)
  })

  it.each([
    ['tdm', { size: 8, duration: 600, pickups: false }],
    ['ffa', { size: 8, duration: 600, pickups: true }],
  ] as const)('%s: Classic’s match as before', (mode, { size, duration, pickups }) => {
    expect(classic(mode)).toEqual({
      size,
      duration,
      respawn: 'normal',
      friendlyFire: false,
      items: { health: pickups, ammo: pickups, powerups: pickups },
      weapons: 'all',
      killLimit: 0,
    })
  })
})
