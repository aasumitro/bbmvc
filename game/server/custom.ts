import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Difficulty } from '../src/game/ai.ts'
import type { MatchSettings } from '../src/game/matchSettings.ts'
import type { Mode } from '../src/game/modes.ts'
import type { SeatPlan } from '../src/game/roster.ts'
import { LOBBY_FORM, tidy, type LobbyForm, type LobbyNote, type LobbyRow, type LobbySlot, type LobbyView, type Lobbying } from '../src/net/protocol.ts'

// Custom lobbies: people choose a lobby from the list or come by invite,
// ready up in its waiting room, and its owner starts matches with their own
// settings (.claude/work/custom/PLAN.md §7). Every lobby, member and rule
// lives here: who may do what, slots and sides, the owner, bans, the invite
// code, passwords, the tally. Pure, like matchmaker.ts: no sockets, no rooms,
// no timers — the lobby (lobby.ts) gives it the clock, passes on what people
// ask, ticks it every step and does what it can't (tell a person, open a
// room, seat a person in it or take one out). Plain node: custom.check.ts.

// Every number it runs on.
export const LOBBIES = {
  max: 24, // lobbies at once (MAX_LOBBIES); a waiting lobby holds no room
  grace: 20_000, // ms a dropped member keeps their slot (in a match, their seat)
  idle: 30 * 60_000, // ms a waiting lobby may go without anyone doing anything
  wrong: 5, // wrong passwords one person may try in a minute...
  lockout: 60_000, // ...then the door stays shut to them for this long
  listEvery: 500, // ms: the list goes out at most twice a second
  name: LOBBY_FORM.name, // a lobby name's length, tidied
  password: LOBBY_FORM.password,
}
export type LobbiesConfig = typeof LOBBIES

type Slot = { kind: 'empty' } | { kind: 'person'; uid: string } | { kind: 'bot'; skill: Difficulty }

interface Member {
  uid: string
  name: string
  joined: number // ms: the longest there becomes owner when the owner leaves
  ready: boolean
  slot: number
  playing: boolean // seated in the lobby's running match
  away: number // ms dropped at; -1 connected
}

export interface Lobby {
  id: string // public: the list and a join name it (8 hex digits)
  code: string // secret: the invite (8 Crockford base32 characters), sent only to members
  name: string
  owner: string // uid
  open: boolean // listed
  password: { salt: Buffer; hash: Buffer } | null
  mode: Mode
  map: string
  settings: MatchSettings
  jip: boolean // join in progress
  slots: Slot[] // settings.size of them: slot i is the match's seat i
  members: Map<string, Member>
  banned: Set<string>
  phase: 'waiting' | 'playing'
  room: string | null
  chat: string // its Nakama channel (sy- and 24 hex digits): the match's own `all` channel too
  tally: Map<string, number> // wins: by side ('0', '1'); by user id, or 'bot:' + slot for a bot (free for all)
  heard: number // ms: the last thing anyone did (idle close)
}

export type { SeatPlan } // a lobby's match, seat by seat (roster.ts): a person connected now (seated at once), a bot, or empty

