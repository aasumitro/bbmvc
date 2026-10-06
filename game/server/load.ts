// A capacity estimate: ROOMS rooms (default 8) of SEATS machines (default
// 8, Classic's; 12, a custom lobby's biggest) with PLAYERS simulated
// players each (default 4, the rest bots), stepped for SECONDS of match
// time (default 20) as fast as the machine allows, everything a real room
// does included — inputs through the parser, snapshots and state written
// for every player — except the sockets. Prints the share of one core the
// rooms need at 60 steps a second, step times, memory and bytes a player.
//   npm run server:build && ROOMS=12 PLAYERS=8 node dist-server/load.js
//   ROOMS=12 SEATS=12 PLAYERS=12 node dist-server/load.js
import { MAPS, type MapId } from '../src/game/maps'
import { classic } from '../src/game/matchSettings'
import { initPhysics, PHYSICS_STEP } from '../src/game/physics'
import { inputMessage, parseClient, wireSize } from '../src/net/protocol'
import { arenaData } from './arenas'
import { createRoom } from './room'

const env = process.env
const ROOMS = Number(env.ROOMS ?? 8)
const SEATS = Number(env.SEATS ?? 8) // even: half a side in team deathmatch
const PLAYERS = Math.min(SEATS, Number(env.PLAYERS ?? 4))
const SECONDS = Number(env.SECONDS ?? 20)

await initPhysics()
const maps = Object.keys(MAPS) as MapId[]
for (const id of maps) arenaData(id)

let bytes = 0
const rooms = Array.from({ length: ROOMS }, (_, n) => {
  const mode = n % 2 ? 'tdm' : 'ffa'
  const room = createRoom({ id: `load${n}`, mode, map: maps[n % maps.length], seed: 1000 + n, settings: { ...classic(mode), size: SEATS } })
  const people = Array.from({ length: PLAYERS }, (_, k) => room.join({ uid: `load-${n}-${k}`, name: `P${k}`, loadout: { vehicle: 'razor', weapon: k % 2 ? 'rocketPod' : 'minigun' }, send: (data) => (bytes += wireSize(data)), close() {} }, 0)!)
  return { room, people }
})

const steps = SECONDS / PHYSICS_STEP
const times: number[] = []
const started = performance.now()
for (let k = 0; k < steps; k++) {
  const now = k * 1000 * PHYSICS_STEP
  const t = performance.now()
  for (const { room, people } of rooms) {
    for (const human of people) {
      const me = room.combatants[human.seat]
      const aim = { x: me.position.x + Math.sin(k / 30) * 40, y: 1, z: me.position.z + Math.cos(k / 30) * 40 }
      const parsed = parseClient(inputMessage(k + 1, { throttle: 1, steer: Math.sin(k / 40 + human.seat), handbrake: false, fire: true, recover: false, aim }, room.tick))
      if (parsed.ok && parsed.message.t === 'in') room.input(human, parsed.message, now)
    }
    room.step(now)
  }
  times.push(performance.now() - t)
}
const wall = performance.now() - started
times.sort((x, y) => x - y)
const average = times.reduce((x, y) => x + y, 0) / times.length
const core = (average / (1000 * PHYSICS_STEP)) * 100
console.log(`${ROOMS} rooms × ${PLAYERS} players, ${SECONDS} s of play in ${(wall / 1000).toFixed(1)} s`)
console.log(`all rooms, one step: ${average.toFixed(2)} ms average, ${times[Math.floor(times.length * 0.99)].toFixed(2)} ms p99, ${times.at(-1)!.toFixed(1)} ms max`)
console.log(`one core at 60 steps a second: ${core.toFixed(0)} % busy (${(core / ROOMS).toFixed(1)} % a room)`)
console.log(`memory: ${Math.round(process.memoryUsage().rss / 1e6)} MB resident; ${((bytes / SECONDS / (ROOMS * PLAYERS)) / 1024).toFixed(1)} KB/s sent a player`)
for (const { room } of rooms) room.dispose()
