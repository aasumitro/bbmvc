// Self-check for custom lobbies (custom.ts) in a world the check runs by
// hand: its clock, rooms that open or don't, who is seated. Every action a
// member or an owner has, and each refusal; starting from 2 of 12; team
// sides; the owner leaving; the grace and coming back; idle lobbies; caps;
// invite codes, passwords and bans; the tally; what the list shows (never a
// code, a password or anyone's user id). Plain node: node server/custom.check.ts
import { classic, type MatchSettings } from '../src/game/matchSettings.ts'
import { tidy, type LobbyForm, type LobbyNote, type LobbyRow, type LobbyView, type Lobbying } from '../src/net/protocol.ts'
import { createLobbies, LOBBIES, type LobbiesConfig, type SeatPlan } from './custom.ts'

let checks = 0
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`custom: ${what}`)
  checks++
}

type Said = { lobby: LobbyView | null; note?: LobbyNote }

function world(config: Partial<LobbiesConfig> = {}) {
  const w = { now: 0, rooms: 12, seated: new Map<string, string>(), plans: [] as SeatPlan[], ended: [] as string[] }
  const told = new Map<string, Said[]>()
  const shown = new Map<string, LobbyRow[][]>()
  const lobbies = createLobbies(
    {
      now: () => w.now,
      tell: (uid, lobby, note) => void told.set(uid, [...(told.get(uid) ?? []), { lobby, note }]),
      show: (uids, rows) => uids.forEach((uid) => shown.set(uid, [...(shown.get(uid) ?? []), rows])),
      hosts: (_, map) => map === 'city' || map === 'scrapyard',
      channel: () => `sy-${'a'.repeat(24)}`,
      start(l, plan) {
        if (!w.rooms) return null
        w.rooms--
        w.plans.push(plan)
        for (const seat of plan) if (seat && 'uid' in seat) w.seated.set(seat.uid, l.id)
        return `room${w.plans.length}`
      },
      seat: (l, uid) => (w.seated.set(uid, l.id), true),
      unseat: (_, uid) => void w.seated.delete(uid),
      end: (l) => void w.ended.push(l.id),
      left: () => 42,
    },
    { ...LOBBIES, ...config },
  )
  const last = (uid: string) => told.get(uid)?.at(-1)
  const lobbyOf = (uid: string) => last(uid)?.lobby ?? null
  const act = (uid: string, message: Lobbying['do'] extends never ? never : Lobbying) => lobbies.act(uid, uid.toUpperCase(), message)
  return {
    w,
    lobbies,
    told,
    shown,
    last,
    lobbyOf,
    act,
    at(ms: number) {
      w.now = ms
      lobbies.tick()
    },
  }
}

const settings = (mode: 'tdm' | 'ffa', over: Partial<MatchSettings> = {}): MatchSettings => ({ ...classic(mode), size: 12, ...over })
const form = (over: Partial<LobbyForm> = {}): LobbyForm => ({ name: 'Test lobby', open: true, password: '', mode: 'tdm', map: 'city', settings: settings('tdm'), jip: false, ...over })
const create = (over: Partial<LobbyForm> = {}): Lobbying => ({ t: 'lb', do: 'create', form: form(over) })
const edit = (over: Partial<LobbyForm> = {}): Lobbying => ({ t: 'lb', do: 'edit', form: { ...form(over), password: over.password === undefined ? null : over.password } })
const lb = <T extends Lobbying['do']>(action: T, fields: Record<string, unknown> = {}) => ({ t: 'lb', do: action, ...fields }) as Lobbying

