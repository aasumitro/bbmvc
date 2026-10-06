// Self-check for the bots, headless: their guns and aim, then eight bots
// playing free for all on a small city — a street grid between solid blocks,
// junk on the roads, a wall round it — at every difficulty: they keep moving
// (never stuck for long, never parked in a fight), both guns pull their
// weight, and a harder difficulty wrecks more. Run: node src/game/bots.check.ts
import * as THREE from 'three'
import type { Arena, ArenaCollider, SpawnPoint } from './arena/arena.ts'
import { armBot, DIFFICULTIES, leadTarget, type Agent, type Difficulty } from './ai.ts'
import { WEAPONS } from './combat.ts'
import { createFfaMode, lineUp } from './ffa/mode.ts'
import { classic } from './matchSettings.ts'
import { createWorld, initPhysics, PHYSICS_STEP } from './physics.ts'
import { createRng } from './rng.ts'
import { createSimulation, enlist } from './simulation.ts'

await initPhysics()

// Streets every 60 m (x, z = -120..120), 20 m wide; 40 m blocks between them.
const STREETS = [-120, -60, 0, 60, 120]
function cityYard(seed: number): Arena {
  const rng = createRng(seed)
  const colliders: ArenaCollider[] = []
  const box = (x: number, z: number, hx: number, hz: number, hy = 6, yaw = 0) =>
    colliders.push({ box: new THREE.Vector3(hx, hy, hz), position: new THREE.Vector3(x, hy, z), rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw) })
  for (const x of [-90, -30, 30, 90]) for (const z of [-90, -30, 30, 90]) box(x, z, 20, 20)
  for (const s of [-1, 1]) {
    box(s * 132, 0, 2, 134)
    box(0, s * 132, 134, 2)
  }
  // junk on the roads: drums and crates, off the crossings
  for (let i = 0; i < 48; i++) {
    const along = (rng() - 0.5) * 230
    const street = STREETS[Math.floor(rng() * STREETS.length)] + (rng() - 0.5) * 12
    if (STREETS.some((s) => Math.abs(along - s) < 10)) continue
    const [x, z] = rng() < 0.5 ? [along, street] : [street, along]
    if (rng() < 0.5) colliders.push({ cylinder: [0.6 + rng() * 0.6, 0.6], position: new THREE.Vector3(x, 0.6, z) })
    else box(x, z, 0.8 + rng() * 1.2, 0.8 + rng() * 1.2, 0.8, rng() * Math.PI)
  }
  const nodes = STREETS.flatMap((x) => STREETS.map((z) => new THREE.Vector3(x, 0, z)))
  const at = (i: number, j: number) => i * STREETS.length + j
  const links = nodes.map((_, n) => {
    const [i, j] = [Math.floor(n / STREETS.length), n % STREETS.length]
    return [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < STREETS.length && b < STREETS.length).map(([a, b]) => at(a, b))
  })
  const start = (x: number, z: number): SpawnPoint => ({ position: new THREE.Vector3(x, 0, z), heading: Math.atan2(-x, -z) })
  const spawns = [[-120, -120], [0, -120], [120, -120], [120, 0], [120, 120], [0, 120], [-120, 120], [-120, 0]].map(([x, z]) => start(x, z))
  return {
    name: 'City yard',
    root: new THREE.Group(),
    spawns,
    bases: [spawns.slice(0, 4), spawns.slice(4)],
    zones: [{ name: 'Middle', x: 0, z: 0, radius: 30 }],
    colliders,
    nav: { nodes, links },
    emitters: [],
    extent: 140,
    mapRange: 70,
    paintMap() {},
    update() {},
  }
}

