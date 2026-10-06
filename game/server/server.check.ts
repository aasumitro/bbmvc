// Self-check for the game server, end to end: a real server on a free port,
// real sockets, tokens minted here with a test key (no Nakama). The door
// (sessions, origins, sizes, rates, strikes), rooms and seats, that only the
// server decides (the hold, driving, fire rate, damage, wrecks, scores,
// respawns), forged and stale input, people coming and going, the end of a
// match and the next one, that a room is the practice simulation and nothing
// more, whole Classic matches pinned by hash, and what it all costs (bytes a
// player, milliseconds a step) on both real arenas. Bundled: npm run server:check.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { request } from 'node:http'
import type { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as THREE from 'three'
import { WebSocket as WsClient } from 'ws'
import { arenaDigest } from '../src/game/arena/digest'
import { WEAPONS } from '../src/game/combat'
import { MAPS, type MapId } from '../src/game/maps'
import { classic } from '../src/game/matchSettings'
import { MODES, type Mode } from '../src/game/modes'
import { initPhysics, createWorld, PHYSICS_STEP } from '../src/game/physics'
import { DIFFICULTIES } from '../src/game/ai'
import { BOT_VEHICLE, recruits, type SeatPlan } from '../src/game/roster'
import { createSimulation, enlist, type Combatant } from '../src/game/simulation'
import { placeCar } from '../src/game/vehicle/drive'
import { VEHICLES } from '../src/game/vehicle/vehicles'
import { AIM_MARGIN, BUILD, inputMessage, parseClient, PROTOCOL, readCar, readServer, STAT_KEYS, weaponId, wireSize, type ServerMessage, type Snapshot, type Welcome } from '../src/net/protocol'
import { arenaData } from './arenas'
import { mintToken } from './auth'
import { createRecorder } from './recorder'
import { createRecords } from './records'
import { replay, replayLines } from './replay'
import { createRoom, SKILL, type Human, type MatchRecord, type Room } from './room'
import { createGameServer } from './server'

await initPhysics()
for (const id of Object.keys(MAPS) as MapId[]) arenaData(id)

let checks = 0
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`server: ${what}`)
  checks++
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(done: () => boolean, ms: number, what: string) {
  const end = performance.now() + ms
  while (!done()) {
    if (performance.now() > end) throw new Error(`server: timed out waiting for ${what}`)
    await wait(10)
  }
}

// --- the server under test -----------------------------------------------------------------------

const KEY = 'test-encryption-key'
const ORIGIN = 'http://play.test'
const logs: string[] = []
const server = createGameServer({ port: 0, key: KEY, origins: [ORIGIN], maxRooms: 4, hello: 1000, grace: 1500, results: 2, log: (line) => logs.push(JSON.stringify(line)) })
const port = await server.listen()
const minted: string[] = []
const token = (uid: string, { exp = Date.now() / 1000 + 3600, key = KEY, alg = 'HS256' } = {}) => {
  const t = mintToken({ uid, usn: `user-${uid}`, exp }, key, alg)
  minted.push(t)
  return t
}

// A player's socket, as a check sees it: everything it heard, kept.
type Probe = Awaited<ReturnType<typeof probe>>
function probe(origin = ORIGIN, at = port) {
  const ws = new WebSocket(`ws://127.0.0.1:${at}/match`, { headers: { Origin: origin } } as unknown as string[])
  const inbox: ServerMessage[] = []
  let closed: { code: number; reason: string } | null = null
  let seq = 0
  ws.binaryType = 'arraybuffer'
  ws.onmessage = (e) => inbox.push(readServer(e.data))
  ws.onclose = (e) => (closed = { code: e.code, reason: e.reason })
  const p = {
    ws,
    inbox,
    closed: () => closed,
    send: (message: object | string) => ws.send(typeof message === 'string' ? message : JSON.stringify(message)),
    hello: (t: string, fields: Record<string, unknown> = {}) => p.send({ t: 'hello', v: PROTOCOL, build: BUILD, token: t, mode: 'tdm', map: 'scrapyard', loadout: { vehicle: 'razor', weapon: 'minigun' }, ...fields }),
    // One step of controls, numbered in order.
    next: () => ++seq, // a seq after every one sent so far
    input: (control: Partial<{ throttle: number; steer: number; handbrake: boolean; fire: boolean; recover: boolean; aim: { x: number; y: number; z: number } }> = {}, view = 0) =>
      p.send(inputMessage(++seq, { throttle: 0, steer: 0, handbrake: false, fire: false, recover: false, aim: { x: 0, y: 1, z: 0 }, ...control }, view)),
    of: <T extends ServerMessage['t']>(t: T) => inbox.filter((m) => m.t === t) as Array<Extract<ServerMessage, { t: T }>>,
    last: <T extends ServerMessage['t']>(t: T) => p.of(t).at(-1),
    events: (code: string) => p.of('s').flatMap((s) => s.ev.filter((e) => e[0] === code)),
  }
  return new Promise<typeof p>((resolve, reject) => {
    ws.onopen = () => resolve(p)
    ws.onerror = () => reject(new Error('refused'))
  })
}

// A player in a match: connected, said hello, welcomed.
async function player(uid: string, fields: Record<string, unknown> = {}) {
  const p = await probe()
  p.hello(token(uid), fields)
  await until(() => !!p.last('welcome') || !!p.closed(), 3000, `${uid}'s welcome`)
  check(!!p.last('welcome'), `${uid} is welcomed (${JSON.stringify(p.last('err'))})`)
  return p as Probe & { welcome: Welcome }
}
const welcomeOf = (p: Probe) => p.last('welcome')!

// Streams one input a step (60 Hz) until stopped; `controls` is read each time.
function stream(p: Probe, controls: () => Parameters<Probe['input']>[0]) {
  const timer = setInterval(() => p.input(controls(), roomOf(p)?.tick ?? 0), 1000 / 60)
  return () => clearInterval(timer)
}
const roomOf = (p: Probe) => server.lobby.rooms.find((r) => r.id === p.last('welcome')?.room)
const machine = (p: Probe) => roomOf(p)!.combatants[welcomeOf(p).seat]
const carIn = (s: Snapshot, id: number) => readCar(s.cars.find((row) => row[0] === id)!)
const rulesOf = (p: Probe) => p.last('st')?.rules as { phase: string; score: number[] } | undefined // the mirrored rules, as the latest state had them

// A raw upgrade request, to see how the door answers.
function upgrade(path: string, origin?: string) {
  return new Promise<number>((resolve) => {
    const req = request({ port, path, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...(origin && { Origin: origin }) } })
    req.on('response', (res) => resolve(res.statusCode ?? 0))
    req.on('upgrade', (_res, socket) => {
      socket.destroy()
      resolve(101)
    })
    req.on('error', () => resolve(-1))
    req.end()
  })
}

// --- the door ---------------------------------------------------------------------------------------

{
  check((await upgrade('/match', ORIGIN)) === 101, 'the right page gets its socket')
  check((await upgrade('/match', 'http://evil.test')) === 403, 'another page’s origin is refused')
  check((await upgrade('/match')) === 403, 'no origin is refused')
  check((await upgrade('/elsewhere', ORIGIN)) === 404, 'only /match upgrades')

  const silent = await probe()
  await until(() => !!silent.closed(), 3000, 'the silent socket to close')
  check(silent.last('err')?.code === 'bad-request', 'no hello in time: told, and closed')

  for (const [what, t] of [
    ['a signature that isn’t Nakama’s', token('u-forged', { key: 'another-key' })],
    ['an expired token', token('u-expired', { exp: Date.now() / 1000 - 5 })],
    ['a malformed token', 'not.a-jwt'],
    ['an unsigned token', token('u-none', { alg: 'none' })],
  ] as const) {
    const p = await probe()
    p.hello(t)
    await until(() => !!p.closed(), 3000, what)
    check(p.last('err')?.code === 'auth' && !p.last('welcome'), `${what}: refused`)
  }
  const old = await probe()
  old.hello(token('u-old'), { v: PROTOCOL - 1 })
  await until(() => !!old.closed(), 3000, 'an old page to be told')
  check(old.last('err')?.code === 'version', 'an older protocol is told to reload')
  for (const [what, build] of [
    ['another build', 'deadbeefcafe'],
    ['no build at all', undefined],
  ] as const) {
    const p = await probe()
    p.hello(token('u-build'), { build })
    await until(() => !!p.closed(), 3000, what)
    check(p.last('err')?.code === 'version' && p.last('err')!.text === 'Game updated — reload the page' && !p.last('welcome'), `a page of ${what} is told to reload`)
  }
  const dev = await probe()
  dev.hello(token('u-dev'), { build: 'dev', mode: 'ffa', map: 'city' })
  await until(() => !!dev.last('welcome') || !!dev.closed(), 3000, 'a dev page')
  check(!!dev.last('welcome'), 'a page from the dev server plays on a server that isn’t strict (local)')
  dev.ws.close()
  const strict = createGameServer({ port: 0, key: KEY, origins: [ORIGIN], maxRooms: 1, strict: true, log: () => {} })
  const strictPort = await strict.listen()
  const devThere = await probe(ORIGIN, strictPort)
  devThere.hello(token('u-dev'), { build: 'dev' })
  await until(() => !!devThere.closed(), 3000, 'a dev page on a strict server')
  const ownThere = await probe(ORIGIN, strictPort)
  ownThere.hello(token('u-own'))
  await until(() => !!ownThere.last('welcome') || !!ownThere.closed(), 3000, 'a page of the server’s build')
  check(devThere.last('err')?.code === 'version' && !!ownThere.last('welcome'), `a strict server (production) refuses a dev page and lets in its own build (${BUILD})`)
  ownThere.ws.close()
  await strict.close()
  const nowhere = await probe()
  nowhere.hello(token('u-nowhere'), { mode: 'tdm', map: 'moon' })
  await until(() => !!nowhere.closed(), 3000, 'an unknown map')
  check(nowhere.last('err')?.code === 'bad-request', 'an arena that doesn’t exist is refused')
  const early = await probe()
  early.send({ t: 'in', s: 1, th: 1, st: 0, a: [0, 0, 0], w: 0 })
  await until(() => !!early.closed(), 3000, 'input before hello')
  check(early.last('err')?.code === 'bad-request', 'input before hello closes the socket')
}

