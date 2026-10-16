import { Client, Session, type Socket } from '@heroiclabs/nakama-js'

// Who is playing. The site (www/) serves the game at /play, one origin, so a
// login there is already here: both read and write the same localStorage
// entry. Keep in step with www/src/lib/nakama/. Nothing in a practice match
// needs the server: the menu signs in once it shows, and a failure only
// leaves the player offline.
const KEY = 'scrapyard.session' // { token, refresh_token, guest? }
const DEVICE = 'scrapyard.device' // a guest's ID: the same guest on every visit from this browser
const MARGIN = 5 * 60 // refresh a token with less than this many seconds left

// Build-time settings (game/.env.example); the defaults are the local Podman stack.
export const nakama = new Client(
  import.meta.env.VITE_NAKAMA_KEY ?? 'defaultkey',
  import.meta.env.VITE_NAKAMA_HOST ?? '127.0.0.1',
  import.meta.env.VITE_NAKAMA_PORT ?? '7350',
  import.meta.env.VITE_NAKAMA_SSL === 'true',
  7000,
  false, // refreshing is done below, where the new token is also saved
)

export interface Player {
  session: Session
  guest: boolean
  name: string // display name, else username; 'Guest' for guests
}

function stored(): { session: Session; guest: boolean } | null {
  try {
    const { token, refresh_token, guest } = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    const session = Session.restore(token, refresh_token)
    return session.isrefreshexpired(Date.now() / 1000) ? null : { session, guest: guest === true }
  } catch {
    return null // nothing stored, junk, or storage blocked
  }
}

function save(session: Session, guest: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ token: session.token, refresh_token: session.refresh_token, ...(guest && { guest }) }))
  } catch {}
}

function deviceId() {
  try {
    const id = localStorage.getItem(DEVICE) ?? crypto.randomUUID()
    localStorage.setItem(DEVICE, id)
    return id
  } catch {
    return crypto.randomUUID() // storage blocked: a guest for this visit only
  }
}

// The stored session, refreshed when close to expiry; else (none, revoked,
// expired) a guest. Throws only when the server can't be reached.
async function signIn(): Promise<{ session: Session; guest: boolean }> {
  const kept = stored()
  if (kept && !kept.session.isexpired(Date.now() / 1000 + MARGIN)) return kept
  if (kept) {
    try {
      const session = await nakama.sessionRefresh(kept.session)
      save(session, kept.guest)
      return { session, guest: kept.guest }
    } catch (e) {
      if (!(e instanceof Response)) throw e // no server: offline, keep the session for later
    }
  }
  const session = await nakama.authenticateDevice(deviceId(), true)
  save(session, true)
  return { session, guest: true }
}

// The session to show the game server when joining an online match: the
// stored one, refreshed when close to expiry, else a guest's. Throws when
// Nakama can't be reached.
export async function freshSession() {
  const { session, guest } = await signIn()
  return { token: session.token, guest }
}

async function signInNamed(): Promise<Player> {
  const { session, guest } = await signIn()
  if (guest) return { session, guest, name: 'Guest' }
  const { user } = await nakama.getAccount(session)
  return { session, guest, name: user?.display_name || user?.username || session.username || 'Player' }
}

// A socket held open while the game runs, so the site can count players
// online (nakama/data/modules/stats.lua): the presence ends when it closes.
// A dropped socket (a server restart, a network blip, no server at all)
// comes back after a pause, with a fresh session: 5 s after a live socket
// dropped, doubling to a minute while connecting keeps failing. The match
// chat (chat.ts) talks over it: onSocket says which socket is live, and
// again each time that changes.
let live: Socket | null = null
const socketListeners = new Set<(socket: Socket | null) => void>()
function setLive(socket: Socket | null) {
  live = socket
  for (const listener of socketListeners) listener(socket)
}

// `listener` hears the live socket now and whenever it changes (null: none). Returns the unsubscribe.
export function onSocket(listener: (socket: Socket | null) => void) {
  socketListeners.add(listener)
  listener(live)
  return () => void socketListeners.delete(listener)
}

function goOnline(session: Session, wait = 5) {
  const socket = nakama.createSocket(nakama.useSSL)
  let connected = false
  let retrying = false
  const retry = () => {
    if (live === socket) setLive(null)
    if (retrying) return
    retrying = true
    const next = connected ? 5 : Math.min(wait * 2, 60)
    setTimeout(
      () =>
        signIn().then(
          ({ session }) => goOnline(session, next),
          () => goOnline(session, next),
        ),
      (connected ? 5 : wait) * 1000,
    )
  }
  socket.ondisconnect = retry
  socket
    .connect(session, false)
    .then(() => {
      connected = true
      setLive(socket)
      return socket.rpc('join_online', '{}')
    })
    .catch(retry)
}

let current: Promise<Player> | null = null

// Signs in once per page load; a failed attempt is retried on the next call.
export function player(): Promise<Player> {
  current ??= signInNamed()
    .then((p) => {
      goOnline(p.session)
      return p
    })
    .catch((e) => {
      current = null
      throw e
    })
  return current
}
