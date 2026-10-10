import type RAPIER from '@dimforge/rapier3d-compat'
import type * as THREE from 'three'
import type { NavGraph } from '../../content/arenas/arena.ts'
import { distance as flat, wrap } from '../../shared/math.ts'
import { AI, type Agent, type Brain } from './brain.ts'
import { open } from './perception.ts'

// How a bot finds its way (sim/ai/): the nav graph's routes and the point a
// little ahead along them it steers for.

// The nearest few nodes to `at`, in plain view of it (the nearest at all if none is).
function nodesInView(world: RAPIER.World, nav: NavGraph, at: THREE.Vector3) {
  const order = nav.nodes.map((_, i) => i).sort((a, b) => flat(nav.nodes[a], at) - flat(nav.nodes[b], at))
  const seen = order.slice(0, 6).filter((i) => open(world, at, nav.nodes[i]))
  return seen.length ? seen : order.slice(0, 1)
}

// Every node's driving distance to node `end` and its next hop there
// (Dijkstra from the end; the graphs are small). -1: the end, or cut off.
export function routesTo(nav: NavGraph, end: number) {
  const count = nav.nodes.length
  const cost = new Float64Array(count).fill(Infinity)
  const next = new Int32Array(count).fill(-1)
  const done = new Uint8Array(count)
  cost[end] = 0
  for (;;) {
    let u = -1
    for (let i = 0; i < count; i++) if (!done[i] && cost[i] < Infinity && (u < 0 || cost[i] < cost[u])) u = i
    if (u < 0) break
    done[u] = 1
    for (const v of nav.links[u]) {
      const through = cost[u] + flat(nav.nodes[u], nav.nodes[v])
      if (through < cost[v]) {
        cost[v] = through
        next[v] = u
      }
    }
  }
  return { cost, next }
}

// Sets `goal` (the caller's) on the way to `destination`: a point a little
// ahead along the current leg of the route, a lane right of it (pure
// pursuit), so the bot keeps to its side of the street instead of cutting
// across toward the next stop. Replans now and then; returns the speed to
// hold to take the bend at that stop.
export function travel(bot: Agent, brain: Brain, world: RAPIER.World, nav: NavGraph, destination: THREE.Vector3, dt: number, goal: THREE.Vector3) {
  brain.replan -= dt
  if (brain.replan <= 0) {
    brain.replan = AI.replan
    const end = nodesInView(world, nav, destination)[0]
    const { cost, next } = routesTo(nav, end)
    // join the graph wherever makes the whole trip shortest, not just at the nearest node
    let start = -1
    for (const i of nodesInView(world, nav, bot.position)) {
      if (start < 0 || flat(bot.position, nav.nodes[i]) + cost[i] < flat(bot.position, nav.nodes[start]) + cost[start]) start = i
    }
    brain.route = []
    for (let v = start; v >= 0 && cost[v] < Infinity; v = next[v]) brain.route.push(v)
    if (brain.route.length > 1 && open(world, bot.position, nav.nodes[brain.route[1]])) brain.route.shift() // already past the first stop
    brain.from.copy(bot.position)
  }
  while (brain.route.length && flat(bot.position, nav.nodes[brain.route[0]]) < AI.arrive) brain.from.copy(nav.nodes[brain.route.shift()!])
  if (!brain.route.length) {
    goal.copy(destination)
    return Infinity
  }
  const a = brain.from
  const b = nav.nodes[brain.route[0]]
  const length = Math.max(flat(a, b), 0.01)
  const along = ((bot.position.x - a.x) * (b.x - a.x) + (bot.position.z - a.z) * (b.z - a.z)) / (length * length)
  const t = Math.min(1, Math.max(0, along) + (AI.lookahead[0] + Math.abs(bot.speed) * AI.lookahead[1]) / length)
  const lane = length > 15 ? AI.lane / length : 0 // keep right, so oncoming bots pass
  goal.set(a.x + (b.x - a.x) * t - (b.z - a.z) * lane, 0, a.z + (b.z - a.z) * t + (b.x - a.x) * lane)
  const [gentle, sharp, square] = AI.cornering
  let corner = square // the last stop: arrive ready to go anywhere next
  if (brain.route.length > 1) {
    const after = nav.nodes[brain.route[1]]
    const bend = Math.abs(wrap(Math.atan2(after.x - b.x, after.z - b.z) - Math.atan2(b.x - bot.position.x, b.z - bot.position.z)))
    corner = bend > 1.2 ? square : bend > 0.5 ? sharp : gentle
  }
  return Math.sqrt(corner * corner + 2 * AI.braking * Math.max(0, flat(bot.position, b) - AI.arrive))
}