// --- joining ---------------------------------------------------------------------------------------

const a = await player('u-a')
const room = roomOf(a)!
// The bots stand still for these checks: only the players' machines move.
for (const c of room.combatants) {
  if (!c.brain) continue
  c.brain = undefined
  Object.assign(c.control, { throttle: 0, steer: 0, handbrake: true, fire: false })
}
const b = await player('u-b')
{
  const [wa, wb] = [welcomeOf(a), welcomeOf(b)]
  check(wa.room === wb.room && wa.seat !== wb.seat, 'two players on the same mode and arena share a room, in two seats')
  check(wa.digest === arenaDigest(arenaData('scrapyard')) && wa.digest === room.digest, 'the welcome carries the server’s arena digest')
  check(wa.lineUp.length === MODES.tdm.lineUp(arenaData('scrapyard'), classic('tdm').size).length && wb.lineUp.filter((s) => s.human).length === 2, 'the line-up is the mode’s, the players flagged')
  check(wa.seat === 0 && wb.seat === 4 && room.combatants[wb.seat].team !== room.combatants[wa.seat].team, 'the second player goes to the side with fewer players')
  check(wb.lineUp.filter((s) => !s.human).length === 6 && room.combatants.filter((c) => c.id !== wa.seat && c.id !== wb.seat).every((c) => !room.humans.some((h) => h.seat === c.id)), 'bots hold the other six seats')
  check(!!a.last('st') && a.of('ro').some((r) => r.seat === wb.seat && r.human), 'the state follows the welcome; the others hear of a new player')
  const name = /^sy-[0-9a-f]{24}$/ // chat.lua lets in only these
  check(name.test(wa.chat.all) && wa.chat.all === wb.chat.all, 'the welcome names the room’s chat channel, the same for everyone in it, unguessable')
  check(name.test(wa.chat.team) && name.test(wb.chat.team) && wa.chat.team !== wb.chat.team && wa.chat.team !== wa.chat.all, 'team deathmatch: each side its own team channel, told only to its own seats')
  check(wb.lineUp[wa.seat].uid === 'u-a' && wb.lineUp[wb.seat].uid === 'u-b' && wb.lineUp.filter((s) => !s.human).every((s) => s.uid === ''), 'the line-up gives each person’s user id (a whisper’s address), none for a bot')
  check(a.of('ro').some((r) => r.seat === wb.seat && r.human && r.uid === 'u-b'), 'a seat changing hands says whose it is now')
  const other = await player('u-other', { mode: 'ffa', map: 'city' })
  check(welcomeOf(other).room !== wa.room && welcomeOf(other).lineUp.length === 8, 'another mode and arena is another room')
  check(name.test(welcomeOf(other).chat.all) && welcomeOf(other).chat.all !== wa.chat.all && welcomeOf(other).chat.team === '', 'another room, another chat channel; free for all has no team channel')
  other.ws.close()
  const elsewhere = await player('u-elsewhere', { map: 'city' })
  check(welcomeOf(elsewhere).room !== wa.room && welcomeOf(elsewhere).map === 'city', 'a seat at once is on the arena asked for: the same mode on another arena is another room')
  elsewhere.ws.close()
}

// --- only the server moves anything ---------------------------------------------------------------

const aim = { x: 0, y: 1, z: 0 }
{
  const [ca, cb] = [machine(a), machine(b)]
  const [startA, startB] = [ca.spawn.position.clone(), cb.spawn.position.clone()]
  let stopA = stream(a, () => ({ throttle: 1, fire: true, aim }))
  let stopB = stream(b, () => ({}))
  await until(() => room.mode.rules.now > 2.7, 5000, 'the countdown')
  check(ca.position.distanceTo(startA) < 0.5 && !a.events('sh').some((e) => e[2] === ca.id), 'held on the grid: no driving, no firing before GO')
  await until(() => room.mode.rules.phase === 'active', 2000, 'GO')
  const acks = a.of('s').map((s) => s.ack)
  await wait(1500)
  const seen = carIn(a.last('s')!, ca.id)
  check(Math.hypot(seen.position.x - startA.x, seen.position.z - startA.z) > 5, 'after GO the player’s throttle drives its machine, as the snapshots show')
  const still = carIn(b.last('s')!, cb.id).position
  check(Math.hypot(still.x - startB.x, still.z - startB.z) < 0.5 && cb.position.distanceTo(startB) < 0.5, 'the other player’s machine stays put')
  check(a.last('s')!.ack > (acks.at(-1) ?? 0) && acks.every((ack, i) => i === 0 || ack >= acks[i - 1]), 'the acks rise')
  check(a.events('sh').some((e) => e[2] === ca.id), 'after GO the trigger fires')

  // stale: the player stops sending
  stopA()
  const stoppedAt = performance.now()
  await until(() => ca.control.throttle === 0 && !ca.control.fire, 1000, 'the machine to go neutral')
  check(performance.now() - stoppedAt < 400, `no input for 250 ms: the machine coasts, the trigger off (${Math.round(performance.now() - stoppedAt)} ms)`)
  await wait(150)
  const shots = a.events('sh').filter((e) => e[2] === ca.id).length
  await wait(400)
  check(a.events('sh').filter((e) => e[2] === ca.id).length === shots && !carIn(a.last('s')!, ca.id).fire, 'and no more rounds leave its gun')

  // --- combat: a duel on an open stretch of road ---------------------------------------------------
  const nav = room.arena.nav
  const [i, j] = (() => {
    for (let n = 0; n < nav.nodes.length; n++) for (const m of nav.links[n]) if (nav.nodes[n].distanceTo(nav.nodes[m]) > 20 && nav.nodes[n].distanceTo(nav.nodes[m]) < 45) return [n, m]
    throw new Error('server: no stretch of road for a duel')
  })()
  const heading = (from: number, to: number) => Math.atan2(nav.nodes[to].x - nav.nodes[from].x, nav.nodes[to].z - nav.nodes[from].z)
  for (const c of room.combatants) if (c !== ca && c !== cb) placeCar(c.car, { x: 400, y: 0, z: 300 - c.id * 12 }, 0)
  placeCar(ca.car, nav.nodes[i], heading(i, j))
  placeCar(cb.car, nav.nodes[j], heading(j, i))
  const target = { x: nav.nodes[j].x, y: 1.1, z: nav.nodes[j].z }
  stopA = stream(a, () => ({ fire: true, aim: target }))
  await until(() => !cb.alive, 15000, 'the duel to end')
  stopA()
  await until(() => b.events('wr').some((e) => e[2] === cb.id && e[3] === ca.id), 1000, 'the wreck to reach the victim')
  check(b.events('hu').filter((e) => e[2] === cb.id && e[3] === ca.id).length >= 10, 'the victim hears every hit')
  check(!carIn(b.last('s')!, cb.id).alive && carIn(b.last('s')!, cb.id).health === 0, 'the snapshots show the wreck')
  await until(() => rulesOf(b)?.score[ca.team] === 1, 1000, 'the kill in the state')
  const st = b.last('st')!
  check(st.stats[ca.id][0] === 1 && st.stats[cb.id][1] === 1, 'the rules score it: one kill, one death')
  check(b.events('ru').some((e) => (e[2] as { type: string }).type === 'kill'), 'the rules’ own kill event reaches the players')
  await until(() => cb.alive, 8000, 'the respawn')
  await until(() => b.events('sp').some((e) => e[2] === cb.id), 500, 'the respawn event')
  await wait(100)
  check(carIn(b.last('s')!, cb.id).alive && carIn(b.last('s')!, cb.id).health === cb.maxHealth, 'back in whole after the wait')
  stopB()
}

// --- forged and broken input --------------------------------------------------------------------

