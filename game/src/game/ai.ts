import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { NavGraph } from './arena/arena'
import { WEAPONS, type WeaponId, type WeaponSpec } from './combat.ts'
import type { DriveInput } from './vehicle/drive'

// Bot tuning. Metres, seconds.
const AI = {
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

// How each gun wants to fight: in sight and closer than `engage`, it circles
// the target at a radius drawn from `circle`, or keeps about `keep` off it
// where there's no room to circle; it fires from `fire` in. A rocket pod
// holds off, where its splash lands and a rocket has time to be led.
const TACTICS = {
  gun: { engage: 38, circle: [14, 24], keep: 16, fire: 55 },
  rocket: { engage: 60, circle: [24, 36], keep: 30, fire: 110 },
}

// How well bots play, by the difficulty picked on the arena screen: their
// gun (`damage` ×, at least `spread` radians, applied by match.ts) and their
// hands — how fast the aim catches up (1/s), its wobble (m), how much of a
// mover's travel it leads (0..1), the trigger's bursts and pauses (s), the
// weave while fighting (m either side), how hard it dodges when hit (0..1),
// how readily it takes cover out of sight when hurt or reloading (0..1, a
// chance each second) and lies in wait for a rival coming its way (0..1).
// Easy is the old bot.
export interface Skill {
  label: string
  damage: number
  spread: number
  aimRate: number
  scatter: number
  lead: number
  burst: [number, number]
  pause: [number, number]
  weave: number
  evade: number
  hide: number
  ambush: number
}
export const DIFFICULTIES = {
  easy: { label: 'Easy', damage: 0.4, spread: 0.05, aimRate: 3, scatter: 1.4, lead: 0.3, burst: [0.6, 1.4], pause: [0.8, 1.7], weave: 3, evade: 0.4, hide: 0, ambush: 0 },
  normal: { label: 'Normal', damage: 0.6, spread: 0.03, aimRate: 4.5, scatter: 1, lead: 0.7, burst: [0.7, 1.6], pause: [0.6, 1.2], weave: 5, evade: 0.75, hide: 0.35, ambush: 0.25 },
  hard: { label: 'Hard', damage: 0.85, spread: 0.016, aimRate: 7, scatter: 0.55, lead: 0.95, burst: [0.9, 2], pause: [0.35, 0.8], weave: 7, evade: 1, hide: 0.7, ambush: 0.45 },
} satisfies Record<string, Skill>
export type Difficulty = keyof typeof DIFFICULTIES

// A bot's gun: one off the garage's roster (or the guns a match allows),
// drawn from `random` (the match's seeded stream), its damage scaled and its
// spread floored by the skill.
export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[]
export function armBot(skill: Skill, random: () => number, roster: readonly WeaponId[] = WEAPON_IDS): WeaponSpec {
  return botGun(WEAPONS[roster[Math.floor(random() * roster.length)]], skill)
}

// A gun as a bot of `skill` fires it (a bot taking an online seat back gets its gun this way).
export const botGun = (spec: WeaponSpec, skill: Skill): WeaponSpec => ({ ...spec, damage: spec.damage * skill.damage, spread: Math.max(spec.spread, skill.spread) })

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

const between = (range: number[], random: () => number) => range[0] + random() * (range[1] - range[0])
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z)
const goal = new THREE.Vector3()
const circling = new THREE.Vector3() // the next point of its circle round the target
const weaving = new THREE.Vector3() // where it heads fighting in tight streets: its distance kept, off to one side
const lead = new THREE.Vector3() // where the target will be when the shot gets there
const aimAt = new THREE.Vector3()
const from = new THREE.Vector3()
const along = new THREE.Vector3()
const ray = new RAPIER.Ray(from, along)

// Clear fraction (0..1) of a horizontal feeler from the bot's nose: walls, junk, other cars.
function feel(world: RAPIER.World, bot: Agent, heading: number, angle: number, reach: number) {
  from.set(bot.position.x + Math.sin(heading) * 2.3, bot.position.y + 0.7, bot.position.z + Math.cos(heading) * 2.3)
  along.set(Math.sin(heading + angle), 0, Math.cos(heading + angle))
  const hit = world.castRay(ray, reach, true, undefined, undefined, undefined, bot.car.body)
  return hit ? hit.timeOfImpact / reach : 1
}