// --- making one, the list, what nobody else sees ----------------------------------------------------
{
  const x = world()
  check(tidy('  My\u0007   lobby \n') === 'My lobby', 'names: trimmed, inner spaces collapsed, control characters gone')
  x.act('watcher', lb('watch'))
  check(x.shown.get('watcher')?.at(-1)?.length === 0, 'watching: the list at once, empty')
  check(x.act('a', create()) && x.lobbies.lobbies.size === 1, 'a lobby made')
  const view = x.lobbyOf('a')!
  check(view.you === 0 && view.slots[0].kind === 'person' && view.slots[0].owner && view.slots.length === 12 && view.slots.slice(1).every((s) => s.kind === 'empty'), 'the maker owns it, in slot 0; the other eleven open')
  check(/^[0-9A-HJKMNP-TV-Z]{8}$/.test(view.code) && view.chat.startsWith('sy-') && view.people === 1 && view.bots === 0, 'an invite code from the start (Crockford base32), a chat channel')
  x.at(LOBBIES.listEvery)
  const row = x.shown.get('watcher')!.at(-1)![0]
  const text = JSON.stringify(row)
  check(row.id === view.id && row.host === 'A' && row.people === 1 && row.size === 12 && !row.locked && row.phase === 'waiting', 'the list shows it: who hosts, people of the size, open')
  check(!text.includes(view.code) && !text.includes('"uid"') && !('code' in row) && !('password' in row), 'the list never carries the code, a password or a user id')
  check(x.act('b', create({ open: false, name: 'Hidden' })) && !x.lobbies.lobbies.get(x.lobbyOf('b')!.id)!.password, 'a private lobby: no password, even if the form had one')
  x.at(2 * LOBBIES.listEvery)
  check(x.shown.get('watcher')!.at(-1)!.length === 1, 'a private lobby is never listed')
  check(!x.act('c', create({ name: ' a ' })) && !x.act('c', create({ map: 'moon' })) && !x.act('c', create({ open: false, password: 'secret' })) && !x.act('c', create({ password: 'abc' })), 'a name too short, an arena that isn’t one, a password on a private lobby or too short: a page that doesn’t keep the rules (a strike)')
  check(x.act('a', create()) && x.last('a')?.note === 'taken' && x.lobbies.lobbies.size === 2, 'one lobby a person: a second is refused, taken')
}

// --- joining: from the list, by code, passwords, bans, full ------------------------------------------
{
  const x = world()
  x.act('owner', create({ password: 'hunter22', settings: settings('tdm', { size: 4 }) }))
  const { id, code } = x.lobbyOf('owner')!
  x.act('p1', lb('join', { id, password: 'wrong' }))
  check(x.last('p1')?.note === 'password' && !x.lobbies.memberOf('p1'), 'a wrong password: told so, not in')
  for (let i = 0; i < LOBBIES.wrong - 1; i++) x.act('p1', lb('join', { id, password: 'wrong' }))
  x.act('p1', lb('join', { id, password: 'hunter22' }))
  check(x.last('p1')?.note === 'slow' && !x.lobbies.memberOf('p1'), 'five wrong in a minute: the door shuts, even to the right one')
  x.at(LOBBIES.lockout)
  x.act('p1', lb('join', { id, password: 'hunter22' }))
  check(x.lobbies.memberOf('p1')?.id === id && x.lobbyOf('p1')?.you === 2, 'a minute on, the right password lets them in: the first open slot on the side with fewer (red)')
  check(x.act('p2', lb('code', { code })) && x.lobbies.memberOf('p2')?.id === id, 'the invite code skips the password')
  check(!x.act('p3', lb('code', { code: 'ZZZZZZZZ' })) && x.last('p3')?.note === 'gone', 'a wrong code is a strike, and the page hears there is no such lobby')
  check(x.lobbyOf('p2')?.you === 1, 'the next by code: blue, level on people (slot 1)')
  x.act('owner', lb('bot', { slot: 3, skill: 'hard' }))
  x.act('p4', lb('code', { code }))
  check(x.last('p4')?.note === 'full', 'every slot taken (a bot takes one): full')
  x.act('owner', lb('reset'))
  const fresh = x.lobbyOf('owner')!.code
  check(fresh !== code && !x.act('p5', lb('code', { code })) && x.lobbyOf('p1')!.code === fresh, 'the owner resets the code: the old one is dead, every member has the new one')
  x.act('owner', lb('kick', { uid: 'p2' }))
  check(x.last('p2')?.lobby === null && x.last('p2')?.note === 'kicked' && !x.lobbies.memberOf('p2'), 'kicked: out, and told')
  x.act('p2', lb('code', { code: fresh }))
  check(x.last('p2')?.note === 'banned', 'a kicked person is banned from the lobby, invite link included')
  x.act('p6', lb('join', { id: 'nope', password: '' }))
  check(x.last('p6')?.note === 'gone', 'a lobby that isn’t there: gone')
  x.act('hider', create({ open: false }))
  x.act('p6', lb('join', { id: x.lobbyOf('hider')!.id, password: '' }))
  check(x.last('p6')?.note === 'gone', 'a private lobby isn’t joined from the list')
}