{
  const [ca, cb] = [machine(a), machine(b)]
  const before = { health: cb.health, at: ca.position.clone() }
  let forged = 0
  for (let k = 0; k < 20; k++) {
    a.send({ ...JSON.parse(inputMessage((forged = a.next()), { throttle: 0, steer: 0, handbrake: false, fire: false, recover: false, aim }, room.tick)), health: 1e9, position: [0, 50, 0], damage: 999, kill: cb.id, stats: { kills: 99 }, alive: false })
    await wait(16)
  }
  await wait(100)
  check(cb.health === before.health && ca.alive && ca.position.distanceTo(before.at) < 1 && ca.stats.kills === 1, 'health, position, damage or kills in an input change nothing')
  check(room.humans.find((h) => h.uid === 'u-a')!.seq === forged, 'the forged inputs were read for their controls only')

  a.send(`{"t":"in","s":${a.next()},"th":1e999,"st":0,"hb":0,"f":1,"r":0,"a":[0,0,0],"w":0}`)
  a.send(`{"t":"in","s":${a.next()},"th":null,"st":0,"hb":0,"f":1,"r":0,"a":[0,0,0],"w":0}`)
  await wait(100)
  check(room.humans.find((h) => h.uid === 'u-a')!.seq === forged && !ca.control.fire, 'Infinity and null are refused whole')

  a.input({ throttle: 0, aim: { x: ca.position.x + 10000, y: 1, z: ca.position.z } }, room.tick)
  await wait(80)
  check(ca.control.aim.distanceTo(ca.position) <= ca.weapon.spec.range + AIM_MARGIN + 1e-6, 'an aim 10 km away is pulled in to the gun’s range')

  const human = room.humans.find((h) => h.uid === 'u-a')!
  const newest = human.seq
  a.send(inputMessage(newest - 5, { throttle: 1, steer: 0, handbrake: false, fire: true, recover: false, aim }, room.tick))
  a.send(inputMessage(newest, { throttle: 1, steer: 0, handbrake: false, fire: true, recover: false, aim }, room.tick))
  await wait(80)
  check(human.seq === newest && human.last?.throttle === 0, 'an old or repeated seq is dropped')

  // the trigger toggled every message never beats the gun's rate
  ca.weapon = { spec: WEAPONS.minigun, ammo: 60, cooldown: 0, reload: 0 }
  let on = false
  const count = () => a.events('sh').filter((e) => e[2] === ca.id).length
  const fired = count()
  const stop = stream(a, () => ({ fire: (on = !on), aim: { x: ca.position.x, y: 30, z: ca.position.z + 30 } }))
  await wait(2000)
  stop()
  await wait(100)
  check(count() - fired <= WEAPONS.minigun.fireRate * 2.2 + 1, `a trigger toggled every message fires no faster than the gun (${count() - fired} rounds in ~2 s)`)

  const big = await probe()
  big.send('x'.repeat(5000))
  await until(() => !!big.closed(), 2000, 'the oversized message')
  check(big.closed()!.code === 1009, 'a message over 4 KB closes the socket')

  const junk = await player('u-junk')
  junk.send({ t: 'shoot', at: 'everyone' })
  await wait(150)
  check(!junk.closed(), 'one unknown message is a strike, not the end')
  for (let k = 0; k < 9; k++) junk.send({ t: 'kill', who: k })
  await until(() => !!junk.closed(), 2000, 'strikes to close the socket')
  check(junk.last('err')?.code === 'bad-request', 'ten strikes and the socket closes')

  const flood = await player('u-flood')
  const calm = room.steps.count
  const calmMs = room.steps.total
  await wait(1000)
  const baseline = (room.steps.total - calmMs) / (room.steps.count - calm)
  const [steps0, ms0] = [room.steps.count, room.steps.total]
  for (let k = 0; k < 2000 && !flood.closed(); k++) {
    flood.input({ throttle: 1 })
    if (k % 100 === 0) await wait(50)
  }
  await until(() => !!flood.closed(), 3000, 'the flood to be cut off')
  const during = (room.steps.total - ms0) / Math.max(1, room.steps.count - steps0)
  check(flood.last('err')?.code === 'bad-request', 'a flood runs out of tokens, strikes out and is closed')
  check(during < baseline * 3 + 0.5, `the room steps on as before (${baseline.toFixed(3)} ms a step, ${during.toFixed(3)} ms during the flood)`)
}

// --- seats ---------------------------------------------------------------------------------------------

{
  const seatA = welcomeOf(a).seat
  const kills = room.combatants[seatA].stats.kills
  a.send({ t: 'bye' })
  await until(() => !room.humans.some((h) => h.uid === 'u-a'), 2000, 'the player to leave')
  const left = room.combatants[seatA]
  check(!!left.brain && left.stats.kills === kills && left.name !== 'user-u-a', 'a player leaves: a bot drives the seat on, its statistics kept')
  check(b.of('ro').some((r) => r.seat === seatA && !r.human), 'the others hear of it')

  // A tripwire: a room seats people in the roster's machine and never reads the hello's vehicle
  // (room.join). With one vehicle that's the one they chose; with two it wouldn't be.
  check(Object.keys(VEHICLES).length === 1 && room.combatants.every((machine) => machine.vehicle === BOT_VEHICLE), 'online, every seat is the roster’s one vehicle: a second vehicle in VEHICLES needs room.join to seat people in the one they chose first')
  const c = await player('u-c', { loadout: { vehicle: 'razor', weapon: 'rocketPod' } })
  const cc = machine(c)
  check(cc.team === room.combatants[seatA].team, 'a newcomer takes a bot seat on the side with fewer players')
  check(!!cc.brain && cc.weapon.spec.rocket !== undefined && cc.weapon.spec.damage < WEAPONS.rocketPod.damage && cc.name === 'user-u-c', 'until the page’s first input the bot keeps the wheel, with a bot’s copy of the newcomer’s gun, under their name')
  c.input({}, room.tick)
  await until(() => !cc.brain, 1000, 'the first input to take the wheel')
  check(cc.weapon.spec.damage === WEAPONS.rocketPod.damage, 'the first input: the brain goes, the newcomer’s own gun at its full rating')

  const again = await player('u-c')
  await until(() => !!c.closed(), 2000, 'the first connection to go')
  check(c.last('err')?.code === 'replaced' && room.humans.filter((h) => h.uid === 'u-c').length === 1, 'the same user twice: the first connection is replaced')
  check(!!again.last('welcome'), 'and the second plays')
}

// --- the end of a match, and the next ----------------------------------------------------------------

{
  const rules = room.mode.rules
  Object.assign(rules, { now: 3 + 600 - 0.2 })
  await until(() => room.mode.outcome() !== undefined, 2000, 'the buzzer')
  await until(() => (b.last('st')?.next ?? -1) > 0 && rulesOf(b)?.phase === 'complete', 1000, 'the result in the state')
  const seedBefore = room.seed
  await until(() => b.events('go').length > 0, 4000, 'the next match')
  await until(() => rulesOf(b)?.phase === 'preMatch' && b.last('st')!.next === -1, 1000, 'the state of the next match')
  check(room.seed !== seedBefore && b.events('go').at(-1)![2] === room.seed, 'the next match starts by itself, on a fresh seed')
  check(room.combatants.every((c) => c.alive && c.health === c.maxHealth && c.position.distanceTo(c.spawn.position) < 1), 'everyone whole on their starts')
  check(b.last('st')!.stats.every((row) => row.every((n) => n === 0)), 'the statistics start over')
}

// --- an empty room closes -------------------------------------------------------------------------------

{
  for (const r of server.lobby.rooms) for (const h of [...r.humans]) h.close('closing', 'check over')
  await until(() => server.lobby.humans() === 0, 3000, 'everyone to leave')
  const was = server.lobby.rooms.length
  await until(() => server.lobby.rooms.length === 0, 4000, 'empty rooms to close')
  check(was > 0, 'rooms nobody is in close after the grace period')
  check(minted.every((t) => !logs.some((line) => line.includes(t))), 'no token ever reaches the logs')
}
await server.close()

// --- Classic's matchmaking, over real sockets -------------------------------------------------------------

// A server of its own, with the matcher's windows in tenths of a second. A
// session is a hello with no map; its search, the ready check and the seat
// travel on that one socket.
const WINDOWS = { fullOnlyWindowMs: 200, startSmallAfterMs: 400, readyCheckMs: 700, searchDisconnectGraceMs: 500, loadTimeoutMs: 1500 }
const queueLogs: Array<Record<string, unknown>> = []
const queue = createGameServer({ port: 0, key: KEY, origins: [ORIGIN], maxRooms: 3, grace: 1500, results: 2, matchmaking: WINDOWS, log: (line) => queueLogs.push(line) })
const queuePort = await queue.listen()
const mm = queue.lobby.matchmaker
async function session(uid: string) {
  const p = await probe(ORIGIN, queuePort)
  p.send({ t: 'hello', v: PROTOCOL, build: BUILD, token: token(uid), guest: true, loadout: { vehicle: 'razor', weapon: 'minigun' } })
  return p
}
const said = (p: Probe) => p.last('mm')
const searchFor = (p: Probe, mode = 'ffa', map = 'city') => p.send({ t: 'mm', do: 'search', mode, map })

