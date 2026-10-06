import type { Collector, SupplyEvent } from '../items/supply.ts'
import type { MatchSettings } from '../matchSettings.ts'
import type { Life } from '../mode.ts'
import type { Credit, Tally } from '../scoring.ts'

// Team deathmatch domain types, shared by the rules and the team AI.

export interface Point {
  x: number
  z: number
}

// What the rules need of a machine (the pickups too, when a match has them); the match's combatants are members.
export interface Member extends Collector {
  name: string
  team: number // 0 or 1
}

// Match states (work/tdm/TDM_STATE_MACHINE.md).
export type TdmPhase = 'preMatch' | 'active' | 'overtime' | 'complete'

// A machine as the rules see it (its life cycle is every mode's: ../mode.ts); the Tally part is the statistics'.
export interface Contender extends Tally {
  life: Life
  respawnAt: number
  protectedUntil: number
  spawn: number // start of the current life, -1 before the first respawn
  spawnedAt: number
  errand: Errand // a bot's errand, rewritten in place
}

// Somewhere a bot drives when it isn't fighting (`urgent`: even with a target, still shooting at it on the way).
export interface Errand extends Point {
  urgent: boolean
}

// What a bot is doing for its team (reported, not stored: it follows from the battlefield).
export type Stance = 'attack' | 'support' | 'flank' | 'defend'

export type TdmEvent =
  | { type: 'phase'; phase: TdmPhase }
  | { type: 'finalMinute' }
  | ({ type: 'kill'; team: number } & Credit) // team: the killer's, whose score just went up
  | { type: 'teamkill'; killer: number; victim: number; team: number } // friendly fire: team, the killer's, just lost a point
  | { type: 'death'; victim: number } // wrecked with nobody to credit
  | { type: 'respawn'; who: number; spawn: number }
  | SupplyEvent

export interface TdmOptions {
  starts: readonly Point[] // every start a machine can respawn at
  homes: readonly [Point, Point] // each team's base: where its own half is
  spots: readonly Point[] // where items can appear, when the settings turn pickups on
  seed: number // the match's: the items' rolls
  settings: MatchSettings
}
