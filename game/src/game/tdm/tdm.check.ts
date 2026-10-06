// Self-check for the team deathmatch rules and team tactics. Run: node src/game/tdm/tdm.check.ts
// Plain machines on the City's layout of starts, fixed steps of 1/64 s
// (exact in binary, so phase boundaries land on a step), plus one run at the
// game's own 1/60 s. Team 0 is members 0-3 (0 is the player's seat), team 1
// members 4-7.
import { clearOfMates, createBrain, pickTarget, provoke, type Agent, type Plan } from '../ai.ts'
import { classic, type MatchSettings } from '../matchSettings.ts'
import { createStats } from '../scoring.ts'
import { TDM } from './config.ts'
import { createTeamDeathmatch, multiKillTitle, type TeamDeathmatch } from './rules.ts'
import { createTactics } from './tactics.ts'
import type { Member, Point, TdmEvent } from './types.ts'

let checks = 0
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`tdm: ${what}`)
  checks++
}
const near = (a: number, b: number, what: string) => check(Math.abs(a - b) < 1e-6, `${what} (${a} vs ${b})`)

const STEP = 1 / 64
const HOMES: [Point, Point] = [
  { x: 0, z: -94 },
  { x: 0, z: 94 },
]
// The City's: each team's base (0-3, 4-7), then 16 on the perimeter road (8-23).
const STARTS: Point[] = [...[-100, -88].flatMap((z) => [{ x: -5, z }, { x: 5, z }]), ...[100, 88].flatMap((z) => [{ x: -5, z }, { x: 5, z }])]
for (const along of [-83, -28, 28, 83]) STARTS.push({ x: along, z: 110 }, { x: along, z: -110 }, { x: 110, z: along }, { x: -110, z: along })
const NODES: Point[] = [] // a 28 m road grid
for (let x = -112; x <= 112; x += 28) for (let z = -112; z <= 112; z += 28) NODES.push({ x, z })
const TEAM = [0, 0, 0, 0, 1, 1, 1, 1]
const FAR: [number, number] = [999, 999]
const { bots: B } = TDM

function setup(starts = STARTS, settings: MatchSettings = classic('tdm')) {
  const cars: Member[] = TEAM.map((team, i) => ({ name: `car${i}`, team, alive: true, health: 100, maxHealth: 100, position: { ...starts[i % starts.length] }, weapon: { ammo: 60, reload: 0, spec: { magazine: 60 } }, stats: createStats() }))
  const tdm = createTeamDeathmatch(cars, { starts, homes: HOMES, spots: [], seed: 1, settings })
  const tactics = createTactics(cars, tdm, NODES)
  return { cars, tdm, tactics, starts }
}
type Match = ReturnType<typeof setup>

const drain = (tdm: TeamDeathmatch) => tdm.events.splice(0)
const kills = (events: TdmEvent[]) => events.filter((e) => e.type === 'kill').reverse() // latest first
function advance(tdm: TeamDeathmatch, seconds: number) {
  for (let k = Math.round(seconds / STEP); k > 0; k--) tdm.tick(STEP)
}
// Runs until the elapsed clock (time since GO) reaches `elapsed`, or active play ends.
function advanceTo({ tdm }: Match, elapsed: number) {
  while (tdm.phase === 'preMatch' || (tdm.phase === 'active' && tdm.elapsed() < elapsed)) tdm.tick(STEP)
}
// A hit as the match applies it: the rules say how much, the hull takes it, a wreck is scored.
function hit({ cars, tdm }: Match, attacker: number, victim: number, amount: number) {
  const dealt = tdm.damage(attacker, victim, amount)
  cars[victim].health = Math.max(0, cars[victim].health - dealt)
  if (cars[victim].alive && cars[victim].health === 0) {
    cars[victim].alive = false
    tdm.kill(victim, attacker)
  }
  return dealt
}
const wreck = (match: Match, killer: number, victim: number) => hit(match, killer, victim, 1000)
// Back in once the wait is over, as the match does it (`sees`: sight lines; none by default).
function revive({ cars, tdm, starts }: Match, i: number, sees: (enemy: number, at: Point) => boolean = () => false) {
  for (let guard = 0; !tdm.respawnDue(i); guard++) {
    if (guard > 64 * 60) throw new Error(`tdm: car${i} never became ready to respawn`)
    tdm.tick(STEP)
  }
  const start = tdm.pickSpawn(i, sees)
  if (!tdm.respawned(i, start)) return -1
  Object.assign(cars[i], { alive: true, health: 100, position: { ...starts[start] } })
  return start
}
const place = (cars: Member[], at: Record<number, [number, number]>) => {
  for (const [i, [x, z]] of Object.entries(at)) Object.assign(cars[+i].position, { x, z })
}
const teamKills = (cars: Member[], team: number) => cars.reduce((sum, c) => sum + (c.team === team ? c.stats.kills : 0), 0)
// Spawn choice for `who` with the listed machines placed by hand, alive; the rest parked far off, wrecked.
function spawnFor(who: number, at: Record<number, [number, number]>, sees: (enemy: number, at: Point) => boolean = () => false, starts = STARTS) {
  const { cars, tdm } = setup(starts)
  for (const car of cars) Object.assign(car, { alive: false, position: { x: FAR[0], z: FAR[1] } })
  for (const i of Object.keys(at)) cars[+i].alive = true
  place(cars, at)
  cars[who].alive = false
  return tdm.pickSpawn(who, sees)
}

