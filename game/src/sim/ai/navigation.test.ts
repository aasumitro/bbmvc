// Tests for the bots' router, and their swerve round a mine in their way.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Agent } from './brain.ts'
import { routesTo } from './navigation.ts'
import { dodge } from './perception.ts'

// Every check is a test of its own, in order, under its label (the it.each
// at the end); a failed one fails its test, and the rest still run.
const checks: Array<[string, boolean]> = []
const check = (ok: boolean, what: string) => void checks.push([what, ok])

// A 100 m square with one diagonal road; node 4 is cut off.
//   0 --- 1
//   |   / |
//   3 --- 2      4
const at = (x: number, z: number) => new THREE.Vector3(x, 0, z)
const nav = { nodes: [at(0, 0), at(100, 0), at(100, 100), at(0, 100), at(300, 300)], links: [[1, 3], [0, 2, 3], [1, 3], [0, 2, 1], []] }
const { cost, next } = routesTo(nav, 3)
check(next[3] === -1, 'the end has no next hop')
check(next[1] === 3 && Math.abs(cost[1] - Math.hypot(100, 100)) < 1e-9, 'the diagonal beats going round')
check(next[0] === 3 && next[2] === 3, 'neighbours drive straight there')
check(cost[4] === Infinity && next[4] === -1, 'a cut-off node has no route')
const mined = routesTo(nav, 3, [at(52, 47)])
check(next[1] === 3 && mined.next[1] !== 3 && Math.abs(mined.cost[1] - 200) < 1e-9, 'a mine known on the diagonal: round the square instead')
const clear = routesTo(nav, 3, [at(200, -50)])
check(
  clear.cost.every((c, i) => c === cost[i]),
  'a mine off every road costs nothing',
)

// A bot at the origin facing +z (its left +x): a hostile mine just left of
// its path, 10 m ahead, has it steer right (-); just right, left (+); one
// behind it, off to the side, or its own side's, nothing.
const bot = { team: 0, position: at(0, 0) } as unknown as Agent
const mine = (x: number, z: number, team = 1) => ({ position: at(x, z), owner: { team } })
const swerves = [mine(1, 10), mine(-1, 10), mine(1, -10), mine(12, 10), mine(1, 10, 0)].map((m) => dodge(bot, [m], 0))
check(
  swerves[0] < 0 && swerves[1] > 0 && swerves.slice(2).every((s) => s === 0),
  `a mine in its way, it swerves round it (${swerves.map((s) => s.toFixed(2)).join(', ')})`,
)
describe('the router', () => {
  it.each(checks)('%s', (_, ok) => expect(ok).toBe(true))
})
