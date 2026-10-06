import { randomBytes } from 'node:crypto'
import type { Arena } from '../src/game/arena/arena'
import type { Loadout } from '../src/game/loadout'
import { MAPS, type MapId } from '../src/game/maps'
import { MODES, type Mode } from '../src/game/modes'
import { RATE, type ErrorCode, type Lobbying, type Queueing } from '../src/net/protocol'
import { createLobbies, LOBBIES, type LobbiesConfig } from './custom'
import { createMatchmaker, MATCHMAKING, type MatchmakingConfig, type Proposal } from './matchmaker'
import type { Records } from './records'
import { channel, createRoom, type Human, type Room, type RoomOptions } from './room'

// Every room on the server, and who goes where. Classic is matchmaking: a
// page opens a session (a hello with no map), searches for a mode on an
// arena, and the
// matcher (matchmaker.ts) finds it people and a room — a new one, or a bot's
// seat in one already playing — where the lobby seats it on the same socket.
// A room made for a proposal waits for its people's pages to load before its
// first match (room.ts); a backfill takes a bot's seat in a match already on.
// A hello naming a mode and an arena is seated at once instead, in the first
// open room of that mode on that arena, or a new one there (the checks, the
// load tool and the deploy's smoke test; the game never asks for that).
// One live connection per user: a direct seat lets any older one go first;
// a session takes over an older session (the ticket is the player's, not the
// tab's) and is refused while the user holds a seat. Rooms are capped; a
// room nobody has been in for `grace` is closed.
// A session may use custom lobbies instead (custom.ts): the list, a lobby,
// its waiting room — not Classic's queue too (a lobby joined ends a ticket;
// no ticket while in a lobby). A lobby's match gets a room of its own, its
// members seated on the sockets they're in the lobby on; after its results
// they're back in the lobby on the same sockets and the room closes. Custom
// rooms and Classic's share MAX_ROOMS.

export interface LobbyOptions {
  maxRooms: number
  grace?: number // ms an empty room is kept
  results?: number // seconds of results between matches
  arenaFor?: (map: MapId) => Arena // what a room on `map` is played on (the netplay check's test yards); the map's own otherwise
  matchmaking?: Partial<MatchmakingConfig> // the checks' shorter windows
  lobbies?: Partial<LobbiesConfig> // MAX_LOBBIES; the checks' shorter windows
  log?: (message: string, fields?: Record<string, unknown>) => void
  records?: Records // where finished matches and rooms' replays are kept (MATCH_DIR); none: nothing is kept
}

// A player seated at once (a hello with a mode and an arena).
export interface Person {
  uid: string
  name: string
  mode: string
  map: string
  build: string
  loadout: Loadout
  send: Human['send']
  close: Human['close']
}

// A player's matchmaking session: their socket until the lobby seats them.
export interface Searcher {
  uid: string
  name: string
  build: string
  loadout: Loadout
  send: Human['send']
  close: Human['close']
  seat(room: Room, human: Human): void // from now on the socket is that seat's
  release(): void // a custom lobby's match is over for them: the socket is the session's again
  heard: number // ms: the last time the session had a ticket, a lobby or the list (or opened)
}

export type Joined = { room: Room; human: Human } | { error: ErrorCode; text: string }

const IDLE = 60_000 // ms a session may go without a ticket before it's let go

export type Lobby = ReturnType<typeof createLobby>

