// Tests for Classic's matchmaking (matchmaker.ts) on a clock moved by
// hand: the queue, groups and their sizes as time passes, the ready check and
// every way it ends, backfill, and one ticket a player.
import { describe, expect, it } from 'vitest'
import type { Queue } from '../src/net/protocol.ts'
import { createMatchmaker, MATCHMAKING, type MatchmakingConfig, type Opening, type Proposal } from './matchmaker.ts'

// Every check is a test of its own, in order, under its label (the it.each
// at the end); a failed one fails its test, and the rest still run.
const checks: Array<[string, boolean]> = []
const check = (ok: boolean, what: string) => void checks.push([what, ok])

const { readyCheckMs, fullOnlyWindowMs, startSmallAfterMs, searchDisconnectGraceMs: grace } = MATCHMAKING

// A matcher in a world the check runs: its clock, the rooms it reports as
// open, how many more may open, whether a start finds seats; what each
// player is told, and every start.
function world({ openings = [] as Opening[], capacity = 12, config = {} as Partial<MatchmakingConfig> } = {}) {
  const w = { now: 0, openings, capacity, seats: true }
  const told = new Map<string, Queue[]>()
  const starts: Array<{ proposal: Proposal; uids: string[] }> = []
  const mm = createMatchmaker(
    {
      now: () => w.now,
      openings: () => w.openings,
      capacity: () => w.capacity,
      start(proposal, uids) {
        if (!w.seats) return false
        starts.push({ proposal, uids })
        return true
      },
      tell: (uid, state) => void told.set(uid, [...(told.get(uid) ?? []), state]),
    },
    { ...MATCHMAKING, ...config },
  )
  const last = (uid: string) => told.get(uid)?.at(-1)
  const found = (uid: string) => {
    const q = last(uid)
    return q && (q.state === 'found' || q.state === 'accepted') ? q : undefined
  }
  return {
    w,
    mm,
    told,
    starts,
    last,
    found,
    // why it ended or went back, in the last word they had
    note(uid: string) {
      const q = last(uid)
      return q && 'note' in q ? q.note : undefined
    },
    at(ms: number) {
      w.now = ms
      mm.tick()
    },
    search: (uids: string[], mode = 'ffa', build = 'b1', map = 'city') => uids.forEach((uid) => mm.search(uid, mode, map, build)),
    open: () => [...mm.proposals.values()],
  }
}
const people = (n: number, prefix = 'p') => Array.from({ length: n }, (_, i) => `${prefix}${i}`)
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

// --- the queue --------------------------------------------------------------------------------------

{
  const s = world()
  const t = s.mm.search('a', 'ffa', 'city', 'b1')
  check(t.status === 'searching' && s.last('a')?.state === 'searching', 'a search makes a ticket, and the player hears they are searching')
  s.w.now = 4000
  const again = s.mm.search('a', 'tdm', 'scrapyard', 'b1')
  const q = s.last('a')
  check(
    again === t && again.mode === 'ffa' && again.map === 'city' && again.createdAt === 0 && q?.state === 'searching' && q.map === 'city' && q.waited === 4000,
    'a second start is the same ticket, as it stands: its mode, its arena, its age',
  )
  s.mm.cancel('a')
  check(!s.mm.ticketOf('a') && s.last('a')?.state === 'idle' && s.note('a') === 'cancelled', 'cancel ends the ticket, and says so')
  s.mm.cancel('a')
  check(s.last('a')?.state === 'idle' && !s.note('a'), 'cancelling again changes nothing')

  s.mm.search('b', 'ffa', 'city', 'b1')
  s.w.now = 5000
  s.mm.disconnect('b')
  s.at(5000 + grace - 1)
  check(s.mm.ticketOf('b')?.status === 'searching', 'a searcher who drops keeps the ticket through the grace')
  s.at(5000 + grace)
  check(!s.mm.ticketOf('b') && s.note('b') === 'gone', 'and loses it when the grace runs out')

  s.w.now = 20_000
  const c = s.mm.search('c', 'ffa', 'city', 'b1')
  s.mm.search('d', 'ffa', 'city', 'b1')
  const dropped = 20_000 + startSmallAfterMs - 5000
  s.w.now = dropped
  s.mm.disconnect('c')
  s.at(20_000 + startSmallAfterMs)
  check(!s.open().length, 'a ticket without its connection is in no group (two searchers at 30 s, one of them away: no proposal)')
  s.w.now = dropped + grace - 1
  check(
    s.mm.reconnect('c') && s.mm.ticketOf('c') === c && c.disconnectedAt === undefined && s.last('c')?.state === 'searching',
    'back within the grace: the same ticket, searching, and the player hears it',
  )
  s.at(dropped + grace)
  check(s.open().length === 1 && sameSet(s.open()[0].uids, ['c', 'd']), 'and it groups again')
  check(!s.mm.reconnect('nobody'), 'a new connection with no ticket kept finds none')
}

