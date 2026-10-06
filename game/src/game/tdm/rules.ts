import { SUPPLY } from '../items/config.ts'
import { itemTypes } from '../items/items.ts'
import { createSupply, type Supply } from '../items/supply.ts'
import { respawnWait } from '../matchSettings.ts'
import { LIVES, type Life } from '../mode.ts'
import { createRng } from '../rng.ts'
import { chainTitle, createScoring, createStats, createTally, forget } from '../scoring.ts'
import { TDM } from './config.ts'
import type { Contender, Member, Point, TdmEvent, TdmOptions, TdmPhase } from './types.ts'

// Team deathmatch rules: the match clock and its states, every machine's life
// cycle (wreck, wait, respawn, protection), team-aware spawn choice, kills and
// the team score, overtime, the statistics (../scoring.ts, shared with free
// for all) and the MVP. Pure: no rendering, physics or DOM — the match feeds
// it damage, wrecks, shots fired, positions and fixed steps, and reads back
// events. That keeps it portable to an authoritative server later. Contract:
// work/tdm/TDM_GAMEPLAY_SPEC.md. The bots' side of it is tactics.ts. When a
// match's settings turn pickups on, the supply (../items/supply.ts) plugs in:
// waves on the match clock, no hot zones.

// Allowed moves (work/tdm/TDM_STATE_MACHINE.md); anything else is refused.
const PHASES: Record<TdmPhase, readonly TdmPhase[]> = {
  preMatch: ['active'],
  active: ['overtime', 'complete'],
  overtime: ['complete'],
  complete: [],
}

export type TeamDeathmatch = ReturnType<typeof createTeamDeathmatch>

export const multiKillTitle = (chain: number) => chainTitle(chain, TDM.multiKill.titles)
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)

