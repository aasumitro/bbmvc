import { WEAPONS, type WeaponId } from './combat.ts'
import { VEHICLES, type VehicleId } from './vehicle/vehicles.ts'

// What a player takes into a match: the garage edits it, the match builds the
// machine from it. Plain ids into the registries (VEHICLES, WEAPONS), so it
// can be kept or sent to a server as it is. More slots (a Super weapon) are
// more fields here.
export interface Loadout {
  vehicle: VehicleId
  weapon: WeaponId // the roof turret
}

export const DEFAULT_LOADOUT: Loadout = { vehicle: 'razor', weapon: 'minigun' }

const STORAGE_KEY = 'scrapyard.loadout' // kept in the browser, like the settings

// The loadout last picked in this browser; an id the registries no longer have falls back to the default's.
export function savedLoadout(): Loadout {
  try {
    const { vehicle, weapon } = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return {
      vehicle: Object.hasOwn(VEHICLES, vehicle) ? vehicle : DEFAULT_LOADOUT.vehicle,
      weapon: Object.hasOwn(WEAPONS, weapon) ? weapon : DEFAULT_LOADOUT.weapon,
    }
  } catch {
    return DEFAULT_LOADOUT // storage blocked or corrupt
  }
}

export function saveLoadout(loadout: Loadout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadout))
  } catch {
    // not kept; still used for this visit
  }
}