export interface LobbyHooks {
  now(): number // ms
  tell(uid: string, lobby: LobbyView | null, note?: LobbyNote): void // a member's lobby; null: out of it
  show(uids: readonly string[], rows: LobbyRow[]): void // the list, to its watchers
  hosts(mode: Mode, map: string): boolean // the arena exists and hosts the mode
  channel(): string // a new chat channel's name
  start(lobby: Lobby, plan: SeatPlan): string | null // opens its room and seats the people in the plan: its id; null: no room free
  seat(lobby: Lobby, uid: string): boolean // into the running match (join in progress, back after a drop); false: no seat now
  unseat(lobby: Lobby, uid: string): void // out of the running match: the seat goes empty
  end(lobby: Lobby): void // the lobby is gone: its room, if any, closes
  left(lobby: Lobby): number // seconds left of its running match
  log?(message: string, fields: Record<string, unknown>): void
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
// 40 random bits as 8 Crockford base32 characters.
function inviteCode() {
  let bits = BigInt(`0x${randomBytes(5).toString('hex')}`)
  let code = ''
  for (let i = 0; i < 8; i++) {
    code = CROCKFORD[Number(bits & 31n)] + code
    bits >>= 5n
  }
  return code
}

// scrypt, kept cheap (N 1024: about 2 ms): it runs on the game loop's one
// thread, and the lockout bounds how often anyone can try.
const hash = (password: string, salt: Buffer) => scryptSync(password, salt, 32, { N: 1024 })

export type Lobbies = ReturnType<typeof createLobbies>

export function createLobbies(hooks: LobbyHooks, config: LobbiesConfig = LOBBIES) {
  const lobbies = new Map<string, Lobby>() // by id
  const memberOf = new Map<string, Lobby>() // by uid: one lobby a person
  const watchers = new Set<string>()
  const wrong = new Map<string, number[]>() // by uid: when each wrong password came
  const log = (message: string, fields: Record<string, unknown>) => hooks.log?.(message, fields)
  let listed = true // the list changed since it last went out
  let shownAt = -Infinity

  const people = (l: Lobby) => l.slots.filter((s) => s.kind === 'person').length
  const bots = (l: Lobby) => l.slots.filter((s) => s.kind === 'bot').length
  const side = (l: Lobby, slot: number) => (l.mode === 'tdm' ? (slot < l.settings.size / 2 ? 0 : 1) : slot)

  function row(l: Lobby): LobbyRow {
    return { id: l.id, name: l.name, host: l.members.get(l.owner)?.name ?? '', mode: l.mode, map: l.map, people: people(l), bots: bots(l), size: l.settings.size, duration: l.settings.duration, locked: !!l.password, phase: l.phase, left: l.phase === 'playing' ? Math.max(0, Math.round(hooks.left(l))) : 0, jip: l.jip }
  }

  function view(l: Lobby, m: Member): LobbyView {
    const slots = l.slots.map((s): LobbySlot => {
      if (s.kind !== 'person') return s
      const p = l.members.get(s.uid)!
      return { kind: 'person', uid: p.uid, name: p.name, ready: p.ready, away: p.away >= 0, owner: p.uid === l.owner }
    })
    return { ...row(l), code: l.code, open: l.open, settings: l.settings, slots, chat: l.chat, tally: Object.fromEntries(l.tally), you: m.slot, playing: m.playing, heir: heir(l)?.name ?? '' }
  }

  // Every member hears the lobby as it now stands; the list may have changed.
  function changed(l: Lobby) {
    for (const m of l.members.values()) if (m.away < 0) hooks.tell(m.uid, view(l, m))
    listed = true
  }

  // The first open slot: in team deathmatch, on the side with fewer filled slots (blue on a tie).
  function freeSlot(l: Lobby, prefer = -1) {
    const open = l.slots.map((s, i) => (s.kind === 'empty' ? i : -1)).filter((i) => i >= 0)
    if (!open.length) return -1
    if (l.mode !== 'tdm') return open[0]
    const filled = (team: number) => l.slots.filter((s, i) => s.kind !== 'empty' && side(l, i) === team).length
    const team = prefer >= 0 ? prefer : filled(0) <= filled(1) ? 0 : 1
    return open.find((i) => side(l, i) === team) ?? open[0]
  }

  function admit(l: Lobby, uid: string, name: string) {
    const slot = freeSlot(l)
    l.slots[slot] = { kind: 'person', uid }
    const m: Member = { uid, name, joined: hooks.now(), ready: false, slot, playing: false, away: -1 }
    l.members.set(uid, m)
    memberOf.set(uid, l)
    log('lobby joined', { lobby: l.id, uid, slot })
    if (l.phase === 'playing' && l.jip) m.playing = hooks.seat(l, uid) // straight into the running match
    changed(l)
  }

  // Who takes the lobby over if its owner leaves: whoever has been there longest.
  const heir = (l: Lobby) => [...l.members.values()].filter((m) => m.uid !== l.owner).sort((a, b) => a.joined - b.joined)[0]

  // Out of the lobby: the slot empties (and the seat, in a match); the owner
  // leaving hands it to whoever has been there longest, or ends it.
  function remove(l: Lobby, uid: string, note?: LobbyNote) {
    const m = l.members.get(uid)
    if (!m) return
    if (m.playing) hooks.unseat(l, uid)
    l.slots[m.slot] = { kind: 'empty' }
    l.members.delete(uid)
    memberOf.delete(uid)
    hooks.tell(uid, null, note)
    log('lobby left', { lobby: l.id, uid, note })
    if (l.owner === uid) {
      const next = heir(l) // the owner is out of the members already
      if (!next) return close(l, 'deleted')
      l.owner = next.uid
      next.ready = false // the owner starts; a ready flag means nothing to them
    }
    changed(l)
  }

  // The lobby is gone: everyone in it hears why.
  function close(l: Lobby, note: LobbyNote) {
    lobbies.delete(l.id)
    for (const m of l.members.values()) {
      memberOf.delete(m.uid)
      hooks.tell(m.uid, null, note)
    }
    hooks.end(l)
    listed = true
    log('lobby closed', { lobby: l.id, reason: note, lobbies: lobbies.size })
  }

  // The occupants, re-seated for new settings: each keeps its side where it
  // can (team deathmatch), in the order they sat; a bot's wins go with it.
  function regroup(l: Lobby, mode: Mode, size: number) {
    const was = l.slots.map((s, i) => ({ s, team: side(l, i), wins: l.tally.get(`bot:${i}`) })).filter(({ s }) => s.kind !== 'empty')
    const keep = mode === l.mode
    for (const key of [...l.tally.keys()]) if (key.startsWith('bot:')) l.tally.delete(key)
    l.mode = mode
    l.slots = Array.from({ length: size }, (): Slot => ({ kind: 'empty' }))
    l.settings = { ...l.settings, size }
    for (const { s, team, wins } of was) {
      const slot = freeSlot(l, keep && mode === 'tdm' ? team : -1)
      l.slots[slot] = s
      if (s.kind === 'person') l.members.get(s.uid)!.slot = slot
      else if (wins) l.tally.set(`bot:${slot}`, wins)
    }
  }

  function passwordOf(text: string) {
    if (!text) return null
    const salt = randomBytes(16)
    return { salt, hash: hash(text, salt) }
  }

  // Too many wrong passwords this minute: the door stays shut a while.
  function locked(uid: string) {
    const now = hooks.now()
    const list = (wrong.get(uid) ?? []).filter((at) => now - at < config.lockout)
    wrong.set(uid, list)
    return list.length >= config.wrong
  }

  // A form's own rules (the settings are checked already, by parseClient):
  // a name to show, an arena that hosts the mode, a password only on a
  // listed lobby. False: a page that doesn't keep to them (a strike).
  function valid(form: LobbyForm) {
    const name = tidy(form.name)
    const [least, most] = config.name
    if (name.length < least || name.length > most || !hooks.hosts(form.mode, form.map)) return false
    const password = form.password ?? ''
    return !password || (form.open && password.length >= config.password[0] && password.length <= config.password[1])
  }

  // What a person asks. False: nothing a working page would send (a strike).
  function act(uid: string, name: string, message: Lobbying): boolean {
    const now = hooks.now()
    const mine = memberOf.get(uid)
    const me = mine?.members.get(uid)
    if (mine) mine.heard = now
    // Nothing done: the asker hears where they stand (their lobby, or none), and why when there's a reason.
    const answer = (note?: LobbyNote) => {
      hooks.tell(uid, mine && me ? view(mine, me) : null, note)
      return true
    }
    switch (message.do) {
      case 'watch':
        watchers.add(uid)
        hooks.show([uid], list())
        return true
      case 'unwatch':
        watchers.delete(uid)
        return true
      case 'create': {
        if (!valid(message.form)) return false
        if (mine) return answer('taken')
        if (lobbies.size >= config.max) return answer('cap')
        const { form } = message
        let id = randomBytes(4).toString('hex')
        while (lobbies.has(id)) id = randomBytes(4).toString('hex')
        const l: Lobby = {
          id,
          code: fresh(),
          name: tidy(form.name),
          owner: uid,
          open: form.open,
          password: form.open ? passwordOf(form.password ?? '') : null,
          mode: form.mode,
          map: form.map,
          settings: form.settings,
          jip: form.jip,
          slots: Array.from({ length: form.settings.size }, (): Slot => ({ kind: 'empty' })),
          members: new Map(),
          banned: new Set(),
          phase: 'waiting',
          room: null,
          chat: hooks.channel(),
          tally: new Map(),
          heard: now,
        }
        lobbies.set(id, l)
        log('lobby created', { lobby: id, uid, mode: l.mode, map: l.map, size: l.settings.size, open: l.open, locked: !!l.password, lobbies: lobbies.size })
        admit(l, uid, name)
        return true
      }
      case 'join': {
        const l = lobbies.get(message.id)
        if (mine) return answer(mine === l ? undefined : 'taken')
        if (!l || !l.open) return answer('gone')
        if (l.banned.has(uid)) return answer('banned')
        if (l.password) {
          if (locked(uid)) return answer('slow')
          const given = hash(message.password, l.password.salt)
          if (!timingSafeEqual(given, l.password.hash)) {
            const tries = wrong.get(uid) ?? []
            tries.push(now)
            wrong.set(uid, tries)
            log('wrong password', { lobby: l.id, uid })
            return answer('password')
          }
        }
        if (freeSlot(l) < 0) return answer('full')
        admit(l, uid, name)
        return true
      }
      case 'code': {
        const l = [...lobbies.values()].find((each) => each.code === message.code)
        if (!l) return !answer('gone') // the page says so, and a wrong code is a strike: guessing is out of reach
        if (mine) return answer(mine === l ? undefined : 'taken')
        if (l.banned.has(uid)) return answer('banned')
        if (freeSlot(l) < 0) return answer('full')
        admit(l, uid, name)
        return true
      }
      case 'back': {
        const l = lobbies.get(message.id)
        const m = l?.members.get(uid)
        if (!l || !m) return answer('gone')
        m.away = -1
        if (l.phase === 'playing' && m.playing) m.playing = hooks.seat(l, uid) // their seat, held empty for them
        log('lobby back', { lobby: l.id, uid })
        changed(l)
        return true
      }
    }
    // everything else is a member's, in their own lobby
    if (!mine || !me) return false
    const l = mine
    const owner = l.owner === uid
    const waiting = l.phase === 'waiting'
    switch (message.do) {
      case 'leave':
        remove(l, uid)
        return true
      case 'ready':
        if (owner || !waiting) return false
        me.ready = message.on
        changed(l)
        return true
      case 'slot': {
        const target = l.slots[message.slot]
        if (l.mode !== 'tdm' || !waiting || !target) return false
        if (target.kind !== 'empty') return answer() // taken meanwhile: the first claim won
        l.slots[me.slot] = { kind: 'empty' }
        l.slots[message.slot] = { kind: 'person', uid }
        me.slot = message.slot
        changed(l)
        return true
      }
      case 'play':
        if (l.phase !== 'playing' || !l.jip || me.playing) return false
        me.playing = hooks.seat(l, uid)
        changed(l)
        return true
      case 'wait':
        if (!me.playing) return false
        hooks.unseat(l, uid)
        me.playing = false
        changed(l)
        return true
    }
    // the owner's
    if (!owner) return false
    switch (message.do) {
      case 'start': {
        if (!waiting) return false
        if (unstartable(l)) return answer() // the page shows why
        const plan: SeatPlan = l.slots.map((s) => (s.kind === 'bot' ? { skill: s.skill } : s.kind === 'person' && l.members.get(s.uid)!.away < 0 ? { uid: s.uid } : null))
        l.room = hooks.start(l, plan)
        if (!l.room) return answer('busy')
        l.phase = 'playing'
        for (const m of l.members.values()) m.playing = m.away < 0
        log('lobby match', { lobby: l.id, room: l.room, people: people(l), bots: bots(l), size: l.settings.size })
        changed(l)
        return true
      }
      case 'edit': {
        const { form } = message
        if (!waiting || !valid(form)) return false
        const filled = people(l) + bots(l)
        if (form.settings.size < filled) return answer() // a newcomer took a slot meanwhile
        if (form.mode !== l.mode) l.tally.clear() // a new mode, a new tally
        if (form.mode !== l.mode || form.settings.size !== l.settings.size) regroup(l, form.mode, form.settings.size)
        l.name = tidy(form.name)
        l.map = form.map
        l.settings = form.settings
        l.jip = form.jip
        l.open = form.open
        if (!form.open) l.password = null
        else if (form.password !== null) l.password = passwordOf(form.password) // null: as it was
        for (const m of l.members.values()) m.ready = false
        log('lobby edited', { lobby: l.id, mode: l.mode, map: l.map, size: l.settings.size, open: l.open, locked: !!l.password })
        changed(l)
        return true
      }
      case 'kick': {
        if (message.uid === uid || !l.members.has(message.uid)) return false
        l.banned.add(message.uid)
        remove(l, message.uid, 'kicked')
        return true
      }
      case 'owner': {
        const next = l.members.get(message.uid)
        if (!next || next.uid === uid) return false
        l.owner = next.uid
        next.ready = false
        me.ready = false
        changed(l)
        return true
      }
      case 'bot': {
        const target = l.slots[message.slot]
        if (!waiting || !target) return false
        if (target.kind !== 'empty') return answer()
        l.slots[message.slot] = { kind: 'bot', skill: message.skill }
        changed(l)
        return true
      }
      case 'unbot': {
        if (!waiting || l.slots[message.slot]?.kind !== 'bot') return false
        l.slots[message.slot] = { kind: 'empty' }
        l.tally.delete(`bot:${message.slot}`)
        changed(l)
        return true
      }
      case 'reset':
        l.code = fresh()
        log('lobby code reset', { lobby: l.id })
        changed(l)
        return true
    }
    return false
  }

  // Why the owner can't start yet ('' when they can): at least two people,
  // every other one ready and connected, and in team deathmatch someone on
  // each side. The size is the most the match takes, never a number to wait for.
  function unstartable(l: Lobby) {
    const others = [...l.members.values()].filter((m) => m.uid !== l.owner)
    if (l.members.size < 2) return 'alone'
    if (others.some((m) => !m.ready || m.away >= 0)) return 'waiting'
    if (l.mode === 'tdm' && [0, 1].some((team) => !l.slots.some((s, i) => s.kind !== 'empty' && side(l, i) === team))) return 'sides'
    return ''
  }

  function fresh() {
    let code = inviteCode()
    while ([...lobbies.values()].some((l) => l.code === code)) code = inviteCode()
    return code
  }

  const list = () => [...lobbies.values()].filter((l) => l.open).map(row)

  return {
    act,
    // The member's socket closed: their slot (and seat) is kept for the grace.
    drop(uid: string) {
      watchers.delete(uid)
      const l = memberOf.get(uid)
      const m = l?.members.get(uid)
      if (!l || !m) return
      m.away = hooks.now()
      log('lobby dropped', { lobby: l.id, uid })
      changed(l)
    },
    // The lobby's match is over, results and all: everyone is back in the
    // waiting room, unready, the tally counting the result. `winner`: the
    // winning team (free for all: seat), null a draw, undefined abandoned.
    over(id: string, winner: number | null | undefined) {
      const l = lobbies.get(id)
      if (!l) return
      if (winner !== null && winner !== undefined) {
        const s = l.slots[winner]
        const key = l.mode === 'tdm' ? String(winner) : s?.kind === 'person' ? s.uid : s?.kind === 'bot' ? `bot:${winner}` : ''
        if (key) l.tally.set(key, (l.tally.get(key) ?? 0) + 1)
      }
      l.phase = 'waiting'
      l.room = null
      l.heard = hooks.now()
      for (const m of l.members.values()) {
        m.ready = false
        m.playing = false
      }
      log('lobby match over', { lobby: l.id, winner: winner ?? null, abandoned: winner === undefined })
      changed(l)
    },
    // Every step: members away past the grace have left, idle lobbies close,
    // and the list goes out when it changed (at most twice a second).
    tick() {
      const now = hooks.now()
      for (const l of [...lobbies.values()]) {
        for (const m of [...l.members.values()]) {
          if (m.away >= 0 && now - m.away >= config.grace && lobbies.has(l.id)) remove(l, m.uid)
        }
        if (lobbies.has(l.id) && l.phase === 'waiting' && now - l.heard >= config.idle) close(l, 'closed')
      }
      if (listed && watchers.size && now - shownAt >= config.listEvery) {
        listed = false
        shownAt = now
        hooks.show([...watchers], list())
      }
    },
    lobbies,
    memberOf: (uid: string) => memberOf.get(uid),
    watching: (uid: string) => watchers.has(uid),
  }
}
