// Tests for the simulation with both real modes, headless: no scene,
// sound, DOM or local player — the code the browser runs, on a flat test
// yard, controls written by hand. Covers the pre-match hold, hitscan and
// rocket damage, wrecks and scoring, respawns, the result, the restart,
// replaying a bots-only match from its seed, whole Classic matches pinned by
// hash, and the content registries' numbers.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Arena, SpawnPoint } from '../content/arenas/arena.ts'
import { WEAPONS, type MineSpec } from '../content/weapons/weapons.ts'
import { createFfaMode, lineUp as ffaLineUp } from '../modes/ffa/mode.ts'
import { classic, type MatchSettings } from '../modes/matchSettings.ts'
import type { Feed } from './matchMode.ts'
import { createWorld, initPhysics, PHYSICS_STEP } from './physics.ts'
import { changeVehicle, createSimulation, enlist, type Combatant, type SimulationOptions } from './simulation.ts'
import { createTdmMode, lineUp as tdmLineUp } from '../modes/tdm/mode.ts'
import { drivePerformance, placeCar } from './drive.ts'
import { armWeapon, locked } from './combat.ts'
import { VEHICLES } from '../content/vehicles/vehicles.ts'

await initPhysics()

// Every check is a test of its own, in order, under its label (the it.each
// at the end); a failed one fails its test, and the rest still run.
const checks: Array<[string, boolean]> = []
const check = (ok: boolean, what: string) => void checks.push([what, ok])

// A flat yard: eight starts on a 100 m circle facing in, a base of four at
// each end, one hot zone, a ring of road nodes.
const start = (x: number, z: number, heading: number): SpawnPoint => ({ position: new THREE.Vector3(x, 0, z), heading })
const ring = (radius: number, count: number) =>
  Array.from({ length: count }, (_, i) => (i / count) * Math.PI * 2).map((a) => [Math.cos(a) * radius, Math.sin(a) * radius] as const)
const arena: Arena = {
  name: 'Test yard',
  root: new THREE.Group(),
  spawns: ring(100, 8).map(([x, z]) => start(x, z, Math.atan2(-x, -z))),
  bases: [[-15, -5, 5, 15].map((x) => start(x, -120, 0)), [-15, -5, 5, 15].map((x) => start(x, 120, Math.PI))],
  zones: [{ name: 'Middle', x: 0, z: 0, radius: 40 }],
  colliders: [],
  nav: { nodes: ring(60, 12).map(([x, z]) => new THREE.Vector3(x, 0, z)), links: Array.from({ length: 12 }, (_, i) => [(i + 11) % 12, (i + 1) % 12]) },
  emitters: [],
  extent: 160,
  mapRange: 78,
  paintMap() {},
  update() {},
}

