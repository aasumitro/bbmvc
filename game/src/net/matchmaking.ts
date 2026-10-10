import type { Loadout } from '../sim/loadout.ts'
import { link, NetError, REASONS, reasonFor, sayHello, type Link } from './connection.ts'
import { readServer, type Queue, type Queueing, type QueueNote, type ServerMessage } from './protocol.ts'
import { comeBack, dial, mark, readMark } from './sessionSocket.ts'

// Classic's matchmaking as the page sees it: one store every screen reads
// (the arena screen's Classic button, the match-found overlay over whatever
// shows, a practice match included), mirroring what the game server's
// matcher says (server/matchmaker.ts) and never ahead of it. It owns the
// socket from Find Match on: a hello with the player's session and no map
// (a matchmaking session), then the search for a mode on an arena; the
// server's word on the ticket comes back whole each time it changes. The seat comes as a welcome on the
// same socket, which becomes the match's link (connection.ts) for the
// runtime to take (takeSeat). A socket that drops with a ticket out is
// opened again within the server's grace, where the ticket waits; so is one
// a reload cut off (the tab remembers it had a ticket out: resumeSearch). No
// ticket, no socket. DOM-free, but for that one sessionStorage entry
// (sessionSocket.ts: the dial, the retries and the mark, as custom's store).

export type Search =
  | { phase: 'idle'; note: string } // note: how the last search ended, in the player's words ('' none)
  | { phase: 'connecting'; mode: string; map: string }
  | { phase: 'searching'; mode: string; map: string; since: number; note: string; away: '' | 'dropped' | 'reloaded' } // since: performance.now() at the ticket's start; away: why the socket is being opened again ('' it's open)
  | {
      phase: 'found' | 'accepted'
      mode: string
      id: string
      map: string
      players: number
      size: number
      accepted: number
      declined: number
      deadline: number
      of: number
      answered: boolean
    } // deadline: performance.now(); answered: sent, not yet confirmed
  | { phase: 'seated'; link: Link }

const NOTES: Record<QueueNote, string> = {
  cancelled: 'Search cancelled',
  declined: 'You declined the match',
  missed: 'You didn’t accept in time',
  gone: 'Your search timed out',
  short: 'Not everyone accepted — back in the queue, your place kept',
  full: 'No room free on the server — back in the queue, your place kept',
}
const NOTE = 5000 // ms a note is said for
const MARK = 'scrapyard.search' // sessionStorage, per tab: a ticket is out, in this mode on this arena ({ mode, map })

let state: Search = { phase: 'idle', note: '' }
const listeners = new Set<() => void>()
let socket: WebSocket | null = null
let gear: Loadout | null = null // the gun the seat is fitted with
let attempt = 0 // each Find Match and each try to come back: a stale one lets its socket go

function set(next: Search) {
  state = next
  mark(MARK, next.phase === 'idle' || next.phase === 'seated' ? null : JSON.stringify({ mode: next.mode, map: next.map }))
  for (const listener of listeners) listener()
  if ('note' in next && next.note) setTimeout(() => state === next && set({ ...next, note: '' }), NOTE) // said, then gone
}