// --- match lifecycle ----------------------------------------------------------------------
{
  const match = setup()
  const { tdm } = match
  check(tdm.phase === 'preMatch', 'starts in pre-match')
  check(tdm.damage(0, 4, 50) === 0, 'no damage in pre-match')
  advance(tdm, TDM.preMatch - STEP)
  check(tdm.phase === 'preMatch' && tdm.remaining() === TDM.duration, "the clock hasn't started before GO")
  advance(tdm, STEP)
  check(tdm.phase === 'active' && drain(tdm).some((e) => e.type === 'phase' && e.phase === 'active'), 'active at GO, with an event')
  advance(tdm, 60)
  near(tdm.remaining(), TDM.duration - 60, 'clock counts down')
  advanceTo(match, TDM.duration - TDM.finalMinute - 1)
  check(!drain(tdm).some((e) => e.type === 'finalMinute'), 'no final minute before 01:00')
  advanceTo(match, TDM.duration - TDM.finalMinute)
  check(drain(tdm).filter((e) => e.type === 'finalMinute').length === 1, 'final minute announced at 01:00')
  wreck(match, 4, 1)
  advanceTo(match, TDM.duration)
  check(!drain(tdm).some((e) => e.type === 'finalMinute'), 'final minute announced once')
  check(tdm.phase === 'complete' && tdm.winner === 1 && !tdm.draw && tdm.overtimeAt < 0, 'more kills at 00:00 wins')
  near(tdm.now, TDM.preMatch + TDM.duration, 'ends exactly at ten minutes')
  check(tdm.damage(5, 2, 50) === 0, 'no damage after the end')
}
{
  // at 1/60 s steps, the game's own rate
  const match = setup()
  while (match.tdm.phase !== 'overtime') match.tdm.tick(1 / 60)
  check(Math.abs(match.tdm.now - (TDM.preMatch + TDM.duration)) < 1 / 60 + 1e-9, 'game-rate clock expires within a step of 10:00')
}
{
  // continuous combat: no kill limit, no reset between deaths
  const match = setup()
  const { cars, tdm } = match
  advanceTo(match, 10)
  for (let k = 0; k < 40; k++) {
    const victim = 4 + (k % 4)
    if (!cars[victim].alive) revive(match, victim)
    wreck(match, k % 4, victim)
  }
  check(tdm.phase === 'active' && tdm.score[0] === 40, 'no kill limit: 40 kills and the match runs on')
  check(cars[0].stats.kills === 10 && cars[4].stats.deaths === 10, 'statistics carry on through the match')
}
{
  const match = setup()
  const { cars, tdm } = match
  advanceTo(match, 100)
  wreck(match, 1, 5)
  wreck(match, 6, 2)
  advanceTo(match, 595)
  wreck(match, 4, 3)
  wreck(match, 0, 7) // 2 : 2, and car7 waits 20 s, into overtime
  advanceTo(match, TDM.duration)
  check(tdm.phase === 'overtime' && tdm.overtimeAt === tdm.now, 'tied at 00:00: overtime')
  check(drain(tdm).some((e) => e.type === 'phase' && e.phase === 'overtime'), 'overtime event')
  near(tdm.contenders[7].respawnAt, tdm.overtimeAt + TDM.respawn.overtime, 'a wait carried into overtime is cut to 5 s')
  check(tdm.score.join() === '2,2' && cars[1].stats.kills === 1, 'overtime keeps the score and statistics')
  advance(tdm, 3)
  check(tdm.phase === 'overtime' && tdm.damage(0, 4, 10) > 0, 'overtime: still fighting')
  cars[1].alive = false
  tdm.kill(1, -1) // a death nobody is credited for
  near(tdm.contenders[1].respawnAt - tdm.now, TDM.respawn.overtime, 'an overtime death waits 5 s')
  check(tdm.phase === 'overtime', 'a death nobody scores leaves overtime running')
  wreck(match, 6, 0)
  check(tdm.phase === 'complete' && tdm.winner === 1 && tdm.score.join() === '2,3', 'the first kill in overtime wins, for either team')
  check(tdm.overtimeAt > 0 && tdm.contenders[1].life === 'destroyed' && tdm.contenders[7].life === 'destroyed', 'the end cancels pending respawns, overtime remembered')
  check(tdm.damage(6, 2, 10) === 0 && !tdm.kill(2, 6), 'nothing scores after the deciding kill')
}
{
  const match = setup()
  const { tdm } = match
  advanceTo(match, TDM.duration)
  check(tdm.phase === 'overtime', '0 : 0 at the buzzer is a tie too')
  advance(tdm, TDM.overtimeCap - STEP)
  check(tdm.phase === 'overtime', 'overtime runs on without a kill')
  advance(tdm, STEP)
  check(tdm.phase === 'complete' && tdm.draw && tdm.winner === -1, 'the safety cap ends a stalled overtime as a draw')
}

