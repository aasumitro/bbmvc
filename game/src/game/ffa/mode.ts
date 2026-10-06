import type RAPIER from '@dimforge/rapier3d-compat'
import type * as THREE from 'three'
import type { Agent } from '../ai.ts'
import type { Arena } from '../arena/arena.ts'
import { itemSpots } from '../items/items.ts'
import type { Pickups } from '../items/pickups.ts'
import { announce as announceSupply } from '../items/supply.ts'
import type { MatchSettings } from '../matchSettings.ts'
import { clock, ms, type Feed, type MatchMode, type Seat } from '../mode.ts'
import { FFA } from './config.ts'
import { createFreeForAll, type FfaEvent, type Participant } from './rules.ts'
import type { HotZone } from './zone.ts'

// Free for all in the match runtime (the MatchMode contract, ../mode.ts):
// every machine on its own team, lined up on the arena's spawns. The
// rules (rules.ts) run on the simulation's fixed step; this reports their
// events to the feed, hands the bots their plan and says when it's over.
// Pickups and the hot zone are drawn by the `scenery` the browser passes in
// (../items/pickups.ts, zone.ts), so the mode also runs headless.

export interface FfaScenery {
  pickups: Pickups
  zone: HotZone
}

export const lineUp = (arena: Arena, size: number): Seat[] => Array.from({ length: size }, (_, i) => ({ team: i, spawn: arena.spawns[i % arena.spawns.length] }))

// `seed`: the match's; every item and zone roll comes from it.
export function createFfaMode(machines: readonly (Participant & Agent)[], arena: Arena, world: RAPIER.World, seed: number, settings: MatchSettings, scenery?: FfaScenery) {
  const rules = createFreeForAll(machines, { starts: arena.spawns.map((spawn) => spawn.position), spots: itemSpots(arena, world, arena.spawns), zones: arena.zones ?? [], seed, settings })
  const mode = {
    kind: 'ffa' as const,
    rules,
    timing: FFA,
    starts: arena.spawns,
    supply: rules.supply,
    plan: {
      value: (bot: Agent, rival: Agent, distance: number) => rules.targetValue(bot.id, rival.id, distance),
      errand: (bot: Agent) => rules.errand(bot.id),
    },
    outcome: () => (rules.phase !== 'complete' ? undefined : rules.winner < 0 ? null : machines[rules.winner].team),
    speedFactor: (i: number) => rules.speedFactor(i),
    fired() {},
    report(feed?: Feed) {
      if (feed) for (const event of rules.events) announce(event, feed)
      rules.events.length = 0
    },
    show(camera: THREE.Camera) {
      scenery?.pickups.update(rules.supply.items, rules.now, camera)
      scenery?.zone.update(rules.zone, camera)
    },
    debug: () => [`FFA    ${rules.phase} ${clock(rules.elapsed())}  items ${rules.supply.items.length}`, `ZONE   ${rules.zone?.name ?? '-'}`],
    restart(next: number) {
      rules.reset(next)
      scenery?.pickups.clear()
      scenery?.zone.clear()
    },
    dispose() {
      scenery?.pickups.dispose()
      scenery?.zone.dispose()
    },
    // Online: what the HUD, the pickups and the results read of the rules.
    // The standings are sorted here, from the statistics alone; the zone
    // travels by name, so a mirror keeps the arena's own zone object.
    share: () => ({
      phase: rules.phase,
      overtimeAt: ms(rules.overtimeAt),
      winner: rules.winner,
      draw: rules.draw,
      order: [...rules.standings()],
      supply: rules.supply.share(),
      zone: rules.zone?.name ?? null,
      contenders: rules.contenders.map(({ life, respawnAt, protectedUntil }) => ({ life, respawnAt: ms(respawnAt), protectedUntil: ms(protectedUntil) })),
      feuds: rules.feuds,
    }),
    mirror(state: unknown) {
      const shared = state as FfaShared
      Object.assign(rules, { phase: shared.phase, overtimeAt: shared.overtimeAt, winner: shared.winner, draw: shared.draw })
      rules.supply.mirror(shared.supply)
      rules.zone = arena.zones?.find((zone) => zone.name === shared.zone) ?? null
      rules.order.splice(0, rules.order.length, ...shared.order)
      shared.contenders.forEach((c, i) => Object.assign(rules.contenders[i], c))
      shared.feuds.forEach((row, k) => row.forEach((kills, v) => (rules.feuds[k][v] = kills)))
    },
  }
  type FfaShared = ReturnType<typeof mode.share>
  return mode satisfies MatchMode
}

function announce(event: FfaEvent, feed: Feed) {
  switch (event.type) {
    case 'kill':
      return feed.kill(event, FFA.multiKill.titles, false)
    case 'death':
      return feed.death(event.victim, false)
    case 'nemesis':
      if (event.of === feed.me) feed.callout(`${feed.name(event.who)} is your nemesis`)
      return
    case 'item':
    case 'wave':
    case 'expired':
      return announceSupply(event, feed)
    case 'zone':
      if (!event.zone) return
      feed.news('Hot zone', event.zone.name)
      return feed.callout(`Hot zone · ${event.zone.name}`, false)
    case 'phase':
      return feed.phase(event.phase)
  }
}
