// Self-check for the free-for-all rules. Run: node src/game/ffa/ffa.check.ts
// Plain machines on a flat 240 m square, a seeded match, fixed steps of
// 1/64 s (exact in binary, so phase boundaries land on the step).
import { classic, type MatchSettings } from '../matchSettings.ts'
import { createRng } from '../rng.ts'
import { SUPPLY } from '../items/config.ts'
import { chooseErrand, placeWave, weighted, type Item, type Point } from '../items/items.ts'
import { FFA } from './config.ts'
import { createFreeForAll, createStats, multiKillTitle, spotWeight, zoneErrand, type FfaEvent, type FreeForAll, type Participant, type Zone } from './rules.ts'

let checks = 0
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`ffa: ${what}`)
  checks++
}
const near = (a: number, b: number, what: string) => check(Math.abs(a - b) < 1e-6, `${what} (${a} vs ${b})`)

const STEP = 1 / 64
// 16 starts round the edge, spots on a 30 m grid well inside, three zones.
const STARTS: Point[] = []
for (const along of [-90, -30, 30, 90]) STARTS.push({ x: along, z: 120 }, { x: along, z: -120 }, { x: 120, z: along }, { x: -120, z: along })
const SPOTS: Point[] = []
for (let x = -60; x <= 60; x += 30) for (let z = -60; z <= 60; z += 30) SPOTS.push({ x, z })
const ZONES: Zone[] = [
  { name: 'Middle', x: 0, z: 0, radius: 35 },
  { name: 'North', x: 0, z: -60, radius: 35 },
  { name: 'South', x: 0, z: 60, radius: 35 },
]

const car = (name: string, at: Point): Participant => ({ name, alive: true, health: 100, maxHealth: 100, position: { ...at }, weapon: { ammo: 60, reload: 0, spec: { magazine: 60 } }, stats: createStats() })
const machine = (i: number) => car(`car${i}`, STARTS[i])

function setup(seed = 42, settings: MatchSettings = classic('ffa')) {
  const cars = Array.from({ length: FFA.grid }, (_, i) => machine(i))
  const ffa = createFreeForAll(cars, { starts: STARTS, spots: SPOTS, zones: ZONES, seed, settings })
  return { cars, ffa }
}

type Match = ReturnType<typeof setup>

const drain = (ffa: FreeForAll) => ffa.events.splice(0)
// Runs whole steps for `seconds` of match clock.
function advance(ffa: FreeForAll, seconds: number) {
  for (let k = Math.round(seconds / STEP); k > 0; k--) ffa.tick(STEP)
}
// Runs until the elapsed clock (time since the start signal) reaches `elapsed`.
function advanceTo({ ffa }: Match, elapsed: number) {
  while (ffa.phase === 'preMatch' || (ffa.elapsed() < elapsed && ffa.phase !== 'complete' && ffa.phase !== 'overtime')) ffa.tick(STEP)
}
// A hit as the match applies it: the rules say how much, the hull takes it, a wreck is scored.
function hit({ cars, ffa }: Match, attacker: number, victim: number, amount: number) {
  const dealt = ffa.damage(attacker, victim, amount)
  cars[victim].health = Math.max(0, cars[victim].health - dealt)
  if (cars[victim].alive && cars[victim].health === 0) {
    cars[victim].alive = false
    ffa.kill(victim, attacker)
  }
  return dealt
}
const wreck = (match: Match, killer: number, victim: number) => hit(match, killer, victim, 1000)
// Back in once the wait is over, as the match does it (no sight lines here).
function revive({ cars, ffa }: Match, i: number) {
  for (let guard = 0; !ffa.respawnDue(i); guard++) {
    if (guard > 64 * 60) throw new Error(`ffa: car${i} never became ready to respawn`)
    ffa.tick(STEP)
  }
  const start = ffa.pickSpawn(i, () => false)
  if (!ffa.respawned(i, start)) return -1
  Object.assign(cars[i], { alive: true, health: 100, position: { ...STARTS[start] } })
  return start
}
const kills = (events: FfaEvent[]) => events.filter((e) => e.type === 'kill').reverse() // latest first
const item = (ffa: FreeForAll, type: Item['type'], at: Point): Item => {
  const it: Item = { id: 1000 + ffa.supply.items.length, type, rarity: 'common', x: at.x, z: at.z, spot: -1, born: ffa.now, expires: ffa.now + 50, state: 'spawned', hot: false }
  ffa.supply.items.push(it)
  return it
}