// A match as the runtime seats it, with what it reports. No bots unless
// asked: the check drives. Classic's settings on the yard unless said.
function setup(
  kind: 'tdm' | 'ffa',
  { seed = 1, bots = false, settings = classic(kind) as MatchSettings, yard = arena, seen = undefined as SimulationOptions['seen'] } = {},
) {
  const arena = yard
  const world = createWorld(arena.colliders)
  const seats = kind === 'tdm' ? tdmLineUp(arena, settings.size) : ffaLineUp(arena, settings.size)
  const combatants = seats.map(({ team, spawn }, id) =>
    enlist(world, id, { name: `car${id}`, team, seed: id + 1, spawn, vehicle: 'razor', weapon: WEAPONS.minigun, bot: bots }),
  )
  const mode = kind === 'tdm' ? createTdmMode(combatants, arena, world, seed, settings) : createFfaMode(combatants, arena, world, seed, settings)
  const heard = {
    fired: 0,
    shot: 0,
    burst: 0,
    hurt: 0,
    struck: [] as number[],
    wrecked: [] as string[],
    respawned: [] as number[],
    laid: [] as number[],
    gone: [] as number[],
  }
  const sim = createSimulation({
    world,
    arena,
    combatants,
    mode,
    seed,
    seen,
    events: {
      fired: () => heard.fired++,
      shot(_c, _muzzle, _shot, victim) {
        heard.shot++
        if (victim) heard.struck.push(victim.id)
      },
      rocket() {},
      burst: () => heard.burst++,
      hurt: () => heard.hurt++,
      wrecked: (victim, attacker) => heard.wrecked.push(`${attacker.id}>${victim.id}`),
      crashed() {},
      reloading() {},
      respawned: (c) => heard.respawned.push(c.id),
      recovered() {},
      laid: (id) => heard.laid.push(id),
      gone: (id) => heard.gone.push(id),
    },
  })
  const lines: string[] = []
  const feed: Feed = {
    me: 0,
    name: (id) => `car${id}`,
    kill: ({ killer, victim }) => lines.push(`kill ${killer}>${victim}`),
    teamKill: (killer, victim) => lines.push(`teamkill ${killer}>${victim}`),
    death: (victim) => lines.push(`death ${victim}`),
    phase: (phase) => lines.push(`phase ${phase}`),
    news: (text) => lines.push(text),
    callout() {},
    pickup() {},
  }
  // Fixed steps for `seconds` of match time (or until `done`), the events reported every step, as the match does.
  const run = (seconds: number, done = () => false) => {
    for (let k = Math.round(seconds / PHYSICS_STEP); k > 0 && !done(); k--) {
      sim.step(PHYSICS_STEP, true)
      mode.report(feed)
    }
  }
  return { world, combatants, mode, sim, heard, lines, run }
}

// Parks every car far off except `a` and `b`, 20 m apart on open ground, a's gun on b.
function duel(combatants: readonly Combatant[], a: Combatant, b: Combatant) {
  combatants.forEach((c, i) => placeCar(c.car, { x: 300 + i * 12, y: 0, z: 300 }, 0))
  placeCar(a.car, { x: 0, y: 0, z: 0 }, 0)
  placeCar(b.car, { x: 0, y: 0, z: 20 }, Math.PI)
  a.control.aim.set(0, 1.1, 20)
  a.control.fire = true
}

// --- team deathmatch ------------------------------------------------------------

{
  const m = setup('tdm')
  const [me] = m.combatants
  const enemy = m.combatants[4]
  check(m.combatants.length === 8 && m.combatants.every((c, i) => c.team === (i < 4 ? 0 : 1)), 'four a side, the player leading team 0')
  check(
    m.combatants.every((c) => c.position.distanceTo(c.spawn.position) < 0.5),
    'everyone lined up on their own start',
  )

  // on the grid: throttle and trigger do nothing until GO
  me.control.throttle = 1
  me.control.fire = true
  m.run(1)
  check(me.position.distanceTo(me.spawn.position) < 0.5 && m.heard.fired === 0, 'held on the grid through the countdown')
  m.run(3, () => m.mode.rules.phase !== 'preMatch')
  check(m.mode.rules.phase === 'active' && m.lines.includes('phase active'), 'GO: active, reported')
  me.control.throttle = 0

  duel(m.combatants, me, enemy)
  m.run(10, () => !enemy.alive)
  check(!enemy.alive && enemy.health === 0, 'the minigun wrecks a car in plain view')
  check(m.heard.fired > 20 && m.heard.shot === m.heard.fired && m.heard.hurt > 20, 'every round fired is reported, the hits hurt')
  check(Math.abs(me.stats.damageDealt - 100) < 1e-6 && Math.abs(enemy.stats.damageTaken - 100) < 1e-6, 'the rules record the hull removed')
  check(m.heard.wrecked.join() === '0>4' && m.lines.includes('kill 0>4'), 'the wreck is reported and fed as a kill')
  const tdm = m.mode.kind === 'tdm' ? m.mode.rules : null
  check(tdm?.score[0] === 1 && me.stats.kills === 1 && enemy.stats.deaths === 1, 'a team kill scores for the killer’s team')
  check(m.mode.rules.contenders[4].life === 'pending' && m.mode.outcome() === undefined, 'the victim waits to respawn; the match runs on')

  me.control.fire = false
  m.run(8, () => enemy.alive)
  check(enemy.alive && enemy.health === enemy.maxHealth && m.heard.respawned.includes(4), 'back in after the wait, whole')
  check(
    m.mode.starts.some((s) => s.position.distanceTo(enemy.position) < 0.5),
    'respawned on a start the rules picked',
  )

  // rockets: a direct hit, then the blast; every car near it is shoved
  me.weapon = armWeapon(WEAPONS.rocketPod)
  duel(m.combatants, me, enemy)
  const hull = enemy.health
  m.run(3, () => m.heard.burst > 0)
  check(m.heard.burst === 1 && enemy.health < hull, 'a rocket flies, bursts and damages')

  // the buzzer: more kills takes it
  Object.assign(m.mode.rules, { now: 3 + 600 - 0.2 })
  me.control.fire = false
  m.run(1, () => m.mode.outcome() !== undefined)
  check(m.mode.outcome() === 0, 'team 0 ahead at the buzzer wins')

  m.sim.restart(2)
  m.mode.restart(2)
  check(m.mode.rules.phase === 'preMatch' && m.mode.outcome() === undefined && tdm?.score.join() === '0,0', 'restart: the rules start over')
  check(
    m.combatants.every((c) => c.alive && c.health === c.maxHealth && c.position.distanceTo(c.spawn.position) < 0.5),
    'restart: everyone whole on their start',
  )
  m.world.free()
}

