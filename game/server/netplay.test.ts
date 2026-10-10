// Tests for playing across a real network's delay: a game server that
// holds every message back (50, 100, 150 ms each way, give or take 10 ms,
// order kept) and a headless page (browser.ts) driving on test yards. The
// player's own car is predicted (net/prediction.ts): how often the server
// has to put it right, how far off it was, and how quickly it settles after
// what the page couldn't know (a wall hit, a rocket's shove). Prints what it
// measured. An integration test (vitest.config.ts).
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Arena, ArenaCollider, SpawnPoint } from '../src/content/arenas/arena.ts'
import { armWeapon } from '../src/sim/combat.ts'
import { WEAPONS } from '../src/content/weapons/weapons.ts'
import { VEHICLES } from '../src/content/vehicles/vehicles.ts'
import { inputMessage } from '../src/net/protocol.ts'
import { initPhysics, PHYSICS_STEP } from '../src/sim/physics.ts'
import type { Combatant } from '../src/sim/simulation.ts'
import { placeCar } from '../src/sim/drive.ts'
import { browser, play, until, type Browser } from './browser.ts'
import { queueDepth } from './inputs.ts'
import type { Room } from './room.ts'
import { createGameServer } from './server.ts'
import { addHauler, HAULER } from './testVehicle.ts'

await initPhysics()

// Every check is a test of its own, in order, under its label (the it.each
// at the end); a failed one fails its test, and the rest still run.
const checks: Array<[string, boolean]> = []
const check = (ok: boolean, what: string) => void checks.push([what, ok])
// Steps of the 60 Hz clock in `ms` of it. The bounds count steps, not
// milliseconds: on a loaded machine the page and the server slow down
// together (one process), and the wall clock doesn't.
const inSteps = (ms: number) => Math.round(ms / 1000 / PHYSICS_STEP)

// Flat test yards (as src/sim/simulation.test.ts's): starts on a ring, a base of four
// at each end facing the other; one of them has a wall across the road 60 m
// ahead of the first base.
const start = (x: number, z: number, heading: number): SpawnPoint => ({ position: new THREE.Vector3(x, 0, z), heading })
const ring = (radius: number, count: number) =>
  Array.from({ length: count }, (_, i) => (i / count) * Math.PI * 2).map((a) => [Math.cos(a) * radius, Math.sin(a) * radius] as const)
const yard = (colliders: ArenaCollider[]): Arena => ({
  name: 'Test yard',
  root: new THREE.Group(),
  spawns: ring(100, 8).map(([x, z]) => start(x, z, Math.atan2(-x, -z))),
  bases: [[-15, -5, 5, 15].map((x) => start(x, -120, 0)), [-15, -5, 5, 15].map((x) => start(x, 120, Math.PI))],
  zones: [{ name: 'Middle', x: 0, z: 0, radius: 40 }],
  colliders,
  nav: { nodes: ring(60, 12).map(([x, z]) => new THREE.Vector3(x, 0, z)), links: Array.from({ length: 12 }, (_, i) => [(i + 11) % 12, (i + 1) % 12]) },
  emitters: [],
  extent: 160,
  mapRange: 78,
  paintMap() {},
  update() {},
})
const open = yard([])
const walled = yard([{ box: new THREE.Vector3(40, 2, 1), position: new THREE.Vector3(0, 2, -60), rotation: new THREE.Quaternion() }])

const KEY = 'netplay-check-key'
const ORIGIN = 'http://play.test'
const results: string[] = []

// The bots out of the way and still: only the players' machines move.
function stillBots(room: Room) {
  for (const c of room.combatants) {
    if (room.humans.some((h) => h.seat === c.id)) continue
    c.brain = undefined
    Object.assign(c.control, { throttle: 0, steer: 0, handbrake: true, fire: false })
    placeCar(c.car, { x: 400, y: 0, z: -200 + c.id * 20 }, 0)
  }
}

