import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { Arena } from '../game/arena/arena'
import { armWeapon, WEAPONS, type Shot } from '../game/combat'
import type { Feed, MatchMode } from '../game/mode'
import { MODES, type Mode } from '../game/modes'
import { createWorld } from '../game/physics'
import { enlist, type Combatant, type SimEvents } from '../game/simulation'
import { forwardSpeed } from '../game/vehicle/drive'
import { VEHICLES } from '../game/vehicle/vehicles'
import type { Link } from './connection'
import { createPrediction } from './prediction'
import { blankCar, inputMessage, RATE, readCar, readMe, readStats, weaponId, type CarState, type Snapshot, type State, type Welcome, type WireEvent } from './protocol'
import { createSnapshotBuffer } from './snapshots'

// A browser's copy of an online match, free of the DOM (the headless checks
// run it too): the line-up the server seated, in a local physics world, and
// a local mode whose rules only ever mirror the server's — never ticked,
// never asked to damage, kill or respawn anything. What the server sends is
// applied here: the machines (drawn a little in the past, between
// snapshots: snapshots.ts), the rules' state and statistics, who holds each
// seat, and the events, played into whoever presents them (view.ts through
// SimEvents, the feed through the mode's own report) when the drawing
// reaches them — the player's own at once. What the player does goes back
// as one input a step, and the player's own car runs ahead of the server's
// word on it (prediction.ts), put right when the word disagrees — eased out
// on screen, never on the body. Everything decided, the client only shows.

const TELEPORT = 5 // metres in one step: a respawn or a recovery, not driving
const CATCH_UP = 1000 // ms without taking messages (a hidden tab): skip the effects, show where things are now
const EASE = 0.035 // seconds: a correction's offset on screen falls to a third in this (gone in ~100 ms)

// The match as the welcome describes it, built locally: every machine on
// its seat's start — the others moved by the server's word alone
// (kinematic), the player's own driven here too — the mode on the same
// seed. `scene`: the browser's, for the mode's own scenery.
export function seatOnline(welcome: Welcome, arena: Arena, scene?: THREE.Scene) {
  const kind = welcome.mode as Mode
  const world = createWorld(arena.colliders)
  const seats = MODES[kind].lineUp(arena)
  const combatants = welcome.lineUp.map((seat, id) => enlist(world, id, { name: seat.name, team: seat.team, seed: id + 1, spawn: seats[id].spawn, vehicle: seat.vehicle, weapon: WEAPONS[seat.weapon], bot: false }))
  for (const c of combatants) if (c.id !== welcome.seat) c.car.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
  const mode = MODES[kind].create({ combatants, arena, world, seed: welcome.seed, scene })
  return { kind, world, combatants, player: combatants[welcome.seat], mode }
}

export interface ClientOptions {
  link: Link
  world: RAPIER.World
  combatants: readonly Combatant[]
  player: Combatant
  mode: MatchMode
  events: SimEvents // where the server's events are shown (the view; nothing headless)
  feed?: Feed // where the rules' events are announced
  refit?: (c: Combatant) => void // a seat changed guns: its turret must change too
  restarted?: (seed: number) => void // the room started its next match
}

export type NetClient = ReturnType<typeof createNetClient>

