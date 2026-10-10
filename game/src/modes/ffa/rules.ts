import { SUPPLY } from '../items/config.ts'
import { itemTypes, weighted, type Errand, type Holder } from '../items/items.ts'
import { createSupply, type Collector, type SupplyEvent } from '../items/supply.ts'
import { respawnWait, type MatchSettings } from '../matchSettings.ts'
import { LIVES, type Life } from '../../sim/matchMode.ts'
import { distance, type Point } from '../../shared/math.ts'
import { createRng } from '../../shared/rng.ts'
import { chainTitle, createScoring, createStats, createTally, forget, type Tally } from '../../sim/scoring.ts'
import { FFA } from './config.ts'

// Free for all rules: the match clock and its phases, every machine's life
// cycle (wreck, wait, respawn, protection), spawn choice, kills, assists and
// the statistics, streaks, multi-kills, revenge, hot zones, standings and the
// result, with the pickups (../items/supply.ts) plugged in: its hot zones
// and comeback pull shape every drop. Pure: no rendering, physics or DOM —
// the match feeds it damage, wrecks, positions and fixed steps, and reads
// back modifiers and events. That keeps it portable to an authoritative
// server later. Contract: work/ffa/FFA_GAMEPLAY_SPEC.md. The statistics
// themselves are ../scoring.ts, shared with team deathmatch.

export { createStats }

// What the rules need of a machine; the match's combatants are participants.
export interface Participant extends Collector {
  name: string
}

// A named area of the map a hot zone can open over.
export interface Zone extends Point {
  name: string
  radius: number
}

const inside = (zone: Zone | null, p: Point) => !!zone && distance(zone, p) <= zone.radius

type FfaPhase = 'preMatch' | 'active' | 'finalMinute' | 'overtime' | 'complete'

// Allowed moves (work/ffa/FFA_STATE_MACHINE.md); anything else is refused.
const PHASES: Record<FfaPhase, readonly FfaPhase[]> = {
  preMatch: ['active'],
  active: ['finalMinute', 'overtime', 'complete'],
  finalMinute: ['overtime', 'complete'],
  overtime: ['complete'],
  complete: [],
}

// A machine as the rules see it; the Tally part (this life's hits, kill
// chain) is the statistics'.
interface Contender extends Tally {
  life: Life
  respawnAt: number
  protectedUntil: number
  spawn: number // start of the current life, -1 for none
  spawnedAt: number
  errand: Errand // a bot's errand, rewritten in place
}

export type FfaEvent =
  | { type: 'phase'; phase: FfaPhase }
  | {
      type: 'kill'
      killer: number
      victim: number
      assists: number[]
      streak: number
      milestone: string
      multi: number
      revenge: boolean
      nemesis: boolean
      shutdown: number
    } // nemesis: the victim was the killer's nemesis; shutdown: the streak it ended
  | { type: 'death'; victim: number } // wrecked with nobody to credit
  | { type: 'nemesis'; who: number; of: number } // `who` just became the nemesis of `of`
  | { type: 'respawn'; who: number; spawn: number }
  | { type: 'zone'; zone: Zone | null }
  | SupplyEvent

export interface FfaOptions {
  starts: readonly Point[] // the arena's spawn points
  spots: readonly Point[] // where items can appear (validated by the match)
  zones: readonly Zone[] // hot-zone areas
  seed: number
  settings: MatchSettings // the clock's length
}

export type FreeForAll = ReturnType<typeof createFreeForAll>

export const multiKillTitle = (chain: number) => chainTitle(chain, FFA.multiKill.titles)