// --- a gun with pellets ----------------------------------------------------------------
// One shot casts a ray a pellet, each its own spread; the pellets that meet
// a machine are one hit on it, their damage summed.

{
  const m = setup('tdm')
  const [me] = m.combatants
  const enemy = m.combatants[4]
  m.run(4, () => m.mode.rules.phase === 'active')
  me.weapon = armWeapon({ ...WEAPONS.minigun, pellets: 8, fireRate: 1 })
  duel(m.combatants, me, enemy)
  me.control.fire = false
  m.run(0.2) // the cars where duel put them, in the physics too
  Object.assign(m.heard, { fired: 0, shot: 0, hurt: 0, struck: [] })
  me.control.fire = true
  m.run(0.5)
  check(
    m.heard.fired === 1 && m.heard.shot === 8 && m.heard.struck.length === 8 && m.heard.struck.every((id) => id === enemy.id),
    `a shot of eight pellets at 20 m: fired once, eight rays, all on the car (${m.heard.fired}, ${m.heard.shot}, ${m.heard.struck.length})`,
  )
  check(
    m.heard.hurt === 1 && Math.abs(enemy.stats.damageTaken - 8 * WEAPONS.minigun.damage) < 1e-6,
    `the eight are one hit, their damage summed (${m.heard.hurt} hurt, ${enemy.stats.damageTaken} taken)`,
  )
}

// --- a beam ---------------------------------------------------------------------------
// Held on a car, a beam pulses ten times a second, each pulse a ray and a hit:
// its damage a second is the pulse's times ten.

{
  const m = setup('tdm')
  const [me] = m.combatants
  const enemy = m.combatants[4]
  m.run(4, () => m.mode.rules.phase === 'active')
  me.weapon = armWeapon({ ...WEAPONS.minigun, kind: 'beam', damage: 3, fireRate: 10, magazine: 40, reloadTime: 2, spread: 0.001 })
  duel(m.combatants, me, enemy)
  me.control.fire = false
  m.run(0.2)
  Object.assign(m.heard, { fired: 0, shot: 0, hurt: 0, struck: [] })
  me.control.fire = true
  m.run(0.99)
  check(
    m.heard.fired === 10 && m.heard.shot === 10 && m.heard.hurt === 10 && Math.abs(enemy.stats.damageTaken - 30) < 1e-6,
    `a beam held on a car for a second: ten pulses, ten hits, 30 dealt (${m.heard.fired}, ${m.heard.hurt}, ${enemy.stats.damageTaken})`,
  )
}

