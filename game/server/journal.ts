import type { MapId } from '../src/content/arenas/maps.ts'
import type { VehicleId } from '../src/content/vehicles/vehicles.ts'
import type { WeaponId } from '../src/content/weapons/weapons.ts'
import type { Mode } from '../src/modes/ids.ts'
import type { MatchSettings } from '../src/modes/matchSettings.ts'
import type { SeatPlan } from '../src/modes/roster.ts'
import type { Input } from '../src/net/protocol.ts'

// A room's journal, the one definition of a persisted format: what
// room.ts writes as it runs and replay.ts reads to run the room again
// (records.ts keeps it on disk, a gzipped line of JSON each).

// What a person's machine is given on a step: their input as the room took
// it, and how: DRIVING (the input), STANDING (the match is over or held:
// standing down) or COASTING (their input went stale: neutral).
export const DRIVING = 0
export const STANDING = 1
export const COASTING = 2
export interface Given {
  kind: typeof DRIVING | typeof STANDING | typeof COASTING
  input: Pick<Input, 'throttle' | 'steer' | 'handbrake' | 'fire' | 'recover' | 'aim' | 'view'>
}

// A replay's lines: the room's header, then what happened after step `k` (a
// seat taken or left), what the people's machines were given on step `k`
// (only the seats whose given changed: givenRow), the seed a match started
// on, the end of match `end`, and the room closing after step `k`.
export type ReplayLine =
  | {
      replay: 1
      protocol: number
      build: string
      room: string
      mode: Mode
      map: MapId
      seed: number
      created: number
      hold: number
      results: number
      settings?: MatchSettings
      lobby?: string
      plan?: SeatPlan
    }
  | { k: number; join: [seat: number, uid: string, name: string, weapon: WeaponId, vehicle: VehicleId] }
  | { k: number; leave: number }
  | { k: number; in: number[][] }
  | { k: number; go: number }
  | { k: number; end: number }
  | { k: number; close: 1 }

// A seat's given on step `tick`, as its `in` row: [seat, kind, throttle,
// steer, handbrake, fire, recover, aim x, y, z, lag] — lag: steps the tick
// the page saw lies behind `tick`, as it sent it, so a page steady on its
// link sends the same row again; standing down or coasting, just [seat,
// kind]: the input isn't used.
export const givenRow = (seat: number, { kind, input: i }: Given, tick: number) =>
  kind === DRIVING ? [seat, kind, i.throttle, i.steer, +i.handbrake, +i.fire, +i.recover, i.aim.x, i.aim.y, i.aim.z, tick - i.view] : [seat, kind]

// An `in` row read back: the seat, the given without its view, and the lag to rebuild the view from on each step.
export function readGiven([seat, kind, throttle = 0, steer = 0, handbrake = 0, fire = 0, recover = 0, x = 0, y = 0, z = 0, lag = 0]: number[]) {
  return {
    seat,
    kind: kind as Given['kind'],
    input: { throttle, steer, handbrake: !!handbrake, fire: !!fire, recover: !!recover, aim: { x, y, z } },
    lag,
  }
}