{
  const s1 = await session('q-1')
  await wait(150)
  check(!s1.closed() && !s1.inbox.length, 'a hello without a map opens a session: no seat, nothing said until it asks')
  searchFor(s1)
  await until(() => said(s1)?.state === 'searching', 1000, 'the search')
  const ticket = mm.ticketOf('q-1')
  check(ticket?.status === 'searching' && ticket.mode === 'ffa' && ticket.map === 'city' && ticket.build === BUILD, 'Find Match: a ticket in the player’s mode, arena and build, and they hear they are searching')

  const s1b = await session('q-1')
  await until(() => !!s1.closed() && said(s1b)?.state === 'searching', 1000, 'the second tab to take over')
  await wait(100)
  check(s1.last('err')?.code === 'replaced' && mm.ticketOf('q-1') === ticket && ticket?.disconnectedAt === undefined, 'the same player in another tab: the first is let go, the ticket moves with them (the old socket’s close is not a drop)')
  searchFor(s1b, 'tdm')
  await wait(100)
  check(mm.ticketOf('q-1') === ticket && ticket?.mode === 'ffa' && mm.searching() === 1, 'a second Find Match is the same ticket, as it was')
  s1b.send({ t: 'mm', do: 'cancel' })
  await until(() => said(s1b)?.state === 'idle', 1000, 'the cancel')
  const cancelled = said(s1b)
  check(cancelled?.state === 'idle' && cancelled.note === 'cancelled' && !mm.ticketOf('q-1'), 'Cancel Search: the ticket is gone, and the server says so')
  s1b.ws.close()

  const direct = await probe(ORIGIN, queuePort)
  direct.hello(token('q-2'))
  await until(() => !!direct.last('welcome'), 3000, 'a direct seat')
  const busy = await session('q-2')
  await until(() => !!busy.closed(), 1000, 'the session of a seated player')
  check(busy.last('err')?.code === 'busy' && !direct.closed(), 'a player with a seat can’t search from another tab: told why, and the seat plays on')
  direct.ws.close()

  const junk = await session('q-3')
  junk.send({ t: 'mm', do: 'search', mode: 'derby', map: 'city' })
  junk.send({ t: 'mm', do: 'search', mode: 'ffa', map: 'moon' })
  junk.send({ t: 'mm', do: 'dance' })
  await wait(100)
  check(!mm.ticketOf('q-3') && !junk.closed(), 'a search for a mode or an arena that isn’t one, or an action that isn’t, is a strike, not a ticket')
  junk.ws.close()

  const [a, b] = [await session('q-a'), await session('q-b')]
  searchFor(a)
  searchFor(b)
  await until(() => said(a)?.state === 'found' && said(b)?.state === 'found', 2000, 'a match found')
  const found = said(a)!
  check(found.state === 'found' && found.size === 2 && found.players === 2 && found.left > 0 && found.of === WINDOWS.readyCheckMs && found.map === 'city', `two searchers meet once the oldest has waited long enough: both hear it, on the arena they searched for (${found.state === 'found' && found.map})`)
  const id = found.state === 'found' ? found.id : ''
  a.send({ t: 'mm', do: 'accept', id })
  await until(() => said(a)?.state === 'accepted' && said(b)?.state === 'found' && (said(b) as { accepted: number }).accepted === 1, 1000, 'the accept, heard by both')
  b.send({ t: 'mm', do: 'decline', id })
  await until(() => said(b)?.state === 'idle' && said(a)?.state === 'searching', 1000, 'the decline')
  const back = said(a)
  check(said(b)?.state === 'idle' && (said(b) as { note?: string }).note === 'declined' && back?.state === 'searching' && back.note === 'short' && back.waited >= WINDOWS.startSmallAfterMs, 'one declines: they’re out; the one who accepted is back in the queue, their wait kept')

  a.ws.close()
  await until(() => mm.ticketOf('q-a')?.disconnectedAt !== undefined, 1000, 'the drop')
  const again = await session('q-a')
  await until(() => said(again)?.state === 'searching', 1000, 'the ticket back')
  check(mm.ticketOf('q-a')?.disconnectedAt === undefined && (said(again) as { waited: number }).waited >= WINDOWS.startSmallAfterMs, 'dropped and back within the grace: the same ticket, and the page hears it unasked')
  again.ws.close()
  await wait(WINDOWS.searchDisconnectGraceMs + 200)
  check(!mm.ticketOf('q-a') && queueLogs.some((line) => line.msg === 'ticket cancelled' && line.uid === 'q-a' && line.reason === 'gone'), 'away past the grace: the ticket is gone, and the log says why')
  b.ws.close()
}

// Two accept: one new room, each seated once on the socket they searched on;
// its first match waits for both pages (their first input), or for the load
// timeout, a late page's seat its bot's until the page comes. A third
// searcher is offered a bot's seat in it.
const accept = (p: Probe) => {
  const q = said(p)
  p.send({ t: 'mm', do: 'accept', id: q?.state === 'found' ? q.id : '' })
}
{
  await until(() => queue.lobby.rooms.length === 0, 5000, 'the direct seat’s room to close') // else it's a room to backfill
  const [x, y] = [await session('q-x'), await session('q-y')]
  searchFor(x, 'tdm')
  searchFor(y, 'tdm')
  await until(() => said(x)?.state === 'found' && said(y)?.state === 'found', 2000, 'the match found')
  const found = said(x)!
  accept(x)
  accept(y)
  await until(() => !!x.last('welcome') && !!y.last('welcome'), 2000, 'the seats')
  const [wx, wy] = [welcomeOf(x), welcomeOf(y)]
  const r = queue.lobby.rooms[0]
  check(wx.room === wy.room && queue.lobby.rooms.length === 1 && r.id === wx.room && found.state === 'found' && wx.map === found.map && wx.mode === 'tdm' && queueLogs.filter((line) => line.msg === 'room opened' && line.proposal).length === 1, `both accept: one new room, opened once, on the arena the ready check named (${wx.map}), welcomed on the socket they searched on`)
  check(wx.seat !== wy.seat && r.humans.length === 2 && new Set(r.humans.map((h) => h.uid)).size === 2 && wx.lineUp.filter((s) => s.human).length === 2 && r.combatants[wx.seat].team !== r.combatants[wy.seat].team, 'each seated once, on opposite sides; bots in the other six seats')
  check(!mm.ticketOf('q-x') && !mm.ticketOf('q-y') && mm.searching() === 0, 'their tickets are done')
  check(wx.tick < 10 && r.combatants.every((c) => c.stats.kills === 0 && c.alive) && r.mode.rules.phase === 'preMatch', 'a fresh match: nothing carried in from anywhere (practice runs in the browser alone)')
  check(r.hold > 0 && (x.last('st') as { hold: number }).hold === r.hold, 'the room waits for their pages, and says until when at the latest')
  await wait(400)
  check(r.hold > 0 && r.mode.rules.now === 0 && r.tick > 20, 'while nobody’s page has loaded, the match stands still')
  const stopX = stream(x, () => ({}))
  await wait(300)
  check(r.hold > 0 && r.mode.rules.now === 0, 'one page in: still waiting for the other')
  await until(() => r.hold < 0, WINDOWS.loadTimeoutMs + 500, 'the load timeout')
  const late = queueLogs.find((line) => line.msg === 'load timeout')
  check(!!late && (late.late as string[]).includes('q-y') && !(late.late as string[]).includes('q-x'), 'the other page never came: at the load timeout the match starts without it, and the log names who was late')
  await until(() => r.mode.rules.now > 0.5 && (y.last('st') as { hold: number }).hold === -1, 1500, 'the countdown')
  check(!!r.combatants[wy.seat].brain && !r.combatants[wx.seat].brain, 'the late seat is its bot’s until the page’s first input; the page that loaded drives its own')
  const stopY = stream(y, () => ({}))
  await until(() => !r.combatants[wy.seat].brain, 1000, 'the late page taking its seat')
  check(r.humans.length === 2, 'the late page comes, and takes its seat over from the bot')

  const busy = await session('q-x')
  await until(() => !!busy.closed(), 1000, 'another tab of a seated player')
  check(busy.last('err')?.code === 'busy' && !x.closed(), 'another tab of a seated player can’t search; the match plays on')

  const z = await session('q-z')
  searchFor(z, 'tdm')
  await until(() => said(z)?.state === 'found', 1000, 'the backfill offer')
  const offer = said(z)!
  check(offer.state === 'found' && offer.size === 1 && offer.players === 3 && offer.map === wx.map && mm.proposals.get(offer.id)?.room === r.id, 'a third searcher is offered a bot’s seat in the running match at once: its arena, three players with them')
  accept(z)
  await until(() => !!z.last('welcome'), 1000, 'the backfill seat')
  check(welcomeOf(z).room === r.id && r.humans.length === 3 && !!r.combatants[welcomeOf(z).seat].brain && r.hold < 0 && queueLogs.some((line) => line.msg === 'backfill accepted' && line.uid === 'q-z'), 'accepted: seated there, a bot at the wheel until the page’s first input, the match not held again')
  check(x.of('ro').some((m) => m.seat === welcomeOf(z).seat && m.human), 'the others hear of the newcomer')
  stopX()
  stopY()
  for (const p of [x, y, z]) p.ws.close()
}

// Both pages in: the match goes at once, without waiting out the timeout.
{
  const [p, q] = [await session('q-p'), await session('q-q')]
  searchFor(p)
  searchFor(q)
  await until(() => said(p)?.state === 'found' && said(q)?.state === 'found', 2000, 'the match found')
  accept(p)
  accept(q)
  await until(() => !!p.last('welcome') && !!q.last('welcome'), 2000, 'the seats')
  const r = queue.lobby.rooms.find((room) => room.id === welcomeOf(p).room)!
  const stops = [stream(p, () => ({})), stream(q, () => ({}))]
  const since = performance.now()
  await until(() => r.hold < 0, 1000, 'both pages in')
  check(performance.now() - since < WINDOWS.loadTimeoutMs / 2 && r.mode.rules.phase === 'preMatch', `both pages loaded: the countdown starts then (${Math.round(performance.now() - since)} ms), not at the timeout`)
  stops.forEach((stop) => stop())
  p.ws.close()
  q.ws.close()
}
await queue.close()

// --- custom lobbies, over real sockets --------------------------------------------------------------------

