import type { WeaponId, WeaponSpec } from '../content/weapons/weapons.ts'
import { parseLoadout, type Loadout } from '../sim/loadout.ts'
import type { MatchSettings } from '../modes/matchSettings.ts'
import { createStats, type Stats } from '../sim/scoring.ts'
import type { Combatant } from '../sim/simulation.ts'
import type { VehicleId } from '../content/vehicles/vehicles.ts'
import { LIMITS, optional, text } from './limits.ts'
import { lobbying, type Lobbying, type LobbyMessage } from './lobbyProtocol.ts'

// What the browser and the game server say to each other over the match
// socket (server/, net/connection.ts): the messages, their numbers on the
// wire (integers: centimetres, 1/10⁴ of a quaternion, ms...) and the
// checks every client message passes before the server acts on it. A client
// only ever asks — controls, where it aims, what it sees; the server decides
// and tells. JSON, each message an object with its type in `t`. Pure: no
// sockets here (protocol.test.ts).
// The snapshot alone goes as a binary frame (packSnapshot): it is most of
// what a page is sent.

export const PROTOCOL = 7 // bumped whenever a message changes shape: an old page is told to reload
// The build a page or a server was made from (build-id.ts, put in by Vite as
// __BUILD__): the server lets in only pages of its own build, so a tab left
// open across a deploy is told to reload even when no message changed shape
// (a handling tweak, a gun's numbers) or a PROTOCOL bump was forgotten.
// 'dev' from Vite's dev server and in the unit tests.
declare const __BUILD__: string
export const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev'
export const RATE = { step: 60, snap: 30 } // simulation steps and snapshots per second
export const REWIND = 12 // steps: how far back the tick a player says it sees may reach (200 ms)
export const AIM_MARGIN = 5 // metres past the gun's range an aim point may lie

// --- client → server ---------------------------------------------------------------

export interface Hello {
  t: 'hello'
  v: number // PROTOCOL
  build: string // BUILD ('' when a page sent none, or nonsense: no match for any server)
  token: string // the Nakama session token (who is playing)
  guest: boolean // shown as a guest (cosmetic)
  // A seat at once, in a room of this mode on this arena (the tests, the load
  // tool, the deploy's smoke test); the lobby checks both against the
  // registries. Neither (''): Classic's matchmaking — the seat comes later.
  mode: string
  map: string
  loadout: Loadout // the gun a seat is fitted with
}

// The controls for one step, as the server reads them (decoded from the wire).
export interface Input {
  t: 'in'
  seq: number // one per client step, rising
  throttle: number // -1..1
  steer: number
  handbrake: boolean
  fire: boolean
  recover: boolean
  aim: { x: number; y: number; z: number } // metres, world
  view: number // the server tick the player sees on screen
}

// Classic's matchmaking (server/matchmaker.ts): start searching in a mode on
// an arena, stop, answer the ready check of proposal `id`, or ask where one stands.
const QUEUE_ACTIONS = ['search', 'cancel', 'accept', 'decline', 'state'] as const
export interface Queueing {
  t: 'mm'
  do: (typeof QUEUE_ACTIONS)[number]
  mode: string // search: the mode ('' otherwise)
  map: string // search: the arena, played on as asked ('' otherwise)
  id: string // accept, decline: the proposal ('' otherwise)
}

type ClientMessage = Hello | Input | Queueing | Lobbying | { t: 'ping'; c: number } | { t: 'bye' }

// --- server → client ---------------------------------------------------------------

interface SeatInfo {
  name: string
  team: number
  vehicle: VehicleId
  weapon: WeaponId
  human: boolean
  uid: string // the person's Nakama user id (a whisper's address); '' for a bot
  present: boolean // in play; false: an empty seat (a custom room's), nobody in it
}

// The seat's chat channels (Nakama room channels, net/chat.ts): the room's,
// and its team's in team deathmatch ('' otherwise). The names are the room's
// own random ones, told only to its seats: a room channel lets in whoever
// knows the name.
export interface ChatChannels {
  all: string
  team: string
}

