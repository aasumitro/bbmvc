// Self-check for the arenas the game server plays on: each map built
// headless by the browser's own builders (arenas.ts), then what it needs to
// be a fair fight — enough starts, both team bases, hot zones, a road graph
// in one piece, no start inside something solid — and a digest that comes
// out the same build after build (the browser's F3 overlay shows its own:
// equal digests, equal ground) and is the one server/digests.json expects —
// the file the deploy's smoke test and scripts/arena-parity.mjs hold the
// server and the browser to; an arena changed on purpose changes it there
// too. Prints what it measured. Bundled (the builders need Vite): npm run
// server:check.
import RAPIER from '@dimforge/rapier3d-compat'
import type { Arena } from '../src/game/arena/arena'
import { arenaDigest } from '../src/game/arena/digest'
import { MAPS, type MapId } from '../src/game/maps'
import { createWorld, initPhysics } from '../src/game/physics'
import { VEHICLES } from '../src/game/vehicle/vehicles'
import { arenaData } from './arenas'
import DIGESTS from './digests.json'

await initPhysics()

let checks = 0
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`arena: ${what}`)
  checks++
}
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

// A razor's collision shells on the start, level, facing its heading: does any static collider cut into them?
function blocked(world: RAPIER.World, { position: p, heading }: { position: { x: number; y: number; z: number }; heading: number }) {
  const rotation = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }
  return VEHICLES.razor.chassis.shells.some(([hx, hy, hz, y, z]) => {
    const centre = { x: p.x + Math.sin(heading) * z, y: p.y + y, z: p.z + Math.cos(heading) * z }
    return world.intersectionWithShape(centre, rotation, new RAPIER.Cuboid(hx, hy, hz), RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC) !== null
  })
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

  check(arena.spawns.length >= 8, `${id}: at least 8 starts for free for all (${arena.spawns.length})`)
  check(arena.bases?.length === 2 && arena.bases.every((base) => base.length >= 6), `${id}: two team bases of at least 6 starts (six a side)`)
  check((arena.zones?.length ?? 0) >= 1, `${id}: at least one hot zone`)
  check(arena.nav.nodes.length > 0 && connected(arena), `${id}: the road graph is in one piece`)
  check(arena.root.children.length === 0 && arena.emitters.length === 0, `${id}: nothing left to look at`)
  const world = createWorld(arena.colliders)
  for (const [i, start] of [...arena.spawns, ...(arena.bases ?? []).flat()].entries()) check(!blocked(world, start), `${id}: start ${i} is clear of anything solid`)
  world.free()

  // Built again from scratch, with its meshes: the same ground, to the millimetre.
  const again = MAPS[id].build()
  const full = heap()
  check(arenaDigest(again) === digest, `${id}: the same digest build after build`)
  const expected = (DIGESTS as Record<string, string>)[id]
  check(digest === expected, `${id}: the digest server/digests.json expects (${expected ?? 'none'}, built ${digest}): an arena changed on purpose changes it there too`)

  console.log(
    `${id.padEnd(9)} built ${Math.round(ms)} ms  colliders ${arena.colliders.length} (${kinds.box} box, ${kinds.cylinder} cylinder, ${kinds.hull} hull)` +
      `  starts ${arena.spawns.length}  bases ${arena.bases!.map((base) => base.length).join('+')}  zones ${arena.zones!.length}` +
      `  nav ${arena.nav.nodes.length} nodes ${links} links  digest ${digest}  heap ${full} with meshes, ${played} played (from ${baseline})`,
  )
}

console.log(`arena ok (${checks} checks)`)