// A server of its own: a lobby's grace in tenths of a second, a second of
// results. A session (a hello with no map) watches the list, makes or joins
// a lobby, and its match comes to the same socket, which goes back to the
// lobby when the match is over.
const partyLogs: Array<Record<string, unknown>> = []
const party = createGameServer({ port: 0, key: KEY, origins: [ORIGIN], maxRooms: 2, grace: 1500, results: 1, matchmaking: WINDOWS, lobbies: { grace: 800, listEvery: 50 }, log: (line) => partyLogs.push(line) })
const partyPort = await party.listen()
async function guest(uid: string) {
  const p = await probe(ORIGIN, partyPort)
  p.send({ t: 'hello', v: PROTOCOL, build: BUILD, token: token(uid), guest: true, loadout: { vehicle: 'razor', weapon: 'minigun' } })
  return p
}
const lobbyIn = (p: Probe) => p.last('lb')?.lobby ?? null
const health = () => new Promise<Record<string, number>>((resolve) => request({ port: partyPort, path: '/health' }, (res) => res.on('data', (data) => resolve(JSON.parse(String(data))))).end())
{
  const w = await guest('l-w')
  w.send({ t: 'lb', do: 'watch' })
  await until(() => !!w.last('lbs'), 1000, 'the list')
  const settings = { ...classic('ffa'), size: 12, duration: 300 }
  const o = await guest('l-owner-0001')
  o.send({ t: 'lb', do: 'create', name: '  Friday   night ', open: true, password: 'hunter22', mode: 'ffa', map: 'city', settings, jip: true })
  await until(() => !!lobbyIn(o), 1000, 'the lobby made')
  const made = lobbyIn(o)!
  await until(() => w.last('lbs')!.list.length === 1, 1000, 'the list to show it')
  const row = w.last('lbs')!.list[0]
  const maker = made.slots[0]
  check(made.name === 'Friday night' && made.you === 0 && maker.kind === 'person' && maker.owner && row.id === made.id && row.locked && row.host === maker.name, 'a lobby made (its name tidied): its maker owns it, and the list shows it, locked, under their name')
  check(!JSON.stringify(w.inbox).includes(made.code) && !JSON.stringify(w.inbox).includes('hunter22') && !JSON.stringify(w.inbox).includes('l-owner-0001'), 'the list never carries its code, its password or anyone’s user id')

  const p = await guest('l-p')
  p.send({ t: 'lb', do: 'join', id: made.id, password: 'wrong' })
  await until(() => p.last('lb')?.note === 'password', 1000, 'a wrong password')
  p.send({ t: 'lb', do: 'join', id: made.id, password: 'hunter22' })
  await until(() => lobbyIn(p)?.you === 1, 1000, 'the right one')
  const q = await guest('l-q')
  q.send({ t: 'lb', do: 'code', code: made.code })
  await until(() => lobbyIn(q)?.you === 2, 1000, 'the invite code')
  check(lobbyIn(q)!.code === made.code && lobbyIn(o)!.people === 3, 'the password lets p in from the list; the code lets q in without it')

  const s = await guest('l-s')
  s.send({ t: 'mm', do: 'search', mode: 'ffa', map: 'city' })
  await until(() => !!party.lobby.matchmaker.ticketOf('l-s'), 1000, 'a Classic ticket')
  s.send({ t: 'lb', do: 'code', code: made.code })
  await until(() => !!lobbyIn(s), 1000, 'the searcher into the lobby')
  check(!party.lobby.matchmaker.ticketOf('l-s'), 'joining a lobby ends a Classic ticket')
  s.send({ t: 'mm', do: 'search', mode: 'ffa', map: 'city' })
  await wait(150)
  check(!party.lobby.matchmaker.ticketOf('l-s'), 'and no ticket while in a lobby')
  s.send({ t: 'lb', do: 'leave' })
  await until(() => s.last('lb')?.lobby === null, 1000, 'the searcher leaving')

  p.send({ t: 'lb', do: 'ready', on: true })
  q.send({ t: 'lb', do: 'ready', on: true })
  await until(() => lobbyIn(o)!.slots.filter((slot) => slot.kind === 'person' && slot.ready).length === 2, 1000, 'both ready')
  o.send({ t: 'lb', do: 'start' })
  await until(() => [o, p, q].every((x) => !!x.last('welcome')), 3000, 'the match to start')
  const room = party.lobby.rooms.find((r) => r.lobby === made.id)!
  const wo = welcomeOf(o)
  check(!!room && [p, q].every((x) => welcomeOf(x).room === room.id) && wo.lobby === made.id && wo.chat.all === made.chat && wo.lineUp.filter((seat) => seat.present).length === 3 && wo.lineUp.length === 12, 'three of twelve start: one room, on the sockets they were in the lobby on; the lobby’s chat goes on in it; nine seats empty')
  const counts = await health()
  check(counts.custom === 1 && counts.lobbies === 1 && counts.rooms === 1, 'the server counts its rooms by kind')
  const direct = await probe(ORIGIN, partyPort)
  direct.hello(token('l-d'), { mode: 'ffa', map: 'city' })
  await until(() => !!direct.last('welcome'), 3000, 'a direct seat')
  check(welcomeOf(direct).room !== room.id && !room.open(), 'Classic never lands in a custom room')
  direct.ws.close()

  const r = await guest('l-r')
  r.send({ t: 'lb', do: 'code', code: made.code })
  await until(() => !!r.last('welcome'), 2000, 'join in progress')
  check(welcomeOf(r).room === room.id && room.humans.length === 4, 'join in progress: a newcomer goes straight in')
  o.send({ t: 'lb', do: 'kick', uid: 'l-r' })
  await until(() => r.last('lb')?.note === 'kicked', 1000, 'the kick')
  check(room.humans.length === 3 && !room.combatants[welcomeOf(r).seat].present, 'kicked in a match: out of it, the seat empty')

  q.send({ t: 'lb', do: 'wait' })
  await until(() => lobbyIn(q)?.playing === false, 1000, 'back to the waiting room')
  check(room.humans.length === 2, 'back to the waiting room: out of the match, in the lobby, on the same socket')
  const welcomes = q.of('welcome').length
  q.send({ t: 'lb', do: 'play' })
  await until(() => q.of('welcome').length === welcomes + 1, 1000, 'into the match again')
  check(room.humans.length === 3, 'and into the match again')
  room.humans.find((h) => h.uid === 'l-q')!.heardAt = -Infinity // a minute and more without input
  await until(() => lobbyIn(q)?.playing === false, 1000, 'the idle member out of the match')
  check(room.humans.length === 2 && !q.closed() && lobbyIn(o)!.slots.some((slot) => slot.kind === 'person' && slot.uid === 'l-q' && !slot.away), 'a minute without input in a custom match: back in the waiting room, the lobby’s socket kept (Classic lets the socket go)')
  q.send({ t: 'lb', do: 'play' })
  await until(() => q.of('welcome').length === welcomes + 2 && room.humans.length === 3, 1000, 'into the match once more')

  p.ws.close()
  await until(() => lobbyIn(o)!.slots.some((slot) => slot.kind === 'person' && slot.away), 1000, 'the drop')
  const p2 = await guest('l-p')
  p2.send({ t: 'lb', do: 'back', id: made.id })
  await until(() => !!p2.last('welcome'), 2000, 'back in the match')
  check(welcomeOf(p2).room === room.id && room.humans.length === 3 && !lobbyIn(o)!.slots.some((slot) => slot.kind === 'person' && slot.away), 'dropped, back within the grace: their seat again')

  await until(() => room.hold < 0, 3000, 'the load timeout')
  room.combatants[wo.seat].stats.kills = 1
  Object.assign(room.mode.rules, { now: 3 + settings.duration - 0.05 })
  await until(() => lobbyIn(o)?.phase === 'waiting', 3000, 'the match over')
  const after = lobbyIn(o)!
  check(after.tally['l-owner-0001'] === 1 && !after.playing && [p2, q].every((x) => lobbyIn(x)?.phase === 'waiting' && !lobbyIn(x)?.playing) && !party.lobby.rooms.includes(room), 'the match over after its results: everyone back in the waiting room on the same socket, the winner in the tally, the room closed')
  p2.send({ t: 'lb', do: 'ready', on: true })
  q.send({ t: 'lb', do: 'ready', on: true })
  await until(() => lobbyIn(o)!.slots.filter((slot) => slot.kind === 'person' && slot.ready).length === 2, 1000, 'ready again')
  const before = o.of('welcome').length
  o.send({ t: 'lb', do: 'start' })
  await until(() => o.of('welcome').length === before + 1 && !!p2.last('welcome') && q.of('welcome').length >= 3, 3000, 'the next match')
  check(welcomeOf(o).room !== room.id && party.lobby.rooms.some((x) => x.lobby === made.id), 'start again: a room of its own for the next match')

  const text = JSON.stringify(partyLogs)
  check(!text.includes(made.code) && !text.includes('hunter22') && partyLogs.some((line) => line.msg === 'lobby created' && line.lobby === made.id), 'the logs name lobbies by id and people by user id, never an invite code or a password')
  for (const x of [w, o, p2, q, r, s]) x.ws.close()
}
await party.close()

// --- a page that stops reading ----------------------------------------------------------------------------