export interface Welcome {
  t: 'welcome'
  v: number
  room: string
  seat: number // the player's machine
  mode: string
  map: string
  seed: number
  settings: MatchSettings // how the room plays its matches: the line-up's size, the clock
  tick: number
  rate: typeof RATE
  digest: string // the server's arena (content/arenas/digest.ts): the page's must match
  lineUp: SeatInfo[]
  chat: ChatChannels
  lobby?: string // a custom lobby's match: the lobby's id
}

// The events of a snapshot, in step order: [code, tick, ...fields] (NET_PLAN.md §4).
export type WireEvent = [string, number, ...unknown[]]

export interface Snapshot {
  t: 's'
  k: number // tick
  ack: number // the last input seq the server used for this player
  now: number // the rules' clock, ms
  cars: number[][] // carRow() per machine
  me: number[] // meRow() of the player's own
  ev: WireEvent[]
}

export interface State {
  t: 'st'
  k: number
  rules: unknown // MatchMode.share()
  stats: number[][] // per seat, STAT_KEYS order
  next: number // the tick the room starts its next match at; -1 while this one runs
  hold: number // the tick the room's first match stops waiting for its people's pages at the latest; -1: it isn't waiting
}

export type ErrorCode = 'version' | 'auth' | 'full' | 'bad-request' | 'replaced' | 'idle' | 'closing' | 'arena' | 'busy' // busy: searching while seated elsewhere

// Why a search ended or went back to the queue, said once with the state it
// brought: the player cancelled, declined, didn't answer in time, was away
// too long; not enough people accepted, or the server had no room free (both
// back in the queue, in the place they had).
export type QueueNote = 'cancelled' | 'declined' | 'missed' | 'gone' | 'short' | 'full'

// The player's place in Classic's matchmaking (server/matchmaker.ts), whole,
// each time it changes and whenever they ask. Times are what is left or has
// passed when it was sent (the page's clock isn't the server's). The seat,
// once there is one, is a welcome on the same socket.
export type Queue =
  | { t: 'mm'; state: 'idle'; note?: QueueNote }
  | { t: 'mm'; state: 'searching'; mode: string; map: string; waited: number; note?: QueueNote } // waited: ms since the ticket was made (a requeue keeps it)
  | {
      t: 'mm'
      state: 'found' | 'accepted' // accepted: the server has this player's accept
      mode: string
      id: string // the proposal: an answer names it
      map: string // the arena: the one searched for, or the running match's (a backfill)
      players: number // people in the match if it starts
      size: number // people asked in this ready check
      accepted: number
      declined: number
      left: number // ms to answer
      of: number // ms the ready check runs in all
    }

export type ServerMessage =
  | Welcome
  | Snapshot
  | State
  | { t: 'ro'; seat: number; name: string; human: boolean; weapon: WeaponId; vehicle: VehicleId; uid: string; present: boolean } // a seat changed hands, and maybe vehicle (present false: it's empty now)
  | { t: 'pong'; c: number; k: number }
  | { t: 'err'; code: ErrorCode; text: string }
  | Queue
  | LobbyMessage

// --- numbers on the wire -------------------------------------------------------------

const cm = (metres: number) => Math.round(metres * 100)
const q4 = (unit: number) => Math.round(unit * 1e4) // quaternions, directions, steering
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const FLAGS = { alive: 1, handbrake: 2, fire: 4, absent: 8 } // absent: an empty seat's machine, out of play

// The registry id of a gun (a bot's is a scaled copy of one, id kept: sim/ai/brain.ts armBot).
export const weaponId = (spec: WeaponSpec) => spec.id

