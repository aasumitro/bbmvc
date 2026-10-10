import { describe, expect, it } from 'vitest'
import { decode, encode, owners, type GameEvent } from './events.ts'

// One of every code, its numbers on the wire's grid (whole centimetres,
// ten-thousandths), so encoding loses nothing.
const v = (x: number, y: number, z: number) => ({ x, y, z })
const EVERY: GameEvent[] = [
  { code: 'sh', tick: 88, shooter: 3, muzzle: v(0.01, 0.02, 0.03), point: v(0.04, 0.05, 0.06), normal: v(0.07, 0.08, 0.09), struck: true, victim: 7 },
  { code: 'sh', tick: 89, shooter: 2, muzzle: v(-1.5, 2.25, 30), point: v(4, 5, 6), normal: v(0, 1, 0), struck: false, victim: -1 },
  { code: 'ln', tick: 90, shooter: 1, muzzle: v(12.34, 1.95, -0.62), heading: v(0.6, 0, -0.8) },
  { code: 'rk', tick: 91, from: v(1, 2, 3), to: v(4.5, 2, 3.25) },
  { code: 'bu', tick: 92, at: v(1.2, 0.5, -3.4) },
  { code: 'hu', tick: 93, victim: 4, attacker: 5 },
  { code: 'wr', tick: 94, victim: 6, attacker: 6 },
  { code: 'cr', tick: 95, seat: 0, x: 12.5, z: -3.75, force: 0.42 },
  { code: 'rl', tick: 96, seat: 2, started: true },
  { code: 'rl', tick: 97, seat: 2, started: false },
  { code: 'sp', tick: 98, seat: 3 },
  { code: 'rc', tick: 99, seat: 4 },
  { code: 'ru', tick: 100, event: { type: 'kill', killer: 1, victim: 2 } },
  { code: 'go', tick: 101, seed: 123456 },
]

describe('wire events', () => {
  it.each(EVERY.map((event) => [event.code, event] as const))('%s: decode(encode(x)) is x', (_, event) => {
    expect(decode(encode(event))).toEqual(event)
  })

  it('writes a round as the recorder always has: positions in centimetres, the normal in hundredths, then hit and victim', () => {
    expect(encode(EVERY[0])).toEqual(['sh', 88, 3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 7])
  })

  it('knows no code it wasn’t built with', () => {
    expect(decode(['zz', 1, 2])).toBeNull()
  })

  it.each([
    ['sh', [3, 7]],
    ['ln', [1]],
    ['rk', []],
    ['hu', [4, 5]],
    ['cr', [0]],
    ['ru', []],
    ['go', []],
  ] as const)('%s: the seats it names are %j', (code, seats) => {
    expect(owners(EVERY.find((event) => event.code === code)!)).toEqual(seats)
  })
})