// The corrections a page made, each with the page's step it was seen on (its
// newest input's seq: one a step) and when, as the frames went.
interface Seen {
  step: number
  at: number // ms
}
function watchCorrections(b: Browser) {
  const seen: Seen[] = []
  let count = b.client.prediction.corrections
  return {
    seen,
    note() {
      for (const now = b.client.prediction.corrections; count < now; count++) seen.push({ step: b.client.net.seq, at: performance.now() })
    },
  }
}

// After something the page couldn't foresee at its step `at`: how many
// corrections it caused in the second that followed, and how many steps (and
// ms) from the first to the last.
function settle(seen: Seen[], at: number) {
  const after = seen.filter((c) => c.step >= at && c.step < at + inSteps(1000))
  const [first, last] = [after[0], after.at(-1)]
  return { count: after.length, steps: first && last ? last.step - first.step : 0, ms: first && last ? last.at - first.at : 0 }
}

// Ten seconds at the wheel, over and over: flat out, a long left turn, a handbrake slide, then braking into reverse.
const script = (seconds: number) => {
  const t = seconds % 10
  return t < 3
    ? { throttle: 1, steer: 0, handbrake: false }
    : t < 6
      ? { throttle: 1, steer: 0.5, handbrake: false }
      : t < 8
        ? { throttle: 0.6, steer: -1, handbrake: true }
        : { throttle: -1, steer: 0.2, handbrake: false }
}