// A machine as everyone sees it: [id, position cm, rotation ×10⁴, velocity
// cm/s, hull ×10, flags, aim cm, throttle and steer ×100]. Speed is left out:
// readCar works it out from the rotation and the velocity.
export function carRow(c: Combatant): number[] {
  const { position: p, rotation: q, velocity: v, control } = c
  const flags = (c.alive ? FLAGS.alive : 0) | (control.handbrake ? FLAGS.handbrake : 0) | (control.fire ? FLAGS.fire : 0) | (c.present ? 0 : FLAGS.absent)
  return [
    c.id,
    cm(p.x),
    cm(p.y),
    cm(p.z),
    q4(q.x),
    q4(q.y),
    q4(q.z),
    q4(q.w),
    cm(v.x),
    cm(v.y),
    cm(v.z),
    Math.round(c.health * 10),
    flags,
    cm(control.aim.x),
    cm(control.aim.y),
    cm(control.aim.z),
    Math.round(control.throttle * 100),
    Math.round(c.car.steer * 100),
  ]
}

// What a car row says, in game units.
export interface CarState {
  id: number
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number; w: number }
  velocity: { x: number; y: number; z: number }
  speed: number // forward m/s, as drive.ts forwardSpeed
  health: number
  alive: boolean
  present: boolean // in play; false: an empty seat's machine, nothing to draw
  handbrake: boolean
  fire: boolean
  aim: { x: number; y: number; z: number }
  throttle: number
  steer: number // front wheel angle, radians
}

export function readCar(row: readonly number[], out: CarState = blankCar()): CarState {
  const [id, px, py, pz, qx, qy, qz, qw, vx, vy, vz, hp, flags, ax, ay, az, th, st] = row
  out.id = id
  Object.assign(out.position, { x: px / 100, y: py / 100, z: pz / 100 })
  const length = Math.hypot(qx, qy, qz, qw) || 1
  Object.assign(out.rotation, { x: qx / length, y: qy / length, z: qz / length, w: qw / length })
  Object.assign(out.velocity, { x: vx / 100, y: vy / 100, z: vz / 100 })
  const q = out.rotation
  const v = out.velocity
  out.speed = v.x * 2 * (q.x * q.z + q.w * q.y) + v.z * (1 - 2 * (q.x * q.x + q.y * q.y))
  out.health = hp / 10
  out.alive = (flags & FLAGS.alive) !== 0
  out.present = (flags & FLAGS.absent) === 0
  out.handbrake = (flags & FLAGS.handbrake) !== 0
  out.fire = (flags & FLAGS.fire) !== 0
  Object.assign(out.aim, { x: ax / 100, y: ay / 100, z: az / 100 })
  out.throttle = th / 100
  out.steer = st / 100
  return out
}

export const blankCar = (): CarState => ({
  id: 0,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  velocity: { x: 0, y: 0, z: 0 },
  speed: 0,
  health: 0,
  alive: true,
  present: true,
  handbrake: false,
  fire: false,
  aim: { x: 0, y: 0, z: 0 },
  throttle: 0,
  steer: 0,
})

// What only the player's own client gets of its machine, for its HUD and
// its prediction: [spin mrad/s ×3, steer ×10⁴, upended ms, ammo, reload ms,
// cooldown ms, stuck ms, recovery ms].
export function meRow(c: Combatant): number[] {
  const w = c.car.body.angvel()
  const ms = (seconds: number) => Math.round(seconds * 1000)
  return [
    Math.round(w.x * 1000),
    Math.round(w.y * 1000),
    Math.round(w.z * 1000),
    q4(c.car.steer),
    ms(c.car.upended),
    c.weapon.ammo,
    ms(c.weapon.reload),
    ms(c.weapon.cooldown),
    ms(c.stuck),
    ms(c.recovery),
  ]
}

export interface MeState {
  spin: { x: number; y: number; z: number } // angular velocity, rad/s
  steer: number
  upended: number // seconds
  ammo: number
  reload: number
  cooldown: number
  stuck: number
  recovery: number
}