// --- groups ------------------------------------------------------------------------------------------

{
  const s = world()
  s.search(people(8))
  s.at(0)
  const [p] = s.open()
  check(
    s.open().length === 1 && p.uids.length === 8 && people(8).every((uid) => s.mm.ticketOf(uid)?.status === 'in_proposal'),
    'eight searchers: one full proposal at once',
  )
  const q = s.found('p3')
  check(
    !!q && q.state === 'found' && q.size === 8 && q.players === 8 && q.left === readyCheckMs && q.of === readyCheckMs && q.id === p.id && q.map === p.map,
    'everyone in it hears: match found, eight players, the whole ready check to answer',
  )
  check(p.map === 'city', `played on the arena they searched for (${p.map})`)
}
{
  const s = world()
  s.search(people(7))
  s.at(fullOnlyWindowMs - 1)
  check(!s.open().length, 'seven searchers: nothing inside the full-only window')
  s.at(fullOnlyWindowMs)
  check(s.open().length === 1 && s.open()[0].uids.length === 7, 'seven at 10 s: a proposal of seven')
}
{
  const s = world()
  s.search(people(3))
  s.at(fullOnlyWindowMs)
  check(!s.open().length, 'three at 10 s: not yet (the middle window wants at least four)')
  s.search(['late'])
  s.at(fullOnlyWindowMs + 1)
  check(
    s.open().length === 1 && s.open()[0].uids.length === 4 && s.open()[0].uids.at(-1) === 'late',
    'a fourth arrives: four go, oldest first, however new the fourth is',
  )
}
{
  const s = world()
  s.search(people(2))
  s.at(startSmallAfterMs - 1)
  check(!s.open().length, 'two searchers: no proposal before 30 s')
  s.at(startSmallAfterMs)
  check(s.open().length === 1 && s.open()[0].uids.length === 2, 'two at 30 s: a proposal of two (bots fill the rest)')
}
{
  const s = world()
  s.search(['alone'])
  for (const t of [0, fullOnlyWindowMs, startSmallAfterMs, 10 * 60_000]) s.at(t)
  check(!s.open().length && s.mm.ticketOf('alone')?.status === 'searching', 'one searcher: never a proposal, still searching after ten minutes')
}
{
  const s = world()
  s.search(people(4, 'x'), 'ffa', 'b1')
  s.search(people(4, 'y'), 'ffa', 'b2')
  s.search(people(4, 'z'), 'tdm', 'b1')
  s.search(people(4, 'w'), 'ffa', 'b1', 'scrapyard')
  s.at(fullOnlyWindowMs)
  const groups = s.open().map((p) => p.uids.map((uid) => uid[0]).join(''))
  check(groups.length === 4 && groups.every((g) => new Set(g).size === 1), `builds, modes and arenas never mix (${groups.join(' ')})`)
  check(
    s.open().find((p) => p.uids[0] === 'w0')?.map === 'scrapyard' && s.open().find((p) => p.uids[0] === 'x0')?.map === 'city',
    'each group plays on the arena it searched for',
  )
}
{
  const s = world()
  s.search(people(16))
  s.at(0)
  s.at(1)
  const uids = s.open().flatMap((p) => p.uids)
  check(
    s.open().length === 2 && uids.length === 16 && new Set(uids).size === 16,
    'sixteen searchers: two full proposals, nobody in both, none more on the next tick',
  )
  check(
    s.open().every((p) => p.map === 'city'),
    'both on the arena they searched for: no rotation',
  )
  s.at(fullOnlyWindowMs * 3)
  check(s.open().length === 0, 'unanswered, both lapse')
}
{
  const s = world()
  s.search(people(12))
  s.at(0)
  check(s.open().length === 1 && s.open()[0].uids.length === 8 && s.open()[0].uids.every((uid) => people(8).includes(uid)), 'twelve: the eight oldest go first')
  const first = s.open()[0]
  for (const uid of first.uids) s.mm.respond(uid, first.id, true)
  s.at(fullOnlyWindowMs - 1)
  check(s.starts.length === 1 && !s.open().length, 'the eight start; the other four wait')
  s.at(fullOnlyWindowMs)
  check(s.open().length === 1 && s.open()[0].uids.length === 4, 'and go when their oldest has waited 10 s')
}
{
  const s = world({ capacity: 1 })
  s.search(people(16))
  s.at(0)
  check(s.open().length === 1, 'never more proposals than rooms the server may still open')
  s.w.capacity = 0
  s.at(startSmallAfterMs * 2)
  check(s.open().length === 0 && s.mm.searching() === 8, 'with no room to open, the first lapses and nobody is asked again; eight still search')
}