// Bots only, `seconds` of free for all after the countdown, armed and
// skilled as a match at `difficulty` arms them; how they drove and fought.
function playYard(seed: number, seconds: number, difficulty: Difficulty) {
  const arena = cityYard(seed)
  const world = createWorld(arena.colliders)
  const skill = DIFFICULTIES[difficulty]
  const arsenal = createRng(seed ^ 0x2545f491)
  const settings = classic('ffa')
  const combatants = lineUp(arena, settings.size).map(({ team, spawn }, id) => enlist(world, id, { name: `bot${id}`, team, seed: id + 1, spawn, vehicle: 'razor', weapon: armBot(skill, arsenal), bot: true, skill }))
  const mode = createFfaMode(combatants, arena, world, seed, settings)
  const noop = () => {}
  const sim = createSimulation({ world, arena, combatants, mode, seed, events: { fired: noop, shot: noop, rocket: noop, burst: noop, hurt: noop, wrecked: noop, crashed: noop, reloading: noop, respawned: noop, recovered: noop } })
  const n = { alive: 0, stuck: 0, stuckLong: 0, parked: 0, reverses: 0, distance: 0, engaged: 0, cover: 0, lurking: 0, ambushes: 0, surprise: 0 }
  const wasLurking = combatants.map(() => false)
  const opened: { id: number; dealt: number; until: number }[] = [] // ambushes sprung: damage in the 2 s after
  let clock = 0
  const slowFor = combatants.map(() => 0)
  const wasReversing = combatants.map(() => false)
  for (let k = Math.round(3.2 / PHYSICS_STEP); k > 0; k--) sim.step(PHYSICS_STEP, true) // the countdown
  for (let k = Math.round(seconds / PHYSICS_STEP); k > 0; k--) {
    sim.step(PHYSICS_STEP, true)
    clock += PHYSICS_STEP
    for (let i = opened.length - 1; i >= 0; i--) {
      if (clock < opened[i].until) continue
      n.surprise += combatants[opened[i].id].stats.damageDealt - opened[i].dealt
      opened.splice(i, 1)
    }
    for (const c of combatants) {
      const brain = c.brain!
      const lurking = c.alive && brain.hide > 0 && brain.lurking
      if (wasLurking[c.id] && !lurking && c.alive && brain.canSee) {
        n.ambushes++
        opened.push({ id: c.id, dealt: c.stats.damageDealt, until: clock + 2 })
      }
      wasLurking[c.id] = lurking
      if (!c.alive) continue
      if (brain.hide > 0) n[brain.lurking ? 'lurking' : 'cover'] += PHYSICS_STEP
      n.alive += PHYSICS_STEP
      const slow = Math.abs(c.speed) < 1
      const backing = brain.reverse > 0
      const pressing = c.control.throttle > 0.3
      slowFor[c.id] = slow && pressing && !backing ? slowFor[c.id] + PHYSICS_STEP : 0
      if (slow && pressing && !backing) n.stuck += PHYSICS_STEP // flooring it and going nowhere
      if (slowFor[c.id] > 3) n.stuckLong += PHYSICS_STEP
      if (slow && !pressing && !backing && Math.abs(c.control.throttle) <= 0.3 && brain.canSee) n.parked += PHYSICS_STEP // sitting still in a fight
      if (backing && !wasReversing[c.id]) n.reverses++
      wasReversing[c.id] = backing
      n.distance += Math.abs(c.speed) * PHYSICS_STEP
      if (brain.canSee) n.engaged += PHYSICS_STEP
    }
  }
  const dealt = (rockets: boolean) => combatants.filter((c) => !!c.weapon.spec.rocket === rockets).reduce((sum, c) => sum + c.stats.damageDealt, 0)
  const armed = (rockets: boolean) => combatants.filter((c) => !!c.weapon.spec.rocket === rockets).length
  const result = {
    stuck: n.stuck / n.alive, // share of live time
    stuckLong: n.stuckLong / n.alive, // ...of that, past 3 s
    parked: n.parked / n.alive, // share of live time sitting still with a target in sight
    reversesPerMinute: (n.reverses / n.alive) * 60, // backing out, per bot-minute
    speed: n.distance / n.alive, // m/s
    engaged: n.engaged / n.alive, // share of live time with a target in sight
    killsPerMinute: (combatants.reduce((sum, c) => sum + c.stats.kills, 0) / seconds) * 60, // all eight
    gunDamagePerBotMinute: (dealt(false) / Math.max(1, armed(false)) / seconds) * 60,
    rocketDamagePerBotMinute: (dealt(true) / Math.max(1, armed(true)) / seconds) * 60,
    rocketBots: armed(true),
    cover: n.cover / n.alive, // share of live time heading for or in cover
    lurking: n.lurking / n.alive, // ...lying in wait
    ambushesPerMinute: (n.ambushes / seconds) * 60, // all eight
    surprisePerAmbush: n.surprise / Math.max(1, n.ambushes), // damage in the 2 s after one springs
  }
  world.free()
  return result
}

let checks = 0
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`bots: ${what}`)
  checks++
}

// --- guns and aim -----------------------------------------------------------------

