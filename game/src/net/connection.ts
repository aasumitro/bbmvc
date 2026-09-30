import type { Loadout } from '../game/loadout'
import { BUILD, PROTOCOL, readServer, type ErrorCode, type ServerMessage, type Welcome } from './protocol'

// The browser's end of the match socket: open it, say hello with the
// player's session, wait for a seat (or the reason there isn't one), then
// keep what the server says until the match takes it, ping it now and then
// for the round trip, and say goodbye on the way out. The server's address:
// VITE_GAME_SERVER when set; else, in development, port 7360 on the page's
// own host; else /match on the page's own origin (Caddy passes it on). Runs
// in Node too (the checks connect through it, with an address of their own).

const TIMEOUT = 5000 // ms to open, and again to be seated
const PING = 2000

// What went wrong, in the words the player reads.
export class NetError extends Error {}

export const REASONS = {
  unreachable: "Can't reach the game server",
  offline: "Online play needs a sign-in — you're offline",
  full: 'Server full',
  version: 'Game updated — reload the page',
  arena: 'Arena mismatch — reload the page',
  lost: 'Lost the connection to the game server',
}

export function gameServerUrl() {
  const set = import.meta.env.VITE_GAME_SERVER as string | undefined
  if (set) return set
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return import.meta.env.DEV ? `${scheme}://${location.hostname}:7360/match` : `${scheme}://${location.host}/match`
}

// A socket that opened. `origin`: sent by Node only (a browser sends its page's).
// Binary frames (the snapshots) arrive as ArrayBuffers.
export function openSocket(url: string, origin?: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = origin ? new WebSocket(url, { headers: { Origin: origin } } as unknown as string[]) : new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    const timer = setTimeout(() => fail(), TIMEOUT)
    function fail() {
      clearTimeout(timer)
      socket.onopen = socket.onerror = null
      socket.close()
      reject(new NetError(REASONS.unreachable))
    }
    socket.onerror = fail
    socket.onopen = () => {
      clearTimeout(timer)
      socket.onerror = null
      resolve(socket)
    }
  })
}

export interface Hello {
  token: string
  guest: boolean
  mode?: string // with a map: a seat at once (the checks' way in); neither: a matchmaking session (matchmaking.ts)
  map?: string
  loadout: Loadout
}

// Who is playing (their session), from which build, with what gun.
export const sayHello = (socket: WebSocket, hello: Hello) => socket.send(JSON.stringify({ t: 'hello', v: PROTOCOL, build: BUILD, ...hello }))

export type Link = ReturnType<typeof link>

// Says hello asking for a seat at once, in a room of that mode on that arena,
// and waits for it. Rejects with what the player should read: a refusal
// (full, an old page, a bad session) or a server that went quiet. The
// checks' way in; the game's is matchmaking (matchmaking.ts).
export function join(socket: WebSocket, hello: Hello & { mode: string; map: string }) {
  return new Promise<Link>((resolve, reject) => {
    const timer = setTimeout(() => refuse(REASONS.unreachable), TIMEOUT)
    function refuse(reason: string) {
      clearTimeout(timer)
      socket.close()
      reject(new NetError(reason))
    }
    socket.onmessage = (e) => {
      const message = readServer(e.data)
      if (message.t === 'err') return refuse(reasonFor(message.code, message.text))
      if (message.t !== 'welcome') return
      clearTimeout(timer)
      resolve(link(socket, message))
    }
    socket.onclose = () => refuse(REASONS.unreachable)
    sayHello(socket, hello)
  })
}

// A match over a socket the server has just seated (its welcome): everything
// the server says from now on waits in `take()` until the match takes it; a
// ping now and then for the round trip; goodbye on the way out.
export function link(socket: WebSocket, welcome: Welcome) {
  const inbox: Array<{ message: ServerMessage; at: number }> = [] // each with when it arrived (performance.now())
  const status = { rtt: 0, closed: '', sent: 0 } // closed: why the link ended ('' while open)
  let pong: ((k: number, at: number) => void) | null = null
  const ping = setInterval(() => socket.readyState === socket.OPEN && socket.send(JSON.stringify({ t: 'ping', c: performance.now() })), PING)

  socket.onmessage = (e) => {
    const message = readServer(e.data)
    if (message.t === 'pong') {
      status.rtt = performance.now() - message.c
      return pong?.(message.k, performance.now())
    }
    if (message.t === 'err') status.closed = reasonFor(message.code, message.text)
    inbox.push({ message, at: performance.now() })
  }
  socket.onclose = () => {
    clearInterval(ping)
    status.closed ||= REASONS.lost
  }
  return {
    welcome,
    status,
    take: () => inbox.splice(0),
    send(text: string) {
      if (socket.readyState !== socket.OPEN) return
      status.sent += text.length
      socket.send(text)
    },
    onPong(listen: (k: number, at: number) => void) {
      pong = listen
    },
    close() {
      clearInterval(ping)
      if (socket.readyState === socket.OPEN) socket.send('{"t":"bye"}')
      status.closed ||= 'left'
      socket.close()
    },
  }
}

// The player's reading of a refusal.
export function reasonFor(code: ErrorCode, text: string) {
  if (code === 'full') return REASONS.full
  if (code === 'version') return REASONS.version
  return text
}