// --- missiles ------------------------------------------------------------------------
// A missile's lock: the hostile its controls name, held in the window round
// the aim for the lock time, gone once it leaves it; never a teammate. Fired locked, a missile
// turns after a car crossing ahead and hits it; fired without, it flies
// straight past.

{
  const m = setup('tdm')
  const [me] = m.combatants
  const enemy = m.combatants[4]
  m.run(4, () => m.mode.rules.phase === 'active')
  me.weapon = armWeapon(WEAPONS.missiles)
  duel(m.combatants, me, enemy)
  me.control.fire = false
  placeCar(enemy.car, { x: 0, y: 0, z: 30 }, Math.PI / 2)
  const crossing = () => {
    placeCar(enemy.car, { x: 0, y: 0, z: 30 }, Math.PI / 2)
    m.run(0.1)
    me.control.aim.set(0, 1.1, 30)
    enemy.car.body.setLinvel({ x: 14, y: 0, z: 0 }, true)
    const hull = enemy.health
    const bursts = m.heard.burst
    me.control.fire = true
    m.run(1 / 60)
    me.control.fire = false
    m.run(2, () => m.heard.burst > bursts)
    enemy.car.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    return hull - enemy.health
  }
  me.control.aim.set(0, 1.1, 30)
  me.control.lock = enemy.id
  m.run(0.5)
  const holding = me.weapon.lock.target === enemy.id && !locked(me.weapon)
  m.run(0.35)
  check(holding && locked(me.weapon), `a missile's lock takes its time in the window: held at 0.5 s, on by 0.85 s (${me.weapon.lock.time.toFixed(2)} s)`)
  const homed = crossing()
  check(homed > 0, `fired locked, a missile turns after a car crossing at 14 m/s 30 m off and hits it (${homed.toFixed(1)} dealt)`)
  me.weapon = armWeapon(WEAPONS.missiles)
  me.control.lock = -1
  enemy.health = enemy.maxHealth
  const straight = crossing()
  check(straight === 0, `fired without a lock, it flies straight past (${straight.toFixed(1)} dealt)`)
  placeCar(enemy.car, { x: 0, y: 0, z: 30 }, Math.PI / 2)
  me.control.aim.set(0, 1.1, 30)
  me.control.lock = enemy.id
  m.run(1)
  const relock = locked(me.weapon)
  me.control.aim.set(30, 1.1, 0)
  m.run(2 / 60)
  check(relock && me.weapon.lock.target === -1 && me.weapon.lock.time === 0, 'the lock is gone the step its target leaves the window')
  const mate = m.combatants[1]
  placeCar(mate.car, { x: 0, y: 0, z: -30 }, 0)
  me.control.aim.set(0, 1.1, -30)
  me.control.lock = mate.id
  m.run(1)
  check(me.weapon.lock.target === -1, 'a teammate in the window is never locked on')
}

// Online, a person's lock is judged where their page drew the target (the
// game server's `seen`, from its rewind): held on a car that was in the
// window as drawn though it has left it since, and not on one in the window
// now that wasn't as drawn.
{
  const drawn = new THREE.Vector3()
  const m = setup('tdm', { seen: (_c, _target, out) => !!out.copy(drawn) })
  const [me] = m.combatants
  const enemy = m.combatants[4]
  m.run(4, () => m.mode.rules.phase === 'active')
  me.weapon = armWeapon(WEAPONS.missiles)
  duel(m.combatants, me, enemy)
  me.control.fire = false
  m.run(0.2)
  drawn.copy(enemy.position) // dead ahead, 20 m off, as the page drew it
  placeCar(enemy.car, { x: 40, y: 0, z: 0 }, 0) // where it is now: well off to the side
  me.control.aim.set(0, 1.1, 20)
  me.control.lock = enemy.id
  m.run(1)
  const held = locked(me.weapon)
  placeCar(enemy.car, { x: 0, y: 0, z: 20 }, Math.PI) // back in the window now ...
  drawn.set(40, enemy.position.y, 0) // ... but drawn where it was
  m.run(2 / 60)
  check(held && me.weapon.lock.target === -1, 'online, a lock is judged where the page drew the target: held as drawn, not where it is now')
}

