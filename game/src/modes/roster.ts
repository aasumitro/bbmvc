import { armBot, WEAPON_IDS } from '../sim/ai/brain.ts'
import { DIFFICULTIES, type Difficulty, type Skill } from '../sim/difficulty.ts'
import type { Arena } from '../content/arenas/arena.ts'
import { WEAPONS, type WeaponSpec } from '../content/weapons/weapons.ts'
import type { MatchSettings } from './matchSettings.ts'
import { MODES } from './modes.ts'
import type { Mode } from './ids.ts'
import { createRng } from '../shared/rng.ts'
import type { Recruit } from '../sim/simulation.ts'
import { VEHICLES, type VehicleId } from '../content/vehicles/vehicles.ts'

// Who takes each seat of a match's line-up, the same for a practice match
// (practice.ts: the player in seat 0) and an online room (server/room.ts:
// bots in every seat until people take them over). Seats and starts come
// from the mode's lineUp, the settings' size of them; each bot draws its gun
// from the garage's roster (or the one gun the settings allow) with the
// match seed, in seat order, its skill scaling that gun.

// By seat, for the biggest match (12): seat 0 is a bot's only online.
export const BOT_NAMES = [
  'Sawtooth',
  'Rustjaw',
  'Widowmaker',
  'Grinder',
  'Hexbolt',
  'Carrion',
  'Buzzkill',
  'Tetanus',
  'Blowtorch',
  'Deadbolt',
  'Scrapjack',
  'Piston',
]

export const botName = (seat: number) => BOT_NAMES[seat % BOT_NAMES.length]

// A custom lobby's match, seat by seat (server/lobbies.ts): a person's (their
// user id, and the vehicle they come in: the game server knows it from their
// hello), a bot at its difficulty, or empty — no bot unless the owner put one there.
export type SeatPlan = Array<{ uid: string; vehicle?: VehicleId } | { skill: Difficulty } | null>

// Whoever drives seat 0 in person (practice: the player, with the garage loadout).
export interface Driver {
  name: string
  vehicle: VehicleId
  weapon: WeaponSpec
}

// `plan`: a custom lobby's — bots only where it puts them, each at its own
// difficulty; the other seats wait for their person, or stay empty.
// A bot's vehicle is drawn, one draw a seat in seat order, from a stream of
// its own: no other draw moves when the garage grows (with one vehicle every
// seat is it).
export function recruits(kind: Mode, arena: Arena, settings: MatchSettings, seed: number, skill: Skill, player?: Driver, plan?: SeatPlan): Recruit[] {
  const arsenal = createRng(seed ^ 0x2545f491) // the bots' guns, apart from the simulation's stream
  const garage = createRng(seed ^ 0x6a09e667) // the bots' vehicles, apart from both
  const fleet = Object.keys(VEHICLES) as VehicleId[] // read when called: what the registry holds now
  const allowed = settings.weapons === 'all' ? WEAPON_IDS : [settings.weapons]
  return MODES[kind].lineUp(arena, settings.size).map(({ team, spawn }, id) => {
    const drawn = fleet[Math.floor(garage() * fleet.length)]
    if (id === 0 && player)
      return {
        name: player.name,
        team,
        seed: 1,
        spawn,
        vehicle: player.vehicle,
        weapon: settings.weapons === 'all' ? player.weapon : WEAPONS[settings.weapons],
        bot: false,
      }
    const seat = plan?.[id]
    if (plan && !(seat && 'skill' in seat)) {
      const vehicle = (seat && 'uid' in seat && seat.vehicle) || drawn // the person's own, waiting for them
      return { name: '', team, seed: id + 1, spawn, vehicle, weapon: WEAPONS[allowed[0]], bot: false } // nobody drives it yet
    }
    const own = seat && 'skill' in seat ? DIFFICULTIES[seat.skill] : skill
    return { name: botName(id), team, seed: id + 1, spawn, vehicle: drawn, weapon: armBot(own, arsenal, allowed), bot: true, skill: own }
  })
}
