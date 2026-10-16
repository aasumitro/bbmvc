import type { Queue, QueueNote } from '../src/net/protocol.ts'

// Classic's matchmaking: who plays together, and when. A player asks for a
// mode on an arena and gets a ticket. The matcher offers the oldest tickets
// bots' seats in matches already running there (a backfill), then groups the
// rest — same mode, same arena, same build, oldest first — into proposals: eight
// people at first, fewer the longer the oldest has waited. Everyone in a
// proposal accepts or declines within the ready check; enough accepts start
// it (seating makes the room and seats them: server/seating.ts, bots take the
// other seats), and the people who accepted a proposal that didn't start go
// back to the queue in the place they had. Pure: no sockets, rooms or
// timers. The lobby gives it the clock and what it needs to know of the
// rooms, passes on what players ask, and ticks it every step; the matcher
// tells each player where they stand (protocol.ts Queue) whenever that
// changes. Tests: matchmaker.test.ts.

// Every number it runs on (the brief's names in capitals).
export const MATCHMAKING = {
  targetHumans: 8, // TARGET_HUMANS: seats in a Classic room, and the group the matcher prefers
  minHumansToStart: 2, // MIN_HUMANS_TO_START: the fewest people a new room starts with; bots take the other seats
  fullOnlyWindowMs: 10_000, // FULL_ONLY_WINDOW_MS: until the oldest ticket of a group has waited this long, full groups only
  startSmallAfterMs: 30_000, // START_SMALL_AFTER_MS: from then on, a group of minHumansToStart or more; before (after the full-only window), minHumansToStart + 2 or more
  readyCheckMs: 10_000, // READY_CHECK_MS: to answer a match found (the page counts down what the server says is left)
  loadTimeoutMs: 20_000, // LOAD_TIMEOUT_MS: a new room's first match waits this long at most for its people's pages to load
  searchDisconnectGraceMs: 15_000, // SEARCH_DISCONNECT_GRACE_MS: a searching ticket outlives its connection this long
  backfillEnabled: true, // BACKFILL_ENABLED: searching people may be offered bots' seats in running matches
  backfillMaxMatchProgress: 0.5, // BACKFILL_MAX_MATCH_PROGRESS: never into a match further along than this
}
export type MatchmakingConfig = typeof MATCHMAKING

interface Ticket {
  id: string
  uid: string // the player: the server's reading of their session, never a field they sent
  mode: string
  map: string // the arena asked for: only ever played on that one
  build: string // the page's build: tickets of different builds never play together
  status: 'searching' | 'in_proposal' | 'matched' | 'cancelled'
  createdAt: number // ms; a requeue keeps it, so the ticket keeps its place
  proposal?: Proposal
  disconnectedAt?: number // ms; searching with no connection: out of every group until it's back
}

export interface Proposal {
  id: string
  mode: string
  map: string // the arena its tickets asked for
  uids: string[] // who was asked, oldest ticket first
  accepted: Set<string>
  declined: Set<string>
  state: 'ready_check' | 'starting' | 'started' | 'cancelled'
  expiresAt: number // ms: the end of the ready check
  room?: string // a backfill: the room whose bot's seat is offered
  players: number // people in the match if it starts
}

// A room that takes newcomers, as the lobby sees it.
export interface Opening {
  id: string
  mode: string
  map: string
  build: string
  free: number // bots' seats
  humans: number
  progress: number // of its match: 0 at the start, 1 at the end
}

export interface MatchmakerHooks {
  now(): number // ms
  openings(): readonly Opening[] // the rooms taking newcomers
  capacity(): number // how many more rooms may be opened
  start(proposal: Proposal, uids: string[]): boolean // seats those who accepted (oldest first): a new room, or the backfill's seat; false when it can't now
  tell(uid: string, state: Queue): void
  log?(message: string, fields: Record<string, unknown>): void
}

// Who may play together (pluggable: a rating band, a region, a party would go here).
const sameQueue = (a: Ticket, b: Ticket) => a.mode === b.mode && a.map === b.map && a.build === b.build

