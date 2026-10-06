import { randomBytes } from 'node:crypto'
import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { botGun, createBrain, DIFFICULTIES } from '../src/game/ai'
import { armWeapon, WEAPONS, type WeaponId } from '../src/game/combat'
import type { Loadout } from '../src/game/loadout'
import type { Arena } from '../src/game/arena/arena'
import type { MapId } from '../src/game/maps'
import { classic, type MatchSettings } from '../src/game/matchSettings'
import { MODES, type Mode } from '../src/game/modes'
import { createWorld, PHYSICS_STEP } from '../src/game/physics'
import { botName, recruits, type SeatPlan } from '../src/game/roster'
import { createSimulation, enlist, type Combatant } from '../src/game/simulation'
import { arenaDigest } from '../src/game/arena/digest'
import { carRow, clampAim, clampView, meRow, packCars, packEvents, packSnapshot, PROTOCOL, RATE, STAT_KEYS, statsRow, weaponId, acceptSeq, type ErrorCode, type Input, type ServerMessage } from '../src/net/protocol'
import { arenaData } from './arenas'
import { createFairPlay, type FairFlag, type FairTally, type Point, type Target } from './fairplay'
import { createRecorder } from './recorder'
import { createRewind } from './rewind'

// One online match: its own physics world, the line-up (roster.ts — bots in
// every seat until people take them over), the running mode, and the very
// simulation a practice match runs, stepped by the server's loop. People
// only ever send controls: each step a seat's next input is written into
// its machine's controls, and the simulation decides the rest. Every second
// step the room tells everyone what happened (a snapshot); the rules' state
// goes out when it changes. When the mode says the match is over, everyone
// stands down; after the results the next match starts with a fresh seed.
// A room matchmaking made (lobby.ts) holds its first match until every
// person seated has loaded it — their page's first input — or `hold` runs
// out: nothing moves meanwhile, and a seat whose page is late is its bot's
// until it comes (the takeover, as for anyone joining).
// Every person's aim is watched for signs of aim help (fairplay.ts); each
// match that ends is written down (`record`), and everything a replay needs
// to run the room again goes out line by line (`journal`: seats taken and
// left, each person's input as the room used it, the next match's seed).
// A custom lobby's room (`lobby`) is made from the lobby's seat plan: bots
// only where the owner put them, each person in their own slot's seat, the
// other seats empty; a person who leaves leaves an empty seat, never a bot;
// Classic never sees it; and after its results the lobby hears the match is
// over (`over`) instead of a next match starting.

export const SKILL = DIFFICULTIES.normal // the bots' online
const QUEUE = 6 // inputs kept per player; past this the oldest go (latency capped)
// A drain window, in steps. A stall on the way leaves a burst of inputs
// queued, and while the page keeps pace nothing would ever empty the queue
// again: every input after waits that much longer, and the tick it says it
// saw ages against the rewind's 200 ms (measured: 4–5 deep for good after
// the first stall, NET_LOG.md). So inputs that waited through a whole window
// — beyond one kept for the jitter — are standing delay, not jitter, and are
// let go at the window's end (drops: one correction's worth). A queue that
// ran down to one or none in the window is absorbing jitter, and is left alone.
const DRAIN = 30
const STALE = 250 // ms without input: the machine coasts, trigger off
const ABANDON = 10_000 // ms a custom room's match runs with no person seated before it ends without a result
const IDLE = 60_000 // ms without input: the player is let go and a bot takes the seat (a custom room: back to the lobby's waiting room)
const SHARE = 12 // steps between checks for a changed rules state
const NEUTRAL = { throttle: 0, steer: 0, handbrake: false, fire: false, recover: false }
const STAND_DOWN = { ...NEUTRAL, handbrake: true }
const EYE = 1.6 // metres over a machine where its page's lock-on looks from: the chase camera's pivot (camera.ts)
const CAMERA = { back: 8.5, up: 1.7 } // and the camera itself, behind the pivot along the aim and raised

