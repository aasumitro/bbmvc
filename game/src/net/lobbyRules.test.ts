import { describe, expect, it } from 'vitest'
import type { Mode } from '../modes/ids.ts'
import { sideOf } from '../modes/traits.ts'
import { emptySide, startable, tallyKey } from './lobbyRules.ts'

// Parity: each answer is what the code before these rules gave
// (server/lobbies.ts side, unstartable and over; the waiting room's startHint;
// team deathmatch's lineUp), over the cases server/lobbies.test.ts drives.

type Slot = Parameters<typeof startable>[0]['slots'][number]
const person = (uid: string, ready = true, away = false) => ({ kind: 'person' as const, uid, ready, away })
const bot: Slot = { kind: 'bot' }
const slots = (size: number, at: Record<number, Slot & { ready?: boolean; away?: boolean }>) =>
  Array.from({ length: size }, (_, i) => at[i] ?? { kind: 'empty' as const })
const owner = person('o', false)

describe('startable and emptySide', () => {
  it.each([
    ['alone at the start', 'tdm', slots(12, { 0: owner }), 'alone', 1],
    ['alone with a bot on red', 'tdm', slots(12, { 0: owner, 6: bot }), 'alone', -1],
    ['a newcomer not ready', 'tdm', slots(12, { 0: owner, 6: person('m', false) }), 'waiting', -1],
    ['a member ready but away', 'tdm', slots(8, { 0: owner, 4: person('m', true, true) }), 'waiting', -1],
    ['both on blue, nobody red', 'tdm', slots(12, { 0: owner, 3: person('m') }), 'sides', 1],
    ['both on red, nobody blue', 'tdm', slots(12, { 6: owner, 7: person('m') }), 'sides', 0],
    ['two people and a bot on red', 'tdm', slots(12, { 0: owner, 3: person('m'), 7: bot }), '', -1],
    ['one a side at 1 v 1', 'tdm', slots(2, { 0: owner, 1: person('m') }), '', -1],
    ['free for all, two people', 'ffa', slots(12, { 0: owner, 1: person('m') }), '', -1],
    ['free for all, a bot beside', 'ffa', slots(6, { 0: owner, 1: person('m'), 3: bot }), '', -1],
  ] as const)('%s', (_, mode, at, reason, empty) => {
    const people = at.filter((slot) => slot.kind === 'person')
    const waiting = people.filter((p) => p.uid !== 'o' && (!p.ready || p.away)).length
    expect(startable({ mode, size: at.length, slots: at, people: people.length, waiting })).toBe(reason)
    expect(emptySide(mode, at.length, at)).toBe(empty)
  })
})

describe('tallyKey', () => {
  it.each([
    ['blue wins', 'tdm', 0, slots(12, { 0: person('o') }), '0'],
    ['red wins', 'tdm', 1, slots(12, { 0: person('o') }), '1'],
    ['a person wins free for all', 'ffa', 1, slots(6, { 1: person('m') }), 'm'],
    ['a bot wins free for all', 'ffa', 3, slots(6, { 3: bot }), 'bot:3'],
    ['an empty seat', 'ffa', 2, slots(6, {}), ''],
  ] as const)('%s', (_, mode, winner, at, key) => {
    expect(tallyKey(mode, winner, at)).toBe(key)
  })
})

describe('sideOf', () => {
  it.each([
    ['tdm', 12, 0, 0],
    ['tdm', 12, 5, 0],
    ['tdm', 12, 6, 1],
    ['tdm', 12, 11, 1],
    ['tdm', 2, 0, 0],
    ['tdm', 2, 1, 1],
    ['tdm', 8, 3, 0],
    ['tdm', 8, 4, 1],
    ['ffa', 12, 7, 7],
    ['ffa', 4, 0, 0],
  ] satisfies Array<[Mode, number, number, number]>)('%s at %i: seat %i is side %i', (mode, size, seat, side) => {
    expect(sideOf(mode, size, seat)).toBe(side)
  })
})