// --- ready, sides, start --------------------------------------------------------------------------------
{
  const x = world()
  x.act('o', create()) // team deathmatch, twelve
  const { code } = x.lobbyOf('o')!
  x.act('o', lb('start'))
  check(!x.w.plans.length, 'alone: no start')
  x.act('m', lb('code', { code }))
  check(x.lobbyOf('m')?.you === 6, 'a newcomer lands on the side with fewer (red, slot 6)')
  check(!x.act('o', lb('ready', { on: true })), 'the owner has no ready to press')
  x.act('o', lb('start'))
  check(!x.w.plans.length, 'someone not ready: no start')
  x.act('m', lb('ready', { on: true }))
  x.act('m', lb('slot', { slot: 3 }))
  const moved = x.lobbyOf('m')!
  check(moved.you === 3 && moved.slots[3].kind === 'person' && moved.slots[3].ready && moved.slots[6].kind === 'empty', 'a member takes an open slot on the other side: moved, still ready')
  x.act('o', lb('start'))
  check(!x.w.plans.length, 'both on blue and nobody red: no start')
  x.act('o', lb('bot', { slot: 7, skill: 'easy' }))
  x.act('m', lb('ready', { on: true })) // (an edit or a bot unreadies nobody; this is a no-op)
  x.act('o', lb('start'))
  const plan = x.w.plans[0]
  check(!!plan && plan.length === 12 && 'uid' in plan[0]! && 'uid' in plan[3]! && 'skill' in plan[7]! && plan[7].skill === 'easy' && plan.filter((s) => s === null).length === 9, 'two people and a bot on red: it starts, twelve seats with nine empty (never waiting for a full lobby)')
  const playing = x.lobbyOf('m')!
  check(playing.phase === 'playing' && playing.playing && x.w.seated.get('m') === playing.id, 'the lobby plays; its people are seated')
  check(!x.act('m', lb('ready', { on: false })) && !x.act('o', lb('bot', { slot: 8, skill: 'hard' })) && !x.act('o', lb('edit')), 'while it plays: no ready, bots or edits')
  x.lobbies.over(playing.id, 1)
  const back = x.lobbyOf('m')!
  check(back.phase === 'waiting' && !back.playing && back.slots.every((s) => s.kind !== 'person' || !s.ready) && back.tally['1'] === 1, 'the match over: everyone back in the waiting room, unready; red’s win counted')
  // two claims on one slot: the first wins
  x.act('n', lb('code', { code }))
  const aim = x.lobbyOf('n')!.slots.findIndex((s, i) => s.kind === 'empty' && i < 6)
  x.act('m', lb('slot', { slot: aim }))
  x.act('n', lb('slot', { slot: aim }))
  check(x.lobbyOf('m')?.you === aim && x.lobbyOf('n')?.you !== aim, 'two claims on one slot: the first wins, the second stays put')
  check(x.act('m', lb('slot', { slot: 11 })) && x.lobbyOf('m')?.you === 11, 'an open slot on the other side: moved there, so on that side')
  const ffa = world()
  ffa.act('f', create({ mode: 'ffa', settings: settings('ffa') }))
  check(!ffa.act('f', lb('slot', { slot: 4 })), 'free for all: slots are only a list, nothing to claim')
  const busy = world()
  busy.w.rooms = 0
  busy.act('o', create({ mode: 'ffa', settings: settings('ffa') }))
  busy.act('m', lb('code', { code: busy.lobbyOf('o')!.code }))
  busy.act('m', lb('ready', { on: true }))
  busy.act('o', lb('start'))
  check(busy.last('o')?.note === 'busy' && busy.lobbyOf('o')?.phase === 'waiting', 'no room free: the owner hears busy, the lobby waits')
}

// --- join in progress, back to the waiting room, kicks in a match -----------------------------------------
{
  const x = world()
  x.act('o', create({ mode: 'ffa', settings: settings('ffa', { size: 4 }), jip: true }))
  const { id, code } = x.lobbyOf('o')!
  x.act('m', lb('code', { code }))
  x.act('m', lb('ready', { on: true }))
  x.act('o', lb('start'))
  x.act('late', lb('code', { code }))
  check(x.lobbyOf('late')?.playing === true && x.w.seated.get('late') === id, 'join in progress on: a newcomer goes straight into the running match')
  x.act('late', lb('wait'))
  check(!x.w.seated.has('late') && x.lobbyOf('late')?.playing === false && x.lobbies.memberOf('late')?.id === id, 'back to the waiting room: out of the match, still in the lobby')
  x.act('late', lb('play'))
  check(x.w.seated.has('late') && x.lobbyOf('late')?.playing === true, 'join the match again')
  x.act('o', lb('kick', { uid: 'late' }))
  check(!x.w.seated.has('late') && x.last('late')?.note === 'kicked', 'kicked in a match: out of the match too')
  const off = world()
  off.act('o', create({ mode: 'ffa', settings: settings('ffa', { size: 4 }) }))
  off.act('m', lb('code', { code: off.lobbyOf('o')!.code }))
  off.act('m', lb('ready', { on: true }))
  off.act('o', lb('start'))
  off.act('late', lb('code', { code: off.lobbyOf('o')!.code }))
  check(off.lobbyOf('late')?.playing === false && !off.w.seated.has('late') && !off.act('late', lb('play')), 'join in progress off: they wait for the next match')
}

