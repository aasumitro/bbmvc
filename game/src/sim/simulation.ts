import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { createBrain, provoke, type Brain } from './ai/brain.ts'
import { think } from './ai/think.ts'
import type { Skill } from './difficulty.ts'
import type { Arena, SpawnPoint } from '../content/arenas/arena.ts'
import { armWeapon, castRound, pullTrigger, scatterAim, type Shot, type WeaponState } from './combat.ts'
import type { RocketSpec, WeaponSpec } from '../content/weapons/weapons.ts'
import type { MatchMode } from './matchMode.ts'
import type { Point } from '../shared/math.ts'
import { createRng } from '../shared/rng.ts'
import { createStats, type Stats } from './scoring.ts'
import { createCar, driveCar, forwardSpeed, placeCar, rightIfUpended, wheelsOnGround, type Car, type DriveInput } from './drive.ts'
import { VEHICLES, type VehicleId } from '../content/vehicles/vehicles.ts'

// The match's simulation: every machine in the arena driven, fired and
// fought over fixed steps of Rapier physics, the mode's rules alongside.
// Authoritative and player-agnostic — no meshes, sound, camera, DOM or local
// player. What happens is reported through SimEvents, and whoever watches
// presents it (view.ts in the browser). Controls are plain data that a
// control source writes before each step: the local pilot (pilot.ts), a
// bot's brain (ai/think.ts, run from here), later the network. Its randomness
// (bot aim and bursts, weapon spread, wrecks thrown) comes from the match
// seed, so the same seed and the same controls replay the same match
// (simulation.test.ts).

const WRECKED: DriveInput = { throttle: 0, steer: 0, handbrake: true }
const CRASH_JOLT = 3.5 // m/s of sideways-or-forward speed lost in one step that counts as a hit
const BLAST_SHOVE = 4.5 // m/s a rocket blast adds to a car at its centre
// A car going nowhere — beached on junk or a heap, tipped past ~45°, or driven
// without moving — is stuck: back upright on the nearest free road node by
// itself after `auto` seconds, or once its driver asks (the player's R) after
// `asked`; then not again for `cooldown`. Metres, seconds.
const RECOVER = { crawl: 1.5, auto: 4, asked: 0.8, cooldown: 6, clear: 6 }

interface Control extends DriveInput {
  fire: boolean
  recover: boolean // asks to be put back on the road when stuck
  aim: THREE.Vector3 // world point the gun is laid on
}

export interface Combatant {
  id: number // place in the match's line-up: the player is 0 (the mode rules' participant number)
  name: string
  team: number // the player's is 0; free for all gives everyone their own
  seed: number // hull jitter, and the brain it wakes with
  vehicle: VehicleId
  car: Car
  spawn: SpawnPoint // where it first lined up; a restart brings it back here
  health: number
  maxHealth: number
  alive: boolean
  present: boolean // in play; false: an empty seat (a custom room's) — its body out of the world, never alive, nothing drawn
  deadFor: number // seconds since destroyed
  stats: Stats // kills, deaths and the rest, kept by the mode's rules
  weapon: WeaponState
  control: Control
  brain?: Brain // a bot's: the simulation thinks for it every step
  position: THREE.Vector3 // simulation pose after the latest step
  rotation: THREE.Quaternion
  velocity: THREE.Vector3
  speed: number // forward m/s, negative in reverse
  last: { position: THREE.Vector3; rotation: THREE.Quaternion; velocity: THREE.Vector3 } // one step earlier: interpolation, crash detection
  crashCooldown: number
  stuck: number // seconds going nowhere (see RECOVER)
  recovery: number // seconds until it may be recovered again
}

// Who takes a seat in the line-up, and in what.
export interface Recruit {
  name: string
  team: number
  seed: number
  spawn: SpawnPoint
  vehicle: VehicleId
  weapon: WeaponSpec
  bot: boolean // driven by a brain; otherwise by whoever writes its controls
  skill?: Skill // a bot's, by difficulty (difficulty.ts DIFFICULTIES); normal if unsaid
}