// --- the ready check ------------------------------------------------------------------------------------

// A proposal of `n` at 0 ms or at the window where `n` people may form one.
function proposal(n: number, config: Partial<MatchmakingConfig> = {}) {
  const s = world({ config })
  const uids = people(n)
  s.search(uids)
  s.at(n === 8 ? 0 : n >= 4 ? fullOnlyWindowMs : startSmallAfterMs)
  const [p] = s.open()
  if (!p) throw new Error(`matchmaker: no proposal of ${n}`)
  return { ...s, p, uids, t0: s.w.now }
}

{
  const s = proposal(8)
  s.mm.respond('p0', s.p.id, true)
  const q = s.found('p5')
  check(s.found('p0')?.state === 'accepted' && q?.state === 'found' && q.accepted === 1, 'an accept: the player hears it counted, everyone hears one ready')
  s.mm.respond('p0', s.p.id, true)
  check(s.p.accepted.size === 1 && s.found('p0')?.accepted === 1, 'a second accept counts once')
  for (const uid of s.uids.slice(1)) s.mm.respond(uid, s.p.id, true)
  check(
    s.starts.length === 1 && s.starts[0].proposal === s.p && sameSet(s.starts[0].uids, s.uids) && s.p.state === 'started',
    'all eight accept: it starts at once, once, with all of them',
  )
  check(s.uids.every((uid) => !s.mm.ticketOf(uid)) && !s.open().length, 'their tickets are done')
  s.at(s.t0 + readyCheckMs * 2)
  check(s.starts.length === 1, 'and nothing starts twice')
}
{
  const s = proposal(8)
  for (const uid of s.uids.slice(0, 7)) s.mm.respond(uid, s.p.id, true)
  check(!s.starts.length, 'seven of eight accepted: still waiting for the eighth')
  s.mm.respond('p7', s.p.id, false)
  check(
    s.starts.length === 1 && s.starts[0].uids.length === 7 && !s.starts[0].uids.includes('p7'),
    'the eighth declines: the seven start at once without them (a bot takes the seat)',
  )
  check(s.last('p7')?.state === 'idle' && s.note('p7') === 'declined' && !s.mm.ticketOf('p7'), 'the decliner’s ticket is over, and they hear why')
}
{
  const s = proposal(5)
  for (const uid of ['p0', 'p2', 'p4']) s.mm.respond(uid, s.p.id, true)
  s.at(s.t0 + readyCheckMs - 1)
  check(!s.starts.length, 'three of five accepted: nothing before the deadline')
  s.at(s.t0 + readyCheckMs)
  check(s.starts.length === 1 && sameSet(s.starts[0].uids, ['p0', 'p2', 'p4']), 'at the deadline the three start, bots for the rest')
  check(
    ['p1', 'p3'].every((uid) => !s.mm.ticketOf(uid) && s.note(uid) === 'missed'),
    'those who didn’t answer are out, and hear why',
  )
}
{
  const s = proposal(2)
  s.mm.respond('p1', s.p.id, true)
  s.w.now = s.t0 + 3000
  s.mm.search(['fresh'][0], 'ffa', 'city', 'b1')
  s.at(s.t0 + readyCheckMs)
  const back = s.told.get('p1')!.find((q) => q.state === 'searching' && q.note === 'short')
  check(!s.starts.length && s.p.state === 'cancelled', 'one of two accepted: too few, it is off')
  check(
    back?.state === 'searching' && back.waited === s.t0 + readyCheckMs && s.mm.ticketOf('p1')?.createdAt === 0,
    'the one who accepted is back in the queue at once, as old as before, and hears why',
  )
  check(!s.mm.ticketOf('p0') && s.note('p0') === 'missed', 'the one who didn’t answer is out')
  const [next] = s.open()
  check(
    !!next && next !== s.p && sameSet(next.uids, ['p1', 'fresh']) && next.uids[0] === 'p1',
    'the requeued ticket keeps its place: waited long enough, it groups at once with the newcomer, first',
  )
}
{
  const s = proposal(4)
  s.at(s.t0 + readyCheckMs)
  check(!s.starts.length && s.uids.every((uid) => !s.mm.ticketOf(uid) && s.note(uid) === 'missed'), 'nobody answers: at the deadline every ticket is over')
}
{
  const s = proposal(2)
  s.mm.respond('p0', s.p.id, true)
  s.w.now = s.t0 + readyCheckMs + 5
  s.mm.respond('p1', s.p.id, true)
  check(!s.starts.length && s.p.state === 'cancelled' && s.note('p1') === 'missed', 'an accept after the deadline doesn’t count: the check ends as it stood')
}
{
  // An accept on the very tick of the deadline: one outcome, whichever gets there first.
  const outcomes = [true, false].map((tickFirst) => {
    const s = proposal(2)
    s.mm.respond('p0', s.p.id, true)
    s.w.now = s.t0 + readyCheckMs
    if (tickFirst) s.mm.tick()
    s.mm.respond('p1', s.p.id, true)
    if (!tickFirst) s.mm.tick()
    return JSON.stringify([
      s.starts.length,
      s.p.state,
      s.mm.ticketOf('p0')?.status,
      s.mm.ticketOf('p1')?.status ?? 'none',
      s.told.get('p1')!.some((q) => 'note' in q && q.note === 'missed') ? 'missed' : 'not told',
    ])
  })
  check(
    outcomes[0] === outcomes[1] && outcomes[0] === JSON.stringify([0, 'cancelled', 'searching', 'none', 'missed']),
    `an accept on the deadline's own tick: the deadline wins either way (${outcomes[0]})`,
  )
}
{
  const s = proposal(3)
  s.mm.respond('p0', 'p999', true)
  s.mm.respond('nobody', s.p.id, true)
  check(s.p.accepted.size === 0 && s.last('nobody')?.state === 'idle', 'an answer to another proposal, or from someone not in it, changes nothing')
  s.mm.cancel('p2')
  check(s.p.declined.has('p2') && !s.mm.ticketOf('p2'), 'cancelling during the ready check is a decline')
  s.mm.respond('p0', s.p.id, true)
  s.mm.disconnect('p0')
  check(
    s.p.declined.has('p0') && !s.p.accepted.has('p0') && s.p.state === 'ready_check',
    'dropping out after accepting counts as not accepted; the check runs on for the one left',
  )
  s.mm.respond('p1', s.p.id, false)
  check(s.p.state === 'cancelled' && !s.starts.length && !s.mm.ticketOf('p1'), 'everyone has answered, nobody accepted: it is off')
}
{
  const s = proposal(2)
  s.w.seats = false
  for (const uid of s.uids) s.mm.respond(uid, s.p.id, true)
  check(
    !s.starts.length && s.uids.every((uid) => s.mm.ticketOf(uid)?.status === 'searching' && s.note(uid) === 'full'),
    'the lobby can’t seat them: both back in the queue, and they hear why',
  )
}