// Nothing solid between the bot's gun and the target's body.
function canSee(world: RAPIER.World, bot: Agent, target: Agent) {
  from.copy(bot.position).y += 2.4
  along.copy(target.position).y += 1
  along.sub(from)
  const distance = along.length()
  along.divideScalar(distance)
  const hit = world.castRay(ray, distance, true, undefined, undefined, undefined, bot.car.body)
  return !hit || hit.collider.parent()?.handle === target.car.body.handle
}

// No live teammate within mateGap of the line from the bot to where its gun
// is laid, nor — firing rockets — inside the blast round that point. Flat
// distances: every machine drives on the ground.
export function clearOfMates(bot: Agent, everyone: readonly Agent[]) {
  const aim = bot.control.aim
  const blast = bot.weapon.spec.rocket?.blast ?? 0
  const dx = aim.x - bot.position.x
  const dz = aim.z - bot.position.z
  const length = dx * dx + dz * dz || 1
  for (const mate of everyone) {
    if (mate === bot || !mate.alive || mate.team !== bot.team) continue
    if (blast && flat(mate.position, aim) < blast) return false
    const along = THREE.MathUtils.clamp(((mate.position.x - bot.position.x) * dx + (mate.position.z - bot.position.z) * dz) / length, 0, 1)
    if (Math.hypot(bot.position.x + dx * along - mate.position.x, bot.position.z + dz * along - mate.position.z) < AI.mateGap) return false
  }
  return true
}

// Open road from a to b: nothing static across a car's width, kerbs
// included, so routes keep to the streets. Three rays at wheel height,
// centre and both sides; from on top of a sidewalk nothing counts as open.
function open(world: RAPIER.World, a: THREE.Vector3, b: THREE.Vector3) {
  const distance = flat(a, b)
  if (distance < 0.5) return true
  const ux = (b.x - a.x) / distance
  const uz = (b.z - a.z) / distance
  for (const side of [0, -1.1, 1.1]) {
    from.set(a.x - uz * side, 0.08, a.z + ux * side)
    along.set(ux, 0, uz)
    if (world.castRay(ray, distance, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)) return false
  }
  return true
}