// --- team score ----------------------------------------------------------------------------
{
  const match = setup()
  const { cars, tdm } = match
  advanceTo(match, 10)
  drain(tdm)
  wreck(match, 1, 5)
  const [event] = kills(drain(tdm))
  check(tdm.score.join() === '1,0' && cars[1].stats.kills === 1 && cars[5].stats.deaths === 1, "a kill scores for the killer's team")
  check(event?.type === 'kill' && event.team === 0 && event.killer === 1 && event.victim === 5, 'the kill event names the scoring team')
  check(!tdm.kill(5, 1) && tdm.score[0] === 1, 'duplicate kill refused')
  check(tdm.damage(1, 2, 50) === 0 && tdm.damage(2, 2, 50) === 0, 'no damage between teammates, or to yourself')
  cars[3].alive = false
  tdm.kill(3, 2) // forced: a teammate "kill"
  check(tdm.score.join() === '1,0' && cars[2].stats.kills === 0 && cars[3].stats.deaths === 1, "a teammate can't score a kill")
  check(drain(tdm).some((e) => e.type === 'death' && e.victim === 3), 'it is a death nobody is credited for')
  cars[6].alive = false
  tdm.kill(6, -1)
  cars[7].alive = false
  tdm.kill(7, 7)
  check(tdm.score.join() === '1,0' && cars[7].stats.kills === 0, 'deaths with nobody (or yourself) to credit score nothing')
  wreck(match, 4, 0)
  check(tdm.damage(0, 4, 100) === 0, 'a wreck does no damage: no posthumous kills')
  cars[4].alive = false
  tdm.kill(4, 0) // forced: a kill by a wreck
  check(tdm.score.join() === '1,1' && cars[0].stats.kills === 0, 'a wreck scores no kill')
  check(teamKills(cars, 0) === tdm.score[0] && teamKills(cars, 1) === tdm.score[1], "team score is the sum of its members' kills")
}
{
  const match = setup()
  const { cars, tdm } = match
  advanceTo(match, 10)
  hit(match, 1, 5, 60)
  hit(match, 2, 5, 40)
  check(tdm.score[0] === 1 && cars[1].stats.assists === 1, 'an assist adds nothing to the team score')
  hit(match, 1, 6, 50)
  hit(match, 1, 7, 40)
  check(tdm.score[0] === 1, 'damage adds nothing to the team score')
  near(cars[1].stats.combatScore, (60 + 50 + 40) * TDM.score.damage + TDM.score.assist, 'combat score counts assists and damage')
  check(cars[2].stats.combatScore < cars[1].stats.combatScore && cars[2].stats.kills > cars[1].stats.kills, 'combat score and kills are separate measures')
}

// --- respawn ---------------------------------------------------------------------------------
{
  for (const [elapsed, wait] of [
    [170, 5],
    [179, 5], // 02:59
    [179.984375, 5],
    [181, 10], // 03:01
    [290, 10],
    [299, 10], // 04:59
    [301, 15], // 05:01
    [470, 15],
    [479, 15], // 07:59
    [481, 20], // 08:01
    [590, 20],
  ]) {
    const match = setup()
    advanceTo(match, elapsed)
    wreck(match, 4, 0) // the player's seat
    wreck(match, 1, 6) // and a bot, the same step
    near(match.tdm.contenders[0].respawnAt - match.tdm.now, wait, `death at ${elapsed} s waits ${wait} s`)
    near(match.tdm.contenders[6].respawnAt, match.tdm.contenders[0].respawnAt, `player and bot wait alike at ${elapsed} s`)
    advance(match.tdm, wait + 1) // the wait holds across the phase boundary
    check(match.tdm.respawnDue(0), `respawn due ${wait} s after a death at ${elapsed} s`)
  }
  const match = setup()
  const { tdm } = match
  advanceTo(match, 10)
  wreck(match, 4, 0)
  wreck(match, 5, 1)
  wreck(match, 2, 6)
  advance(tdm, 5 - STEP)
  check(!tdm.respawnDue(0) && !tdm.respawned(0, 8), 'no respawn before the wait is over')
  advance(tdm, STEP)
  check(tdm.respawnDue(0) && tdm.respawnDue(1) && tdm.respawnDue(6), 'the player and the bots of both teams are back the moment the wait ends')
  check(!tdm.respawned(3, 8), "a machine that isn't down can't respawn")
  const start = revive(match, 0)
  check(start >= 0 && tdm.contenders[0].life === 'protected' && !tdm.respawned(0, start), 'respawns once, protected')
  const first = revive(match, 1)
  check(first >= 0 && first !== start, 'machines back in the same step take different starts')
}