for (const lag of [50, 100, 150]) {
  const server = createGameServer({
    port: 0,
    key: KEY,
    origins: [ORIGIN],
    maxRooms: 4,
    lag,
    jitter: 10,
    arenaFor: (map) => (map === 'city' ? walled : open),
    log: () => {},
  })
  const port = await server.listen()

  // --- on the grid, then the scripted drive in the open ---------------------------------------------------
  const a = await browser({ port, key: KEY, origin: ORIGIN, uid: `a${lag}`, arena: open })
  const room = server.seating.rooms[0]
  stillBots(room)
  const spawn = a.player.spawn.position.clone()
  const corrections = watchCorrections(a)
  a.control.throttle = 1 // flat out against the hold: the server holds the car, and so must the prediction
  let drift = 0 // on the grid, until 0.3 s before GO: the page may set off at its own GO, a trip ahead of the server
  let lead = 0 // by the time the check sees the server's GO (polled every 50 ms)
  const human = room.humans[0]
  // Late and dropped inputs are counted from the countdown's last second: one there moves which input the
  // server uses on which step, and the page, a round trip behind, can set off a step early at GO.
  let late: { repeats: number; drops: number } | null = null
  await until(
    () => {
      corrections.note()
      if (!late && room.mode.rules.now >= room.mode.timing.preMatch - 1) late = { repeats: human.repeats, drops: human.drops }
      lead = Math.max(lead, Math.hypot(a.player.position.x - spawn.x, a.player.position.z - spawn.z))
      if (room.mode.rules.now < room.mode.timing.preMatch - 0.3) drift = lead
      return room.mode.rules.phase === 'active'
    },
    6000,
    'GO',
    [a],
  )
  const held = corrections.seen.length
  // One correction may come from an input late in the countdown's last moments (see the drive).
  check(drift < 0.01 && held <= 1, `${lag} ms: held on the grid, the prediction too (${drift.toFixed(3)} m until 0.3 s before GO, ${held} corrections)`)
  // At its own GO the page sets off a one-way trip ahead of the server, as it should; a page that set off a
  // second early would be metres out.
  check(lead < 0.5, `${lag} ms: the page sets off at GO, not before (${lead.toFixed(3)} m out by the time the server's GO is seen)`)

  a.client.prediction.maxError = 0
  const before = { corrections: corrections.seen.length, ...late! }
  const go = performance.now()
  await play(20_000, [a], (b) => {
    Object.assign(b.control, script((performance.now() - go) / 1000))
    corrections.note()
  })
  const drive = {
    corrections: corrections.seen.length - before.corrections,
    maxError: a.client.prediction.maxError,
    repeats: human.repeats - before.repeats,
    drops: human.drops - before.drops,
    travelled: a.player.position.distanceTo(spawn),
  }
  check(drive.travelled > 30, `${lag} ms: the scripted drive went somewhere (${drive.travelled.toFixed(0)} m from the start)`)
  // The prediction is the server's own driving: only an input that reaches the server too late for its
  // step (it repeats the one before) or finds the queue full (the oldest is dropped) makes the two differ,
  // by a step's travel. With the network on time it's exact to the wire's rounding.
  check(
    drive.corrections <= drive.repeats + drive.drops,
    `${lag} ms: every correction in 20 s of driving came from an input the network delivered too late, or one dropped (${drive.corrections} corrections; ${drive.repeats} late, ${drive.drops} dropped since the countdown's last second)`,
  )
  check(
    drive.repeats + drive.drops > 0 || drive.maxError < 0.05,
    `${lag} ms: with every input on time the prediction is exact to the wire’s rounding (${drive.maxError.toFixed(3)} m)`,
  )

  // --- a rocket's shove: something the page can't foresee ---------------------------------------------------------
  Object.assign(a.control, { throttle: 0, steer: 0, handbrake: true })
  await play(1000, [a], () => corrections.note())
  const me = room.combatants[a.player.id]
  const gunner = room.combatants.find((c: Combatant) => c.team !== me.team)!
  placeCar(gunner.car, { x: me.position.x - 25, y: 0, z: me.position.z }, Math.PI / 2)
  gunner.weapon = armWeapon(WEAPONS.rocketPod)
  gunner.control.aim.set(me.position.x, me.position.y + 0.6, me.position.z)
  await play(300, [a], () => corrections.note())
  const bursts = a.shown.filter((e) => e[0] === 'burst').length
  gunner.control.fire = true
  let burstAt = 0 // the page's step
  await until(
    () => {
      corrections.note()
      if (!burstAt && a.shown.filter((e) => e[0] === 'burst').length > bursts) {
        burstAt = a.client.net.seq
        gunner.control.fire = false
      }
      return burstAt > 0
    },
    5000,
    'the rocket',
    [a],
  )
  await play(1200, [a], () => corrections.note())
  const shove = settle(corrections.seen, burstAt - inSteps(50))
  check(
    shove.steps <= inSteps(200),
    `${lag} ms: after a rocket’s shove the prediction settles within 200 ms (${shove.count} corrections over ${shove.steps} steps, ${Math.round(shove.ms)} ms)`,
  )
  a.link.close()

  // --- into a wall ---------------------------------------------------------------------------------------------
  const b = await browser({ port, key: KEY, origin: ORIGIN, uid: `b${lag}`, arena: walled, map: 'city' })
  const walledRoom = server.seating.rooms.find((r) => r.map === 'city')!
  stillBots(walledRoom)
  const bumps = watchCorrections(b)
  await until(() => walledRoom.mode.rules.phase === 'active', 6000, 'GO by the wall', [b])
  b.control.throttle = 1
  let hitAt = 0 // the page's step
  await until(
    () => {
      bumps.note()
      if (!hitAt && b.shown.some((e) => e[0] === 'crashed' && e[1] === b.player)) hitAt = b.client.net.seq
      return hitAt > 0
    },
    8000,
    'the wall',
    [b],
  )
  await play(1200, [b], () => bumps.note())
  const wall = settle(bumps.seen, hitAt - inSteps(lag * 2 + 100))
  check(
    wall.steps <= inSteps(200),
    `${lag} ms: after hitting a wall the prediction settles within 200 ms (${wall.count} corrections over ${wall.steps} steps, ${Math.round(wall.ms)} ms)`,
  )
  b.link.close()

  results.push(
    `${String(lag).padStart(3)} ms each way ±10: grid drift ${drift.toFixed(3)} m (${lead.toFixed(3)} m by GO), ${held} corrections; 20 s drive ${drive.corrections} corrections, max error ${drive.maxError.toFixed(3)} m, ${drive.repeats} inputs the server had to repeat, ${drive.drops} dropped; ` +
      `rocket shove ${shove.count} corrections over ${shove.steps} steps (${Math.round(shove.ms)} ms); wall hit ${wall.count} corrections over ${wall.steps} steps (${Math.round(wall.ms)} ms); replayed ${a.client.prediction.replayed + b.client.prediction.replayed} steps in all`,
  )
  await server.close()
}

