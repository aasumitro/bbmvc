import type RAPIER from '@dimforge/rapier3d-compat'
import type { Arena } from '../content/arenas/arena.ts'
import type { MatchMode, Seat } from '../sim/matchMode.ts'
import { FFA } from './ffa/config.ts'
import { createFfaMode, lineUp as ffaLineUp } from './ffa/mode.ts'
import type { Mode } from './ids.ts'
import { minutes, type MatchSettings } from './matchSettings.ts'
import type { Combatant } from '../sim/simulation.ts'
import { TDM } from './tdm/config.ts'
import { createTdmMode, lineUp as tdmLineUp } from './tdm/mode.ts'

// Every game mode: what the arena screen says about it, how it lines the
// machines up, and its adapter for the match runtime (the MatchMode
// contract, sim/matchMode.ts). A new mode is its own folder plus an entry here.

// What a mode is started with: the machines (seated as its lineUp said),
// the arena and its physics world, the match seed and settings. What the
// browser draws of it besides the machines: scenery.ts.
export interface ModeContext {
  combatants: readonly Combatant[]
  arena: Arena
  world: RAPIER.World
  seed: number
  settings: MatchSettings
}

// One entry per mode id (ids.ts): the arena screen's card, the line-up, the adapter.
interface ModeEntry {
  label: string
  tags: string[]
  blurb: string
  lineUp: (arena: Arena, size: number) => Seat[]
  create: (context: ModeContext) => MatchMode
}

export const MODES = {
  tdm: {
    label: 'Team Deathmatch',
    tags: [`${TDM.teamSize} vs ${TDM.teamSize}`, minutes(TDM.duration), 'most kills wins'],
    blurb:
      'Two teams of four, ten minutes, no kill limit: every wreck scores for your team, and more wrecks at the buzzer wins — a tie goes to overtime, next kill wins. Stick together, cover each other, finish the damaged.',
    lineUp: tdmLineUp,
    create: ({ combatants, arena, world, seed, settings }: ModeContext) => createTdmMode(combatants, arena, world, seed, settings),
  },
  ffa: {
    label: 'Free for All',
    tags: [`${FFA.grid} machines`, minutes(FFA.duration), 'most wrecks wins'],
    blurb:
      'No crews, no allies. Eight machines, ten minutes, everyone shoots everyone — the most wrecks at the buzzer takes the arena, and a tie goes to overtime. Grab the pickups, fight over the hot zone.',
    lineUp: ffaLineUp,
    create: ({ combatants, arena, world, seed, settings }: ModeContext) => createFfaMode(combatants, arena, world, seed, settings),
  },
} satisfies Record<Mode, ModeEntry>
