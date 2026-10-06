import type { Loadout } from '../game/loadout'
import { gameServerUrl, link, NetError, openSocket, REASONS, reasonFor, sayHello, type Link } from './connection'
import { readServer, type LobbyForm, type LobbyNote, type LobbyRow, type LobbyView, type Lobbying, type ServerMessage, type Welcome } from './protocol'
import { freshSession } from './session'

// Custom lobbies as the page sees them (server/custom.ts,
// .claude/work/custom/PLAN.md §9): one store the arena screen's Custom entry
// reads — the list, the waiting room, the lobby's match — mirroring what the
// game server says and never ahead of it (a lobby exists once the server
// says so). It owns a session socket from the Custom entry on: a hello with
// no map, then the list watched. In a lobby the socket stays open wherever
// the player goes; the lobby's match comes as a welcome on it, which becomes
// the match's link (connection.ts) with the lobby's word passed aside, and
// once the server says the match is over for the player (its end, Back to
// lobby, a kick) the store takes the socket back. A socket that drops in a
// lobby or its match is opened again within the server's grace, which keeps
// the slot (and the seat); so is one a reload cut off (the tab remembers the
// lobby: resumeLobby). DOM-free, but for that one sessionStorage entry.

// What was asked and waits for the server's word ('' nothing): the list, a
// lobby made, joined from the list or by code, edited, a match started.
export type Asked = '' | 'watch' | 'create' | 'join' | 'code' | 'edit' | 'start'

export type Custom =
  | { phase: 'off'; error: string } // no socket; error: why the last one ended, in the player's words ('' none)
  | { phase: 'connecting' }
  | { phase: 'browsing'; list: LobbyRow[] | null; at: number; asked: Asked; note: string; rtt: number } // list null: on its way; at: when it came (performance.now()); note: the last refusal
  | { phase: 'lobby'; lobby: LobbyView; at: number; asked: Asked; note: string; rtt: number } // the waiting room, or its match running without the player
  | { phase: 'back'; id: string; away: 'dropped' | 'reloaded' } // the socket again, then back into lobby `id` (why it went: a drop, a reload)
  | { phase: 'seated'; link: Link; lobby: LobbyView | null } // in the lobby's match (null: its view is on its way)

// Why the server refused, or why the player is out of a lobby, in their words.
export const NOTES: Record<LobbyNote, string> = {
  gone: 'That lobby is gone',
  full: 'That lobby is full',
  password: 'Wrong password',
  slow: 'Too many wrong passwords — try again in a minute',
  banned: 'You were kicked from that lobby',
  kicked: 'The owner kicked you from the lobby',
  deleted: 'The owner left, and the lobby closed',
  closed: 'The lobby closed: 30 minutes with nothing going on',
  busy: 'No room free on the server — try again in a moment',
  cap: 'Too many lobbies on the server — join one, or try again later',
  taken: 'You’re in a lobby already',
}
const RETRY = [0, 1000, 2000, 4000, 7000] // ms before each try to get the socket back: the server keeps a slot 20 s
const MARK = 'scrapyard.lobby' // sessionStorage, per tab: the lobby the player is in (its id)
const PING = 2000 // ms between round trips measured (the list's ping column)
const WAITS: Asked[] = ['watch', 'create', 'join', 'code', 'edit', 'start']

// A socket that said hello with the player's session. The checks dial their own.
export type Dial = () => Promise<{ open: WebSocket; token: string; guest: boolean }>
const dialServer: Dial = async () => {
  const { token, guest } = await freshSession().catch(() => Promise.reject(new NetError(REASONS.offline)))
  return { open: await openSocket(gameServerUrl()), token, guest }
}

let state: Custom = { phase: 'off', error: '' }
const listeners = new Set<() => void>()
let socket: WebSocket | null = null
let gear: Loadout | null = null // the loadout the lobby was opened with
let pinger: ReturnType<typeof setInterval> | undefined
let currentDial: Dial = dialServer
let rtt = 0
let attempt = 0 // each open: a stale one lets its socket go
let answer: ((no: string) => void) | null = null // the ask waiting for the server's word
let invite = '' // an invite link's code: asked for once the list is up, on whichever open gets there
let closing: ReturnType<typeof setTimeout> | undefined // the Custom entry left: its socket about to go