export function createFreeForAll(participants: readonly Participant[], { starts, spots, zones, seed, settings }: FfaOptions) {
  const n = participants.length
  const contender = (i: number): Contender => ({
    life: 'alive',
    respawnAt: 0,
    protectedUntil: 0,
    spawn: starts.length ? i % starts.length : -1, // the grid the match lines up on
    spawnedAt: FFA.preMatch,
    ...createTally(n),
    errand: { x: 0, z: 0, urgent: false },
  })
  let random = createRng(seed)
  const lastUsed = starts.map(() => -Infinity) // per start
  const benched = starts.map(() => -Infinity) // spawn camping: out of use until
  const marks = starts.map((): number[] => []) // spawn camping: recent quick deaths
  let nextZone = FFA.hotZone.first
  let dirty = true // standings need sorting
  // The pickups, on the match's stream: each wave pulled into the hot zone and toward trailing machines.
  const supply = createSupply(participants, {
    spots,
    types: itemTypes(settings.items),
    clock: () => ffa.now,
    random: () => random(),
    report: (event) => ffa.events.push(event),
    points: FFA.score.item,
    wave: () => ({ count: SUPPLY.perWave, zone: hotArea(ffa.zone, FFA.hotZone.bonusItems), weight: spotWeight(ffa.zone, trailingPositions()) }),
  })

  const ffa = {
    seed,
    phase: 'preMatch' as FfaPhase,
    now: 0, // match clock, pre-match included
    overtimeAt: 0,
    winner: -1, // participant who took the match; -1 on a draw or while it runs
    draw: false,
    contenders: participants.map((_, i) => contender(i)),
    supply, // the pickups: items on the ground, effects running
    zone: null as Zone | null,
    zoneSpots: [] as number[], // spots inside the zone
    events: [] as FfaEvent[], // the match drains these every step
    order: participants.map((_, i) => i), // standings, best first (standings() sorts)
    feuds: [] as number[][], // [k][v]: kills k made on v since v last killed k — the statistics' own table (nemesisOf reads it)
    elapsed,
    remaining,
    overtimeLeft,
    tick,
    damage,
    kill,
    respawnDue,
    pickSpawn,
    respawned,
    leave,
    enter,
    standings,
    place,
    soleLeader,
    trailing,
    nemesisOf,
    speedFactor: supply.speedFactor, // engine boost from a speed pickup
    targetValue,
    errand,
    reset,
  }
  const scoring = createScoring(participants, ffa.contenders, FFA)
  ffa.feuds = scoring.feuds

  // --- clock and phases --------------------------------------------------------

  function elapsed() {
    return Math.min(Math.max(ffa.now - FFA.preMatch, 0), settings.duration)
  }
  function remaining() {
    return settings.duration - elapsed()
  }
  function overtimeLeft() {
    return ffa.phase === 'overtime' ? Math.max(0, FFA.overtime - (ffa.now - ffa.overtimeAt)) : FFA.overtime
  }
  const fighting = () => ffa.phase === 'active' || ffa.phase === 'finalMinute' || ffa.phase === 'overtime'
  const over = () => ffa.phase === 'complete' // a call, so a check after complete() isn't narrowed away

  function setPhase(next: FfaPhase) {
    if (!PHASES[ffa.phase].includes(next)) return false
    ffa.phase = next
    ffa.events.push({ type: 'phase', phase: next })
    return true
  }

  function move(c: Contender, next: Life) {
    if (!LIVES[c.life].includes(next)) return false
    c.life = next
    return true
  }

  // One fixed step of match time: phases, protection, hot zones, then the
  // pickups' step (repairs, waves, expiry, pickups) — in that order.
  function tick(dt: number) {
    if (over()) return
    ffa.now += dt
    if (ffa.phase === 'preMatch') {
      if (ffa.now < FFA.preMatch) return
      setPhase('active')
    }
    if (ffa.phase === 'active' && remaining() <= FFA.finalMinute) setPhase('finalMinute')
    if ((ffa.phase === 'active' || ffa.phase === 'finalMinute') && remaining() <= 0) expire()
    if (ffa.phase === 'overtime' && overtimeLeft() <= 0) complete(-1)
    if (over()) return
    for (const c of ffa.contenders) if (c.life === 'protected' && ffa.now >= c.protectedUntil) move(c, 'alive')
    const open = ffa.phase !== 'overtime' // no new zone and no wave in overtime
    // openZone() must precede supply.tick(): zone bonus items are placed
    // during placeWave inside supply.tick(), which reads the active ffa.zone.
    if (open && zones.length && supply.types.length && elapsed() >= nextZone) {
      openZone() // a zone is for its items: none with every pickup off
      nextZone += FFA.hotZone.duration
    }
    if (supply.tick(dt, elapsed(), open)) dirty = true
  }

  // The clock hit 00:00: one leader takes it, a tie goes to overtime. Waits
  // carried into overtime are cut so the tied can get back into it.
  function expire() {
    const leader = soleLeader()
    if (leader >= 0) return complete(leader)
    if (!setPhase('overtime')) return
    ffa.overtimeAt = ffa.now
    for (const c of ffa.contenders) if (c.life === 'pending') c.respawnAt = Math.min(c.respawnAt, ffa.now + respawnWait(FFA.respawn, settings, elapsed(), true))
  }

  // Ends the match (winner -1: a draw) and clears everything temporary:
  // pending respawns, protection, effects, damage attribution, items, zone.
  function complete(winner: number) {
    if (!setPhase('complete')) return
    ffa.winner = winner
    ffa.draw = winner < 0
    for (const c of ffa.contenders) {
      if (c.life === 'pending') move(c, 'destroyed')
      if (c.life === 'protected') move(c, 'alive')
      c.protectedUntil = 0
      c.chain = 0
      forget(c)
    }
    supply.end()
    ffa.zone = null
    ffa.zoneSpots = []
    dirty = true
  }

  // --- combat -------------------------------------------------------------------

  // Hull a hit actually takes (0: none) once the attacker's damage boost and
  // the victim's protection or armor (the stronger one) apply; recorded for
  // assists and the statistics. The match subtracts it. A destroyed attacker
  // does no damage, so nothing scores after its own death; nobody's rocket
  // hurts themselves.
  function damage(attacker: number, victim: number, amount: number) {
    const a = participants[attacker]
    const v = participants[victim]
    if (!fighting() || attacker === victim || !a.alive || !v.alive || !(amount > 0)) return 0
    const hit = ffa.contenders[victim]
    const shield = hit.life === 'protected' && ffa.now < hit.protectedUntil ? FFA.protection.reduction : 0
    const armor = supply.shield(victim)
    const boost = supply.damageFactor(attacker)
    const dealt = Math.min(v.health, amount * boost * (1 - Math.max(shield, armor)))
    if (dealt <= 0) return 0
    scoring.hit(attacker, victim, dealt, ffa.now)
    dirty = true
    return dealt
  }

  // The victim's hull reached 0 and the match has wrecked it; `killer` landed
  // the hit (-1: nobody). Scores it, then schedules the respawn — or, in
  // overtime, may end the match. False if the victim was already down.
  function kill(victim: number, killer: number) {
    const c = ffa.contenders[victim]
    if ((c.life !== 'alive' && c.life !== 'protected') || !move(c, 'destroyed')) return false
    if (!fighting()) return true // can't happen through damage(); nothing to score or schedule
    const ended = scoring.death(victim)
    c.protectedUntil = 0
    supply.clear(victim)
    if (ffa.now - c.spawnedAt <= FFA.spawn.campWindow) mark(c.spawn)
    const credited = killer >= 0 && killer !== victim && participants[killer].alive
    if (credited) {
      ffa.events.push({ type: 'kill', ...scoring.credit(killer, victim, ended, ffa.now) })
      if (scoring.against(killer, victim) === FFA.nemesis) ffa.events.push({ type: 'nemesis', who: killer, of: victim })
    } else ffa.events.push({ type: 'death', victim })
    forget(c)
    dirty = true
    if (ffa.phase === 'overtime' && credited && soleLeader() >= 0) complete(soleLeader())
    if (credited && settings.killLimit > 0 && participants[killer].stats.kills >= settings.killLimit) complete(killer) // first to the limit
    if (over()) return true
    c.respawnAt = ffa.now + respawnWait(FFA.respawn, settings, elapsed(), ffa.phase === 'overtime')
    move(c, 'pending')
    return true
  }

  // The rival with the most unanswered kills on `victim`, once that reaches FFA.nemesis; -1 for none.
  function nemesisOf(victim: number) {
    return scoring.nemesisOf(victim)
  }

  // --- respawn ------------------------------------------------------------------

  // Everyone, the player included, goes back in the moment the wait ends.
  function respawnDue(i: number) {
    const c = ffa.contenders[i]
    return c.life === 'pending' && ffa.now >= c.respawnAt
  }

  // Back in at `start`: protected for a moment, with a clean slate of damage.
  // The match places the car once this agrees.
  function respawned(i: number, start: number) {
    const c = ffa.contenders[i]
    if (!respawnDue(i) || !move(c, 'respawning')) return false
    c.spawn = start
    c.spawnedAt = ffa.now
    c.protectedUntil = ffa.now + FFA.protection.duration
    forget(c)
    if (start >= 0) lastUsed[start] = ffa.now
    move(c, 'protected')
    ffa.events.push({ type: 'respawn', who: i, spawn: start })
    return true
  }

  // The seat is empty (a custom room's: its person left): out of play where
  // it stands, quietly — no death, no kill; its wait, protection, effects
  // and this life's hits forgotten. Left out of spawn choice, the lead and
  // the standings until someone takes the seat.
  function leave(i: number) {
    const c = ffa.contenders[i]
    if (!move(c, 'absent')) return false
    c.respawnAt = c.protectedUntil = 0
    forget(c)
    supply.clear(i)
    dirty = true
    return true
  }

  // Someone takes the empty seat: due back in at once (the match respawns it).
  function enter(i: number) {
    const c = ffa.contenders[i]
    if (!move(c, 'pending')) return false
    c.respawnAt = ffa.now
    dirty = true
    return true
  }

  const absent = (i: number) => ffa.contenders[i].life === 'absent'

  // The safest start for `who` (see the spec's spawn selection). `sees(rival,
  // at)`: a clear line from that rival to the start. Starts that are occupied
  // (any car, wrecks included) or benched for spawn camping are passed over,
  // unless that leaves none.
  function pickSpawn(who: number, sees: (rival: number, at: Point) => boolean) {
    let best = -1
    let bestScore = -Infinity
    for (const strict of [true, false]) {
      for (let s = 0; s < starts.length; s++) {
        if (strict && (benched[s] > ffa.now || occupied(who, starts[s]))) continue
        const score = scoreSpawn(who, s, sees)
        if (score > bestScore) {
          best = s
          bestScore = score
        }
      }
      if (best >= 0) break
    }
    return best
  }

  function occupied(who: number, at: Point) {
    for (let i = 0; i < n; i++) if (i !== who && !absent(i) && distance(participants[i].position, at) < FFA.spawn.occupied) return true
    return false
  }

  function scoreSpawn(who: number, s: number, sees: (rival: number, at: Point) => boolean) {
    const t = FFA.spawn
    const at = starts[s]
    let nearest = Infinity
    let total = 0
    let rivals = 0
    let watching = 0
    let crowd = 0
    for (let i = 0; i < n; i++) {
      if (i === who || !participants[i].alive) continue
      const d = distance(participants[i].position, at)
      nearest = Math.min(nearest, d)
      total += d
      rivals++
      if (d <= t.crowdRadius) crowd++
      if (d <= t.sightRange && sees(i, at)) watching++
    }
    let score = Math.min(nearest, t.nearCap) + t.averageWeight * (rivals ? Math.min(total / rivals, t.averageCap) : t.averageCap)
    score -= t.sightPenalty * watching + t.crowdPenalty * crowd
    if (ffa.now - lastUsed[s] < t.recent) score -= t.recentPenalty
    if (inside(ffa.zone, at)) score -= t.hotZonePenalty
    return score
  }

  // A death soon after spawning marks the start; enough marks bench it.
  function mark(start: number) {
    if (start < 0) return
    const list = marks[start]
    list.push(ffa.now)
    while (ffa.now - list[0] > FFA.spawn.campMemory) list.shift()
    if (list.length < FFA.spawn.campDeaths) return
    benched[start] = ffa.now + FFA.spawn.cooldown
    list.length = 0
  }

  // --- standings ----------------------------------------------------------------

  // Most kills first; ties by combat score, fewer deaths, then grid order.
  const byRank = (a: number, b: number) => {
    const sa = participants[a].stats
    const sb = participants[b].stats
    return sb.kills - sa.kills || sb.combatScore - sa.combatScore || sa.deaths - sb.deaths || a - b
  }

  // Every seat in play, best first.
  function standings() {
    if (dirty) ffa.order.sort(byRank)
    dirty = false
    return ffa.contenders.some((c) => c.life === 'absent') ? ffa.order.filter((i) => !absent(i)) : ffa.order
  }

  function topKills() {
    let top = 0
    for (let i = 0; i < n; i++) if (!absent(i)) top = Math.max(top, participants[i].stats.kills)
    return top
  }

  // The one machine in play with the most kills; -1 while two or more share it.
  function soleLeader() {
    let leader = -1
    let top = -1
    for (let i = 0; i < n; i++) {
      if (absent(i)) continue
      const kills = participants[i].stats.kills
      if (kills > top) {
        top = kills
        leader = i
      } else if (kills === top) leader = -1
    }
    return leader
  }

  // Far enough behind the leader for the comeback weighting.
  function trailing(i: number) {
    return topKills() - participants[i].stats.kills >= FFA.comeback.gap
  }

  // 1-based; in a draw everyone tied for the most kills shares first.
  function place(i: number) {
    if (ffa.draw && participants[i].stats.kills === topKills()) return 1
    return standings().indexOf(i) + 1
  }

  // --- hot zone ------------------------------------------------------------------

  function openZone() {
    const zone = chooseZone(random, zones, ffa.zone, trailingPositions())
    ffa.zone = zone
    ffa.zoneSpots = []
    for (let i = 0; i < spots.length; i++) if (inside(zone, spots[i])) ffa.zoneSpots.push(i)
    ffa.events.push({ type: 'zone', zone })
    supply.drop({ count: 0, zone: hotArea(zone, FFA.hotZone.drops), weight: spotWeight(zone, []) })
  }

  const trailingPositions = () => participants.filter((p, i) => p.alive && trailing(i)).map((p) => p.position)

  // --- bots ---------------------------------------------------------------------

  // How near `rival` looks to `bot` choosing a target: protected rivals are
  // skipped, the sole leader looks nearer, a trailing bot reaches further.
  function targetValue(bot: number, rival: number, d: number) {
    const c = ffa.contenders[rival]
    if (c.life === 'protected' && ffa.now < c.protectedUntil) return Infinity
    if (rival === soleLeader()) d -= FFA.bots.leaderBias
    return trailing(bot) ? d / FFA.bots.trailingReach : d
  }

  // Where the bot would drive when it isn't fighting: an item it knows
  // about (a trailing bot senses further), else a patrol of the hot zone.
  function errand(bot: number) {
    const behind = trailing(bot)
    const out = ffa.contenders[bot].errand
    return (
      supply.errand(bot, behind ? FFA.bots.trailingReach : 1, out) ?? zoneErrand(participants[bot], bot, behind, spots, ffa.zone, ffa.zoneSpots, ffa.now, out)
    )
  }

  // --- restart ------------------------------------------------------------------

  // A fresh match on the same participants: clock, phases, statistics,
  // relationships, spawn history, items, zone and events all start over.
  function reset(next: number) {
    ffa.seed = next
    random = createRng(next)
    scoring.reset()
    ffa.phase = 'preMatch'
    ffa.now = ffa.overtimeAt = 0
    ffa.winner = -1
    ffa.draw = false
    ffa.zone = null
    ffa.zoneSpots = []
    ffa.contenders.forEach((c, i) => Object.assign(c, contender(i)))
    supply.reset()
    ffa.events.length = 0
    for (const p of participants) Object.assign(p.stats, createStats())
    ffa.order.forEach((_, k) => (ffa.order[k] = k))
    lastUsed.fill(-Infinity)
    benched.fill(-Infinity)
    for (const list of marks) list.length = 0
    nextZone = FFA.hotZone.first
    dirty = true
  }

  return ffa
}