// --- spawn protection -----------------------------------------------------------------------
{
  const match = setup()
  const { cars, tdm, tactics } = match
  advanceTo(match, 10)
  wreck(match, 4, 0)
  revive(match, 0)
  near(tdm.damage(4, 0, 50), 50 * (1 - TDM.protection.reduction), 'spawn protection cuts damage to 20 %')
  check(tactics.targetValue(5, 0, 20) === Infinity, "enemy bots don't target a protected machine")
  advance(tdm, TDM.protection.duration)
  check(tdm.contenders[0].life === 'alive', 'protection wears off after 2 s')
  near(tdm.damage(4, 0, 20), 20, 'full damage after protection')
  check(tactics.targetValue(5, 0, 20) < Infinity, 'a target again once protection ends')
  wreck(match, 4, 0)
  revive(match, 0)
  advance(tdm, 0.5)
  tdm.fired(0)
  check(tdm.contenders[0].life === 'alive', 'firing ends protection at once')
  near(tdm.damage(4, 0, 20), 20, 'full damage right after firing')
  tdm.fired(0)
  check(tdm.contenders[0].life === 'alive', 'firing unprotected changes nothing')
  wreck(match, 0, 5)
  revive(match, 5)
  tdm.fired(5)
  check(tdm.contenders[5].life === 'alive', 'bots lose protection by firing too')
  wreck(match, 0, 6)
  revive(match, 6)
  wreck(match, 1, 6)
  check(!cars[6].alive && cars[6].stats.deaths === 2, 'a protected machine can still be wrecked')
}

// --- spawn selection -------------------------------------------------------------------------
{
  const theirBase: Record<number, [number, number]> = { 4: [-5, 100], 5: [5, 100], 6: [-5, 88], 7: [5, 88] }
  check(spawnFor(0, theirBase) < 4, 'with the enemy at home, its own base is the pick')
  const camping: Record<number, [number, number]> = { 4: [-10, -90], 5: [10, -90], 6: [0, -75], 7: [0, -105] }
  const s = spawnFor(0, camping)
  const nearestEnemy = Math.min(...Object.values(camping).map(([x, z]) => Math.hypot(STARTS[s].x - x, STARTS[s].z - z)))
  check(s >= 4 && nearestEnemy >= 60, `enemies camping the base: respawn elsewhere, clear of them (${s}, ${nearestEnemy.toFixed(0)} m)`)
  check(STARTS[s].z <= 0, 'and still on its own half when that half has a safe start')
  const midfield: Record<number, [number, number]> = { 4: [-10, 60], 5: [10, 60], 6: [0, 75], 7: [0, 45] }
  check(spawnFor(0, midfield) < 4, 'once they leave, the base is back in use')
  check(spawnFor(0, camping) === spawnFor(0, camping), 'the same battlefield gives the same start')
  const cluster: Record<number, [number, number]> = { 4: [-110, -60], 5: [-100, -50], 6: [-95, -70], 7: [-105, -80] }
  const c = spawnFor(0, cluster)
  check(Object.values(cluster).every(([x, z]) => Math.hypot(STARTS[c].x - x, STARTS[c].z - z) >= 60), 'away from an enemy cluster')
  // two starts mirrored across the map's axis: the terms decide between them
  const pair: Point[] = [
    { x: -60, z: -100 },
    { x: 60, z: -100 },
  ]
  const centre: Record<number, [number, number]> = { 4: [-10, 0], 5: [10, 0], 6: [0, 10], 7: [0, -10] }
  check(spawnFor(0, centre, undefined, pair) === 0, 'mirrored starts: a tie goes to the lower index')
  check(spawnFor(0, centre, (_, at) => at === pair[0], pair) === 1, 'a start in enemy line of sight loses to one out of it')
  const rammer: Record<number, [number, number]> = { 4: [0, -80], 5: [-5, 100], 6: [5, 100], 7: [0, 88] }
  const r = spawnFor(0, rammer)
  check(r >= 4 && Math.hypot(STARTS[r].x, STARTS[r].z + 80) >= TDM.spawn.ramRange, 'never within ramming range of an enemy while another start is clear')
  // every start dangerous: a lone enemy within ramming range of each of three
  const tight: Point[] = [
    { x: 0, z: -100 },
    { x: 50, z: -100 },
    { x: -50, z: -100 },
  ]
  check(spawnFor(0, { 4: [0, -90], 5: [50, -90], 6: [-50, -90], 7: [0, 90] }, undefined, tight) >= 0, 'every start dangerous still gives one')
  const enemiesSouth: Record<number, [number, number]> = { 4: [0, 90], 5: [0, 95], 6: [0, 100], 7: [0, 105] }
  check(spawnFor(0, { ...enemiesSouth, 1: [60, -70] }, undefined, pair) === 1, 'a teammate nearby makes a start better')
  const halves: Point[] = [
    { x: 0, z: -50 },
    { x: 0, z: 50 },
  ]
  const flanks: Record<number, [number, number]> = { 1: [100, 0], 2: [-100, 0], 4: [100, 5], 5: [-100, 5], 6: [100, -5], 7: [-100, -5] }
  check(spawnFor(0, flanks, undefined, halves) === 0 && spawnFor(4, flanks, undefined, halves) === 1, 'each team leans to its own half')
}
{
  // recent wrecks near a start push respawns off it, for pressureMemory seconds
  const pair: Point[] = [
    { x: -60, z: -100 },
    { x: 60, z: -100 },
  ]
  const match = setup(pair)
  const { cars, tdm } = match
  advanceTo(match, 10)
  place(cars, { 0: FAR, 1: [-60, -70], 2: FAR, 3: FAR, 4: [0, 90], 5: [0, 95], 6: [0, 100], 7: [0, 105] })
  wreck(match, 4, 1)
  cars[0].alive = false
  check(tdm.pickSpawn(0, () => false) === 1, 'a start where a machine was just wrecked is avoided')
  advance(tdm, TDM.spawn.pressureMemory + 1)
  check(tdm.pickSpawn(0, () => false) === 0, 'the pressure fades')
}

