import { describe, expect, it } from 'vitest'
import { DEFAULT_LOADOUT, parseLoadout } from './loadout.ts'

// The one reader of a loadout: what this browser kept, and what a page's hello asks for.
describe('parseLoadout', () => {
  it.each([
    ['a valid loadout', { vehicle: 'razor', weapon: 'rocketPod' }, { vehicle: 'razor', weapon: 'rocketPod' }],
    ['an unknown vehicle', { vehicle: 'tank', weapon: 'rocketPod' }, { vehicle: 'razor', weapon: 'rocketPod' }],
    ['an unknown weapon', { vehicle: 'razor', weapon: 'laser' }, { vehicle: 'razor', weapon: 'minigun' }],
    ['null', null, DEFAULT_LOADOUT],
    ['a number', 7, DEFAULT_LOADOUT],
    ['a string', 'rocketPod', DEFAULT_LOADOUT],
    ['missing fields', {}, DEFAULT_LOADOUT],
    ['a weapon alone', { weapon: 'rocketPod' }, { vehicle: 'razor', weapon: 'rocketPod' }],
    ['ids off the prototype', { vehicle: 'toString', weapon: 'constructor' }, DEFAULT_LOADOUT],
    ['ids that aren’t strings', { vehicle: ['razor'], weapon: ['rocketPod'] }, DEFAULT_LOADOUT],
    ['what saveLoadout keeps today', JSON.parse('{"vehicle":"razor","weapon":"rocketPod"}'), { vehicle: 'razor', weapon: 'rocketPod' }],
  ])('%s', (_, raw, loadout) => {
    expect(parseLoadout(raw)).toEqual(loadout)
  })
})