{
  const draws = Array.from({ length: 40 }, (_, i) => armBot(DIFFICULTIES.normal, createRng(i)))
  check(new Set(draws.map((w) => w.name)).size === Object.keys(WEAPONS).length, 'bots draw every gun on the roster')
  const hard = armBot(DIFFICULTIES.hard, () => 0)
  const base = WEAPONS[(Object.keys(WEAPONS) as (keyof typeof WEAPONS)[])[0]]
  check(hard.damage === base.damage * DIFFICULTIES.hard.damage && hard.spread === Math.max(base.spread, DIFFICULTIES.hard.spread), 'the difficulty scales the damage and floors the spread')

  // a rocket led at a car crossing at 20 m/s, 60 m off, meets it
  const agent = (x: number, z: number, vx: number, rocket: boolean) =>
    ({ position: new THREE.Vector3(x, 0, z), velocity: new THREE.Vector3(vx, 0, 0), weapon: { spec: rocket ? WEAPONS.rocketPod : WEAPONS.minigun } }) as unknown as Agent
  const skill = { ...DIFFICULTIES.hard, lead: 1 }
  const shooter = agent(0, 0, 0, true)
  const car = agent(0, 60, 20, false)
  const aim = leadTarget(shooter, car, skill, new THREE.Vector3())
  const flight = aim.distanceTo(new THREE.Vector3(0, aim.y, 0)) / WEAPONS.rocketPod.rocket!.speed
  const there = car.position.x + 20 * (flight + 1 / skill.aimRate)
  check(Math.abs(aim.x - there) < 1.5 && aim.x > 10, `a rocket leads a crossing car (aimed ${aim.x.toFixed(1)} m ahead, it's at ${there.toFixed(1)} m then)`)
  const still = leadTarget(shooter, agent(0, 60, 0, false), skill, new THREE.Vector3())
  check(Math.abs(still.x) < 1e-9 && Math.abs(still.y - 1.1) < 1e-9, 'a car standing still: aimed at its hull')
}

// --- on the city yard ---------------------------------------------------------------

const played: Record<string, ReturnType<typeof playYard>> = {}
for (const difficulty of Object.keys(DIFFICULTIES) as Difficulty[]) {
  const runs = [1, 2, 3].map((seed) => playYard(seed, 90, difficulty))
  const mean = (key: keyof (typeof runs)[number]) => runs.reduce((sum, r) => sum + r[key], 0) / runs.length
  const r = (played[difficulty] = Object.fromEntries((Object.keys(runs[0]) as (keyof (typeof runs)[number])[]).map((key) => [key, mean(key)])) as ReturnType<typeof playYard>)
  const label = DIFFICULTIES[difficulty].label
  check(r.parked < 0.01, `${label}: no parking in a fight (${(r.parked * 100).toFixed(1)} % of the time)`)
  check(r.stuck < 0.08 && r.stuckLong < 0.005, `${label}: never stuck for long (${(r.stuck * 100).toFixed(1)} %, ${(r.stuckLong * 100).toFixed(2)} % past 3 s)`)
  check(r.speed > 7, `${label}: on the move (${r.speed.toFixed(1)} m/s average)`)
  const ratio = r.rocketDamagePerBotMinute / r.gunDamagePerBotMinute
  check(ratio > 0.5 && ratio < 2, `${label}: rockets and guns both pull their weight (${r.rocketDamagePerBotMinute.toFixed(0)} vs ${r.gunDamagePerBotMinute.toFixed(0)} a bot-minute)`)
  const hiding = r.cover + r.lurking
  if (DIFFICULTIES[difficulty].hide + DIFFICULTIES[difficulty].ambush === 0) check(hiding === 0, `${label}: never hides`)
  else check(hiding > 0.01 && hiding < 0.25, `${label}: hides now and then, never camps (${(r.cover * 100).toFixed(1)} % in cover, ${(r.lurking * 100).toFixed(1)} % lying in wait)`)
}
check(played.hard.ambushesPerMinute > 0, `hard bots spring ambushes (${played.hard.ambushesPerMinute.toFixed(1)} a minute, ${played.hard.surprisePerAmbush.toFixed(0)} damage in the 2 s after)`)
check(played.easy.killsPerMinute < played.normal.killsPerMinute && played.normal.killsPerMinute < played.hard.killsPerMinute, 'harder bots wreck more')

console.log(`bots ok (${checks} checks; kills a minute: ${Object.entries(played).map(([d, r]) => `${d} ${r.killsPerMinute.toFixed(1)}`).join(', ')})`)
