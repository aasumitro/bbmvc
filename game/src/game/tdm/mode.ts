import type RAPIER from '@dimforge/rapier3d-compat'
import type * as THREE from 'three'
import type { Agent } from '../ai.ts'
import type { Arena, SpawnPoint } from '../arena/arena.ts'
import { itemSpots, itemTypes } from '../items/items.ts'
import type { Pickups } from '../items/pickups.ts'
import { announce as announceSupply } from '../items/supply.ts'
import type { MatchSettings } from '../matchSettings.ts'
import { clock, ms, type Feed, type MatchMode, type Seat } from '../mode.ts'
import { TDM } from './config.ts'
import { createTeamDeathmatch } from './rules.ts'
import { createTactics } from './tactics.ts'
import type { Member, TdmEvent } from './types.ts'

// Team deathmatch in the match runtime (the MatchMode contract, ../mode.ts):
// two even teams from the arena's bases, seat 0 (the player) leading team
// 0. The rules (rules.ts) run on the simulation's fixed step, the bots play
// through the team tactics (tactics.ts); this reports the events to the feed
// and says who won. Its pickups, when a match's settings turn them on, are
// drawn by the `pickups` view the browser passes in (../items/pickups.ts).

// `size` machines: the first half blue, the rest red.
export function lineUp(arena: Arena, size: number): Seat[] {
  const bases = teamBases(arena)
  const side = size / 2
  return Array.from({ length: size }, (_, seat) => {
    const team = seat < side ? 0 : 1
    const base = bases[team]
    return { team, spawn: base[(seat % side) % base.length] }
  })
}

export function createTdmMode(machines: readonly (Member & Agent)[], arena: Arena, world: RAPIER.World, seed: number, settings: MatchSettings, pickups?: Pickups) {
  const bases = teamBases(arena)
  // Respawns at any prepared start — both bases and the other starts — scored for the team coming back in.
  const starts = [...bases[0], ...bases[1], ...arena.spawns]
  const spots = itemTypes(settings.items).length ? itemSpots(arena, world, starts) : [] // items clear of every start, the bases' too
  const rules = createTeamDeathmatch(machines, { starts: starts.map((spawn) => spawn.position), homes: [midpoint(bases[0]), midpoint(bases[1])], spots, seed, settings })
  const tactics = createTactics(machines, rules, arena.nav.nodes)
  const mode = {
    kind: 'tdm' as const,
    rules,
    tactics, // the bots' teamwork
    timing: TDM,
    starts,
    supply: rules.supply,
    plan: {
      value: (bot: Agent, rival: Agent, distance: number) => tactics.targetValue(bot.id, rival.id, distance),
      // health it knows about when it's low (urgent), the team's errand otherwise
      errand: (bot: Agent) => {
        const item = rules.supply?.errand(bot.id, 1, rules.contenders[bot.id].errand)
        return item?.urgent ? item : tactics.errand(bot.id, bot.brain?.target?.id ?? -1)
      },
      careful: settings.friendlyFire, // hold fire rather than hit a teammate
    },
    outcome: () => (rules.phase !== 'complete' ? undefined : rules.winner < 0 ? null : rules.winner),
    speedFactor: (i: number) => rules.supply?.speedFactor(i) ?? 1,
    fired: (i: number) => rules.fired(i), // firing ends spawn protection
    report(feed?: Feed) {
      if (feed) for (const event of rules.events) announce(event, feed)
      rules.events.length = 0
    },
    show(camera: THREE.Camera) {
      pickups?.update(rules.supply?.items ?? [], rules.now, camera)
    },
    // the match clock stands at 10:00 through overtime: show overtime's own
    debug: () => [`TDM    ${rules.phase} ${clock(rules.phase === 'overtime' ? rules.overtimeElapsed() : rules.elapsed())}  ${rules.score.join(' : ')}`],
    restart(next: number) {
      rules.reset(next)
      pickups?.clear()
    },
    dispose() {
      pickups?.dispose()
    },
    // Online: what the HUD and the results read of the rules (standings,
    // deficit and overtime follow from these and the statistics).
    share: () => ({
      phase: rules.phase,
      overtimeAt: ms(rules.overtimeAt),
      winner: rules.winner,
      draw: rules.draw,
      mvp: rules.mvp,
      score: [...rules.score],
      supply: rules.supply?.share(),
      contenders: rules.contenders.map(({ life, respawnAt, protectedUntil }) => ({ life, respawnAt: ms(respawnAt), protectedUntil: ms(protectedUntil) })),
    }),
    mirror(state: unknown) {
      const shared = state as TdmShared
      Object.assign(rules, { phase: shared.phase, overtimeAt: shared.overtimeAt, winner: shared.winner, draw: shared.draw, mvp: shared.mvp })
      rules.score[0] = shared.score[0]
      rules.score[1] = shared.score[1]
      if (shared.supply) rules.supply?.mirror(shared.supply)
      shared.contenders.forEach((c, i) => Object.assign(rules.contenders[i], c))
    },
  }
  type TdmShared = ReturnType<typeof mode.share>
  return mode satisfies MatchMode
}

function teamBases(arena: Arena) {
  if (!arena.bases) throw new Error(`${arena.name} has no team bases`)
  return arena.bases
}

const midpoint = (spawns: SpawnPoint[]) => ({ x: spawns.reduce((sum, s) => sum + s.position.x, 0) / spawns.length, z: spawns.reduce((sum, s) => sum + s.position.z, 0) / spawns.length })

function announce(event: TdmEvent, feed: Feed) {
  switch (event.type) {
    case 'kill':
      return feed.kill(event, TDM.multiKill.titles, true)
    case 'teamkill':
      return feed.teamKill(event.killer, event.victim)
    case 'death':
      return feed.death(event.victim, true)
    case 'finalMinute': // a clock mark here, not a state
      return feed.phase('finalMinute')
    case 'phase':
      return feed.phase(event.phase)
    case 'item':
    case 'wave':
    case 'expired':
      return announceSupply(event, feed)
  }
}