// --- assists ---------------------------------------------------------------------------------
{
  const match = setup()
  const { cars, tdm } = match
  advanceTo(match, 10)
  drain(tdm)
  hit(match, 1, 5, 60)
  hit(match, 2, 5, 10)
  hit(match, 3, 5, 30)
  const [first] = kills(drain(tdm))
  check(first?.type === 'kill' && first.killer === 3 && first.assists.join() === '1', 'assist to a big contributor, not the killer or a scratch')
  check(cars[1].stats.assists === 1 && cars[2].stats.assists === 0 && cars[3].stats.assists === 0, 'insufficient damage gives no assist')
  hit(match, 0, 6, 25)
  hit(match, 1, 6, 25)
  hit(match, 2, 6, 50)
  const [shared] = kills(drain(tdm))
  check(shared?.type === 'kill' && shared.assists.join() === '0,1' && cars[1].stats.assists === 2, 'every big contributor gets one assist')
  hit(match, 1, 7, 40)
  advance(tdm, TDM.assist.window + 1)
  wreck(match, 2, 7)
  check(cars[1].stats.assists === 2, 'damage older than the window gives no assist')
  revive(match, 5)
  advance(tdm, TDM.protection.duration)
  hit(match, 1, 5, 10) // new life: car1's 60 from before must not count
  wreck(match, 2, 5)
  check(cars[1].stats.assists === 2, "damage doesn't carry across a respawn")
  check(tdm.score[0] === 4 && teamKills(cars, 0) === 4, 'assists never reach the team score')
}

// --- streaks, multi-kills, revenge --------------------------------------------------------------
{
  const match = setup()
  const { cars, tdm } = match
  advanceTo(match, 10)
  drain(tdm)
  wreck(match, 1, 4)
  advance(tdm, 3)
  wreck(match, 1, 5)
  const second = kills(drain(tdm))[0]
  check(second.type === 'kill' && second.multi === 2 && cars[1].stats.multiKills === 1, 'double kill inside the window')
  advance(tdm, TDM.multiKill.window + 1)
  wreck(match, 1, 6)
  const third = kills(drain(tdm))[0]
  check(third.type === 'kill' && third.multi === 1, 'the chain resets after the window')
  check(third.type === 'kill' && third.streak === 3 && third.milestone === TDM.streaks[0].title, 'killing spree at three')
  near(tdm.damage(1, 7, 20), 20, 'a streak is no damage buff')
  wreck(match, 7, 1)
  const ended = kills(drain(tdm))[0]
  check(cars[1].stats.streak === 0 && cars[1].stats.bestStreak === 3, 'a death resets the streak, the best is kept')
  check(ended.type === 'kill' && ended.shutdown === 3, 'ending a spree is a shutdown')
  near(cars[1].stats.combatScore, 3 * TDM.score.kill + TDM.score.multiKill + TDM.score.streak + 320 * TDM.score.damage, 'combat score formula')
  revive(match, 1)
  advance(tdm, TDM.protection.duration)
  wreck(match, 1, 7)
  const payback = kills(drain(tdm))[0]
  check(payback.type === 'kill' && payback.revenge && cars[1].stats.revengeKills === 1, 'revenge on your killer')
}
{
  // every milestone once, in order, over a ten-kill streak
  const match = setup()
  const { cars, tdm } = match
  advanceTo(match, 10)
  const called: string[] = []
  for (let k = 0; k < 10; k++) {
    const victim = 4 + (k % 4)
    if (!cars[victim].alive) revive(match, victim)
    advance(tdm, TDM.protection.duration)
    drain(tdm)
    wreck(match, 1, victim)
    const e = kills(drain(tdm))[0]
    if (e.type === 'kill' && e.milestone) called.push(`${e.streak} ${e.milestone}`)
  }
  check(called.join() === '3 Killing spree,5 Rampage,7 Unstoppable,10 Godlike', `streak milestones once each (${called.join()})`)
  check([1, 2, 3, 4, 5, 8].map(multiKillTitle).join() === ',Double kill,Triple kill,Quad kill,Overkill,Overkill', 'multi-kill titles')
}

