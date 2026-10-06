import type RAPIER from '@dimforge/rapier3d-compat'
import type * as THREE from 'three'
import type { Arena } from './arena/arena'
import { FFA } from './ffa/config'
import { createFfaMode, lineUp as ffaLineUp } from './ffa/mode'
import { createHotZone } from './ffa/zone'
import { itemTypes } from './items/items'
import { createPickups } from './items/pickups'
import { minutes, type MatchSettings } from './matchSettings'
import type { Combatant } from './simulation'
import { TDM } from './tdm/config'
import { createTdmMode, lineUp as tdmLineUp } from './tdm/mode'

// Every game mode: what the arena screen says about it, how it lines the
// machines up, and its adapter for the match runtime (the MatchMode
// contract, mode.ts). A new mode is its own folder plus an entry here.

// What a mode is started with: the machines (seated as its lineUp said),
// the arena and its physics world, the match seed and settings; the scene
// when there is one to draw in.
export interface ModeContext {
  combatants: readonly Combatant[]
  arena: Arena
  world: RAPIER.World
  seed: number
  settings: MatchSettings
  scene?: THREE.Scene
}


export const MODES = {
  tdm: {
    label: 'Team Deathmatch',
    tags: [`${TDM.teamSize} vs ${TDM.teamSize}`, minutes(TDM.duration), 'most kills wins'],
    blurb: 'Two teams of four, ten minutes, no kill limit: every wreck scores for your team, and more wrecks at the buzzer wins — a tie goes to overtime, next kill wins. Stick together, cover each other, finish the damaged.',
    lineUp: tdmLineUp,
    create: ({ combatants, arena, world, seed, settings, scene }: ModeContext) => createTdmMode(combatants, arena, world, seed, settings, scene && itemTypes(settings.items).length ? createPickups(scene) : undefined),
  },
  ffa: {
    label: 'Free for All',
    tags: [`${FFA.grid} machines`, minutes(FFA.duration), 'most wrecks wins'],
    blurb: 'No crews, no allies. Eight machines, ten minutes, everyone shoots everyone — the most wrecks at the buzzer takes the arena, and a tie goes to overtime. Grab the pickups, fight over the hot zone.',
    lineUp: ffaLineUp,
    create: ({ combatants, arena, world, seed, settings, scene }: ModeContext) => createFfaMode(combatants, arena, world, seed, settings, scene && { pickups: createPickups(scene), zone: createHotZone(scene) }),
  },
}

export type Mode = keyof typeof MODES