// --- hot zones: the drop's shape, the next zone, bots' patrols ---------------------------------

// A drop's hot area: extra items inside the zone first, rolled on its own table.
const hotArea = (zone: Zone | null, extras: number) => (zone ? { extras, inside: (at: Point) => inside(zone, at), rarity: FFA.hotZone.rarity } : undefined)

// How free for all weighs a free spot in a drop: x hotZone.weight inside
// the zone, x comeback.weight near a trailing machine.
export const spotWeight = (zone: Zone | null, trailing: readonly Point[]) => (at: Point) =>
  (inside(zone, at) ? FFA.hotZone.weight : 1) * (trailing.some((t) => distance(t, at) <= FFA.comeback.radius) ? FFA.comeback.weight : 1)

// The next hot zone: never the one just closing (unless it's the only one);
// each trailing machine near a zone adds to its weight.
function chooseZone(random: () => number, zones: readonly Zone[], previous: Zone | null, trailing: readonly Point[]) {
  const weights = zones.map((zone) =>
    zone === previous && zones.length > 1 ? 0 : 1 + FFA.comeback.zoneWeight * trailing.filter((t) => distance(t, zone) <= FFA.comeback.radius * 1.5).length,
  )
  const choice = weighted(random, weights)
  return choice < 0 ? null : zones[choice]
}