// --- mines ---------------------------------------------------------------------------
// A mine goes down behind the machine that lays it, on the ground. Armed
// after its second, it goes off under a hostile within its trigger (the
// whole charge to that machine, nothing to its layer), never under a
// teammate; at most three of a machine's lie at once, each for 30 s; a
// restart clears them.

{
  const m = setup('tdm')
  const [me] = m.combatants
  const [mate, enemy] = [m.combatants[1], m.combatants[4]]
  m.run(4, () => m.mode.rules.phase === 'active')
  const layer: MineSpec = {
    ...WEAPONS.minigun,
    kind: 'mine',
    damage: 60,
    fireRate: 1,
    magazine: 6,
    reloadTime: 6,
    range: 30,
    spread: 0,
    mine: { arm: 1, trigger: 4, blast: 6, down: 3, life: 30 },
  }
  duel(m.combatants, me, enemy)
  me.control.fire = false
  placeCar(enemy.car, { x: -40, y: 0, z: 60 }, 0)
  me.weapon = armWeapon(layer)
  // a mine laid from (x, z), facing south; then the machine is put out of the way
  const layAt = (x: number, z: number) => {
    placeCar(me.car, { x, y: 0, z }, 0)
    m.run(0.1)
    me.weapon.cooldown = 0
    me.control.fire = true
    m.run(1 / 60)
    me.control.fire = false
    placeCar(me.car, { x: -60, y: 0, z: -60 }, 0)
    m.run(1 / 60)
    return m.sim.mines.at(-1)!
  }
  const first = layAt(0, 0)
  check(
    m.heard.laid.length === 1 && first.owner === me && first.position.z < -2.5 && Math.abs(first.position.x) < 0.3 && Math.abs(first.position.y) < 0.3,
    `a mine goes down behind the machine, on the ground (${first.position
      .toArray()
      .map((n) => n.toFixed(2))
      .join(', ')})`,
  )
  placeCar(enemy.car, { x: first.position.x, y: 0, z: first.position.z }, 0)
  const hull = enemy.health
  m.run(0.5)
  const early = m.sim.mines.includes(first) && enemy.health === hull
  m.run(0.6, () => !m.sim.mines.includes(first))
  check(
    early && !m.sim.mines.includes(first) && m.heard.gone.includes(first.id) && hull - enemy.health === 60 && me.health === me.maxHealth,
    `not before its second, then a hostile on it sets it off: the whole 60 to it (${hull - enemy.health}), nothing to its layer`,
  )
  const second = layAt(30, 0)
  m.run(1.2)
  placeCar(mate.car, { x: second.position.x, y: 0, z: second.position.z }, 0)
  const bursts = m.heard.burst
  m.run(0.5)
  check(m.sim.mines.includes(second) && m.heard.burst === bursts && mate.health === mate.maxHealth, 'a teammate on an armed mine never sets it off')
  placeCar(mate.car, { x: -80, y: 0, z: 60 }, 0)
  const third = layAt(60, 0)
  layAt(90, 0)
  layAt(120, 0)
  const mine = m.sim.mines.filter((x) => x.owner === me)
  check(
    mine.length === 3 && !mine.includes(second) && m.heard.gone.includes(second.id) && mine.includes(third),
    'three of a machine’s lie at most: a fourth clears its oldest',
  )
  m.run(30.5)
  check(m.sim.mines.length === 0 && mine.every((x) => m.heard.gone.includes(x.id)), 'a mine lies 30 s at most')
  const last = layAt(0, 40)
  m.sim.restart(2)
  check(m.sim.mines.length === 0 && m.heard.gone.includes(last.id), 'a restart clears the mines down')
}

// --- rams --------------------------------------------------------------------------
// A machine with a ram hurts what its nose strikes, by how fast it was
// closing on it; the same car not again for a while, a blow outside the
// ram's arc nothing, and a wreck it causes is its kill.