// --- the others where they're drawn, and hits where they're seen ---------------------------------------------

// A target crosses 30 m in front of a stationary shooter at ~25 m/s. The
// shooter's page draws it a little in the past; the shooter fires one round
// at it as drawn, the step it passes straight ahead. Also measured the whole
// way: how far the drawn target is from where the server had it at the
// tick it's drawn at, and how far behind the server's present that tick is.
async function crossing(shooter: Browser, room: Room, target: Combatant, compensate: boolean) {
  room.flags.compensate = compensate
  const me = room.combatants[shooter.player.id]
  const start = me.position.x - 140
  placeCar(target.car, { x: start, y: 0, z: me.position.z + 30 }, Math.PI / 2)
  target.car.body.setLinvel({ x: 25, y: 0, z: 0 }, true)
  Object.assign(target.control, { throttle: 1, steer: 0, handbrake: false, fire: false })
  const drawn = shooter.combatants[target.id]
  const [early, late] = [new THREE.Vector3(), new THREE.Vector3()]
  const errors: number[] = []
  const behind: number[] = []
  const before = shooter.shown.length
  let firedAt = 0 // ms, for the rough link's stall cycle
  let firedStep = 0
  let speed = 0
  const end = shooter.client.net.seq + inSteps(9000)
  while (shooter.client.net.seq < end && (!firedAt || shooter.client.net.seq - firedStep < inSteps(600))) {
    await play(20, [shooter], (b) => {
      b.control.fire = false
      const tick = b.client.net.drawn
      const t = Math.floor(tick)
      if (room.rewind.where(target.id, t, early) && room.rewind.where(target.id, t + 1, late) && early.x > start + 20 && early.distanceTo(late) < 10) {
        early.lerp(late, tick - t)
        errors.push(Math.hypot(drawn.position.x - early.x, drawn.position.z - early.z))
        behind.push(((room.tick - tick) * 1000) / 60)
      }
      const onLane = Math.abs(drawn.position.z - (me.position.z + 30)) < 2 && drawn.position.x < me.position.x + 10
      if (!firedAt && onLane && drawn.position.x >= me.position.x) {
        b.control.aim.set(drawn.position.x, drawn.position.y + 1, drawn.position.z)
        b.control.fire = true
        firedAt = performance.now()
        firedStep = b.client.net.seq
        speed = Math.hypot(drawn.velocity.x, drawn.velocity.z)
      }
    })
  }
  const round = shooter.shown.slice(before).find((e) => e[0] === 'shot' && e[1] === shooter.player)
  Object.assign(target.control, { throttle: 0, handbrake: true })
  return { hit: !!round && round[4] === drawn, fired: !!round, errors, behind, speed, firedAt, seq: firedStep + 1 } // seq: the input that fired
}