// --- the owner: hand over, leave, delete ---------------------------------------------------------------------
{
  const x = world()
  x.act('o', create())
  const { code } = x.lobbyOf('o')!
  x.at(1000)
  x.act('first', lb('code', { code }))
  x.at(2000)
  x.act('second', lb('code', { code }))
  x.act('o', lb('owner', { uid: 'second' }))
  check(x.lobbyOf('o')?.slots.find((s) => s.kind === 'person' && s.owner)?.kind === 'person' && x.lobbies.memberOf('o')?.owner === 'second', 'the owner hands the lobby over')
  check(!x.act('o', lb('reset')) && !x.act('o', lb('kick', { uid: 'first' })), 'no longer the owner: no owner’s actions')
  check(x.lobbyOf('second')?.heir === 'O' && x.lobbyOf('first')?.heir === 'O', 'every member sees who would take over: the longest there')
  x.act('second', lb('leave'))
  check(x.lobbies.memberOf('o')?.owner === 'o' && x.last('second')?.lobby === null, 'the owner leaves: whoever has been there longest owns it')
  check(x.lobbyOf('o')?.heir === 'FIRST', 'and the next in line is named')
  x.act('first', lb('leave'))
  x.act('o', lb('leave'))
  check(x.lobbies.lobbies.size === 0 && x.w.ended.length === 1, 'the owner leaves nobody behind: the lobby is gone')
}

// --- bots, edits -----------------------------------------------------------------------------------------------
{
  const x = world()
  x.act('o', create({ settings: settings('tdm', { size: 8 }) }))
  const { code, id } = x.lobbyOf('o')!
  x.act('m', lb('code', { code })) // red, slot 4
  x.act('m', lb('ready', { on: true }))
  x.act('o', lb('bot', { slot: 1, skill: 'normal' }))
  x.act('o', lb('bot', { slot: 1, skill: 'hard' }))
  check(x.lobbyOf('o')?.slots[1].kind === 'bot' && (x.lobbyOf('o')!.slots[1] as { skill: string }).skill === 'normal', 'a bot into an open slot at its difficulty; a taken slot stays as it was')
  check(!x.act('m', lb('bot', { slot: 2, skill: 'easy' })), 'bots are the owner’s')
  x.act('o', edit({ settings: settings('tdm', { size: 2 }) }))
  check(x.lobbies.lobbies.get(id)!.settings.size === 8, 'never smaller than the filled slots')
  x.act('o', edit({ settings: settings('tdm', { size: 12, duration: 900 }), name: 'Renamed' }))
  const grown = x.lobbyOf('m')!
  check(grown.size === 12 && grown.duration === 900 && grown.name === 'Renamed' && grown.you >= 6 && grown.slots.every((s) => s.kind !== 'person' || !s.ready), 'an edit: the new settings, each keeping their side (red stays red), everyone unready')
  x.lobbies.over(id, 0)
  check(x.lobbyOf('o')?.tally['0'] === 1, 'a tally of wins by side')
  x.act('o', edit({ mode: 'ffa', settings: settings('ffa') }))
  const ffa = x.lobbyOf('o')!
  check(ffa.mode === 'ffa' && Object.keys(ffa.tally).length === 0 && ffa.slots.filter((s) => s.kind !== 'empty').length === 3, 'another mode: the tally starts over, everyone still in')
  x.act('o', edit({ mode: 'ffa', settings: settings('ffa'), open: true, password: 'longenough' }))
  x.act('o', edit({ mode: 'ffa', settings: settings('ffa'), open: true }))
  check(!!x.lobbies.lobbies.get(id)!.password, 'an edit that says nothing of the password keeps it')
  x.act('o', edit({ mode: 'ffa', settings: settings('ffa'), open: false }))
  check(!x.lobbies.lobbies.get(id)!.password, 'made private: the password goes')
  // free for all's tally: by person, or by a bot's slot, dropped with the bot
  const botSlot = ffa.slots.findIndex((s) => s.kind === 'bot')
  x.lobbies.over(id, x.lobbyOf('m')!.you)
  x.lobbies.over(id, botSlot)
  x.lobbies.over(id, null)
  x.lobbies.over(id, undefined)
  const tally = x.lobbyOf('o')!.tally
  check(tally.m === 1 && tally[`bot:${botSlot}`] === 1 && Object.keys(tally).length === 2, 'free for all: a win for a person by their user id, a bot by its slot; draws and abandoned matches count nothing')
  x.act('o', lb('bot', { slot: 11, skill: 'easy' }))
  x.lobbies.over(id, 11)
  x.act('o', edit({ mode: 'ffa', settings: settings('ffa', { size: 4 }), open: false }))
  const shrunk = x.lobbyOf('o')!
  const moved = shrunk.slots.findIndex((s, i) => s.kind === 'bot' && i !== shrunk.slots.findIndex((t) => t.kind === 'bot'))
  check(shrunk.size === 4 && moved > 0 && shrunk.tally[`bot:${moved}`] === 1 && !('bot:11' in shrunk.tally), 'a smaller lobby: a bot moved to another slot keeps its wins')
  x.act('o', lb('unbot', { slot: moved }))
  check(!(`bot:${moved}` in x.lobbyOf('o')!.tally), 'the bot removed: its wins with it')
}

