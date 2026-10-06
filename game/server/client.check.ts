// Self-check for the browser's side of an online match, free of the DOM:
// headless clients join a real game server through the modules the page
// uses (net/connection.ts, net/client.ts), and play — the line-up seated
// from the welcome, the machines, rules, statistics and seats mirrored from
// what the server sends, its events played into a presenter with the local
// machines, one input a step, sight lines cast at what is shown, the next
// match, a hidden tab catching up, a dropped connection; and a custom
// lobby's store (net/custom.ts) from the list into a lobby, its match and
// back, on one socket, then back in after a drop or a reload. Bundled:
// npm run server:check.
import RAPIER from '@dimforge/rapier3d-compat'
import { arenaDigest } from '../src/game/arena/digest'
import { WEAPONS } from '../src/game/combat'
import { initPhysics } from '../src/game/physics'
import type { Combatant } from '../src/game/simulation'
import { placeCar } from '../src/game/vehicle/drive'
import { classic } from '../src/game/matchSettings'
import { link, openSocket, sayHello } from '../src/net/connection'
import { ask, closeCustom, currentCustom, leaveMatch, onCustom, openCustom, openInvite, resumeLobby, type Custom, type Dial } from '../src/net/custom'
import { readServer, type ServerMessage } from '../src/net/protocol'
import { arenaData } from './arenas'
import { mintToken } from './auth'
import { browser, page, play as run, until as waitUntil, type Browser } from './browser'
import { createGameServer } from './server'

await initPhysics()
const arena = arenaData('scrapyard')

let checks = 0
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`client: ${what}`)
  checks++
}

const KEY = 'client-check-key'
const ORIGIN = 'http://play.test'
const server = createGameServer({ port: 0, key: KEY, origins: [ORIGIN], maxRooms: 2, results: 2, grace: 1000, log: () => {} })
const port = await server.listen()

const open = (uid: string, weapon: 'minigun' | 'rocketPod' = 'minigun') => browser({ port, key: KEY, origin: ORIGIN, uid, arena, weapon })
const until = (done: () => boolean, ms: number, what: string, ...browsers: Browser[]) => waitUntil(done, ms, what, browsers)
const play = (ms: number, ...browsers: Browser[]) => run(ms, browsers)
const count = (b: Browser, name: string, of?: Combatant) => b.shown.filter((e) => e[0] === name && (!of || e[1] === of)).length

// --- seated as the welcome says ---------------------------------------------------------------------

const x = await open('x')
const room = server.lobby.rooms[0]
for (const c of room.combatants) {
  if (!c.brain) continue
  c.brain = undefined // the bots keep still: the check drives
  Object.assign(c.control, { throttle: 0, steer: 0, handbrake: true, fire: false })
}
check(x.link.welcome.digest === arenaDigest(arena), 'the page’s arena matches the server’s')
check(x.combatants.length === 8 && x.combatants.every((c, i) => c.name === x.link.welcome.lineUp[i].name && c.team === x.link.welcome.lineUp[i].team), 'the line-up seated as the welcome says')
check(x.player.id === x.link.welcome.seat && x.combatants.every((c) => c.car.body.bodyType() === (c === x.player ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.KinematicPositionBased)), 'the player in its seat, its own car driven here too; every other moved by the server’s word alone')

const y = await open('y')
await play(300, x, y)
check(x.mode.rules.phase === 'preMatch' && x.mode.rules.now > 0, 'the rules mirror the server’s: the countdown runs')
check(x.client.humans.filter(Boolean).length === 2 && x.combatants[y.player.id].name === 'y', 'a player joining shows in the other’s line-up')

// --- driving: inputs go out one a step, the server's word comes back ---------------------------------------