// Out of `watcher`'s sight: something static between its gun and a car at `at`.
function hiddenFrom(world: RAPIER.World, watcher: THREE.Vector3, at: THREE.Vector3) {
  from.set(watcher.x, watcher.y + 2.4, watcher.z)
  along.set(at.x, 1.2, at.z).sub(from)
  const distance = along.length()
  along.divideScalar(distance)
  return !!world.castRay(ray, distance, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
}

// A hideout for the bot: the nearest point round it (AI.hideouts, twelve ways)
// with open road straight to it that `target` can't see and that isn't on top
// of it, written to `out`; false when there's none.
const spot = new THREE.Vector3()
function pickHideout(world: RAPIER.World, bot: Agent, target: Agent, out: THREE.Vector3) {
  for (const radius of AI.hideouts) {
    for (let k = 0; k < 12; k++) {
      const angle = (k / 12) * Math.PI * 2
      spot.set(bot.position.x + Math.sin(angle) * radius, 0, bot.position.z + Math.cos(angle) * radius)
      if (flat(spot, target.position) > 12 && open(world, bot.position, spot) && hiddenFrom(world, target.position, spot)) {
        out.copy(spot)
        return true
      }
    }
  }
  return false
}

// The nearest few nodes to `at`, in plain view of it (the nearest at all if none is).
function nodesInView(world: RAPIER.World, nav: NavGraph, at: THREE.Vector3) {
  const order = nav.nodes.map((_, i) => i).sort((a, b) => flat(nav.nodes[a], at) - flat(nav.nodes[b], at))
  const seen = order.slice(0, 6).filter((i) => open(world, at, nav.nodes[i]))
  return seen.length ? seen : order.slice(0, 1)
}

// Every node's driving distance to node `end` and its next hop there
// (Dijkstra from the end; the graphs are small). -1: the end, or cut off.
export function routesTo(nav: NavGraph, end: number) {
  const count = nav.nodes.length
  const cost = new Float64Array(count).fill(Infinity)
  const next = new Int32Array(count).fill(-1)
  const done = new Uint8Array(count)
  cost[end] = 0
  for (;;) {
    let u = -1
    for (let i = 0; i < count; i++) if (!done[i] && cost[i] < Infinity && (u < 0 || cost[i] < cost[u])) u = i
    if (u < 0) break
    done[u] = 1
    for (const v of nav.links[u]) {
      const through = cost[u] + flat(nav.nodes[u], nav.nodes[v])
      if (through < cost[v]) {
        cost[v] = through
        next[v] = u
      }
    }
  }
  return { cost, next }
}

// Sets `goal` on the way to `destination`: a point a little ahead along the
// current leg of the route, a lane right of it (pure pursuit), so the bot
// keeps to its side of the street instead of cutting across toward the next
// stop. Replans now and then; returns the speed to hold to take the bend at
// that stop.
function travel(bot: Agent, brain: Brain, world: RAPIER.World, nav: NavGraph, destination: THREE.Vector3, dt: number) {
  brain.replan -= dt
  if (brain.replan <= 0) {
    brain.replan = AI.replan
    const end = nodesInView(world, nav, destination)[0]
    const { cost, next } = routesTo(nav, end)
    // join the graph wherever makes the whole trip shortest, not just at the nearest node
    let start = -1
    for (const i of nodesInView(world, nav, bot.position)) {
      if (start < 0 || flat(bot.position, nav.nodes[i]) + cost[i] < flat(bot.position, nav.nodes[start]) + cost[start]) start = i
    }
    brain.route = []
    for (let v = start; v >= 0 && cost[v] < Infinity; v = next[v]) brain.route.push(v)
    if (brain.route.length > 1 && open(world, bot.position, nav.nodes[brain.route[1]])) brain.route.shift() // already past the first stop
    brain.from.copy(bot.position)
  }
  while (brain.route.length && flat(bot.position, nav.nodes[brain.route[0]]) < AI.arrive) brain.from.copy(nav.nodes[brain.route.shift()!])
  if (!brain.route.length) {
    goal.copy(destination)
    return Infinity
  }
  const a = brain.from
  const b = nav.nodes[brain.route[0]]
  const length = Math.max(flat(a, b), 0.01)
  const along = ((bot.position.x - a.x) * (b.x - a.x) + (bot.position.z - a.z) * (b.z - a.z)) / (length * length)
  const t = Math.min(1, Math.max(0, along) + (AI.lookahead[0] + Math.abs(bot.speed) * AI.lookahead[1]) / length)
  const lane = length > 15 ? AI.lane / length : 0 // keep right, so oncoming bots pass
  goal.set(a.x + (b.x - a.x) * t - (b.z - a.z) * lane, 0, a.z + (b.z - a.z) * t + (b.x - a.x) * lane)
  const [gentle, sharp, square] = AI.cornering
  let corner = square // the last stop: arrive ready to go anywhere next
  if (brain.route.length > 1) {
    const after = nav.nodes[brain.route[1]]
    const bend = Math.abs(wrap(Math.atan2(after.x - b.x, after.z - b.z) - Math.atan2(b.x - bot.position.x, b.z - bot.position.z)))
    corner = bend > 1.2 ? square : bend > 0.5 ? sharp : gentle
  }
  return Math.sqrt(corner * corner + 2 * AI.braking * Math.max(0, flat(bot.position, b) - AI.arrive))
}

// Whoever shot it recently, else the nearest live rival within detection
// range — nearest as the plan sees it, when there is one.
export function pickTarget(bot: Agent, brain: Brain, everyone: readonly Agent[], plan?: Plan) {
  const attacker = brain.attacker
  if (attacker?.alive && brain.grudge > 0 && (!plan || plan.value(bot, attacker, 0) < Infinity)) return attacker
  let best: Agent | null = null
  let nearest = AI.detectRange
  for (const rival of everyone) {
    if (!rival.alive || rival.team === bot.team) continue
    const distance = plan ? plan.value(bot, rival, flat(rival.position, bot.position)) : flat(rival.position, bot.position)
    if (distance < nearest) {
      nearest = distance
      best = rival
    }
  }
  return best
}

const errandAt = new THREE.Vector3()
const toAim = new THREE.Vector3()
const toLead = new THREE.Vector3()

// Where to lay the gun on `target`: its hull, moved on by as much as the
// skill leads of where it goes while the aim catches up and, for a rocket,
// while the rocket flies (worked out twice, the second time from there).
export function leadTarget(bot: Agent, target: Agent, skill: Skill, out: THREE.Vector3) {
  const rocket = bot.weapon.spec.rocket
  out.copy(target.position)
  for (let pass = 0; pass < 2; pass++) {
    const seconds = 1 / skill.aimRate + (rocket ? out.distanceTo(bot.position) / rocket.speed : 0)
    out.copy(target.position).addScaledVector(target.velocity, Math.min(seconds, 2) * skill.lead)
  }
  return out.setY(out.y + 1.1)
}

// Writes the bot's controls for this physics step. `random`: the match's
// seeded stream (0..1), so a match replays the same from the same seed.
export function think(bot: Agent, everyone: readonly Agent[], world: RAPIER.World, nav: NavGraph, dt: number, random: () => number, plan?: Plan) {
  const brain = bot.brain!
  const { skill } = brain
  const control = bot.control
  const q = bot.rotation
  const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y))
  const style = bot.weapon.spec.rocket ? TACTICS.rocket : TACTICS.gun
  const hurt = bot.health < bot.maxHealth * AI.hurt

  brain.grudge -= dt
  brain.retarget -= dt
  brain.jink -= dt
  brain.change -= dt
  if (brain.retarget <= 0 || !brain.target?.alive) {
    const target = pickTarget(bot, brain, everyone, plan)
    if (target !== brain.target) {
      brain.replan = 0
      brain.canSee = false
      brain.radius = between(style.circle, random)
    }
    brain.target = target
    brain.retarget = 0.5
  }
  // Now and then, on a whim, it circles or weaves the other way: no two passes alike.
  if (brain.change <= 0) {
    brain.change = between([2, 5], random)
    if (random() < 0.4) brain.orbit = -brain.orbit
    if (random() < 0.6) brain.side = -brain.side
  }
  const target = brain.target
  const distance = target ? flat(target.position, bot.position) : Infinity
  const keep = style.keep * (hurt ? 1.5 : 1) // hurt, it stays further off
  let limit = Infinity // speed to hold
  let backOff = false // too close to keep its distance: reverse away, still firing

  if (target) {
    const radius = brain.radius * (hurt ? 1.3 : 1)
    const around = Math.atan2(bot.position.x - target.position.x, bot.position.z - target.position.z) + brain.orbit * 0.9
    circling.set(target.position.x + Math.sin(around) * radius, 0, target.position.z + Math.cos(around) * radius)
    // In tight streets: toward (or away from) the target to hold its distance, off to one side of the line of fire.
    const ux = (target.position.x - bot.position.x) / Math.max(distance, 0.01)
    const uz = (target.position.z - bot.position.z) / Math.max(distance, 0.01)
    const along = THREE.MathUtils.clamp(distance - keep, -10, 25)
    const swing = skill.weave * brain.side * (brain.jink > 0 || hurt ? 1.6 : 1)
    weaving.set(bot.position.x + ux * along - uz * swing, 0, bot.position.z + uz * along + ux * swing)
  }
  // An errand from the plan: taken when there's no one to hunt, or at once if urgent.
  const errand = plan?.errand(bot) ?? null
  const urgent = !!errand?.urgent
  if (errand) {
    errandAt.set(errand.x, 0, errand.z)
    if (flat(errandAt, brain.errand) > 1) brain.replan = 0 // somewhere new: route there now
    brain.errand.copy(errandAt)
  }
  // Hiding: in a fight, hurt or reloading, it may take cover; with a rival
  // coming its way unseen it may lie in wait for it — at the nearest spot round it
  // the rival can't see. Out again when the time's up or the target's gone;
  // lying in wait, the moment the rival shows (it opens up at once: the
  // surprise); taking cover, if the rival can see it there after all.
  brain.hide -= dt
  brain.decide -= dt
  const atHideout = flat(brain.hideout, bot.position) < 3
  if (brain.hide > 0 && (!target || urgent || (brain.canSee && distance < style.fire && (brain.lurking || atHideout)))) {
    if (brain.lurking && brain.canSee) brain.burst = Math.max(brain.burst, between(skill.burst, random))
    brain.hide = 0
    brain.replan = 0
  }
  if (brain.hide <= 0 && brain.decide <= 0 && target && !urgent) {
    brain.decide = 1
    const reloading = bot.weapon.reload > 0
    const closing = target.velocity.x * (bot.position.x - target.position.x) + target.velocity.z * (bot.position.z - target.position.z) > 4 * distance // coming at over 4 m/s
    const cover = brain.canSee && (hurt || reloading) && random() < skill.hide
    const lurk = !cover && !brain.canSee && closing && distance > AI.lurk[0] && distance < AI.lurk[1] && random() < skill.ambush
    if ((cover || lurk) && pickHideout(world, bot, target, brain.hideout)) {
      brain.lurking = lurk
      brain.hide = cover ? (reloading ? bot.weapon.reload + 0.4 : between([3, 5], random)) : between([5, 9], random)
      brain.replan = 0
    }
  }
  let hold = false // waiting in its hideout
  if (brain.hide > 0) {
    goal.copy(atHideout ? target!.position : brain.hideout) // open road to it: straight there
    hold = atHideout
  } else if (target && brain.canSee && brain.direct && !urgent && distance < style.engage) {
    // circling where there's room; hemmed in by buildings, it weaves at its range instead of parking
    goal.copy(brain.room && brain.jink <= 0 ? circling : weaving)
    backOff = !brain.room && distance < keep * 0.6
    brain.replan = 0
  } else if (target && brain.canSee && brain.direct && !urgent) {
    goal.copy(weaving) // closing in, weaving
    brain.replan = 0
  } else if (errand && (urgent || !target)) {
    limit = travel(bot, brain, world, nav, errandAt, dt)
  } else if (target) {
    limit = travel(bot, brain, world, nav, target.position, dt)
  } else {
    const roam = nav.nodes[brain.roam % nav.nodes.length]
    if (flat(roam, bot.position) < AI.arrive) {
      brain.roam = Math.floor(random() * nav.nodes.length)
      brain.replan = 0
    }
    limit = travel(bot, brain, world, nav, roam, dt)
  }

  const error = wrap(Math.atan2(goal.x - bot.position.x, goal.z - bot.position.z) - heading)
  let steer = THREE.MathUtils.clamp(error * 2.2, -1, 1)
  let throttle = Math.abs(error) > 1.8 ? 0.45 : 1
  limit = Math.min(limit, Math.abs(error) > 1.2 ? AI.cornering[2] : Math.abs(error) > 0.6 ? AI.cornering[1] : Infinity) // mid-turn: no flooring it wide
  if (bot.speed > limit) throttle = -1 // brakes (driveCar brakes on reverse throttle while rolling forward)
  else if (bot.speed > limit * 0.9) throttle = 0
  if (hold) throttle = bot.speed > 0.5 ? -1 : 0
  // turn round in a few moves: back up with the wheels turned the other way, if there's room behind;
  // or too close to the target in a tight street: back away from it, swinging the tail to its weave side
  const roomBehind = (Math.abs(error) > 2.2 && bot.speed < 4) || backOff ? feel(world, bot, heading + Math.PI, 0, 5) > 0.8 : false
  const behind = roomBehind && Math.abs(error) > 2.2 && bot.speed < 4
  const reversing = behind || (roomBehind && backOff)
  if (behind) {
    throttle = -1
    steer = -Math.sign(error)
  } else if (reversing) {
    throttle = -1
    steer = brain.side
  }

  // Feelers steer around walls and junk; a blocked nose turns toward open space.
  const reach = 5 + Math.abs(bot.speed) * 0.5
  const left = feel(world, bot, heading, 0.45, reach)
  const right = feel(world, bot, heading, -0.45, reach)
  const ahead = feel(world, bot, heading, 0, reach * 1.2)
  if (!reversing) {
    steer += (left - right) * 1.5
    if (ahead < 0.6) {
      throttle = Math.min(throttle, 0.5)
      steer += (left >= right ? 1 : -1) * (1 - ahead) * 2
    }
  }
  steer = THREE.MathUtils.clamp(steer, -1, 1)

  if (brain.reverse > 0) {
    brain.reverse -= dt
    throttle = -1
    steer = brain.escape
  } else {
    const pressing = throttle > 0.3
    brain.stuck = pressing && Math.abs(bot.speed) < 1 ? brain.stuck + dt : Math.max(0, brain.stuck - dt)
    brain.blocked = pressing && ahead < 0.25 && Math.abs(bot.speed) < 3 ? brain.blocked + dt : 0
    if (brain.stuck > 1.2 || brain.blocked > AI.blocked) {
      // back out, the tail swinging toward whichever side behind is clearer (in reverse
      // the tail goes the way the wheels point); when that's even, the other way from last time
      const tailLeft = feel(world, bot, heading + Math.PI, -0.45, 6)
      const tailRight = feel(world, bot, heading + Math.PI, 0.45, 6)
      brain.escape = Math.abs(tailLeft - tailRight) > 0.15 ? (tailLeft > tailRight ? 1 : -1) : -brain.escape
      brain.reverse = 1.3
      brain.stuck = 0
      brain.blocked = 0
      brain.replan = 0
    }
  }
  control.throttle = throttle
  control.steer = steer
  control.handbrake = false

  // Aim leads the target by as much as the skill manages, with some wobble; fire in bursts when it is in sight.
  if (target) {
    leadTarget(bot, target, skill, lead)
    aimAt.set(lead.x + (random() - 0.5) * skill.scatter, lead.y + (random() - 0.5) * skill.scatter, lead.z + (random() - 0.5) * skill.scatter)
  } else {
    aimAt.set(bot.position.x + Math.sin(heading) * 20, bot.position.y + 1.5, bot.position.z + Math.cos(heading) * 20)
  }
  control.aim.lerp(aimAt, 1 - Math.exp(-skill.aimRate * dt))

  brain.sight -= dt
  if (brain.sight <= 0) {
    brain.sight = 0.2
    brain.canSee = !!target && distance < style.fire && canSee(world, bot, target)
    brain.clear = !plan?.careful || clearOfMates(bot, everyone)
    brain.direct = brain.canSee && open(world, bot.position, target!.position)
    brain.room = brain.direct && open(world, bot.position, circling)
    if (brain.direct && !brain.room) brain.orbit = -brain.orbit // blocked that way round: try the other next time
    if (brain.direct && !open(world, bot.position, weaving)) brain.side = -brain.side // a wall on that side: weave the other way
  }
  if (brain.burst > 0) {
    brain.burst -= dt
    if (brain.burst <= 0) brain.burst = -between(skill.pause, random)
  } else {
    brain.burst += dt
    if (brain.burst >= 0) brain.burst = brain.canSee ? between(skill.burst, random) : -0.3
  }
  let fire = brain.canSee && brain.clear && brain.burst > 0
  // a rocket leaves only with the gun on the lead (or the target on top of it): there are six, slow to reload
  if (fire && target && bot.weapon.spec.rocket && distance > 12) fire = toAim.subVectors(control.aim, bot.position).angleTo(toLead.subVectors(lead, bot.position)) < AI.aligned
  control.fire = fire
}