// --- drops, the grace, coming back; idle lobbies; caps -----------------------------------------------------------
{
  const x = world()
  x.act('o', create({ mode: 'ffa', settings: settings('ffa', { size: 4 }) }))
  const { code, id } = x.lobbyOf('o')!
  x.act('m', lb('code', { code }))
  x.act('m', lb('ready', { on: true }))
  x.lobbies.drop('m')
  const away = x.lobbyOf('o')!
  check((away.slots[1] as { away: boolean }).away && x.lobbies.memberOf('m')?.id === id, 'dropped: still in their slot, shown away')
  x.act('o', lb('start'))
  check(!x.w.plans.length, 'someone away: no start')
  x.at(LOBBIES.grace - 1)
  x.act('m', lb('back', { id }))
  check(!(x.lobbyOf('o')!.slots[1] as { away: boolean }).away, 'back within the grace: their slot, as they left it')
  x.act('o', lb('start'))
  check(x.w.seated.get('m') === id, 'then it starts')
  x.w.seated.delete('m') // their socket closed: the room let the seat go
  x.lobbies.drop('m')
  x.act('m', lb('back', { id }))
  check(x.w.seated.get('m') === id && x.lobbyOf('m')?.playing === true, 'dropped in a match and back in time: their seat again')
  x.lobbies.drop('m')
  x.at(x.w.now + LOBBIES.grace + 1)
  check(!x.lobbies.memberOf('m') && x.lobbyOf('o')!.slots[1].kind === 'empty', 'away past the grace: they have left, their slot open')
  x.lobbies.over(id, undefined)
  x.at(x.w.now + LOBBIES.idle - 1)
  check(x.lobbies.lobbies.has(id), 'a waiting lobby with nothing happening is kept a while...')
  x.at(x.w.now + 2)
  check(!x.lobbies.lobbies.has(id) && x.last('o')?.note === 'closed', '...then closed, its members told why')
  const capped = world({ max: 2 })
  capped.act('a', create())
  capped.act('b', create())
  capped.act('c', create())
  check(capped.lobbies.lobbies.size === 2 && capped.last('c')?.note === 'cap', 'lobbies are capped (MAX_LOBBIES)')
}

// --- the list goes out at most twice a second ------------------------------------------------------------------
{
  const x = world()
  x.act('w', lb('watch'))
  x.act('a', create())
  x.at(LOBBIES.listEvery)
  const sent = x.shown.get('w')!.length
  x.act('b', create())
  x.at(LOBBIES.listEvery + 100)
  check(x.shown.get('w')!.length === sent, 'a change within half a second waits')
  x.at(2 * LOBBIES.listEvery)
  check(x.shown.get('w')!.length === sent + 1 && x.shown.get('w')!.at(-1)!.length === 2, 'then goes out whole')
  x.act('w', lb('unwatch'))
  x.act('c', create())
  x.at(4 * LOBBIES.listEvery)
  check(x.shown.get('w')!.length === sent + 1, 'no longer watching: nothing more')
}

console.log(`custom ok (${checks} checks)`)
