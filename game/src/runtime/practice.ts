import type * as THREE from 'three'
import { DIFFICULTIES, type Difficulty } from '../sim/difficulty.ts'
import type { Arena } from '../content/arenas/arena.ts'
import { WEAPONS } from '../content/weapons/weapons.ts'
import { createFeed } from '../view/feed.ts'
import type { Loadout } from '../sim/loadout.ts'
import type { MapId } from '../content/arenas/maps.ts'
import { classic } from '../modes/matchSettings.ts'
import { MODES } from '../modes/modes.ts'
import { createScenery } from '../modes/scenery.ts'
import type { Mode } from '../modes/ids.ts'
import { createWorld } from '../sim/physics.ts'
import { recruits } from '../modes/roster.ts'
import { createSimulation, enlist } from '../sim/simulation.ts'
import { createMatchView } from '../view/view.ts'
import { playMatch, type MatchPhase } from './match.ts'

// Each match draws a new seed; everything random in it comes from that
// (the F3 overlay shows it), so a bots-only match replays from its seed.
const freshSeed = () => (Math.random() * 2 ** 32) >>> 0

export interface MatchOptions {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  arena: Arena
  map: MapId // the arena's id
  mode: Mode
  difficulty: Difficulty // the bots'
  surface: HTMLCanvasElement // receives mouse input and pointer lock
  loadout: Loadout // the player's
  onPhase: (phase: MatchPhase) => void
}

// One practice match: the player and bots in the arena, the simulation
// (simulation.ts: physics, combat and the mode's rules) run here.
export function createMatch({ scene, camera, arena, map, mode: kind, difficulty, surface, loadout, onPhase }: MatchOptions) {
  let seed = freshSeed()
  const world = createWorld(arena.colliders)
  const skill = DIFFICULTIES[difficulty] // the bots': their skill, and how it scales their guns
  const settings = classic(kind) // practice plays as Classic does
  // Practice line-up (roster.ts): the player in seat 0 with the garage loadout, bots in the rest.
  const combatants = recruits(kind, arena, settings, seed, skill, { name: 'You', vehicle: loadout.vehicle, weapon: WEAPONS[loadout.weapon] }).map(
    (recruit, id) => enlist(world, id, recruit),
  )
  const player = combatants[0]
  const view = createMatchView({ scene, camera, surface, world, arena, combatants, player })
  const mode = MODES[kind].create({ combatants, arena, world, seed, settings })
  const scenery = createScenery(scene, kind, mode)
  const { rules } = mode
  const sim = createSimulation({ world, arena, combatants, mode, events: view.events, seed })
  const feed = createFeed(combatants, player.id, () => rules.now, view.feedback)
  const others = combatants.filter((c) => c !== player)

  return playMatch(
    { scene, camera, surface, onPhase, arena, map, world, combatants, player, mode, scenery, view, feed, combatantOf: sim.combatantOf },
    {
      online: false,
      people: combatants.map((c) => c === player),
      uids: combatants.map(() => ''),
      seed: () => seed,
      drives: (looking) => looking && rules.phase !== 'preMatch', // held on the grid, free to look around
      receive() {},
      step(dt, live) {
        sim.step(dt, live)
        if (live) mode.report(feed)
      },
      place() {},
      finish: () => sim.standDown(), // the bots stand down
      restart() {
        seed = freshSeed()
        sim.restart(seed)
        mode.restart(seed)
      },
      nextIn: () => Infinity,
      holdIn: () => Infinity,
      debug() {
        let alive = 0
        for (const c of others) if (c.alive) alive++
        return [`BOTS   ${alive}/${others.length} alive  ${skill.label}`]
      },
      dispose: () => world.free(),
    },
  )
}
