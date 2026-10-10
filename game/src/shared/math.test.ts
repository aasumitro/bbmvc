import { describe, expect, it } from 'vitest'
import { distance, wrap } from './math.ts'

describe('wrap', () => {
  it('keeps 0 and brings ±π and 3π into -π..π', () => {
    expect(wrap(0)).toBe(0)
    expect(wrap(Math.PI)).toBeCloseTo(Math.PI, 12)
    expect(wrap(-Math.PI)).toBeCloseTo(-Math.PI, 12)
    expect(wrap(3 * Math.PI)).toBeCloseTo(Math.PI, 12)
  })

  // An angle as each of the five old copies' callers hands it over: the short way round.
  it.each([
    ['view.ts, the turret: bearing 3, turret at -3', 3 - -3, 6 - 2 * Math.PI],
    ['camera.ts, the chase: car at -3.1, camera at 3.1', -3.1 - 3.1, 2 * Math.PI - 6.2],
    ['think.ts, the steering error: goal at -2.5, heading 2.5', -2.5 - 2.5, 2 * Math.PI - 5],
    ['pilot.ts, the lock-on window: rival at π - 0.1, view at 0.1 - π', Math.PI - 0.1 - (0.1 - Math.PI), -0.2],
    ['Hud.tsx, the hit marker: from 0.5, yaw a whole turn on', 0.5 - (0.5 + 2 * Math.PI), 0],
  ])('%s', (_, angle, expected) => {
    expect(wrap(angle)).toBeCloseTo(expected, 12)
  })
})

describe('distance', () => {
  it('measures on the ground, height aside', () => {
    const roof = { x: 0, y: 2, z: 0 }
    const wheel = { x: 3, y: 0, z: 4 }
    expect(distance(roof, wheel)).toBe(5)
  })
})