{
  x.control.throttle = 1
  const start = x.player.position.clone()
  await until(() => x.mode.rules.phase === 'active', 5000, 'GO', x, y)
  check(x.lines.includes('phase active'), 'the rules’ own events are announced through the feed')
  const seq = x.client.net.seq
  await play(1500, x, y)
  check(x.player.position.distanceTo(start) > 5 && y.combatants[x.player.id].position.distanceTo(start) > 5, 'the player’s throttle moves its machine, in both pages')
  const wheels = y.combatants[x.player.id].car.controller
  const spin = wheels.wheelRotation(2) ?? NaN
  check(Number.isFinite(spin) && Math.abs(spin) > 1 && Number.isFinite(wheels.wheelSuspensionLength(0) ?? NaN), `another page turns the moving machine’s wheels (${spin.toFixed(1)} rad)`)
  const human = room.humans.find((h) => h.uid === 'x')!
  check(x.client.net.seq - seq >= 60 && human.seq <= x.client.net.seq && x.client.net.ack > seq, `one input a step, numbered in order, acked (${x.client.net.seq - seq} sent in 1.5 s)`)
  x.control.throttle = 0
  const clock = [x.mode.rules.now]
  for (let k = 0; k < 20; k++) {
    await play(20, x, y)
    clock.push(x.mode.rules.now)
  }
  check(clock.every((now, i) => i === 0 || now >= clock[i - 1]) && Math.abs(x.mode.rules.now - room.mode.rules.now) < 0.2, 'the mirrored clock runs forward, close to the server’s')
}

// --- a fight, as each page is shown it ---------------------------------------------------------------------

// x and y face off on an open stretch of road, the bots parked out of the way.
function duel() {
  const [sx, sy] = [room.combatants[x.player.id], room.combatants[y.player.id]]
  const nav = room.arena.nav
  let [i, j] = [0, 0]
  for (let n = 0; n < nav.nodes.length && !j; n++) for (const m of nav.links[n]) if (nav.nodes[n].distanceTo(nav.nodes[m]) > 20 && nav.nodes[n].distanceTo(nav.nodes[m]) < 45) [i, j] = [n, m]
  for (const c of room.combatants) if (c !== sx && c !== sy) placeCar(c.car, { x: 400, y: 0, z: 300 - c.id * 12 }, 0)
  placeCar(sx.car, nav.nodes[i], Math.atan2(nav.nodes[j].x - nav.nodes[i].x, nav.nodes[j].z - nav.nodes[i].z))
  placeCar(sy.car, nav.nodes[j], 0)
  return [sx, sy]
}

{
  duel()
  await play(300, x, y)

  // x aims where its page shows y, and a ray from x's gun in x's own world meets y's body there
  const target = x.combatants[y.player.id]
  const eye = x.player.position.clone().setY(2.4)
  const toward = target.position.clone().setY(1.1).sub(eye)
  const sight = x.world.castRay(new RAPIER.Ray(eye, toward.clone().normalize()), toward.length() + 1, true, undefined, undefined, undefined, x.player.car.body)
  check(!!sight && sight.collider.parent()?.handle === target.car.body.handle, 'in the page’s world, a sight line meets a machine where it is shown')

  x.control.fire = true
  const aimAt = () => x.control.aim.copy(target.position).setY(target.position.y + 1.1)
  aimAt()
  await until(() => {
    aimAt()
    return !y.player.alive
  }, 15000, 'the wreck', x, y)
  x.control.fire = false
  await play(200, x, y)
  const [yx, yy] = [y.combatants[x.player.id], y.player]
  check(count(y, 'hurt', yy) >= 10 && y.shown.some((e) => e[0] === 'hurt' && e[1] === yy && e[2] === yx), 'the victim’s page is shown every hit, on its own machines')
  check(y.shown.some((e) => e[0] === 'wrecked' && e[1] === yy && e[2] === yx) && yy.health === 0, 'and the wreck')
  check(x.shown.some((e) => e[0] === 'fired' && e[1] === x.player) && x.shown.some((e) => e[0] === 'shot' && e[1] === x.player && e[4] === x.combatants[y.player.id]), 'the shooter’s page is shown its own rounds striking')
  check(y.lines.includes('kill x > you') && x.lines.includes('kill you > y'), 'each page’s feed tells the kill its own way')
  const tdm = x.mode.kind === 'tdm' ? x.mode.rules : null
  check(tdm?.score[x.player.team] === 1 && x.player.stats.kills === 1 && x.combatants[y.player.id].stats.deaths === 1, 'the score and the statistics mirrored')
  check(x.mode.outcome() === undefined && y.mode.rules.contenders[y.player.id].life === 'pending', 'the match runs on; the victim waits to respawn')
  await until(() => y.player.alive, 8000, 'the respawn', x, y)
  check(y.shown.some((e) => e[0] === 'respawned' && e[1] === yy) && y.player.health === y.player.maxHealth, 'back in whole')
}