export function createLobby({ maxRooms, grace = 30_000, results, arenaFor, matchmaking, lobbies: lobbyConfig, log = () => {}, records }: LobbyOptions) {
  const rooms: Room[] = []
  const replays = new Map<Room, ReturnType<Records['replay']>>() // each room's, open while it runs
  const seated = new Map<string, { room: Room; human: Human }>() // by user id
  const searchers = new Map<string, Searcher>() // by user id
  let time = 0 // ms: the latest the lobby was told; the matcher's clock
  const config = { ...MATCHMAKING, ...matchmaking }
  const mm = createMatchmaker(
    {
      now: () => time,
      openings: () => rooms.filter((r) => r.open()).map((r) => ({ id: r.id, mode: r.kind, map: r.map, build: r.build, free: r.free(), humans: r.humans.length, progress: r.progress() })),
      capacity: () => maxRooms - rooms.length,
      start,
      tell: (uid, state) => searchers.get(uid)?.send(JSON.stringify(state)),
      log,
    },
    config,
  )

  function open(mode: Mode, map: MapId, build: string, hold = -1, custom: Partial<RoomOptions> = {}) {
    const id = randomBytes(3).toString('hex')
    const created = Date.now()
    const replay = records?.replay(id, created)
    const room = createRoom({ id, mode, map, build, hold, results, arena: arenaFor?.(map), log, created, record: records?.match, journal: replay?.write, ...custom })
    rooms.push(room)
    if (replay) replays.set(room, replay)
    return room
  }

  // A room is done: its world freed, its replay closed (resolves once the file is on disk).
  function close(room: Room) {
    room.dispose()
    const replay = replays.get(room)
    replays.delete(room)
    return replay?.end() ?? Promise.resolve()
  }

  // A proposal that started: its people seated, oldest ticket first, on the
  // sockets they searched on — a new room that waits for their pages to load,
  // or the backfill's bot seat. False: no room free, or the seat went meanwhile.
  function start(p: Proposal, uids: string[]) {
    const people = uids.map((uid) => searchers.get(uid)).filter((s): s is Searcher => !!s)
    let room = p.room ? rooms.find((r) => r.id === p.room) : undefined
    if (!people.length || (p.room ? !room?.open() : rooms.length >= maxRooms)) return false
    room ??= open(p.mode as Mode, p.map as MapId, people[0].build, Math.round((config.loadTimeoutMs / 1000) * RATE.step))
    if (!p.room) log('room opened', { room: room.id, mode: p.mode, map: p.map, rooms: rooms.length, proposal: p.id, humans: people.length, bots: room.combatants.length - people.length })
    for (const searcher of people) {
      const human = room.join(searcher, time)
      if (!human) return false // (never: a new room has a seat for everyone, a backfill's was just checked)
      searchers.delete(searcher.uid)
      seated.set(searcher.uid, { room, human })
      searcher.seat(room, human)
    }
    return true
  }

  const hosts = (mode: string, map: string): [Mode, MapId] | null =>
    Object.hasOwn(MODES, mode) && Object.hasOwn(MAPS, map) && MAPS[map as MapId].modes.includes(mode as Mode) ? [mode as Mode, map as MapId] : null

  function leave(room: Room, human: Human, now: number) {
    if (rooms.includes(room)) room.leave(human, now) // a room already closed (a lobby's match over, the server stopping) has nothing left to leave
    if (seated.get(human.uid)?.human === human) seated.delete(human.uid)
  }

  // --- custom lobbies -------------------------------------------------------------------------

  const over: Array<{ room: Room; winner: number | null | undefined }> = [] // custom rooms whose match ended this step
  const custom = createLobbies(
    {
      now: () => time,
      tell: (uid, lobby, note) => searchers.get(uid)?.send(JSON.stringify({ t: 'lb', lobby, ...(note && { note }) })),
      show(uids, list) {
        const text = JSON.stringify({ t: 'lbs', list })
        for (const uid of uids) searchers.get(uid)?.send(text)
      },
      hosts: (mode, map) => !!hosts(mode, map),
      channel,
      start(l, plan) {
        if (rooms.length >= maxRooms) return null
        const room = open(l.mode, l.map as MapId, '', Math.round((config.loadTimeoutMs / 1000) * RATE.step), { lobby: l.id, plan, chat: l.chat, settings: l.settings, over: (winner) => over.push({ room, winner }), idle: (human) => custom.act(human.uid, human.name, { t: 'lb', do: 'wait' }) })
        log('room opened', { room: room.id, kind: 'custom', lobby: l.id, mode: l.mode, map: l.map, rooms: rooms.length, humans: plan.filter((s) => s && 'uid' in s).length, bots: plan.filter((s) => s && 'skill' in s).length })
        plan.forEach((seat, i) => seat && 'uid' in seat && place(room, seat.uid, i))
        return room.id
      },
      seat(l, uid) {
        const room = rooms.find((r) => r.id === l.room)
        return !!room && place(room, uid, l.members.get(uid)?.slot ?? -1)
      },
      unseat(_, uid) {
        const s = seated.get(uid)
        if (!s?.room.lobby) return
        leave(s.room, s.human, time)
        searchers.get(uid)?.release()
      },
      end(l) {
        const room = rooms.find((r) => r.id === l.room)
        if (room) finish(room)
      },
      left: (l) => rooms.find((r) => r.id === l.room)?.mode.rules.remaining() ?? 0,
      log,
    },
    { ...LOBBIES, ...lobbyConfig },
  )

  // A member into their slot's seat in the lobby's room, on the socket they're in the lobby on.
  function place(room: Room, uid: string, seat: number) {
    const session = searchers.get(uid)
    if (!session || seated.has(uid)) return false
    const human = room.join(session, time, seat)
    if (!human) return false
    seated.set(uid, { room, human })
    session.seat(room, human)
    return true
  }

  // A custom room is done (its match over, or its lobby gone): its people are
  // back on their sockets as lobby members, and it closes.
  function finish(room: Room) {
    for (const human of room.humans) {
      if (seated.get(human.uid)?.human === human) seated.delete(human.uid)
      searchers.get(human.uid)?.release()
    }
    const at = rooms.indexOf(room)
    if (at < 0) return
    rooms.splice(at, 1)
    void close(room)
    log('room closed', { room: room.id, kind: 'custom', rooms: rooms.length })
  }

  return {
    rooms,
    // A seat at once, in a room of the mode on the arena asked for.
    join(person: Person, now: number): Joined {
      time = now
      const pair = hosts(person.mode, person.map)
      if (!pair) return { error: 'bad-request', text: `No ${person.mode} on ${person.map}` }
      const before = seated.get(person.uid)
      if (before) {
        before.human.close('replaced', 'You joined from somewhere else')
        leave(before.room, before.human, now)
      }
      const searching = searchers.get(person.uid)
      if (searching) {
        mm.cancel(person.uid)
        searchers.delete(person.uid)
        searching.close('replaced', 'You joined from somewhere else')
      }
      const [mode, map] = pair
      let room = rooms.find((r) => r.kind === mode && r.map === map && r.open())
      if (!room) {
        if (rooms.length >= maxRooms) return { error: 'full', text: 'Every room on this server is busy' }
        room = open(mode, map, person.build)
        log('room opened', { room: room.id, mode, map, rooms: rooms.length })
      }
      const human = room.join(person, now)
      if (!human) return { error: 'full', text: 'The match is full' }
      seated.set(person.uid, { room, human })
      return { room, human }
    },
    leave,
    // A matchmaking session opens: refused while the user holds a seat; an
    // older session of theirs is let go, and a ticket kept for them is theirs
    // again (they hear where it stands).
    enter(searcher: Searcher, now: number): { error: ErrorCode; text: string } | null {
      time = now
      if (seated.has(searcher.uid)) return { error: 'busy', text: 'You’re already in an online match' }
      const before = searchers.get(searcher.uid)
      searchers.set(searcher.uid, searcher)
      searcher.heard = now
      before?.close('replaced', 'Searching in another tab now')
      mm.reconnect(searcher.uid)
      return null
    },
    // What a session asks of custom lobbies. False: nothing a working page would send (a strike).
    lobbies(searcher: Searcher, message: Lobbying, now: number) {
      time = now
      const { uid } = searcher
      if (searchers.get(uid) !== searcher) return true // let go already
      const ok = custom.act(uid, searcher.name, message)
      if (custom.memberOf(uid) && mm.ticketOf(uid)) mm.cancel(uid) // a lobby or Classic's queue, not both
      return ok
    },
    // What a session asks. False: nothing the lobby knows (a strike).
    queue(searcher: Searcher, message: Queueing, now: number) {
      time = now
      const { uid } = searcher
      if (searchers.get(uid) !== searcher) return true // let go already: its word no longer counts
      if (message.do === 'search') {
        if (!hosts(message.mode, message.map)) return false
        if (custom.memberOf(uid)) mm.tell(uid) // in a lobby: no ticket
        else mm.search(uid, message.mode, message.map, searcher.build)
      } else if (message.do === 'cancel') mm.cancel(uid)
      else if (message.do === 'state') mm.tell(uid)
      else mm.respond(uid, message.id, message.do === 'accept')
      return true
    },
    // A session's socket closed: a ticket it had waits a while for the
    // player (matchmaker.ts); so does their lobby slot (custom.ts).
    exit(searcher: Searcher, now: number) {
      time = now
      if (searchers.get(searcher.uid) !== searcher) return
      searchers.delete(searcher.uid)
      mm.disconnect(searcher.uid)
      custom.drop(searcher.uid)
    },
    // One fixed step for every room, then matchmaking; rooms empty for longer
    // than `grace` close, and sessions that have gone a minute without a ticket.
    step(now: number) {
      time = now
      for (const room of rooms) room.step(now)
      for (const { room, winner } of over.splice(0)) {
        finish(room)
        custom.over(room.lobby!, winner)
      }
      mm.tick()
      custom.tick()
      for (const s of searchers.values()) {
        if (mm.ticketOf(s.uid) || custom.memberOf(s.uid) || custom.watching(s.uid)) s.heard = now
        else if (now - s.heard > IDLE) s.close('idle', 'No search for a minute')
      }
      for (let i = rooms.length - 1; i >= 0; i--) {
        const room = rooms[i]
        if (room.lobby || room.humans.length || now - room.emptySince < grace) continue // a custom room closes with its match
        rooms.splice(i, 1)
        void close(room)
        log('room closed', { room: room.id, rooms: rooms.length })
      }
    },
    humans: () => rooms.reduce((sum, room) => sum + room.humans.length, 0),
    searching: () => mm.searching(),
    matchmaker: mm,
    custom,
    // Every room closed; resolves once their replays are on disk.
    dispose() {
      const closing = rooms.map(close)
      rooms.length = 0
      seated.clear()
      searchers.clear()
      return Promise.all(closing)
    },
  }
}