// --- MVP -------------------------------------------------------------------------------------
{
  // The winning team out-kills; a losing-team member with no kills out-scores everyone.
  const match = setup()
  const { cars, tdm } = match
  advanceTo(match, 10)
  wreck(match, 5, 0)
  wreck(match, 6, 1)
  hit(match, 2, 4, 90)
  hit(match, 3, 4, 10) // car3 finishes it: car2's assist
  hit(match, 2, 7, 90)
  hit(match, 2, 5, 90)
  advanceTo(match, TDM.duration)
  check(tdm.phase === 'complete' && tdm.winner === 1 && tdm.score.join() === '1,2', 'the red team wins on kills')
  check(tdm.mvp === 2 && cars[2].stats.kills === 0 && cars[2].team !== tdm.winner, `a losing-team machine with no kills can be MVP (${tdm.mvp})`)
  const most = (key: 'kills' | 'damageDealt') => Math.max(...cars.map((c) => c.stats[key]))
  check(cars[tdm.mvp].stats.damageDealt === most('damageDealt') && cars[tdm.mvp].stats.kills < most('kills'), 'the top damage dealer is MVP, the top killer is not')
  check(tdm.standings()[0] === tdm.mvp, 'MVP is the top of the combat-score order')
}
{
  // Assists count: four assists with real damage beat two kills.
  const match = setup()
  const { cars, tdm } = match
  advanceTo(match, 10)
  for (const victim of [4, 5, 6, 7]) {
    hit(match, 1, victim, 60)
    hit(match, victim === 4 || victim === 5 ? 2 : 3, victim, 40)
  }
  advanceTo(match, TDM.duration)
  check(tdm.mvp === 1 && cars[1].stats.kills === 0 && cars[1].stats.assists === 4, `a high-assist machine can be MVP (${tdm.mvp})`)
}
{
  // Nobody did anything: no MVP at all, rather than the first in the line-up.
  const match = setup()
  const { tdm } = match
  advanceTo(match, TDM.duration)
  advance(tdm, TDM.overtimeCap)
  check(tdm.phase === 'complete' && tdm.mvp === -1, 'nobody scored anything: no MVP')
}
{
  // Tie-breaks: combat score, then kills, assists, fewer deaths, line-up order. Team score plays no part.
  const { cars, tdm } = setup()
  const set = (i: number, score: number, kills: number, assists: number, deaths: number) => Object.assign(cars[i].stats, { combatScore: score, kills, assists, deaths })
  set(1, 500, 3, 1, 2)
  set(6, 500, 4, 1, 2)
  check(tdm.standings()[0] === 6, 'equal score: more kills')
  set(6, 500, 3, 2, 2)
  check(tdm.standings()[0] === 6, 'then more assists')
  set(6, 500, 3, 1, 3)
  check(tdm.standings()[0] === 1, 'then fewer deaths')
  set(6, 500, 3, 1, 2)
  check(tdm.standings()[0] === 1, 'then line-up order')
  tdm.score[1] = 50
  check(tdm.standings()[0] === 1, 'team score never moves the MVP')
  set(6, 500.5, 0, 0, 9)
  check(tdm.standings()[0] === 6, 'combat score comes first')
}
{
  // An empty seat (a custom room's): out of play quietly, left out of the
  // standings and of spawn choice; taken, due back at once.
  const match = setup()
  const { cars, tdm } = match
  advanceTo(match, 10)
  Object.assign(cars[6].stats, { combatScore: 900 })
  check(tdm.leave(6) && tdm.contenders[6].life === 'absent' && cars[6].stats.deaths === 0 && !drain(tdm).some((e) => e.type === 'kill' || e.type === 'death'), 'an empty seat leaves quietly')
  check(!tdm.standings().includes(6) && tdm.standings().length === 7 && !tdm.respawnDue(6), 'out of the standings, never due back by itself')
  for (const car of cars) Object.assign(car, { alive: false, position: { x: FAR[0], z: FAR[1] } })
  place(cars, { 6: [STARTS[0].x, STARTS[0].z] }) // on team 0's best start
  check(tdm.pickSpawn(0, () => false) === 0, 'where it stands blocks no start')
  check(tdm.enter(6) && tdm.contenders[6].life === 'pending' && tdm.respawnDue(6), 'taken: due back at once')
}