// --- match ------------------------------------------------------------------------
{
  const match = setup()
  const { ffa } = match
  check(ffa.phase === 'preMatch', 'starts in pre-match')
  check(ffa.damage(1, 2, 50) === 0, 'no damage in pre-match')
  check(ffa.remaining() === FFA.duration, 'clock full in pre-match')
  advance(ffa, FFA.preMatch)
  check(ffa.phase === 'active', 'active after the countdown')
  check(drain(ffa).some((e) => e.type === 'phase' && e.phase === 'active'), 'match-started event')
  advance(ffa, 60)
  near(ffa.remaining(), FFA.duration - 60, 'clock counts down')
  advanceTo(match, FFA.duration - FFA.finalMinute)
  check(ffa.phase === 'finalMinute', 'final minute at 01:00')
  wreck(match, 1, 2)
  advanceTo(match, FFA.duration)
  check(ffa.phase === 'complete' && ffa.winner === 1 && !ffa.draw, 'sole leader wins at 00:00')
  near(ffa.now, FFA.preMatch + FFA.duration, 'ends exactly at ten minutes')
  check(ffa.damage(3, 4, 50) === 0, 'no damage after the end')
}
{
  // at 1/60 s steps, the game's own rate
  const match = setup()
  while (match.ffa.phase !== 'overtime') match.ffa.tick(1 / 60)
  check(Math.abs(match.ffa.now - (FFA.preMatch + FFA.duration)) < 1 / 60 + 1e-9, 'game-rate clock expires within a step of 10:00')
}
{
  const match = setup()
  const { ffa } = match
  advanceTo(match, 100)
  wreck(match, 1, 3)
  wreck(match, 2, 4)
  advanceTo(match, 595)
  wreck(match, 5, 6) // three-way tie; car6 waits 20 s, into overtime
  advanceTo(match, FFA.duration)
  check(ffa.phase === 'overtime', 'tie at 00:00 goes to overtime')
  near(ffa.contenders[6].respawnAt, ffa.overtimeAt + FFA.respawn.overtime, 'wait carried into overtime is cut')
  wreck(match, 7, 0) // car7 only joins the tie
  check(ffa.phase === 'overtime', "a kill that only joins the tie doesn't end overtime")
  near(ffa.contenders[0].respawnAt - ffa.now, FFA.respawn.overtime, 'overtime death waits the overtime respawn')
  wreck(match, 1, 7)
  check(ffa.phase === 'complete' && ffa.winner === 1, 'first deciding kill in overtime wins')
  check(ffa.damage(2, 1, 10) === 0, 'nothing scores after the deciding kill')
  check(ffa.contenders[0].life === 'destroyed' && ffa.contenders[6].life === 'destroyed', 'the end cancels pending respawns')
  check(ffa.place(1) === 1 && ffa.place(2) > 1, 'the winner places first')
}
{
  const match = setup()
  const { ffa } = match
  advanceTo(match, FFA.duration)
  check(ffa.phase === 'overtime', 'nobody scoring is a tie too')
  advance(ffa, FFA.overtime)
  check(ffa.phase === 'complete' && ffa.draw && ffa.winner === -1, 'overtime running out is a draw')
  check(ffa.place(3) === 1, 'a draw shares first place')
}
{
  // The spec's overtime cases: only a kill that leaves one machine alone on top ends it.
  const tiedAtBuzzer = (top: number[]) => {
    const match = setup()
    advanceTo(match, 10)
    top.forEach((kills, i) => (match.cars[i].stats.kills = kills))
    advanceTo(match, FFA.duration)
    return match
  }
  let match = tiedAtBuzzer([10, 10, 8])
  wreck(match, 2, 3) // C 9: A and B still tied
  check(match.ffa.phase === 'overtime', 'a kill that leaves the top still tied keeps overtime going')
  wreck(match, 0, 2) // A 11
  check(match.ffa.phase === 'complete' && match.ffa.winner === 0, 'A 10 · B 10 · C 8: A takes it with the next kill')
  match = tiedAtBuzzer([10, 10, 10])
  wreck(match, 2, 3) // C 11
  check(match.ffa.phase === 'complete' && match.ffa.winner === 2, 'A 10 · B 10 · C 10: C takes it with the next kill')
}