function set(next: Custom) {
  state = next
  try {
    const id = next.phase === 'back' ? next.id : next.phase === 'lobby' || next.phase === 'seated' ? next.lobby?.id : ''
    if (id) sessionStorage.setItem(MARK, id)
    else if (next.phase === 'off' || next.phase === 'browsing') sessionStorage.removeItem(MARK)
  } catch {} // no storage: a reload starts over (the slot ends with its grace)
  if (answer && !('asked' in next && next.asked)) {
    const told = answer
    answer = null
    told(next.phase === 'browsing' || next.phase === 'lobby' ? next.note : next.phase === 'off' ? next.error : '') // a yes moves on: into a lobby, a match
  }
  for (const listener of listeners) listener()
}

export const currentCustom = () => state
export function onCustom(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function send(message: object) {
  if (socket?.readyState === socket?.OPEN) socket?.send(JSON.stringify(message))
}

// The round trip, measured while the store reads the socket (the match's link measures its own).
function pinging(on: boolean) {
  clearInterval(pinger)
  if (on) pinger = setInterval(() => send({ t: 'ping', c: performance.now() }), PING)
}

// The store reads the socket (the match's link, while it has it, passes the lobby's word on).
function attach(open: WebSocket, token: string, guest: boolean, loadout: Loadout) {
  socket = open
  open.onmessage = (e) => hear(open, readServer(e.data))
  open.addEventListener('close', () => dropped(open)) // heard through the match's link too
  sayHello(open, { token, guest, loadout })
  pinging(true)
}

// The list, watched from now on (and fresh at once).
function browse(note = '') {
  set({ phase: 'browsing', list: null, at: 0, asked: 'watch', note, rtt })
  send({ t: 'lb', do: 'watch' })
}

// The Custom entry: signs in (a guest when signed out), opens the socket and watches the list.
export async function openCustom(loadout: Loadout, dial = dialServer) {
  clearTimeout(closing)
  if (state.phase !== 'off') return
  gear = loadout
  currentDial = dial
  const mine = ++attempt
  set({ phase: 'connecting' })
  try {
    const { open, token, guest } = await dial()
    if (mine !== attempt) return open.close() // closed meanwhile
    attach(open, token, guest, loadout)
    browse()
    if (invite) void ask({ t: 'lb', do: 'code', code: invite })
    invite = ''
  } catch (error) {
    if (mine === attempt) set({ phase: 'off', error: error instanceof NetError ? error.message : REASONS.unreachable })
  }
}

// An invite link (?join=CODE): the Custom entry opens and joins its lobby.
export function openInvite(loadout: Loadout, code: string, dial = dialServer) {
  invite = code
  void openCustom(loadout, dial)
}

// Leaving the Custom entry: the socket goes, unless the player is in a
// lobby. A moment later: an entry opened again at once (React's StrictMode
// mounts twice in development) keeps it, and the list's note with it.
export function closeCustom() {
  clearTimeout(closing)
  closing = setTimeout(() => {
    if (state.phase !== 'connecting' && state.phase !== 'browsing') return
    attempt++
    const open = socket
    socket = null
    pinging(false)
    if (open?.readyState === open?.OPEN) open?.send('{"t":"bye"}')
    open?.close()
    set({ phase: 'off', error: '' })
  })
}

type Ask = Exclude<Lobbying, { form: LobbyForm }> | ({ t: 'lb'; do: 'create' | 'edit' } & LobbyForm)

// What the player asks of the lobbies; the store changes on the server's
// word. Resolves with it once it comes: the no in the player's words, ''
// for a yes (at once for what waits for no answer).
export function ask(message: Ask): Promise<string> {
  const waits = WAITS.find((each) => each === message.do)
  if (!socket || !waits || (state.phase !== 'browsing' && state.phase !== 'lobby')) {
    send(message)
    return Promise.resolve('')
  }
  send(message)
  const told = new Promise<string>((resolve) => (answer = resolve))
  set({ ...state, asked: waits, note: '' })
  return told
}

// Back to the waiting room from the lobby's match (its menu, its results): the server's word brings the page back.
export function leaveMatch() {
  if (state.phase === 'seated') send({ t: 'lb', do: 'wait' })
}

function hear(from: WebSocket, message: ServerMessage) {
  if (from !== socket) return
  if (message.t === 'lbs') {
    if (state.phase === 'browsing') set({ ...state, list: message.list, at: performance.now(), asked: state.asked === 'watch' ? '' : state.asked })
  } else if (message.t === 'lb') lobbied(from, message.lobby, message.note)
  else if (message.t === 'welcome') seated(from, message)
  else if (message.t === 'pong') {
    rtt = performance.now() - message.c
    if (state.phase === 'browsing' || state.phase === 'lobby') set({ ...state, rtt })
  } else if (message.t === 'err') {
    socket = null // the server closes it
    pinging(false)
    set({ phase: 'off', error: reasonFor(message.code, message.text) })
  }
}

// The member's lobby as it now stands; null: out of it, or not let in (the note says why).
function lobbied(from: WebSocket, lobby: LobbyView | null, note?: LobbyNote) {
  const words = !note
    ? ''
    : note !== 'gone'
      ? NOTES[note]
      : state.phase === 'back'
        ? 'Back too late — the lobby went on without you'
        : state.phase === 'browsing' && state.asked === 'code'
          ? 'No lobby has that code'
          : NOTES.gone
  if (state.phase === 'seated') {
    if (lobby?.playing) return set({ ...state, lobby })
    // the match is over for the player: the socket is the lobby's again
    state.link.release()
    from.onmessage = (e) => hear(from, readServer(e.data))
    pinging(true)
  } else if (!lobby && state.phase === 'browsing') return set({ ...state, asked: '', note: words }) // not let in
  if (!lobby) return browse(words)
  if (state.phase === 'browsing') send({ t: 'lb', do: 'unwatch' }) // in a lobby: the list can wait
  set({ phase: 'lobby', lobby, at: performance.now(), asked: '', note: words, rtt })
}

// The lobby's match: the socket is the match's link, the lobby's word passed aside.
function seated(from: WebSocket, welcome: Welcome) {
  pinging(false)
  if (state.phase === 'browsing') send({ t: 'lb', do: 'unwatch' }) // straight into a running match
  set({ phase: 'seated', link: link(from, welcome, (message) => hear(from, message)), lobby: state.phase === 'lobby' ? state.lobby : null })
}

// The socket went. Dropped from a lobby or its match: back within the
// server's grace. Not when the page let the match's link go itself, or the
// server said why it closed it (another tab took over, an update): that's
// the end, in the player's words.
function dropped(from: WebSocket) {
  if (from !== socket) return
  socket = null
  pinging(false)
  const why = state.phase === 'seated' ? state.link.status.closed : ''
  const lobby = state.phase === 'lobby' || state.phase === 'seated' ? state.lobby : null
  if (lobby && (!why || why === REASONS.lost)) {
    set({ phase: 'back', id: lobby.id, away: 'dropped' })
    return void comeBack(++attempt, 0)
  }
  set({ phase: 'off', error: why === 'left' ? '' : why || REASONS.lost })
}

// A socket again, then back into the lobby: the server's word (the waiting
// room; in a match, a fresh welcome for the seat it held) moves the store on.
async function comeBack(mine: number, tries: number) {
  await new Promise((resolve) => setTimeout(resolve, RETRY[tries]))
  if (mine !== attempt || state.phase !== 'back' || !gear) return
  const { id } = state
  try {
    const { open, token, guest } = await currentDial()
    if (mine !== attempt || state.phase !== 'back') return open.close()
    attach(open, token, guest, gear)
    send({ t: 'lb', do: 'back', id })
  } catch {
    if (mine !== attempt || state.phase !== 'back') return
    if (tries + 1 < RETRY.length) return comeBack(mine, tries + 1)
    set({ phase: 'off', error: REASONS.lost })
  }
}

// A reload in a lobby (this tab remembers which): back in within the
// server's grace. True when there is one to go back to.
export function resumeLobby(loadout: Loadout) {
  let id = ''
  try {
    id = sessionStorage.getItem(MARK) ?? ''
  } catch {} // no storage: nothing to go back to
  if (!id || state.phase !== 'off') return false
  gear = loadout
  set({ phase: 'back', id, away: 'reloaded' })
  void comeBack(++attempt, 0)
  return true
}