// It keeps sending inputs (so it's never idle) but takes nothing in: what it
// is sent piles up on the server until the socket is cut off, and a bot
// takes the seat back while the room plays on. Over a Unix socket, whose
// kernel buffer (~200 KB) stays put: loopback TCP's grows to 4 MB first, and
// the check would take minutes. The server's own share is 64 KB here (512 KB
// in production).
{
  const path = join(tmpdir(), `scrapyard-slow-${process.pid}.sock`)
  rmSync(path, { force: true })
  const lines: Array<Record<string, unknown>> = []
  const unix = createGameServer({ port: path, key: KEY, origins: [ORIGIN], maxRooms: 1, backlog: 64 * 1024, log: (line) => lines.push(line) })
  await unix.listen()
  const connect = (uid: string) =>
    new Promise<{ ws: WsClient; inbox: ServerMessage[] }>((resolve, reject) => {
      const ws = new WsClient(`ws+unix:${path}:/match`, { headers: { Origin: ORIGIN } })
      const inbox: ServerMessage[] = []
      ws.on('message', (data, binary) => inbox.push(readServer(binary ? (data as Buffer) : String(data))))
      ws.on('error', reject)
      ws.on('open', () => {
        ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, build: BUILD, token: token(uid), mode: 'ffa', map: 'scrapyard', loadout: { vehicle: 'razor', weapon: 'minigun' } }))
        resolve({ ws, inbox })
      })
    })
  const watcher = await connect('u-watcher')
  const slow = await connect('u-slow')
  await until(() => slow.inbox.some((m) => m.t === 'welcome'), 3000, 'the slow page’s welcome')
  const seat = (slow.inbox.find((m) => m.t === 'welcome') as Welcome).seat
  const r = unix.lobby.rooms[0]
  let seq = 0
  const inputs = setInterval(() => slow.ws.readyState === slow.ws.OPEN && slow.ws.send(inputMessage(++seq, { throttle: 0, steer: 0, handbrake: false, fire: false, recover: false, aim }, r.tick)), 1000 / 60)
  ;(slow.ws as unknown as { _socket: Socket })._socket.pause()
  const pausedAt = performance.now()
  await until(() => lines.some((line) => line.msg === 'slow'), 60000, 'the page that stopped reading to be cut off')
  const took = (performance.now() - pausedAt) / 1000
  clearInterval(inputs)
  const cut = lines.find((line) => line.msg === 'slow')!
  check(cut.uid === 'u-slow' && 'ip' in cut && (cut.queuedKB as number) >= 64, `a page that stops reading is cut off, logged with its user and address (after ${took.toFixed(1)} s, ${cut.queuedKB} KB waiting)`)
  await until(() => !r.humans.some((h) => h.uid === 'u-slow'), 2000, 'the seat to be let go')
  await until(() => watcher.inbox.some((m) => m.t === 'ro' && m.seat === seat && !m.human), 1000, 'the others to hear of it')
  check(!!r.combatants[seat].brain, 'a bot takes the seat back')
  const [tick, heard] = [r.tick, watcher.inbox.length]
  await wait(300)
  check(r.tick > tick + 10 && watcher.inbox.length > heard, 'and the room plays on for everyone else')
  console.log(`slow page: cut off ${took.toFixed(1)} s after it stopped reading, ${cut.queuedKB} KB waiting past the kernel's (Unix socket, 64 KB mark)`)
  watcher.ws.close()
  await unix.close()
  rmSync(path, { force: true })
}

// --- a room is the practice simulation, nothing more ------------------------------------------------------

// Bots only, one seed: 30 s of a room (its snapshots and state written as
// they would be for players) against the simulation run bare (`steps`, or
// until the match ends).
function bare(kind: Mode, map: MapId, seed: number, steps: number) {
  const arena = arenaData(map)
  const world = createWorld(arena.colliders)
  const settings = classic(kind)
  const combatants = recruits(kind, arena, settings, seed, SKILL).map((recruit, i) => enlist(world, i, recruit))
  const mode = MODES[kind].create({ combatants, arena, world, seed, settings })
  const sim = createSimulation({ world, arena, combatants, mode, events: createRecorder(() => 0).sim, seed })
  for (let k = 0; k < steps && mode.outcome() === undefined; k++) {
    sim.step(PHYSICS_STEP, true)
    mode.report()
  }
  const state = fingerprint(combatants)
  world.free()
  return state
}
const fingerprint = (combatants: readonly Combatant[]) => JSON.stringify(combatants.map((c) => [c.position.toArray(), c.rotation.toArray(), c.health, c.stats, c.weapon.ammo, c.alive]))

for (const [kind, map] of [['ffa', 'scrapyard'], ['tdm', 'city']] as const) {
  const r = createRoom({ id: 'same', mode: kind, map, seed: 1234 })
  for (let k = 0; k < 30 * 60; k++) {
    r.step(k * 1000 * PHYSICS_STEP)
    if (k % 12 === 0) r.mode.share()
  }
  const dealt = r.combatants.reduce((sum, c) => sum + c.stats.damageDealt, 0)
  check(dealt > 0 && fingerprint(r.combatants) === bare(kind, map, 1234, 30 * 60), `${kind} on ${map}: a bots-only room ends 30 s of fighting (${Math.round(dealt)} hull dealt) exactly where the bare simulation does`)
  r.dispose()
}

// Classic as it played before the custom lobbies (.claude/work/custom/PLAN.md
// 5.6): a whole match of bots in each mode on each arena, hashed. The
// refactor leaves them as they are; play changed on purpose changes them here.
{
  const started = performance.now()
  const GOLDEN = [
    ['tdm', 'scrapyard', 'd9ee9ad8fa7017af'],
    ['tdm', 'city', '467400f8225aeea3'],
    ['ffa', 'scrapyard', '3c2735848552d2b4'],
    ['ffa', 'city', '6c4c3343a80b5f99'],
  ] as const
  const played = GOLDEN.map(([kind, map]) => createHash('sha256').update(bare(kind, map, 1234, 700 * 60)).digest('hex').slice(0, 16))
  console.log(`classic, a whole match of bots: ${GOLDEN.map(([kind, map], i) => `${kind} ${map} ${played[i]}`).join(', ')} (${((performance.now() - started) / 1000).toFixed(1)} s)`)
  GOLDEN.forEach(([kind, map, pinned], i) => check(played[i] === pinned, `${kind} on ${map}: a whole match of bots plays as before (${pinned}, played ${played[i]})`))
}

// One gun for everyone (a custom lobby's setting): every bot draws it, and a
// person is fitted with it whatever their loadout says.
{
  const r = createRoom({ id: 'guns', mode: 'ffa', map: 'scrapyard', seed: 5, settings: { ...classic('ffa'), weapons: 'rocketPod' } })
  const person = r.join({ uid: 'g-1', name: 'g-1', loadout: { vehicle: 'razor', weapon: 'minigun' }, send() {}, close() {} }, 0)
  check(!!person && r.combatants.every((c) => weaponId(c.weapon.spec) === 'rocketPod'), 'one gun for everyone: the bots draw it, a person is fitted with it whatever their loadout says')
  r.dispose()
}

// --- what a room keeps: its match records, and a replay that runs it again ------------------------------------

// A team deathmatch room keeping its journal on disk (records.ts). People
// come and go: one plays from the start, firing at the nearest hostile; a
// second takes a seat mid-match and sends nothing for two seconds (its bot
// drives); the first goes quiet for a second (its machine coasts), then
// leaves; a third comes. The match runs to its end and into the next. Run
// again from the file (replay.ts), every machine ends where the room's did,
// and each match record comes out the same, fair-play counts and all.
{
  const dir = mkdtempSync(join(tmpdir(), 'scrapyard-records-'))
  mkdirSync(join(dir, 'replays', '2000-01-01'), { recursive: true }) // past any REPLAY_DAYS: pruned
  const kept = createRecords({ dir, days: 14, log: () => {} })
  const created = Date.UTC(2026, 8, 29, 12)
  const file = kept.replay('journal', created)
  const recorded: MatchRecord[] = []
  const r = createRoom({ id: 'journal', mode: 'tdm', map: 'city', seed: 777, created, results: 2, journal: file.write, record: (m) => (recorded.push(m), kept.match(m)) })
  const at = (k: number) => k * 1000 * PHYSICS_STEP
  const people = new Map<string, Human>()
  const come = (uid: string, weapon: 'minigun' | 'rocketPod') => void people.set(uid, r.join({ uid, name: uid, loadout: { vehicle: 'razor', weapon }, send() {}, close() {} }, at(r.tick))!)
  const leave = (uid: string) => {
    r.leave(people.get(uid)!, at(r.tick))
    people.delete(uid)
  }
  let seq = 0
  function drive(uid: string) {
    const h = people.get(uid)!
    const me = r.combatants[h.seat]
    const foe = r.combatants.filter((c) => c.team !== me.team && c.alive).sort((x, y) => x.position.distanceTo(me.position) - y.position.distanceTo(me.position))[0]
    const aim = foe ? { x: foe.position.x, y: foe.position.y + 1, z: foe.position.z } : { x: me.position.x, y: 1, z: me.position.z + 30 }
    const parsed = parseClient(inputMessage(++seq, { throttle: 1, steer: Math.sin(r.tick / 70 + h.seat), handbrake: r.tick % 240 < 15, fire: true, recover: false, aim }, r.tick - 3))
    if (parsed.ok && parsed.message.t === 'in') r.input(h, parsed.message, at(r.tick))
  }
  const run = (seconds: number, driving: string[]) => {
    for (let n = 0; n < seconds * 60; n++) {
      for (const uid of driving) drive(uid)
      r.step(at(r.tick + 1))
    }
  }
  come('j-one', 'minigun')
  run(3 + 20, ['j-one'])
  come('j-two', 'rocketPod')
  run(2, ['j-one'])
  run(10, ['j-one', 'j-two'])
  run(1, ['j-two'])
  leave('j-one')
  run(5, ['j-two'])
  come('j-three', 'minigun')
  for (let n = 0; r.match < 2; n++) {
    if (n > 60 * 900) throw new Error('server: the journal room’s match never ended')
    run(1 / 60, ['j-two', 'j-three'])
  }
  run(3, ['j-two', 'j-three']) // into the next match
  const ended = fingerprint(r.combatants)
  const steps = r.tick
  r.dispose()
  await file.end()
  const [first] = recorded
  const person = (uid: string) => first.seats.find((s) => s.uid === uid)
  check(recorded.length === 1 && first.room === 'journal' && first.match === 1 && first.mode === 'tdm' && first.map === 'city' && first.seed === 777 && first.started === '2026-09-29T12:00:00.000Z', 'a match that ends is recorded: its room, mode, arena and seed, on the room’s clock')
  check(first.seats.length === 8 && first.seats.every((s) => STAT_KEYS.every((key) => typeof s.stats[key] === 'number')) && (first.winner === null || [0, 1].includes(first.winner)), 'every seat’s statistics, and the result')
  check(!!person('j-two')?.fairplay && !!person('j-three')?.fairplay && !person('j-one') && first.seats.filter((s) => !s.uid).every((s) => !s.fairplay), 'the people seated at the end, with their fair-play counts; bots (and whoever left) without')
  check((person('j-two')?.fairplay?.tally.steps ?? 0) > 60 * 30 && (person('j-two')?.fairplay?.tally.hits ?? 0) > 0, `the fair-play watch saw them play (${JSON.stringify(person('j-two')?.fairplay?.tally)})`)
  await until(() => existsSync(join(dir, 'matches-2026-09.jsonl')) && readFileSync(join(dir, 'matches-2026-09.jsonl'), 'utf8').endsWith('\n'), 2000, 'the match record on disk')
  check(readFileSync(join(dir, 'matches-2026-09.jsonl'), 'utf8') === `${JSON.stringify(first)}\n`, 'the record is one JSON line in the month’s file')
  const again = await replay(replayLines(file.path))
  check(again.steps === steps && fingerprint(again.room.combatants) === ended, `the replay runs the room again, ${steps} steps (${(steps / 3600).toFixed(1)} min, people coming and going), to exactly where it ended`)
  check(JSON.stringify(again.records) === JSON.stringify(recorded), 'and says the same match record, fair-play counts and all')
  again.room.dispose()
  await until(() => !existsSync(join(dir, 'replays', '2000-01-01')), 2000, 'the old replays to be pruned')
  check(true, 'replays older than REPLAY_DAYS are deleted')
  console.log(`journal: ${(statSync(file.path).size / 1024).toFixed(0)} KB gzipped for ${(steps / 3600).toFixed(1)} min of a room with 1–2 people firing`)
  kept.close()
  rmSync(dir, { recursive: true, force: true })
}

