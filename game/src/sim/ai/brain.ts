import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { WEAPONS, type WeaponId, type WeaponSpec } from '../../content/weapons/weapons.ts'
import { DIFFICULTIES, type Skill } from '../difficulty.ts'
import type { DriveInput } from '../drive.ts'

// Bots (sim/ai/): what a bot is — its tuning, its gun, what it reads of a
// machine, its brain and how a hit provokes it. How it sees (perception.ts),
// finds its way (navigation.ts) and thinks each step (think.ts) build on this.

// Bot tuning. Metres, seconds.
export const AI = {
  detectRange: 70, // hunts the nearest rival this close, seen or not
  grudge: 6, // seconds it keeps after whoever last shot it, however far
  arrive: 6, // metres from a route node that count as reaching it
  replan: 1.5, // seconds between route updates
  cornering: [30, 12, 7], // m/s it takes a bend in its route: gentle, sharp, right-angle
  braking: 9, // m/s² it plans to slow at
  lookahead: [8, 0.5], // metres along the route it steers for: base, plus seconds of speed
  lane: 2.5, // metres right of a street's centre line it keeps to, so bots pass each other
  hurt: 0.4, // below this share of its hull it keeps further off and dodges harder
  jink: 1.6, // seconds it dodges after a hit (× the skill's evade)
  aligned: 0.06, // radians: a rocket leaves only with the gun this close to the lead
  blocked: 0.6, // seconds pressing on a blocked nose before it backs out
  hideouts: [12, 20, 30], // metres out it looks for a hideout, twelve ways round
  lurk: [25, 55], // lies in wait only for an unseen target coming its way this far off
  mateGap: 3, // friendly fire on: a teammate this close to its line of fire holds its trigger
}

// A bot's gun: one off the garage's roster (or the guns a match allows),
// drawn from `random` (the match's seeded stream), its damage scaled and its
// spread floored by the skill.
export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[]
export function armBot(skill: Skill, random: () => number, roster: readonly WeaponId[] = WEAPON_IDS): WeaponSpec {
  return botGun(WEAPONS[roster[Math.floor(random() * roster.length)]], skill)
}

// A gun as a bot of `skill` fires it (a bot taking an online seat back gets its gun this way).
export const botGun = (spec: WeaponSpec, skill: Skill): WeaponSpec => ({
  ...spec,
  damage: spec.damage * skill.damage,
  spread: Math.max(spec.spread, skill.spread),
})

// What a bot reads of a machine — its own and every rival's — and the
// controls it writes each step. The simulation's combatants are agents;
// nothing here knows who else might be driving them.
export interface Agent {
  id: number
  team: number
  alive: boolean
  position: THREE.Vector3
  rotation: THREE.Quaternion
  velocity: THREE.Vector3
  speed: number // forward m/s
  health: number
  maxHealth: number
  car: { body: RAPIER.RigidBody }
  weapon: { spec: WeaponSpec; reload: number }
  control: DriveInput & { fire: boolean; aim: THREE.Vector3 }
  brain?: Brain
}

// Pick a target (whoever shot it last, else the nearest rival in range),
// follow the nav graph toward it until it is in sight, then fight it the way
// its gun wants: circle it, or weave and keep its distance where the streets
// are too tight to circle, leading its aim by the target's speed. With no one
// near it roams the graph; stuck against something, it backs out toward open
// ground.
export interface Brain {
  skill: Skill
  target: Agent | null
  attacker: Agent | null // last to damage it
  grudge: number // seconds left chasing the attacker
  retarget: number // seconds until the target is reconsidered
  route: number[] // nav nodes still to drive through
  from: THREE.Vector3 // where the current leg of the route starts
  replan: number // seconds until the route is recomputed
  roam: number // node it wanders to with no one to hunt
  orbit: number // +1 / -1: which way it circles
  radius: number // of its circle round this target
  side: number // +1 / -1: which way it weaves
  change: number // seconds until it may switch orbit or weave on a whim
  jink: number // seconds of dodging left, after a hit
  hide: number // seconds left in a hideout: taking cover, or lying in wait (`lurking`)
  hideout: THREE.Vector3 // where it hides
  lurking: boolean
  decide: number // seconds until it next thinks about hiding
  stuck: number // seconds spent throttling without moving
  blocked: number // seconds pressing on a blocked nose
  reverse: number // seconds of backing out left
  escape: number // +1 / -1: lock while backing out
  burst: number // > 0: firing for that long; < 0: holding fire
  sight: number // seconds until the next line-of-sight check
  canSee: boolean
  clear: boolean // no teammate in the way (friendly fire on; always, off)
  direct: boolean // the way straight to the target is open road
  room: boolean // open road round to the next point of its circle
  errand: THREE.Vector3 // where its current errand leads (see Plan)
}

// Optional steering from the match rules (free for all): how near a rival
// looks when choosing a target (Infinity: not a target at all), and
// somewhere worth driving when there's no one to fight — `urgent`: even
// with a target, still shooting at it on the way. `careful`: friendly fire
// is on, so a bot holds fire rather than hit a teammate.
export interface Plan {
  value(bot: Agent, rival: Agent, distance: number): number
  errand(bot: Agent): { x: number; z: number; urgent: boolean } | null
  careful?: boolean
}

// Holds fire for its first seconds, so a fresh spawn isn't shot before it can react.
export const createBrain = (seed: number, skill: Skill = DIFFICULTIES.normal): Brain => ({
  skill,
  target: null,
  attacker: null,
  grudge: 0,
  retarget: 0,
  route: [],
  from: new THREE.Vector3(),
  replan: 0,
  roam: seed * 7,
  orbit: seed % 2 ? 1 : -1,
  radius: 20,
  side: seed % 3 ? 1 : -1,
  change: 2,
  jink: 0,
  hide: 0,
  hideout: new THREE.Vector3(),
  lurking: false,
  decide: 1,
  stuck: 0,
  blocked: 0,
  reverse: 0,
  escape: 1,
  burst: -3,
  sight: 0,
  canSee: false,
  clear: true,
  direct: false,
  room: false,
  errand: new THREE.Vector3(Infinity, 0, Infinity),
})

// The bot was hit: it turns on the shooter and swerves.
export function provoke(brain: Brain, attacker: Agent) {
  brain.attacker = attacker
  brain.grudge = AI.grudge
  if (brain.target !== attacker) brain.retarget = 0
  if (brain.jink <= 0) brain.side = -brain.side
  brain.jink = AI.jink * brain.skill.evade
  if (brain.lurking) brain.hide = 0 // found out: it fights
}