// --- kills ------------------------------------------------------------------------
{
  const match = setup()
  const { cars, ffa } = match
  advanceTo(match, 10)
  drain(ffa)
  wreck(match, 1, 2)
  check(cars[1].stats.kills === 1 && cars[2].stats.deaths === 1, 'kill scores the killer and the victim')
  check(!ffa.kill(2, 1) && cars[1].stats.kills === 1 && cars[2].stats.deaths === 1, 'duplicate kill refused')
  check(kills(drain(ffa)).length === 1, 'one kill event')
  cars[3].alive = false
  ffa.kill(3, 3)
  check(cars[3].stats.deaths === 1 && cars[3].stats.kills === 0, 'self-inflicted death scores no kill')
  check(ffa.damage(2, 4, 50) === 0, 'a destroyed machine does no damage')
  check(ffa.contenders[2].life === 'pending', 'a wreck waits to respawn')
  check(ffa.standings()[0] === 1, 'standings lead with the killer')
}

// --- assists --------------------------------------------------------------------------
{
  const match = setup()
  const { cars, ffa } = match
  advanceTo(match, 10)
  hit(match, 1, 3, 60)
  hit(match, 4, 3, 10)
  drain(ffa)
  hit(match, 2, 3, 50)
  const [event] = kills(drain(ffa))
  check(event?.type === 'kill' && event.killer === 2 && event.assists.join() === '1', 'assist to a big contributor, not the killer or a scratch')
  near(cars[2].stats.damageDealt, 30, 'damage dealt counts only the hull left')
  near(cars[3].stats.damageTaken, 100, 'damage taken is the whole hull')
  check(cars[1].stats.assists === 1 && cars[4].stats.assists === 0 && cars[2].stats.assists === 0, 'assist counts')
  hit(match, 5, 6, 30)
  advance(ffa, FFA.assist.window + 1)
  wreck(match, 7, 6)
  check(cars[5].stats.assists === 0, 'old damage outside the window gives no assist')
  revive(match, 3)
  hit(match, 1, 3, 10) // new life: car1's 60 from before must not count
  wreck(match, 2, 3)
  check(cars[1].stats.assists === 1, "stale damage doesn't leak across a respawn")
}

// --- streaks, multi-kills --------------------------------------------------------------------
{
  const match = setup()
  const { cars, ffa } = match
  advanceTo(match, 10)
  drain(ffa)
  wreck(match, 1, 2)
  advance(ffa, 3)
  wreck(match, 1, 3)
  const second = kills(drain(ffa))[0]
  check(second.type === 'kill' && second.multi === 2 && cars[1].stats.multiKills === 1, 'double kill inside the window')
  advance(ffa, FFA.multiKill.window + 1)
  wreck(match, 1, 4)
  const third = kills(drain(ffa))[0]
  check(third.type === 'kill' && third.multi === 1, 'multi-kill chain resets after the window')
  check(third.type === 'kill' && third.streak === 3 && third.milestone === FFA.streaks[0].title, 'killing spree at three')
  wreck(match, 5, 1)
  const death = kills(drain(ffa))[0]
  check(cars[1].stats.streak === 0 && cars[1].stats.bestStreak === 3, 'streak resets on death, best kept')
  check(death.type === 'kill' && death.shutdown === 3, 'ending a spree is a shutdown')
  near(cars[1].stats.combatScore, 3 * FFA.score.kill + FFA.score.multiKill + FFA.score.streak + 300 * FFA.score.damage, 'combat score formula')
}
{
  // Every milestone once, in order, over a ten-kill streak; the callout ladder.
  const match = setup()
  const { cars, ffa } = match
  advanceTo(match, 10)
  const called: string[] = []
  for (let k = 0; k < 10; k++) {
    const victim = 2 + (k % 6)
    if (!cars[victim].alive) revive(match, victim)
    drain(ffa)
    wreck(match, 1, victim)
    const e = kills(drain(ffa))[0]
    if (e.type === 'kill' && e.milestone) called.push(`${e.streak} ${e.milestone}`)
  }
  check(called.join() === '3 Killing spree,5 Rampage,7 Unstoppable,10 Godlike', `streak milestones once each (${called.join()})`)
  check([1, 2, 3, 4, 5, 8].map(multiKillTitle).join() === ',Double kill,Triple kill,Quad kill,Overkill,Overkill', 'multi-kill titles')
}