// --- a custom lobby's room: its seat plan, empty seats, the end handed back ----------------------------------

// Made from a lobby's plan (roster.ts SeatPlan): its people in their own
// seats from the grid, bots only where the owner put them (each at its own
// difficulty), the other seats out of play. Someone leaving leaves an empty
// seat, never a bot; taking it again brings it into play at a start,
// protected. After its results the lobby hears the match is over — no next
// match — and a match with nobody seated for 10 s ends without a result.
// It replays to the bit, seats and all.
{
  const dir = mkdtempSync(join(tmpdir(), 'scrapyard-custom-'))
  const kept = createRecords({ dir, days: 14, log: () => {} })
  const created = Date.UTC(2026, 8, 30, 12)
  const file = kept.replay('custom', created)
  const recorded: MatchRecord[] = []
  const ended: Array<number | null | undefined> = []
  const plan: SeatPlan = [{ uid: 'c-1' }, { skill: 'hard' }, null, { uid: 'c-2' }, { skill: 'easy' }, ...Array.from({ length: 7 }, () => null)]
  const settings = { ...classic('ffa'), size: 12, duration: 300, killLimit: 10 }
  const r = createRoom({ id: 'custom', mode: 'ffa', map: 'city', seed: 31, settings, lobby: 'lob-1', plan, chat: `sy-${'c'.repeat(24)}`, results: 1, created, journal: file.write, record: (m) => (recorded.push(m), kept.match(m)), over: (winner) => void ended.push(winner) })
  const at = (k: number) => k * 1000 * PHYSICS_STEP
  const heard = new Map<string, ServerMessage[]>()
  const people = new Map<string, Human>()
  const come = (uid: string, seat: number) => {
    const h = r.join({ uid, name: uid, loadout: { vehicle: 'razor', weapon: 'rocketPod' }, send: (data) => void heard.set(uid, [...(heard.get(uid) ?? []), readServer(data)]), close() {} }, at(r.tick), seat)
    if (h) people.set(uid, h)
    return h
  }
  const run = (steps: number) => {
    for (let n = 0; n < steps; n++) r.step(at(r.tick + 1))
  }
  come('c-1', 0)
  come('c-2', 3)
  const welcome = heard.get('c-1')!.find((m) => m.t === 'welcome') as Welcome
  check(!r.open() && welcome.lobby === 'lob-1' && welcome.chat.all === `sy-${'c'.repeat(24)}`, 'a custom room is never Classic’s; its welcome names the lobby, whose chat carries on into the match')
  check(r.combatants.filter((c) => c.brain).length === 2 && r.combatants[1].brain?.skill === DIFFICULTIES.hard && r.combatants[4].brain?.skill === DIFFICULTIES.easy, 'bots only where the owner put them, each at its own difficulty')
  check(r.combatants.filter((c) => c.present).length === 4 && welcome.lineUp.filter((s) => s.present).length === 4 && r.combatants[0].present && !r.combatants[2].present, 'the people’s seats are theirs from the grid; the empty ones are out of play')
  check(!come('c-9', 0) && weaponId(r.combatants[0].weapon.spec) === 'rocketPod' && !r.combatants[0].brain, 'a seat a person holds takes nobody else; no bot at a person’s wheel, their own gun at once')
  run(60 * 8)
  r.leave(people.get('c-2')!, at(r.tick))
  check(!r.combatants[3].present && !r.combatants[3].brain && r.combatants[3].name === '', 'someone leaves: an empty seat, never a bot')
  run(60 * 2)
  come('c-2', 3)
  run(2)
  check(r.combatants[3].present && r.combatants[3].alive && r.mode.rules.contenders[3].life === 'protected', 'back in their seat: in play at a start, protected')
  for (let n = 0; !ended.length; n++) {
    if (n > 60 * 400) throw new Error('server: the custom room’s match never ended')
    run(1)
  }
  const [record] = recorded
  check(ended.length === 1 && ended[0] === record.winner && record.custom?.lobby === 'lob-1' && JSON.stringify(record.custom?.settings) === JSON.stringify(settings), `the match over, results and all: the lobby hears the winner (${ended[0]}); the record says whose lobby and how it was played`)
  const steps = r.tick
  run(60 * 3)
  check(ended.length === 1 && r.match === 1 && r.mode.rules.phase === 'complete', 'no next match: the room waits to be closed')
  const final = fingerprint(r.combatants)
  r.dispose()
  await file.end()
  const again = await replay(replayLines(file.path))
  check(again.steps === steps + 60 * 3 && fingerprint(again.room.combatants) === final && JSON.stringify(again.records) === JSON.stringify(recorded), `a custom room replays to the bit: its plan, the seats taken and left (${steps} steps)`)
  again.room.dispose()
  kept.close()
  rmSync(dir, { recursive: true, force: true })

  const deserted: Array<number | null | undefined> = []
  const empty = createRoom({ id: 'deserted', mode: 'tdm', map: 'city', seed: 5, settings: classic('tdm'), lobby: 'lob-2', plan: [{ uid: 'gone' }, { skill: 'normal' }, null, null, { skill: 'normal' }, null, null, null], over: (winner) => void deserted.push(winner) })
  for (let k = 1; k <= 60 * 9; k++) empty.step(at(k))
  check(!deserted.length, 'nobody seated: the bots play on a while...')
  for (let k = 60 * 9 + 1; k <= 60 * 11; k++) empty.step(at(k))
  check(deserted.length === 1 && deserted[0] === undefined, '...and after 10 s the match ends without a result (abandoned)')
  empty.dispose()
}

// --- a newcomer's seat: the bot drives it until the page's first input ----------------------------------------

// A page still builds its match and compiles its shaders after the welcome
// (seconds, on a slow machine): its machine mustn't sit there under fire. Mid
// match, a seat taken by someone who hasn't sent an input yet is the bot's —
// it drives on and fires — and their first input takes the wheel. Someone who
// never sends anything is let go a minute after joining, as anyone idle is.
{
  const r = createRoom({ id: 'handover', mode: 'ffa', map: 'scrapyard', seed: 4321 })
  const at = (k: number) => k * 1000 * PHYSICS_STEP
  let k = 0
  const run = (seconds: number, each?: () => void) => {
    for (const end = k + Math.round(seconds * 60); k < end; k++) {
      each?.()
      r.step(at(k))
    }
  }
  run(3 + 10) // the countdown, then ten seconds of fighting
  const heard: ServerMessage[] = []
  const closed: string[] = []
  const person = (uid: string) => r.join({ uid, name: uid, loadout: { vehicle: 'razor', weapon: 'minigun' }, send: (data) => void heard.push(readServer(data)), close: (code) => void closed.push(`${uid} ${code}`) }, at(k))!
  const late = person('late')
  const quiet = person('quiet')
  const c = r.combatants[late.seat]
  const from = c.position.clone()
  run(8)
  const fired = heard.some((m) => m.t === 's' && m.ev.some((e) => (e[0] === 'sh' || e[0] === 'ln') && e[2] === c.id))
  const moved = c.position.distanceTo(from)
  check(!!c.brain && moved > 10 && fired && c.name === 'late' && c.weapon.spec.damage < WEAPONS.minigun.damage, `a seat taken mid-match is the bot’s until the page’s first input: 8 s on it has driven ${moved.toFixed(0)} m and fired, under the newcomer’s name, with a bot’s copy of their gun`)
  console.log(`handover: a seat taken mid-match, no input for 8 s: the bot drove it ${moved.toFixed(0)} m and fired`)
  let seq = 0
  const send = (control: Partial<Parameters<typeof inputMessage>[1]> = {}) => {
    const parsed = parseClient(inputMessage(++seq, { throttle: 0, steer: 0, handbrake: false, fire: false, recover: false, aim: { x: 0, y: 1, z: 0 }, ...control }, r.tick))
    if (parsed.ok && parsed.message.t === 'in') r.input(late, parsed.message, at(k))
  }
  send({ throttle: -1, steer: 0.5 })
  run(1 / 60)
  check(!c.brain && c.control.throttle === -1 && c.control.steer === 0.5 && !c.control.fire && c.weapon.spec.damage === WEAPONS.minigun.damage, 'the first input takes the wheel: the bot lets go, the controls are the person’s, their gun at full rating')
  const keepUp = () => k % 60 === 0 && send()
  run(50, keepUp)
  check(!closed.length && !!r.combatants[quiet.seat].brain, 'nobody is let go within the minute; the one who hasn’t sent anything still has a bot at the wheel')
  run(4, keepUp)
  check(closed.includes('quiet idle') && !closed.some((line) => line.startsWith('late')), 'someone who never sends an input is let go a minute after joining')
  r.dispose()
}