{
  const m = setup('tdm')
  const [me] = m.combatants
  const enemy = m.combatants[4]
  m.run(4, () => m.mode.rules.phase === 'active')
  const { ram } = VEHICLES.rammer
  changeVehicle(m.world, me, 'rammer')
  duel(m.combatants, me, enemy)
  me.control.fire = false
  // charging a car side on across its nose, from 16 m
  placeCar(enemy.car, { x: 0, y: 0, z: 16 }, Math.PI / 2)
  m.run(0.2)
  const hull = enemy.health
  me.control.throttle = 1
  let closing = 0 // as the step that struck began
  m.run(4, () => {
    if (enemy.health < hull) return true
    closing = me.velocity.z - enemy.velocity.z
    return false
  })
  const blow = hull - enemy.health
  check(
    blow > 0 && Math.abs(blow - ram!.damage * closing) < ram!.damage * 1.5,
    `a ram strikes the car on its nose by how fast it was closing: ${blow.toFixed(1)} at ${closing.toFixed(1)} m/s`,
  )
  const after = enemy.health
  m.run(0.5)
  me.control.throttle = 0
  check(enemy.health === after, `pushing on, not again within 0.6 s (${(after - enemy.health).toFixed(1)})`)
  // a car driving into its flank, outside the ram's arc
  placeCar(me.car, { x: 0, y: 0, z: 0 }, 0)
  placeCar(enemy.car, { x: 14, y: 0, z: 0 }, -Math.PI / 2)
  m.run(0.2)
  const [mine, theirs] = [me.health, enemy.health]
  enemy.control.throttle = 1
  m.run(3, () => me.position.x < -0.5)
  enemy.control.throttle = 0
  check(
    me.position.x < -0.5 && me.health === mine && enemy.health === theirs,
    'a car striking its flank, outside the ram’s arc, takes nothing and deals nothing',
  )
  // a wreck the ram causes is its kill
  placeCar(me.car, { x: 0, y: 0, z: 0 }, 0)
  placeCar(enemy.car, { x: 0, y: 0, z: 16 }, Math.PI / 2)
  m.run(0.2)
  enemy.health = 5
  me.control.throttle = 1
  m.run(4, () => !enemy.alive)
  me.control.throttle = 0
  check(m.heard.wrecked.includes(`${me.id}>${enemy.id}`) && me.stats.kills === 1, 'a wreck the ram causes is its kill')
}

// --- free for all ------------------------------------------------------------------

{
  const m = setup('ffa')
  check(m.combatants.length === 8 && new Set(m.combatants.map((c) => c.team)).size === 8, 'eight machines, each its own team')
  m.run(4, () => m.mode.rules.phase === 'active')
  const [me, rival] = [m.combatants[0], m.combatants[3]]
  duel(m.combatants, me, rival)
  m.run(10, () => !rival.alive)
  check(!rival.alive && me.stats.kills === 1 && m.lines.includes('kill 0>3'), 'a kill scores for the machine')
  check(m.mode.speedFactor(0) === 1, 'no boost without a pickup')
  Object.assign(m.mode.rules, { now: 3 + 600 - 0.2 })
  me.control.fire = false
  m.run(1, () => m.mode.outcome() !== undefined)
  check(m.mode.outcome() === me.team, 'the sole leader at the buzzer takes the match')
  m.world.free()
}

// --- an empty seat -----------------------------------------------------------------------