export function readMe([wx, wy, wz, steer, upended, ammo, reload, cooldown, stuck, recovery]: readonly number[]): MeState {
  return {
    spin: { x: wx / 1000, y: wy / 1000, z: wz / 1000 },
    steer: steer / 1e4,
    upended: upended / 1000,
    ammo,
    reload: reload / 1000,
    cooldown: cooldown / 1000,
    stuck: stuck / 1000,
    recovery: recovery / 1000,
  }
}

// Every statistic, in one order both sides agree on.
export const STAT_KEYS = Object.keys(createStats()) as Array<keyof Stats>
export const statsRow = (stats: Stats) => STAT_KEYS.map((key) => Math.round(stats[key] * 100) / 100)
export function readStats(row: readonly number[], out: Stats) {
  STAT_KEYS.forEach((key, i) => (out[key] = row[i]))
  return out
}

// --- the snapshot, binary -----------------------------------------------------------------

// A snapshot frame, little-endian: kind (u8, SNAPSHOT), tick (u32), ack
// (i32), the rules' clock in ms (u32), the number of machines (u8); each
// machine's row (CAR_BYTES); the player's own row (ME_BYTES); then the
// events as UTF-8 JSON, or nothing when there are none. The integers are
// carRow's and meRow's: a page reads the same numbers the JSON carried.
// The 16- and 8-bit fields are clamped (a velocity past ±327 m/s is never
// met in play). Everything else the server says stays JSON text.
export const SNAPSHOT = 1
const HEAD_BYTES = 14
const CAR_BYTES = 44 // id u8, position i32×3, rotation i16×4, velocity i16×3, hull i16, flags u8, aim i32×3, throttle i8, steer i8
const ME_BYTES = 40 // meRow: i32×10
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const NONE = new Uint8Array(0)
const i32 = (n: number) => clamp(n, -2147483648, 2147483647)
const i16 = (n: number) => clamp(n, -32768, 32767)
const i8 = (n: number) => clamp(n, -128, 127)

// Every machine's row, packed once a snapshot for everyone.
export function packCars(rows: readonly (readonly number[])[]): Uint8Array {
  const out = new Uint8Array(rows.length * CAR_BYTES)
  const view = new DataView(out.buffer)
  rows.forEach(([id, px, py, pz, qx, qy, qz, qw, vx, vy, vz, hp, flags, ax, ay, az, th, st], i) => {
    const at = i * CAR_BYTES
    view.setUint8(at, id)
    view.setInt32(at + 1, i32(px), true)
    view.setInt32(at + 5, i32(py), true)
    view.setInt32(at + 9, i32(pz), true)
    view.setInt16(at + 13, i16(qx), true)
    view.setInt16(at + 15, i16(qy), true)
    view.setInt16(at + 17, i16(qz), true)
    view.setInt16(at + 19, i16(qw), true)
    view.setInt16(at + 21, i16(vx), true)
    view.setInt16(at + 23, i16(vy), true)
    view.setInt16(at + 25, i16(vz), true)
    view.setInt16(at + 27, i16(hp), true)
    view.setUint8(at + 29, flags)
    view.setInt32(at + 30, i32(ax), true)
    view.setInt32(at + 34, i32(ay), true)
    view.setInt32(at + 38, i32(az), true)
    view.setInt8(at + 42, i8(th))
    view.setInt8(at + 43, i8(st))
  })
  return out
}

// The events of a snapshot, packed once for everyone.
export const packEvents = (events: readonly WireEvent[]) => (events.length ? encoder.encode(JSON.stringify(events)) : NONE)