// --- revenge, nemesis ----------------------------------------------------------------------
{
  const match = setup()
  const { cars, ffa } = match
  advanceTo(match, 10)
  wreck(match, 2, 1)
  revive(match, 1)
  advance(ffa, FFA.protection.duration)
  drain(ffa)
  wreck(match, 1, 3)
  check(!(kills(drain(ffa))[0] as { revenge: boolean }).revenge, 'no revenge on a machine that never killed you')
  wreck(match, 1, 2)
  check((kills(drain(ffa))[0] as { revenge: boolean }).revenge && cars[1].stats.revengeKills === 1, 'revenge on your killer')
  for (let k = 0; k < FFA.nemesis; k++) {
    if (k) revive(match, 5)
    advance(ffa, FFA.protection.duration)
    wreck(match, 4, 5)
  }
  const events = drain(ffa)
  check(events.some((e) => e.type === 'nemesis' && e.who === 4 && e.of === 5) && ffa.nemesisOf(5) === 4, 'nemesis after three unanswered kills')
  check(cars[5].stats.nemesisDeaths === 1, 'death to a nemesis counted')
  revive(match, 5)
  advance(ffa, FFA.protection.duration)
  wreck(match, 5, 4)
  const payback = kills(drain(ffa))[0]
  check(payback.type === 'kill' && payback.revenge && payback.nemesis && ffa.nemesisOf(5) === -1, 'killing your nemesis is revenge and ends it')
}

// --- respawn ----------------------------------------------------------------------------
{
  for (const [elapsed, wait] of [
    [170, 5],
    [179, 5], // 02:59
    [179.984375, 5],
    [181, 10], // 03:01
    [190, 10],
    [290, 10],
    [299, 10], // 04:59
    [301, 15], // 05:01
    [310, 15],
    [470, 15],
    [479, 15], // 07:59
    [481, 20], // 08:01
    [490, 20],
  ]) {
    const match = setup()
    advanceTo(match, elapsed)
    wreck(match, 1, 2)
    near(match.ffa.contenders[2].respawnAt - match.ffa.now, wait, `death at ${elapsed} s waits ${wait} s`)
    advance(match.ffa, wait + 1) // the wait holds across the phase boundary
    check(match.ffa.respawnDue(2), `respawn due ${wait} s after a death at ${elapsed} s`)
  }
  const match = setup()
  const { ffa } = match
  advanceTo(match, 10)
  wreck(match, 1, 0)
  wreck(match, 3, 2)
  advance(ffa, 5 - STEP)
  check(!ffa.respawnDue(0) && !ffa.respawned(0, 0), 'no respawn before the wait is over')
  advance(ffa, STEP)
  check(ffa.respawnDue(0) && ffa.respawnDue(2), 'the player and the bots respawn the moment the wait ends')
  check(!ffa.respawned(4, 0), "a machine that isn't down can't respawn")
  const start = revive(match, 2)
  check(start >= 0 && ffa.contenders[2].life === 'protected' && !ffa.respawned(2, start), 'respawns once')
  near(ffa.damage(1, 2, 50), 50 * (1 - FFA.protection.reduction), 'spawn protection cuts damage')
  advance(ffa, FFA.protection.duration)
  check(ffa.contenders[2].life === 'alive', 'protection wears off')
  near(ffa.damage(1, 2, 20), 20, 'full damage after protection')
  check(ffa.damage(1, 1, 20) === 0, "a machine's own rocket never hurts it")
}
{
  // Protection and armor: the stronger reduction, never both; a death clears both.
  const match = setup()
  const { cars, ffa } = match
  advanceTo(match, 10)
  wreck(match, 1, 2)
  revive(match, 2)
  item(ffa, 'armor', cars[2].position)
  ffa.tick(STEP)
  near(ffa.damage(1, 2, 50), 50 * (1 - FFA.protection.reduction), 'protection with armor: the stronger reduction, not both')
  wreck(match, 1, 2)
  const c = ffa.contenders[2]
  check(c.protectedUntil === 0 && Object.values(ffa.supply.effects[2]).every((until) => until === 0), 'a death clears protection and armor')
  revive(match, 2)
  advance(ffa, FFA.protection.duration)
  near(ffa.damage(1, 2, 20), 20, 'the next life takes full damage once its protection ends')
}
{
  // Spawn choice on hand-placed starts; participant 0 is the one respawning.
  const pick = (starts: Point[], rivals: Point[], sees: (rival: number, at: Point) => boolean = () => false) => {
    const cars = [car('me', { x: 999, z: 999 }), ...rivals.map((at, i) => car(`rival${i}`, at))]
    return createFreeForAll(cars, { starts, spots: [], zones: [], seed: 1, settings: classic('ffa') }).pickSpawn(0, sees)
  }
  const line = [{ x: -100, z: 0 }, { x: 0, z: 0 }, { x: 100, z: 0 }]
  check(pick(line, [{ x: 90, z: 10 }, { x: 110, z: -10 }]) === 0, 'start away from the rivals')
  check(pick(line, [{ x: 90, z: 10 }, { x: -100, z: 3 }]) === 1, 'occupied start rejected')
  const pair = [{ x: 0, z: 0 }, { x: 100, z: 0 }]
  check(pick(pair, [{ x: 50, z: 80 }], (_, at) => at === pair[0]) === 1, 'a start in a line of fire loses')
  // Farthest isn't always safest: 100 m but watched vs 70 m out of sight.
  const choice = [{ x: 100, z: 0 }, { x: 0, z: 70 }]
  check(pick(choice, [{ x: 0, z: 0 }], (_, at) => at === choice[0]) === 1, 'a closer unwatched start beats a farther watched one')
  check(pick(line, [{ x: -100, z: 0 }, { x: 0, z: 0 }, { x: 100, z: 0 }]) >= 0, 'every start occupied still gives one')
}
{
  // Two machines due back in the same step: the second can't take the first one's start.
  const match = setup()
  advanceTo(match, 10)
  wreck(match, 1, 2)
  wreck(match, 1, 3)
  const first = revive(match, 2)
  check(match.ffa.respawnDue(3), 'both due in the same step')
  const second = revive(match, 3)
  check(first >= 0 && second >= 0 && first !== second, 'simultaneous respawns take different starts')
}
{
  // Spawn camping: two quick deaths after spawning at a start bench it.
  const match = setup()
  const { ffa } = match
  advanceTo(match, 10)
  wreck(match, 1, 2)
  const first = revive(match, 2)
  advance(ffa, 1)
  wreck(match, 1, 2)
  advance(ffa, 20) // past the recent-use penalty
  while (!ffa.respawnDue(2)) ffa.tick(STEP)
  check(ffa.pickSpawn(2, () => false) === first, 'one quick death leaves the start in use')
  revive(match, 2)
  advance(ffa, 1)
  wreck(match, 1, 2)
  advance(ffa, 20)
  while (!ffa.respawnDue(2)) ffa.tick(STEP)
  check(ffa.pickSpawn(2, () => false) !== first, 'a camped start is benched')
}