// What the simulation reports as it happens, mid-step, for whoever presents
// it. The vectors are the simulation's own scratch: copy what you keep.
export interface SimEvents {
  fired(c: Combatant, muzzle: THREE.Vector3, heading: THREE.Vector3): void // a round or rocket left the gun
  shot(c: Combatant, muzzle: THREE.Vector3, shot: Shot, victim: Combatant | undefined): void // where a round went, and what it struck
  rocket(from: THREE.Vector3, to: THREE.Vector3): void // a rocket's flight this step
  burst(at: THREE.Vector3): void // a rocket went off
  hurt(victim: Combatant, attacker: Combatant): void // hull lost
  wrecked(victim: Combatant, attacker: Combatant): void
  crashed(c: Combatant, x: number, z: number, force: number): void // slammed into something, shoved along (x, z); force 0..1
  reloading(c: Combatant, started: boolean): void // the magazine ran dry (started) or is full again
  respawned(c: Combatant): void // whole again at a start: a respawn or a restart
  recovered(c: Combatant): void // stuck, put back on the road
}

interface Rocket {
  shooter: Combatant
  spec: RocketSpec
  position: THREE.Vector3
  direction: THREE.Vector3 // unit
  travelled: number // metres
}

function readPose(c: Combatant) {
  c.car.body.translation(c.position)
  c.car.body.rotation(c.rotation)
  c.car.body.linvel(c.velocity)
  c.speed = forwardSpeed(c.car)
}

// Back on its wheels at `spawn`, whole: hull, weapon, controls, a fresh brain.
function reset(c: Combatant, spawn = c.spawn) {
  placeCar(c.car, spawn.position, spawn.heading)
  readPose(c)
  c.last.position.copy(c.position)
  c.last.rotation.copy(c.rotation)
  c.last.velocity.set(0, 0, 0)
  c.speed = 0
  c.health = c.maxHealth
  c.alive = true
  c.deadFor = 0
  c.weapon = armWeapon(c.weapon.spec)
  Object.assign(c.control, { throttle: 0, steer: 0, handbrake: false, fire: false, recover: false })
  c.stuck = 0
  c.recovery = 0
  c.control.aim.set(Math.sin(spawn.heading) * 30, 1.5, Math.cos(spawn.heading) * 30).add(c.position)
  if (c.brain) c.brain = createBrain(c.seed, c.brain.skill)
}

// A machine in the world, on its spawn. `id` is its seat in the line-up.
export function enlist(world: RAPIER.World, id: number, { name, team, seed, spawn, vehicle, weapon, bot, skill }: Recruit): Combatant {
  const spec = VEHICLES[vehicle]
  const c: Combatant = {
    id,
    name,
    team,
    seed,
    vehicle,
    car: createCar(world, spec.handling, spec.chassis),
    spawn,
    health: spec.armour,
    maxHealth: spec.armour,
    alive: true,
    present: true,
    deadFor: 0,
    stats: createStats(),
    weapon: armWeapon(weapon),
    control: { throttle: 0, steer: 0, handbrake: false, fire: false, recover: false, aim: new THREE.Vector3() },
    position: new THREE.Vector3(),
    rotation: new THREE.Quaternion(),
    velocity: new THREE.Vector3(),
    speed: 0,
    last: { position: new THREE.Vector3(), rotation: new THREE.Quaternion(), velocity: new THREE.Vector3() },
    crashCooldown: 0,
    stuck: 0,
    recovery: 0,
  }
  reset(c)
  if (bot) c.brain = createBrain(seed, skill)
  return c
}

export interface SimulationOptions {
  world: RAPIER.World
  arena: Arena
  combatants: readonly Combatant[]
  mode: MatchMode
  events: SimEvents
  seed: number // the match's
  // Optional (the game server's lag compensation): casts machine `c`'s
  // hitscan round itself, from `muzzle` into `shot`, drawing its spread from
  // `random` as castRound does; false leaves the round to the present-time
  // cast. Unset, every round is cast in the present.
  castRound?: (c: Combatant, muzzle: THREE.Vector3, shot: Shot, random: () => number) => boolean
}

// The simulation's own stream, apart from the one the mode's rules draw from the same seed.
const stream = (seed: number) => createRng(seed ^ 0x9e3779b9)

// Which machine a collider belongs to (a ray cast's hit): undefined for the
// arena. Looked up as the machines stand now: a seat's body changes with its
// vehicle (changeVehicle).
export function bodyOwner(combatants: readonly Combatant[]) {
  return (collider: RAPIER.Collider) => {
    const body = collider.parent()
    return body ? combatants.find((c) => c.car.body.handle === body.handle) : undefined
  }
}

