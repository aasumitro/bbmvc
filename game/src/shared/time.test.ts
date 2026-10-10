import { describe, expect, it } from 'vitest'
import { clock, ms } from './time.ts'

describe('clock', () => {
  it.each([
    [0, '00:00'],
    [59.9, '00:59'],
    [60, '01:00'],
    [600, '10:00'],
  ])('%s s reads %s', (seconds, text) => {
    expect(clock(seconds)).toBe(text)
  })
})

describe('ms', () => {
  it.each([
    [0, 0],
    [59.9, 59.9],
    [60, 60],
    [600, 600],
    [1 / 3, 0.333],
  ])('%s s goes on the wire as %s', (seconds, wire) => {
    expect(ms(seconds)).toBe(wire)
  })
})