// --- items ----------------------------------------------------------------------------------
{
  const match = setup()
  const { ffa } = match
  advanceTo(match, SUPPLY.firstWave - 1)
  check(!drain(ffa).some((e) => e.type === 'wave'), 'no wave before 02:00')
  advanceTo(match, SUPPLY.firstWave)
  const first = drain(ffa).find((e) => e.type === 'wave')
  check(!!first && first.type === 'wave' && first.count >= SUPPLY.perWave, 'wave at 02:00')
  check(ffa.supply.items.every((it) => it.expires - it.born >= SUPPLY.ttl[0] && it.expires - it.born <= SUPPLY.ttl[1]), 'items live 45-60 s')
  check(new Set(ffa.supply.items.map((it) => it.spot)).size === ffa.supply.items.length, 'one item per spot')
  advance(ffa, SUPPLY.ttl[1] + STEP)
  const events = drain(ffa)
  check(ffa.supply.items.every((it) => it.born > SUPPLY.firstWave + FFA.preMatch) && events.filter((e) => e.type === 'expired').length >= SUPPLY.perWave, 'unclaimed items expire and leave')
  advanceTo(match, SUPPLY.firstWave + SUPPLY.waveInterval)
  check(drain(ffa).some((e) => e.type === 'wave'), 'next wave two minutes later')
}
{
  const match = setup()
  const { cars, ffa } = match
  advanceTo(match, 10)
  const car = cars[1]
  car.health = 90
  const aid = item(ffa, 'health', car.position)
  ffa.tick(STEP)
  check(car.health === 100 && aid.state === 'consumed' && !ffa.supply.items.includes(aid) && car.stats.itemsCollected === 1, 'health picked up, capped, removed')
  const spare = item(ffa, 'health', car.position)
  ffa.tick(STEP)
  check(spare.state === 'spawned' && ffa.supply.items.includes(spare), 'a full hull leaves health for someone else')
  ffa.supply.items.length = 0
  car.weapon.ammo = 50
  car.weapon.reload = 1
  item(ffa, 'ammo', car.position)
  ffa.tick(STEP)
  check(car.weapon.ammo === 60 && car.weapon.reload === 0 && car.weapon.spec.magazine === 60, 'ammo capped at the magazine, reload cancelled')
  const extra = item(ffa, 'ammo', car.position)
  ffa.tick(STEP)
  check(extra.state === 'spawned' && ffa.supply.items.includes(extra), 'a full magazine leaves ammo')
  ffa.supply.items.length = 0
  item(ffa, 'armor', car.position)
  item(ffa, 'damage', car.position)
  item(ffa, 'speed', car.position)
  ffa.tick(STEP)
  check(ffa.supply.items.length === 0, 'boosts are always taken')
  near(ffa.damage(2, 1, 20), 20 * (1 - SUPPLY.armor.reduction), 'armor cuts damage')
  near(ffa.damage(1, 2, 20), 20 * SUPPLY.damage.factor, 'damage boost multiplies')
  check(ffa.speedFactor(1) === SUPPLY.speed.factor && ffa.speedFactor(2) === 1, 'speed boost only on the holder')
  advance(ffa, 5)
  item(ffa, 'speed', car.position)
  advance(ffa, SUPPLY.speed.duration - 1)
  check(ffa.speedFactor(1) === SUPPLY.speed.factor, 'a second boost restarts the timer')
  advance(ffa, 1 + STEP) // picked up on the first step of the wait
  check(ffa.speedFactor(1) === 1, 'speed boost expires')
  check(car.maxHealth === 100 && car.weapon.spec.magazine === 60 && SUPPLY.speed.factor === 1.3, 'base values untouched')
  car.health = 20
  item(ffa, 'repair', car.position)
  advance(ffa, SUPPLY.repair.duration + 1)
  check(Math.abs(car.health - (20 + SUPPLY.repair.rate * SUPPLY.repair.duration)) <= SUPPLY.repair.rate * STEP + 1e-9, `repair heals rate x duration (${car.health})`)
  car.health = 95
  item(ffa, 'repair', car.position)
  advance(ffa, SUPPLY.repair.duration + 1)
  check(car.health === car.maxHealth, 'repair stops at a full hull')
  item(ffa, 'damage', car.position)
  ffa.tick(STEP)
  wreck(match, 3, 1)
  check(Object.values(ffa.supply.effects[1]).every((until) => until === 0), 'death clears effects')
  const other = cars[4]
  other.health = 50
  const racing = item(ffa, 'health', other.position)
  Object.assign(cars[5].position, other.position)
  cars[5].health = 50
  ffa.tick(STEP)
  check(racing.state === 'consumed' && other.health === 90 && cars[5].health === 50, 'one pickup per item, first in grid order')
}