const average = (list: number[]) => list.reduce((x, y) => x + y, 0) / Math.max(1, list.length)
const hits: string[] = []
for (const lag of [75, 150]) {
  const server = createGameServer({ port: 0, key: KEY, origins: [ORIGIN], maxRooms: 2, lag, jitter: 10, arenaFor: () => open, log: () => {} })
  const port = await server.listen()
  const shooter = await browser({ port, key: KEY, origin: ORIGIN, uid: `shooter${lag}`, arena: open })
  const room = server.seating.rooms[0]
  stillBots(room)
  Object.assign(shooter.control, { throttle: 0, handbrake: true })
  await until(() => room.mode.rules.phase === 'active', 6000, 'GO', [shooter])
  await play(500, [shooter])
  const target = room.combatants.find((c) => c.team !== room.combatants[shooter.player.id].team)!
  const on = await crossing(shooter, room, target, true)
  target.health = target.maxHealth
  const off = await crossing(shooter, room, target, false)
  const rtt = lag * 2
  const line = `${String(rtt).padStart(3)} ms round trip (${lag} each way ±10): target at ${on.speed.toFixed(1)} m/s drawn ${Math.round(average(on.behind))} ms behind the server; drawn vs the server at that tick ${average(on.errors).toFixed(3)} m average, ${Math.max(...on.errors).toFixed(3)} m worst; one round at it as drawn: ${on.hit ? 'hit' : 'miss'} with compensation, ${off.hit ? 'hit' : 'miss'} without`
  hits.push(
    `${line}; the others drawn past the newest snapshot ${((100 * shooter.client.drawing.extrapolated) / Math.max(1, shooter.client.drawing.sampled)).toFixed(1)} % of the time`,
  )
  check(on.fired && off.fired, `${rtt} ms: both rounds were fired`)
  check(
    Math.max(...on.errors, ...off.errors) < 0.5,
    `${rtt} ms: the target is drawn where the server had it at the tick drawn (within 0.5 m, a step at top speed; worst ${Math.max(...on.errors, ...off.errors).toFixed(3)} m)`,
  )
  if (lag === 75) {
    check(on.hit, `${rtt} ms: aimed where it’s drawn, a round at a target crossing at 25 m/s hits with compensation`)
    check(!off.hit, `${rtt} ms: and misses without it`)

    // A forged view: a round aimed where the target was most of a second ago, claiming to see that tick, is judged 200 ms back at most.
    room.flags.compensate = true
    placeCar(target.car, { x: room.combatants[shooter.player.id].position.x - 140, y: 0, z: room.combatants[shooter.player.id].position.z + 30 }, Math.PI / 2)
    target.car.body.setLinvel({ x: 25, y: 0, z: 0 }, true)
    Object.assign(target.control, { throttle: 1, handbrake: false })
    await play(3000, [shooter])
    const ghostTick = room.tick - 50
    const ghost = new THREE.Vector3()
    check(room.rewind.where(target.id, ghostTick, ghost), 'the server keeps the poses of most of a second')
    const before = shooter.shown.length
    shooter.link.send(
      inputMessage(
        ++shooter.client.net.seq,
        { throttle: 0, steer: 0, handbrake: true, fire: true, recover: false, aim: { x: ghost.x, y: ghost.y + 1, z: ghost.z } },
        ghostTick,
      ),
    )
    await play(600, [shooter])
    const human = room.humans.find((h) => h.seat === shooter.player.id)!
    const round = shooter.shown.slice(before).find((e) => e[0] === 'shot' && e[1] === shooter.player)
    check(!!round && round[4] !== shooter.combatants[target.id], 'a forged view 830 ms old is held to 200 ms: no hit on a ghost')
    check(room.tick - human.view <= 12 + 2, `the view the server keeps for the forger is at most 200 ms old (${room.tick - human.view} ticks)`)
  }
  await server.close()
}
for (const line of hits) console.log(line)

// --- the second vehicle --------------------------------------------------------------------------------------