// A hot-zone spot for a bot to drive to: each bot starts at its own place in
// the zone's list and moves along it every `patrol` seconds, skipping a spot
// it's already on, so it keeps working the zone's streets.
function patrol(bot: Holder, index: number, spots: readonly Point[], zone: Zone, zoneSpots: readonly number[], now: number): Point {
  const first = index + Math.floor(now / FFA.bots.patrol)
  for (let k = 0; k < zoneSpots.length; k++) {
    const spot = spots[zoneSpots[(first + k) % zoneSpots.length]]
    if (distance(bot.position, spot) > FFA.bots.arrive) return spot
  }
  return zone
}

// An idle bot's errand in the hot zone (announced to everyone): a patrol of
// its streets, if the bot cares for the zone — trailing bots always do.
// Writes `out`; null for none.
export function zoneErrand(
  bot: Holder,
  index: number,
  trailing: boolean,
  spots: readonly Point[],
  zone: Zone | null,
  zoneSpots: readonly number[],
  now: number,
  out: Errand,
): Errand | null {
  const curious = trailing || (index * 0.618034) % 1 < FFA.bots.zoneInterest // golden-ratio spread over the grid
  if (!zone || !curious) return null
  const spot = patrol(bot, index, spots, zone, zoneSpots, now)
  out.x = spot.x
  out.z = spot.z
  out.urgent = false
  return out
}
