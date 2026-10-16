import { describe, expect, it } from 'vitest'
import { WEAPONS, type BeamSpec } from '../content/weapons/weapons.ts'
import { armWeapon, pullTrigger, type WeaponState } from './combat.ts'
import { PHYSICS_STEP } from './physics.ts'

// The trigger, step by step: a gun's magazine and reload, and a beam's heat
// (its ammo the heat left to spend: overheated it cools whole, let go it
// cools a pulse at a time).

const BEAM: BeamSpec = { ...WEAPONS.minigun, kind: 'beam', damage: 3, fireRate: 10, magazine: 40, reloadTime: 2 }

// `seconds` of the trigger `held`, at the simulation's step: the rounds that left.
const hold = (weapon: WeaponState, held: boolean, seconds: number) => {
  let rounds = 0
  for (let k = Math.round(seconds / PHYSICS_STEP); k > 0; k--) if (pullTrigger(weapon, held, PHYSICS_STEP)) rounds++
  return rounds
}

describe('pullTrigger', () => {
  it('a gun empties its magazine, reloads, and fires again', () => {
    const gun = armWeapon(WEAPONS.cannon)
    expect(hold(gun, true, 3.9)).toBe(4) // a round a second: four, the last at 3 s, then the 2.5 s reload
    expect(gun.reload).toBeCloseTo(1.6, 1)
    expect(hold(gun, true, 1.5)).toBe(0)
    hold(gun, false, 0.2)
    expect(gun.ammo).toBe(4)
  })

  it('a beam overheats after its magazine of pulses, cools whole, and fires again', () => {
    const beam = armWeapon(BEAM)
    expect(hold(beam, true, 3.95)).toBe(40) // ten pulses a second for four seconds
    expect(beam.ammo).toBe(0)
    expect(beam.reload).toBeGreaterThan(1.9) // overheated on the last pulse, a few steps ago
    expect(hold(beam, true, 1.9)).toBe(0)
    expect(hold(beam, true, 0.1)).toBeGreaterThan(0)
  })

  it('a beam let go cools a pulse at a time, hot to cold in its reload time', () => {
    const beam = armWeapon(BEAM)
    expect(hold(beam, true, 1.95)).toBe(20)
    expect(beam.ammo).toBe(20)
    hold(beam, false, 0.5)
    expect(beam.ammo).toBe(29) // the first unit back once the pulse's own 0.1 s is up, then one every 0.05 s
    hold(beam, false, 2)
    expect(beam.ammo).toBe(40)
    expect(beam.reload).toBe(0)
  })
})