// The hauler (testVehicle.ts: heavier, wider, longer, on bigger wheels), at
// 100 ms each way: the page predicts the body the server seated it in, as
// exactly as the Razor's.
{
  const removeHauler = addHauler()
  const lag = 100
  const server = createGameServer({ port: 0, key: KEY, origins: [ORIGIN], maxRooms: 2, lag, jitter: 10, arenaFor: () => open, log: () => {} })
  const port = await server.listen()
  const h = await browser({ port, key: KEY, origin: ORIGIN, uid: 'hauler', arena: open, vehicle: HAULER })
  const room = server.seating.rooms[0]
  stillBots(room)
  const seat = room.combatants[h.player.id]
  check(
    h.player.vehicle === HAULER && seat.vehicle === HAULER && h.player.car.chassis === VEHICLES[HAULER].chassis,
    'the second vehicle: the server seats the player in the one they chose, and the page builds and predicts it',
  )
  const corrections = watchCorrections(h)
  const human = room.humans[0]
  // Counted as for the Razor's drive above: corrections from GO, late and dropped inputs from the countdown's
  // last second. A correction on the grid isn't the drive's: where the person's vehicle replaced the bot's at
  // the join, the new body is still settling from placeCar's lift as the page's first inputs come back.
  let late: { repeats: number; drops: number } | null = null
  await until(
    () => {
      corrections.note()
      if (!late && room.mode.rules.now >= room.mode.timing.preMatch - 1) late = { repeats: human.repeats, drops: human.drops }
      return room.mode.rules.phase === 'active'
    },
    6000,
    'GO in the hauler',
    [h],
  )
  const held = corrections.seen.length
  const before = { corrections: held, ...late! }
  h.client.prediction.maxError = 0
  const spawn = h.player.position.clone()
  const go = performance.now()
  await play(15_000, [h], (b) => {
    Object.assign(b.control, script((performance.now() - go) / 1000))
    corrections.note()
  })
  const drive = {
    corrections: corrections.seen.length - before.corrections,
    maxError: h.client.prediction.maxError,
    repeats: human.repeats - before.repeats,
    drops: human.drops - before.drops,
    travelled: h.player.position.distanceTo(spawn),
  }
  check(
    drive.travelled > 30 && drive.corrections <= drive.repeats + drive.drops,
    `the hauler at ${lag} ms: 15 s of driving (${drive.travelled.toFixed(0)} m), every correction from an input the network delivered late or dropped (${drive.corrections} corrections; ${drive.repeats} late, ${drive.drops} dropped)`,
  )
  check(
    drive.repeats + drive.drops > 0 || drive.maxError < 0.05,
    `the hauler at ${lag} ms: with every input on time the prediction is exact to the wire’s rounding (${drive.maxError.toFixed(3)} m)`,
  )
  results.push(
    `the hauler, ${lag} ms each way ±10: ${held} corrections on the grid; 15 s drive ${drive.corrections} corrections, max error ${drive.maxError.toFixed(3)} m, ${drive.repeats} inputs the server had to repeat, ${drive.drops} dropped`,
  )
  h.link.close()
  await server.close()
  removeHauler()
}

// --- a rougher network: the server's queue of a page's inputs ---------------------------------------------------