// --- a seat changes hands ------------------------------------------------------------------------------------

{
  const next = x.combatants[1] // the seat a third player takes: the lowest bot seat, the sides being even
  const other = next.weapon.spec.rocket ? 'minigun' : 'rocketPod' // a gun the bot there doesn't carry
  const z = await open('z', other)
  await play(300, x, y, z)
  const seat = x.combatants[z.player.id]
  check(seat === next && x.refits.includes(seat) && seat.weapon.spec === WEAPONS[other] && seat.name === 'z', 'a seat taken over: its gun and name change, its turret is rebuilt')
  z.link.close()
  await play(300, x, y)
  check(x.combatants[z.player.id].name !== 'z' && !x.client.humans[z.player.id], 'a seat given back to a bot')
}

// --- a page that takes its time to load ---------------------------------------------------------------------

// Mid-match, the page's welcome comes seconds before its first frame (it
// builds the match, compiles shaders). Until its first input the bot drives
// the seat; the page, when it starts, takes the machine where the bot left it.
{
  const w = await open('w')
  w.awake = false // loading: no frames, no inputs
  const seat = room.combatants[w.player.id]
  const from = seat.position.clone()
  await play(2500, x, y)
  const driven = seat.position.distanceTo(from)
  check(!!seat.brain, `while the page loads, the bot keeps the wheel of its seat (it drove ${driven.toFixed(1)} m; server.check has it driving and firing)`)
  w.awake = true
  await play(1000, x, y, w)
  const off = w.player.position.distanceTo(seat.position)
  check(!seat.brain && off < 0.5 && w.client.prediction.corrections <= 1, `its first input takes the wheel, and the page drives on from where the bot left the car (${off.toFixed(2)} m from the server's, ${w.client.prediction.corrections} corrections)`)
  console.log(`a page that loaded for 2.5 s: the bot drove its seat ${driven.toFixed(1)} m; 1 s after its first frame the page's car is ${off.toFixed(2)} m from the server's, after ${w.client.prediction.corrections} corrections`)
  w.link.close()
  await play(300, x, y)
}

// --- a hidden tab: the page catches up ------------------------------------------------------------------------

{
  const [, sy] = duel()
  await play(300, x, y)
  y.awake = false // y's tab is hidden: its page takes nothing
  const shownBefore = y.shown.length
  const target = x.combatants[y.player.id]
  x.control.fire = true
  await until(() => {
    x.control.aim.copy(target.position).setY(target.position.y + 1.1)
    return !sy.alive
  }, 15000, 'the wreck while y looks away', x)
  x.control.fire = false
  await play(300, x)
  y.awake = true
  y.client.receive(performance.now()) // the first frame back: everything that piled up (a bot back in seat 1 may fight on after it)
  y.client.place(performance.now())
  const caught = y.shown.slice(shownBefore)
  check(!y.player.alive && caught.filter((e) => e[0] === 'wrecked' && e[1] === y.player).length === 1, 'back from a hidden tab: the wreck shown once, as it stands')
  check(!caught.some((e) => e[0] === 'shot' || e[0] === 'fired' || e[0] === 'hurt'), 'the rounds in between are not played late')
  check(y.player.position.distanceTo(sy.position) < 1, 'the machines are where they are now')
}

// --- the next match ----------------------------------------------------------------------------------------