// A seat nobody holds (a custom room's): its machine out of play where it
// stands — no wreck, no kill — its body out of the world, left out of the
// standings; taken, it's back in on the next step at a start the rules
// pick, protected.
{
  const m = setup('ffa')
  m.run(4, () => m.mode.rules.phase === 'active')
  const ffa = m.mode.kind === 'ffa' ? m.mode.rules : null
  const [me, gone] = [m.combatants[0], m.combatants[3]]
  duel(m.combatants, me, gone)
  const said = m.lines.length
  m.sim.vacate(gone)
  check(
    !gone.present &&
      !gone.alive &&
      m.mode.rules.contenders[3].life === 'absent' &&
      gone.stats.deaths === 0 &&
      m.lines.length === said &&
      !m.heard.wrecked.length,
    'an empty seat: out of play, quietly',
  )
  check(!!ffa && !ffa.standings().includes(3) && ffa.standings().length === 7, 'left out of the standings')
  m.run(2)
  check(m.heard.fired > 10 && !m.heard.struck.length && m.heard.hurt === 0, `rounds pass where it stood: its body is out of the world (${m.heard.fired} fired)`)
  check(!m.mode.rules.respawnDue(3) && !gone.alive, 'never due back by itself')
  me.control.fire = false
  m.sim.occupy(gone)
  m.run(PHYSICS_STEP)
  check(
    gone.present && gone.alive && m.mode.rules.contenders[3].life === 'protected' && m.heard.respawned.includes(3),
    'taken: back in on the next step, protected',
  )
  check(
    m.mode.starts.some((s) => s.position.distanceTo(gone.position) < 0.5) && !!ffa?.standings().includes(3),
    'on a start the rules picked, in the standings again',
  )
  m.world.free()
}

// --- a custom lobby's settings ----------------------------------------------------------------

// Sizes: two machines and twelve, each on its own start (twelve need a bigger
// yard: sixteen spawns, six starts a base).
const bigYard: Arena = {
  ...arena,
  spawns: ring(100, 16).map(([x, z]) => start(x, z, Math.atan2(-x, -z))),
  bases: [[-25, -15, -5, 5, 15, 25].map((x) => start(x, -120, 0)), [-25, -15, -5, 5, 15, 25].map((x) => start(x, 120, Math.PI))],
}
for (const kind of ['ffa', 'tdm'] as const) {
  for (const size of [2, 12]) {
    const m = setup(kind, { bots: true, yard: bigYard, settings: { ...classic(kind), size } })
    const starts = new Set(m.combatants.map((c) => `${c.spawn.position.x},${c.spawn.position.z}`))
    check(m.combatants.length === size && starts.size === size, `${kind}, ${size} machines: each on its own start`)
    check(kind === 'ffa' || m.combatants.every((c, i) => c.team === (i < size / 2 ? 0 : 1)), `${kind}, ${size}: half a side, the first half blue`)
    m.run(30)
    const dealt = m.combatants.reduce((sum, c) => sum + c.stats.damageDealt, 0)
    check(m.mode.rules.phase === 'active' && (size === 2 || dealt > 0), `${kind}, ${size} machines: 30 s of bots playing (${Math.round(dealt)} hull dealt)`)
    check(m.mode.kind !== 'ffa' || m.mode.rules.standings().length === size, `${kind}, ${size}: every machine in the standings`)
    m.world.free()
  }
}

// Duration: the buzzer at five minutes (nobody scored: tied, so overtime).
{
  const m = setup('ffa', { settings: { ...classic('ffa'), duration: 300 } })
  m.run(4, () => m.mode.rules.phase === 'active')
  Object.assign(m.mode.rules, { now: 3 + 300 - 0.2 })
  m.run(1)
  check(m.mode.rules.phase === 'overtime' && m.mode.rules.remaining() === 0, 'five minutes: the clock runs out at 5:00')
  m.world.free()
}

// Friendly fire, through the simulation: off, a teammate's rounds pass
// harmlessly; on, they wreck it — a team kill — and nobody's own rocket
// ever hurts them.
{
  const off = setup('tdm')
  off.run(4, () => off.mode.rules.phase === 'active')
  duel(off.combatants, off.combatants[0], off.combatants[1])
  off.run(2)
  check(off.heard.fired > 10 && off.heard.hurt === 0 && off.combatants[1].health === off.combatants[1].maxHealth, 'friendly fire off: a teammate takes no hit')
  off.world.free()

  const m = setup('tdm', { settings: { ...classic('tdm'), friendlyFire: true } })
  m.run(4, () => m.mode.rules.phase === 'active')
  const [me, mate] = [m.combatants[0], m.combatants[1]]
  duel(m.combatants, me, mate)
  m.run(10, () => !mate.alive)
  const tdm = m.mode.kind === 'tdm' ? m.mode.rules : null
  check(
    !mate.alive && tdm?.score.join() === '-1,0' && me.stats.teamKills === 1 && me.stats.kills === 0 && m.lines.includes('teamkill 0>1'),
    'friendly fire on: the minigun wrecks a teammate, a team kill, fed as one',
  )
  me.weapon = armWeapon(WEAPONS.rocketPod)
  me.control.aim.set(me.position.x, 0, me.position.z + 4) // the ground just ahead
  const bursts = m.heard.burst
  m.run(1, () => m.heard.burst > bursts)
  me.control.fire = false
  check(m.heard.burst > bursts && me.health === me.maxHealth, 'a rocket bursting at its own nose never hurts the shooter')
  m.world.free()
}

