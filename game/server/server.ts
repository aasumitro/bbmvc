import { createServer, type IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import type { Arena } from '../src/game/arena/arena'
import type { MapId } from '../src/game/maps'
import { PHYSICS_STEP } from '../src/game/physics'
import { createRng } from '../src/game/rng'
import { BUILD, LIMITS, parseClient, PROTOCOL, wireSize, type ErrorCode, type Hello, type ServerMessage } from '../src/net/protocol'
import { playerName, verifyToken } from './auth'
import type { LobbiesConfig } from './custom'
import { createLobby, type Searcher } from './lobby'
import type { MatchmakingConfig } from './matchmaker'
import { createRecords } from './records'
import { queueDepth, type Human, type Room } from './room'

// The game server: HTTP for its health, a WebSocket per player at /match,
// and one fixed-step loop that runs every room. It guards the door — only
// /match upgrades, only from an allowed page, a few sockets per address, a
// signed Nakama session within 5 s of connecting, a cap on how fast and how
// big messages come, strikes that close a socket that keeps sending junk,
// and a cap on what may wait to go out to a page that has stopped reading —
// and passes what a player may send (controls, aim, the tick it sees) to
// their room; before a player has a seat, what they ask of Classic's
// matchmaking or of custom lobbies goes to the lobby (a hello with no map:
// lobby.ts). A custom lobby's match is on the same socket as the lobby, and
// the socket goes back to the lobby once the match is over. Logs are JSON
// lines, with user ids, never tokens, invite codes or passwords.

export interface ServerOptions {
  port: number | string // 0: any free port (the checks); a path: a Unix socket (the checks' slow reader)
  key: string // Nakama's session.encryption_key: session tokens are signed with it
  origins: string[] // pages allowed to connect ('http://localhost:*' matches any port; '*' anything)
  maxRooms: number
  trustProxy?: boolean // take the address from X-Forwarded-For (behind Caddy, the only way in)
  lag?: number // ms added each way to every message (development: feel the prediction locally)
  jitter?: number // ms either side of `lag`, message by message; order is kept, as TCP keeps it
  stall?: { every: number; for: number } // ms: every so often the link stops for a while, both ways, then delivers what it held (a Wi-Fi hiccup)
  perAddress?: number // sockets open at once from one address
  hello?: number // ms a socket has to say hello
  backlog?: number // bytes that may wait to go out to one socket before it's dropped
  build?: string // the build a page must be (default: this bundle's own)
  strict?: boolean // pages from Vite's dev server (build 'dev') are refused too: production
  grace?: number // ms an empty room is kept
  results?: number // seconds of results between matches
  arenaFor?: (map: MapId) => Arena // the checks' test yards
  matchmaking?: Partial<MatchmakingConfig> // the checks' shorter windows
  lobbies?: Partial<LobbiesConfig> // MAX_LOBBIES; the checks' shorter windows
  log?: (line: Record<string, unknown>) => void
  records?: { dir: string; days: number } // keep every match's record and each room's replay there (records.ts); none: nothing is kept
}

const RATE = { perSecond: 120, burst: 240 } // messages; a client sends ~61 a second
const STRIKES = 10 // bad, unknown or over-the-rate messages before the socket closes
const CATCH_UP = 5 // steps the loop runs at most at once; beyond that it drops the backlog
// Bytes waiting to go out to one page, past what the kernel has taken,
// before the page is dropped: ~20 s of snapshots. A page that keeps sending
// inputs but has stopped reading would otherwise pile its snapshots up here
// without end — every room shares this process's memory.
const BACKLOG = 512 * 1024
const CODES: ErrorCode[] = ['version', 'auth', 'full', 'bad-request', 'replaced', 'idle', 'closing', 'arena', 'busy']
const STEP_MS = PHYSICS_STEP * 1000

// 'http://localhost:*' allows every port of that host; '*' allows every page.
export function originAllowed(origin: string | undefined, allowed: readonly string[]) {
  if (!origin) return false // browsers always send one
  return allowed.some((entry) => entry === '*' || entry === origin || (entry.endsWith(':*') && origin.startsWith(entry.slice(0, -1)) && /^\d+$/.test(origin.slice(entry.length - 1))))
}

export function createGameServer(options: ServerOptions) {
  const { key, origins, maxRooms, trustProxy = false, lag = 0, jitter = 0, perAddress = 8, hello: helloWait = 5000, backlog = BACKLOG, build = BUILD, strict = false } = options
  const log = (msg: string, fields: Record<string, unknown> = {}) => (options.log ?? ((line) => console.log(JSON.stringify(line))))({ time: new Date().toISOString(), msg, ...fields })
  const records = options.records && createRecords({ ...options.records, log })
  const lobby = createLobby({ maxRooms, grace: options.grace, results: options.results, arenaFor: options.arenaFor, matchmaking: options.matchmaking, lobbies: options.lobbies, log, records })
  const wobble = createRng(0x51ed) // the jitter (network conditions, not gameplay)
  const delayed = lag > 0 || jitter > 0 || !!options.stall

  // A one-way link that holds each message back `lag` ms, give or take
  // `jitter` (and past the end of a stall), and hands them over strictly in
  // order, as TCP does: one queue, one timer (timers of different lengths due
  // together fire in no set order, so each message can't have its own).
  const stallEnd = (now: number) => {
    const { stall } = options
    if (!stall) return 0
    const into = (now - started) % stall.every
    return into < stall.for ? now - into + stall.for : 0
  }
  function held<T>(deliver: (item: T) => void) {
    const queue: Array<{ at: number; item: T }> = []
    let timer: NodeJS.Timeout | undefined
    function pump() {
      timer = undefined
      while (queue.length && queue[0].at <= performance.now()) deliver(queue.shift()!.item)
      if (queue.length) timer = setTimeout(pump, Math.max(0, queue[0].at - performance.now()))
    }
    return (item: T) => {
      const now = performance.now()
      const at = Math.max(queue.at(-1)?.at ?? 0, stallEnd(now) + lag, now + lag + (wobble() * 2 - 1) * jitter)
      queue.push({ at, item })
      timer ??= setTimeout(pump, Math.max(0, at - performance.now()))
    }
  }
  const started = performance.now()
  const open = new Map<string, number>() // sockets by address

  const http = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      return res.end(JSON.stringify({ ok: true, protocol: PROTOCOL, build, rooms: lobby.rooms.length, custom: lobby.rooms.filter((r) => r.lobby).length, lobbies: lobby.custom.lobbies.size, humans: lobby.humans(), searching: lobby.searching(), uptime: Math.round((performance.now() - started) / 1000) }))
    }
    res.writeHead(404).end()
  })
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.hello })

  const address = (req: IncomingMessage) => {
    const forwarded = trustProxy ? req.headers['x-forwarded-for'] : undefined
    const list = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '')).split(',').map((s) => s.trim()).filter(Boolean)
    return list.at(-1) ?? req.socket.remoteAddress ?? '?' // the last entry: the one our own proxy wrote
  }

  function refuse(socket: Duplex, status: string, reason: string, ip: string) {
    log('refused', { reason, ip })
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
  }

  http.on('upgrade', (req, socket, head) => {
    const ip = address(req)
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/match') return refuse(socket, '404 Not Found', 'path', ip)
    if (!originAllowed(req.headers.origin, origins)) return refuse(socket, '403 Forbidden', `origin ${req.headers.origin ?? 'none'}`, ip)
    if ((open.get(ip) ?? 0) >= perAddress) return refuse(socket, '429 Too Many Requests', 'too many sockets', ip)
    wss.handleUpgrade(req, socket, head, (ws) => connect(ws, ip))
  })

  // --- one player's socket -------------------------------------------------------------------

  function connect(ws: WebSocket, ip: string) {
    open.set(ip, (open.get(ip) ?? 0) + 1)
    const opened = performance.now()
    let room: Room | null = null
    let human: Human | null = null
    let session: Searcher | null = null // matchmaking or custom lobbies, until the lobby seats it (a custom lobby's member keeps it through the match)
    let uid = ''
    let greeted = false
    let closing = false
    let strikes = 0
    let tokens = RATE.burst
    let filledAt = opened
    let bytes = 0
    // Out to the page. One that has let more than `backlog` pile up is cut
    // off at once — terminated, not told: telling it would only queue more —
    // and the socket's close hands the seat back to a bot. Snapshots are never
    // skipped to help a page catch up: they carry events (wrecks, respawns,
    // the rules', the next match) the page's mirror can't do without.
    function write(data: string | Uint8Array) {
      if (ws.readyState !== ws.OPEN) return
      ws.send(data)
      if (ws.bufferedAmount <= backlog) return
      log('slow', { uid, ip, queuedKB: Math.round(ws.bufferedAmount / 1024), seconds: Math.round((performance.now() - opened) / 1000) })
      closing = true
      ws.terminate()
    }
    const out = held(write)

    const send = (data: string | Uint8Array) => {
      bytes += wireSize(data)
      if (delayed) out(data)
      else write(data)
    }
    const tell = (message: ServerMessage) => send(JSON.stringify(message))

    // Tells the player why, then closes.
    function fail(code: ErrorCode, text: string) {
      if (closing) return
      closing = true
      tell({ t: 'err', code, text })
      setTimeout(() => ws.close(4000 + CODES.indexOf(code), code), delayed ? lag + jitter + 1 : 0)
    }

    function strike(reason: string) {
      if (++strikes < STRIKES) return
      log('strikes', { uid, ip, reason })
      fail('bad-request', 'Too many bad messages')
    }

    // Refilled at RATE.perSecond, up to the burst; a message takes one.
    function take(now: number) {
      tokens = Math.min(RATE.burst, tokens + ((now - filledAt) * RATE.perSecond) / 1000)
      filledAt = now
      if (tokens < 1) return false
      tokens--
      return true
    }

    const deadline = setTimeout(() => fail('bad-request', 'No hello in time'), helloWait)

    function greet(message: Hello) {
      greeted = true
      clearTimeout(deadline)
      // a page of another version or another build: it's running code this server doesn't
      if (message.v !== PROTOCOL || (message.build !== build && (strict || message.build !== 'dev'))) return fail('version', 'Game updated — reload the page')
      const identity = verifyToken(message.token, key)
      if (!identity) return fail('auth', 'Your session is not valid — sign in again')
      uid = identity.uid
      const name = playerName(identity, message.guest)
      const seated = (r: Room, h: Human) => {
        ;[room, human] = [r, h]
        if (!r.lobby) session = null // Classic: the socket is the seat's for good
        log('joined', { uid, name: h.name, room: r.id, mode: r.kind, map: r.map, seat: h.seat, ip, ...(r.lobby && { lobby: r.lobby }) })
      }
      if (!message.map) {
        // a session: Classic's matchmaking (the lobby seats it when the matcher finds a match) or custom lobbies
        const opened: Searcher = { uid, name, build: message.build, loadout: message.loadout, send, close: fail, seat: seated, release: () => void ([room, human] = [null, null]), heard: 0 }
        session = opened
        const refused = lobby.enter(opened, performance.now())
        if (refused) {
          session = null
          return fail(refused.error, refused.text)
        }
        return log('session', { uid, name, ip })
      }
      const joined = lobby.join({ uid, name, mode: message.mode, map: message.map, build: message.build, loadout: message.loadout, send, close: fail }, performance.now())
      if ('error' in joined) return fail(joined.error, joined.text)
      seated(joined.room, joined.human)
    }

    function receive(data: RawData, binary: boolean) {
      if (closing) return
      const now = performance.now()
      if (!take(now)) return strike('rate')
      if (binary) return strike('binary')
      const raw = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
      const parsed = parseClient(raw.toString('utf8'), raw.length)
      if (parsed.ok === false) return strike(parsed.error) // `=== false` narrows under any strictness (an editor on an older TypeScript isn't strict by default)
      const message = parsed.message
      if (!greeted) return message.t === 'hello' ? greet(message) : fail('bad-request', 'Say hello first')
      switch (message.t) {
        case 'hello':
          return strike('second hello')
        case 'in':
          if (!room || !human) return session ? undefined : strike('input without a seat') // a custom match just over: inputs still on their way
          if (!room.input(human, message, now)) strike('input out of order')
          return
        case 'mm':
          if (session && !lobby.queue(session, message, now)) strike('bad queue message')
          return // seated already: a late word to the queue changes nothing
        case 'lb':
          if (!session || !lobby.lobbies(session, message, now)) strike('bad lobby message')
          return
        case 'ping':
          return tell({ t: 'pong', c: message.c, k: room?.tick ?? 0 })
        case 'bye':
          closing = true
          return ws.close(1000, 'bye')
      }
    }

    const inbound = held(([data, binary]: [RawData, boolean]) => receive(data, binary))
    ws.on('message', (data, binary) => (delayed ? inbound([data, binary]) : receive(data, binary)))
    ws.on('close', () => {
      clearTimeout(deadline)
      open.set(ip, (open.get(ip) ?? 1) - 1)
      if (!open.get(ip)) open.delete(ip)
      if (room && human) {
        lobby.leave(room, human, performance.now())
        log('left', { uid, room: room.id, seat: human.seat, seconds: Math.round((performance.now() - opened) / 1000), sentKB: Math.round(bytes / 1024), repeats: human.repeats, drops: human.drops, queue: queueDepth(human) })
      }
      if (session) lobby.exit(session, performance.now()) // a custom lobby's member: their slot waits for them a while
    })
    ws.on('error', (error) => log('socket error', { uid, ip, error: error.message }))
  }

  // --- the loop ---------------------------------------------------------------------------------

  // Fixed steps against the clock: time owed is paid in whole steps, a few
  // at most at once; one timer for every room.
  let owed = 0
  let last = performance.now()
  let timer: NodeJS.Timeout | undefined
  function loop() {
    const now = performance.now()
    owed += now - last
    last = now
    let steps = 0
    while (owed >= STEP_MS && steps < CATCH_UP) {
      lobby.step(now)
      owed -= STEP_MS
      steps++
    }
    if (owed >= STEP_MS) {
      log('behind', { droppedMs: Math.round(owed) })
      owed = 0
    }
    timer = setTimeout(loop, Math.max(0, STEP_MS - owed))
  }

  return {
    lobby,
    http,
    listen() {
      return new Promise<number>((resolve) =>
        http.listen(options.port, () => {
          last = performance.now()
          loop()
          const at = http.address()
          const port = typeof at === 'object' && at ? at.port : 0 // 0: a Unix socket
          log('listening', { port: port || options.port, protocol: PROTOCOL, build, strict, maxRooms, origins })
          resolve(port)
        }),
      )
    },
    // Everyone is told the server is going, then it stops (once the rooms' replays are on disk).
    close() {
      clearTimeout(timer)
      for (const ws of wss.clients) {
        ws.send(JSON.stringify({ t: 'err', code: 'closing', text: 'The server is restarting' }))
        ws.close(4000 + CODES.indexOf('closing'), 'closing')
      }
      records?.close()
      return Promise.all([lobby.dispose(), new Promise<void>((resolve) => http.close(() => resolve()))]).then(() => {})
    },
  }
}