// --- a rewound round, and a machine's past life ----------------------------------------------------------------

// A person's round is rewound to where their page drew the others — but it
// may only hurt the life a machine lives now. A wreck back then, or a
// machine that has died and come back somewhere else since, stops the round
// and takes nothing (before, the hit landed on the respawned machine, wherever
// it was). A room stepped by hand; the machine's life is set by hand too.
{
  const r = createRoom({ id: 'ghosts', mode: 'tdm', map: 'scrapyard', seed: 77 })
  for (const c of r.combatants) {
    c.brain = undefined
    Object.assign(c.control, { throttle: 0, steer: 0, handbrake: true, fire: false })
  }
  const heard: ServerMessage[] = []
  const hunter = r.join({ uid: 'hunter', name: 'hunter', loadout: { vehicle: 'razor', weapon: 'minigun' }, send: (data) => void heard.push(readServer(data)), close() {} }, 0)!
  const me = r.combatants[hunter.seat]
  const foe = r.combatants.find((c) => c.team !== me.team)!
  const nav = r.arena.nav
  const [i, j] = (() => {
    for (let n = 0; n < nav.nodes.length; n++) for (const m of nav.links[n]) if (nav.nodes[n].distanceTo(nav.nodes[m]) > 20 && nav.nodes[n].distanceTo(nav.nodes[m]) < 35) return [n, m]
    throw new Error('server: no stretch of road for the rewind')
  })()
  const facing = (from: number, to: number) => Math.atan2(nav.nodes[to].x - nav.nodes[from].x, nav.nodes[to].z - nav.nodes[from].z)
  let [k, seq] = [0, 0]
  const step = (control: Partial<Parameters<typeof inputMessage>[1]> = {}, view = r.tick) => {
    const parsed = parseClient(inputMessage(++seq, { throttle: 0, steer: 0, handbrake: true, fire: false, recover: false, aim: { x: 0, y: 1, z: 0 }, ...control }, view))
    if (parsed.ok && parsed.message.t === 'in') r.input(hunter, parsed.message, k * 1000 * PHYSICS_STEP)
    r.step(k++ * 1000 * PHYSICS_STEP)
  }
  const steps = (n: number) => {
    for (let s = 0; s < n; s++) step()
  }
  while (r.mode.rules.phase !== 'active') step()
  for (const c of r.combatants) if (c !== me && c !== foe) placeCar(c.car, { x: 400, y: 0, z: 300 - c.id * 12 }, 0)
  placeCar(me.car, nav.nodes[i], facing(i, j))
  steps(150) // past everyone's start protection
  const rounds = () => heard.flatMap((m) => (m.t === 's' ? m.ev : [])).filter((e) => e[0] === 'sh' && e[2] === me.id)
  const then = new THREE.Vector3()
  // One round, rewound to `tick`, aimed where the foe stood then: the event it made, if it went there.
  const fireAt = (tick: number) => {
    r.rewind.where(foe.id, tick, then)
    const before = rounds().length
    step({ fire: true, aim: { x: then.x, y: then.y + 0.9, z: then.z } }, tick)
    steps(12) // the snapshot out, the gun cooled
    const round = rounds()[before]
    return round && Math.hypot((round[6] as number) / 100 - then.x, (round[8] as number) / 100 - then.z) < 3 ? round : undefined
  }
  // Up to five tries at each case (the gun's spread can miss): `set` stages it and says which tick to rewind to.
  const tries = (set: () => number) => {
    for (let n = 0; n < 5; n++) {
      placeCar(foe.car, nav.nodes[j], facing(j, i))
      foe.alive = true
      steps(20)
      const round = fireAt(set())
      if (round) return round
    }
    throw new Error('server: five rounds went wide')
  }
  const hull = () => foe.health
  let before = hull()
  const alive = tries(() => r.tick - 4)
  check(alive[12] === 1 && alive[13] === foe.id && hull() < before, `the control: a round rewound to the foe as the page drew it hits (${(before - hull()).toFixed(0)} hull)`)
  foe.health = foe.maxHealth
  before = hull()
  const since = tries(() => {
    const t = r.tick
    foe.alive = false // wrecked...
    steps(2)
    foe.alive = true // ...and back, 60 m away
    placeCar(foe.car, { x: nav.nodes[j].x + 60, y: 0, z: nav.nodes[j].z }, 0)
    steps(2)
    return t
  })
  check(since[12] === 1 && since[13] === -1 && hull() === before, 'a round rewound to a machine that has died and come back since: stopped where it stood, no hit on the machine where it is now')
  const wreck = tries(() => {
    foe.alive = false // a wreck, still
    steps(4)
    return r.tick - 3
  })
  check(wreck[12] === 1 && wreck[13] === -1, 'a round rewound to a wreck: stopped, naming no one')
  foe.alive = true
  r.dispose()
}

// --- what it costs -------------------------------------------------------------------------------------------

// Two players (driving, turning, firing at the nearest enemy) and six bots,
// 30 s of fighting after the countdown on each arena; everything a player is
// sent is counted, as are the milliseconds of every step.
const budget: string[] = []
for (const map of Object.keys(MAPS) as MapId[]) {
  const r: Room = createRoom({ id: 'budget', mode: 'ffa', map, seed: 99 })
  const sent = [0, 1].map(() => ({ bytes: 0, snapshots: [] as number[], perSecond: new Map<number, number>() }))
  let ms = 0
  const people = sent.map((tally, n) =>
    r.join({ uid: `budget-${n}`, name: `P${n}`, loadout: { vehicle: 'razor', weapon: n ? 'rocketPod' : 'minigun' }, close() {}, send(data) {
      tally.bytes += wireSize(data)
      const second = Math.floor(ms / 1000)
      tally.perSecond.set(second, (tally.perSecond.get(second) ?? 0) + wireSize(data))
      if (typeof data !== 'string') tally.snapshots.push(data.byteLength) // the snapshots are the binary frames
    } }, 0)!,
  )
  let upBytes = 0
  const countdown = 3 * 60
  const total = countdown + 30 * 60
  r.steps.count = r.steps.total = r.steps.max = 0
  for (let k = 0; k < total; k++) {
    ms = k * 1000 * PHYSICS_STEP
    for (const human of people) {
      const me = r.combatants[human.seat]
      const foe = r.combatants.filter((c) => c !== me && c.alive).sort((x, y) => x.position.distanceTo(me.position) - y.position.distanceTo(me.position))[0]
      const text = inputMessage(k + 1, { throttle: 1, steer: Math.sin(k / 50 + human.seat), handbrake: k % 180 < 20, fire: true, recover: false, aim: foe ? { x: foe.position.x, y: foe.position.y + 1, z: foe.position.z } : me.control.aim }, r.tick)
      upBytes += text.length
      const parsed = parseClient(text)
      if (parsed.ok && parsed.message.t === 'in') r.input(human, parsed.message, ms)
    }
    r.step(ms)
    if (k === countdown) {
      for (const tally of sent) tally.bytes = 0
      for (const tally of sent) tally.snapshots.length = 0
      for (const tally of sent) tally.perSecond.clear()
      upBytes = 0
    }
  }
  const recent = [...r.steps.recent.subarray(0, Math.min(r.steps.count, r.steps.recent.length))].sort((x, y) => x - y)
  const average = r.steps.total / r.steps.count
  const p99 = recent[Math.floor(recent.length * 0.99)]
  const kills = r.combatants.reduce((sum, c) => sum + c.stats.kills, 0)
  const rounds = r.combatants.reduce((sum, c) => sum + c.stats.damageDealt, 0)
  for (const [n, tally] of sent.entries()) {
    const perSecond = tally.bytes / 30
    const worst = Math.max(...tally.perSecond.values())
    const snapshotAverage = tally.snapshots.reduce((x, y) => x + y, 0) / tally.snapshots.length
    const snapshotMax = Math.max(...tally.snapshots)
    budget.push(`${map.padEnd(9)} player ${n}: ${(perSecond / 1024).toFixed(1)} KB/s down (worst second ${(worst / 1024).toFixed(1)} KB), snapshots ${Math.round(snapshotAverage)} B average / ${snapshotMax} B max, ${(upBytes / 2 / 30 / 1024).toFixed(1)} KB/s up`)
    check(perSecond <= 48 * 1024, `${map}: at most 48 KB/s down on average (${(perSecond / 1024).toFixed(1)})`)
    check(snapshotAverage <= 1.5 * 1024, `${map}: snapshots 1.5 KB at most on average (${Math.round(snapshotAverage)} B)`)
    check(upBytes / 2 / 30 <= 6 * 1024, `${map}: at most 6 KB/s up`)
  }
  budget.push(`${map.padEnd(9)} room step ${average.toFixed(3)} ms average, ${p99.toFixed(3)} ms p99, ${r.steps.max.toFixed(2)} ms max; ${kills} kills, ${Math.round(rounds)} hull dealt in 30 s`)
  check(kills > 0, `${map}: they did fight (${kills} kills)`)
  r.dispose()
}
for (const line of budget) console.log(line)

console.log(`server ok (${checks} checks)`)