// --- backfill -----------------------------------------------------------------------------------------------

function room(fields: Partial<Opening> = {}): Opening {
  return { id: 'r1', mode: 'ffa', map: 'city', build: 'b1', free: 6, humans: 2, progress: 0.2, ...fields }
}
{
  const s = world({ openings: [room()] })
  s.search(['third'])
  s.at(0)
  const [p] = s.open()
  const q = s.found('third')
  check(
    p?.room === 'r1' && p.map === 'city' && p.uids.length === 1 && q?.players === 3 && q.size === 1,
    'a searcher is offered a bot’s seat in a running match at once: its arena, three players with them',
  )
  s.mm.respond('third', p.id, true)
  check(s.starts.length === 1 && s.starts[0].proposal.room === 'r1' && s.starts[0].uids[0] === 'third', 'accepting it seats them there')
}
{
  const s = world({ openings: [room({ progress: 0.6 })] })
  s.search(['third'])
  s.at(0)
  check(!s.open().length, 'no offer into a match more than half over')
  s.w.openings = [room({ mode: 'tdm' }), room({ id: 'r2', build: 'b2' }), room({ id: 'r3', free: 0 }), room({ id: 'r4', map: 'scrapyard' })]
  s.at(1)
  check(!s.open().length, 'nor into another mode, another build, another arena, or a room with no bot seat')
  s.w.openings = []
  s.at(2)
  check(!s.open().length, 'and only into rooms the lobby lists (practice runs in the browser: the server has no practice rooms to offer)')
}
{
  const s = world({ openings: [room({ free: 1 })] })
  s.search(['a', 'b'])
  s.at(0)
  check(s.open().length === 1 && s.open()[0].uids[0] === 'a', 'one bot seat, two searchers: the older gets the offer')
  s.at(1)
  check(s.open().length === 1, 'an offer still out holds the seat')
  s.mm.respond('a', s.open()[0].id, false)
  s.at(2)
  check(s.open().length === 1 && s.open()[0].uids[0] === 'b', 'declined: the seat goes to the next')
}
{
  const s = world({ openings: [room({ free: 2, humans: 5 }), room({ id: 'r2', free: 6, humans: 1 })] })
  s.search(people(8))
  s.at(0)
  const offers = s.open().filter((p) => p.room)
  check(
    offers.length === 8 && offers.filter((p) => p.room === 'r1').length === 2 && offers.slice(0, 2).every((p) => p.room === 'r1'),
    'bots’ seats come before a new group, the fullest room first (eight searchers, 2 + 6 seats: eight offers)',
  )
}
{
  const s = world({ openings: [room()], config: { backfillEnabled: false } })
  s.search(['third'])
  s.at(0)
  check(!s.open().length, 'with backfill off, nobody is offered a seat')
}

describe('matchmaker', () => {
  it.each(checks)('%s', (_, ok) => expect(ok).toBe(true))
})
