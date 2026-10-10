// Tests for the arenas the game server plays on: each map built
// headless by the browser's own builders (arenas.ts), then what it needs to
// be a fair fight — enough starts, both team bases, hot zones, a road graph
// in one piece, no start inside something solid — and a digest that comes
// out the same build after build (the browser's F3 overlay shows its own:
// equal digests, equal ground) and is the one server/digests.json expects —
// the file the deploy's smoke test and scripts/arena-parity.mjs hold the
// server and the browser to; an arena changed on purpose changes it there
// too. Then every mode each arena hosts, at the biggest line-up a custom
// lobby may ask for. Prints what it measured. An integration test
// (vitest.config.ts: the builders need Vite).
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import RAPIER from '@dimforge/rapier3d-compat'
import type { Arena } from '../src/content/arenas/arena.ts'
import { DIFFICULTIES } from '../src/sim/difficulty.ts'
import { arenaDigest } from '../src/content/arenas/digest.ts'
import { MAPS, type MapId } from '../src/content/arenas/maps.ts'
import { classic } from '../src/modes/matchSettings.ts'
import { MODES } from '../src/modes/modes.ts'
import { MODE_TRAITS } from '../src/modes/traits.ts'
import { createWorld, initPhysics } from '../src/sim/physics.ts'
import { recruits } from '../src/modes/roster.ts'
import { enlist } from '../src/sim/simulation.ts'
import { VEHICLES } from '../src/content/vehicles/vehicles.ts'
import { SUPPLY } from '../src/modes/items/config.ts'
import { itemSpots } from '../src/modes/items/items.ts'
import { arenaData } from './arenas.ts'
import DIGESTS from './digests.json'

await initPhysics()

// Every check is a test of its own, in order, under its label (the it.each
// at the end); a failed one fails its test, and the rest still run.
const checks: Array<[string, boolean]> = []
const check = (ok: boolean, what: string) => void checks.push([what, ok])
const collect = globalThis.gc ?? (() => {}) // node --expose-gc: heap numbers after the garbage is gone
const heap = () => {
  collect()
  return `${Math.round(process.memoryUsage().heapUsed / 1e6)} MB`
}

// Every node reachable from the first: the bots can get anywhere from anywhere.
function connected({ nav }: Arena) {
  const seen = new Set([0])
  const queue = [0]
  while (queue.length) {
    for (const next of nav.links[queue.pop()!]) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen.size === nav.nodes.length
}

// Every vehicle's collision shells on the start, level, facing its heading: does any static collider cut into them?
function blocked(world: RAPIER.World, { position: p, heading }: { position: { x: number; y: number; z: number }; heading: number }) {
  const rotation = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }
  return Object.values(VEHICLES).some(({ chassis }) =>
    chassis.shells.some(([hx, hy, hz, y, z]) => {
      const centre = { x: p.x + Math.sin(heading) * z, y: p.y + y, z: p.z + Math.cos(heading) * z }
      return world.intersectionWithShape(centre, rotation, new RAPIER.Cuboid(hx, hy, hz), RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC) !== null
    }),
  )
}

const baseline = heap()
for (const id of Object.keys(MAPS) as MapId[]) {
  const started = performance.now()
  const arena = arenaData(id)
  const ms = performance.now() - started
  const played = heap()
  check(arenaData(id) === arena, `${id}: built once, then kept`)

  const kinds = { box: 0, cylinder: 0, hull: 0 }
  for (const shape of arena.colliders) kinds['box' in shape ? 'box' : 'cylinder' in shape ? 'cylinder' : 'hull']++
  const links = arena.nav.links.reduce((sum, list) => sum + list.length, 0) / 2
  const digest = arenaDigest(arena)

  const freeForAll = Math.max(...MODE_TRAITS.ffa.sizes) // the biggest free for all a lobby may ask for
  check(arena.spawns.length >= freeForAll, `${id}: a start for every machine of the biggest free for all, ${freeForAll} (${arena.spawns.length})`)
  check(arena.bases?.length === 2 && arena.bases.every((base) => base.length >= 6), `${id}: two team bases of at least 6 starts (six a side)`)
  check((arena.zones?.length ?? 0) >= 1, `${id}: at least one hot zone`)
  const preview = new URL(`../public/${MAPS[id].image.slice(import.meta.env.BASE_URL.length)}`, import.meta.url)
  check(existsSync(preview), `${id}: its preview card is in public/ (${MAPS[id].image})`)
  check(arena.nav.nodes.length > 0 && connected(arena), `${id}: the road graph is in one piece`)
  check(arena.root.children.length === 0 && arena.emitters.length === 0, `${id}: nothing left to look at`)
  const world = createWorld(arena.colliders)
  const starts = [...arena.spawns, ...(arena.bases ?? []).flat()]
  for (const [i, start] of starts.entries()) check(!blocked(world, start), `${id}: start ${i} is clear of anything solid, for every vehicle`)
  const spots = itemSpots(arena, world, starts)
  check(
    spots.length >= SUPPLY.maxActive,
    `${id}: room for a full drop of pickups: ${spots.length} item spots ${SUPPLY.clearOfStarts} m clear of every start and clear of anything solid (needs ${SUPPLY.maxActive})`,
  )
  world.free()

  // Built again from scratch, with its meshes: the same ground, to the millimetre.
  const again = MAPS[id].build()
  const full = heap()
  check(arenaDigest(again) === digest, `${id}: the same digest build after build`)
  const expected = (DIGESTS as Record<string, string>)[id]
  check(
    digest === expected,
    `${id}: the digest server/digests.json expects (${expected ?? 'none'}, built ${digest}): an arena changed on purpose changes it there too`,
  )

  console.log(
    `${id.padEnd(9)} built ${Math.round(ms)} ms  colliders ${arena.colliders.length} (${kinds.box} box, ${kinds.cylinder} cylinder, ${kinds.hull} hull)` +
      `  starts ${arena.spawns.length}  bases ${arena.bases!.map((base) => base.length).join('+')}  zones ${arena.zones!.length}` +
      `  nav ${arena.nav.nodes.length} nodes ${links} links  digest ${digest}  heap ${full} with meshes, ${played} played (from ${baseline})`,
  )
}

// Every arena with every mode it hosts, lined up at the most machines a
// custom lobby may ask for (its traits' sizes): each seat its own start, and the
// mode built headless on them as a room builds it.
const hosted: string[] = []
for (const id of Object.keys(MAPS) as MapId[]) {
  const arena = arenaData(id)
  for (const kind of MAPS[id].modes) {
    const size = Math.max(...MODE_TRAITS[kind].sizes)
    const settings = { ...classic(kind), size }
    const starts = new Set(MODES[kind].lineUp(arena, size).map(({ spawn }) => spawn.position.toArray().join()))
    check(starts.size === size, `${id}, ${kind} for ${size}: every seat its own start (${starts.size})`)
    const world = createWorld(arena.colliders)
    const combatants = recruits(kind, arena, settings, 1, DIFFICULTIES.normal).map((recruit, i) => enlist(world, i, recruit))
    const mode = MODES[kind].create({ combatants, arena, world, seed: 1, settings })
    check(
      combatants.length === size && mode.outcome() === undefined && mode.starts.length > 0,
      `${id}, ${kind} for ${size}: the mode built headless, its match on`,
    )
    mode.dispose()
    world.free()
    hosted.push(`${id} ${kind} ${size}`)
  }
}
console.log(`every mode each arena hosts, at its biggest: ${hosted.join(', ')}`)

describe('arena', () => {
  it.each(checks)('%s', (_, ok) => expect(ok).toBe(true))
})