// Pickups in team deathmatch: turned on, the supply plugs in and a wave lands at 2:00; off, there's none.
{
  const m = setup('tdm', { bots: true, settings: { ...classic('tdm'), items: { health: true, ammo: true, powerups: true } } })
  m.run(126)
  const collected = m.combatants.reduce((sum, c) => sum + c.stats.itemsCollected, 0)
  check(
    !!m.mode.supply && m.mode.supply.items.length + collected > 0,
    `team deathmatch with pickups: a wave by 2:00 (${m.mode.supply?.items.length} on the ground, ${collected} picked up)`,
  )
  m.world.free()
  const bare = setup('tdm')
  check(!bare.mode.supply, 'team deathmatch without them: no supply at all')
  bare.world.free()
}

// --- determinism -------------------------------------------------------------------------

// Bots only, no hand on the controls: the seed is the whole match. Runs
// `seconds`, or until the match ends.
function replay(kind: 'tdm' | 'ffa', seed: number, seconds: number) {
  const m = setup(kind, { seed, bots: true })
  m.run(seconds, () => m.mode.outcome() !== undefined)
  const state = JSON.stringify(m.combatants.map((c) => [c.position.toArray(), c.rotation.toArray(), c.health, c.alive, c.stats, c.weapon.ammo]))
  m.world.free()
  return state
}
const first = replay('ffa', 7, 30)
check(first === replay('ffa', 7, 30), 'the same seed replays the same match, to the last bit')
check(first !== replay('ffa', 8, 30), 'another seed, another match')

// Classic as it played before the custom lobbies (.claude/work/custom/PLAN.md
// 5.6): a whole match of bots in each mode (item waves, every respawn wait,
// the buzzer; free for all's goes to overtime), hashed. The refactor leaves
// them as they are; play changed on purpose changes them here. On the real
// arenas: server/server.test.ts.
const GOLDEN = [
  ['tdm', '3ec7416629c569b3'],
  ['ffa', 'd457463001e9f922'],
] as const
for (const [kind, pinned] of GOLDEN) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(replay(kind, 7, 700)))
  const played = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
  check(played === pinned, `${kind}: a whole match of bots plays as before (${pinned}, played ${played})`)
}

// --- content ---------------------------------------------------------------------------

for (const [id, w] of Object.entries(WEAPONS)) {
  check(w.damage > 0 && w.fireRate > 0 && w.magazine > 0 && w.reloadTime >= 0 && w.range > 0 && w.spread >= 0, `weapon ${id}: positive numbers`)
  check(w.kind !== 'rocket' || (w.rocket.speed > 0 && w.rocket.blast > 0), `weapon ${id}: a rocket needs speed and blast`)
}
for (const [id, v] of Object.entries(VEHICLES)) {
  check(v.armour > 0 && v.handling.mass > 0 && v.chassis.wheels.length === 4 && v.chassis.wheelRadius > 0, `vehicle ${id}: armour, mass, four wheels`)
  const { topSpeed, zeroTo80 } = drivePerformance(v.handling)
  check(topSpeed > 0 && topSpeed <= v.handling.maxSpeed && zeroTo80 > 0, `vehicle ${id}: it drives (top speed ${topSpeed.toFixed(1)} m/s)`)
}

describe('simulation', () => {
  it.each(checks)('%s', (_, ok) => expect(ok).toBe(true))
})