// 75 ms each way ±10, and a 150 ms stall every 5 s, both ways. A stall
// leaves a burst of a page's inputs queued on the server, and nothing would
// drain it while the page keeps pace: every input after waits longer, the
// tick it says it saw ages against the rewind's 200 ms, and a shot the page
// lines up misses. The room drains standing inputs (room.ts DRAIN). Measured
// over 20 s of driving: the queue's depth, how soon it's back to 1 after each
// burst, repeats, drops, corrections; then two crossing shots, printed with
// when they were fired and how many inputs waited ahead of theirs: in a
// stall's wake (the page draws the target from stale snapshots) a shot
// waits behind the burst and may miss. Away from one, nothing is judged: on
// this link its input is used 15–17 steps after the tick it saw, past the
// rewind's 12, so a step of lag more or less (a loaded machine) decides the
// hit, and inputs arriving in clumps move its place in the queue. The drain
// is held by the depth and the recovery; hits by the 150 ms round trip above.
{
  const STALL = { every: 5000, for: 150 }
  const created = performance.now()
  const server = createGameServer({ port: 0, key: KEY, origins: [ORIGIN], maxRooms: 2, lag: 75, jitter: 10, stall: STALL, arenaFor: () => open, log: () => {} })
  const port = await server.listen()
  const a = await browser({ port, key: KEY, origin: ORIGIN, uid: 'rough', arena: open })
  const room = server.seating.rooms[0]
  stillBots(room)
  await until(() => room.mode.rules.phase === 'active', 6000, 'GO', [a])
  const human = room.humans.find((h) => h.seat === a.player.id)!
  const start = { repeats: human.repeats, drops: human.drops, corrections: a.client.prediction.corrections }
  human.depths.fill(0)
  // The queue's depth after each of the room's steps, where the drain acts.
  // (Read from the page's frames instead, it lands at any point between two
  // steps and reads one or two more on a loaded machine.)
  const seen: Array<{ at: number; depth: number }> = []
  const step = room.step
  const go = performance.now()
  room.step = (now) => {
    step(now)
    seen.push({ at: performance.now() - go, depth: human.queue.length })
  }
  await play(20_000, [a], (b) => Object.assign(b.control, script((performance.now() - go) / 1000)))
  room.step = step
  const depth = queueDepth(human)
  // after each burst (4 or more waiting), how many of the room's steps until
  // 1 or none wait again: three of its 30-step drain windows at most (a
  // burst that lands mid-window takes the rest of it, a whole one to trim
  // the burst, and, on a loaded machine where inputs arrive in clumps, part
  // of a third to dip to 1)
  let recovery = 0
  let recoveryMs = 0
  for (let n = 0; n < seen.length; n++) {
    if (seen[n].depth < 4 || (n > 0 && seen[n - 1].depth >= 4)) continue
    let m = n
    while (m < seen.length && seen[m].depth > 1) m++
    const back = Math.min(m, seen.length - 1)
    recovery = Math.max(recovery, back - n)
    recoveryMs = Math.max(recoveryMs, seen[back].at - seen[n].at)
  }
  // the deepest in each 250 ms, for the log
  const trace = Array.from({ length: 80 }, (_, q) => Math.max(0, ...seen.filter((x) => x.at >= q * 250 && x.at < (q + 1) * 250).map((x) => x.depth)))
  Object.assign(a.control, { throttle: 0, steer: 0, handbrake: true })
  await play(1500, [a])
  const target = room.combatants.find((c) => c.team !== room.combatants[a.player.id].team)!
  const ahead = new Map<number, number>() // by seq: the inputs waiting in the queue when one that fires arrives
  const input = room.input
  room.input = (h, message, now) => {
    if (h === human && message.fire) ahead.set(message.seq, human.queue.length)
    return input(h, message, now)
  }
  const shots = [await crossing(a, room, target, true), await crossing(a, room, target, true)].map((shot) => ({
    ...shot,
    phase: (shot.firedAt - created) % STALL.every,
    ahead: ahead.get(shot.seq) ?? Infinity,
  }))
  room.input = input
  console.log(
    `rough link (75 ms each way ±10, a 150 ms stall every 5 s), 20 s of driving: queue depth p50 ${depth.p50}, p95 ${depth.p95}, max ${depth.max}; back to 1 within ${recovery} steps of a burst (${Math.round(recoveryMs)} ms); ` +
      `deepest in each 250 ms ${trace.join('')}; ${human.repeats - start.repeats} repeats, ${human.drops - start.drops} dropped, ${a.client.prediction.corrections - start.corrections} corrections; ` +
      `the crossing shots after: ${shots.map((shot) => `${shot.hit ? 'hit' : 'miss'} ${Math.round(shot.phase)} ms into a stall's cycle, ${shot.ahead} inputs ahead of it`).join(', ')}`,
  )
  check(depth.p50 <= 2, `rough link: the queue doesn't stand deep (depth p50 ${depth.p50}, p95 ${depth.p95}; it stood 4 deep without the drain)`)
  check(
    recovery <= 3 * 30,
    `rough link: after a stall's burst the queue is back to 1 within three drain windows, 90 steps (${recovery} steps, ${Math.round(recoveryMs)} ms)`,
  )
  await server.close()
}

for (const line of results) console.log(line)
describe('netplay', () => {
  it.each(checks)('%s', (_, ok) => expect(ok).toBe(true))
})