export function createMatchmaker(hooks: MatchmakerHooks, config: MatchmakingConfig = MATCHMAKING, compatible: (a: Ticket, b: Ticket) => boolean = sameQueue) {
  const tickets = new Map<string, Ticket>() // by uid, one each, in the order they were made
  const proposals = new Map<string, Proposal>() // in their ready check
  const log = (message: string, fields: Record<string, unknown>) => hooks.log?.(message, fields)
  let serial = 0

  // Where a player stands, as their page is told.
  function stateOf(uid: string, note?: QueueNote): Queue {
    const t = tickets.get(uid)
    const said = note ? { note } : {}
    if (!t) return { t: 'mm', state: 'idle', ...said }
    const now = hooks.now()
    const p = t.proposal
    if (!p) return { t: 'mm', state: 'searching', mode: t.mode, map: t.map, waited: now - t.createdAt, ...said }
    return {
      t: 'mm',
      state: p.accepted.has(uid) ? 'accepted' : 'found',
      mode: p.mode,
      id: p.id,
      map: p.map,
      players: p.players,
      size: p.uids.length,
      accepted: p.accepted.size,
      declined: p.declined.size,
      left: Math.max(0, p.expiresAt - now),
      of: config.readyCheckMs,
    }
  }
  const tell = (uid: string, note?: QueueNote) => hooks.tell(uid, stateOf(uid, note))
  // Everyone still in a proposal hears how it stands.
  const update = (p: Proposal) => p.uids.forEach((uid) => tickets.get(uid)?.proposal === p && tell(uid))

  // The ticket is over: cancelled, declined, not answered, away too long.
  function end(t: Ticket, note: QueueNote) {
    t.status = 'cancelled'
    t.proposal = undefined
    tickets.delete(t.uid)
    log('ticket cancelled', { ticket: t.id, uid: t.uid, reason: note })
    tell(t.uid, note)
  }

  // An answer to the ready check the player is in. Only an answer to their own
  // proposal before its deadline counts; anything else changes nothing, and
  // they hear where they stand. At or past the deadline the check ends as it
  // stood — the same outcome whether a tick or the late answer gets there first.
  function respond(uid: string, id: string, accept: boolean) {
    const t = tickets.get(uid)
    const p = t?.proposal
    if (!t || !p || p.id !== id) return tell(uid)
    if (hooks.now() >= p.expiresAt) return resolve(p)
    if (accept && p.accepted.has(uid)) return tell(uid) // a repeat
    if (accept) p.accepted.add(uid)
    else {
      p.accepted.delete(uid)
      p.declined.add(uid)
    }
    log(accept ? 'accepted' : 'declined', { proposal: p.id, ticket: t.id, uid })
    if (!accept) end(t, 'declined')
    if (p.accepted.size + p.declined.size === p.uids.length) resolve(p)
    else update(p)
  }

  // The ready check is over: everyone answered, or its time is up. Those who
  // didn't answer are out. Enough accepts start it — bots take the other
  // seats — else it's off, and those who accepted go back to the queue in the
  // place they had; so they do when the lobby can't seat them after all.
  function resolve(p: Proposal) {
    proposals.delete(p.id)
    const members = p.uids.map((uid) => tickets.get(uid)).filter((t): t is Ticket => t?.proposal === p)
    for (const t of members) {
      if (p.accepted.has(t.uid)) continue
      log('timed out', { proposal: p.id, ticket: t.id, uid: t.uid })
      end(t, 'missed')
    }
    const accepted = members.filter((t) => p.accepted.has(t.uid))
    const enough = accepted.length >= (p.room ? 1 : config.minHumansToStart)
    p.state = enough ? 'starting' : 'cancelled'
    if (
      enough &&
      hooks.start(
        p,
        accepted.map((t) => t.uid),
      )
    ) {
      p.state = 'started'
      for (const t of accepted) {
        t.status = 'matched'
        tickets.delete(t.uid)
      }
      if (p.room) log('backfill accepted', { proposal: p.id, room: p.room, map: p.map, uid: accepted[0].uid, humans: p.players })
      else
        log('proposal started', {
          proposal: p.id,
          mode: p.mode,
          map: p.map,
          humans: accepted.length,
          bots: config.targetHumans - accepted.length,
          asked: p.uids.length,
        })
      return
    }
    p.state = 'cancelled'
    log('proposal cancelled', {
      proposal: p.id,
      map: p.map,
      room: p.room,
      reason: enough ? 'no room' : 'too few accepted',
      accepted: accepted.length,
      asked: p.uids.length,
    })
    for (const t of accepted) {
      t.status = 'searching'
      t.proposal = undefined
      tell(t.uid, enough ? 'full' : 'short')
    }
  }

  function propose(members: Ticket[], map: string, now: number, room?: Opening) {
    const p: Proposal = {
      id: `p${++serial}`,
      mode: members[0].mode,
      map,
      uids: members.map((t) => t.uid),
      accepted: new Set(),
      declined: new Set(),
      state: 'ready_check',
      expiresAt: now + config.readyCheckMs,
      room: room?.id,
      players: room ? room.humans + 1 : members.length,
    }
    proposals.set(p.id, p)
    for (const t of members) {
      t.status = 'in_proposal'
      t.proposal = p
    }
    log(room ? 'backfill offered' : 'proposal created', {
      proposal: p.id,
      mode: p.mode,
      map,
      room: p.room,
      uids: p.uids,
      humans: p.players,
      waited: now - members[0].createdAt,
    })
    update(p)
  }

  // The oldest searchers first, each offered a bot's seat in a running match
  // of their mode, arena and build that isn't too far along, the room with the most
  // people first. Offers still out count against a room's free seats.
  function backfill(pool: Ticket[], now: number) {
    const offered = new Map<string, number>()
    for (const p of proposals.values()) if (p.room) offered.set(p.room, (offered.get(p.room) ?? 0) + 1)
    const rooms = hooks
      .openings()
      .filter((r) => r.progress <= config.backfillMaxMatchProgress)
      .map((r) => ({ ...r, free: r.free - (offered.get(r.id) ?? 0), humans: r.humans + (offered.get(r.id) ?? 0) }))
      .sort((a, b) => b.humans - a.humans)
    for (const t of [...pool]) {
      const room = rooms.find((r) => r.free > 0 && r.mode === t.mode && r.map === t.map && r.build === t.build)
      if (!room) continue
      pool.splice(pool.indexOf(t), 1)
      propose([t], room.map, now, room)
      room.free--
      room.humans++
    }
  }

  // New matches from the rest, oldest ticket first: its group is every ticket
  // that may play with it, and how many it needs depends on how long that
  // oldest one has waited — the full room at first, then fewer. Never more
  // rooms than the server may still open.
  // ponytail: O(n²) in the tickets of one queue each tick; fine for one server's
  // few dozen searchers, bucket by queue first if that ever grows to thousands.
  function group(pool: Ticket[], now: number) {
    let rooms = hooks.capacity() - [...proposals.values()].filter((p) => !p.room).length
    while (pool.length && rooms > 0) {
      const oldest = pool[0]
      const waited = now - oldest.createdAt
      const least =
        waited >= config.startSmallAfterMs ? config.minHumansToStart : waited >= config.fullOnlyWindowMs ? config.minHumansToStart + 2 : config.targetHumans
      const members = pool.filter((t) => compatible(oldest, t)).slice(0, config.targetHumans)
      if (members.length < least) {
        pool.shift() // nothing for it yet; the next oldest may still group with others
        continue
      }
      for (const t of members) pool.splice(pool.indexOf(t), 1)
      propose(members, oldest.map, now)
      rooms--
    }
  }

  return {
    // A player starts searching. One ticket a player: asking again (a second
    // click, another tab) is the same ticket, as it stands.
    search(uid: string, mode: string, map: string, build: string) {
      let t = tickets.get(uid)
      if (!t) {
        t = { id: `t${++serial}`, uid, mode, map, build, status: 'searching', createdAt: hooks.now() }
        tickets.set(uid, t)
        log('ticket created', { ticket: t.id, uid, mode, map, build })
      }
      t.disconnectedAt = undefined // asked over a live connection
      tell(uid)
      return t
    },
    // Searching: the ticket ends. In a ready check: a decline.
    cancel(uid: string) {
      const t = tickets.get(uid)
      if (t?.proposal) return respond(uid, t.proposal.id, false)
      if (t) end(t, 'cancelled')
      else tell(uid)
    },
    respond,
    // The player's connection went. A searching ticket waits for them, out of
    // every group meanwhile; in a ready check it's a decline — the others
    // can't wait.
    disconnect(uid: string) {
      const t = tickets.get(uid)
      if (!t) return
      log('disconnected', { ticket: t.id, uid, proposal: t.proposal?.id })
      if (t.proposal) respond(uid, t.proposal.id, false)
      else t.disconnectedAt = hooks.now()
    },
    // A new connection for the player: a ticket kept for them is theirs again,
    // and they hear where it stands. False: they have none.
    reconnect(uid: string) {
      const t = tickets.get(uid)
      if (!t) return false
      t.disconnectedAt = undefined
      log('restored', { ticket: t.id, uid })
      tell(uid)
      return true
    },
    tell: (uid: string) => tell(uid),
    // Every step: tickets away too long end, ready checks at their deadline
    // resolve, then bots' seats are offered and new proposals made.
    tick() {
      const now = hooks.now()
      for (const t of [...tickets.values()]) if (t.disconnectedAt !== undefined && now - t.disconnectedAt >= config.searchDisconnectGraceMs) end(t, 'gone')
      for (const p of [...proposals.values()]) if (now >= p.expiresAt) resolve(p)
      const pool = [...tickets.values()].filter((t) => t.status === 'searching' && t.disconnectedAt === undefined).sort((a, b) => a.createdAt - b.createdAt)
      if (!pool.length) return
      if (config.backfillEnabled) backfill(pool, now)
      group(pool, now)
    },
    ticketOf: (uid: string) => tickets.get(uid),
    searching: () => [...tickets.values()].filter((t) => t.status === 'searching').length,
    proposals,
  }
}