const freshSeed = () => randomBytes(4).readUInt32LE(0)
// A chat channel's name (Nakama room channels: net/chat.ts, nakama/data/modules/chat.lua):
// unguessable, since a room channel lets in whoever knows its name.
export const channel = () => `sy-${randomBytes(12).toString('hex')}`

// A person in a seat.
export interface Human {
  uid: string
  name: string
  seat: number
  send(data: string | Uint8Array): void // a message, serialised: JSON text, or a binary snapshot
  close(code: ErrorCode, text: string): void // let the player go (the socket closes; the lobby frees the seat)
  queue: Input[]
  last: Input | null // repeated while the queue is dry; null until the first: a bot still drives the machine
  repeats: number // steps that had to repeat the last input (the queue ran dry)
  drops: number // inputs let go unused (the queue grew too long)
  depths: number[] // steps by how many inputs still waited after the step took its own: 0..QUEUE
  low: number // the fewest inputs waiting after a step, this drain window
  window: number // steps into it
  seq: number // the newest seq taken in
  ack: number // the last seq used on a step
  heardAt: number // ms: when the latest input arrived
  view: number // the tick the player last said it sees (clamped)
  forced?: Given | null // a replay's: what the seat is given on the next step (null: its bot still drives), in place of the queue
}

// What a person's machine is given on a step: their input as the room took
// it, and how: DRIVING (the input), STANDING (the match is over or held:
// standing down) or COASTING (their input went stale: neutral).
export const DRIVING = 0
export const STANDING = 1
export const COASTING = 2
export interface Given {
  kind: typeof DRIVING | typeof STANDING | typeof COASTING
  input: Pick<Input, 'throttle' | 'steer' | 'handbrake' | 'fire' | 'recover' | 'aim' | 'view'>
}

// A match that ended, as it's written down (records.ts) and as a replay of
// the room says it again (replay.ts). Times run on the room's own clock: the
// time it was made plus its steps.
export interface MatchRecord {
  room: string
  match: number // the room's matches, from 1
  mode: Mode
  map: MapId
  build: string
  seed: number
  started: string // ISO
  ended: string
  seconds: number
  winner: number | null // the winning team (free for all: the winner's own), null a draw
  seats: SeatRecord[]
  custom?: { lobby: string; settings: MatchSettings } // a custom lobby's match: kept for fair-play review, never for stats (its owner chose the bots and settings)
}

export interface SeatRecord {
  seat: number
  team: number
  name: string
  uid: string // the person's; '' a bot's
  weapon: WeaponId
  stats: Record<string, number> // STAT_KEYS, rounded as the wire rounds them
  fairplay?: { tally: FairTally; flags: FairFlag[] } // people only: since they took the seat
}

// A replay's lines (replay.ts): the room's header, then what happened after
// step `k` (a seat taken or left), what the people's machines were given on
// step `k` (only the seats whose given changed: [seat, kind, throttle, steer,
// handbrake, fire, recover, aim x, y, z, lag] — lag: steps the tick the page
// saw lies behind `k`, as it sent it; standing down or coasting, just [seat,
// kind]: the input isn't used), the seed a match started on,
// the end of match `end`, and the room closing after step `k`.
export type ReplayLine =
  | { replay: 1; protocol: number; build: string; room: string; mode: Mode; map: MapId; seed: number; created: number; hold: number; results: number; settings?: MatchSettings; lobby?: string; plan?: SeatPlan }
  | { k: number; join: [seat: number, uid: string, name: string, weapon: WeaponId] }
  | { k: number; leave: number }
  | { k: number; in: number[][] }
  | { k: number; go: number }
  | { k: number; end: number }
  | { k: number; close: 1 }

// How deep a person's input queue ran, step by step: each queued input is a
// step (17 ms) more between their keys and their machine, and a step less of
// the rewind's 200 ms for their aim.
export function queueDepth(human: Human) {
  const total = human.depths.reduce((sum, n) => sum + n, 0)
  const at = (share: number) => {
    let seen = 0
    for (const [depth, n] of human.depths.entries()) if ((seen += n) >= share * total) return depth
    return 0
  }
  return { p50: at(0.5), p95: at(0.95), max: human.depths.findLastIndex((n) => n > 0) }
}