// --- hot zone, comeback ------------------------------------------------------------------------
{
  const match = setup()
  const { cars, ffa } = match
  advanceTo(match, FFA.hotZone.first)
  const opened = drain(ffa).find((e) => e.type === 'zone')
  check(!!ffa.zone && ZONES.includes(ffa.zone) && !!opened, 'hot zone opens at 01:30 over a known area')
  check(ffa.supply.items.some((it) => it.hot), 'opening drop lands in the zone')
  const first = ffa.zone
  advanceTo(match, FFA.hotZone.first + FFA.hotZone.duration)
  check(ffa.zone !== first && !!ffa.zone, 'the zone moves on when it expires')
  const before = JSON.stringify(cars.map((c) => c.stats))
  advanceTo(match, SUPPLY.firstWave + SUPPLY.waveInterval)
  check(JSON.stringify(cars.map((c) => c.stats)) === before, 'waves and zones touch no statistics')
  cars[1].stats.kills = FFA.comeback.gap - 1
  check(!ffa.trailing(0), 'one kill short of the gap is not trailing')
  cars[1].stats.kills = FFA.comeback.gap
  check(ffa.trailing(0) && !ffa.trailing(1), 'trailing at the gap, the leader never')
}
{
  // Weighting, over many seeded waves: the zone and trailing machines pull items in.
  const random = createRng(7)
  const zone = ZONES[0]
  let inZone = 0
  let nearTrailer = 0
  const trailer = { x: 60, z: 60 }
  const trials = 400
  for (let t = 0; t < trials; t++) {
    const [spot] = placeWave(random, { spots: SPOTS, taken: () => false, cars: [], count: 1, weight: spotWeight(zone, []) })
    if (Math.hypot(SPOTS[spot].x - zone.x, SPOTS[spot].z - zone.z) <= zone.radius) inZone++
    const [pull] = placeWave(random, { spots: SPOTS, taken: () => false, cars: [], count: 1, weight: spotWeight(null, [trailer]) })
    if (Math.hypot(SPOTS[pull].x - trailer.x, SPOTS[pull].z - trailer.z) <= FFA.comeback.radius) nearTrailer++
  }
  const zoneShare = SPOTS.filter((s) => Math.hypot(s.x - zone.x, s.z - zone.z) <= zone.radius).length / SPOTS.length
  const trailerShare = SPOTS.filter((s) => Math.hypot(s.x - trailer.x, s.z - trailer.z) <= FFA.comeback.radius).length / SPOTS.length
  check(inZone / trials > zoneShare * 1.5, `hot zone weighting (${inZone}/${trials} vs share ${zoneShare.toFixed(2)})`)
  check(nearTrailer / trials > trailerShare * 1.2, `comeback weighting (${nearTrailer}/${trials} vs share ${trailerShare.toFixed(2)})`)
  const cars = [{ x: 0, z: 0 }]
  const placed = placeWave(random, { spots: SPOTS, taken: () => false, cars, count: 20 })
  check(placed.every((s) => Math.hypot(SPOTS[s].x, SPOTS[s].z) >= SUPPLY.clearOfCars), 'no item beside a live machine')
  check(weighted(random, [0, 0]) === -1 && weighted(random, [0, 5]) === 1, 'weighted pick')
}