export const currentSearch = () => state
export function onSearch(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function send(message: Pick<Queueing, 't' | 'do'> & Partial<Queueing>) {
  if (socket?.readyState === socket?.OPEN) socket?.send(JSON.stringify(message))
}

// Signs in, opens a socket and says hello: a matchmaking session. Rejects
// with the player's reason.
async function connect(loadout: Loadout) {
  const { open, token, guest } = await dial()
  sayHello(open, { token, guest, loadout })
  open.onmessage = (e) => hear(open, readServer(e.data))
  open.onclose = () => dropped(open)
  return open
}

function hear(from: WebSocket, message: ServerMessage) {
  if (from !== socket) return
  if (message.t === 'mm') return mirror(message)
  if (message.t === 'welcome') {
    socket = null // the match's now
    return set({ phase: 'seated', link: link(from, message) })
  }
  if (message.t === 'err') {
    socket = null // the server closes it
    set({ phase: 'idle', note: reasonFor(message.code, message.text) })
  }
}

// The server's word on the ticket, as the page keeps it (its times on the page's clock).
function mirror(q: Queue) {
  const now = performance.now()
  if (q.state === 'idle') {
    const lost = state.phase === 'searching' && state.away === 'dropped' // came back to find it gone
    close()
    return set({ phase: 'idle', note: q.note ? NOTES[q.note] : lost ? REASONS.lost : '' })
  }
  if (q.state === 'searching') return set({ phase: 'searching', mode: q.mode, map: q.map, since: now - q.waited, note: q.note ? NOTES[q.note] : '', away: '' })
  set({
    phase: q.state,
    mode: q.mode,
    id: q.id,
    map: q.map,
    players: q.players,
    size: q.size,
    accepted: q.accepted,
    declined: q.declined,
    deadline: now + q.left,
    of: q.of,
    answered: false,
  })
}

// No ticket: nothing to keep the socket for.
function close() {
  const open = socket
  socket = null
  if (open?.readyState === open?.OPEN) open?.send('{"t":"bye"}')
  open?.close()
}

// The socket went with a ticket out: back within the server's grace. A ready
// check it was in is lost (the server counts it a decline).
function dropped(from: WebSocket) {
  if (from !== socket) return
  socket = null
  if (state.phase === 'idle' || state.phase === 'seated') return
  set({ phase: 'searching', mode: state.mode, map: state.map, since: state.phase === 'searching' ? state.since : performance.now(), note: '', away: 'dropped' })
  void back(++attempt)
}

// The socket again, then the server's word on the ticket.
function back(mine: number) {
  const away = () => mine === attempt && state.phase === 'searching' && !!state.away
  return comeBack(
    () => away() && !!gear,
    async () => {
      const open = await connect(gear!)
      if (!away()) return open.close()
      socket = open
      send({ t: 'mm', do: 'state' })
    },
    () => set({ phase: 'idle', note: REASONS.lost }),
  )
}

// A reload with a ticket out in this tab: its socket again, and the server's
// word on the ticket — searching where it was, or nothing. Once, as the menu shows.
export function resumeSearch(loadout: Loadout) {
  let saved: { mode?: unknown; map?: unknown } | null = null
  try {
    saved = JSON.parse(readMark(MARK) || 'null')
  } catch {} // an older page's plain mode: nothing to resume
  const { mode, map } = saved ?? {}
  if (typeof mode !== 'string' || typeof map !== 'string' || state.phase !== 'idle') return
  gear = loadout
  set({ phase: 'searching', mode, map, since: performance.now(), note: '', away: 'reloaded' })
  void back(++attempt)
}

// Find Match: a ticket for `mode` on `map`, from idle.
export async function findMatch(mode: string, map: string, loadout: Loadout) {
  if (state.phase !== 'idle') return
  const mine = ++attempt
  gear = loadout
  set({ phase: 'connecting', mode, map })
  try {
    const open = await connect(loadout)
    if (mine !== attempt) return open.close() // cancelled meanwhile
    socket = open
    send({ t: 'mm', do: 'search', mode, map })
  } catch (error) {
    if (mine === attempt) set({ phase: 'idle', note: error instanceof NetError ? error.message : REASONS.unreachable })
  }
}

// Cancel Search: the server ends the ticket and says so. Still connecting,
// or with the socket away, the page just stops (a ticket left on the server
// ends with its grace).
export function cancelSearch() {
  if (state.phase === 'connecting' || (state.phase === 'searching' && !socket)) {
    attempt++
    close()
    return set({ phase: 'idle', note: NOTES.cancelled })
  }
  if (state.phase === 'searching') send({ t: 'mm', do: 'cancel' })
}

// The ready check: an answer goes to the server, whose word decides.
export function answer(accept: boolean) {
  if ((state.phase !== 'found' && state.phase !== 'accepted') || (accept && state.phase === 'accepted')) return
  send({ t: 'mm', do: accept ? 'accept' : 'decline', id: state.id })
  set({ ...state, answered: true })
}

// The seat, once: the runtime plays the match on it.
export function takeSeat(): Link | null {
  if (state.phase !== 'seated') return null
  const seat = state.link
  set({ phase: 'idle', note: '' })
  return seat
}