// One player's snapshot: the shared parts (packCars, packEvents) around their own ack and row.
export function packSnapshot(tick: number, ack: number, now: number, cars: Uint8Array, me: readonly number[], events: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEAD_BYTES + cars.length + ME_BYTES + events.length)
  const view = new DataView(out.buffer)
  view.setUint8(0, SNAPSHOT)
  view.setUint32(1, tick, true)
  view.setInt32(5, i32(ack), true)
  view.setUint32(9, Math.max(0, now), true)
  view.setUint8(13, cars.length / CAR_BYTES)
  out.set(cars, HEAD_BYTES)
  const mine = HEAD_BYTES + cars.length
  me.forEach((n, i) => view.setInt32(mine + i * 4, i32(n), true))
  out.set(events, mine + ME_BYTES)
  return out
}

// A snapshot frame, read back into the message the JSON used to be.
export function unpackSnapshot(data: ArrayBuffer | Uint8Array): Snapshot {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < HEAD_BYTES || view.getUint8(0) !== SNAPSHOT) throw new Error('not a snapshot frame')
  const count = view.getUint8(13)
  const cars: number[][] = []
  for (let i = 0; i < count; i++) {
    const at = HEAD_BYTES + i * CAR_BYTES
    cars.push([
      view.getUint8(at),
      view.getInt32(at + 1, true),
      view.getInt32(at + 5, true),
      view.getInt32(at + 9, true),
      view.getInt16(at + 13, true),
      view.getInt16(at + 15, true),
      view.getInt16(at + 17, true),
      view.getInt16(at + 19, true),
      view.getInt16(at + 21, true),
      view.getInt16(at + 23, true),
      view.getInt16(at + 25, true),
      view.getInt16(at + 27, true),
      view.getUint8(at + 29),
      view.getInt32(at + 30, true),
      view.getInt32(at + 34, true),
      view.getInt32(at + 38, true),
      view.getInt8(at + 42),
      view.getInt8(at + 43),
    ])
  }
  const mine = HEAD_BYTES + count * CAR_BYTES
  const me = Array.from({ length: ME_BYTES / 4 }, (_, i) => view.getInt32(mine + i * 4, true))
  const tail = mine + ME_BYTES
  const ev = tail < bytes.length ? (JSON.parse(decoder.decode(bytes.subarray(tail))) as WireEvent[]) : []
  return { t: 's', k: view.getUint32(1, true), ack: view.getInt32(5, true), now: view.getUint32(9, true), cars, me, ev }
}

// What the server sent, as a message: a binary frame is a snapshot, text is JSON.
export const readServer = (data: string | ArrayBuffer | Uint8Array): ServerMessage =>
  typeof data === 'string' ? (JSON.parse(data) as ServerMessage) : unpackSnapshot(data)

// Bytes a message takes on the wire (text: its length, as the tests have always counted it).
export const wireSize = (data: string | Uint8Array) => (typeof data === 'string' ? data.length : data.byteLength)

// One step's controls as the client sends them.
export function inputMessage(
  seq: number,
  control: { throttle: number; steer: number; handbrake: boolean; fire: boolean; recover: boolean; aim: { x: number; y: number; z: number } },
  view: number,
) {
  const { throttle, steer, handbrake, fire, recover, aim } = control
  return JSON.stringify({
    t: 'in',
    s: seq,
    th: Math.round(throttle * 100),
    st: Math.round(steer * 100),
    hb: +handbrake,
    f: +fire,
    r: +recover,
    a: [cm(aim.x), cm(aim.y), cm(aim.z)],
    w: view,
  })
}

// --- the server's checks -----------------------------------------------------------------

type Parsed = { ok: true; message: ClientMessage } | { ok: false; error: string }