export interface RoomOptions {
  id: string
  mode: Mode
  map: MapId
  build?: string // the pages' build: matchmaking offers its bot seats to pages of the same one
  hold?: number // steps the first match waits at most for the people seated to load it (a room made from a proposal)
  seed?: number // a fixed first seed (checks); fresh from node:crypto otherwise
  settings?: MatchSettings // how its matches are played; Classic's unless said
  results?: number // seconds the results stay up before the next match
  arena?: Arena // played on instead of the map's own (the netplay check's test yard)
  log?: (message: string, fields: Record<string, unknown>) => void
  created?: number // ms since the epoch: the room's clock starts here (a replay's, as recorded)
  reseed?: () => number // each next match's seed (a replay's, as recorded); fresh from node:crypto otherwise
  record?: (match: MatchRecord) => void // a match ended
  journal?: (line: ReplayLine) => void // what a replay needs, as it happens
  lobby?: string // a custom lobby's room: the lobby's id
  plan?: SeatPlan // its seats (roster.ts): whose each is, its bots, the empty ones
  chat?: string // the channel for everyone in the room (a custom lobby's own, so the talk carries on); a new one otherwise
  over?: (winner: number | null | undefined) => void // a custom room's match is over, results and all: the winning team (free for all: seat), null a draw, undefined abandoned
  idle?: (human: Human) => boolean // a custom room's person sent nothing for a minute: the lobby takes them out of the match, not off its socket (false: let go as anywhere)
}

export type Room = ReturnType<typeof createRoom>