{
  Object.assign(room.mode.rules, { now: 3 + 600 - 0.2 })
  await until(() => x.mode.outcome() !== undefined, 2000, 'the result', x, y)
  check(x.mode.outcome() === x.player.team && x.client.nextIn(performance.now()) <= 2, 'the result mirrored; the next match counted down')
  await until(() => x.restarts.length > 0, 5000, 'the next match', x, y)
  await play(200, x, y)
  check(x.restarts[0] === room.seed && x.mode.rules.phase === 'preMatch' && x.mode.rules.now < 1 && x.player.stats.kills === 0, 'the next match: a fresh seed, the countdown again, the statistics cleared')
  check(x.client.nextIn(performance.now()) === Infinity, 'no countdown while it runs')
}

// --- a lost connection ---------------------------------------------------------------------------------------------

await server.close()
await play(200, x, y)
check(x.client.net.lost !== '' && y.client.net.lost !== '', `a closed server is a lost connection (“${x.client.net.lost}”)`)

// --- a match found: the seat on the socket that searched --------------------------------------------------------

// Two pages search (a hello with no map, then the search), accept the match
// found, and are welcomed on the same sockets, which become their links. The
// room holds its first match until both pages play; a page shows the wait
// until then, and the countdown after.
{
  const queue = createGameServer({ port: 0, key: KEY, origins: [ORIGIN], maxRooms: 1, results: 2, grace: 1000, matchmaking: { fullOnlyWindowMs: 0, startSmallAfterMs: 0, loadTimeoutMs: 5000 }, log: () => {} })
  const at = await queue.listen()
  // A page's search, as net/matchmaking.ts runs it: the seat's welcome turns the socket into the match's link at once.
  const search = async (uid: string) => {
    const socket = await openSocket(`ws://127.0.0.1:${at}/match`, ORIGIN)
    const s = { heard: [] as ServerMessage[], page: null as Browser | null }
    socket.onmessage = (e) => {
      const message = readServer(e.data)
      s.heard.push(message)
      if (message.t === 'mm' && message.state === 'found') socket.send(JSON.stringify({ t: 'mm', do: 'accept', id: message.id }))
      if (message.t === 'welcome') s.page = page(link(socket, message), arenaData(message.map as 'city'))
    }
    sayHello(socket, { token: mintToken({ uid, usn: uid, exp: Date.now() / 1000 + 3600 }, KEY), guest: true, loadout: { vehicle: 'razor', weapon: 'minigun' } })
    socket.send(JSON.stringify({ t: 'mm', do: 'search', mode: 'tdm', map: 'city' }))
    return s
  }
  const [a, b] = [await search('mm-a'), await search('mm-b')]
  await until(() => !!a.page && !!b.page, 3000, 'the seats')
  check(a.heard.some((m) => m.t === 'mm' && m.state === 'searching') && a.heard.some((m) => m.t === 'mm' && m.state === 'accepted'), 'a page searches, is found, accepts, and hears each step')
  const [pa, pb] = [a.page!, b.page!]
  pb.awake = false // still loading
  await play(500, pa, pb)
  const r = queue.lobby.rooms[0]
  check(pa.client.holdIn(performance.now()) < Infinity && pa.mode.rules.phase === 'preMatch' && pa.mode.rules.now === 0 && r.hold > 0, 'one page in, one loading: the room waits, and the page that plays shows it')
  pb.awake = true
  await until(() => pa.client.holdIn(performance.now()) === Infinity && pa.mode.rules.now > 0.3, 3000, 'the countdown', pa, pb)
  check(pb.client.holdIn(performance.now()) === Infinity && r.humans.every((h) => !r.combatants[h.seat].brain), 'both in: the countdown runs on both pages, each driving its own seat')
  pa.link.close()
  pb.link.close()
  await queue.close()
}

// --- a custom lobby: the page's store, from the list into the lobby, its match and back ----------------------------