// --- friendly fire, team kills, a custom lobby's settings ---------------------------------------
const friendly = { ...classic('tdm'), friendlyFire: true }
{
  // On: a teammate's hit hurts — the victim's damage taken, never the shooter's damage, score or assist.
  const match = setup(STARTS, friendly)
  const { cars, tdm } = match
  advanceTo(match, 10)
  check(tdm.damage(1, 1, 20) === 0, 'never your own machine, friendly fire or not')
  near(hit(match, 1, 2, 30), 30, 'friendly fire on: a teammate takes the hit')
  check(cars[2].stats.damageTaken === 30 && cars[1].stats.damageDealt === 0 && cars[1].stats.combatScore === 0 && tdm.contenders[2].hitDamage[1] === 0, 'the victim’s damage taken; never the shooter’s damage, score or share in an assist')
  const before = { ...cars[1].stats }
  drain(tdm)
  wreck(match, 1, 2)
  const events = drain(tdm)
  check(tdm.score.join() === '-1,0', 'a team kill takes a point off the killer’s team, below zero if need be')
  check(cars[1].stats.kills === before.kills && cars[1].stats.deaths === before.deaths && cars[1].stats.combatScore === before.combatScore && cars[1].stats.teamKills === 1, 'no personal penalty: kills, deaths and score as they were, the team kill counted apart')
  check(cars[2].stats.deaths === 1 && events.some((e) => e.type === 'teamkill' && e.killer === 1 && e.victim === 2 && e.team === 0), 'the victim’s death counts; the feed hears of it')
}
{
  // A team kill in overtime separates the scores: the other team wins.
  const match = setup(STARTS, friendly)
  const { tdm } = match
  advanceTo(match, TDM.duration)
  check(tdm.phase === 'overtime', '0 : 0 at the buzzer: overtime')
  wreck(match, 1, 2)
  check(tdm.phase === 'complete' && tdm.winner === 1 && tdm.score.join() === '-1,0', 'a team kill in overtime hands the match to the other team')
}
{
  // Kill limit: the first team to it wins at once; a slow respawn waits half as long again.
  const match = setup(STARTS, { ...classic('tdm'), killLimit: 2, respawn: 'slow' })
  const { tdm } = match
  advanceTo(match, 10)
  wreck(match, 1, 4)
  near(tdm.contenders[4].respawnAt - tdm.now, 7.5, 'slow: the first band’s 5 s half as long again')
  check(tdm.phase === 'active', 'one short of the limit: the match runs on')
  wreck(match, 2, 5)
  check(tdm.phase === 'complete' && tdm.winner === 0, 'the first team to the kill limit wins at once')
}
{
  // Friendly fire on, a bot holds its trigger with a teammate near its line of fire, or near where its rocket would burst.
  const fake = (id: number, team: number, x: number, z: number, rocket = false) =>
    ({ id, team, alive: true, position: { x, y: 0, z }, control: { aim: { x: 0, y: 1, z: 40 } }, weapon: { spec: { rocket: rocket ? { blast: 8 } : undefined } } }) as unknown as Agent
  const bot = fake(1, 0, 0, 0)
  const mate = fake(2, 0, 2, 20)
  const enemy = fake(5, 1, 0, 40)
  check(!clearOfMates(bot, [bot, mate, enemy]), 'a teammate 2 m off the line of fire: hold')
  mate.position.x = 5
  check(clearOfMates(bot, [bot, mate, enemy]), 'five metres off: clear')
  mate.alive = false
  mate.position.x = 0
  check(clearOfMates(bot, [bot, mate, enemy]), 'a wreck in the way: clear (it takes no damage)')
  const pod = fake(3, 0, 0, 0, true)
  const nearTarget = fake(4, 0, 6, 44)
  check(!clearOfMates(pod, [pod, nearTarget, enemy]) && clearOfMates(bot, [bot, nearTarget, enemy]), 'a teammate inside the blast at the aim: the rocket holds, the gun fires')
}