export function createRoom({ id, mode: kind, map, build = '', hold = -1, seed: first, settings = classic(kind), results = 15, arena = arenaData(map), log = () => {}, created = Date.now(), reseed = freshSeed, record, journal, lobby, plan, chat: everyone, over, idle }: RoomOptions) {
  let seed = first ?? freshSeed()
  journal?.({ replay: 1, protocol: PROTOCOL, build, room: id, mode: kind, map, seed, created, hold, results, settings, ...(lobby && { lobby, plan }) })
  const digest = arenaDigest(arena)
  const world = createWorld(arena.colliders)
  const combatants = recruits(kind, arena, settings, seed, SKILL, undefined, plan).map((recruit, i) => enlist(world, i, recruit))
  const mode = MODES[kind].create({ combatants, arena, world, seed, settings })
  let tick = 0
  const recorder = createRecorder(() => tick)
  const humans: Human[] = []
  const rewind = createRewind(world, combatants)
  const fairplay = createFairPlay(combatants.length)
  const flags = { compensate: true } // lag compensation for people's hitscan (the netplay check turns it off to compare)
  // The simulation's events go out to the pages; a person's hit on a hostile is also the fair-play watch's.
  const events = { ...recorder.sim, hurt: (victim: Combatant, attacker: Combatant) => {
    recorder.sim.hurt(victim, attacker)
    if (attacker.team !== victim.team) fairplay.hit(attacker.id, victim.id, tick)
  } }
  // A person's round meets the others where that person's page drew them;
  // a bot's (a seat's bot too, until its person's first input), or one seen
  // in the present, is cast as it stands.
  const sim = createSimulation({
    world,
    arena,
    combatants,
    mode,
    events,
    seed,
    castRound(c, muzzle, shot, random) {
      if (!flags.compensate) return false
      const human = humans.find((h) => h.seat === c.id)
      return !!human?.last && human.view < tick - 1 && rewind.cast(c, muzzle, human.view, shot, random)
    },
  })
  plan?.forEach((seat, i) => seat || sim.vacate(combatants[i])) // nobody's: out of play until someone takes it
  let ended = false // a custom room's match is over: the lobby has heard
  let deserted = -1 // ms: when its match found itself without a person; -1 while someone is seated
  let next = -1 // the tick the next match starts at, once this one is over
  const full = mode.rules.remaining() // seconds on a match's clock
  let changed = true // the rules had events since the state last went out
  let sharedAt = -Infinity
  let lastState = ''
  let emptySince = 0 // ms
  const steps = { count: 0, total: 0, max: 0, recent: new Float64Array(3600) } // ms per step, the last minute kept
  let match = 1 // this room's matches, counted
  let startTick = 0 // the step this match began on
  const written = new Map<number, string>() // by seat: the given last put in the journal
  const clock = (at: number) => new Date(created + (at * 1000) / RATE.step).toISOString()

  const send = (to: Human, message: ServerMessage) => to.send(JSON.stringify(message))
  const personAt = (seat: number) => humans.find((h) => h.seat === seat)
  const lineUp = () => combatants.map((c) => ({ name: c.name, team: c.team, vehicle: c.vehicle, weapon: weaponId(c.weapon.spec), human: !!personAt(c.id), uid: personAt(c.id)?.uid ?? '', present: c.present }))
  // The room's chat: one channel for everyone, one per side in team deathmatch.
  const chat = { all: everyone ?? channel(), teams: new Map<number, string>() }
  const teamChannel = (team: number) => {
    if (kind !== 'tdm') return ''
    if (!chat.teams.has(team)) chat.teams.set(team, channel())
    return chat.teams.get(team)!
  }

  // --- the step ------------------------------------------------------------------------------

  function step(now: number) {
    tick++
    if (hold >= 0 && (tick >= hold || humans.every((h) => h.last))) release()
    const live = next < 0
    const given: number[][] = []
    for (const human of humans) {
      const g = drive(human, now, live && hold < 0)
      if (!g) continue
      if (journal) note(human.seat, g, given)
      if (g.kind === DRIVING) watch(human)
    }
    if (given.length) journal?.({ k: tick, in: given })
    if (hold < 0) {
      const started = performance.now()
      sim.step(PHYSICS_STEP, live)
      time(performance.now() - started)
    }
    rewind.record(tick)
    if (mode.rules.events.length) {
      recorder.rules(mode.rules.events)
      changed = true
    }
    mode.report() // drains the rules' events; each browser announces them for its own player
    if (live) {
      if (mode.outcome() !== undefined) finish()
    } else if (tick >= next) {
      if (lobby) end(mode.outcome())
      else restart()
    }
    if (lobby && live && !ended) {
      if (humans.length) deserted = -1
      else if (deserted < 0) deserted = now
      else if (now - deserted >= ABANDON) end(undefined) // nobody watches bots
    }
    if (tick % (RATE.step / RATE.snap) === 0) broadcast()
    for (const human of [...humans]) if (now - human.heardAt > IDLE && !idle?.(human)) human.close('idle', 'No input for a minute')
  }

  // The seat's next input into its machine's controls (the last one again
  // while none has come); neutral once the input is stale, standing down once
  // the match is over. Before the page's first input the bot drives on (null).
  // A replay gives the seat what the journal says instead of its queue.
  function drive(human: Human, now: number, live: boolean): Given | null {
    const c = combatants[human.seat]
    if (human.forced !== undefined) {
      const forced = human.forced
      if (!forced) return null
      if (!human.last) takeWheel(c)
      human.last = { t: 'in', seq: 0, ...forced.input }
      return give(human, c, forced)
    }
    const input = human.queue.shift()
    if (input) {
      if (!human.last) takeWheel(c)
      human.last = input
      human.ack = input.seq
    } else if (human.last) human.repeats++
    human.low = Math.min(human.low, human.queue.length)
    if (++human.window >= DRAIN) {
      const slack = Math.max(0, human.low - 1)
      human.queue.splice(0, slack)
      human.drops += slack
      human.low = Infinity
      human.window = 0
    }
    human.depths[human.queue.length]++
    const use = human.last
    if (!use) return null
    return give(human, c, { kind: !live ? STANDING : now - human.heardAt > STALE ? COASTING : DRIVING, input: use })
  }

  function give(human: Human, c: Combatant, given: Given) {
    const { kind, input } = given
    if (kind === STANDING) Object.assign(c.control, STAND_DOWN)
    else if (kind === COASTING) Object.assign(c.control, NEUTRAL)
    else {
      Object.assign(c.control, { throttle: input.throttle, steer: input.steer, handbrake: input.handbrake, fire: input.fire, recover: input.recover })
      clampAim(c.control.aim.copy(input.aim), c.position, c.weapon.spec.range)
      human.view = clampView(input.view, tick)
    }
    return given
  }

  // The given, into this step's journal line when the seat's has changed. The
  // view goes as how far it lies behind the step: a page steady on its link
  // sends the same controls with the same lag, which then needs no line. A
  // machine standing down or coasting uses none of its input: just the kind.
  function note(seat: number, { kind, input: i }: Given, into: number[][]) {
    const row = kind === DRIVING ? [seat, kind, i.throttle, i.steer, +i.handbrake, +i.fire, +i.recover, i.aim.x, i.aim.y, i.aim.z, tick - i.view] : [seat, kind]
    const text = row.join()
    if (written.get(seat) === text) return
    written.set(seat, text)
    into.push(row)
  }

  // A person's aim, to the fair-play watch: from the car's roof and from the
  // chase camera behind it, at the hostiles as their page drew them.
  const drawn = new THREE.Vector3()
  const sight = new RAPIER.Ray(new THREE.Vector3(), new THREE.Vector3())
  const sees = (from: Point, to: Point) => {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dz = to.z - from.z
    const length = Math.hypot(dx, dy, dz)
    if (length < 0.5) return true
    sight.origin = from
    sight.dir = { x: dx / length, y: dy / length, z: dz / length }
    return !world.castRay(sight, length - 0.3, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
  }
  function watch(human: Human) {
    const c = combatants[human.seat]
    const { aim } = c.control
    const roof = { x: c.position.x, y: c.position.y + EYE, z: c.position.z }
    const across = Math.hypot(aim.x - roof.x, aim.z - roof.z) || 1
    const camera = { x: roof.x - ((aim.x - roof.x) / across) * CAMERA.back, y: roof.y + CAMERA.up, z: roof.z - ((aim.z - roof.z) / across) * CAMERA.back }
    const targets: Target[] = []
    for (const o of combatants) {
      if (o === c || o.team === c.team || !o.alive) continue
      if (!rewind.where(o.id, human.view, drawn)) drawn.copy(o.position)
      targets.push({ id: o.id, x: drawn.x, y: drawn.y, z: drawn.z })
    }
    fairplay.observe(human.seat, tick, [roof, camera], aim, c.control.fire, targets, sees)
  }

  // The first match goes: everyone's page is in, or the wait is over (a late
  // page's seat is its bot's until the page's first input).
  function release() {
    const late = humans.filter((h) => !h.last)
    if (late.length) log('load timeout', { room: id, map, late: late.map((h) => h.uid), humans: humans.length })
    hold = -1
    changed = true
  }

  function time(ms: number) {
    steps.recent[steps.count % steps.recent.length] = ms
    steps.count++
    steps.total += ms
    steps.max = Math.max(steps.max, ms)
  }

  // The mode has a result: everyone stands down, the results run; the match is written down.
  function finish() {
    sim.standDown()
    next = tick + results * RATE.step
    changed = true
    const done = matchRecord()
    record?.(done)
    journal?.({ k: tick, end: match })
    const flagged = done.seats.filter((s) => s.fairplay?.flags.length)
    log('match ended', { room: id, match, mode: kind, map, winner: done.winner, seconds: done.seconds, humans: humans.length, bots: combatants.length - humans.length, flagged: flagged.length })
    for (const s of flagged) log('fairplay', { room: id, match, uid: s.uid, name: s.name, flags: s.fairplay!.flags, tally: s.fairplay!.tally })
  }

  function matchRecord(): MatchRecord {
    const winner = mode.outcome()
    return {
      room: id,
      match,
      mode: kind,
      map,
      build,
      seed,
      started: clock(startTick),
      ended: clock(tick),
      seconds: Math.round((tick - startTick) / RATE.step),
      winner: winner ?? null,
      seats: combatants.map((c) => {
        const person = personAt(c.id)
        const row = statsRow(c.stats)
        return {
          seat: c.id,
          team: c.team,
          name: c.name,
          uid: person?.uid ?? '',
          weapon: weaponId(c.weapon.spec),
          stats: Object.fromEntries(STAT_KEYS.map((key, i) => [key, row[i]])),
          ...(person && { fairplay: fairplay.summary(c.id) }),
        }
      }),
      ...(lobby && { custom: { lobby, settings } }),
    }
  }

  // A custom room's match is over: its lobby hears, once, and closes the room.
  function end(winner: number | null | undefined) {
    if (ended) return
    ended = true
    sim.standDown()
    if (winner === undefined) log('match abandoned', { room: id, lobby })
    over?.(winner)
  }

  // The next match, on the same arena and machines, with a fresh seed.
  function restart() {
    seed = reseed()
    journal?.({ k: tick, go: seed })
    match++
    startTick = tick
    recorder.restart(seed)
    sim.restart(seed)
    mode.restart(seed)
    next = -1
    changed = true
  }

  // --- what everyone is told -------------------------------------------------------------------

  // The snapshot, a binary frame: the machines and the events since the
  // last one, packed once and wrapped with each player's own ack and machine.
  function broadcast() {
    const events = recorder.drain()
    if (!humans.length) return
    const cars = packCars(combatants.map(carRow))
    const packed = packEvents(events)
    const now = Math.round(mode.rules.now * 1000)
    for (const human of humans) human.send(packSnapshot(tick, human.ack, now, cars, meRow(combatants[human.seat]), packed))
    if (changed || tick - sharedAt >= SHARE) share()
  }

  // The rules' state and everyone's statistics, when they changed (or to one
  // player who has just joined).
  function share(to?: Human) {
    const body = JSON.stringify({ next, hold, rules: mode.share(), stats: combatants.map((c) => statsRow(c.stats)) })
    changed = false
    sharedAt = tick
    if (!to && body === lastState) return
    if (!to) lastState = body
    const text = `{"t":"st","k":${tick},${body.slice(1)}`
    for (const human of to ? [to] : humans) human.send(text)
  }

  // --- seats ----------------------------------------------------------------------------------

  // A bot's seat for a newcomer: on the side with the fewest people (team
  // deathmatch evens the teams; in free for all every machine is its own
  // side), the lowest seat first. -1 when people hold every seat.
  function freeSeat() {
    const people = (team: number) => humans.filter((h) => combatants[h.seat].team === team).length
    let best = -1
    for (const c of combatants) {
      if (humans.some((h) => h.seat === c.id)) continue
      if (best < 0 || people(c.team) < people(combatants[best].team)) best = c.id
    }
    return best
  }

  // A person takes a bot's machine where it stands, with their name and
  // their gun; the seat keeps its statistics. The bot keeps the wheel until
  // the page's first input: from the welcome on, the page still builds its
  // match and compiles its shaders (seconds, on a slow machine), and a machine
  // nobody drives would sit there under fire. Until then the gun is a bot's
  // copy of theirs (the same gun, as the welcome says, scaled as bots' are).
  // Only the gun is theirs: the hello's vehicle is read (and checked) but
  // not used — every seat keeps the roster's machine. VEHICLES has one entry
  // today; server.check fails the day it has two, until a person is seated
  // in the vehicle they chose.
  // `at`: a custom room's seat for the person (their slot); an empty seat
  // comes into play for them on the next step, at a start the rules pick.
  function join(person: { uid: string; name: string; loadout: Loadout; send: Human['send']; close: Human['close'] }, now: number, at = -1): Human | null {
    const seat = lobby ? at : freeSeat()
    if (!combatants[seat] || humans.some((h) => h.seat === seat)) return null
    const c = combatants[seat]
    const gun = settings.weapons === 'all' ? person.loadout.weapon : settings.weapons // the match's one gun, whatever the loadout says
    c.weapon = armWeapon(lobby ? WEAPONS[gun] : botGun(WEAPONS[gun], SKILL)) // a custom seat has no bot at its wheel: their own gun at once
    c.name = person.name
    if (!c.present) sim.occupy(c)
    const human: Human = { uid: person.uid, name: person.name, seat, send: person.send, close: person.close, queue: [], last: null, repeats: 0, drops: 0, depths: new Array<number>(QUEUE + 1).fill(0), low: Infinity, window: 0, seq: -1, ack: -1, heardAt: now, view: tick }
    humans.push(human)
    fairplay.reset(seat)
    written.delete(seat)
    journal?.({ k: tick, join: [seat, person.uid, person.name, gun] })
    send(human, { t: 'welcome', v: PROTOCOL, room: id, seat, mode: kind, map, seed, settings, tick, rate: RATE, digest, lineUp: lineUp(), chat: { all: chat.all, team: teamChannel(c.team) }, ...(lobby && { lobby }) })
    share(human)
    for (const other of humans) if (other !== human) send(other, { t: 'ro', seat, name: c.name, human: true, weapon: weaponId(c.weapon.spec), uid: human.uid, present: true })
    return human
  }

  // The page's first input: the bot lets go and the person drives, their gun
  // at its full rating (its ammo and reload as the bot left them).
  function takeWheel(c: Combatant) {
    c.brain = undefined
    c.weapon = { ...c.weapon, spec: WEAPONS[weaponId(c.weapon.spec)] }
  }

  // The person is gone: a bot drives their machine on, with its own name and
  // a bot's gun — in a custom room, the seat goes empty instead.
  function leave(human: Human, now: number) {
    const at = humans.indexOf(human)
    if (at < 0) return
    humans.splice(at, 1)
    journal?.({ k: tick, leave: human.seat })
    const watched = fairplay.summary(human.seat)
    if (watched.flags.length) log('fairplay', { room: id, match, uid: human.uid, name: human.name, left: true, flags: watched.flags, tally: watched.tally })
    const c = combatants[human.seat]
    if (lobby) {
      sim.vacate(c)
      c.name = ''
    } else {
      c.brain = createBrain(c.seed, SKILL)
      c.weapon = armWeapon(botGun(WEAPONS[weaponId(c.weapon.spec)], SKILL))
      c.name = botName(c.id)
    }
    for (const other of humans) send(other, { t: 'ro', seat: c.id, name: c.name, human: false, weapon: weaponId(c.weapon.spec), uid: '', present: c.present })
    if (!humans.length) emptySince = now
  }

  // An input from `human`: taken in order only, queued for the steps to use.
  function input(human: Human, message: Input, now: number) {
    if (!acceptSeq(human.seq, message.seq)) return false
    human.seq = message.seq
    human.heardAt = now
    human.queue.push(message)
    if (human.queue.length > QUEUE) {
      human.queue.shift()
      human.drops++
    }
    return true
  }

  return {
    id,
    kind, // the mode's id
    map,
    build,
    digest,
    arena,
    world,
    combatants,
    humans,
    mode, // the running mode: its rules
    sim,
    flags,
    rewind, // the poses of the last second
    steps,
    get tick() {
      return tick
    },
    get seed() {
      return seed
    },
    get emptySince() {
      return emptySince
    },
    // The tick the first match stops waiting for its people's pages at the latest; -1 once it doesn't wait.
    get hold() {
      return hold
    },
    // Takes newcomers: a bot seat left, and the match not over.
    open: () => !lobby && next < 0 && freeSeat() >= 0, // Classic's matcher and direct seats never see a custom room
    lobby, // a custom lobby's room: its id
    free: () => combatants.length - humans.length, // bots' seats
    // How far its match has gone: 0 on the grid, 1 at the buzzer (overtime and the results too).
    progress: () => (next >= 0 ? 1 : Math.min(1, Math.max(0, 1 - mode.rules.remaining() / full))),
    step,
    join,
    leave,
    input,
    // A replay's: what `human`'s machine is given on the next step (null: its bot still drives).
    force(human: Human, given: Given | null) {
      human.forced = given
    },
    get match() {
      return match
    },
    dispose() {
      journal?.({ k: tick, close: 1 })
      mode.dispose()
      world.free()
    },
  }
}
