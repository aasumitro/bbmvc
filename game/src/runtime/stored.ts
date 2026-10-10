import { DEFAULT_LOADOUT, parseLoadout, type Loadout } from '../sim/loadout.ts'

// What this browser keeps between visits for the game itself (the player's
// settings keep theirs: view/settings.ts).

const LOADOUT_KEY = 'scrapyard.loadout'

// The loadout last picked in this browser; an id the registries no longer have falls back to the default's.
export function savedLoadout(): Loadout {
  try {
    return parseLoadout(JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? '{}'))
  } catch {
    return DEFAULT_LOADOUT // storage blocked or corrupt
  }
}

export function saveLoadout(loadout: Loadout) {
  try {
    localStorage.setItem(LOADOUT_KEY, JSON.stringify(loadout))
  } catch {
    // not kept; still used for this visit
  }
}