// The machine in a seat becomes `vehicle` where it stands (a person takes the
// seat in the one they chose; a bot takes it back in its own): the old body
// and its vehicle controller leave the world, the new vehicle's take their
// place, level, facing the way the old one faced, at rest, in or out of play
// and kinematic or not as the old one was; its hull keeps its share. Between
// steps only. False when it already is that vehicle: nothing changes.
export function changeVehicle(world: RAPIER.World, c: Combatant, vehicle: VehicleId) {
  const spec = VEHICLES[vehicle] // read first: with one vehicle in the registry, the compiler narrows `vehicle` away below
  if (c.vehicle === vehicle) return false
  const old = c.car.body
  const kinematic = old.isKinematic()
  const enabled = old.isEnabled()
  const q = c.rotation
  const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y))
  world.removeVehicleController(c.car.controller)
  world.removeRigidBody(old)
  c.car = createCar(world, spec.handling, spec.chassis)
  if (kinematic) c.car.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
  placeCar(c.car, c.position, heading)
  if (!enabled) c.car.body.setEnabled(false)
  readPose(c)
  c.last.position.copy(c.position)
  c.last.rotation.copy(c.rotation)
  c.last.velocity.set(0, 0, 0)
  const share = c.maxHealth > 0 ? c.health / c.maxHealth : 1
  c.vehicle = vehicle
  c.maxHealth = spec.armour
  c.health = share * spec.armour
  return true
}