export function createNetClient({ link, world, combatants, player, mode, events, feed, refit, restarted }: ClientOptions) {
  const { rules } = mode
  const buffer = createSnapshotBuffer(combatants.length)
  const latest = combatants.map(() => blankCar()) // each machine in the newest snapshot
  const shown = blankCar() // one machine as drawn
  const humans = link.welcome.lineUp.map((seat) => seat.human)
  const uids = link.welcome.lineUp.map((seat) => seat.uid) // by seat: the person's user id, '' a bot's (chat's whispers)
  const shownWrecked = combatants.map(() => false) // what the view shows: a catch-up puts it right
  const net = { tick: link.welcome.tick, arrivedAt: -Infinity, drawn: 0, snapshots: 0, seq: 0, ack: -1, next: -1, hold: -1, lost: '' }
  const later: WireEvent[] = [] // events waiting for the drawing to reach their tick
  let clockFloor = 0 // the rules' clock only runs forward, until the next match
  let serverNow = 0
  let lastTaken = -Infinity
  // The player's car, predicted while it drives (shown as the server has it while it's a wreck).
  const prediction = createPrediction(world, player.car)
  let predicting = true
  let hard = true // the next word on the player's car is taken as it is: the first, a respawn, a recovery, a new match
  const truth = { position: new THREE.Vector3(), rotation: new THREE.Quaternion(), lastPosition: new THREE.Vector3(), lastRotation: new THREE.Quaternion() } // the predicted poses, before easing
  const offset = { position: new THREE.Vector3(), rotation: new THREE.Quaternion() } // what's left of the last correction on screen
  let placedAt = -1

  // --- what the server says ------------------------------------------------------------------------

  // Takes everything that has arrived, in order. After a long gap (the tab
  // was hidden) it catches up: the effects in between are dropped, wrecks
  // and respawns shown as they stand now, the rules' events all kept.
  function receive(now: number) {
    const messages = link.take()
    const catchUp = now - lastTaken > CATCH_UP
    lastTaken = now
    if (catchUp) later.length = 0
    for (const { message, at } of messages) {
      if (message.t === 's') snapshot(message, at, catchUp)
      else if (message.t === 'st') state(message)
      else if (message.t === 'ro') roster(message.seat, message.name, message.human, message.weapon, message.uid)
    }
    if (catchUp) settle()
    net.lost = link.status.closed
  }

  function snapshot(s: Snapshot, now: number, catchUp: boolean) {
    for (const row of s.cars) if (combatants[row[0]]) readCar(row, latest[row[0]])
    buffer.push(s.k, now, (cars) => {
      for (const row of s.cars) if (cars[row[0]]) readCar(row, cars[row[0]])
    })
    player.health = latest[player.id].health
    player.alive = latest[player.id].alive
    net.snapshots++
    net.tick = s.k
    net.arrivedAt = now
    net.ack = s.ack
    serverNow = s.now / 1000
    const me = readMe(s.me)
    Object.assign(player.weapon, { ammo: me.ammo, reload: me.reload, cooldown: me.cooldown })
    player.stuck = me.stuck
    player.recovery = me.recovery
    for (const event of s.ev) {
      if (catchUp) play(event, true)
      else if (event[0] === 'ru' || event[0] === 'go' || mine(event)) play(event, false)
      else later.push(event)
    }
    mode.report(feed)
    reconcile(latest[player.id], me)
  }

  // The player's own events show at once: a hit they take or land, a round
  // they fire. The rest wait for the others to be drawn where they happened.
  function mine([code, , ...f]: WireEvent) {
    const me = player.id
    switch (code) {
      case 'sh':
        return f[0] === me || f[11] === me
      case 'hu':
      case 'wr':
        return f[0] === me || f[1] === me
      case 'ln':
      case 'cr':
      case 'rl':
      case 'sp':
      case 'rc':
        return f[0] === me
    }
    return false
  }

  // The server's word on the player's car against the prediction.
  function reconcile(server: CarState, me: ReturnType<typeof readMe>) {
    const { body } = player.car
    if (predicting && !server.alive) {
      predicting = false // a wreck tumbles as the server throws it
      body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
      prediction.forget()
    }
    if (!predicting && server.alive) {
      predicting = true
      hard = true
      body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
    }
    if (!predicting) return
    // Until the server has used one of this page's inputs the machine isn't
    // the player's yet — a bot drives it while the page loads — so its word
    // is taken whole, and the player takes over wherever the bot left it.
    const firm = hard || net.ack < 0
    const before = { position: truth.position.clone(), rotation: truth.rotation.clone() }
    if (!prediction.reconcile(net.ack, server, me, firm)) return
    readTruth()
    if (firm) {
      truth.lastPosition.copy(truth.position)
      truth.lastRotation.copy(truth.rotation)
      offset.position.set(0, 0, 0)
      offset.rotation.identity()
    } else {
      // on screen the car stays where it was, and eases over to the corrected place
      const moved = truth.position.clone().sub(before.position)
      const turned = truth.rotation.clone().multiply(before.rotation.clone().invert())
      truth.lastPosition.add(moved)
      truth.lastRotation.premultiply(turned)
      offset.position.sub(moved)
      offset.rotation.multiply(turned.invert())
    }
    hard = false
  }

  function readTruth() {
    const { body } = player.car
    truth.position.copy(body.translation() as THREE.Vector3)
    truth.rotation.copy(body.rotation() as THREE.Quaternion)
    player.velocity.copy(body.linvel() as THREE.Vector3)
    player.speed = forwardSpeed(player.car)
  }

  function state(st: State) {
    mode.mirror(st.rules)
    st.stats.forEach((row, id) => combatants[id] && readStats(row, combatants[id].stats))
    net.next = st.next
    net.hold = st.hold
  }

  function roster(seat: number, name: string, human: boolean, weapon: keyof typeof WEAPONS, uid: string) {
    const c = combatants[seat]
    if (!c) return
    // people coming and going, in the feed (the player's own seat never changes hands)
    if (human !== humans[seat] && c !== player) feed?.news(human ? `${name} joined` : `${c.name} left`, human ? '' : 'A bot takes over')
    c.name = name
    humans[seat] = human
    uids[seat] = uid
    if (weaponId(c.weapon.spec) === weapon) return
    c.weapon = armWeapon(WEAPONS[weapon])
    refit?.(c)
  }

  // --- the server's events, into the local presenters -------------------------------------------------------

  const muzzle = new THREE.Vector3()
  const heading = new THREE.Vector3()
  const from = new THREE.Vector3()
  const at = new THREE.Vector3()
  const shot: Shot = { point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null }
  let ground: RAPIER.Collider | null = null // something solid for a round that struck the arena (the view only asks whether it struck)
  world.forEachCollider((collider) => void (ground ??= collider))
  const cm = (v: THREE.Vector3, x: unknown, y: unknown, z: unknown) => v.set((x as number) / 100, (y as number) / 100, (z as number) / 100)

  // The player's rounds leave the gun where it's drawn (the car runs ahead of the server's).
  function fromOwnGun(toward: THREE.Vector3) {
    const { mount, barrel } = VEHICLES[player.vehicle].turret
    muzzle.set(mount[0], mount[1], mount[2]).applyQuaternion(player.rotation).add(player.position)
    heading.copy(toward).normalize()
    muzzle.addScaledVector(heading, barrel)
  }

  function play([code, , ...f]: WireEvent, catchUp: boolean) {
    const who = (i: number) => combatants[f[i] as number]
    switch (code) {
      case 'ru':
        return void rules.events.push(f[0])
      case 'go': {
        const seed = f[0] as number
        clockFloor = 0
        hard = true
        later.length = 0
        mode.restart(seed)
        return restarted?.(seed)
      }
      case 'wr':
        if (!catchUp) show(who(0), true, who(1))
        return
      case 'sp':
        if (who(0) === player) hard = true
        if (!catchUp) show(who(0), false)
        return
      case 'rc':
        if (who(0) === player) hard = true
        break
    }
    if (catchUp) return // the rest are effects: gone by now
    switch (code) {
      case 'sh': {
        const shooter = who(0)
        const victim = (f[11] as number) >= 0 ? who(11) : undefined
        cm(muzzle, f[1], f[2], f[3])
        cm(shot.point, f[4], f[5], f[6])
        shot.normal.set((f[7] as number) / 100, (f[8] as number) / 100, (f[9] as number) / 100)
        shot.collider = f[10] ? (victim?.car.body.collider(0) ?? ground) : null
        if (shooter === player) fromOwnGun(heading.subVectors(shot.point, muzzle))
        else heading.subVectors(shot.point, muzzle).normalize()
        events.fired(shooter, muzzle, heading)
        return events.shot(shooter, muzzle, shot, victim)
      }
      case 'ln':
        cm(muzzle, f[1], f[2], f[3])
        heading.set((f[4] as number) / 1e4, (f[5] as number) / 1e4, (f[6] as number) / 1e4)
        if (who(0) === player) fromOwnGun(heading)
        return events.fired(who(0), muzzle, heading)
      case 'rk':
        return events.rocket(cm(from, f[0], f[1], f[2]), cm(at, f[3], f[4], f[5]))
      case 'bu':
        return events.burst(cm(at, f[0], f[1], f[2]))
      case 'hu':
        return events.hurt(who(0), who(1))
      case 'cr':
        return events.crashed(who(0), (f[1] as number) / 100, (f[2] as number) / 100, (f[3] as number) / 100)
      case 'rl':
        return events.reloading(who(0), f[1] === 1)
      case 'rc':
        return events.recovered(who(0))
    }
  }

  function show(c: Combatant, wrecked: boolean, by: Combatant = c) {
    if (!c || shownWrecked[c.id] === wrecked) return
    shownWrecked[c.id] = wrecked
    if (wrecked) events.wrecked(c, by)
    else events.respawned(c)
  }

  // After a catch-up: every machine shown whole or wrecked as the newest snapshot has it.
  function settle() {
    for (const c of combatants) show(c, !latest[c.id].alive)
  }

  // --- the machines where they're shown ---------------------------------------------------------------------

  // Every machine where it's drawn at `now` (ms): the others from the
  // snapshots, DELAY behind the server (their controls, hulls and aims as
  // they were then, too), the events that reach that tick played; the
  // player's car where the prediction has it (its last two local steps, which
  // the view interpolates, and what's left of a correction) — or, a wreck,
  // as the newest snapshot has it. The rules' clock runs on from the newest
  // snapshot's, a little way at most (not while the room holds its first
  // match for its people's pages), never backwards.
  const still = new THREE.Quaternion()
  function place(now: number) {
    const tick = (net.drawn = buffer.clock(now))
    const ease = placedAt < 0 ? 1 : Math.exp(-Math.max(0, now - placedAt) / 1000 / EASE)
    placedAt = now
    offset.position.multiplyScalar(ease)
    offset.rotation.slerp(still, 1 - ease)
    for (const c of combatants) {
      if (c === player && predicting) {
        c.position.copy(truth.position).add(offset.position)
        c.last.position.copy(truth.lastPosition).add(offset.position)
        c.rotation.copy(offset.rotation).multiply(truth.rotation)
        c.last.rotation.copy(offset.rotation).multiply(truth.lastRotation)
        c.last.velocity.copy(c.velocity)
        continue
      }
      const car = buffer.sample(c.id, c === player ? buffer.newest : tick, shown)
      c.position.set(car.position.x, car.position.y, car.position.z)
      c.rotation.set(car.rotation.x, car.rotation.y, car.rotation.z, car.rotation.w)
      c.velocity.set(car.velocity.x, car.velocity.y, car.velocity.z)
      c.speed = car.speed
      c.last.position.copy(c.position)
      c.last.rotation.copy(c.rotation)
      c.last.velocity.copy(c.velocity)
      if (c === player) continue
      c.health = car.health
      c.alive = car.alive
      Object.assign(c.control, { throttle: car.throttle, handbrake: car.handbrake, fire: car.fire && car.alive })
      c.control.aim.set(car.aim.x, car.aim.y, car.aim.z)
      c.car.steer = car.steer
    }
    let played = false
    while (later.length && (later[0][1] as number) <= tick) {
      play(later.shift()!, false)
      played = true
    }
    if (played) mode.report(feed)
    clockFloor = Math.max(clockFloor, serverNow + (net.hold >= 0 ? 0 : Math.min(Math.max(now - net.arrivedAt, 0), 100) / 1000))
    Object.assign(rules, { now: clockFloor })
  }

  // One local step: the player's controls to the server (with the tick the
  // others are drawn at) and into the predicted car; every other body where
  // its machine is drawn (so the crosshair and sight lines hit what the
  // player sees), its wheels turned to its steering; the world stepped.
  function step(dt: number, control: Combatant['control']) {
    const seq = ++net.seq
    link.send(inputMessage(seq, control, Math.round(net.drawn)))
    // driven as the server will read it: to the wire's hundredths
    if (predicting) prediction.drive(seq, { throttle: Math.round(control.throttle * 100) / 100, steer: Math.round(control.steer * 100) / 100, handbrake: control.handbrake }, held(seq), mode.speedFactor(player.id), dt)
    for (const c of combatants) {
      c.deadFor = c.alive ? 0 : c.deadFor + dt
      if (c === player && predicting) continue
      const { body, controller } = c.car
      if (c.position.distanceTo(body.translation() as THREE.Vector3) > TELEPORT) {
        body.setTranslation(c.position, false)
        body.setRotation(c.rotation, false)
      }
      body.setNextKinematicTranslation(c.position)
      body.setNextKinematicRotation(c.rotation)
      controller.setWheelSteering(0, c.car.steer)
      controller.setWheelSteering(1, c.car.steer)
      controller.updateVehicle(dt) // suspension and spin for the view; a kinematic body takes no push
    }
    world.step()
    if (!predicting) return
    prediction.settled(seq)
    truth.lastPosition.copy(truth.position)
    truth.lastRotation.copy(truth.rotation)
    readTruth()
  }

  // Whether the server will hold the car on the step that uses input
  // `seq`: once the match is over, and on the grid — up to and including
  // the step whose clock tick reaches GO (the simulation reads the phase as
  // the step starts). The clock counts whole steps from 0, so the server's
  // count is the snapshot clock's in steps, and the step GO falls on is
  // found by adding up steps the way its rules do. Input `seq` is used
  // (seq − ack) steps after the snapshot's, the inputs queued before it
  // first.
  let goStep = -1
  function held(seq: number) {
    if (net.next >= 0) return true
    if (rules.phase !== 'preMatch') return false
    if (goStep < 0) {
      let clock = 0
      for (goStep = 0; clock < mode.timing.preMatch; goStep++) clock += 1 / RATE.step
    }
    return Math.round(serverNow * RATE.step) + seq - Math.max(net.ack, 0) <= goStep
  }

  // Seconds until the room reaches `tick`, from the newest snapshot; Infinity for none (-1).
  const untilTick = (tick: number, now: number) => (tick < 0 ? Infinity : Math.max(0, (tick - net.tick) / RATE.step - (now - net.arrivedAt) / 1000))

  return {
    net,
    prediction: prediction.stats, // corrections, replays, errors: the F3 overlay's
    drawing: buffer.counts, // how often the others were drawn past the newest snapshot
    humans, // by seat: a person drives it
    uids, // by seat: that person's user id ('' a bot)
    receive,
    place,
    step,
    // Seconds until the room's next match; Infinity while this one runs.
    nextIn: (now: number) => untilTick(net.next, now),
    // Seconds the room's first match waits at most for its people's pages; Infinity once it isn't waiting.
    holdIn: (now: number) => untilTick(net.hold, now),
    close: () => link.close(),
  }
}