export function createTeamDeathmatch(members: readonly Member[], { starts, homes, spots, seed, settings }: TdmOptions) {
  const n = members.length
  const contender = (): Contender => ({ life: 'alive', respawnAt: 0, protectedUntil: 0, spawn: -1, spawnedAt: TDM.preMatch, ...createTally(n), errand: { x: 0, z: 0, urgent: false } })
  const lastUsed = starts.map(() => -Infinity) // per start
  const wrecks: Array<Point & { at: number }> = [] // recent wrecks, oldest first: spawn pressure
  let announced = false // the final minute
  let random = createRng(seed)
  const types = itemTypes(settings.items)
  const supply: Supply | undefined = types.length
    ? createSupply(members, { spots, types, clock: (): number => tdm.now, random: () => random(), report: (event): void => void tdm.events.push(event), points: TDM.score.item, wave: () => ({ count: SUPPLY.perWave }) })
    : undefined

  const tdm = {
    settings, // how this match is played (friendly fire: the HUD shows team kills)
    phase: 'preMatch' as TdmPhase,
    now: 0, // match clock, pre-match included
    overtimeAt: -1, // when overtime began; -1: no overtime
    winner: -1, // team that took the match; -1 on a draw or while it runs
    draw: false,
    mvp: -1, // member with the best combat score, fixed at the end
    score: [0, 0] as [number, number], // team kills: the only thing that decides the match
    contenders: members.map(contender),
    supply, // the pickups, when the settings turn them on
    events: [] as TdmEvent[], // the match drains these every step
    elapsed,
    remaining,
    overtimeElapsed,
    tick,
    damage,
    kill,
    fired,
    respawnDue,
    pickSpawn,
    respawned,
    leave,
    enter,
    standings,
    deficit,
    reset,
  }
  const scoring = createScoring(members, tdm.contenders, TDM)

  // --- clock and states --------------------------------------------------------

  function elapsed() {
    return Math.min(Math.max(tdm.now - TDM.preMatch, 0), settings.duration)
  }
  function remaining() {
    return settings.duration - elapsed()
  }
  function overtimeElapsed() {
    return tdm.overtimeAt < 0 ? 0 : tdm.now - tdm.overtimeAt
  }
  const fighting = () => tdm.phase === 'active' || tdm.phase === 'overtime'
  const over = () => tdm.phase === 'complete' // a call, so a check after complete() isn't narrowed away

  function setPhase(next: TdmPhase) {
    if (!PHASES[tdm.phase].includes(next)) return false
    tdm.phase = next
    tdm.events.push({ type: 'phase', phase: next })
    return true
  }

  function move(c: Contender, next: Life) {
    if (!LIVES[c.life].includes(next)) return false
    c.life = next
    return true
  }

  // One fixed step of match time: states, the final minute, the overtime
  // safety cap, protection running out.
  function tick(dt: number) {
    if (over()) return
    tdm.now += dt
    if (tdm.phase === 'preMatch') {
      if (tdm.now < TDM.preMatch) return
      setPhase('active')
    }
    if (tdm.phase === 'active') {
      if (!announced && remaining() <= TDM.finalMinute) {
        announced = true
        tdm.events.push({ type: 'finalMinute' })
      }
      if (remaining() <= 0) expire()
    }
    if (tdm.phase === 'overtime' && overtimeElapsed() >= TDM.overtimeCap) complete(-1)
    if (over()) return
    for (const c of tdm.contenders) if (c.life === 'protected' && tdm.now >= c.protectedUntil) move(c, 'alive')
    while (wrecks.length && tdm.now - wrecks[0].at > TDM.spawn.pressureMemory) wrecks.shift()
    supply?.tick(dt, elapsed(), tdm.phase !== 'overtime') // no wave in overtime
  }

  // The clock hit 00:00: more kills takes it, a tie goes to overtime. Waits
  // carried into overtime are cut, so both teams are back for it.
  function expire() {
    const [blue, red] = tdm.score
    if (blue !== red) return complete(blue > red ? 0 : 1)
    if (!setPhase('overtime')) return
    tdm.overtimeAt = tdm.now
    for (const c of tdm.contenders) if (c.life === 'pending') c.respawnAt = Math.min(c.respawnAt, tdm.now + respawnWait(TDM.respawn, settings, elapsed(), true))
  }

  // Ends the match (winner -1: a draw), fixes the MVP (none while nobody has
  // scored anything) and clears everything temporary: pending respawns,
  // protection, kill chains, damage attribution.
  function complete(winner: number) {
    if (!setPhase('complete')) return
    tdm.winner = winner
    tdm.draw = winner < 0
    for (const c of tdm.contenders) {
      if (c.life === 'pending') move(c, 'destroyed')
      if (c.life === 'protected') move(c, 'alive')
      c.protectedUntil = 0
      c.chain = 0
      forget(c)
    }
    supply?.end()
    wrecks.length = 0
    const best = standings()[0] // undefined: every seat empty
    tdm.mvp = best !== undefined && members[best].stats.combatScore > 0 ? best : -1
  }

  // --- combat -------------------------------------------------------------------

  // Hull a hit actually takes (0: none). Nothing before GO or after the end,
  // nothing to itself, between teammates (unless friendly fire is on) or
  // from a wreck (no posthumous kills); spawn protection cuts it. Recorded
  // for assists and the statistics; the match subtracts it.
  function damage(attacker: number, victim: number, amount: number) {
    const a = members[attacker]
    const v = members[victim]
    const teammate = a.team === v.team
    if (!fighting() || attacker === victim || !a.alive || !v.alive || (teammate && !settings.friendlyFire) || !(amount > 0)) return 0
    const c = tdm.contenders[victim]
    const shield = c.life === 'protected' && tdm.now < c.protectedUntil ? TDM.protection.reduction : 0
    const dealt = supply ? Math.min(v.health, amount * supply.damageFactor(attacker) * (1 - Math.max(shield, supply.shield(victim)))) : Math.min(v.health, amount * (1 - shield)) // pickups: a damage boost, armor (the stronger of it and protection)
    if (dealt <= 0) return 0
    scoring.hit(attacker, victim, dealt, tdm.now, teammate)
    return dealt
  }

  // The victim's hull reached 0 and the match has wrecked it; `killer` landed
  // the hit (-1: nobody). Scores it — a kill for a live enemy; a live
  // teammate's (friendly fire) costs its team a point and nothing else —
  // then schedules the respawn, or in overtime ends the match. False if the
  // victim was already down.
  function kill(victim: number, killer: number) {
    const c = tdm.contenders[victim]
    if ((c.life !== 'alive' && c.life !== 'protected') || !move(c, 'destroyed')) return false
    if (!fighting()) return true // can't happen through damage(); nothing to score or schedule
    const v = members[victim]
    const ended = scoring.death(victim)
    c.protectedUntil = 0
    supply?.clear(victim)
    wrecks.push({ x: v.position.x, z: v.position.z, at: tdm.now })
    const k = killer >= 0 ? members[killer] : null
    if (k && k.alive && k.team !== v.team) {
      tdm.score[k.team]++
      tdm.events.push({ type: 'kill', team: k.team, ...scoring.credit(killer, victim, ended, tdm.now) })
    } else if (settings.friendlyFire && k && k.alive && killer !== victim) {
      tdm.score[k.team]-- // may go below zero
      k.stats.teamKills++
      tdm.events.push({ type: 'teamkill', killer, victim, team: k.team })
    } else tdm.events.push({ type: 'death', victim })
    forget(c)
    if (tdm.phase === 'overtime' && tdm.score[0] !== tdm.score[1]) complete(tdm.score[0] > tdm.score[1] ? 0 : 1)
    if (settings.killLimit > 0 && k && k.team !== v.team && tdm.score[k.team] >= settings.killLimit) complete(k.team) // first team to the limit
    if (over()) return true
    c.respawnAt = tdm.now + respawnWait(TDM.respawn, settings, elapsed(), tdm.phase === 'overtime')
    move(c, 'pending')
    return true
  }

  // The machine fired a round: protection is for finding your bearings, not
  // for attacking from behind it, so it ends here.
  function fired(i: number) {
    const c = tdm.contenders[i]
    if (c.life !== 'protected') return
    c.protectedUntil = tdm.now
    move(c, 'alive')
  }

  // --- respawn ------------------------------------------------------------------

  // Everyone, the player included, goes back in the moment the wait ends.
  function respawnDue(i: number) {
    const c = tdm.contenders[i]
    return c.life === 'pending' && tdm.now >= c.respawnAt
  }

  // Back in at `start`: protected for a moment, with a clean slate of damage.
  // The match places the car once this agrees.
  function respawned(i: number, start: number) {
    const c = tdm.contenders[i]
    if (!respawnDue(i) || !move(c, 'respawning')) return false
    c.spawn = start
    c.spawnedAt = tdm.now
    c.protectedUntil = tdm.now + TDM.protection.duration
    forget(c)
    if (start >= 0) lastUsed[start] = tdm.now
    move(c, 'protected')
    tdm.events.push({ type: 'respawn', who: i, spawn: start })
    return true
  }

  // The seat is empty (a custom room's: its person left): out of play where
  // it stands, quietly — no death, no kill; its wait, protection and this
  // life's hits forgotten. Left out of spawn choice and the standings until
  // someone takes the seat.
  function leave(i: number) {
    const c = tdm.contenders[i]
    if (!move(c, 'absent')) return false
    c.respawnAt = c.protectedUntil = 0
    forget(c)
    return true
  }

  // Someone takes the empty seat: due back in at once (the match respawns it).
  function enter(i: number) {
    const c = tdm.contenders[i]
    if (!move(c, 'pending')) return false
    c.respawnAt = tdm.now
    return true
  }

  const absent = (i: number) => tdm.contenders[i].life === 'absent'

  // The best start for `who` (see the spec's spawn selection). `sees(enemy,
  // at)`: a clear line from that enemy to the start. Starts with a machine on
  // them (wrecks included) or a live enemy in ramming range are passed over,
  // unless that leaves none. Ties: the lowest index.
  function pickSpawn(who: number, sees: (enemy: number, at: Point) => boolean) {
    let best = -1
    let bestScore = -Infinity
    for (const strict of [true, false]) {
      for (let s = 0; s < starts.length; s++) {
        if (strict && blocked(who, starts[s])) continue
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

  function blocked(who: number, at: Point) {
    const team = members[who].team
    for (let i = 0; i < n; i++) {
      if (i === who || absent(i)) continue
      const m = members[i]
      const d = distance(m.position, at)
      if (d < TDM.spawn.occupied || (m.alive && m.team !== team && d < TDM.spawn.ramRange)) return true
    }
    return false
  }

  // Safe (far from enemies, out of their sight and away from where the fight
  // just was) but useful (near teammates, on the team's own half).
  function scoreSpawn(who: number, s: number, sees: (enemy: number, at: Point) => boolean) {
    const t = TDM.spawn
    const at = starts[s]
    const team = members[who].team
    let nearest = Infinity
    let total = 0
    let enemies = 0
    let watching = 0
    let crowd = 0
    let support = 0
    for (let i = 0; i < n; i++) {
      const m = members[i]
      if (i === who || !m.alive) continue
      const d = distance(m.position, at)
      if (m.team === team) {
        if (d <= t.supportRadius) support++
        continue
      }
      nearest = Math.min(nearest, d)
      total += d
      enemies++
      if (d <= t.crowdRadius) crowd++
      if (d <= t.sightRange && sees(i, at)) watching++
    }
    let pressure = 0
    for (const wreck of wrecks) if (distance(wreck, at) <= t.pressureRadius) pressure++
    let score = Math.min(nearest, t.nearCap) + t.averageWeight * (enemies ? Math.min(total / enemies, t.averageCap) : t.averageCap)
    score += t.supportBonus * Math.min(support, t.supportCap) + t.sideWeight * side(team, at)
    score -= t.sightPenalty * watching + t.crowdPenalty * crowd + t.pressurePenalty * pressure
    if (tdm.now - lastUsed[s] < t.recent) score -= t.recentPenalty
    return score
  }

  // +1 at the team's own base, -1 at the enemy's, 0 halfway between.
  function side(team: number, at: Point) {
    const own = homes[team]
    const enemy = homes[1 - team]
    return (distance(at, enemy) - distance(at, own)) / distance(own, enemy)
  }

  // --- standings ----------------------------------------------------------------

  // Combat score first; ties by kills, assists, fewer deaths, then line-up
  // order. The team score plays no part.
  const byRank = (a: number, b: number) => {
    const sa = members[a].stats
    const sb = members[b].stats
    return sb.combatScore - sa.combatScore || sb.kills - sa.kills || sb.assists - sa.assists || sa.deaths - sb.deaths || a - b
  }

  // Every member in play, best first (the MVP order).
  function standings() {
    return members.map((_, i) => i).filter((i) => !absent(i)).sort(byRank)
  }

  // Kills `team` is behind by (negative: ahead).
  function deficit(team: number) {
    return tdm.score[1 - team] - tdm.score[team]
  }

  // --- restart ------------------------------------------------------------------

  // A fresh match on the same members: clock, states, score, statistics,
  // relationships, spawn history and items all start over; the items'
  // rolls from `next`, the new match's seed.
  function reset(next: number) {
    random = createRng(next)
    supply?.reset()
    scoring.reset()
    tdm.phase = 'preMatch'
    tdm.now = 0
    tdm.overtimeAt = -1
    tdm.winner = -1
    tdm.draw = false
    tdm.mvp = -1
    tdm.score[0] = tdm.score[1] = 0
    tdm.contenders.forEach((c) => Object.assign(c, contender()))
    tdm.events.length = 0
    for (const m of members) Object.assign(m.stats, createStats())
    lastUsed.fill(-Infinity)
    wrecks.length = 0
    announced = false
  }

  return tdm
}
