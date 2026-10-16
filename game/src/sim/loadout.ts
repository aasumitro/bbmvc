import { WEAPONS, type WeaponId } from '../content/weapons/weapons.ts'
import { VEHICLES, type VehicleId } from '../content/vehicles/vehicles.ts'

// What a player takes into a match: the garage edits it, the match builds the
// machine from it. Plain ids into the registries (VEHICLES, WEAPONS), so it
// can be kept or sent to a server as it is. More slots (a Super weapon) are
// more fields here.
export interface Loadout {
  vehicle: VehicleId
  weapon: WeaponId // the roof turret
}

export const DEFAULT_LOADOUT: Loadout = { vehicle: 'razor', weapon: 'minigun' }

// A loadout out of anything (a stored one, a page's hello): each field an id
// the registries have, else the default's; anything but an object gives the
// default.
export function parseLoadout(raw: unknown): Loadout {
  const asked = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return { vehicle: pick(VEHICLES, asked.vehicle, DEFAULT_LOADOUT.vehicle), weapon: pick(WEAPONS, asked.weapon, DEFAULT_LOADOUT.weapon) }
}

function pick<K extends string>(registry: Record<K, unknown>, id: unknown, fallback: K): K {
  return typeof id === 'string' && Object.hasOwn(registry, id) ? (id as K) : fallback
}