const refuse = (error: string): Parsed => ({ ok: false, error })
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// A client message, checked: size, JSON, shape, finite numbers, ranges.
// Out-of-range numbers are clamped, flags coerced to booleans, unknown
// loadout ids replaced by the defaults, and everything the message type
// doesn't name is left behind — nothing a client sends besides its
// controls, its aim and what it sees reaches the match.
// `bytes`: the message's size as it arrived (the server passes it; a string's length otherwise).
export function parseClient(raw: string, bytes = raw.length): Parsed {
  if (bytes > LIMITS.hello) return refuse('too large')
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return refuse('not JSON')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return refuse('not an object')
  const m = data as Record<string, unknown>
  switch (m.t) {
    case 'in': {
      if (bytes > LIMITS.input) return refuse('input too large')
      const { s, th, st, a, w } = m
      if (!finite(s) || !Number.isSafeInteger(s) || s < 0) return refuse('bad seq')
      if (!finite(th) || !finite(st) || !finite(w)) return refuse('bad number')
      if (!Array.isArray(a) || a.length !== 3 || !a.every(finite)) return refuse('bad aim')
      const reach = 1e6 // cm: anything past this is nonsense; the room clamps to the gun's range
      return {
        ok: true,
        message: {
          t: 'in',
          seq: s,
          throttle: clamp(th, -100, 100) / 100,
          steer: clamp(st, -100, 100) / 100,
          handbrake: !!m.hb,
          fire: !!m.f,
          recover: !!m.r,
          aim: { x: clamp(a[0], -reach, reach) / 100, y: clamp(a[1], -reach, reach) / 100, z: clamp(a[2], -reach, reach) / 100 },
          view: Math.max(0, Math.round(w)),
        },
      }
    }
    case 'hello': {
      const { v, token, loadout } = m
      const [mode, map] = [m.mode ?? '', m.map ?? '']
      if (!finite(v)) return refuse('bad version')
      if (!text(token, LIMITS.token)) return refuse('bad token')
      if (!optional(mode, LIMITS.name) || !optional(map, LIMITS.name)) return refuse('bad mode or map')
      // a missing or odd build is kept as '' rather than refused: the page is told to reload, not struck
      const build = text(m.build, LIMITS.build) ? m.build : ''
      return {
        ok: true,
        message: {
          t: 'hello',
          v,
          build,
          token,
          guest: !!m.guest,
          mode,
          map,
          loadout: parseLoadout(loadout),
        },
      }
    }
    case 'mm': {
      if (bytes > LIMITS.input) return refuse('queue message too large')
      const [mode, map, id] = [m.mode ?? '', m.map ?? '', m.id ?? '']
      const act = QUEUE_ACTIONS.find((a) => a === m.do)
      if (!act) return refuse('bad queue action')
      if (!optional(mode, LIMITS.name) || !optional(map, LIMITS.name) || !optional(id, LIMITS.name)) return refuse('bad mode, map or proposal')
      if (act === 'search' && (!mode || !map)) return refuse('a search without a mode or map')
      if ((act === 'accept' || act === 'decline') && !id) return refuse('an answer without a proposal')
      return { ok: true, message: { t: 'mm', do: act, mode, map, id } }
    }
    case 'lb':
      return lobbying(m, bytes)
    case 'ping':
      return finite(m.c) ? { ok: true, message: { t: 'ping', c: m.c } } : refuse('bad ping')
    case 'bye':
      return { ok: true, message: { t: 'bye' } }
    default:
      return refuse('unknown type')
  }
}

// The aim point pulled in to the gun's range (plus a margin) from `from`,
// and no lower than a metre under the ground. Writes and returns `aim`.
export function clampAim(aim: { x: number; y: number; z: number }, from: { x: number; y: number; z: number }, range: number) {
  const dx = aim.x - from.x
  const dy = aim.y - from.y
  const dz = aim.z - from.z
  const distance = Math.hypot(dx, dy, dz)
  const reach = range + AIM_MARGIN
  if (distance > reach) {
    const k = reach / distance
    aim.x = from.x + dx * k
    aim.y = from.y + dy * k
    aim.z = from.z + dz * k
  }
  aim.y = Math.max(aim.y, -1)
  return aim
}

// The tick a player says it sees, held to the last REWIND steps.
export const clampView = (view: number, now: number) => clamp(Math.round(view), now - REWIND, now)

// Inputs only ever move forward: an older or repeated seq is dropped.
export const acceptSeq = (last: number, seq: number) => seq > last
