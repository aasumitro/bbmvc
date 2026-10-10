import type { Mode } from '../modes/ids.ts'
import { MODE_TRAITS, sideOf } from '../modes/traits.ts'

// A custom lobby's rules that the server (server/lobbies.ts) holds and the
// waiting room shows (screens/lobbies/): written once, so the page's hint and
// tally say what the server does. Pure: no socket, no clock.

type Slot = { kind: 'empty' } | { kind: 'person'; uid: string } | { kind: 'bot' }

// Why the owner can't start yet: '' when they can.
type Unstartable = '' | 'alone' | 'waiting' | 'sides'

// The side nobody holds a slot on, people or bots (a team mode's), or -1.
export function emptySide(mode: Mode, size: number, slots: readonly Slot[]) {
  if (!MODE_TRAITS[mode].teams) return -1
  return [0, 1].find((team) => !slots.some((slot, i) => slot.kind !== 'empty' && sideOf(mode, size, i) === team)) ?? -1
}

// In this order: at least two people, every one but the owner ready and
// connected (`waiting` counts those who aren't), and in a team mode someone
// on each side. The size is the most the match takes, never a number to wait for.
export function startable(lobby: { mode: Mode; size: number; slots: readonly Slot[]; people: number; waiting: number }): Unstartable {
  if (lobby.people < 2) return 'alone'
  if (lobby.waiting) return 'waiting'
  if (emptySide(lobby.mode, lobby.size, lobby.slots) >= 0) return 'sides'
  return ''
}

// The tally's key a match won by `winner` (a team mode: the side; else the
// seat) counts for: the side, the person's user id, or the bot's slot; '' an
// empty seat.
export function tallyKey(mode: Mode, winner: number, slots: readonly Slot[]) {
  if (MODE_TRAITS[mode].teams) return String(winner)
  const slot = slots[winner]
  return slot?.kind === 'person' ? slot.uid : slot?.kind === 'bot' ? `bot:${winner}` : ''
}
