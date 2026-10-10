import { distance, type Point } from '../../shared/math.ts'
import { TDM } from './config.ts'
import type { Contender, Errand, Member, Stance } from './types.ts'

// Team deathmatch bot tactics: how a bot values each enemy as a target and
// where it drives when it isn't fighting — the two hooks of sim/ai/brain.ts's Plan.
// Pure and deterministic: positions, hull, the rules' hit records and the
// team score in; a number or a point out. Simple priorities, no squad
// planner:
//
//   1. whoever is shooting the bot (sim/ai/think.ts: its grudge, before any value)
//   2. an enemy attacking a nearby teammate  (defendBias)
//   3. an enemy low on hull                  (finishBias)
//   4. an isolated enemy                     (isolatedBias)
//   5. the nearest enemy
//
// Biases are metres the enemy counts as nearer, so distance still matters,
// and a bias reaches past the bot's own detection range: a teammate under
// fire pulls help from further off. With nobody in range a bot heads for the
// enemy it values most — the team shares what it sees, as the player's
// minimap does — and it flanks a target standing in a group. Behind by
// comebackGap kills, a team's bots defend and pick off isolated enemies more
// eagerly, go after the enemy's top scorer, flank smaller groups and, alone,
// regroup before hunting. Nothing here touches a machine's numbers.

// What tactics read of the rules: the clock, hit records, protection, score.
export interface TacticsView {
  readonly now: number
  readonly contenders: readonly Contender[]
  readonly score: readonly number[]
}

// `nodes`: the bots' road nodes; errands snap to the nearest, so a route only
// changes when the node does.
export function createTactics(members: readonly Member[], view: TacticsView, nodes: readonly Point[]) {
  const t = TDM.bots
  const n = members.length
  const flank: Point = { x: 0, z: 0 }

  const behind = (team: number) => view.score[1 - team] - view.score[team] >= t.comebackGap
  const shielded = (i: number) => view.contenders[i].life === 'protected' && view.now < view.contenders[i].protectedUntil

  // `rival` hit one of `bot`'s teammates within threatWindow, and that teammate is within supportRadius of `bot`.
  function defending(bot: number, rival: number) {
    const b = members[bot]
    for (let i = 0; i < n; i++) {
      const mate = members[i]
      if (i === bot || !mate.alive || mate.team !== b.team) continue
      if (view.now - view.contenders[i].hitAt[rival] <= t.threatWindow && distance(mate.position, b.position) <= t.supportRadius) return true
    }
    return false
  }

  // The nearest live teammate of `i`; -1 for none.
  function nearestMate(i: number) {
    let best = -1
    let bestDistance = Infinity
    for (let j = 0; j < n; j++) {
      if (j === i || !members[j].alive || members[j].team !== members[i].team) continue
      const d = distance(members[j].position, members[i].position)
      if (d < bestDistance) {
        best = j
        bestDistance = d
      }
    }
    return best
  }

  const isolated = (i: number) => {
    const mate = nearestMate(i)
    return mate < 0 || distance(members[mate].position, members[i].position) > t.isolation
  }

  // The team's one member in play with the most kills; -1 while that's tied (or nobody has one).
  function topScorer(team: number) {
    let top = -1
    let most = 0
    for (let i = 0; i < n; i++) {
      if (members[i].team !== team || view.contenders[i].life === 'absent') continue
      const kills = members[i].stats.kills
      if (kills > most) {
        most = kills
        top = i
      } else if (kills === most) top = -1
    }
    return top
  }

  // How near `rival` looks to `bot` choosing a target (`d`: the real
  // distance). Infinity: not a target — a teammate, a wreck, or a machine
  // still under spawn protection.
  function targetValue(bot: number, rival: number, d: number) {
    const r = members[rival]
    const team = members[bot].team
    if (!r.alive || r.team === team || shielded(rival)) return Infinity
    const comeback = behind(team)
    let bias = 0
    if (defending(bot, rival)) bias += t.defendBias * (comeback ? t.comeback.defend : 1)
    if (r.health <= r.maxHealth * t.lowHull) bias += t.finishBias
    if (isolated(rival)) bias += t.isolatedBias * (comeback ? t.comeback.isolated : 1)
    if (comeback && rival === topScorer(r.team)) bias += t.comeback.leaderBias
    return d - bias
  }

  // A point off the side of `target` when it stands in a group and `bot`
  // hasn't closed in yet; null otherwise. The side is fixed per bot, so a
  // team's bots split round both flanks. Writes the shared `flank` point.
  function flankPoint(bot: number, target: number, comeback: boolean) {
    const from = members[bot].position
    const r = members[target]
    const d = distance(r.position, from)
    if (!r.alive || d <= t.flankMin) return null
    let group = 0
    for (let i = 0; i < n; i++)
      if (i !== target && members[i].alive && members[i].team === r.team && distance(members[i].position, r.position) <= t.flankRadius) group++
    if (group < (comeback ? t.comeback.flankGroup : t.flankGroup)) return null
    const side = bot % 2 ? 1 : -1
    const ux = (r.position.x - from.x) / d
    const uz = (r.position.z - from.z) / d
    flank.x = r.position.x - uz * side * t.flankOffset
    flank.z = r.position.z + ux * side * t.flankOffset
    return flank
  }

  // The enemy `bot` values most, anywhere; -1 for none.
  function quarry(bot: number) {
    let best = -1
    let bestValue = Infinity
    for (let i = 0; i < n; i++) {
      const value = targetValue(bot, i, distance(members[i].position, members[bot].position))
      if (value < bestValue) {
        best = i
        bestValue = value
      }
    }
    return best
  }

  // What `bot` should do for its team with `target` (-1: none in range):
  // flank it, regroup, or head for the most valuable enemy.
  function decide(bot: number, target: number): { stance: Stance; point: Point | null; urgent: boolean } {
    const comeback = behind(members[bot].team)
    if (target >= 0) {
      const point = flankPoint(bot, target, comeback)
      if (point) return { stance: 'flank', point, urgent: true }
      return { stance: defending(bot, target) ? 'support' : 'attack', point: null, urgent: false }
    }
    if (comeback && isolated(bot)) {
      const mate = nearestMate(bot)
      if (mate >= 0) return { stance: 'defend', point: members[mate].position, urgent: false }
    }
    const prey = quarry(bot)
    if (prey < 0) return { stance: 'attack', point: null, urgent: false }
    return { stance: defending(bot, prey) ? 'support' : 'attack', point: members[prey].position, urgent: false }
  }

  // Where `bot` drives when it isn't fighting — or, urgent, round its
  // target's flank. Snapped to a road node and written into the bot's own
  // errand; null for none (sim/ai/think.ts then engages or roams).
  function errand(bot: number, target: number): Errand | null {
    const { point, urgent } = decide(bot, target)
    if (!point) return null
    let snap = point
    let nearest = Infinity
    for (const node of nodes) {
      const d = distance(node, point)
      if (d < nearest) {
        nearest = d
        snap = node
      }
    }
    const out = view.contenders[bot].errand
    out.x = snap.x
    out.z = snap.z
    out.urgent = urgent
    return out
  }

  // What `bot` is doing for its team (debug and metrics).
  const stance = (bot: number, target: number) => decide(bot, target).stance

  return { targetValue, errand, stance, isolated }
}