// --- team AI -----------------------------------------------------------------------------------
{
  const match = setup()
  const { cars, tdm, tactics } = match
  advanceTo(match, 10)
  place(cars, { 0: [-200, -200], 1: [0, 0], 2: [10, 0], 3: [-10, 0], 4: [0, 40], 5: [5, 50], 6: [-5, 50], 7: [0, 60] })
  const value = (rival: number, d = 50) => tactics.targetValue(1, rival, d)
  check(value(2, 10) === Infinity && value(1, 0) === Infinity, 'teammates are never targets')
  near(value(4, 40), 40, 'a healthy enemy in its group: its distance')
  hit(match, 5, 2, 10)
  near(value(5), 50 - B.defendBias, 'an enemy attacking a nearby teammate counts nearer')
  cars[6].health = 30
  near(value(6), 50 - B.finishBias, 'a low-hull enemy counts nearer')
  place(cars, { 7: [0, 120] })
  near(value(7), 50 - B.isolatedBias, 'an isolated enemy counts nearer')
  check(value(5) < value(6) && value(6) < value(7) && value(7) < value(4), 'at equal distance: defend > finish > isolated > nearest')
  place(cars, { 2: [100, 0] })
  near(value(5), 50, 'a teammate out of support range pulls no help')
  place(cars, { 2: [10, 0] })
  advance(tdm, B.threatWindow + STEP)
  near(value(5), 50, 'the threat lapses after the window')
  cars[4].alive = false
  check(value(4) === Infinity, 'wrecks are never targets')
  cars[4].alive = true
  // comeback: only behind by the gap, and no numbers change
  cars[5].stats.kills = 3
  tdm.score[1] = B.comebackGap - 1
  near(value(5), 50, 'one kill short of the gap: no comeback weighting')
  tdm.score[1] = B.comebackGap
  near(value(5), 50 - B.comeback.leaderBias, "behind: the enemy's top scorer counts nearer")
  near(value(7), 50 - B.isolatedBias * B.comeback.isolated, 'behind: isolated enemies count nearer still')
  near(tactics.targetValue(5, 1, 50), 50, 'the leading team gets no comeback weighting')
  check(cars.every((c) => c.maxHealth === 100) && tdm.damage(1, 4, 20) === 20, 'comeback touches no machine numbers')
}
{
  const match = setup()
  const { cars, tdm, tactics } = match
  advanceTo(match, 10)
  place(cars, { 0: [0, -90], 1: [0, -100], 2: [0, -100], 3: [100, -100], 4: [0, 0], 5: [10, 0], 6: [-10, 0], 7: [100, 100] })
  const hunt = tactics.errand(1, -1)
  check(!!hunt && hunt.x === 0 && hunt.z === 0 && !hunt.urgent, 'nobody in range: head for the most valuable enemy, on a road node')
  const left = tactics.errand(1, 4)
  check(!!left && left.urgent && left.x === -28 && left.z === 0, 'a target in a group, still far: flank it, firing on the way')
  check(tactics.stance(1, 4) === 'flank', 'flank stance')
  const right = tactics.errand(2, 4)
  check(!!right && right.urgent && right.x === 28, 'teammates split round both flanks')
  check(tactics.errand(1, 7) === null && tactics.stance(1, 7) === 'attack', 'a lone target: straight at it')
  hit(match, 7, 0, 10)
  check(tactics.stance(1, 7) === 'support', "going for a teammate's attacker: support")
  place(cars, { 1: [0, -40] })
  check(tactics.errand(1, 4) === null, 'close in: engage, no flank')
  tdm.score[1] = B.comebackGap
  const regroup = tactics.errand(3, -1)
  check(!!regroup && !regroup.urgent && regroup.x === 0 && regroup.z === -112 && tactics.stance(3, -1) === 'defend', 'behind and alone: regroup with the nearest teammate first')
  check(tactics.stance(2, -1) !== 'defend', 'behind but with the team: hunt')
  tdm.score[1] = 0
  check(tactics.stance(3, -1) !== 'defend', 'level: no regrouping, hunt')
}
{
  // ai.ts pickTarget, on plain combatants
  const fake = (id: number, team: number, x: number, z: number) => ({ id, team, alive: true, position: { x, y: 0, z } }) as unknown as Agent
  const bot = fake(1, 0, 0, 0)
  const mate = fake(2, 0, 5, 0)
  const close = fake(4, 1, 0, 30)
  const far = fake(5, 1, 0, 60)
  const everyone = [bot, mate, close, far]
  const brain = createBrain(1)
  check(pickTarget(bot, brain, everyone) === close, 'the nearest enemy, never the closer teammate')
  provoke(brain, far)
  check(pickTarget(bot, brain, everyone) === far, 'whoever is shooting it comes first')
  const shielded: Plan = { value: (_, rival, d) => (rival === far ? Infinity : d), errand: () => null }
  check(pickTarget(bot, brain, everyone, shielded) === close, 'a protected attacker is skipped even with a grudge')
  close.alive = false
  check(pickTarget(bot, brain, everyone, shielded) === null, 'wrecks and protected machines: no target at all')
  close.alive = true
  brain.grudge = 0
  const defend: Plan = { value: (_, rival, d) => (rival === far ? d - B.defendBias : d), errand: () => null }
  check(pickTarget(bot, brain, everyone, defend) === far, "the plan's value reorders targets")
}

// --- restart, determinism ----------------------------------------------------------------------
{
  const match = setup()
  const { cars, tdm } = match
  advanceTo(match, 100)
  wreck(match, 1, 4)
  hit(match, 5, 2, 50)
  advanceTo(match, TDM.duration)
  tdm.reset(2)
  check(tdm.phase === 'preMatch' && tdm.now === 0 && tdm.score.join() === '0,0' && tdm.events.length === 0 && tdm.winner === -1 && tdm.mvp === -1 && tdm.overtimeAt === -1, 'restart starts over')
  check(cars.every((c) => c.stats.kills === 0 && c.stats.combatScore === 0) && tdm.contenders.every((c) => c.life === 'alive' && c.hitDamage.every((d) => d === 0)), 'restart clears statistics, lives and attribution')
}
{
  const script = () => {
    const match = setup()
    advanceTo(match, 30)
    const picks: number[] = []
    for (let k = 0; k < 12; k++) {
      const victim = 4 + (k % 4)
      if (!match.cars[victim].alive) picks.push(revive(match, victim))
      advance(match.tdm, TDM.protection.duration)
      hit(match, k % 4, victim, 60)
      hit(match, (k + 1) % 4, victim, 60)
    }
    advanceTo(match, TDM.duration)
    return JSON.stringify([match.tdm.score, match.tdm.mvp, picks, match.cars.map((c) => c.stats)])
  }
  check(script() === script(), 'same inputs, same match: score, MVP, spawns, statistics')
}

console.log(`tdm ok (${checks} checks)`)