// The store as the Custom entry runs it, on a socket the check dials (one
// per open: a drop or a reload dials again); the others are sockets of
// their own. The lobby keeps a dropped member 0.4 s here.
{
  const party = createGameServer({ port: 0, key: KEY, origins: [ORIGIN], maxRooms: 2, results: 1, matchmaking: { loadTimeoutMs: 300 }, lobbies: { grace: 400, listEvery: 50 }, log: () => {} })
  const at = await party.listen()
  const url = `ws://127.0.0.1:${at}/match`
  const token = (uid: string) => mintToken({ uid, usn: uid, exp: Date.now() / 1000 + 3600 }, KEY)
  const loadout = { vehicle: 'razor', weapon: 'minigun' } as const
  const sockets: WebSocket[] = [] // the store's, each dial
  let late = 0 // ms the next dial takes: past the grace, to come back too late
  const dial: Dial = async () => {
    if (late) await play(late)
    const open = await openSocket(url, ORIGIN)
    sockets.push(open)
    return { open, token: token('c-page'), guest: true }
  }
  const store = () => currentCustom()
  type Seated = Extract<Custom, { phase: 'seated' }>
  const view = () => {
    const now = store()
    return now.phase === 'lobby' || now.phase === 'seated' ? now.lobby : null
  }
  async function member(uid: string) {
    const socket = await openSocket(url, ORIGIN)
    const heard: ServerMessage[] = []
    socket.onmessage = (e) => heard.push(readServer(e.data))
    sayHello(socket, { token: token(uid), guest: true, loadout })
    const lobby = () => heard.findLast((m) => m.t === 'lb')
    return { socket, heard, lobby: () => { const m = lobby(); return m?.t === 'lb' ? m.lobby : null }, send: (message: object) => socket.send(JSON.stringify(message)) }
  }
  const roomOf = (id: string) => party.lobby.rooms.find((r) => r.lobby === id)!
  const phases: string[] = [] // every phase the store has been in (coming back can be quicker than a look)
  onCustom(() => phases.push(store().phase))

  void openCustom(loadout, dial)
  await until(() => store().phase === 'browsing' && (store() as { list: unknown }).list !== null, 2000, 'the list')
  check((await ask({ t: 'lb', do: 'code', code: 'ZZZZZZZZ' })) === 'No lobby has that code', 'the store: a refusal comes back in the player’s words')
  const settings = { ...classic('tdm'), size: 4, duration: 300 }
  check((await ask({ t: 'lb', do: 'create', name: 'Store lobby', open: true, password: '', mode: 'tdm', map: 'scrapyard', settings, jip: true })) === '' && store().phase === 'lobby', 'a lobby made: the store is in its waiting room once the server says so')
  const made = view()!
  const m1 = await member('c-m1')
  m1.send({ t: 'lb', do: 'code', code: made.code })
  await until(() => view()?.slots[2]?.kind === 'person', 1000, 'a member by code')
  const owner = view()!.slots[0]
  check(view()!.people === 2 && owner.kind === 'person' && owner.owner, 'a second person by code lands on the side with fewer; the store sees them')
  m1.send({ t: 'lb', do: 'ready', on: true })
  await until(() => view()!.slots.some((slot) => slot.kind === 'person' && slot.ready), 1000, 'the member ready')

  check((await ask({ t: 'lb', do: 'start' })) === '' && store().phase === 'seated', 'start: the welcome comes on the store’s socket and becomes the match’s link')
  const first = store() as Seated
  await until(() => !!view()?.playing, 1000, 'the lobby’s word beside the match')
  check(first.link.welcome.lobby === made.id && sockets.length === 1, 'the lobby’s word is passed aside while the match has the socket')
  leaveMatch()
  await until(() => store().phase === 'lobby', 1000, 'back to the waiting room')
  first.link.close() // the match screen's own close, after the store took the socket back
  await play(100)
  check(view()!.phase === 'playing' && !view()!.playing && sockets[0].readyState === WebSocket.OPEN, 'Back to lobby: the match runs on without the player; the link let go of the socket, open')
  void ask({ t: 'lb', do: 'play' })
  await until(() => store().phase === 'seated', 1000, 'into the match again')
  const room = roomOf(made.id)
  await until(() => room.hold < 0, 2000, 'the load timeout')
  ;(room.mode.rules as { score: number[] }).score[0] = 1 // blue wins at the buzzer
  Object.assign(room.mode.rules, { now: 3 + settings.duration - 0.05 })
  await until(() => store().phase === 'lobby' && view()!.phase === 'waiting', 4000, 'the match over')
  check(view()!.tally['0'] === 1 && sockets.length === 1, 'the match over after its results: the store back in the waiting room on the same socket, the tally counting')

  // a drop, then a reload: back in within the grace
  phases.length = 0
  sockets.at(-1)!.close()
  await until(() => phases.includes('back') && store().phase === 'lobby', 2000, 'back in after the drop')
  check(view()!.id === made.id && view()!.you === 0 && sockets.length === 2 && !view()!.slots.some((slot) => slot.kind === 'person' && slot.away), 'a drop in the waiting room: a new socket, back in the same slot')
  await until(() => view()!.slots[2].kind === 'person' && !(view()!.slots[2] as { away: boolean }).away, 1000, 'the member here')
  m1.send({ t: 'lb', do: 'ready', on: true })
  await until(() => view()!.slots.some((slot) => slot.kind === 'person' && slot.ready), 1000, 'ready again')
  await ask({ t: 'lb', do: 'start' })
  const seat = (store() as Seated).link.welcome.seat
  phases.length = 0
  sockets.at(-1)!.close()
  await until(() => phases.includes('back') && store().phase === 'seated', 2000, 'back in the match after the drop')
  const again = store() as Seated
  check(again.link.welcome.seat === seat && roomOf(made.id).humans.some((h) => h.uid === 'c-page'), 'a drop in a match: back in, a fresh welcome for the seat it held')
  leaveMatch()
  await until(() => store().phase === 'lobby', 1000, 'back to the waiting room')
  const tab = await member('c-page') // another tab of the same player takes the session over: this one is out, as a reload leaves it
  await until(() => store().phase === 'off', 1000, 'the session taken over')
  tab.socket.close()
  sessionStorage.setItem('scrapyard.lobby', made.id) // what the reloaded tab remembers (the store forgot it with its session)
  check(resumeLobby(loadout) && store().phase === 'back', 'a reload in a lobby: the tab remembers it and goes back')
  await until(() => store().phase === 'lobby', 2000, 'back in after the reload')
  check(view()!.id === made.id && view()!.you === 0, 'back in the lobby after the reload, in the same slot')
  late = 700
  sockets.at(-1)!.close()
  await until(() => store().phase === 'browsing', 3000, 'too late')
  late = 0
  check((store() as { note: string }).note === 'Back too late — the lobby went on without you' && m1.lobby()?.slots[2]?.kind === 'person' && (m1.lobby()!.slots[2] as { owner: boolean }).owner, 'back after the grace: the list, and why; the lobby went on, its member the owner now')

  // kicked mid-match: the list, and why (never a seatless match)
  closeCustom()
  await until(() => store().phase === 'off', 1000, 'the entry left')
  openInvite(loadout, made.code, dial)
  await until(() => store().phase === 'seated', 2000, 'the invite')
  check((store() as Seated).link.welcome.lobby === made.id, 'an invite link: the entry opens and joins its lobby, straight into the match it plays (join in progress)')
  m1.send({ t: 'lb', do: 'kick', uid: 'c-page' })
  await until(() => store().phase === 'browsing' && (store() as { asked: string }).asked === '', 2000, 'the kick')
  check((store() as { note: string }).note === 'The owner kicked you from the lobby', 'kicked in a match: the store is back on the list, saying why')
  closeCustom()
  await until(() => store().phase === 'off', 1000, 'the entry left')
  await play(100)
  check(sockets.at(-1)!.readyState === WebSocket.CLOSED, 'leaving the Custom entry closes its socket')
  m1.socket.close()
  await party.close()
}

console.log(`client ok (${checks} checks)`)
process.exit(0)
