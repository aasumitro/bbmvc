import { MAPS, type MapId } from '../src/content/arenas/maps.ts'
import { initPhysics } from '../src/sim/physics.ts'
import { arenaData } from './arenas.ts'
import { createGameServer } from './server.ts'

// The game server's entry: settings from the environment, the physics
// engine and every arena built up front (a player never waits on one), then
// the server. Stops cleanly on SIGTERM / SIGINT (a deploy, Ctrl-C):
// everyone in a match is told, and the matches end.
//   PORT                   7360
//   NAKAMA_ENCRYPTION_KEY  Nakama's session.encryption_key (local default: Nakama's own default;
//                          with TRUST_PROXY it must be set, and not to that default, or the server won't start)
//   ALLOWED_ORIGINS        pages that may connect, comma-separated (default: localhost and 127.0.0.1, any port)
//   MAX_ROOMS              rooms at once, Classic's and custom lobbies' matches alike (default 12)
//   MAX_LOBBIES            custom lobbies at once (default 24); a lobby holds a room only while its match is played
//   TRUST_PROXY            1 behind a proxy that is the only way in (Caddy): addresses from X-Forwarded-For;
//                          production, so pages from Vite's dev server (build 'dev') are refused too
//   NET_LAG_MS             development only: ms added each way to every message
//   NET_JITTER_MS          development only: ms either side of NET_LAG_MS, message by message (order kept)
//   MATCH_DIR              a folder to keep every match's record and each room's replay in (records.ts); unset: nothing is kept
//   REPLAY_DAYS            days a replay is kept (default 3); the match records stay

const env = process.env
const refuse = (reason: string): never => {
  console.error(JSON.stringify({ time: new Date().toISOString(), msg: 'not starting', reason }))
  process.exit(1)
}
const list = (value: string | undefined, fallback: string[]) =>
  value
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : fallback
// A whole number from the environment, or the default when it's unset. Anything
// else stops the server: a setting that reads as NaN fails quietly elsewhere
// (MAX_ROOMS as NaN once left the matcher no room to open, so nobody was matched).
const whole = (name: string, fallback: number, least: number) => {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value >= least ? value : refuse(`${name} is ${JSON.stringify(raw)}: a whole number of ${least} or more`)
}
const trustProxy = env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true'
const key = env.NAKAMA_ENCRYPTION_KEY || 'defaultencryptionkey'
// Behind the proxy is production: there, Nakama's default key (or none) would let anyone sign a session.
if (trustProxy && key === 'defaultencryptionkey') refuse('NAKAMA_ENCRYPTION_KEY is unset or Nakama’s default, and TRUST_PROXY says this is production')
const settings = {
  port: whole('PORT', 7360, 0),
  maxRooms: whole('MAX_ROOMS', 12, 1),
  maxLobbies: whole('MAX_LOBBIES', 24, 1),
  lag: whole('NET_LAG_MS', 0, 0),
  jitter: whole('NET_JITTER_MS', 0, 0),
}

await initPhysics()
for (const id of Object.keys(MAPS) as MapId[]) arenaData(id)

const server = createGameServer({
  port: settings.port,
  key,
  origins: list(env.ALLOWED_ORIGINS, ['http://localhost:*', 'http://127.0.0.1:*', 'https://localhost:*', 'https://127.0.0.1:*']),
  maxRooms: settings.maxRooms,
  lobbies: { max: settings.maxLobbies },
  trustProxy,
  strict: trustProxy,
  lag: settings.lag,
  jitter: settings.jitter,
  records: env.MATCH_DIR ? { dir: env.MATCH_DIR, days: whole('REPLAY_DAYS', 3, 1) } : undefined,
})
await server.listen()

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(JSON.stringify({ time: new Date().toISOString(), msg: 'stopping', signal }))
    void server.close().then(() => process.exit(0))
  })
}