// --- bots ------------------------------------------------------------------------------------
{
  const match = setup()
  const { cars, ffa } = match
  advanceTo(match, 10)
  const bot = cars[3]
  Object.assign(bot.position, { x: 0, z: 0 })
  const out = { x: 0, z: 0, urgent: false }
  const far: Item = { id: 1, type: 'damage', rarity: 'epic', x: SUPPLY.senseRange + 5, z: 0, spot: 0, born: 0, expires: 99, state: 'spawned', hot: false }
  check(chooseErrand(bot, [far], SUPPLY.senseRange, out) === null, "bots don't know items past their sense range")
  const close: Item = { ...far, id: 2, type: 'speed', x: 30 }
  check(chooseErrand(bot, [far, close], SUPPLY.senseRange, out)?.x === 30, 'bots head for a useful item they know about')
  bot.health = 20
  const aid: Item = { ...far, id: 3, type: 'health', x: -60 }
  const errand = chooseErrand(bot, [close, aid], SUPPLY.senseRange, out)
  check(errand?.x === -60 && errand.urgent, 'low hull goes for health first, urgently')
  const zone = ZONES[0]
  const zoneSpots = SPOTS.flatMap((spot, i) => (Math.hypot(spot.x - zone.x, spot.z - zone.z) <= zone.radius ? [i] : []))
  const idle = car('idle', { x: 100, z: 100 })
  const patrol = zoneErrand(idle, 2, false, SPOTS, zone, zoneSpots, 0, out)
  const [px, pz] = [patrol?.x, patrol?.z]
  check(!!patrol && !patrol.urgent && zoneSpots.some((i) => SPOTS[i].x === px && SPOTS[i].z === pz), 'a curious bot patrols the hot zone')
  Object.assign(idle.position, { x: px, z: pz })
  const onward = zoneErrand(idle, 2, false, SPOTS, zone, zoneSpots, 0, out)
  check(!!onward && (onward.x !== px || onward.z !== pz), 'on its patrol spot, it moves on')
  check(zoneErrand(idle, 1, false, SPOTS, zone, zoneSpots, 0, out) === null, 'an incurious bot ignores the zone')
  check(zoneErrand(idle, 1, true, SPOTS, zone, zoneSpots, 0, out) !== null, 'a trailing bot always goes')
  wreck(match, 1, 2)
  revive(match, 2)
  check(ffa.targetValue(3, 2, 20) === Infinity, 'protected rivals are not targets')
  advance(ffa, FFA.protection.duration)
  check(ffa.targetValue(3, 1, 40) === 40 - FFA.bots.leaderBias, 'the sole leader looks nearer')
}