export function createSimulation({ world, arena, combatants, mode, events, seed, castRound: castAt }: SimulationOptions) {
  const { rules } = mode
  let random = stream(seed)
  const hostile = (a: Combatant, b: Combatant) => a.team !== b.team
  const combatantOf = bodyOwner(combatants)

  // One fixed step: bots think, every car drives and fires, the physics
  // steps, poses are read back (crashes found), rockets fly; then, while the
  // match is `live`, the rules tick and anyone due back in respawns.
  function step(dt: number, live: boolean) {
    const held = rules.phase === 'preMatch' // lined up on the grid: nobody moves or shoots yet
    for (const c of combatants) if (c.brain && c.alive && live && !held) think(c, combatants, world, arena.nav, dt, random, mode.plan)
    for (const c of combatants) {
      if (!c.present) continue
      c.last.position.copy(c.position)
      c.last.rotation.copy(c.rotation)
      c.last.velocity.copy(c.velocity)
      driveCar(c.car, c.alive && !held ? c.control : WRECKED, dt, mode.speedFactor(c.id))
      if (c.alive) {
        rightIfUpended(c.car, dt)
        const reloading = c.weapon.reload > 0
        if (pullTrigger(c.weapon, c.control.fire && !held, dt)) fire(c)
        if (reloading !== c.weapon.reload > 0) events.reloading(c, !reloading)
      } else {
        c.deadFor += dt
      }
    }
    world.step()
    for (const c of combatants) {
      if (!c.present) continue
      readPose(c)
      c.crashCooldown -= dt
      const joltX = c.velocity.x - c.last.velocity.x
      const joltZ = c.velocity.z - c.last.velocity.z
      const jolt = Math.hypot(joltX, joltZ)
      // A hard hit on anything solid: the car was shoved along (x, z), so the struck side faces the other way.
      if (c.alive && jolt > CRASH_JOLT && c.crashCooldown <= 0) {
        c.crashCooldown = 0.3
        events.crashed(c, joltX / jolt, joltZ / jolt, THREE.MathUtils.clamp((jolt - CRASH_JOLT) / 10, 0.15, 1))
      }
      if (c.alive && !held) watchStuck(c, dt)
    }
    flyRockets(dt)
    if (!live) return
    rules.tick(dt)
    for (const c of combatants) if (rules.respawnDue(c.id)) respawn(c)
  }

  // --- stuck -------------------------------------------------------------

  function watchStuck(c: Combatant, dt: number) {
    c.recovery -= dt
    const upright = 1 - 2 * (c.rotation.x * c.rotation.x + c.rotation.z * c.rotation.z) // the roof's up component
    const going = Math.abs(c.control.throttle) > 0.3
    const stuck = c.velocity.length() < RECOVER.crawl && (wheelsOnGround(c.car) < 3 || upright < 0.7 || going)
    c.stuck = stuck ? c.stuck + dt : 0
    if (c.recovery <= 0 && (c.stuck > RECOVER.auto || (c.control.recover && c.stuck > RECOVER.asked))) recover(c)
  }

  // Upright on the nearest road node no other car is on, facing the way it faced.
  function recover(c: Combatant) {
    let best = -1
    let nearest = Infinity
    arena.nav.nodes.forEach((node, i) => {
      const distance = (node.x - c.position.x) ** 2 + (node.z - c.position.z) ** 2
      if (distance >= nearest) return
      if (combatants.some((o) => o !== c && o.alive && (o.position.x - node.x) ** 2 + (o.position.z - node.z) ** 2 < RECOVER.clear ** 2)) return
      best = i
      nearest = distance
    })
    if (best < 0) return
    const q = c.rotation
    placeCar(c.car, arena.nav.nodes[best], Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)))
    readPose(c)
    c.last.position.copy(c.position)
    c.last.rotation.copy(c.rotation)
    c.last.velocity.set(0, 0, 0)
    c.stuck = 0
    c.recovery = RECOVER.cooldown
    if (c.brain) Object.assign(c.brain, { route: [], replan: 0, reverse: 0, stuck: 0, blocked: 0 })
    events.recovered(c)
  }

  // --- combat ------------------------------------------------------------

  const shot: Shot = { point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null }
  const muzzle = new THREE.Vector3()
  const heading = new THREE.Vector3()

  function fire(c: Combatant) {
    mode.fired(c.id)
    const { mount, barrel } = VEHICLES[c.vehicle].turret
    muzzle.set(mount[0], mount[1], mount[2]).applyQuaternion(c.rotation).add(c.position)
    heading.subVectors(c.control.aim, muzzle).normalize()
    muzzle.addScaledVector(heading, barrel)
    events.fired(c, muzzle, heading)
    const { spec } = c.weapon
    switch (spec.kind) {
      case 'rocket':
        return launch(c, spec)
      case 'gun': {
        if (!castAt?.(c, muzzle, shot, random)) castRound(world, spec, muzzle, c.control.aim, c.car.body, shot, random)
        const victim = shot.collider ? combatantOf(shot.collider) : undefined
        events.shot(c, muzzle, shot, victim)
        if (victim) damage(victim, spec.damage, c)
        return
      }
      default:
        return spec satisfies never
    }
  }

  // Rockets fly straight at their speed; each step sweeps a ray along the
  // stretch it covers, so nothing thin is skipped, and it bursts on whatever
  // it meets or at the end of its range.
  const rockets: Rocket[] = []
  const flight = new RAPIER.Ray(new THREE.Vector3(), new THREE.Vector3())
  const ahead = new THREE.Vector3()

  function launch(c: Combatant, spec: RocketSpec) {
    const direction = scatterAim(spec, muzzle, c.control.aim, new THREE.Vector3(), random)
    rockets.push({ shooter: c, spec, position: muzzle.clone(), direction, travelled: 0 })
  }

  function flyRockets(dt: number) {
    for (let i = rockets.length - 1; i >= 0; i--) {
      const rocket = rockets[i]
      const reach = rocket.spec.rocket.speed * dt
      flight.origin = rocket.position
      flight.dir = rocket.direction
      const hit = world.castRay(flight, reach, true, undefined, undefined, undefined, rocket.shooter.car.body)
      ahead.copy(rocket.position).addScaledVector(rocket.direction, hit ? hit.timeOfImpact : reach)
      events.rocket(rocket.position, ahead)
      rocket.position.copy(ahead)
      rocket.travelled += reach
      if (hit || rocket.travelled >= rocket.spec.range) {
        rockets.splice(i, 1)
        detonate(rocket, hit ? combatantOf(hit.collider) : undefined)
      }
    }
  }

  // Damage and shove fall off linearly to nothing at the blast edge; a direct
  // hit deals the full warhead. Every car is shoved; the rules say who is hurt.
  const shove = new THREE.Vector3()
  function detonate(rocket: Rocket, struck?: Combatant) {
    const { blast } = rocket.spec.rocket
    events.burst(rocket.position)
    for (const c of combatants) {
      if (!c.alive) continue
      shove.copy(c.position).y += 0.9 // hull centre
      shove.sub(rocket.position)
      const falloff = c === struck ? 1 : 1 - shove.length() / blast
      if (falloff <= 0) continue
      shove.normalize()
      shove.y = Math.max(shove.y, 0.3) // lifts as well as pushes, so the car rocks over
      c.car.body.applyImpulse(shove.normalize().multiplyScalar(c.car.handling.mass * BLAST_SHOVE * falloff), true)
      damage(c, rocket.spec.damage * falloff, rocket.shooter)
    }
  }

  // Every hit goes to the rules, the one place that says whether it hurts:
  // never the shooter's own machine, a teammate only if the mode allows it.
  function damage(victim: Combatant, amount: number, attacker: Combatant) {
    if (!victim.alive) return
    const dealt = rules.damage(attacker.id, victim.id, amount) // protection (boosts, armor); wrecks hurt no one; nothing outside play
    if (dealt <= 0) return
    victim.health = Math.max(0, victim.health - dealt)
    events.hurt(victim, attacker)
    if (victim.brain && hostile(victim, attacker)) provoke(victim.brain, attacker) // a teammate's stray round never turns a bot
    if (victim.health === 0) destroy(victim, attacker)
  }

  // The fireball throws the wreck up and over; the rules score it.
  function destroy(victim: Combatant, attacker: Combatant) {
    victim.alive = false
    victim.deadFor = 0
    victim.control.fire = false
    const spin = () => random() - 0.5
    victim.car.body.applyImpulse({ x: spin() * 3000, y: victim.car.handling.mass * 6.5, z: spin() * 3000 }, true)
    victim.car.body.applyTorqueImpulse({ x: spin() * 5000, y: spin() * 2500, z: spin() * 5000 }, true)
    rules.kill(victim.id, attacker.id) // scores it all, schedules the respawn, may settle overtime
    events.wrecked(victim, attacker)
  }

  // --- respawn -------------------------------------------------------------

  // Back in at the start the rules pick, once they agree (an empty seat just
  // taken comes back into the world there).
  function respawn(c: Combatant) {
    const start = rules.pickSpawn(c.id, sees)
    if (!rules.respawned(c.id, start)) return
    reset(c, mode.starts[start])
    if (!c.present) intoPlay(c)
    events.respawned(c)
  }

  // Into play, or out of it: the body joins the world or leaves it (a
  // disabled body's colliders leave too, so rays, blasts and cars pass
  // where it stood).
  function intoPlay(c: Combatant) {
    c.present = true
    c.car.body.setEnabled(true)
  }
  function outOfPlay(c: Combatant) {
    c.present = false
    c.alive = false
    c.deadFor = 0
    Object.assign(c.control, { throttle: 0, steer: 0, handbrake: false, fire: false, recover: false })
    c.car.body.setEnabled(false)
  }

  // A clear line from a rival's gun to a car at `at`; only the static world blocks it.
  const sightLine = new RAPIER.Ray(new THREE.Vector3(), new THREE.Vector3())
  const eye = new THREE.Vector3()
  const toStart = new THREE.Vector3()
  function sees(rival: number, at: Point) {
    eye.copy(combatants[rival].position).y += 2.4
    toStart.set(at.x, 1.2, at.z).sub(eye)
    const distance = toStart.length()
    sightLine.origin = eye
    sightLine.dir = toStart.divideScalar(distance)
    return !world.castRay(sightLine, distance, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
  }

  return {
    step,
    combatantOf,
    // Everyone back where they lined up, whole, the empty seats' machines
    // too (as their rules start over); nothing left in the air; randomness
    // from the new `seed`.
    restart(seed: number) {
      random = stream(seed)
      rockets.length = 0
      for (const c of combatants) {
        reset(c)
        if (!c.present) intoPlay(c)
        events.respawned(c)
      }
    },
    // A seat nobody holds (a custom room's): its machine out of play where
    // it stands — no wreck, no kill — until someone takes the seat.
    vacate(c: Combatant) {
      if (c.present && rules.leave(c.id)) outOfPlay(c)
    },
    // Someone takes the empty seat: back in on the next step, at the start
    // the rules pick, protected (the respawn brings the body back).
    occupy(c: Combatant) {
      if (!c.present) rules.enter(c.id)
    },
    // The match is over: the bots stand down where they are.
    standDown() {
      for (const c of combatants) if (c.brain) Object.assign(c.control, { throttle: 0, steer: 0, handbrake: true, fire: false })
    },
  }
}
