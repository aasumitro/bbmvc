import { describe, expect, it } from 'vitest'
import { botGun } from '../../sim/ai/brain.ts'
import { DIFFICULTIES } from '../../sim/difficulty.ts'
import { TURRETS } from './turrets.ts'
import { pelletsOf, sustainedDps, WEAPONS, type WeaponId } from './weapons.ts'

const IDS = Object.keys(WEAPONS) as WeaponId[]

describe('WEAPONS', () => {
  it.each(IDS)('%s carries its key as its id (the wire, records and replays name it by that)', (id) => {
    expect(WEAPONS[id].id).toBe(id)
  })

  it.each(IDS)('%s names a turret TURRETS builds', (id) => {
    expect(Object.hasOwn(TURRETS, WEAPONS[id].turret)).toBe(true)
  })

  it.each(IDS)('a bot’s scaled %s keeps its id and kind', (id) => {
    const scaled = botGun(WEAPONS[id], DIFFICULTIES.easy)
    expect(scaled).toMatchObject({ id, kind: WEAPONS[id].kind, damage: WEAPONS[id].damage * DIFFICULTIES.easy.damage })
  })

  it('a gun’s pellets count in its damage a second; the Shotgun casts eight, anything else one', () => {
    const scatter = { ...WEAPONS.minigun, pellets: 8 }
    expect(pelletsOf(scatter)).toBe(8)
    expect(sustainedDps(scatter)).toBeCloseTo(sustainedDps(WEAPONS.minigun) * 8, 9)
    expect(Object.fromEntries(IDS.map((id) => [id, pelletsOf(WEAPONS[id])]))).toEqual({
      minigun: 1,
      rocketPod: 1,
      cannon: 1,
      shotgun: 8,
      laser: 1,
      missiles: 1,
      mines: 1,
    })
  })
})