// --- cleanup and restart ---------------------------------------------------------------------
{
  const match = setup(9)
  const { cars, ffa } = match
  advanceTo(match, SUPPLY.firstWave)
  wreck(match, 1, 2)
  item(ffa, 'speed', cars[4].position)
  ffa.tick(STEP)
  advanceTo(match, FFA.duration)
  check(ffa.phase === 'complete' && ffa.supply.items.length === 0 && ffa.zone === null, 'the end clears items and the zone')
  check(ffa.contenders.every((c, i) => c.life !== 'pending' && c.life !== 'protected' && Object.values(ffa.supply.effects[i]).every((u) => u === 0) && c.hitDamage.every((d) => d === 0)), 'the end clears respawns, effects, protection and attribution')
  ffa.reset(10)
  check(ffa.phase === 'preMatch' && ffa.now === 0 && ffa.supply.items.length === 0 && ffa.events.length === 0 && ffa.zone === null, 'restart starts over')
  check(cars.every((car) => car.stats.kills === 0 && car.stats.deaths === 0 && car.stats.combatScore === 0) && ffa.contenders.every((c) => c.life === 'alive'), 'restart clears statistics and lives')
  check(ffa.nemesisOf(2) === -1 && ffa.soleLeader() === -1, 'restart clears relationships')
}

// --- a custom lobby's settings ---------------------------------------------------------------------
{
  // Respawn: the waits' bands are shares of the clock (30, 50 and 80 %); fast halves each wait.
  const match = setup(42, { ...classic('ffa'), duration: 300, respawn: 'fast' })
  const { ffa } = match
  check(ffa.remaining() === 300, 'the clock is the settings’ length')
  advanceTo(match, 80) // under 30 % of five minutes
  wreck(match, 1, 2)
  near(ffa.contenders[2].respawnAt - ffa.now, 2.5, 'fast: the first band’s 5 s halved')
  advanceTo(match, 100) // past 30 % of five minutes, under 50 %
  wreck(match, 1, 3)
  near(ffa.contenders[3].respawnAt - ffa.now, 5, 'the bands follow the clock: the second band from 90 s of five minutes')
  const slow = setup(42, { ...classic('ffa'), respawn: 'slow' })
  advanceTo(slow, 10)
  wreck(slow, 1, 2)
  near(slow.ffa.contenders[2].respawnAt - slow.ffa.now, 7.5, 'slow: half as long again')
}
{
  // Kill limit: the first machine to it takes the match at once.
  const match = setup(42, { ...classic('ffa'), killLimit: 3 })
  const { ffa } = match
  advanceTo(match, 10)
  wreck(match, 1, 2)
  wreck(match, 1, 3)
  check(ffa.phase === 'active', 'one short of the limit: the match runs on')
  wreck(match, 1, 4)
  check(ffa.phase === 'complete' && ffa.winner === 1, 'the first to the kill limit wins at once')
}
{
  // Pickups by group: only the groups turned on drop; every one off, no waves and no hot zone.
  const ammo = setup(42, { ...classic('ffa'), items: { health: false, ammo: true, powerups: false } })
  advanceTo(ammo, SUPPLY.firstWave)
  check(ammo.ffa.supply.items.length > 0 && ammo.ffa.supply.items.every((it) => it.type === 'ammo'), 'ammo alone: only ammo drops (the hot zone’s drop too)')
  const bare = setup(42, { ...classic('ffa'), items: { health: false, ammo: false, powerups: false } })
  advanceTo(bare, SUPPLY.firstWave + 10)
  const heard = drain(bare.ffa)
  check(bare.ffa.supply.items.length === 0 && bare.ffa.zone === null && !heard.some((e) => e.type === 'wave' || e.type === 'zone'), 'every pickup off: no waves, no hot zone')
}

// --- determinism --------------------------------------------------------------------------------
{
  const layout = (seed: number) => {
    const match = setup(seed)
    advanceTo(match, SUPPLY.firstWave)
    return match.ffa.supply.items.map((it) => `${it.type}@${it.spot}`).join()
  }
  check(layout(5) === layout(5), 'same seed, same waves')
  check(layout(5) !== layout(6), 'another seed, another layout')
}

console.log(`ffa ok (${checks} checks)`)
